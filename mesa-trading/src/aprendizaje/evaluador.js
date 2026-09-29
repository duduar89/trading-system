'use strict';
// Evaluador de mesas — ARQUITECTURA §5.6.
//
// Mide cada mesa con la penalización de papel incluida (0,1 % por lado,
// critica-sintesis §3.10): el papel llena mejor que la realidad, y medir sin
// ella premia a las mesas que más rotan. La penalización se resta de cada
// operación (entrada y salida) y también de la curva diaria, el día en que
// ocurre cada lado, para que el Sharpe y la caída la vean.
//
// Contracción: sharpeAjustado = sharpe·n/(n+30), con n = operaciones. Con
// pocas operaciones el Sharpe es ruido y se encoge hacia 0 (critica §3.7).
// Todas las fracciones en tanto por uno.

const { media, desviacion } = require('../util/numeros');
const { diaUTC } = require('../util/reloj');

const N0_CONTRACCION = 30;
const SALIDAS_POR_REGLA = new Set(['señal', 'stop']);

const numero = x => typeof x === 'number' && Number.isFinite(x);

// Las operaciones de prueba (la orden de 15 $ del botón Prueba) no son de ninguna mesa.
const operacionesDeMesa = ops => (ops || []).filter(o => o && o.motivoSalida !== 'prueba');

function penalizacionesDe(op, penalizacion) {
  const q = Math.abs(op.cantidad || 0);
  const entrada = numero(op.entradaPrecio) ? penalizacion * Math.abs(op.entradaPrecio) * q : 0;
  const salida = numero(op.salidaPrecio) ? penalizacion * Math.abs(op.salidaPrecio) * q : 0;
  return { entrada, salida };
}

// Retornos diarios de la curva. Si un punto trae `flujo` (capital que entra o
// sale ese día por una reasignación), no cuenta como rentabilidad.
function retornosDe(curva) {
  const out = [];
  for (let i = 1; i < curva.length; i++) {
    const previo = curva[i - 1].valor;
    const flujo = numero(curva[i].flujo) ? curva[i].flujo : 0;
    if (!(previo > 0) || !numero(curva[i].valor)) continue;
    out.push({ dia: curva[i].dia, r: (curva[i].valor - flujo) / previo - 1 });
  }
  return out;
}

function sharpeDe(rs, periodosAnio) {
  if (rs.length < 2) return null;
  const sd = desviacion(rs);
  if (!(sd > 0)) return null;
  return (media(rs) / sd) * Math.sqrt(periodosAnio);
}

// Caída máxima sobre el índice encadenado (así una reasignación no se lee como caída).
function maxDDDe(retornos) {
  let indice = 1;
  let pico = 1;
  let peor = 0;
  for (const { r } of retornos) {
    indice *= 1 + r;
    if (indice > pico) pico = indice;
    const dd = 1 - indice / pico;
    if (dd > peor) peor = dd;
  }
  return peor;
}

function curvaPenalizada(curvaDiaria, ops, penalizacion) {
  const curva = (curvaDiaria || []).filter(p => p && numero(p.valor));
  if (!(penalizacion > 0) || !ops.length || !curva.length) return curva;
  // Penalización acumulada por día; lo anterior al primer día se resta de todos
  // los puntos por igual (no altera retornos salvo por el nivel).
  const porDia = new Map();
  const sumar = (t, x) => {
    if (!numero(t) || !(x > 0)) return;
    const d = diaUTC(t);
    porDia.set(d, (porDia.get(d) || 0) + x);
  };
  for (const op of ops) {
    const { entrada, salida } = penalizacionesDe(op, penalizacion);
    sumar(numero(op.entradaT) ? op.entradaT : op.salidaT, entrada);
    sumar(op.salidaT, salida);
  }
  const dias = [...porDia.keys()].sort();
  let acumulado = 0;
  let k = 0;
  return curva.map(p => {
    while (k < dias.length && dias[k] <= p.dia) { acumulado += porDia.get(dias[k]); k++; }
    return { ...p, valor: p.valor - acumulado };
  });
}

function metricasMesa({ operaciones = [], curvaDiaria = [], penalizacionPapel = 0, diasActiva, periodosAnio = 365 } = {}) {
  const ops = operacionesDeMesa(operaciones);
  const pen = numero(penalizacionPapel) && penalizacionPapel > 0 ? penalizacionPapel : 0;

  let ganado = 0;
  let perdido = 0;
  let ganadoras = 0;
  let pnlTotal = 0;
  let pnlBruto = 0;
  let penalizacionTotal = 0;
  let porRegla = 0;
  for (const op of ops) {
    const { entrada, salida } = penalizacionesDe(op, pen);
    const pnl = (numero(op.pnl) ? op.pnl : 0) - entrada - salida;
    pnlBruto += numero(op.pnl) ? op.pnl : 0;
    penalizacionTotal += entrada + salida;
    pnlTotal += pnl;
    if (pnl > 0) { ganadoras++; ganado += pnl; } else if (pnl < 0) perdido += -pnl;
    if (SALIDAS_POR_REGLA.has(op.motivoSalida)) porRegla++;
  }
  const n = ops.length;

  const retornos = retornosDe(curvaPenalizada(curvaDiaria, ops, pen));
  const sharpe = sharpeDe(retornos.map(x => x.r), periodosAnio);

  return {
    operaciones: n,
    acierto: n ? ganadoras / n : null,
    factorBeneficio: perdido > 0 ? ganado / perdido : null,
    expectativa: n ? pnlTotal / n : null,
    sharpe,
    sharpeAjustado: sharpe === null ? null : (sharpe * n) / (n + N0_CONTRACCION),
    maxDD: maxDDDe(retornos),
    // Fracción de salidas por regla ('señal' o 'stop') sobre el total de salidas.
    adherencia: n ? porRegla / n : null,
    pnlTotal,
    diasActiva: numero(diasActiva) ? diasActiva : (curvaDiaria || []).length,
    pnlBruto,
    penalizacionTotal,
  };
}

// Sharpe de los últimos `dias` retornos diarios. Con menos de `minDias`
// devuelve null: un Sharpe de dos semanas es ruido y no se enseña como cifra.
function sharpeRodante(curvaDiaria, dias = 90, { minDias = 30, periodosAnio = 365 } = {}) {
  const curva = (curvaDiaria || []).filter(p => p && numero(p.valor));
  const tramo = curva.slice(-(dias + 1));
  const rs = retornosDe(tramo).map(x => x.r);
  if (rs.length < Math.min(minDias, dias)) return null;
  return sharpeDe(rs, periodosAnio);
}

// Deriva: ¿va el papel 1 σ por debajo del backtest? Se contrasta la media de
// los últimos 30 retornos diarios con la del backtest usando el error típico
// de esa media: z = (media − μ)·√n / σ. Alarma si z ≤ −1.
// μ y σ son DIARIOS, en la misma unidad que retornosPapel.
function alarmaDeriva({ retornosPapel = [], muBacktest, sigmaBacktest, dias = 30, minDias = 20 } = {}) {
  const rs = (retornosPapel || []).map(x => (typeof x === 'number' ? x : x && x.r)).filter(numero).slice(-dias);
  if (rs.length < minDias || !numero(muBacktest) || !(sigmaBacktest > 0)) return { alarma: false, z: null, n: rs.length };
  const z = ((media(rs) - muBacktest) * Math.sqrt(rs.length)) / sigmaBacktest;
  return { alarma: z <= -1, z, n: rs.length };
}

module.exports = { metricasMesa, sharpeRodante, alarmaDeriva, N0_CONTRACCION };
