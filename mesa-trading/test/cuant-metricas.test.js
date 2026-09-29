'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/backtest/metricas');
const { DIA, T0 } = require('./cuant-ayuda');

const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (tol ${tol})`);

test('normalInv(0,975) ≈ 1,959964 (tolerancia 1e-6)', () => {
  cerca(M.normalInv(0.975), 1.959964, 1e-6);
  cerca(M.normalInv(0.975), 1.9599639845400536, 1e-12);
});

test('normalInv y normalCDF: valores de tabla y colas', () => {
  cerca(M.normalInv(0.5), 0, 1e-15);
  cerca(M.normalInv(0.9), 1.2815515655446008, 1e-12);
  cerca(M.normalInv(0.025), -1.9599639845400538, 1e-12);
  cerca(M.normalInv(1e-6), -4.753424308822899, 1e-9);   // rama de la cola baja
  cerca(M.normalInv(0.99), 2.3263478740408408, 1e-12);   // rama central
  cerca(M.normalInv(1 - 1 / (100 * Math.E)), 2.680210444966887, 1e-10); // rama de la cola alta
  cerca(M.normalCDF(1.96), 0.9750021048517796, 1e-14);
  cerca(M.normalCDF(-1), 0.15865525393145707, 1e-14);
  assert.equal(M.normalInv(0), -Infinity);
  assert.equal(M.normalInv(1), Infinity);
  for (const p of [0.001, 0.02, 0.3, 0.77, 0.98, 0.9999]) cerca(M.normalCDF(M.normalInv(p)), p, 1e-14);
});

test('Sharpe deflactado: caso calculado a mano', () => {
  // SR = 0,1 por periodo, T = 250, N = 10 ensayos, V = 0,0025 (σ de los Sharpe 0,05),
  // asimetría −0,5, curtosis 4.
  //   Φ⁻¹(1 − 1/10) = Φ⁻¹(0,9) = 1,28155157
  //   Φ⁻¹(1 − 1/(10e)) = Φ⁻¹(0,96321206) = 1,78924176
  //   SR0 = 0,05 · (0,42278434·1,28155157 + 0,57721566·1,78924176)
  //       = 0,05 · (0,54182100 + 1,03277734) = 0,05 · 1,57459834 = 0,07872992
  //   den = √(1 + 0,5·0,1 + (4−1)/4·0,01) = √1,0575 = 1,02834818
  //   z   = (0,1 − 0,07872992)·√249 / 1,02834818 = 0,02127008·15,77973384/1,02834818 = 0,32638389
  //   DSR = Φ(0,32638389) = 0,62793304
  const r = M.sharpeDeflactado({ sharpe: 0.1, n: 250, ensayos: 10, varianzaSharpes: 0.0025, asimetria: -0.5, curtosis: 4 });
  cerca(r.sharpeUmbral, 0.0787299150672875, 1e-9);
  cerca(r.z, 0.3263838865039367, 1e-8);
  cerca(r.dsr, 0.6279330363338281, 1e-8);
});

test('Sharpe deflactado: ejemplo numérico de Bailey y López de Prado (2014) → 0,9004', () => {
  // Sharpe anual 2,5 con 5 años diarios (T = 1.250, 250 días/año), 100 ensayos,
  // varianza de los Sharpe anuales 0,5, asimetría −3, curtosis 10.
  // El artículo da SR0 anual ≈ 1,7894 (0,1132 diario) y DSR ≈ 0,9004.
  const r = M.sharpeDeflactado({
    sharpe: 2.5 / Math.sqrt(250), n: 1250, ensayos: 100, varianzaSharpes: 0.5 / 250, asimetria: -3, curtosis: 10,
  });
  cerca(r.sharpeUmbral * Math.sqrt(250), 1.7894, 1e-4);
  cerca(r.dsr, 0.9004, 1e-4);
});

test('Sharpe deflactado: con un solo ensayo no hay deflactor', () => {
  const r = M.sharpeDeflactado({ sharpe: 0.05, n: 101, ensayos: 1, varianzaSharpes: 0.01 });
  assert.equal(r.sharpeUmbral, 0);
  // z = 0,05·√100 / √(1 + 0,5·0,0025) = 0,5/1,000625 → Φ(0,49969)
  cerca(r.dsr, M.normalCDF(0.5 / Math.sqrt(1 + 0.5 * 0.0025)), 1e-12);
});

test('retornos diarios: último valor de cada día UTC; el primero contra el capital', () => {
  const curva = [
    { t: T0, valor: 100 },
    { t: T0 + 4 * 3600e3, valor: 104 },       // mismo día: solo cuenta el último
    { t: T0 + 20 * 3600e3, valor: 102 },
    { t: T0 + DIA, valor: 112.2 },
  ];
  const r = M.retornosDiarios(curva);
  assert.equal(r.length, 2);
  assert.equal(r[0].dia, '2020-01-06');
  cerca(r[0].r, 0.02);          // 102/100 − 1
  cerca(r[1].r, 0.1);           // 112,2/102 − 1
});

test('calcularMetricas: curva y operaciones hechas a mano', () => {
  // Valores diarios 100, 110, 99, 108,9 → retornos [0, +0,1, −0,1, +0,1]
  //   media 0,025; desviación muestral √(0,0275/3) = 0,0957427
  //   Sharpe = 0,025/0,0957427·√365 = 4,98862
  //   Sortino: bajada √(0,01/4) = 0,05 → 0,025/0,05·√365 = 9,55249
  //   maxDD: de 110 a 99 = 10 %; rentabilidad 108,9/100 − 1 = 8,9 %
  const curva = [100, 110, 99, 108.9].map((valor, i) => ({ t: T0 + i * DIA, valor }));
  const operaciones = [
    { pnl: 50, entradaT: T0, salidaT: T0 + DIA },
    { pnl: -20, entradaT: T0 + DIA, salidaT: T0 + 2 * DIA },
    { pnl: 30, entradaT: T0 + DIA, salidaT: T0 + DIA + 1000 },
    { pnl: -10, entradaT: T0 + 5 * DIA, salidaT: T0 + 6 * DIA }, // fuera de la curva: no cuenta en exposición
  ];
  const m = M.calcularMetricas({ curva, operaciones, periodosAnio: 365 });
  cerca(m.rentabilidad, 0.089);
  cerca(m.sharpe, 4.988623420981346, 1e-9);
  cerca(m.sortino, 9.5524865872714, 1e-9);
  cerca(m.maxDD, 0.1);
  assert.equal(m.operaciones, 4);
  cerca(m.acierto, 0.5);                 // 2 de 4
  cerca(m.factorBeneficio, 80 / 30);     // (50+30)/(20+10)
  cerca(m.expectativa, 12.5);            // 50/4
  cerca(m.exposicion, 2 / 3);            // abierto de T0 a T0+2d sobre 3 días
  cerca(m.cagr, Math.pow(1.089, 365.25 / 3) - 1, 1e-6);
});

test('calcularMetricas: √252 en acciones', () => {
  const curva = [100, 110, 99, 108.9].map((valor, i) => ({ t: T0 + i * DIA, valor }));
  const m = M.calcularMetricas({ curva, operaciones: [], periodosAnio: 252 });
  cerca(m.sharpe, (0.025 / Math.sqrt(0.0275 / 3)) * Math.sqrt(252), 1e-9);
  assert.equal(m.acierto, null);
});

test('calcularMetricas: curva plana → Sharpe no calculable (null), no 0 inventado', () => {
  const curva = [100, 100, 100].map((valor, i) => ({ t: T0 + i * DIA, valor }));
  const m = M.calcularMetricas({ curva, operaciones: [], periodosAnio: 365 });
  assert.equal(m.sharpe, null);
  assert.equal(m.sortino, null);
  assert.equal(m.maxDD, 0);
});

test('correlación de Pearson sobre días comunes', () => {
  const a = Array.from({ length: 30 }, (_, i) => ({ dia: `d${i}`, r: Math.sin(i) }));
  const b = a.map(x => ({ dia: x.dia, r: 2 * x.r + 1 }));
  const c = a.map(x => ({ dia: x.dia, r: -x.r }));
  cerca(M.correlacion(a, b).valor, 1, 1e-12);
  cerca(M.correlacion(a, c).valor, -1, 1e-12);
  assert.equal(M.correlacion(a.slice(0, 5), b).valor, null); // < 20 días comunes
});

test('momentos: asimetría y curtosis (Pearson, normal = 3)', () => {
  const m = M.momentos([1, 2, 3, 4, 5]);
  cerca(m.media, 3);
  cerca(m.asimetria, 0);
  // m2 = 2, m4 = (16+1+0+1+16)/5 = 6,8 → 6,8/4 = 1,7
  cerca(m.curtosis, 1.7);
});
