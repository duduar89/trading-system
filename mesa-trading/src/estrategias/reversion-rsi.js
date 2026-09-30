'use strict';
// Reversión RSI(2) (1D): compra caídas cortas dentro de una tendencia alcista.
// Abrir si RSI(2) < umbral y cierre > SMA200; cerrar cuando el cierre supera
// la SMA5 o tras maxBarras velas abiertas. Stop de protección 3 × ATR(14).
// barrasAbierta cuenta los cierres vistos con la posición abierta (la vela de
// entrada cuenta como 1), igual en el motor de backtest y en los libros.

const { sma, rsi, atr, cierres } = require('../mercado/indicadores');
const formato = require('../util/formato');
const c = require('./comun');

const familia = 'reversion-rsi';
const marco = '1Day';
const parametrosPorDefecto = Object.freeze({ rsi: 2, umbral: 10, filtro: 200, salidaSma: 5, maxBarras: 5, atr: 14, atrStop: 3 });

// 3 × 3 × 2 = 18 combinaciones.
const rejilla = Object.freeze({ umbral: [5, 10, 15], salidaSma: [3, 5, 10], maxBarras: [5, 10] });

const dominio = Object.freeze({
  rsi: [2], umbral: rejilla.umbral, filtro: [200], salidaSma: rejilla.salidaSma,
  maxBarras: rejilla.maxBarras, atr: [14], atrStop: c.DOMINIO_ATR_STOP,
});

function completar(params) { return { ...parametrosPorDefecto, ...(params || {}) }; }

function calentamiento(params) {
  const p = completar(params);
  return Math.max(p.filtro, p.salidaSma, p.atr, p.rsi + 1);
}

function preparar(velasPorSimbolo, params) {
  const p = completar(params);
  const simbolos = Object.keys(velasPorSimbolo);
  const porSimbolo = {};
  for (const s of simbolos) {
    const velas = velasPorSimbolo[s];
    const cc = cierres(velas);
    porSimbolo[s] = { c: cc, rsi: rsi(cc, p.rsi), filtro: sma(cc, p.filtro), salida: sma(cc, p.salidaSma), atr: atr(velas, p.atr) };
  }
  return { familia, marco, params: p, velas: velasPorSimbolo, simbolos, porSimbolo, peso: 1 / Math.max(1, simbolos.length) };
}

function decidir(prep, { simbolo, i, posicion = null, contexto = {}, textos = true } = {}) {
  const p = prep.params;
  const s = prep.porSimbolo[simbolo];
  const et = c.etiqueta(simbolo);
  if (!s || i < 0 || i >= s.c.length) return c.senal(posicion ? 'mantener' : 'nada', { estado: textos ? `No tengo datos de ${et} ahora mismo.` : '' });
  const cierre = s.c[i];
  const r = s.rsi[i]; const f = s.filtro[i]; const sal = s.salida[i]; const a = s.atr[i];
  // En llano: «su media de 5 días (142,37 $)»; el RSI, «de 0 a 100».
  const media = (n, v) => `su media de ${c.tramoLlano(n, marco)}${v === undefined ? '' : ` (${c.px(v)})`}`;

  if (posicion) {
    if (sal !== null && cierre > sal) {
      const motivo = textos ? `cierre ${formato.precio(cierre)} > SMA${p.salidaSma} ${formato.precio(sal)}` : '';
      return c.senal('cerrar', { motivo, estado: textos ? `Mi regla dice vender ${et}: el precio (${c.px(cierre)}) ya ha vuelto por encima de ${media(p.salidaSma, sal)}; el rebote está hecho.` : '' });
    }
    const barras = posicion.barrasAbierta || 0;
    if (barras >= p.maxBarras) {
      const motivo = textos ? `${barras} velas abiertas (máx. ${p.maxBarras})` : '';
      return c.senal('cerrar', { motivo, estado: textos ? `Mi regla dice vender ${et}: llevo ${c.tramoLlano(barras, marco)} con la posición y esta mesa no aguanta más de ${c.tramoLlano(p.maxBarras, marco)}.` : '' });
    }
    return c.senal('mantener', {
      peso: prep.peso,
      stop: posicion.stop ?? null,
      motivo: textos && sal !== null ? `cierre ${formato.precio(cierre)} ≤ SMA${p.salidaSma} ${formato.precio(sal)}` : '',
      estado: textos ? `Tengo ${et} desde ${c.px(posicion.entrada)}. Vendo cuando el precio supere ${media(p.salidaSma)} o al cumplir ${c.tramoLlano(p.maxBarras, marco)} (van ${barras}).` : '',
    });
  }

  if (r === null || f === null || a === null) {
    const faltan = calentamiento(p) - 1 - i;
    return c.senal('nada', { estado: textos ? c.calentandoLlano(et, faltan, marco) : '' });
  }
  if (r < p.umbral && cierre > f) {
    const stop = cierre - p.atrStop * a;
    const motivo = textos ? `RSI(${p.rsi}) ${formato.numero(r, 1)} < ${p.umbral}; cierre ${formato.precio(cierre)} > SMA${p.filtro} ${formato.precio(f)}` : '';
    const filtro = c.filtroQueBloquea(prep, simbolo, i, contexto);
    if (filtro) {
      return c.senal('nada', { motivo, estado: textos ? `${et} ha caído muy deprisa (RSI ${formato.numero(r, 1)} de 100) y mi regla daría compra, pero no compro: ${c.bloqueoLlano(filtro, contexto, prep, simbolo, i)}.` : '' });
    }
    return c.senal('abrir', {
      peso: prep.peso, stop, motivo,
      estado: textos ? `Mi regla dice comprar ${et}: ha caído muy deprisa (RSI ${formato.numero(r, 1)} de 100, por debajo de ${p.umbral}) pero sigue sobre ${media(p.filtro, f)}. Espero un rebote. Si cae a ${c.px(stop)}, vendo (stop).` : '',
    });
  }
  return c.senal('nada', {
    motivo: textos ? `RSI(${p.rsi}) ${formato.numero(r, 1)}; cierre ${formato.precio(cierre)} ${cierre > f ? '>' : '≤'} SMA${p.filtro} ${formato.precio(f)}` : '',
    estado: textos ? `No tengo ${et}. Compro tras una caída brusca (RSI por debajo de ${p.umbral} de 100; ahora ${formato.numero(r, 1)}) con el precio sobre ${media(p.filtro)}.` : '',
  });
}

