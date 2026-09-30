'use strict';
// Plantillas (§6.4): funciones puras que convierten datos del código en frases
// en español llano, para alguien que no sabe de bolsa. Son lo que se ve cuando
// no hay LLM, cuando se acaba el presupuesto o cuando un texto de LLM no pasa
// verificarCifras(). Por eso cada una aguanta datos incompletos sin escribir
// «undefined» ni «NaN»: una cifra que falta sale como «—».
//
// Tono (30-sep-2026): frases cortas, en primera persona del agente que habla,
// sin siglas sin explicar (RSI, stop, Sharpe van con su explicación al lado) y
// con las MISMAS cifras de los datos, formateadas con src/util/formato.js:
// ninguna plantilla calcula una cifra nueva. Los nombres de modo y de régimen
// (NORMAL, DEFENSIVO, SOLO_CERRAR; RISK-ON, NEUTRAL, RISK-OFF) se dejan tal
// cual, con lo que significan al lado: el comité comprueba con ellos que nadie
// contradice un voto.
//
// Conversación: las que contestan a alguien reciben `a` (su nombre, o solo el
// de pila) y empiezan dirigiéndose a él: «Lucía, aprobado: …».
//
// Firmas (todas reciben un objeto; los campos que faltan no rompen nada):
//   estadoPuesto({ etiqueta, marco, posicion: {cantidad, entrada, stop, pnlAbiertoPct} | null, estadoEstrategia })
//   notaAnalista({ etiqueta, nombre?, precio, sesgo, sma50, rsi, volAnual, marco })
//   regimen({ valor, puntos, anterior, detalle, componentes? })
//   propuesta({ etiqueta, lado, nocional, cantidad, precio, stop, factor?, a? })
//   aprobacion({ etiqueta, lado, tipo?, decision, nocional, nocionalPedido, cantidad, motivos, a? })
//   veto({ etiqueta, lado?, motivos: [{ texto }], a? })
//   orden({ etiqueta, lado, tipo?, nocional, cantidad, a?: [nombres] })
//   ejecucion({ etiqueta, lado, cantidad, precio, nocional, comision, a? })
//   cierre({ etiqueta, pnl, pnlPct, motivoSalida, barras, rMultiple })
//   stopSaltado({ etiqueta, precio, stop })
//   informeComite(jefe, datos) o informeComite.<jefe>(datos), jefe ∈ controller|macro|riesgos|mesas|laboratorio|megafono
//     datos.anterior (opcional): nombre de quien habló antes; el turno empieza dándole las gracias.
//   aperturaComite({ hora, motivo, primero? })
//   decisionComite({ modo, multiplicadores: {mesaId: m}, vetos: [simbolo], fuente: 'llm'|'defecto' }, mesas?)
//   directiva(d, mesas?)  (una directiva del Megáfono, §6.5)
//     mesas: [{ id, nombre }] opcional; con ella se escribe el nombre de la mesa
//     («Reversión RSI») en vez de su id («reversion», «lab3»).
//   respuestaMegafono(d, { a?, mesas? })  (el agente afectado contesta al humano)
//   leccion({ mesaId, mesa?, etiqueta, categoria, pnl, barras, leccion, a? })
//   hipotesis({ id, familia, marco, universo, filtros, origen })
//   resultadoHipotesis({ id, aprobada, criterios: [{ nombre, valor, umbral, ok, comparacion? }] })
//   contratacion({ nombre, familia, peso, universo })
//   despido({ nombre, motivo })
//   informeDiario({ dia, desde?, hasta?, patrimonio, pnlDia, pnlDiaPct, operaciones, acierto, gastoLLMUsd })
//     desde/hasta (ms): tramo que cubre el cierre; si no dura 24 h (±30 min),
//     se escribe el tramo en vez del día. gastoLLMUsd null: no se dice.
//   informeSemanal({ rentabilidad, sharpe90Fondo, sharpe90SinComite, sharpe90Btc })
//   descanso({ minutos })
//   killSwitch({ motivo })
//   soloCerrar({ motivo, hasta })
//   reabrir({ quien, patrimonio?, pico? })  (con las dos cifras, dice cuánto
//     acumula el fondo desde su máximo histórico)
//   conciliacion({ acciones: [{ tipo, simbolo }], grave })
//   Reuniones (§6.9): reunion.<turno>(datos), ver más abajo.

const f = require('../util/formato');

