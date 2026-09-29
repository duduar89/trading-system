'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reasignar } = require('../src/aprendizaje/asignador');

const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const suma = pesos => Object.values(pesos).reduce((s, x) => s + x, 0);

// Titular con muestra suficiente por defecto (30 operaciones, 90 días).
function tit(id, vol, sharpeAjustado, pesoActual, { ops = 30, dias = 90, maxDD = 0.1 } = {}) {
  return { id, estado: 'titular', pesoActual, volHistorica: vol, diasActiva: dias, sharpeBacktest: 1, metricas: { operaciones: ops, sharpe: sharpeAjustado, sharpeAjustado, maxDD } };
}
function incu(id, { dias, sharpe, ops, sharpeBacktest = 1.5, pesoActual = 0.02 }) {
  return { id, estado: 'incubacion', pesoActual, volHistorica: 0.4, diasActiva: dias, sharpeBacktest, metricas: { operaciones: ops, sharpe, sharpeAjustado: sharpe, maxDD: 0.05 } };
}

test('suavizado 0,7/0,3 hacia el objetivo de paridad de riesgo inclinado por Sharpe', () => {
  // vols 0,2 / 0,4 / 0,4 / 0,4 → 1/vol = 5; 2,5; 2,5; 2,5 → base 40 %, 20 %, 20 %, 20 %.
  // a con Sharpe ajustado 0,5 → ×1,5: 0,6; 0,2; 0,2; 0,2 (suma 1,2) → objetivo 50 %, 16,67 % ×3.
  // Todos al 25 %: a = 0,7·0,25 + 0,3·0,5 = 32,5 %; resto = 0,175 + 0,05 = 22,5 %. Suma 100 %.
  const r = reasignar({ mesas: [tit('a', 0.2, 0.5, 0.25), tit('b', 0.4, 0, 0.25), tit('c', 0.4, 0, 0.25), tit('d', 0.4, 0, 0.25)] });
  cerca(r.pesos.a, 0.325);
  for (const id of ['b', 'c', 'd']) cerca(r.pesos[id], 0.225);
  cerca(suma(r.pesos), 1);
  cerca(r.detalle.a.objetivo, 0.5);
  assert.equal(r.cambios.length, 4);
  assert.match(r.cambios.find(c => c.id === 'a').motivo, /32,5 %/);
});

test('techo del 40 %: lo que sobra se reparte entre los demás', () => {
  // a con Sharpe ajustado 1 → ×2: 0,8; 0,2 ×3 (suma 1,4) → objetivo 57,14 %, 14,29 % ×3.
  // a = 0,7·0,4 + 0,3·0,5714 = 45,14 % → techo 40 %. El 60 % restante, a partes iguales: 20 % cada uno.
  const r = reasignar({ mesas: [tit('a', 0.2, 1, 0.4), tit('b', 0.4, 0, 0.2), tit('c', 0.4, 0, 0.2), tit('d', 0.4, 0, 0.2)] });
  cerca(r.pesos.a, 0.4);
  for (const id of ['b', 'c', 'd']) cerca(r.pesos[id], 0.2);
  assert.equal(r.detalle.a.limite, 'techo');
  cerca(r.detalle.a.propuesto, 0.28 + 0.3 * (0.8 / 1.4));
  // a ya estaba en el 40 %: no hay cambio que anunciar, y los demás tampoco se mueven.
  assert.deepEqual(r.cambios, []);
  // Si a partía del 30 %, sube y el motivo nombra el techo.
  const r2 = reasignar({ mesas: [tit('a', 0.2, 1, 0.3), tit('b', 0.4, 0, 0.7 / 3), tit('c', 0.4, 0, 0.7 / 3), tit('d', 0.4, 0, 0.7 / 3)] });
  // 0,7·30 % + 0,3·57,14 % = 38,14 %: aún bajo el techo, sin recorte.
  cerca(r2.pesos.a, 0.21 + 0.3 * (0.8 / 1.4), 1e-9);
  const r3 = reasignar({ mesas: [tit('a', 0.1, 1, 0.38), tit('b', 0.4, 0, 0.62 / 3), tit('c', 0.4, 0, 0.62 / 3), tit('d', 0.4, 0, 0.62 / 3)] });
  cerca(r3.pesos.a, 0.4);
  assert.match(r3.cambios.find(c => c.id === 'a').motivo, /Techo del 40,0 %/);
});

