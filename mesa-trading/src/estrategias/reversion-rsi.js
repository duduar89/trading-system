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
  const tm = c.textoMarco(marco);
  if (!s || i < 0 || i >= s.c.length) return c.senal(posicion ? 'mantener' : 'nada', { estado: textos ? `Sin datos de ${et}` : '' });
  const cierre = s.c[i];
  const r = s.rsi[i]; const f = s.filtro[i]; const sal = s.salida[i]; const a = s.atr[i];

  if (posicion) {
    if (sal !== null && cierre > sal) {
      const motivo = textos ? `cierre ${formato.precio(cierre)} > SMA${p.salidaSma} ${formato.precio(sal)}` : '';
      return c.senal('cerrar', { motivo, estado: textos ? `Cierro ${et}: ${motivo} (${tm})` : '' });
    }
    const barras = posicion.barrasAbierta || 0;
    if (barras >= p.maxBarras) {
      const motivo = textos ? `${barras} velas abiertas (máx. ${p.maxBarras})` : '';
      return c.senal('cerrar', { motivo, estado: textos ? `Cierro ${et}: ${motivo} (${tm})` : '' });
    }
    return c.senal('mantener', {
      peso: prep.peso,
      stop: posicion.stop ?? null,
      motivo: textos && sal !== null ? `cierre ${formato.precio(cierre)} ≤ SMA${p.salidaSma} ${formato.precio(sal)}` : '',
      estado: textos ? `Largo en ${et} desde ${formato.precio(posicion.entrada)}; sale sobre SMA${p.salidaSma} o tras ${p.maxBarras} velas (van ${barras}) (${tm})` : '',
    });
  }

  if (r === null || f === null || a === null) {
    const faltan = calentamiento(p) - 1 - i;
    return c.senal('nada', { estado: textos ? `Calentando indicadores de ${et} (faltan ${faltan} velas ${tm})` : '' });
  }
  if (r < p.umbral && cierre > f) {
    const stop = cierre - p.atrStop * a;
    const motivo = textos ? `RSI(${p.rsi}) ${formato.numero(r, 1)} < ${p.umbral}; cierre ${formato.precio(cierre)} > SMA${p.filtro} ${formato.precio(f)}` : '';
    const filtro = c.filtroQueBloquea(prep, simbolo, i, contexto);
    if (filtro) {
      return c.senal('nada', { motivo, estado: textos ? `Sobreventa en ${et} ${c.textoBloqueo(filtro, contexto, prep, simbolo, i)}` : '' });
    }
    return c.senal('abrir', {
      peso: prep.peso, stop, motivo,
      estado: textos ? `Abro ${et}: ${motivo}; stop ${formato.precio(stop)} (${tm})` : '',
    });
  }
  return c.senal('nada', {
    motivo: textos ? `RSI(${p.rsi}) ${formato.numero(r, 1)}; cierre ${formato.precio(cierre)} ${cierre > f ? '>' : '≤'} SMA${p.filtro} ${formato.precio(f)}` : '',
    estado: textos ? `Sin posición en ${et}. Esperando RSI(${p.rsi}) < ${p.umbral} con cierre sobre SMA${p.filtro}; RSI ahora ${formato.numero(r, 1)} (${tm})` : '',
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

module.exports = {
  familia,
  nombre: 'Reversión RSI',
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
