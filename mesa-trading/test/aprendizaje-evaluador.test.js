'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { metricasMesa, sharpeRodante, alarmaDeriva } = require('../src/aprendizaje/evaluador');

const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const DIA = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const dia = i => new Date(T0 + i * DIA).toISOString().slice(0, 10);

const OPS = [
  { cantidad: 10, entradaPrecio: 100, salidaPrecio: 110, pnl: 100, motivoSalida: 'señal', entradaT: T0, salidaT: T0 + DIA },
  { cantidad: 10, entradaPrecio: 100, salidaPrecio: 95, pnl: -50, motivoSalida: 'stop', entradaT: T0 + DIA, salidaT: T0 + 2 * DIA },
  { cantidad: 5, entradaPrecio: 200, salidaPrecio: 204, pnl: 20, motivoSalida: 'kill', entradaT: T0 + DIA, salidaT: T0 + 2 * DIA },
  { cantidad: 0.0001, entradaPrecio: 150000, salidaPrecio: 150000, pnl: -0.08, motivoSalida: 'prueba', entradaT: T0, salidaT: T0 },
];

test('métricas de operaciones con penalización de papel 0,1 % por lado (caso a mano)', () => {
  // Penalización = 0,001·(valor de entrada + valor de salida):
  //  op1: 0,001·(1.000 + 1.100) = 2,10 → 100 − 2,10 = 97,90
  //  op2: 0,001·(1.000 + 950)   = 1,95 → −50 − 1,95 = −51,95
  //  op3: 0,001·(1.000 + 1.020) = 2,02 → 20 − 2,02 = 17,98
  //  op4 es la prueba de 15 $: no es de la mesa y no cuenta.
  const m = metricasMesa({ operaciones: OPS, curvaDiaria: [], penalizacionPapel: 0.001, diasActiva: 3 });
  assert.equal(m.operaciones, 3);
  cerca(m.pnlTotal, 63.93);
  cerca(m.pnlBruto, 70);
  cerca(m.penalizacionTotal, 6.07);
  cerca(m.acierto, 2 / 3);
  cerca(m.factorBeneficio, (97.9 + 17.98) / 51.95);
  cerca(m.expectativa, 63.93 / 3);
  // Adherencia: 'señal' y 'stop' son salidas por regla; 'kill' no → 2/3.
  cerca(m.adherencia, 2 / 3);
  assert.equal(m.diasActiva, 3);
  // Sin curva no hay Sharpe (ni ajustado).
  assert.equal(m.sharpe, null);
  assert.equal(m.sharpeAjustado, null);
});

test('Sharpe diario anualizado con √365 y contracción n/(n+30)', () => {
  // Curva 100 → 101 → 99,99 → 101,9898: retornos +1 %, −1 %, +2 %.
  // media = 0,02/3; desviación muestral = √(((0,01−m)² + (−0,01−m)² + (0,02−m)²)/2) = √(0,000466…/2) = 0,0152753
  // Sharpe = 0,0066667/0,0152753·√365 = 8,338.
  const curva = [100, 101, 99.99, 101.9898].map((valor, i) => ({ dia: dia(i), valor }));
  const m = metricasMesa({ operaciones: OPS.slice(0, 3), curvaDiaria: curva, penalizacionPapel: 0 });
  const media = 0.02 / 3;
  const sd = Math.sqrt(((0.01 - media) ** 2 + (-0.01 - media) ** 2 + (0.02 - media) ** 2) / 2);
  cerca(m.sharpe, (media / sd) * Math.sqrt(365), 1e-9);
  cerca(m.sharpe, 8.338, 1e-3);
  // 3 operaciones: 8,338·3/33.
  cerca(m.sharpeAjustado, (m.sharpe * 3) / 33);
  cerca(m.maxDD, 0.01, 1e-12);
});

test('caída máxima: 100 → 120 → 90 → 130 es un 25 %', () => {
  const curva = [100, 120, 90, 130].map((valor, i) => ({ dia: dia(i), valor }));
  cerca(metricasMesa({ curvaDiaria: curva }).maxDD, 0.25);
});

