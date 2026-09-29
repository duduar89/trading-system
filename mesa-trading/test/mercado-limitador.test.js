'use strict';
// Limitador compartido (≤ 180/min) y esperas de reintento (§3.1).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Limitador, esperaReintento } = require('../src/mercado/limitador');

// Reloj falso: dormir avanza el tiempo al instante.
function relojFalso() {
  const r = { t: 0, esperas: [] };
  r.ahora = () => r.t;
  r.dormir = async ms => { r.esperas.push(ms); r.t += ms; };
  return r;
}

test('deja pasar el máximo por minuto y el siguiente espera a que salga el primero de la ventana', async () => {
  const r = relojFalso();
  const l = new Limitador({ maxPorMinuto: 3, ahora: r.ahora, dormir: r.dormir });
  const instantes = [];
  for (let i = 0; i < 4; i++) { await l.turno(); instantes.push(r.t); r.t += 1000; }
  // 0, 1000, 2000 pasan; la 4.ª (en t=3000) espera hasta 60.001.
  assert.deepEqual(instantes, [0, 1000, 2000, 60_001]);
});

test('180 por minuto por defecto: 180 pasan sin esperar, la 181 espera', async () => {
  const r = relojFalso();
  const l = new Limitador({ ahora: r.ahora, dormir: r.dormir });
  for (let i = 0; i < 180; i++) await l.turno();
  assert.equal(r.esperas.length, 0);
  await l.turno();
  assert.equal(r.esperas.length, 1);
  assert.ok(r.t >= 60_000);
});

test('peticiones simultáneas se ponen en cola sin colarse', async () => {
  const r = relojFalso();
  const l = new Limitador({ maxPorMinuto: 2, ahora: r.ahora, dormir: r.dormir });
  const orden = [];
  await Promise.all([0, 1, 2, 3].map(i => l.turno().then(() => orden.push([i, r.t]))));
  assert.deepEqual(orden.map(x => x[0]), [0, 1, 2, 3]);
  assert.equal(orden[1][1], 0);
  assert.ok(orden[2][1] >= 60_000);
});

test('frenar() tras un 429 para a todos hasta que pase la espera', async () => {
  const r = relojFalso();
  const l = new Limitador({ maxPorMinuto: 180, ahora: r.ahora, dormir: r.dormir });
  l.frenar(5000);
  await l.turno();
  assert.equal(r.t, 5000);
  assert.equal(l.estado().frenadoHasta, null);
});

test('espera de reintento: Retry-After, reset de cuota o 1-2-4-8…60 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(i => esperaReintento(i)), [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  assert.equal(esperaReintento(0, { retryAfter: '7' }), 7000);
  assert.equal(esperaReintento(3, { retryAfter: 'Wed, 30 Sep 2026 00:00:10 GMT', ahora: Date.parse('2026-09-30T00:00:00Z') }), 10_000);
  assert.equal(esperaReintento(0, { restantes: '0', reset: '100', ahora: 98_000 }), 2250);
  assert.equal(esperaReintento(2, { restantes: '5', reset: '100', ahora: 98_000 }), 4000, 'con cuota no se usa reset');
});
