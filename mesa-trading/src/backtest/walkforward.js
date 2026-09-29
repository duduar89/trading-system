'use strict';
// Walk-forward (§4.7). Ventanas móviles: se entrena con `entrenoMeses`, se
// prueba con los `pruebaMeses` siguientes y se avanza `pruebaMeses`. Las
// ventanas se cuentan HACIA ATRÁS desde la última vela, para que el tramo más
// reciente siempre se pruebe; lo que no llega a una ventana completa se queda
// al principio (el histórico más viejo).
//
// En cada ventana se elige la combinación de la rejilla con mejor Sharpe de
// entrenamiento entre las que hacen ≥ 5 operaciones (si ninguna llega, la de
// mejor Sharpe y se marca). La curva fuera de muestra (OOS) se encadena: cada
// ventana de prueba empieza con el patrimonio con que acabó la anterior, sin
// posiciones (lo abierto se liquida al final de cada ventana, con costes).
//
// Los indicadores se preparan UNA vez por combinación sobre todo el histórico
// (son causales, así que el valor en i no ve nada posterior) y cada ventana
// solo recorta el tramo en el que se opera.
//
// sharpesEnsayos: Sharpe ANUALIZADO de cada combinación fija sobre todo el
// tramo OOS; es la dispersión que usa el Sharpe deflactado (dividir la
// varianza entre periodosAnio para pasarla a unidades diarias).

const { backtest } = require('./motor');
const { calcularMetricas, retornosDiarios } = require('./metricas');
const comun = require('../estrategias/comun');
const { asegurarFiltros } = require('../estrategias/filtros');

function sumarMeses(t, meses) {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + meses;
  const ultimoDia = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), ultimoDia), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

function rejillaDe(estrategia, simbolos) {
  return estrategia.rejillaPara ? estrategia.rejillaPara(simbolos) : estrategia.rejilla;
}
function baseDe(estrategia, simbolos) {
  return estrategia.parametrosPara ? estrategia.parametrosPara(simbolos) : estrategia.parametrosPorDefecto;
}

// Ventanas [entrenoDesde, pruebaDesde) + [pruebaDesde, pruebaHasta), en orden cronológico.
function calcularVentanas({ tCalentado, tFin, entrenoMeses, pruebaMeses }) {
  const ventanas = [];
  for (let k = 1; k < 1000; k++) {
    const pruebaHasta = sumarMeses(tFin, -(k - 1) * pruebaMeses);
    const pruebaDesde = sumarMeses(tFin, -k * pruebaMeses);
    const entrenoDesde = sumarMeses(pruebaDesde, -entrenoMeses);
    if (entrenoDesde < tCalentado) break;
    ventanas.unshift({ entrenoDesde, pruebaDesde, pruebaHasta });
  }
  return ventanas;
}

function mejorCombinacion(resultados, minOperaciones) {
  const valor = r => (r.metricas.sharpe === null ? -Infinity : r.metricas.sharpe);
  let mejor = null;
  for (const r of resultados) {
    if (r.metricas.operaciones < minOperaciones) continue;
    if (!mejor || valor(r) > valor(mejor)) mejor = r;
  }
  if (mejor) return { elegido: mejor, seleccion: 'mejor-sharpe' };
  for (const r of resultados) if (!mejor || valor(r) > valor(mejor)) mejor = r;
  return { elegido: mejor, seleccion: 'sin-minimo-operaciones' };
}