test('la penalización también se resta de la curva el día de cada lado', () => {
  // Curva plana de 1.000 $; una operación de 10 a 100 entra el día 1 y sale el día 2:
  // 1 $ de penalización cada lado → 1.000, 999, 998 → caída 0,2 %.
  const curva = [0, 1, 2].map(i => ({ dia: dia(i), valor: 1000 }));
  const op = { cantidad: 10, entradaPrecio: 100, salidaPrecio: 100, pnl: 0, motivoSalida: 'señal', entradaT: T0 + DIA, salidaT: T0 + 2 * DIA };
  const m = metricasMesa({ operaciones: [op], curvaDiaria: curva, penalizacionPapel: 0.001 });
  cerca(m.maxDD, 0.002, 1e-12);
  cerca(m.pnlTotal, -2);
});

test('un flujo de capital (reasignación) no cuenta como rentabilidad', () => {
  // 100 → 110 (+10 %) → llegan 100 $ de capital y cierra en 220: (220 − 100)/110 − 1 = +9,09 %, no +100 %.
  const curva = [{ dia: dia(0), valor: 100 }, { dia: dia(1), valor: 110 }, { dia: dia(2), valor: 220, flujo: 100 }];
  const m = metricasMesa({ curvaDiaria: curva });
  const r = [0.1, 120 / 110 - 1];
  const media = (r[0] + r[1]) / 2;
  const sd = Math.sqrt(((r[0] - media) ** 2 + (r[1] - media) ** 2) / 1);
  cerca(m.sharpe, (media / sd) * Math.sqrt(365), 1e-9);
  assert.equal(m.maxDD, 0);
});

test('sin operaciones: nada inventado', () => {
  const m = metricasMesa({ operaciones: [], curvaDiaria: [] });
  assert.equal(m.operaciones, 0);
  assert.equal(m.acierto, null);
  assert.equal(m.factorBeneficio, null);
  assert.equal(m.expectativa, null);
  assert.equal(m.adherencia, null);
  assert.equal(m.pnlTotal, 0);
});

test('sharpeRodante usa solo los últimos 90 retornos y exige un mínimo', () => {
  // 150 días: los 59 primeros suben un 2 % diario (no deben contar); después alterna +1 % / −0,5 %.
  const curva = [{ dia: dia(0), valor: 100 }];
  const rs = [];
  for (let i = 1; i < 150; i++) {
    const r = i < 60 ? 0.02 : (i % 2 ? 0.01 : -0.005);
    rs.push(r);
    curva.push({ dia: dia(i), valor: curva[i - 1].valor * (1 + r) });
  }
  const ultimos = rs.slice(-90);
  const media = ultimos.reduce((s, x) => s + x, 0) / 90;
  const sd = Math.sqrt(ultimos.reduce((s, x) => s + (x - media) ** 2, 0) / 89);
  cerca(sharpeRodante(curva, 90), (media / sd) * Math.sqrt(365), 1e-6);
  // 20 días de curva: un Sharpe de tres semanas no se enseña.
  assert.equal(sharpeRodante(curva.slice(0, 20), 90), null);
});

test('alarma de deriva: papel 1 σ (de la media de 30 días) por debajo del backtest', () => {
  // μ = 0,1 % diario, σ = 1 %. Papel −0,1 % diario 30 días: z = (−0,001 − 0,001)·√30/0,01 = −1,095 → alarma.
  const malo = alarmaDeriva({ retornosPapel: Array(30).fill(-0.001), muBacktest: 0.001, sigmaBacktest: 0.01 });
  cerca(malo.z, -0.002 * Math.sqrt(30) / 0.01);
  assert.equal(malo.alarma, true);
  // Papel plano: z = −0,548 → sin alarma.
  const plano = alarmaDeriva({ retornosPapel: Array(30).fill(0).map((r, i) => ({ dia: dia(i), r })), muBacktest: 0.001, sigmaBacktest: 0.01 });
  cerca(plano.z, -0.001 * Math.sqrt(30) / 0.01);
  assert.equal(plano.alarma, false);
  // Con 10 días no se juzga.
  assert.deepEqual(alarmaDeriva({ retornosPapel: Array(10).fill(-0.01), muBacktest: 0.001, sigmaBacktest: 0.01 }), { alarma: false, z: null, n: 10 });
});
