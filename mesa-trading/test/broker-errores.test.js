'use strict';
// Clasificación de errores de Alpaca en los tipos del contrato (§3.4, ficha §5).
const test = require('node:test');
const assert = require('node:assert/strict');
const { ErrorBroker, clasificarAlpaca, errorDesdeRespuesta, errorDeRed, TIPOS } = require('../src/broker/errores');

test('ErrorBroker lleva status, tipo, reintentable y cuerpo', () => {
  const e = new ErrorBroker('x', { status: 429, tipo: 'limite', cuerpo: { a: 1 } });
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'ErrorBroker');
  assert.equal(e.status, 429);
  assert.equal(e.tipo, 'limite');
  assert.equal(e.reintentable, true);
  assert.deepEqual(e.cuerpo, { a: 1 });
  assert.equal(new ErrorBroker('y', { tipo: 'fondos' }).reintentable, false);
  assert.equal(new ErrorBroker('z', { tipo: 'inventado' }).tipo, 'desconocido');
  assert.deepEqual(TIPOS, ['fondos', 'cantidad', 'invalida', 'lavado', 'limite', 'auth', 'red', 'mercado_cerrado', 'desconocido']);
});

// Mensajes literales de la ficha §5.
const CASOS = [
  [401, { message: 'unauthorized.' }, 'auth'],
  [401, '<html><body>401 Authorization Required</body></html>', 'auth'],
  [403, { code: 40310000, message: 'insufficient buying power' }, 'fondos'],
  [403, { code: 40310000, message: 'insufficient qty available for order (requested: 2, available: 1)' }, 'cantidad'],
  [403, { message: 'insufficient balance for USD (requested: 1000, available: 10)' }, 'fondos'],
  [403, { message: 'insufficient balance for BTC (requested: 0.5, available: 0.1)' }, 'cantidad'],
  [403, { message: 'potential wash trade detected. use complex orders' }, 'lavado'],
  [403, { code: 40310000, message: 'account is not allowed to short' }, 'cantidad'],
  [403, { code: 40310000, message: 'asset "BRK.A" is not fractionable' }, 'invalida'],
  [403, { code: 40310000, message: 'account is restricted to liquidation only' }, 'desconocido'],
  [422, { code: 40010001, message: 'client_order_id must be unique' }, 'invalida'],
  [422, { code: 42210000, message: 'fractional orders must be DAY orders' }, 'invalida'],
  [422, { message: 'notional must be >= 1.00' }, 'invalida'],
  [400, { message: 'invalid symbol: BTCUSD does not match ^[A-Z]+x?/[A-Z]+$' }, 'invalida'],
  [429, 'Too Many Requests', 'limite'],
  [500, { message: 'internal server error' }, 'red'],
  [503, '', 'red'],
  [504, '', 'red'],
];

for (const [status, cuerpo, tipo] of CASOS) {
  test(`HTTP ${status} «${typeof cuerpo === 'string' ? cuerpo.slice(0, 30) : cuerpo.message}» → ${tipo}`, () => {
    assert.equal(clasificarAlpaca(status, cuerpo), tipo);
    const e = errorDesdeRespuesta(status, cuerpo, 'POST /v2/orders');
    assert.equal(e.tipo, tipo);
    assert.equal(e.status, status);
    assert.equal(e.reintentable, tipo === 'limite' || tipo === 'red');
  });
}

test('un fallo de red es tipo red y reintentable', () => {
  const e = errorDeRed(new Error('socket hang up'), 'GET /v2/account');
  assert.equal(e.tipo, 'red');
  assert.equal(e.reintentable, true);
  assert.equal(e.status, null);
  assert.match(e.message, /socket hang up/);
});
