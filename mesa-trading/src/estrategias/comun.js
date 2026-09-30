'use strict';
// Piezas comunes a las cuatro familias: textos, filtros, rejillas y el
// percentil de volatilidad que usa el filtro vol-max.

const { volatilidad, percentilMovil } = require('../mercado/indicadores');
const { asegurarFiltros, bloqueo, valorRegimen, valorNumero } = require('./filtros');
const { DIA } = require('../util/reloj');

const MARCOS = Object.freeze({ '1Hour': 3_600_000, '4Hour': 14_400_000, '1Day': 86_400_000 });
const TEXTO_MARCO = Object.freeze({ '1Hour': '1H', '4Hour': '4H', '1Day': '1D' });

function etiqueta(simbolo) { return String(simbolo).split('/')[0]; }
function textoMarco(marco) { return TEXTO_MARCO[marco] || marco; }
function esCripto(simbolo) { return String(simbolo).includes('/'); }

// Velas por año del marco: cripto 365 días, acciones 252 sesiones (la vela
// diaria de acciones es una por sesión).
function periodosAnio(simbolos, marco) {
  const cripto = simbolos.every(esCripto);
  const porDia = marco === '1Day' ? 1 : DIA / (MARCOS[marco] || DIA);
  return (cripto ? 365 : 252) * porDia;
}

// Producto cartesiano de la rejilla. `fijos` pisa claves (y las saca de la
// rejilla): así el laboratorio prueba «atrStop + 0,5» sin tocar el resto.
function combinaciones(rejilla, base = {}, fijos = {}) {
  const claves = Object.keys(rejilla || {}).filter(k => !(k in fijos));
  let combos = [{}];
  for (const k of claves) {
    const siguiente = [];
    for (const c of combos) for (const v of rejilla[k]) siguiente.push({ ...c, [k]: v });
    combos = siguiente;
  }
  return combos.map(c => ({ ...base, ...c, ...fijos }));
}

function numeroCombinaciones(rejilla) {
  return Object.values(rejilla || {}).reduce((n, vals) => n * vals.length, 1);
}

function igual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Siguiente valor MAYOR en la lista ordenada de la rejilla (o null).
function siguienteMayor(lista, valor) {
  const ordenada = [...lista].sort((x, y) => x - y);
  for (const v of ordenada) if (v > valor) return v;
  return null;
}
function siguienteMenor(lista, valor) {
  const ordenada = [...lista].sort((x, y) => y - x);
  for (const v of ordenada) if (v < valor) return v;
  return null;
}

// Dominio cerrado del multiplicador de stop: 1 a 5 en pasos de 0,5. Es lo que
// puede proponer el laboratorio con «stop_estrecho → atrStop + 0,5».
const DOMINIO_ATR_STOP = Object.freeze([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);

// Percentil de la volatilidad 30 d del símbolo en su propia historia del
// último año (ventana móvil de 365 días). Ventana fija y no «toda la historia»
// para que en vivo, con las velas justas, salga lo mismo que en el backtest.
// Hasta tener el año completo devuelve null (el filtro deja pasar).
// Se calcula la primera vez que un filtro lo pide y se guarda en prep.
function velasPorDias(marco, dias) {
  return Math.max(2, Math.round((dias * DIA) / (MARCOS[marco] || DIA)));
}

function volPercentil(prep, simbolo, i) {
  if (!prep._volPct) prep._volPct = {};
  let serie = prep._volPct[simbolo];
  if (!serie) {
    const velas = prep.velas[simbolo];
    const vol = volatilidad(velas.map(v => v.c), velasPorDias(prep.marco, 30), periodosAnio([simbolo], prep.marco));
    serie = percentilMovil(vol, velasPorDias(prep.marco, 365));
    prep._volPct[simbolo] = serie;
  }
  const q = serie[i];
  return q === undefined ? null : q;
}

// Velas que necesita el filtro vol-max para dar valor en la última: 30 d de
// volatilidad + 365 d de ventana.
function velasFiltroVol(marco) {
  return velasPorDias(marco, 30) + velasPorDias(marco, 365);
}

// Hueco en los datos de un símbolo: más de 4 velas y más de 5 días sin
// ninguna. Con 5 días de mínimo, las noches, los fines de semana y los puentes
// de las acciones no cuentan como hueco; un símbolo que la fuente deja de dar
// durante meses (SOL en Alpaca, jul-2023 → ago-2024), sí.
function umbralHueco(marcoMs) {
  return Math.max(4 * (marcoMs || DIA), 5 * DIA);
}

// Índices j de la serie en que se reanuda tras un hueco (t[j] − t[j−1] > umbral).
function reanudaciones(serie, umbral) {
  const js = [];
  for (let j = 1; j < serie.length; j++) if (serie[j].t - serie[j - 1].t > umbral) js.push(j);
  return js;
}

// Última reanudación ≤ j (o −Infinity si no hay ninguna).
function ultimaReanudacion(js, j) {
  let lo = 0; let hi = js.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (js[m] <= j) lo = m + 1; else hi = m; }
  return lo ? js[lo - 1] : -Infinity;
}

