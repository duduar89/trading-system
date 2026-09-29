'use strict';
// Límites antes de cada orden — ARQUITECTURA §5.3. Lo aplica la Jefa de
// riesgos a cada propuesta; es código, no opinión.
//
// - `bloqueado` (kill switch) veta todo salvo `kill`.
// - Reducciones, cierres y stops se aprueban siempre: bajan riesgo, y un
//   precio viejo no es motivo para quedarse dentro.
// - Aperturas y aumentos pasan por los vetos y luego se recortan: primero
//   los multiplicadores (caída y Megáfono), después los topes, para que el
//   nocional final quepa en los topes con exactitud. Además del contrato se
//   comprueba el riesgo por operación con el stop (red de seguridad por si
//   el tamaño no vino de dimensionar()).
//
// Los límites llegan en ctx.limites (config.limites): aquí no se copia
// ninguna cifra. Cada motivo lleva un texto con las cifras, que es lo que la
// Jefa de riesgos dice en el chat.

const universo = require('../mercado/universo');
const { usd, pct, precio: fPrecio, numero, hora } = require('../util/formato');

const REDUCEN = new Set(['reduccion', 'cierre', 'stop']);
const AUMENTAN = new Set(['apertura', 'aumento']);
const HOLGURA = 1e-9;          // tolerancia de coma flotante al comparar con un tope

const positivo = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const vigente = (hasta, ahora) => hasta === null || hasta === undefined || !(ahora >= hasta);

function motivo(limite, valor, maximo, texto) {
  return { limite, valor, maximo, texto };
}

function etiqueta(simbolo) {
  const a = universo.porSimbolo(simbolo);
  return a ? a.etiqueta : String(simbolo);
}

function esCripto(propuesta) {
  if (propuesta.clase === 'cripto') return true;
  if (propuesta.clase === 'accion') return false;
  return universo.esCripto(propuesta.simbolo);
}

const hastaTexto = hasta => (hasta === null || hasta === undefined ? 'nueva orden' : `las ${hora(hasta)}`);

// Las directivas llegan de dos formas y se aceptan las dos:
// - el resumen del estado (§7): { modo, multiplicadores, activosVetados: [{simbolo, hasta, motivo}],
//   mesasPausadas: [{mesaId, hasta}], soloCerrarHasta, reduccion: {factor, hasta} | null };
// - la lista del Megáfono (§6.5): [{ tipo: 'reducir_riesgo'|'pausar_activo'|'pausar_mesa'|'solo_cerrar', ..., hasta }].
// Solo cuenta lo vigente; si hay varias reducciones, manda la más dura.
function normalizarDirectivas(directivas, ahora) {
  const out = {
    modo: null,
    soloCerrar: null,               // { hasta } si hay
    activosVetados: new Map(),      // simbolo → { hasta, motivo }
    mesasPausadas: new Map(),       // mesaId → { hasta }
    reduccion: null,                // { factor, hasta }
    multiplicadores: {},
  };
  if (!directivas) return out;

  const vetarActivo = (simbolo, hasta, m) => { if (simbolo && vigente(hasta, ahora)) out.activosVetados.set(simbolo, { hasta: hasta ?? null, motivo: m || null }); };
  const pausarMesa = (mesaId, hasta) => { if (mesaId && vigente(hasta, ahora)) out.mesasPausadas.set(mesaId, { hasta: hasta ?? null }); };
  const soloCerrar = hasta => {
    if (!vigente(hasta, ahora)) return;
    // Si hay varias, la que dura más (null = sin fecha, la que más).
    if (!out.soloCerrar || hasta === null || hasta === undefined
      || (out.soloCerrar.hasta !== null && hasta > out.soloCerrar.hasta)) out.soloCerrar = { hasta: hasta ?? null };
  };
  const reducir = (factor, hasta) => {
    if (!positivo(factor) || factor >= 1 || !vigente(hasta, ahora)) return;
    if (!out.reduccion || factor < out.reduccion.factor) out.reduccion = { factor, hasta: hasta ?? null };
  };

  if (Array.isArray(directivas)) {
    for (const d of directivas) {
      if (!d) continue;
      if (d.tipo === 'reducir_riesgo') reducir(d.factor, d.hasta);
      else if (d.tipo === 'pausar_activo') vetarActivo(d.simbolo, d.hasta, d.motivo || 'Megáfono');
      else if (d.tipo === 'pausar_mesa') pausarMesa(d.mesaId, d.hasta);
      else if (d.tipo === 'solo_cerrar') soloCerrar(d.hasta);
    }
    return out;
  }

  out.modo = directivas.modo || null;
  out.multiplicadores = directivas.multiplicadores || {};
  if (out.modo === 'SOLO_CERRAR') soloCerrar(null);
  for (const v of directivas.activosVetados || []) vetarActivo(v.simbolo, v.hasta, v.motivo);
  for (const m of directivas.mesasPausadas || []) pausarMesa(m.mesaId, m.hasta);
  if (directivas.soloCerrarHasta !== null && directivas.soloCerrarHasta !== undefined) soloCerrar(directivas.soloCerrarHasta);
  if (directivas.reduccion) reducir(directivas.reduccion.factor, directivas.reduccion.hasta);
  return out;
}