test('suelo del 5 %: la mesa más volátil y peor no baja de ahí', () => {
  // vols 0,4 ×3 y 1,6 → 1/vol 2,5 ×3 y 0,625 (suma 8,125) → base de d 7,69 %.
  // d con Sharpe ajustado −0,8 → ×limitar(0,2; 0,5; 2) = ×0,5 → objetivo normalizado 4 % (los otros 32 %).
  // d = 0,7·5 % + 0,3·4 % = 4,7 % → suelo 5 %. Los otros tres se reparten el 95 %: 31,67 %.
  const r = reasignar({ mesas: [tit('a', 0.4, 0, 0.95 / 3), tit('b', 0.4, 0, 0.95 / 3), tit('c', 0.4, 0, 0.95 / 3), tit('d', 1.6, -0.8, 0.05)] });
  cerca(r.detalle.d.objetivo, 0.04);
  cerca(r.detalle.d.propuesto, 0.047);
  cerca(r.pesos.d, 0.05);
  for (const id of ['a', 'b', 'c']) cerca(r.pesos[id], 0.95 / 3);
  assert.equal(r.detalle.d.limite, 'suelo');
  assert.deepEqual(r.despidos, [], 'con 30 operaciones no se despide por Sharpe');
});

test('muestra mínima: con < 20 operaciones o < 60 días el peso no cambia', () => {
  // a tiene 15 operaciones: se queda en 30 %. b (vol 0,2, Sharpe 0,5): objetivo 60 %;
  // 0,7·35 % + 0,3·60 % = 42,5 % → techo 40 %. c: 0,7·35 % + 0,3·20 % = 30,5 % → lo que queda, 30 %.
  const r = reasignar({ mesas: [tit('a', 0.4, 0, 0.3, { ops: 15 }), tit('b', 0.2, 0.5, 0.35), tit('c', 0.4, 0, 0.35)] });
  cerca(r.pesos.a, 0.3);
  cerca(r.pesos.b, 0.4);
  cerca(r.pesos.c, 0.3);
  assert.equal(r.cambios.find(c => c.id === 'a'), undefined);
  // Por días igual: 45 días con 50 operaciones.
  const r2 = reasignar({ mesas: [tit('a', 0.4, 2, 0.3, { dias: 45, ops: 50 }), tit('b', 0.4, 0, 0.35), tit('c', 0.4, 0, 0.35)] });
  cerca(r2.pesos.a, 0.3);
  // Primer mes: nadie tiene muestra → no cambia nada.
  const r3 = reasignar({ mesas: [tit('a', 0.2, 1, 0.25, { dias: 30 }), tit('b', 0.4, -1, 0.25, { dias: 30 }), tit('c', 0.4, 0, 0.25, { dias: 30 }), tit('d', 0.4, 0, 0.25, { dias: 30 })] });
  assert.deepEqual(r3.cambios, []);
});

test('despido por Sharpe ajustado < −0,5 con ≥ 40 operaciones: banquillo, peso 0; lo suyo se reparte', () => {
  // d: −0,6 con 45 operaciones → fuera. a, b, c (iguales): objetivo 1/3; 0,7·25 % + 0,3·33,3 % = 27,5 % → normalizado a 33,3 %.
  const r = reasignar({ mesas: [tit('a', 0.4, 0, 0.25), tit('b', 0.4, 0, 0.25), tit('c', 0.4, 0, 0.25), tit('d', 0.4, -0.6, 0.25, { ops: 45 })] });
  assert.deepEqual(r.despidos, ['d']);
  assert.equal(r.pesos.d, 0);
  for (const id of ['a', 'b', 'c']) cerca(r.pesos[id], 1 / 3);
  const c = r.cambios.find(x => x.id === 'd');
  assert.equal(c.de, 0.25);
  assert.equal(c.a, 0);
  assert.match(c.motivo, /-0,60 con 45 operaciones/);
  // Con 39 operaciones no.
  assert.deepEqual(reasignar({ mesas: [tit('a', 0.4, 0, 0.5), tit('d', 0.4, -0.6, 0.5, { ops: 39 })] }).despidos, []);
});

test('despido por caída máxima de la mesa > 25 %, aunque la muestra sea corta', () => {
  const r = reasignar({ mesas: [tit('a', 0.4, 0, 0.3), tit('b', 0.4, 0, 0.35), tit('c', 0.4, 0, 0.35, { ops: 5, dias: 20, maxDD: 0.26 })] });
  assert.deepEqual(r.despidos, ['c']);
  assert.match(r.cambios.find(x => x.id === 'c').motivo, /26,0 %/);
  assert.equal(reasignar({ mesas: [tit('a', 0.4, 0, 0.5), tit('c', 0.4, 0, 0.5, { maxDD: 0.25 })] }).despidos.length, 0);
});

