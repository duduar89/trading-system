'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dimensionar } = require('../src/cuant/dimensionado');

// Los del fondo (src/config.js): riesgo por operación 1 % desde el 30-sep-2026 (antes 0,5 %).
const LIM = { riesgoPorOperacion: 0.01, maxPesoPorActivo: 0.10 };
const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('recorta por volatilidad: 5.000 × min(1, 0,40/0,80) = 2.500', () => {
  // peso 10.000·0,5 = 5.000 · volatilidad 5.000·0,5 = 2.500 ·
  // riesgo 0,01·100.000/0,05 = 20.000 · maxActivo 0,10·100.000 = 10.000
  const r = dimensionar({ capitalMesa: 10000, peso: 0.5, precio: 100, stop: 95, volAnual: 0.8, patrimonio: 100000, limites: LIM });
  cerca(r.nocional, 2500);
  cerca(r.cantidad, 25);
  assert.equal(r.limitadoPor, 'volatilidad');
});

test('recorta por riesgo: stop al 50 % → 1.000 $ de riesgo / 0,50 = 2.000', () => {
  // Con el 1 %, el stop al 25 % daría 4.000 y mandaría la volatilidad (2.500): hace falta un stop más lejano.
  const r = dimensionar({ capitalMesa: 10000, peso: 0.5, precio: 100, stop: 50, volAnual: 0.8, patrimonio: 100000, limites: LIM });
  cerca(r.nocional, 2000);
  assert.equal(r.limitadoPor, 'riesgo');
  // El 1 % es el doble que el 0,5 %: el mismo stop al 25 % pasa de 2.000 a 4.000 $ de tope por riesgo.
  const antes = dimensionar({ capitalMesa: 10000, peso: 0.5, precio: 100, stop: 75, volAnual: 0.8, patrimonio: 100000, limites: { ...LIM, riesgoPorOperacion: 0.005 } });
  const ahora = dimensionar({ capitalMesa: 10000, peso: 0.5, precio: 100, stop: 75, volAnual: 0.1, patrimonio: 100000, limites: LIM });
  cerca(antes.nocional, 2000);
  assert.equal(antes.limitadoPor, 'riesgo');
  cerca(ahora.nocional, 4000);
  assert.equal(ahora.limitadoPor, 'riesgo');
});

test('recorta por máximo por activo: 10 % de 100.000 = 10.000', () => {
  const r = dimensionar({ capitalMesa: 200000, peso: 1, precio: 50, stop: null, volAnual: 0.2, patrimonio: 100000, limites: LIM });
  cerca(r.nocional, 10000);
  cerca(r.cantidad, 200);
  assert.equal(r.limitadoPor, 'maxActivo');
});

test('sin recortes manda el peso (y en empate gana el primero de la lista)', () => {
  const r = dimensionar({ capitalMesa: 10000, peso: 0.25, precio: 20, stop: 19, volAnual: 0.3, patrimonio: 100000, limites: LIM });
  // peso 2.500; volatilidad 2.500·min(1, 1,33) = 2.500 (empate) → 'peso'
  cerca(r.nocional, 2500);
  assert.equal(r.limitadoPor, 'peso');
});

test('volObjetivo configurable: ETF con objetivo 15 %', () => {
  const r = dimensionar({ capitalMesa: 10000, peso: 0.5, precio: 400, stop: 380, volAnual: 0.3, patrimonio: 1e6, limites: LIM, volObjetivo: 0.15 });
  cerca(r.nocional, 2500); // 5.000 · 0,15/0,30
});

test('stop en o por encima del precio → no se abre (nocional 0 por riesgo)', () => {
  const r = dimensionar({ capitalMesa: 10000, peso: 0.5, precio: 100, stop: 100, volAnual: 0.5, patrimonio: 100000, limites: LIM });
  assert.equal(r.nocional, 0);
  assert.equal(r.limitadoPor, 'riesgo');
});

test('precio inválido lanza error', () => {
  assert.throws(() => dimensionar({ capitalMesa: 1, peso: 1, precio: 0, limites: LIM }));
});