// Núcleo como generador: cede el control tras cada backtest para que la
// versión asíncrona no bloquee el proceso (el laboratorio corre en vivo).
function* nucleo(opciones) {
  const {
    velas, estrategia, filtros = [], entrenoMeses = 18, pruebaMeses = 6, minVentanas = 4,
    costes, contexto, limites, periodosAnio, capital = 10000, fijos = {}, pesoMesa = 1,
    minOperacionesEntreno = 5,
  } = opciones;
  const simbolos = Object.keys(velas).filter(s => Array.isArray(velas[s]) && velas[s].length);
  const pa = periodosAnio || (simbolos.length && simbolos.every(comun.esCripto) ? 365 : 252);
  const combos = comun.combinaciones(rejillaDe(estrategia, simbolos), baseDe(estrategia, simbolos), fijos);
  const marcoMs = comun.MARCOS[estrategia.marco];
  const listaFiltros = asegurarFiltros(filtros);

  const vacio = (motivo, eM, pM) => ({
    ventanas: [],
    oos: { curva: [], metricas: calcularMetricas({ curva: [], operaciones: [], periodosAnio: pa }), operaciones: [], retornosDiarios: [] },
    combinaciones: combos.length,
    sharpesEnsayos: [],
    suficiente: false,
    entrenoMeses: eM,
    pruebaMeses: pM,
    motivo,
  });
  if (!simbolos.length) return vacio('sin velas', entrenoMeses, pruebaMeses);

  // Primer instante con indicadores calientes en algún símbolo (con el
  // calentamiento más largo de la rejilla).
  const calent = Math.max(...combos.map(c => estrategia.calentamiento(c)));
  let tCalentado = Infinity;
  let tFin = -Infinity;
  for (const s of simbolos) {
    const serie = velas[s];
    if (serie.length > calent) tCalentado = Math.min(tCalentado, serie[calent].t);
    tFin = Math.max(tFin, serie[serie.length - 1].t + (marcoMs || 0));
  }
  if (!Number.isFinite(tCalentado)) return vacio(`menos de ${calent} velas de calentamiento`, entrenoMeses, pruebaMeses);

  let eM = entrenoMeses;
  let pM = pruebaMeses;
  let ventanasT = calcularVentanas({ tCalentado, tFin, entrenoMeses: eM, pruebaMeses: pM });
  if (ventanasT.length < minVentanas) {
    eM = 12; pM = 3;
    ventanasT = calcularVentanas({ tCalentado, tFin, entrenoMeses: eM, pruebaMeses: pM });
    if (ventanasT.length < minVentanas) {
      return vacio(`datos para ${ventanasT.length} ventanas de 12/3 meses (hacen falta ${minVentanas})`, eM, pM);
    }
  }

  // El contexto (régimen, F&G) es el mismo para todas las combinaciones: se memoriza por t.
  let ctxFn = null;
  if (contexto) {
    const memo = new Map();
    ctxFn = t => { let v = memo.get(t); if (v === undefined) { v = contexto(t) || {}; memo.set(t, v); } return v; };
  }

  const preps = combos.map(c => estrategia.preparar(velas, c));
  yield;
  const comunes = { velas, estrategia, filtros: listaFiltros, costes, contexto: ctxFn, limites, periodosAnio: pa, pesoMesa };

  const ventanas = [];
  const oosCurva = [];
  const oosOps = [];
  let capitalActual = capital;
  for (const v of ventanasT) {
    const resultados = [];
    for (let c = 0; c < combos.length; c++) {
      const r = backtest({ ...comunes, params: combos[c], prep: preps[c], capital, desde: v.entrenoDesde, hasta: v.pruebaDesde });
      resultados.push({ c, metricas: r.metricas });
      yield;
    }
    const { elegido, seleccion } = mejorCombinacion(resultados, minOperacionesEntreno);
    const prueba = backtest({ ...comunes, params: combos[elegido.c], prep: preps[elegido.c], capital: capitalActual, desde: v.pruebaDesde, hasta: v.pruebaHasta });
    yield;
    for (const p of prueba.curva) oosCurva.push(p);
    for (const o of prueba.operaciones) oosOps.push(o);
    if (prueba.curva.length) capitalActual = prueba.curva[prueba.curva.length - 1].valor;
    ventanas.push({
      desde: v.pruebaDesde,
      hasta: v.pruebaHasta,
      entrenoDesde: v.entrenoDesde,
      entrenoHasta: v.pruebaDesde,
      params: combos[elegido.c],
      seleccion,
      metricasEntreno: elegido.metricas,
      metricasPrueba: prueba.metricas,
    });
  }

  // Dispersión de los ensayos: cada combinación fija sobre todo el tramo OOS.
  const oosDesde = ventanasT[0].pruebaDesde;
  const oosHasta = ventanasT[ventanasT.length - 1].pruebaHasta;
  const sharpesEnsayos = [];
  for (let c = 0; c < combos.length; c++) {
    const r = backtest({ ...comunes, params: combos[c], prep: preps[c], capital, desde: oosDesde, hasta: oosHasta });
    sharpesEnsayos.push(r.metricas.sharpe === null ? 0 : r.metricas.sharpe);
    yield;
  }

  const metricas = calcularMetricas({ curva: oosCurva, operaciones: oosOps, periodosAnio: pa });
  return {
    ventanas,
    oos: { curva: oosCurva, metricas, operaciones: oosOps, retornosDiarios: retornosDiarios(oosCurva) },
    combinaciones: combos.length,
    sharpesEnsayos,
    suficiente: true,
    entrenoMeses: eM,
    pruebaMeses: pM,
    periodosAnio: pa,
  };
}

function walkForward(opciones = {}) {
  const it = nucleo(opciones);
  for (;;) {
    const paso = it.next();
    if (paso.done) return paso.value;
  }
}

// Igual, pero cediendo el bucle de eventos entre backtests (setImmediate).
async function walkForwardAsync(opciones = {}) {
  const it = nucleo(opciones);
  for (;;) {
    const paso = it.next();
    if (paso.done) return paso.value;
    await new Promise(r => setImmediate(r));
  }
}

module.exports = { walkForward, walkForwardAsync, sumarMeses, calcularVentanas };
