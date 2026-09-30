'use strict';
// Vigilante del fondo — ARQUITECTURA §5.4. Se llama en cada latido con el
// último precio y decide el nivel del fondo y qué stops han saltado.
//
// - Pérdida del día ≤ −perdidaDiariaSoloCerrar (−2 %) → solo cerrar hasta las
//   00:00 UTC siguientes; ≤ −perdidaDiariaKill (−7 %) → kill switch.
// - Caída desde el máximo ≤ −caidaReducir (−10 %) → posiciones nuevas a la
//   mitad (multiplicadorCaida 0,5); ≤ −caidaKill (−25 %) → kill switch.
// Los kills son para cuando algo se rompe; un mal día o un bajista los frenan
// el solo cerrar y el ×0,5 (src/config.js, scripts/estudiar-limites.js).
// - `bloqueado` es pegajoso: de ahí solo se sale con Reabrir humano, nunca
//   porque el patrimonio se recupere. `pausado` (botón Pausar) también: solo
//   un humano lo quita. Un kill los supera a los dos.
// Umbrales en `limites` (config.limites); por qué cada valor: src/config.js y docs/04-riesgo-y-mejora.md.
//
// Los stops cripto viven aquí, en software (no hay órdenes stop simples en
// cripto): con el ordenador apagado no hay stops.

const universo = require('../mercado/universo');
const { pct, precio: fPrecio, hora } = require('../util/formato');
const { inicioVela, diaUTC, DIA } = require('../util/reloj');
const { precioDe } = require('../cartera/libros');

// «−10 % → posiciones nuevas a la mitad» (critica-sintesis §1). No está en
// config porque no es un tope sino el efecto de uno.
const FACTOR_CAIDA = 0.5;
// 90.000/100.000 − 1 da −0,0999999…: sin holgura, un −10 % exacto no saltaría.
const HOLGURA = 1e-9;

const EPS = 1e-12;

function etiqueta(simbolo) {
  const a = universo.porSimbolo(simbolo);
  return a ? a.etiqueta : String(simbolo);
}

function siguienteMedianocheUTC(t) {
  return inicioVela(t, DIA) + DIA;
}