test('incubación: 2 % fijo y los titulares se reparten el 98 %', () => {
  const r = reasignar({ mesas: [tit('a', 0.4, 0, 1 / 3), tit('b', 0.4, 0, 1 / 3), tit('c', 0.4, 0, 1 / 3), incu('n', { dias: 30, sharpe: 0, ops: 3, pesoActual: null })] });
  cerca(r.pesos.n, 0.02);
  for (const id of ['a', 'b', 'c']) cerca(r.pesos[id], 0.98 / 3);
  cerca(suma(r.pesos), 1);
  cerca(r.presupuestoTitulares, 0.98);
});

test('incubación ≥ 60 días: asciende con Sharpe papel > backtest − 1 y ≥ 10 operaciones; entra al suelo', () => {
  // Sharpe papel 0,8 > 1,5 − 1 = 0,5 y 12 operaciones → titular. Con 12 < 20 operaciones su peso no se
  // mueve por Sharpe: se queda en el 2 % que tenía, que el suelo sube al 5 %. Los otros se reparten el 95 %.
  const r = reasignar({ mesas: [tit('a', 0.4, 0, 0.98 / 3), tit('b', 0.4, 0, 0.98 / 3), tit('c', 0.4, 0, 0.98 / 3), incu('n', { dias: 65, sharpe: 0.8, ops: 12 })] });
  assert.deepEqual(r.ascensos, ['n']);
  cerca(r.pesos.n, 0.05);
  for (const id of ['a', 'b', 'c']) cerca(r.pesos[id], 0.95 / 3);
  cerca(suma(r.pesos), 1);
  assert.match(r.cambios.find(x => x.id === 'n').motivo, /Asciende/);
});

test('incubación ≥ 60 días que no llega: se descarta (Sharpe o número de operaciones)', () => {
  const r = reasignar({ mesas: [
    tit('a', 0.4, 0, 0.49), tit('b', 0.4, 0, 0.49),
    incu('x', { dias: 61, sharpe: 0.3, ops: 25 }),     // 0,3 ≤ 1,5 − 1
    incu('y', { dias: 61, sharpe: 0.9, ops: 7 }),      // 7 < 10 operaciones
    incu('z', { dias: 59, sharpe: -3, ops: 1 }),       // aún en incubación
  ] });
  assert.deepEqual(r.descartes, ['x', 'y']);
  assert.equal(r.pesos.x, 0);
  assert.equal(r.pesos.y, 0);
  cerca(r.pesos.z, 0.02);
  assert.match(r.cambios.find(c => c.id === 'y').motivo, /7 operaciones/);
});

test('primer reparto (sin peso actual): paridad de riesgo; banquillo a 0', () => {
  const r = reasignar({ mesas: [
    tit('a', 0.2, null, null), tit('b', 0.4, null, null), tit('c', 0.4, null, null), tit('d', 0.4, null, null),
    { id: 'e', estado: 'banquillo', pesoActual: 0, volHistorica: 0.3, metricas: {} },
  ] });
  cerca(r.pesos.a, 0.4);
  for (const id of ['b', 'c', 'd']) cerca(r.pesos[id], 0.2);
  assert.equal(r.pesos.e, 0);
  cerca(suma(r.pesos), 1);
});

test('una mesa con estado desconocido (ya descartada) no recibe capital', () => {
  const r = reasignar({ mesas: [tit('a', 0.4, 0, 1 / 3), tit('b', 0.4, 0, 1 / 3), tit('c', 0.4, 0, 1 / 3), { ...tit('x', 0.1, 2, 0), estado: 'descartada' }] });
  assert.equal(r.pesos.x, 0);
  for (const id of ['a', 'b', 'c']) cerca(r.pesos[id], 1 / 3);
});

test('con muy pocas mesas el techo manda y el resto queda en efectivo', () => {
  // Dos titulares: como mucho 40 % + 40 %.
  const r = reasignar({ mesas: [tit('a', 0.2, 0, 0.5), tit('b', 0.4, 0, 0.5)] });
  cerca(r.pesos.a, 0.4);
  cerca(r.pesos.b, 0.4);
});
