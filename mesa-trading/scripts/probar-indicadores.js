'use strict';
// Casos conocidos de indicadores, régimen y dimensionado: cada uno calculado a
// mano (el razonamiento está en test/cuant-*.test.js). Imprime OK/FALLO por
// caso y sale con código 1 si alguno falla.
//
//   node scripts/probar-indicadores.js

const assert = require('node:assert/strict');
const ind = require('../src/mercado/indicadores');
const { calcularRegimen, regimenEnFecha } = require('../src/mercado/regimen');
const { dimensionar } = require('../src/cuant/dimensionado');

let fallos = 0;
function caso(nombre, fn) {
  try {
    fn();
    console.log(`OK     ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`FALLO  ${nombre}\n       ${String(e.message).split('\n').join('\n       ')}`);
  }
}
const cerca = (a, b, tol = 1e-9) => assert.ok(a !== null && Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const DIA = 86_400_000;
const T0 = Date.UTC(2020, 0, 6);
const velasAMano = filas => filas.map(([o, h, l, c], i) => ({ t: T0 + i * DIA, o, h, l, c, v: 0 }));

caso('SMA(3) de [1,2,3,4,5] = [–,–,2,3,4]', () => {
  assert.deepEqual(ind.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

caso('EMA(3) de [2,4,6,8,4] = [–,–,4,6,5] (semilla SMA, k = 0,5)', () => {
  assert.deepEqual(ind.ema([2, 4, 6, 8, 4], 3), [null, null, 4, 6, 5]);
});

caso('RSI(2) de Wilder de [10; 11; 10,5; 11,5; 11; 10] = 66,67 / 85,71 / 54,55 / 22,22', () => {
  const r = ind.rsi([10, 11, 10.5, 11.5, 11, 10], 2);
  cerca(r[2], 100 - 100 / 3);
  cerca(r[3], 100 - 100 / 7);
  cerca(r[4], 100 - 100 / 2.2);
  cerca(r[5], 100 - 100 / (1 + 0.1875 / 0.65625));
});

caso('ATR(3) de Wilder con hueco: TR [2; 3; 1,5; 3,5; 5] → 13/6, 47/18, 92/27', () => {
  const velas = velasAMano([[9, 10, 8, 9], [9, 12, 9, 11], [11, 11.5, 10, 10], [10, 10.5, 7, 8], [12, 13, 12, 12.5]]);
  const a = ind.atr(velas, 3);
  cerca(a[2], 13 / 6);
  cerca(a[3], 47 / 18);
  cerca(a[4], 92 / 27);
});

caso('máximo/mínimo(3) incluyen la vela i', () => {
  assert.deepEqual(ind.maximo([3, 1, 4, 1, 5, 9, 2], 3), [null, null, 4, 4, 5, 9, 9]);
  assert.deepEqual(ind.minimo([3, 1, 4, 1, 5, 9, 2], 3), [null, null, 1, 1, 1, 1, 2]);
});

caso('rentabilidad(2) de [100,110,121,99] = [–,–,21 %,−10 %]', () => {
  const r = ind.rentabilidad([100, 110, 121, 99], 2);
  cerca(r[2], 0.21);
  cerca(r[3], -0.1);
});

caso('volatilidad(2, 4 periodos/año) de [100,110,121,99] = 0,41858', () => {
  cerca(ind.volatilidad([100, 110, 121, 99], 2, 4)[3], 0.41858016800490977, 1e-12);
});

caso('percentil móvil (ventana 3) de [5,3,4,1,9,4] = [–,–,66,7,33,3,100,66,7]', () => {
  assert.deepEqual(ind.percentilMovil([5, 3, 4, 1, 9, 4], 3), [null, null, 200 / 3, 100 / 3, 100, 200 / 3]);
});

caso('causalidad: 50 velas más no cambian ningún valor ya calculado (2.300 velas)', () => {
  let p = 100;
  let s = 7;
  const azar = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  const velas = Array.from({ length: 2350 }, (_, i) => {
    const o = p; p = p * (1 + 0.04 * azar());
    return { t: T0 + i * DIA, o, h: Math.max(o, p) * 1.01, l: Math.min(o, p) * 0.99, c: p, v: 0 };
  });
  const calc = v => {
    const c = ind.cierres(v);
    return [ind.sma(c, 50), ind.ema(c, 21), ind.rsi(c, 2), ind.atr(v, 14), ind.maximo(c, 20), ind.minimo(c, 10),
      ind.rentabilidad(c, 28), ind.volatilidad(c, 30, 365)];
  };
  const a = calc(velas.slice(0, 2300));
  const b = calc(velas);
  a.forEach((serie, k) => assert.deepEqual(b[k].slice(0, 2300), serie, `indicador ${k}`));
});

caso('régimen: BTC subiendo (cierres 100..349) → +1 +1 0 = RISK-ON; con SPY bajando → NEUTRAL', () => {
  const diaria = cc => cc.map((c, i) => ({ t: T0 + i * DIA, o: c, h: c, l: c, c, v: 0 }));
  const sube = diaria(Array.from({ length: 250 }, (_, i) => 100 + i));
  const baja = diaria(Array.from({ length: 250 }, (_, i) => 400 - i));
  const r = calcularRegimen({ btcDiario: sube });
  assert.equal(r.valor, 'RISK-ON');
  assert.equal(r.puntos, 2);
  assert.equal(calcularRegimen({ btcDiario: sube, spyDiario: baja }).valor, 'NEUTRAL');
  assert.equal(calcularRegimen({ btcDiario: baja }).valor, 'RISK-OFF');
  assert.deepEqual(regimenEnFecha(sube, null, sube[249].t + DIA), r);
});

// Límites del fondo (src/config.js): riesgo por operación 1 % desde el 30-sep-2026 (antes 0,5 %).
const LIM_FONDO = { riesgoPorOperacion: 0.01, maxPesoPorActivo: 0.10 };

caso('dimensionado: 10.000·0,5 con vol 80 % y objetivo 40 % → 2.500 $ (volatilidad)', () => {
  const r = dimensionar({ capitalMesa: 10000, peso: 0.5, precio: 100, stop: 95, volAnual: 0.8, patrimonio: 100000,
    limites: LIM_FONDO });
  cerca(r.nocional, 2500);
  assert.equal(r.limitadoPor, 'volatilidad');
});

caso('dimensionado: stop al 50 % → 1 % de 100.000 / 0,50 = 2.000 $ (riesgo)', () => {
  // Con el 1 %, el stop al 25 % daría 4.000 $ y mandaría la volatilidad (2.500 $).
  const r = dimensionar({ capitalMesa: 10000, peso: 0.5, precio: 100, stop: 50, volAnual: 0.8, patrimonio: 100000,
    limites: LIM_FONDO });
  cerca(r.nocional, 2000);
  assert.equal(r.limitadoPor, 'riesgo');
});

caso('dimensionado: stop al 25 % con vol 10 % → 1 % de 100.000 / 0,25 = 4.000 $ (riesgo)', () => {
  const r = dimensionar({ capitalMesa: 10000, peso: 0.5, precio: 100, stop: 75, volAnual: 0.1, patrimonio: 100000,
    limites: LIM_FONDO });
  cerca(r.nocional, 4000);
  assert.equal(r.limitadoPor, 'riesgo');
});

caso('dimensionado: tope por activo 10 % de 100.000 = 10.000 $ (maxActivo)', () => {
  const r = dimensionar({ capitalMesa: 200000, peso: 1, precio: 50, stop: null, volAnual: 0.2, patrimonio: 100000,
    limites: LIM_FONDO });
  cerca(r.nocional, 10000);
  assert.equal(r.limitadoPor, 'maxActivo');
});

console.log(fallos ? `\n${fallos} caso(s) FALLAN` : '\nTodos los casos cuadran');
process.exit(fallos ? 1 : 0);