function vigilar({
  ahora, patrimonio, patrimonioInicioDia, pico, puestos = [], precios = {}, limites,
  nivelActual = 'normal', soloCerrarHasta = null, multiplicadorCaidaActual, diaInicio,
} = {}) {
  if (!limites) throw new Error('vigilar necesita los límites (config.limites)');
  const acciones = [];
  const alertas = [];
  const actual = nivelActual || 'normal';

  // diaInicio (opcional) = día UTC al que pertenece patrimonioInicioDia. Entre
  // las 00:00 y el cierre diario (00:05) la referencia aún es la de ayer: sin
  // esto, el solo cerrar de ayer volvería a saltar y duraría otro día entero.
  const referenciaDeHoy = !diaInicio || diaInicio === diaUTC(ahora);
  const perdidaDia = referenciaDeHoy && patrimonioInicioDia > 0 && patrimonio > 0 ? patrimonio / patrimonioInicioDia - 1 : null;
  const picoEfectivo = Math.max(pico > 0 ? pico : 0, patrimonio > 0 ? patrimonio : 0);
  const caida = picoEfectivo > 0 && patrimonio > 0 ? patrimonio / picoEfectivo - 1 : null;

  const multiplicadorCaida = caida !== null && caida <= -limites.caidaReducir + HOLGURA ? FACTOR_CAIDA : 1;
  const base = { multiplicadorCaida, perdidaDia, caida, pico: picoEfectivo || null };

  // Bloqueado se queda bloqueado: el kill ya cerró todo y aquí no se relanza
  // (repetirlo cada latido podría encolar ventas duplicadas con la bolsa cerrada).
  if (actual === 'bloqueado') {
    const abiertos = puestos.filter(p => !p.sombra && p.cantidad > EPS);
    if (abiertos.length) {
      alertas.push(`Fondo bloqueado con ${abiertos.length} ${abiertos.length === 1 ? 'puesto abierto' : 'puestos abiertos'} (${[...new Set(abiertos.map(p => etiqueta(p.simbolo)))].join(', ')}): revisar el cierre.`);
    }
    return { nivel: 'bloqueado', ...base, acciones, alertas, soloCerrarHasta: null };
  }

  // ---- Kill switch: pérdida del día o caída desde el máximo.
  let motivoKill = null;
  if (perdidaDia !== null && perdidaDia <= -limites.perdidaDiariaKill + HOLGURA) {
    motivoKill = `Pérdida del día ${pct(perdidaDia)} (límite ${pct(-limites.perdidaDiariaKill)}): kill switch, se cierra todo. Reabre un humano.`;
  } else if (caida !== null && caida <= -limites.caidaKill + HOLGURA) {
    motivoKill = `Caída desde el máximo ${pct(caida)} (límite ${pct(-limites.caidaKill)}): kill switch, se cierra todo. Reabre un humano.`;
  }
  if (motivoKill) {
    // Sin stops aparte: el kill ya vende todo y dos ventas del mismo símbolo chocarían.
    acciones.push({ tipo: 'kill', motivo: motivoKill });
    alertas.push(motivoKill);
    return { nivel: 'bloqueado', ...base, acciones, alertas, soloCerrarHasta: null };
  }

  // ---- Solo cerrar.
  let nivel = actual;
  let hasta = soloCerrarHasta ?? null;
  if (nivel === 'solo_cerrar' && hasta !== null && ahora >= hasta) {
    nivel = 'normal';
    hasta = null;
    alertas.push(`Termina el solo cerrar: vuelve el modo normal.`);
  }
  if (perdidaDia !== null && perdidaDia <= -limites.perdidaDiariaSoloCerrar + HOLGURA && nivel === 'normal') {
    hasta = siguienteMedianocheUTC(ahora);
    nivel = 'solo_cerrar';
    const texto = `Pérdida del día ${pct(perdidaDia)} (límite ${pct(-limites.perdidaDiariaSoloCerrar)}): solo cerrar hasta las 00:00 UTC (${hora(hasta)} en Madrid).`;
    acciones.push({ tipo: 'solo_cerrar', motivo: texto, hasta });
    alertas.push(texto);
  }

  // ---- Caída: se avisa al entrar o salir (si se sabe el anterior); si no, mientras dure.
  if (multiplicadorCaidaActual === undefined) {
    if (multiplicadorCaida < 1) alertas.push(`Caída desde el máximo ${pct(caida)} (umbral ${pct(-limites.caidaReducir)}): posiciones nuevas a la mitad.`);
  } else if (multiplicadorCaida !== multiplicadorCaidaActual) {
    alertas.push(multiplicadorCaida < 1
      ? `Caída desde el máximo ${pct(caida)} (umbral ${pct(-limites.caidaReducir)}): posiciones nuevas a la mitad.`
      : `La caída desde el máximo vuelve a ${pct(caida)}: posiciones nuevas a tamaño normal.`);
  }

  // ---- Stops: con el último precio. Vale para puestos reales y sombra.
  for (const p of puestos) {
    if (!p || !(p.cantidad > EPS) || !(p.stop > 0)) continue;
    const px = p.precio > 0 ? p.precio : precioDe(precios, p.simbolo);
    if (px === null || !(px <= p.stop)) continue;
    const accion = { tipo: 'stop', puestoId: p.puestoId, simbolo: p.simbolo, precio: px, stop: p.stop };
    if (p.sombra) accion.sombra = true;
    acciones.push(accion);
    if (!p.sombra) alertas.push(`Stop saltado en ${etiqueta(p.simbolo)} (${p.mesaId || p.puestoId}): precio ${fPrecio(px)} ≤ stop ${fPrecio(p.stop)}. Venta a mercado.`);
  }

  return { nivel, ...base, acciones, alertas, soloCerrarHasta: nivel === 'solo_cerrar' ? hasta : null };
}

module.exports = { vigilar, FACTOR_CAIDA, siguienteMedianocheUTC };
