'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ind = require('../src/mercado/indicadores');
const { serieSintetica, velasAMano } = require('./cuant-ayuda');

const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
function cercaArray(a, b, tol = 1e-9) {
  assert.equal(a.length, b.length);
  a.forEach((x, i) => (b[i] === null ? assert.equal(x, null, `índice ${i}`) : cerca(x, b[i], tol)));
}

test('SMA: [1,2,3,4,5] con n=3 → medias de 3 en 3, null al principio', () => {
  // (1+2+3)/3 = 2, (2+3+4)/3 = 3, (3+4+5)/3 = 4
  cercaArray(ind.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('EMA: [2,4,6,8,4] con n=3 → semilla SMA y k = 2/(n+1) = 0,5', () => {
  // semilla en i=2: (2+4+6)/3 = 4; i=3: 8·0,5 + 4·0,5 = 6; i=4: 4·0,5 + 6·0,5 = 5
  cercaArray(ind.ema([2, 4, 6, 8, 4], 3), [null, null, 4, 6, 5]);
});

test('RSI de Wilder con n=2 sobre una serie corta', () => {
  // cambios: +1, −0,5, +1, −0,5, −1
  // i=2: subida media (1+0)/2 = 0,5; bajada (0+0,5)/2 = 0,25 → RS 2 → 100 − 100/3 = 66,667
  // i=3: sube (0,5+1)/2 = 0,75; baja (0,25+0)/2 = 0,125 → RS 6 → 100 − 100/7 = 85,714
  // i=4: sube 0,375; baja (0,125+0,5)/2 = 0,3125 → RS 1,2 → 100 − 100/2,2 = 54,545
  // i=5: sube 0,1875; baja (0,3125+1)/2 = 0,65625 → RS 0,2857 → 100 − 100/1,2857 = 22,222
  cercaArray(ind.rsi([10, 11, 10.5, 11.5, 11, 10], 2),
    [null, null, 100 - 100 / 3, 100 - 100 / 7, 100 - 100 / 2.2, 100 - 100 / (1 + 0.1875 / 0.65625)]);
});

test('RSI: sin bajadas vale 100 y plano vale 50', () => {
  assert.deepEqual(ind.rsi([1, 2, 3, 4], 2).slice(2), [100, 100]);
  assert.deepEqual(ind.rsi([5, 5, 5, 5], 2).slice(2), [50, 50]);
});

test('ATR de Wilder (n=3) con huecos: rango verdadero y suavizado a mano', () => {
  const velas = velasAMano([
    [9, 10, 8, 9],        // TR 2 (h−l)
    [9, 12, 9, 11],       // TR max(3, |12−9|, |9−9|) = 3
    [11, 11.5, 10, 10],   // TR max(1,5, 0,5, 1) = 1,5
    [10, 10.5, 7, 8],     // TR max(3,5, 0,5, 3) = 3,5
    [12, 13, 12, 12.5],   // hueco al alza: TR max(1, |13−8|=5, 4) = 5
  ]);
  assert.deepEqual(ind.rangoVerdadero(velas), [2, 3, 1.5, 3.5, 5]);
  // i=2: (2+3+1,5)/3 = 13/6; i=3: (13/6·2 + 3,5)/3 = 47/18; i=4: (47/18·2 + 5)/3 = 92/27
  cercaArray(ind.atr(velas, 3), [null, null, 13 / 6, 47 / 18, 92 / 27]);
});

test('máximo y mínimo de ventana INCLUYEN la vela i', () => {
  const x = [3, 1, 4, 1, 5, 9, 2];
  assert.deepEqual(ind.maximo(x, 3), [null, null, 4, 4, 5, 9, 9]);
  assert.deepEqual(ind.minimo(x, 3), [null, null, 1, 1, 1, 1, 2]);
});

test('rentabilidad a n periodos: c[i]/c[i−n] − 1', () => {
  // 121/100 − 1 = 0,21; 99/110 − 1 = −0,1
  cercaArray(ind.rentabilidad([100, 110, 121, 99], 2), [null, null, 0.21, -0.1]);
});

test('volatilidad: desviación muestral de log-rentabilidades, anualizada', () => {
  // i=2: ln(1,1) y ln(1,1) → desviación 0
  // i=3: ln(1,1) = 0,0953102 y ln(99/121) = −0,2006707; con n=2 la desviación
  //      muestral es |diferencia|/√2 = 0,2092901; × √4 (periodosAnio 4) = 0,4185802
  const v = ind.volatilidad([100, 110, 121, 99], 2, 4);
  assert.equal(v[0], null);
  assert.equal(v[1], null);
  cerca(v[2], 0, 1e-12);
  cerca(v[3], (Math.abs(Math.log(1.1) - Math.log(99 / 121)) / Math.SQRT2) * 2, 1e-12);
  cerca(v[3], 0.41858016800490977, 1e-12);
});

test('percentil histórico: % de valores previos ≤ el actual', () => {
  // 5 → 1/1; 3 → 1/2; 4 → 2/3; 1 → 1/4; 9 → 5/5
  assert.deepEqual(ind.percentilHistorico([5, 3, 4, 1, 9]), [100, 50, 200 / 3, 25, 100]);
  assert.deepEqual(ind.percentilHistorico([5, 3, 4], 3), [null, null, 200 / 3]);
});

test('percentil móvil: solo la ventana cuenta y la entrada que sale se olvida', () => {
  // ventana 3: i=2 → [5,3,4]: 4 es ≤ que 3 y 4 → 2/3; i=3 → [3,4,1]: 1 → 1/3;
  // i=4 → [4,1,9]: 9 → 3/3; i=5 → [1,9,4]: 4 → 2/3
  assert.deepEqual(ind.percentilMovil([5, 3, 4, 1, 9, 4], 3), [null, null, 200 / 3, 100 / 3, 100, 200 / 3]);
  // valores repetidos: al salir un 2 se quita solo uno
  assert.deepEqual(ind.percentilMovil([2, 2, 1, 2], 2), [null, 100, 50, 100]);
});

test('todas alineadas: mismo largo que la entrada', () => {
  const velas = serieSintetica(300, 3);
  const c = ind.cierres(velas);
  for (const arr of [ind.sma(c, 20), ind.ema(c, 20), ind.rsi(c, 14), ind.atr(velas, 14), ind.maximo(c, 20),
    ind.minimo(c, 20), ind.rentabilidad(c, 20), ind.volatilidad(c, 30, 365), ind.percentilHistorico(c)]) {
    assert.equal(arr.length, velas.length);
  }
});

test('CAUSALIDAD: añadir 50 velas futuras no cambia ningún valor ya calculado', () => {
  const todas = serieSintetica(2350, 11); // > 2.000 para cruzar el recálculo de sumas rodantes
  const N = 2300;
  const pocas = todas.slice(0, N);
  const calc = velas => {
    const c = ind.cierres(velas);
    return {
      sma: ind.sma(c, 50), ema: ind.ema(c, 21), rsi: ind.rsi(c, 2), atr: ind.atr(velas, 14),
      max: ind.maximo(velas.map(v => v.h), 20), min: ind.minimo(velas.map(v => v.l), 10),
      rent: ind.rentabilidad(c, 28), vol: ind.volatilidad(c, 30, 365), pct: ind.percentilHistorico(ind.volatilidad(c, 30, 365), 90),
      pctMovil: ind.percentilMovil(ind.volatilidad(c, 30, 365), 365),
    };
  };
  const a = calc(pocas);
  const b = calc(todas);
  for (const k of Object.keys(a)) assert.deepEqual(b[k].slice(0, N), a[k], `indicador ${k}`);
});

test('nulls encadenados: sma de un rsi empieza cuando hay n valores válidos', () => {
  const r = ind.rsi([1, 2, 3, 2, 3, 4, 3], 2); // null, null, valores…
  const s = ind.sma(r, 2);
  assert.equal(s[2], null);
  assert.ok(s[3] !== null);
});