// Velas que tarda la decisión en no depender de nada anterior: el
// calentamiento de la familia, 15 periodos de ATR/RSI de Wilder (su memoria
// cae por debajo de 2·10⁻⁷) y, con el filtro vol-max, su año de ventana. Es lo
// que el vivo prepara (velasNecesarias) y lo que el motor espera tras un hueco.
function velasMemoria(estrategia, params, filtros = []) {
  const p = params || {};
  let n = estrategia.calentamiento(p) + (Number.isFinite(p.atr) ? 15 * p.atr : 0);
  if ((filtros || []).some(f => f && f.id === 'vol-max')) n = Math.max(n, velasFiltroVol(estrategia.marco) + 1);
  return n;
}

// Aplica los filtros de la mesa a una apertura. Devuelve el filtro que la
// bloquea o null. Solo se calcula el percentil si hay un filtro vol-max.
function filtroQueBloquea(prep, simbolo, i, contexto) {
  const filtros = asegurarFiltros(contexto && contexto.filtros);
  if (!filtros.length) return null;
  const ctx = {
    regimen: contexto.regimen,
    fg: contexto.fg,
    volPercentil: filtros.some(f => f.id === 'vol-max') ? volPercentil(prep, simbolo, i) : null,
  };
  return bloqueo(filtros, ctx);
}

function textoBloqueo(filtro, contexto, prep, simbolo, i) {
  if (!filtro) return '';
  if (filtro.id === 'regimen-no-riskoff') return `bloqueado por filtro: régimen ${valorRegimen(contexto.regimen)}`;
  if (filtro.id === 'fg-max' || filtro.id === 'fg-min') {
    return `bloqueado por filtro ${filtro.id}: Miedo y codicia ${valorNumero(contexto.fg)} (umbral ${filtro.parametro})`;
  }
  if (filtro.id === 'vol-max') {
    const q = volPercentil(prep, simbolo, i);
    return `bloqueado por filtro vol-max: volatilidad en percentil ${Math.round(q)} (máx. ${filtro.parametro})`;
  }
  return `bloqueado por filtro ${filtro.id}`;
}

function senal(accion, { peso = 0, stop = null, objetivoPrecio = null, motivo = '', estado = '' } = {}) {
  return { accion, peso, stop, objetivoPrecio, motivo, estado };
}

// Índices por t para alinear varias series del mismo marco.
function indicesPorT(velas) {
  const m = new Map();
  for (let i = 0; i < velas.length; i++) m.set(velas[i].t, i);
  return m;
}

module.exports = {
  MARCOS, etiqueta, textoMarco, esCripto, periodosAnio, combinaciones, numeroCombinaciones,
  igual, siguienteMayor, siguienteMenor, DOMINIO_ATR_STOP, volPercentil, velasFiltroVol, velasPorDias,
  filtroQueBloquea, textoBloqueo, senal, indicesPorT, umbralHueco, reanudaciones, ultimaReanudacion, velasMemoria,
};