// Tope de una frase. Dos frases cortas en llano no caben en 140; el feed las
// enseña enteras y el bocadillo del parqué corta a tres líneas por su cuenta.
const MAX = 220;
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Una frase: espacios normalizados y, como mucho, `max` caracteres. Se corta
// por un separador, nunca a mitad de un número: «54…» se leería como cifra.
function frase(texto, max = MAX) {
  const s = String(texto).replace(/\s+/g, ' ').trim()
    .replace(/\ba el activo\b/g, 'al activo').replace(/\bde el activo\b/g, 'del activo');
  if (s.length <= max) return s;
  const corte = s.slice(0, max - 1);
  let i = Math.max(corte.lastIndexOf('; '), corte.lastIndexOf(', '), corte.lastIndexOf('. '));
  if (i < max * 0.5) i = corte.lastIndexOf(' ');
  const base = i > 0 ? corte.slice(0, i) : corte;
  return base.replace(/[\s;,.:(–-]+$/, '') + '…';
}

// Frase obligatoria + las opcionales que quepan enteras (una opcional no se
// corta a medias: o entra o no se dice).
function juntar(obligatoria, opcionales = [], max = MAX) {
  let s = String(obligatoria).replace(/\s+/g, ' ').trim();
  for (const o of opcionales) {
    if (!o) continue;
    const x = `${s} ${String(o).replace(/\s+/g, ' ').trim()}`;
    if (x.length <= max) s = x;
  }
  return frase(s, max);
}

// Texto opcional: nunca «undefined» ni «null».
const t = (x, porDefecto = '—') => (x === null || x === undefined || x === '' || (typeof x === 'number' && !Number.isFinite(x)) ? porDefecto : String(x));
const fin = x => typeof x === 'number' && Number.isFinite(x);
const etq = x => t(x && String(x).includes('/') ? String(x).split('/')[0] : x, 'el activo');
const mayuscula = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const minuscula = s => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
// Un precio con su moneda: «2.560 $», «0,1234 $».
const px = x => (fin(x) ? `${f.precio(x)} $` : '—');
const plural = (n, uno, varios) => (n === 1 ? uno : varios);

// Nombre de pila de un nombre completo («Lucía García» → «Lucía»).
function pila(nombre) {
  const s = String(nombre || '').trim();
  return s ? s.split(/\s+/)[0] : '';
}

// «Lucía, » delante de una frase dirigida a alguien (o nada).
function aQuien(a) {
  const p = Array.isArray(a) ? a.map(pila).filter(Boolean) : [pila(a)].filter(Boolean);
  if (!p.length) return '';
  return p.length === 1 ? p[0] : `${p.slice(0, -1).join(', ')} y ${p[p.length - 1]}`;
}
const dirigida = (a, resto) => {
  const q = aQuien(a);
  return q ? `${q}, ${minuscula(resto)}` : mayuscula(resto);
};

const MARCO_LARGO = { '1Hour': '1 hora', '4Hour': '4 horas', '1Day': '1 día' };
const marcoLargo = m => MARCO_LARGO[m] || t(m, '');

// Lo que quiere decir cada modo del comité y cada régimen de Macro.
const MODO_TEXTO = Object.freeze({
  NORMAL: 'compras a tamaño normal',
  DEFENSIVO: 'compras nuevas a la mitad',
  SOLO_CERRAR: 'no se abre nada, solo se cierra',
});
const REGIMEN_TEXTO = Object.freeze({
  'RISK-ON': 'el mercado acompaña',
  NEUTRAL: 'ni a favor ni en contra',
  'RISK-OFF': 'el mercado tiene miedo',
});
const NIVEL_TEXTO = Object.freeze({ normal: 'normal', solo_cerrar: 'solo cerrar', pausado: 'en pausa', bloqueado: 'bloqueado' });

// Por qué salió mal (o bien) una operación, en llano (post-mortem, §6.6).
const CATEGORIA_TEXTO = Object.freeze({
  señal_falsa: 'la señal no se confirmó',
  stop_estrecho: 'el stop estaba demasiado cerca',
  contra_regimen: 'se compró con el mercado en contra',
  noticia: 'la movió una noticia',
  ejecucion: 'se perdió al ejecutar la orden',
  acierto_de_libro: 'salió como dice el manual',
  suerte: 'salió bien, pero por suerte',
});

const MOTIVO_SALIDA = Object.freeze({
  señal: 'con la señal de venta de mi estrategia',
  stop: 'porque saltó el stop',
  kill: 'por el kill switch',
  riesgo: 'por decisión de riesgo',
  manual: 'a mano',
  prueba: 'en la prueba',
  fin: 'al final de la prueba',
});

// Nombre de una mesa para el humano: el de la lista si está, si no su id.
function nombreMesa(id, mesas) {
  const m = Array.isArray(mesas) ? mesas.find(x => x && x.id === id) : null;
  return t((m && m.nombre) || id);
}

// «02-jun 00:05» en UTC (el día de los cierres es el día UTC).
function momentoUTC(ms) {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}-${MESES[d.getUTCMonth()]} ${hh}:${mm}`;
}

// «a, b y c»; con más de `max`, «a, b y 3 más».
function lista(xs, max = 4) {
  const v = (xs || []).map(x => t(x, '')).filter(Boolean);
  if (!v.length) return '';
  if (v.length > max) return `${v.slice(0, max).join(', ')} y ${v.length - max} más`;
  return v.length === 1 ? v[0] : `${v.slice(0, -1).join(', ')} y ${v[v.length - 1]}`;
}

const signoPuntos = p => (fin(p) ? (p > 0 ? `+${p}` : String(p).replace('-', '−')) : '—');
const puntosTexto = p => `${signoPuntos(p)} ${Math.abs(p) === 1 ? 'punto' : 'puntos'}`;

// ---------- Puestos y analistas ----------

function estadoPuesto({ etiqueta, marco, posicion, estadoEstrategia } = {}) {
  const e = etq(etiqueta);
  if (!posicion || !(posicion.cantidad > 0)) {
    // La estrategia ya escribe su espera con cifras (§4.3): se respeta.
    if (estadoEstrategia) return frase(estadoEstrategia);
    const m = marcoLargo(marco);
    return frase(`No tengo ${e}. Espero una señal de mi estrategia${m ? ` (velas de ${m})` : ''}.`);
  }
  const voy = fin(posicion.pnlAbiertoPct) ? `; voy ${f.pct(posicion.pnlAbiertoPct, { signo: true })}` : '';
  const stop = fin(posicion.stop) ? ` Si cae a ${px(posicion.stop)}, vendo (stop).` : '';
  return frase(`Tengo ${f.cantidad(posicion.cantidad)} ${e} comprados a ${px(posicion.entrada)}${voy}.${stop}`);
}

const SESGO_TEXTO = Object.freeze({
  alcista: ' y sigue en subida',
  bajista: ' y sigue de bajada',
  neutral: ', sin una dirección clara',
});

// «Ethereum vale 2.560 $ y sigue en subida: está por encima de su precio medio
// de los últimos 50 días (2.480 $). Ojo: ha subido muy deprisa (RSI 71 de 100)
// y podría tomarse un respiro.» La SMA50 es diaria y el RSI, de velas de 4 h.
function notaAnalista({ etiqueta, nombre, precio, sesgo, sma50, rsi, volAnual, marco = '4Hour' } = {}) {
  const quien = t(nombre, '') || etq(etiqueta);
  if (!fin(precio)) return frase(`${quien}: ahora mismo no tengo su precio, así que no opino.`);
  const media = fin(sma50) ? `: está por ${precio >= sma50 ? 'encima' : 'debajo'} de su precio medio de los últimos 50 días (${px(sma50)})` : '';
  const cabeza = `${quien} vale ${px(precio)}${SESGO_TEXTO[sesgo] || ', aún sin datos para ver su tendencia'}${media}.`;
  let ritmo = null;
  if (fin(rsi)) {
    const r = `RSI ${f.numero(rsi, 0)} de 100`;
    if (rsi >= 70) ritmo = `Ojo: ha subido muy deprisa (${r}) y podría tomarse un respiro.`;
    else if (rsi <= 30) ritmo = `Ojo: ha caído muy deprisa (${r}) y podría rebotar.`;
    else ritmo = `Sube y baja a un ritmo normal (${r}, velas de ${marcoLargo(marco)}).`;
  }
  const vol = fin(volAnual) ? `Se mueve un ${f.pct(volAnual, { decimales: 0 })} al año (volatilidad de 30 días).` : null;
  return juntar(cabeza, [ritmo, vol]);
}

// Una razón llana por componente del régimen (src/mercado/regimen.js).
function razonComponente(c) {
  if (!c || !fin(c.puntos)) return null;
  const p = c.puntos;
  switch (c.nombre) {
    case 'btc_sobre_sma200':
      if (p === 0) return 'faltan datos del bitcoin';
      return `el bitcoin (${px(c.valor)}) va por ${p > 0 ? 'encima' : 'debajo'} de su media de 200 días (${px(c.referencia)})`;
    case 'btc_sma50_sobre_sma200':
      return p === 0 ? null : `su tendencia de fondo es ${p > 0 ? 'al alza' : 'a la baja'}`;
    case 'btc_vol30':
      return p < 0 ? `se mueve muy bruscamente (volatilidad ${f.pct(c.valor, { decimales: 0 })})` : null;
    case 'spy_sobre_sma200':
      if (p === 0) return null;
      return `la bolsa de EE. UU. (SPY) va por ${p > 0 ? 'encima' : 'debajo'} de su media de 200 días`;
    case 'vixy_sobre_sma50':
      return p < 0 ? 'el miedo en bolsa sube (VIXY por encima de su media de 50 sesiones)' : null;
    default:
      return null;
  }
}

function regimen({ valor, puntos, anterior, detalle, componentes } = {}) {
  const v = t(valor, 'NEUTRAL');
  const que = REGIMEN_TEXTO[v] || 'sin lectura clara';
  const cabeza = anterior && anterior !== v
    ? `Cambia el ambiente del mercado: de ${anterior} a ${v} (${puntosTexto(puntos)}), ${que}.`
    : `Ambiente del mercado: ${v} (${puntosTexto(puntos)}), ${que}.`;
  if (Array.isArray(componentes)) {
    const razones = componentes.map(razonComponente).filter(Boolean);
    if (!razones.length) return frase(cabeza);
    // Las razones entran una a una mientras quepan.
    let s = cabeza;
    for (let i = 0; i < razones.length; i++) {
      const x = i === 0 ? `${cabeza} Motivos: ${razones[0]}` : `${s}; ${razones[i]}`;
      if (x.length + 1 > MAX) break;
      s = x;
    }
    return frase(s === cabeza ? s : `${s}.`);
  }
  // Sin componentes, el detalle de calcularRegimen sin su «VALOR (±n):» del principio.
  const d = detalle ? String(detalle).replace(/^[A-Z-]+\s*\([^)]*\):\s*/, '') : '';
  return frase(d ? `${cabeza} Detalle: ${d}` : cabeza);
}

// ---------- Una operación: propuesta → Riesgos → Ejecutor → cierre ----------

// `factor` (opcional): el factor de tamaño ya aplicado (mesas.tamanoApertura),
// { total, comite, mesa, megafono, caida }; si recorta, se dice de dónde viene.
function propuesta({ etiqueta, lado = 'compra', nocional, cantidad, precio, stop, factor, a } = {}) {
  const e = etq(etiqueta);
  if (lado === 'venta') return frase(dirigida(a, `quiero vender mis ${f.cantidad(cantidad)} ${e} a ${px(precio)}.`));
  const s = fin(stop) ? ` Si cae a ${px(stop)}, salgo (stop).` : '';
  let tam = '';
  if (factor && fin(factor.total) && factor.total < 1) {
    const causas = [
      factor.comite < 1 && 'el modo DEFENSIVO',
      factor.mesa < 1 && `mi mesa a ${f.factor(factor.mesa)}`,
      factor.megafono < 1 && 'el Megáfono',
      factor.caida < 1 && 'la caída del fondo',
    ].filter(Boolean);
    tam = ` Voy a ${f.factor(factor.total)} del tamaño normal${causas.length ? ` por ${lista(causas)}` : ''}.`;
  }
  return frase(dirigida(a, `quiero comprar ${f.usd(nocional)} de ${e} a ${px(precio)}.${s}${tam}`));
}

function aprobacion({ etiqueta, lado = 'compra', tipo, decision = 'aprobar', nocional, nocionalPedido, cantidad, motivos, a } = {}) {
  const e = etq(etiqueta);
  if (lado === 'venta') {
    if (tipo === 'stop') return frase(dirigida(a, `ha saltado el stop de ${e}: adelante con la venta de ${f.cantidad(cantidad)} ${e}.`));
    return frase(dirigida(a, `adelante con la venta de ${f.cantidad(cantidad)} ${e}.`));
  }
  if (decision === 'reducir' || (fin(nocionalPedido) && fin(nocional) && nocional < nocionalPedido)) {
    const m = motivos && motivos[0] && motivos[0].texto ? ` Motivo: ${motivos[0].texto}` : '';
    return frase(dirigida(a, `te la recorto: ${f.usd(nocional)} de ${e} en vez de ${f.usd(nocionalPedido)}.${m}`));
  }
  return frase(dirigida(a, `aprobado: ${f.usd(nocional)} de ${e}, dentro de los límites.`));
}

function veto({ etiqueta, lado = 'compra', motivos, a } = {}) {
  const ms = (motivos || []).filter(m => m && m.texto);
  const primero = String(ms.length ? ms[0].texto : 'se sale de los límites').replace(/[.\s]+$/, '');
  const n = ms.length - 1;
  const mas = n > 0 ? ` (y ${f.numero(n)} ${plural(n, 'motivo', 'motivos')} más)` : '';
  return frase(dirigida(a, `no puedo aprobar la ${lado === 'venta' ? 'venta' : 'compra'} de ${etq(etiqueta)}: ${primero}${mas}.`));
}

// El Ejecutor recibe la orden aprobada y la manda al bróker.
function orden({ etiqueta, lado = 'compra', tipo, nocional, cantidad, a } = {}) {
  const e = etq(etiqueta);
  const q = aQuien(a);
  const recibido = q ? `Recibido, ${q}: ` : 'Recibido: ';
  const cant = f.cantidad(cantidad, 8);
  if (tipo === 'kill') return frase(`Kill switch: vendo ${cant} ${e} a precio de mercado.`);
  if (tipo === 'prueba') {
    return frase(lado === 'compra' ? `Orden de prueba: compro ${f.usd(nocional)} de ${e} a precio de mercado.` : `Orden de prueba: vendo ${cant} ${e} a precio de mercado.`);
  }
  if (lado === 'compra') return frase(`${recibido}mando al bróker la compra de ${f.usd(nocional)} de ${e} a precio de mercado.`);
  if (tipo === 'stop') return frase(`${recibido}vendo ${cant} ${e} a precio de mercado por el stop.`);
  return frase(`${recibido}mando al bróker la venta de ${cant} ${e} a precio de mercado.`);
}

function ejecucion({ etiqueta, lado = 'compra', cantidad, precio, nocional, comision, a } = {}) {
  const importe = fin(nocional) ? nocional : (fin(cantidad) && fin(precio) ? cantidad * precio : null);
  const com = fin(comision) ? ` Comisión: ${f.usd(comision)}.` : '';
  const q = aQuien(a);
  const hecho = q ? `${q}, hecho` : 'Hecho';
  return frase(`${hecho}: he ${lado === 'venta' ? 'vendido' : 'comprado'} ${f.cantidad(cantidad)} ${etq(etiqueta)} a ${px(precio)} (${f.usd(importe)}).${com}`);
}

function cierre({ etiqueta, pnl, pnlPct, motivoSalida, barras, rMultiple } = {}) {
  const motivo = MOTIVO_SALIDA[motivoSalida] || '';
  const velas = fin(barras) ? ` en ${f.numero(barras)} ${plural(barras, 'vela', 'velas')}` : '';
  const pct = fin(pnlPct) ? ` (${f.pct(pnlPct, { signo: true })})` : '';
  let resultado;
  if (!fin(pnl)) resultado = 'resultado —';
  else if (Math.abs(pnl) < 0.005) resultado = `ni gano ni pierdo (${f.usd(pnl)})`;
  else resultado = `${pnl > 0 ? 'gano' : 'pierdo'} ${f.usd(Math.abs(pnl))}`;
  const cabeza = `He cerrado ${etq(etiqueta)}${motivo ? ` ${motivo}` : ''}: ${resultado}${pct}${velas}.`;
  const r = fin(rMultiple) && fin(pnl) && Math.abs(pnl) >= 0.005
    ? `${mayuscula(pnl > 0 ? 'gano' : 'pierdo')} ${f.numero(Math.abs(rMultiple), 1)} veces lo que arriesgaba.`
    : null;
  return juntar(cabeza, [r]);
}

function stopSaltado({ etiqueta, precio, stop } = {}) {
  return frase(`${etq(etiqueta)} ha caído a ${px(precio)} y ha tocado mi stop (${px(stop)}): vendo ya a precio de mercado.`);
}

// ---------- Comité: un informe por jefe (§6.8) ----------

const INFORMES = {
  controller({ patrimonio, pnlDia, pnlDiaPct, caida, exposicionBrutaPct, posiciones } = {}) {
    const bajo = fin(caida) && Math.abs(caida) < 0.00005
      ? 'Estamos en el máximo del fondo'
      : `Estamos un ${f.pct(fin(caida) ? Math.abs(caida) : caida)} por debajo del máximo`;
    const n = fin(posiciones) ? posiciones : null;
    return frase(`El fondo vale ${f.usd(patrimonio)}. Hoy vamos ${f.usd(pnlDia, { signo: true })} (${f.pct(pnlDiaPct, { signo: true })}). `
      + `${bajo} y tenemos invertido el ${f.pct(exposicionBrutaPct, { decimales: 0 })} en ${f.numero(n)} ${plural(n, 'posición', 'posiciones')}.`);
  },
  macro({ regimen: valor, puntos, voto } = {}) {
    const v = t(valor, 'NEUTRAL');
    const vt = t(voto, 'NORMAL');
    return frase(`El mercado está ${v} (${puntosTexto(puntos)}): ${REGIMEN_TEXTO[v] || 'sin lectura clara'}. Mi voto: ${vt} (${MODO_TEXTO[vt] || 'sin cambios'}).`);
  },
  // El voto va antes que lo que vigila: con un saludo delante y dos límites
  // cerca, lo que no cabe es lo vigilado, nunca el voto.
  riesgos({ nivel, vetos, cercanos, voto, anterior } = {}) {
    const n = fin(vetos) ? vetos : 0;
    const vt = t(voto, 'NORMAL');
    const vetado = n === 0 ? 'no he vetado ninguna orden' : `he vetado ${f.numero(n)} ${plural(n, 'orden', 'órdenes')}`;
    const veto = vt !== 'NORMAL' ? ' y es veto' : '';
    const base = `El fondo está en nivel ${NIVEL_TEXTO[nivel] || t(nivel, 'normal')} y ${vetado} desde el último comité. Mi voto: ${vt} (${MODO_TEXTO[vt] || 'sin cambios'})${veto}.`;
    const cs = (cercanos || []).filter(Boolean);
    const cabeza = saludarTexto(anterior, base);
    if (!cs.length) return frase(cabeza);
    const todos = `${cabeza} Vigilo de cerca: ${lista(cs, 2)}.`;
    if (todos.length <= MAX) return frase(todos);
    const uno = `${cabeza} Vigilo de cerca: ${cs[0]}.`;
    return frase(uno.length <= MAX ? uno : cabeza);
  },
  mesas({ mejor, peor } = {}) {
    if (!mejor && !peor) return frase('En las mesas, nada que contar: ninguna se ha movido desde el último comité.');
    if (mejor && !peor) return frase(`En las mesas, desde el último comité solo se ha movido ${t(mejor.nombre)}: ${f.usd(mejor.pnl, { signo: true })}.`);
    const m = mejor ? `la que mejor va desde el último comité es ${t(mejor.nombre)} (${f.usd(mejor.pnl, { signo: true })})` : '';
    const p = peor ? `${m ? ' y ' : ''}la que peor, ${t(peor.nombre)} (${f.usd(peor.pnl, { signo: true })})` : '';
    return frase(`En las mesas, ${m}${p}.`);
  },
  laboratorio({ enCurso, aprobadas, ensayos } = {}) {
    const e = fin(enCurso) ? enCurso : 0;
    const ap = fin(aprobadas) ? aprobadas : 0;
    const en = fin(ensayos) ? ensayos : 0;
    return frase(`En el laboratorio tengo ${f.numero(e)} ${plural(e, 'idea', 'ideas')} en prueba y ${f.numero(ap)} ${plural(ap, 'aprobada', 'aprobadas')}; `
      + `llevamos ${f.numero(en)} ${plural(en, 'ensayo', 'ensayos')}.`);
  },
  megafono({ vigentes, pendientes } = {}) {
    const v = fin(vigentes) ? vigentes : 0;
    const p = fin(pendientes) ? pendientes : 0;
    return frase(`Megáfono: ${v === 0 ? 'no hay órdenes vigentes' : `${f.numero(v)} ${plural(v, 'orden vigente', 'órdenes vigentes')}`} `
      + `y ${p === 0 ? 'nada pendiente de aplicar' : `${f.numero(p)} ${plural(p, 'pendiente', 'pendientes')} de aplicar`}.`);
  },
};

// Cada jefe empieza su turno dirigiéndose a quien habló antes.
const ENTRADA_TURNO = Object.freeze({ macro: 'Por mi parte: ', mesas: '', laboratorio: '', megafono: 'Y por último, el ' });

function informeComite(jefe, datos) {
  const fn = INFORMES[jefe];
  if (!fn) return frase(`Sin informe de ${t(jefe, 'este punto')}.`);
  const d = datos || {};
  // Riesgos se saluda sola: decide ella qué recorta si no cabe.
  if (jefe === 'riesgos') return fn(d);
  const base = fn(d);
  const antes = pila(d.anterior);
  if (!antes) return base;
  const entrada = ENTRADA_TURNO[jefe] || '';
  return frase(`Gracias, ${antes}. ${entrada}${entrada ? minuscula(base) : base}`);
}
for (const [jefe] of Object.entries(INFORMES)) informeComite[jefe] = datos => informeComite(jefe, datos);

function aperturaComite({ hora, motivo, primero } = {}) {
  const p = pila(primero);
  return frase(`Abro el comité de las ${t(hora)}${motivo === 'demanda' ? ' (convocado a demanda)' : ''}. Orden del día: siete puntos.${p ? ` ${p}, empiezas tú.` : ''}`);
}

function decisionComite({ modo, multiplicadores, vetos, fuente } = {}, mesas = null) {
  const porValor = { 0: [], 0.5: [] };
  for (const [id, m] of Object.entries(multiplicadores || {})) if (m === 0 || m === 0.5) porValor[m].push(nombreMesa(id, mesas));
  const md = t(modo, 'NORMAL');
  // De más a menos grave, con el modo en la cabeza: con nombres de mesa
  // largos, lo que se recorta es lo último, las mesas a la mitad.
  const partes = [`Decido: modo ${md} (${MODO_TEXTO[md] || 'sin cambios'})${fuente === 'defecto' ? ', el plan por defecto' : ''}.`];
  if (porValor[0].length) partes.push(`Paro ${plural(porValor[0].length, 'la mesa', 'las mesas')} ${lista(porValor[0], 3)}.`);
  if (vetos && vetos.length) partes.push(`No se abre en ${lista(vetos.map(etq), 3)} durante 24 h.`);
  if (porValor[0.5].length) partes.push(`A la mitad: ${lista(porValor[0.5], 3)}.`);
  return frase(partes.join(' '));
}

function directiva(d = {}, mesas = null) {
  d = d || {};
  const h = fin(d.horas) ? ` durante ${f.numero(d.horas)} h` : '';
  switch (d.tipo) {
    case 'reducir_riesgo': return frase(`Reducir el tamaño de las entradas al ${f.pct(d.factor, { decimales: 0 })}${h}.`);
    case 'pausar_activo': return frase(`No abrir en ${etq(d.simbolo)}${h}.`);
    case 'pausar_mesa': return frase(`Pausar la mesa ${nombreMesa(d.mesaId, mesas)}${h}.`);
    case 'solo_cerrar': return frase(`Solo cerrar posiciones, sin abrir nada${h}.`);
    case 'reanudar_activo': return frase(`Quitar la pausa del Megáfono en ${etq(d.simbolo)}.`);
    case 'reanudar_mesa': return frase(`Quitar la pausa del Megáfono a la mesa ${nombreMesa(d.mesaId, mesas)}.`);
    case 'sin_efecto': return frase(`Sin efecto: ${t(d.motivo, 'no hay nada que aplicar')}.`.replace(/\.\.$/, '.'));
    default: return frase('Directiva desconocida: no se aplica.');
  }
}

// El agente al que le toca una directiva del Megáfono contesta al humano.
function respuestaMegafono(d = {}, { mesas = null, a = null } = {}) {
  d = d || {};
  const h = fin(d.horas) ? ` durante ${f.numero(d.horas)} h` : '';
  const q = aQuien(a);
  const entendido = q ? `Entendido, ${q}` : 'Entendido';
  switch (d.tipo) {
    case 'reducir_riesgo': return frase(`${entendido}: recorto cada compra nueva al ${f.pct(d.factor, { decimales: 0 })} de su tamaño${h}.`);
    case 'pausar_activo': return frase(`${entendido}: no abro nada en ${etq(d.simbolo)}${h}. Lo que ya tengo sigue con su stop.`);
    case 'pausar_mesa': return frase(`${entendido}: la mesa ${nombreMesa(d.mesaId, mesas)} no abre nada${h}. Lo que tenemos abierto sigue con su stop.`);
    case 'solo_cerrar': return frase(`${entendido}: no se abre nada${h}; solo cerramos lo que toque.`);
    case 'reanudar_activo': return frase(`${entendido}: vuelvo a poder abrir en ${etq(d.simbolo)} cuando lo diga la estrategia.`);
    case 'reanudar_mesa': return frase(`${entendido}: la mesa ${nombreMesa(d.mesaId, mesas)} vuelve a abrir cuando lo diga su estrategia.`);
    default: return frase(`${entendido}.`);
  }
}

// ---------- Auditor y laboratorio ----------

// Con la lección escrita (reglas o LLM), la lección ya dice el porqué; sin
// ella, la categoría y el resultado.
function leccion({ mesaId, mesa, etiqueta, categoria, pnl, barras, leccion: texto, a } = {}) {
  const cat = CATEGORIA_TEXTO[categoria] || t(categoria, 'sin categoría');
  const donde = t(mesa, '') || t(mesaId, '');
  const sobre = `sobre ${a ? 'tu' : 'la'} operación en ${etq(etiqueta)}${donde ? ` (${donde})` : ''}`;
  if (texto) return frase(dirigida(a, `${sobre}: ${texto}`));
  const velas = fin(barras) ? ` en ${f.numero(barras)} ${plural(barras, 'vela', 'velas')}` : '';
  return frase(dirigida(a, `${sobre}: ${cat}. Resultado: ${f.usd(pnl, { signo: true })}${velas}.`));
}

function hipotesis({ id, familia, marco, universo, filtros, origen } = {}) {
  const u = lista((universo || []).map(etq), 3);
  const fil = filtros && filtros.length ? `, con ${plural(filtros.length, 'el filtro', 'los filtros')} ${lista(filtros.map(x => (x && x.id) || x), 2)}` : '';
  const o = origen === 'leccion' ? 'una lección del Auditor' : origen === 'exploracion' ? 'explorar variantes' : t(origen, '—');
  const m = marcoLargo(marco);
  return frase(`Nueva idea a probar (${t(id)}): ${t(familia)}${m ? ` con velas de ${m}` : ''}${u ? ` en ${u}` : ''}${fil}. Sale de ${o}.`);
}

const COMPARACION_TEXTO = Object.freeze({ '≥': 'al menos', '≤': 'como mucho', '<': 'menos de' });

function resultadoHipotesis({ id, aprobada, criterios } = {}) {
  const cs = criterios || [];
  const ok = cs.filter(c => c && c.ok).length;
  const examenes = `${f.numero(ok)} de ${f.numero(cs.length)} ${plural(cs.length, 'examen', 'exámenes')}`;
  if (aprobada) return frase(`La idea ${t(id)} aprueba: pasa ${examenes}. Empieza en prueba con poco dinero.`);
  const falla = cs.find(c => c && !c.ok);
  const num = x => (fin(x) ? f.numero(x, 2) : t(x));
  const detalle = falla
    ? ` Falla «${t(falla.nombre)}»: saca ${num(falla.valor)} y hace falta ${COMPARACION_TEXTO[falla.comparacion] || 'llegar a'} ${num(falla.umbral)}.`
    : '';
  return frase(`La idea ${t(id)} no pasa: ${examenes}.${detalle}`);
}

function contratacion({ nombre, familia, peso, universo } = {}) {
  const u = universo && universo.length ? ` en ${lista(universo.map(etq), 3)}` : '';
  return frase(`Contrato la mesa ${t(nombre)} (${t(familia)})${u}: empieza en prueba con el ${f.pct(peso, { decimales: 0 })} del capital.`);
}

// Con peso 0, la sombra de la mesa dimensiona con 0 $ y ya no abre nada: lo
// que tenga abierto en sombra solo se cierra por su regla. Lo que pasa de
// verdad va delante, para que un motivo largo no lo corte.
function despido({ nombre, motivo } = {}) {
  const m = String(t(motivo, 'resultados por debajo del umbral')).replace(/[.\s]+$/, '');
  return frase(`Mando al banquillo la mesa ${t(nombre)}: cierra sus posiciones y no abre nada nuevo, ni en sombra. Motivo: ${m}.`);
}

// ---------- Informes, sistema y fondo ----------

function informeDiario({ dia, desde, hasta, patrimonio, pnlDia, pnlDiaPct, operaciones, acierto, gastoLLMUsd } = {}) {
  const ac = fin(acierto) ? `, acierto ${f.pct(acierto, { decimales: 0 })}` : '';
  const llm = fin(gastoLLMUsd) ? ` Gasto en IA: ${f.usd(gastoLLMUsd)}.` : '';
  const n = fin(operaciones) ? operaciones : 0;
  // Un cierre que llega tarde (portátil apagado a las 00:05) cubre más de un
  // día: se dice el tramo real en vez de ponerle la fecha de un solo día.
  const tramo = fin(desde) && fin(hasta) && hasta > desde && Math.abs(hasta - desde - DIA) > 30 * MIN
    ? `Cierre (${momentoUTC(desde)} → ${momentoUTC(hasta)} UTC, ${f.numero(Math.round((hasta - desde) / HORA))} h)`
    : `Cierre del día ${t(dia)}`;
  return frase(`${tramo}: el fondo vale ${f.usd(patrimonio)} (${f.usd(pnlDia, { signo: true })}, ${f.pct(pnlDiaPct, { signo: true })}). `
    + `${f.numero(n)} ${plural(n, 'operación cerrada', 'operaciones cerradas')}${ac}.${llm}`);
}

function informeSemanal({ rentabilidad, sharpe90Fondo, sharpe90SinComite, sharpe90Btc } = {}) {
  const s = x => (fin(x) ? f.numero(x, 2) : '—');
  return frase(`Esta semana el fondo va ${f.pct(rentabilidad, { signo: true })}. Rentabilidad por riesgo (Sharpe, 90 días): `
    + `fondo ${s(sharpe90Fondo)}; sin comité ${s(sharpe90SinComite)}; bitcoin ${s(sharpe90Btc)}.`);
}

function descanso({ minutos = 15 } = {}) {
  return frase(`No tengo nada pendiente: me tomo ${f.numero(fin(minutos) ? minutos : 15)} min en la sala de descanso.`);
}

function killSwitch({ motivo } = {}) {
  return frase(`Freno de emergencia (kill switch): ${t(motivo, 'límite duro')}. Vendo todo y bloqueo el fondo hasta que alguien pulse Reabrir.`);
}

function soloCerrar({ motivo, hasta } = {}) {
  const h = fin(hasta) ? `hasta las ${f.hora(hasta)}` : 'hasta nueva orden';
  return frase(`Solo cerramos, no se abre nada ${h}: ${t(motivo, 'límite de pérdida')}.`);
}

// Reabrir no borra el máximo histórico: el mensaje dice con cifras cuánto
// acumula el fondo desde él (el vigilante mide aparte desde la reapertura).
function reabrir({ quien, patrimonio, pico } = {}) {
  const q = t(quien, 'un humano');
  if (!fin(patrimonio) || !fin(pico) || !(pico > 0)) return frase(`Reabierto por ${q}. Conciliación limpia; vuelta a nivel normal.`);
  const maximo = Math.max(pico, patrimonio);
  const perdida = maximo - patrimonio;
  const cabeza = `Reabierto por ${q}.`;
  if (perdida < 0.005) return frase(`${cabeza} El fondo está en su máximo histórico (${f.usd(maximo)}).`);
  return frase(`${cabeza} El fondo sigue un ${f.pct(perdida / maximo)} (${f.usd(perdida)}) por debajo de su máximo histórico (${f.usd(maximo)}).`);
}

function conciliacion({ acciones, grave } = {}) {
  const as = acciones || [];
  if (!as.length) return frase('He comparado nuestras cuentas con las del bróker: cuadran.');
  const cuenta = tipo => as.filter(a => a && a.tipo === tipo);
  const partes = [];
  const esc = cuenta('escalar');
  const hue = cuenta('huerfana');
  const fan = cuenta('fantasma');
  const etqs = xs => lista(xs.map(a => etq(a.simbolo)), 2);
  if (esc.length) partes.push(`${f.numero(esc.length)} ${plural(esc.length, 'ajuste pequeño', 'ajustes pequeños')} por comisión (${etqs(esc)})`);
  if (hue.length) partes.push(`${f.numero(hue.length)} ${plural(hue.length, 'posición', 'posiciones')} en el bróker que no es de ninguna mesa (${etqs(hue)})`);
  if (fan.length) partes.push(`${f.numero(fan.length)} ${plural(fan.length, 'posición', 'posiciones')} en nuestros libros que el bróker no tiene (${etqs(fan)})`);
  return frase(`Cuentas con el bróker: ${partes.join('; ') || `${f.numero(as.length)} diferencias`}.${grave ? ' Es grave: solo cerramos hasta aclararlo.' : ''}`);
}

// ---------- Reuniones informativas (§6.9: 9:00 y 22:15 de Madrid) ----------
// Solo cuentan: no cambian modo, multiplicadores ni vetos (eso es del comité).

const reunion = {
  apertura({ tipo, hora, primero } = {}) {
    const p = pila(primero);
    const que = tipo === 'cierre'
      ? `Empezamos el cierre del día de las ${t(hora)}: resultado, operaciones cerradas y lo que queda abierto.`
      : `Buenos días. Empezamos la reunión de las ${t(hora)}: cómo fue la noche, el mercado, los riesgos y las posiciones.`;
    return frase(`${que}${p ? ` ${p}, empiezas tú.` : ''} Es informativa: no cambia nada del fondo.`);
  },
  // Controller por la mañana: desde el cierre del día anterior (o el tramo que haya).
  // `cambio` y `cambioPct` los calcula quien convoca (reuniones.js): la plantilla solo los dice.
  noche({ patrimonio, cambio, cambioPct, desdeHora, operaciones, pnlOperaciones, anterior } = {}) {
    const hay = fin(patrimonio) && fin(cambio);
    const pct = cambioPct;
    const desde = desdeHora ? ` desde las ${desdeHora}` : '';
    const n = fin(operaciones) ? operaciones : 0;
    const ops = n === 0
      ? 'Esta noche no se ha cerrado ninguna operación.'
      : `Se ${plural(n, 'ha cerrado', 'han cerrado')} ${f.numero(n)} ${plural(n, 'operación', 'operaciones')}, con ${f.usd(pnlOperaciones, { signo: true })} en total.`;
    const cabeza = hay
      ? `El fondo vale ${f.usd(patrimonio)}: ${cambio >= 0 ? 'gana' : 'pierde'} ${f.usd(Math.abs(cambio))} (${f.pct(pct, { signo: true })})${desde}.`
      : `El fondo vale ${f.usd(patrimonio)}.`;
    return saludar(anterior, `${cabeza} ${ops}`);
  },
  macro({ regimen: valor, puntos, fg, anterior } = {}) {
    const v = t(valor, 'NEUTRAL');
    const miedo = fin(fg) ? ` El índice de miedo y codicia está en ${f.numero(fg)} de 100.` : '';
    return saludar(anterior, `El mercado está ${v} (${puntosTexto(puntos)}): ${REGIMEN_TEXTO[v] || 'sin lectura clara'}.${miedo}`);
  },
  riesgos({ nivel, cercanos, vetados, anterior } = {}) {
    const cerca = cercanos && cercanos.length ? `Vigilo de cerca: ${lista(cercanos, 2)}.` : 'Nada cerca de sus límites.';
    const v = vetados && vetados.length ? ` Hoy no se abre en ${lista(vetados.map(etq), 3)}.` : '';
    return saludar(anterior, `El fondo está en nivel ${NIVEL_TEXTO[nivel] || t(nivel, 'normal')}. ${cerca}${v}`);
  },
  // Un operador con posición: qué tiene y su stop.
  posicion({ etiqueta, cantidad, entrada, precio, pnlAbiertoPct, stop } = {}) {
    const voy = fin(pnlAbiertoPct) ? ` y voy ${f.pct(pnlAbiertoPct, { signo: true })}` : '';
    const ahora = fin(precio) ? ` Ahora vale ${px(precio)}${voy}.` : '';
    const s = fin(stop) ? ` Mi stop está en ${px(stop)}.` : ' No tengo stop puesto.';
    return frase(`Tengo ${f.cantidad(cantidad)} ${etq(etiqueta)} comprados a ${px(entrada)}.${ahora}${s}`);
  },
  resumenManana({ patrimonio, posiciones, modo, proximoComite, anterior } = {}) {
    const n = fin(posiciones) ? posiciones : 0;
    const md = t(modo, 'NORMAL');
    const prox = proximoComite ? ` El próximo comité, a las ${proximoComite}.` : '';
    return saludar(anterior, `Resumen: el fondo vale ${f.usd(patrimonio)}, con ${f.numero(n)} ${plural(n, 'posición abierta', 'posiciones abiertas')} y en modo ${md} (${MODO_TEXTO[md] || 'sin cambios'}).${prox} Buen día a todos.`);
  },
  // Controller por la noche: el día del fondo (desde las 00:00 UTC).
  resultadoDia({ patrimonio, pnlDia, pnlDiaPct, desdeHora, anterior } = {}) {
    const desde = desdeHora ? ` (desde las ${desdeHora})` : '';
    const cabeza = !fin(pnlDia)
      ? `El fondo vale ${f.usd(patrimonio)}.`
      : `Hoy${desde} el fondo ${pnlDia >= 0 ? 'gana' : 'pierde'} ${f.usd(Math.abs(pnlDia))} (${f.pct(pnlDiaPct, { signo: true })}) y vale ${f.usd(patrimonio)}.`;
    return saludar(anterior, cabeza);
  },
  cerradas({ operaciones, ganadoras, perdedoras, pnl, mejor, peor, anterior } = {}) {
    const n = fin(operaciones) ? operaciones : 0;
    if (n === 0) return saludar(anterior, 'Hoy no se ha cerrado ninguna operación.');
    const g = fin(ganadoras) ? ganadoras : 0;
    const pe = fin(perdedoras) ? perdedoras : null;
    const base = `Hoy se ${plural(n, 'ha cerrado', 'han cerrado')} ${f.numero(n)} ${plural(n, 'operación', 'operaciones')}: ${f.numero(g)} con ganancia${pe !== null ? ` y ${f.numero(pe)} sin ganancia` : ''}, ${f.usd(pnl, { signo: true })} en total.`;
    const m = mejor ? `La mejor, ${etq(mejor.etiqueta)} (${f.usd(mejor.pnl, { signo: true })})${peor ? `; la peor, ${etq(peor.etiqueta)} (${f.usd(peor.pnl, { signo: true })})` : ''}.` : null;
    return juntar(saludarTexto(anterior, base), [m]);
  },
  abiertas({ posiciones, pnlAbierto, lista: etiquetas, anterior } = {}) {
    const n = fin(posiciones) ? posiciones : 0;
    if (n === 0) return saludar(anterior, 'Esta noche no queda nada abierto: todo en efectivo.');
    return saludar(anterior, `Queda${n === 1 ? '' : 'n'} ${f.numero(n)} ${plural(n, 'posición abierta', 'posiciones abiertas')} (${lista((etiquetas || []).map(etq), 4)}), `
      + `con ${f.usd(pnlAbierto, { signo: true })} sin realizar. Cada una sigue con su stop.`);
  },
  resumenCierre({ patrimonio, pnlDia, modo, anterior } = {}) {
    const md = t(modo, 'NORMAL');
    const dia = fin(pnlDia) ? ` (${f.usd(pnlDia, { signo: true })} hoy)` : '';
    return saludar(anterior, `Cerramos el día con ${f.usd(patrimonio)}${dia}, en modo ${md} (${MODO_TEXTO[md] || 'sin cambios'}). Buenas noches.`);
  },
};

function saludarTexto(anterior, texto) {
  const p = pila(anterior);
  return p ? `Gracias, ${p}. ${texto}` : texto;
}
function saludar(anterior, texto) { return frase(saludarTexto(anterior, texto)); }

module.exports = {
  estadoPuesto, notaAnalista, regimen, propuesta, aprobacion, veto, orden, ejecucion, cierre, stopSaltado,
  informeComite, aperturaComite, decisionComite, directiva, respuestaMegafono, leccion, hipotesis, resultadoHipotesis, contratacion, despido,
  informeDiario, informeSemanal, descanso, killSwitch, soloCerrar, reabrir, conciliacion, reunion,
  frase, juntar, pila, CATEGORIA_TEXTO, MODO_TEXTO, REGIMEN_TEXTO, NIVEL_TEXTO, MAX,
};
