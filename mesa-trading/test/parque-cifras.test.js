'use strict';
// Parqué · cifras: el formato del navegador (web/js/cifras.js) debe dar lo mismo
// que el del servidor (src/util/formato.js), y las cifras animadas no rebotan.
const test = require('node:test');
const assert = require('node:assert/strict');
const cifras = require('../web/js/cifras.js');
const formato = require('../src/util/formato.js');

test('casos conocidos de formato (calculados a mano)', () => {
  // ≥ 1.000 $ sin decimales y con punto de miles aunque tenga 4 cifras.
  assert.equal(cifras.usd(99999), '99.999 $');
  assert.equal(cifras.usd(1234.5), '1.235 $');          // 1.234,5 redondea a 1.235
  // < 1.000 $ con dos decimales; el signo solo si se pide y es positivo.
  assert.equal(cifras.usd(-1), '-1,00 $');
  assert.equal(cifras.usd(187.85, { signo: true }), '+187,85 $');
  // Fracción → %: 0,0125 = 1,25 %.
  assert.equal(cifras.pct(-0.0125), '-1,25 %');
  assert.equal(cifras.pct(0.0019, { signo: true }), '+0,19 %');
  assert.equal(cifras.pct(0.15, { decimales: 0 }), '15 %');
  // Precio: decimales según lo caro que es el activo.
  assert.equal(cifras.precio(83547), '83.547');
  assert.equal(cifras.precio(142.37), '142,37');
  assert.equal(cifras.precio(2.5), '2,500');
  assert.equal(cifras.precio(0.1234), '0,1234');
  assert.equal(cifras.usd(NaN), '—');
  assert.equal(cifras.pct(null), '—');
});

test('mismo resultado que src/util/formato.js en una batería de valores', () => {
  const valores = [0, 1, -1, 0.5, 9.999, 10, 999.994, 999.995, 1000, 1234, 1234.5, -1234.5, 99999, 100503.27, -45678.9, 0.1234, 0.00012, 1e6];
  for (const v of valores) {
    assert.equal(cifras.usd(v), formato.usd(v), `usd(${v})`);
    assert.equal(cifras.usd(v, { signo: true }), formato.usd(v, { signo: true }), `usd(${v}, signo)`);
    assert.equal(cifras.precio(v), formato.precio(v), `precio(${v})`);
    assert.equal(cifras.cantidad(v), formato.cantidad(v), `cantidad(${v})`);
    assert.equal(cifras.numero(v, 2), formato.numero(v, 2), `numero(${v}, 2)`);
  }
  for (const f of [0, 0.0019, -0.0074, 0.15, -0.035, 1.5, 12.3456]) {
    assert.equal(cifras.pct(f), formato.pct(f), `pct(${f})`);
    assert.equal(cifras.pct(f, { decimales: 0, signo: true }), formato.pct(f, { decimales: 0, signo: true }), `pct(${f}, 0, signo)`);
  }
  // La hora en la misma zona sale igual.
  const t = Date.UTC(2026, 8, 29, 19, 44);
  assert.equal(cifras.hora(t, 'Europe/Madrid'), formato.hora(t, 'Europe/Madrid'));
  assert.equal(cifras.hora(t, 'Europe/Madrid'), '21:44');   // 19:44 UTC = 21:44 en Madrid (horario de verano)
});

test('cuenta atrás del comité en HH:MM, redondeando hacia arriba', () => {
  assert.equal(cifras.cuentaAtras(83 * 60000), '01:23');
  assert.equal(cifras.cuentaAtras(4 * 3600000), '04:00');
  assert.equal(cifras.cuentaAtras(30000), '00:01');         // medio minuto no es «00:00»
  assert.equal(cifras.cuentaAtras(0), '00:00');
  assert.equal(cifras.cuentaAtras(-5000), '00:00');
});

test('la curva de las cifras animadas no se pasa del valor final (sin rebote)', () => {
  assert.equal(cifras.suavizar(0), 0);
  assert.equal(cifras.suavizar(1), 1);
  assert.equal(cifras.suavizar(0.5), 0.875);                 // 1 − (1 − 0,5)³ = 0,875
  let previo = -1;
  for (let p = 0; p <= 1.5; p += 0.01) {
    const v = cifras.suavizar(p);
    assert.ok(v >= previo - 1e-12, 'monótona');
    assert.ok(v <= 1, 'nunca por encima del final');
    previo = v;
  }
});

test('clase de color por signo', () => {
  assert.equal(cifras.claseSigno(3), 'pos');
  assert.equal(cifras.claseSigno(-3), 'neg');
  assert.equal(cifras.claseSigno(0.001, 0.005), 'cero');
  assert.equal(cifras.claseSigno(undefined), 'cero');
});
