'use strict';
// Métricas de una curva de patrimonio y sus operaciones (§4.6).
//
// Sharpe y Sortino se calculan sobre retornos DIARIOS (último valor de cada día
// UTC), no por vela: así un 4H y un 1D se comparan en la misma escala.
// Anualización: √365 en cripto (cotiza todos los días) y √252 en acciones.
// Todas las fracciones van en tanto por uno (0,12 = 12 %). maxDD es positivo.

const { diaUTC, DIA } = require('../util/reloj');

// ---------------------------------------------------------------------------
// Normal estándar

// Φ(x) con el algoritmo de Hart (1968) en la versión de West (2005): precisión
// de doble (≈1e-15), necesaria para que normalInv afine bien.
function normalCDF(x) {
  if (Number.isNaN(x)) return NaN;
  const ax = Math.abs(x);
  let cola;
  if (ax > 37) {
    cola = 0;
  } else {
    const e = Math.exp(-ax * ax / 2);
    if (ax < 7.07106781186547) {
      let n = 3.52624965998911e-02 * ax + 0.700383064443688;
      n = n * ax + 6.37396220353165;
      n = n * ax + 33.912866078383;
      n = n * ax + 112.079291497871;
      n = n * ax + 221.213596169931;
      n = n * ax + 220.206867912376;
      let d = 8.83883476483184e-02 * ax + 1.75566716318264;
      d = d * ax + 16.064177579207;
      d = d * ax + 86.7807322029461;
      d = d * ax + 296.564248779674;
      d = d * ax + 637.333633378831;
      d = d * ax + 793.826512519948;
      d = d * ax + 440.413735824752;
      cola = (e * n) / d;
    } else {
      let b = ax + 0.65;
      b = ax + 4 / b;
      b = ax + 3 / b;
      b = ax + 2 / b;
      b = ax + 1 / b;
      cola = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - cola : cola;
}

// Φ⁻¹(p): algoritmo de Acklam (error relativo 1,15e-9) más un paso de Halley
// contra normalCDF, que lo deja en precisión de máquina.
const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

function normalInv(p) {
  if (!(p >= 0 && p <= 1)) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const pBajo = 0.02425;
  let x;
  if (p < pBajo) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  } else if (p <= 1 - pBajo) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  const e = normalCDF(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

// ---------------------------------------------------------------------------
// Sharpe deflactado — Bailey y López de Prado (2014), «The Deflated Sharpe Ratio».
//
//   SR0 = √V · ((1−γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e)))      (máximo esperado por azar)
//   DSR = Φ( (SR − SR0)·√(T−1) / √(1 − asim·SR + (curt−1)/4·SR²) )
//
// Todo POR PERIODO (no anualizado): sharpe, varianzaSharpes (varianza de los
// Sharpe de los N ensayos, en la misma unidad) y T = n retornos. La curtosis es
// la de Pearson (una normal da 3, no 0). Con N < 2 no hay selección y SR0 = 0.
const GAMMA_EULER = 0.5772156649015329;

function sharpeDeflactado({ sharpe, n, ensayos, varianzaSharpes, asimetria = 0, curtosis = 3 } = {}) {
  let sharpeUmbral = 0;
  if (ensayos >= 2 && varianzaSharpes > 0) {
    sharpeUmbral = Math.sqrt(varianzaSharpes) * ((1 - GAMMA_EULER) * normalInv(1 - 1 / ensayos)
      + GAMMA_EULER * normalInv(1 - 1 / (ensayos * Math.E)));
  }
  if (!Number.isFinite(sharpe) || !(n >= 2)) return { dsr: null, sharpeUmbral, z: null };
  const den = 1 - asimetria * sharpe + ((curtosis - 1) / 4) * sharpe * sharpe;
  if (!(den > 0)) return { dsr: null, sharpeUmbral, z: null };
  const z = ((sharpe - sharpeUmbral) * Math.sqrt(n - 1)) / Math.sqrt(den);
  return { dsr: normalCDF(z), sharpeUmbral, z };
}

// ---------------------------------------------------------------------------
// Series

// Retornos diarios: último valor de cada día UTC frente al del día anterior.
// El primer día se mide contra el primer punto de la curva (el capital inicial).
function retornosDiarios(curva) {
  if (!Array.isArray(curva) || curva.length === 0) return [];
  const cierresDia = [];
  for (const p of curva) {
    const dia = diaUTC(p.t);
    const ult = cierresDia[cierresDia.length - 1];
    if (ult && ult.dia === dia) ult.valor = p.valor; else cierresDia.push({ dia, valor: p.valor });
  }
  const out = [];
  let previo = curva[0].valor;
  for (const d of cierresDia) {
    out.push({ dia: d.dia, r: previo > 0 ? d.valor / previo - 1 : 0 });
    previo = d.valor;
  }
  return out;
}

function momentos(xs) {
  const n = xs.length;
  if (n === 0) return { n: 0, media: 0, desviacion: 0, asimetria: 0, curtosis: 3 };
  let s = 0;
  for (const x of xs) s += x;
  const media = s / n;
  let m2 = 0; let m3 = 0; let m4 = 0;
  for (const x of xs) { const d = x - media; const d2 = d * d; m2 += d2; m3 += d2 * d; m4 += d2 * d2; }
  m2 /= n; m3 /= n; m4 /= n;
  const desviacion = n > 1 ? Math.sqrt((m2 * n) / (n - 1)) : 0;
  return {
    n,
    media,
    desviacion,
    asimetria: m2 > 0 ? m3 / Math.pow(m2, 1.5) : 0,
    curtosis: m2 > 0 ? m4 / (m2 * m2) : 3,
  };
}

function maxDrawdown(curva) {
  let pico = -Infinity;
  let peor = 0;
  for (const p of curva) {
    if (p.valor > pico) pico = p.valor;
    if (pico > 0) {
      const dd = 1 - p.valor / pico;
      if (dd > peor) peor = dd;
    }
  }
  return peor;
}

// Correlación de Pearson sobre los días comunes de dos series [{dia, r}].
function correlacion(a, b, minComunes = 20) {
  const mapa = new Map(b.map(x => [x.dia, x.r]));
  const xs = []; const ys = [];
  for (const x of a) if (mapa.has(x.dia)) { xs.push(x.r); ys.push(mapa.get(x.dia)); }
  const n = xs.length;
  if (n < minComunes) return { valor: null, n };
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx; const dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return { valor: null, n };
  return { valor: sxy / Math.sqrt(sxx * syy), n };
}

// Fracción del tiempo con alguna operación abierta (unión de intervalos).
function exposicionTemporal(operaciones, t0, t1) {
  if (!(t1 > t0) || !operaciones.length) return 0;
  const tramos = operaciones
    .map(o => [Math.max(t0, o.entradaT), Math.min(t1, o.salidaT)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0; let ini = null; let fin = null;
  for (const [a, b] of tramos) {
    if (ini === null) { ini = a; fin = b; continue; }
    if (a <= fin) { fin = Math.max(fin, b); } else { total += fin - ini; ini = a; fin = b; }
  }
  if (ini !== null) total += fin - ini;
  return total / (t1 - t0);
}

// ---------------------------------------------------------------------------

function calcularMetricas({ curva = [], operaciones = [], periodosAnio = 365 } = {}) {
  const ops = operaciones || [];
  const vacio = {
    rentabilidad: 0, cagr: null, sharpe: null, sortino: null, maxDD: 0,
    operaciones: ops.length, acierto: null, factorBeneficio: null, expectativa: null, exposicion: 0,
  };
  if (!curva.length) return vacio;

  const v0 = curva[0].valor;
  const vN = curva[curva.length - 1].valor;
  const rentabilidadTotal = v0 > 0 ? vN / v0 - 1 : 0;
  const dias = (curva[curva.length - 1].t - curva[0].t) / DIA;
  const cagr = dias >= 1 && v0 > 0 ? (vN > 0 ? Math.pow(vN / v0, 365.25 / dias) - 1 : -1) : null;

  const r = retornosDiarios(curva).map(x => x.r);
  const anual = Math.sqrt(periodosAnio);
  let sharpe = null;
  let sortino = null;
  if (r.length >= 2) {
    const m = momentos(r);
    sharpe = m.desviacion > 0 ? (m.media / m.desviacion) * anual : null;
    // Desviación a la baja con objetivo 0, dividida entre TODOS los días.
    let s2 = 0;
    for (const x of r) if (x < 0) s2 += x * x;
    const dd = Math.sqrt(s2 / r.length);
    sortino = dd > 0 ? (m.media / dd) * anual : null;
  }

  const n = ops.length;
  let ganadoras = 0; let bruto = 0; let perdido = 0; let suma = 0;
  for (const o of ops) {
    suma += o.pnl;
    if (o.pnl > 0) { ganadoras++; bruto += o.pnl; } else if (o.pnl < 0) perdido += -o.pnl;
  }

  return {
    rentabilidad: rentabilidadTotal,
    cagr,
    sharpe,
    sortino,
    maxDD: maxDrawdown(curva),
    operaciones: n,
    acierto: n ? ganadoras / n : null,
    factorBeneficio: perdido > 0 ? bruto / perdido : null,
    expectativa: n ? suma / n : null,          // $ medios por operación, neto de costes
    exposicion: exposicionTemporal(ops, curva[0].t, curva[curva.length - 1].t),
  };
}

module.exports = {
  calcularMetricas, normalCDF, normalInv, sharpeDeflactado, retornosDiarios, momentos,
  maxDrawdown, correlacion, exposicionTemporal, GAMMA_EULER,
};