const NIVEL_TEXTO = { solo_cerrar: 'solo cerrar', pausado: 'pausa (solo cerrar hasta Reabrir)', bloqueado: 'bloqueo' };

function evaluarPropuesta(propuesta, ctx) {
  const lim = ctx && ctx.limites;
  if (!lim) throw new Error('evaluarPropuesta necesita ctx.limites (los de config.limites)');
  const p = propuesta || {};
  const ahora = ctx.ahora;
  const nivel = ctx.nivel || 'normal';
  const e = etiqueta(p.simbolo);
  const precio = p.precio;

  const nocional0 = positivo(p.nocional) ? p.nocional : (positivo(p.cantidad) && positivo(precio) ? p.cantidad * precio : 0);
  const cantidad0 = positivo(p.cantidad) ? p.cantidad : (nocional0 > 0 && positivo(precio) ? nocional0 / precio : 0);
  const vetar = motivos => ({ decision: 'vetar', nocional: 0, cantidad: 0, motivos });
  const aprobar = () => ({ decision: 'aprobar', nocional: nocional0, cantidad: cantidad0, motivos: [] });

  // Kill: cerrar todo pasa siempre, también bloqueado (es lo que el bloqueo pide).
  if (p.tipo === 'kill') return aprobar();

  if (nivel === 'bloqueado') {
    return vetar([motivo('bloqueado', nivel, 'kill', `Fondo bloqueado por el kill switch: solo se admite cerrar todo. ${e} no se toca hasta que un humano pulse Reabrir.`)]);
  }

  if (REDUCEN.has(p.tipo)) {
    // Sin cortos, reducir es vender. Una «reducción» que compra es un error que no debe colarse sin límites.
    if (p.lado !== 'venta') {
      return vetar([motivo('tipoIncoherente', p.lado, 'venta', `Una orden de ${p.tipo} en ${e} tiene que ser una venta y llega como ${p.lado}: no se envía.`)]);
    }
    return aprobar();
  }

  if (p.tipo === 'prueba') {
    // La prueba de 15 $ la pide un humano: solo se frena por el bloqueo (arriba) y por el ritmo de órdenes.
    const n = (ctx.ordenes && ctx.ordenes.ultimoMinuto) || 0;
    if (p.lado === 'compra' && n >= lim.maxOrdenesMinuto) {
      return vetar([motivo('maxOrdenesMinuto', n, lim.maxOrdenesMinuto, `${n} órdenes en el último minuto; máximo ${lim.maxOrdenesMinuto}. La prueba espera.`)]);
    }
    return aprobar();
  }

  if (!AUMENTAN.has(p.tipo)) {
    return vetar([motivo('tipo', p.tipo ?? null, null, `Tipo de propuesta desconocido «${p.tipo}» en ${e}: no se envía.`)]);
  }
  if (p.lado !== 'compra') {
    return vetar([motivo('tipoIncoherente', p.lado, 'compra', `Una ${p.tipo} en ${e} tiene que ser una compra (no hay cortos) y llega como ${p.lado}.`)]);
  }
  if (!positivo(precio) || !(nocional0 > 0)) {
    return vetar([motivo('datos', null, null, `Propuesta de ${e} sin precio o sin tamaño (precio ${fPrecio(precio)}, nocional ${usd(p.nocional)}).`)]);
  }
  const patrimonio = ctx.patrimonio;
  if (!positivo(patrimonio)) {
    return vetar([motivo('patrimonio', patrimonio ?? null, null, `Patrimonio desconocido (${usd(patrimonio)}): no se abre nada sin saber cuánto hay.`)]);
  }

  // ---- Vetos: se reúnen todos, para que el texto diga cada razón.
  const vetos = [];
  const dir = normalizarDirectivas(ctx.directivas, ahora);

  if (nivel !== 'normal') {
    vetos.push(motivo('nivel', nivel, 'normal', `Fondo en ${NIVEL_TEXTO[nivel] || nivel}: no se abren ni se aumentan posiciones.`));
  }
  if (dir.soloCerrar) {
    vetos.push(motivo('soloCerrar', dir.soloCerrar.hasta, null, `Directiva de solo cerrar vigente hasta ${hastaTexto(dir.soloCerrar.hasta)}: ${e} no abre.`));
  }
  const veto = dir.activosVetados.get(p.simbolo);
  if (veto) {
    vetos.push(motivo('activoVetado', p.simbolo, null, `${e} vetado hasta ${hastaTexto(veto.hasta)}${veto.motivo ? ` (${veto.motivo})` : ''}.`));
  }
  const pausa = dir.mesasPausadas.get(p.mesaId);
  if (pausa) {
    vetos.push(motivo('mesaPausada', p.mesaId, null, `Mesa ${p.mesaId} en pausa hasta ${hastaTexto(pausa.hasta)}.`));
  }
  if (dir.multiplicadores && dir.multiplicadores[p.mesaId] === 0) {
    vetos.push(motivo('multiplicadorComite', 0, null, `El comité ha dejado la mesa ${p.mesaId} a ×0: no abre.`));
  }

  const cripto = esCripto(p);
  if (!cripto && !(ctx.mercadoAbierto && ctx.mercadoAbierto.accion === true)) {
    // Sin dato de la bolsa se trata como cerrada: mejor perder una entrada que mandar una orden a ciegas.
    vetos.push(motivo('mercadoCerrado', false, true, `Bolsa cerrada: ${e} espera a la apertura.`));
  }

  const claveAntig = cripto ? 'maxAntiguedadPrecioSegCripto' : 'maxAntiguedadPrecioSegAcciones';
  const maxSeg = lim[claveAntig];
  if (typeof p.precioT !== 'number' || !Number.isFinite(p.precioT)) {
    vetos.push(motivo(claveAntig, null, maxSeg, `Precio de ${e} sin instante: no se puede saber si es fresco.`));
  } else {
    const seg = (ahora - p.precioT) / 1000;
    if (seg > maxSeg) {
      vetos.push(motivo(claveAntig, seg, maxSeg, `Precio de ${e} con ${numero(seg)} s de antigüedad; máximo ${numero(maxSeg)} s.`));
    }
  }

  if (positivo(p.precioDecision)) {
    const desvio = Math.abs(precio - p.precioDecision) / p.precioDecision;
    if (desvio > lim.desvioMaxPrecio + HOLGURA) {
      vetos.push(motivo('desvioMaxPrecio', desvio, lim.desvioMaxPrecio,
        `El precio de ${e} se ha movido un ${pct(desvio)} desde la decisión (${fPrecio(p.precioDecision)} → ${fPrecio(precio)}); máximo ${pct(lim.desvioMaxPrecio)}. Hay que volver a decidir.`));
    }
  }

  if (p.tipo === 'apertura' && !(positivo(p.stop) && p.stop < precio)) {
    vetos.push(motivo('sinStop', p.stop ?? null, precio, `Apertura en ${e} sin stop válido (stop ${fPrecio(p.stop)}, precio ${fPrecio(precio)}).`));
  }

  const val = ctx.valoracion || {};
  const porActivo = val.exposicionPorActivo || {};
  const actualActivo = porActivo[p.simbolo] || 0;
  // Abrir en un símbolo que ya tiene otra mesa no añade posición en el bróker.
  const nPos = val.posicionesAbiertas || 0;
  if (!(actualActivo > 0) && nPos >= lim.maxPosiciones) {
    vetos.push(motivo('maxPosiciones', nPos, lim.maxPosiciones, `Ya hay ${nPos} posiciones abiertas; máximo ${lim.maxPosiciones}.`));
  }

  const ordenes = ctx.ordenes || {};
  const nMin = ordenes.ultimoMinuto || 0;
  if (nMin >= lim.maxOrdenesMinuto) {
    vetos.push(motivo('maxOrdenesMinuto', nMin, lim.maxOrdenesMinuto, `${nMin} órdenes en el último minuto; máximo ${lim.maxOrdenesMinuto}.`));
  }
  const nMesa = (ordenes.ultimaHoraPorMesa && ordenes.ultimaHoraPorMesa[p.mesaId]) || 0;
  if (nMesa >= lim.maxOrdenesMesaHora) {
    vetos.push(motivo('maxOrdenesMesaHora', nMesa, lim.maxOrdenesMesaHora, `La mesa ${p.mesaId} lleva ${nMesa} órdenes en la última hora; máximo ${lim.maxOrdenesMesaHora}.`));
  }

  if (vetos.length) return vetar(vetos);

  // ---- Recortes: primero multiplicadores, después topes.
  const motivos = [];
  let n = nocional0;

  const mult = ctx.multiplicadorCaida;
  if (positivo(mult) && mult < 1) {
    const antes = n;
    n *= mult;
    motivos.push(motivo('multiplicadorCaida', mult, 1, `Fondo en caída desde el máximo: tamaño ×${numero(mult, 2)} (${usd(antes)} → ${usd(n)}).`));
  }
  if (dir.reduccion) {
    const antes = n;
    n *= dir.reduccion.factor;
    motivos.push(motivo('reduccionMegafono', dir.reduccion.factor, 1,
      `Directiva de reducir riesgo ×${numero(dir.reduccion.factor, 2)} hasta ${hastaTexto(dir.reduccion.hasta)} (${usd(antes)} → ${usd(n)}).`));
  }

  const tope = (limite, actual, maximoFraccion, describir) => {
    const topeUsd = maximoFraccion * patrimonio;
    if (actual + n <= topeUsd + HOLGURA) return;
    const antes = n;
    n = Math.max(0, topeUsd - actual);
    motivos.push(motivo(limite, (actual + antes) / patrimonio, maximoFraccion, describir(actual, antes, topeUsd)));
  };

  tope('maxPesoPorActivo', actualActivo, lim.maxPesoPorActivo, (actual, antes, topeUsd) =>
    `${e} pasaría a ${usd(actual + antes)} (${pct((actual + antes) / patrimonio)} del patrimonio); máximo ${pct(lim.maxPesoPorActivo)} (${usd(topeUsd)}). Se recorta de ${usd(antes)} a ${usd(n)}.`);
  tope('maxExposicionBruta', val.exposicionBruta || 0, lim.maxExposicionBruta, (actual, antes, topeUsd) =>
    `La exposición bruta pasaría a ${usd(actual + antes)} (${pct((actual + antes) / patrimonio)}); máximo ${pct(lim.maxExposicionBruta)} (${usd(topeUsd)}). ${e} se recorta de ${usd(antes)} a ${usd(n)}.`);
  if (cripto) {
    tope('maxExposicionCripto', val.exposicionCripto || 0, lim.maxExposicionCripto, (actual, antes, topeUsd) =>
      `La exposición cripto pasaría a ${usd(actual + antes)} (${pct((actual + antes) / patrimonio)}); máximo ${pct(lim.maxExposicionCripto)} (${usd(topeUsd)}). ${e} se recorta de ${usd(antes)} a ${usd(n)}.`);
  }

  if (positivo(p.stop) && p.stop < precio && positivo(lim.riesgoPorOperacion)) {
    const distancia = (precio - p.stop) / precio;
    const riesgo = n * distancia;
    const topeRiesgo = lim.riesgoPorOperacion * patrimonio;
    if (riesgo > topeRiesgo + HOLGURA) {
      const antes = n;
      n = topeRiesgo / distancia;
      motivos.push(motivo('riesgoPorOperacion', riesgo / patrimonio, lim.riesgoPorOperacion,
        `Con el stop en ${fPrecio(p.stop)} se arriesgarían ${usd(riesgo)} (${pct(riesgo / patrimonio)} del patrimonio); máximo ${pct(lim.riesgoPorOperacion)} (${usd(topeRiesgo)}). ${e} se recorta de ${usd(antes)} a ${usd(n)}.`));
    }
  }

  if (n < lim.minNocionalOrden) {
    motivos.push(motivo('minNocionalOrden', n, lim.minNocionalOrden,
      `Tras los recortes quedan ${usd(n)} para ${e}; el mínimo por orden es ${usd(lim.minNocionalOrden)}.`));
    return vetar(motivos);
  }

  const reducido = n < nocional0 * (1 - HOLGURA);
  return {
    decision: reducido ? 'reducir' : 'aprobar',
    nocional: n,
    cantidad: n / precio,
    motivos,
  };
}

module.exports = { evaluarPropuesta, normalizarDirectivas };