function trailing() { return null; }

// Vecino más lento: umbral más exigente (menos señales, más extremas).
function vecinoMasLento(params) {
  const p = completar(params);
  const u = c.siguienteMenor(rejilla.umbral, p.umbral);
  return u === null ? null : { umbral: u };
}

function describir(params) {
  const p = completar(params);
  return `RSI(${p.rsi}) < ${p.umbral} sobre SMA${p.filtro}; sale sobre SMA${p.salidaSma} o tras ${p.maxBarras} velas; stop ${formato.numero(p.atrStop, 1)}×ATR(${p.atr})`;
}

// En lenguaje llano, con los parámetros de la mesa (§4.3, explicar).
function explicar(params, { universo = [], filtros = [], limites = null } = {}) {
  const p = completar(params);
  const quien = c.activosLlano(universo);
  return {
    queMira: `Mira ${quien} una vez al día. Usa el RSI de ${p.rsi} días (un medidor de 0 a 100 de cuánto ha caído o subido en muy poco tiempo) y la media del precio de ${p.filtro} días.`,
    cuandoCompra: `Compra cuando el RSI baja de ${p.umbral} (ha caído muy deprisa, está «sobrevendido») pero el precio sigue por encima de su media de ${p.filtro} días: apuesta a que un bajón brusco dentro de una subida de fondo rebota.`,
    cuandoVende: `Vende en cuanto el cierre supera la media de ${p.salidaSma} días (el rebote ya llegó), o a las ${p.maxBarras} velas si no ha rebotado, o si salta el stop (salida de emergencia) a ${c.numeroLlano(p.atrStop)} veces el movimiento típico de ${p.atr} días (ATR) por debajo de la compra.`,
    cuandoNada: `Si no hay caída brusca, o el precio está por debajo de su media de ${p.filtro} días (tendencia bajista), no hace nada.`,
    riesgo: `Compra cuando el precio cae: si la caída sigue, pierde hasta el stop. Gana poco muchas veces y pierde más alguna vez. ${c.riesgoComun(limites)}`,
    filtros: c.explicarFiltros(filtros),
  };
}

module.exports = {
  familia,
  nombre: 'Reversión RSI',
  explicacion: explicar(parametrosPorDefecto),
  explicar,
  descripcion: 'Compra cuando RSI(2) baja de 10 con el cierre sobre la SMA200; vende cuando el cierre supera la SMA5 o tras 5 velas; stop a 3×ATR(14).',
  marco,
  parametrosPorDefecto,
  rejilla,
  dominio,
  calentamiento,
  preparar,
  decidir,
  trailing,
  vecinoMasLento,
  describir,
};
