'use strict';
// Universo y símbolos canónicos (§2).
const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('../src/mercado/universo');

test('20 activos: 10 cripto con barra, 9 ETF operables y VIXY solo como dato (30-sep-2026)', () => {
  assert.equal(u.UNIVERSO.length, 20);
  assert.deepEqual(u.CRIPTO, ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD', 'XRP/USD', 'LTC/USD', 'BCH/USD', 'ADA/USD']);
  // La cesta de comprar y mantener sigue con las 6 de siempre.
  assert.deepEqual(u.CESTA_CRIPTO, ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD']);
  assert.deepEqual(u.ETF, ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'XLE', 'XLK', 'XLF', 'DIA']);
  assert.deepEqual(u.SOLO_DATO, ['VIXY']);
  assert.deepEqual(u.porSimbolo('BTC/USD'), { simbolo: 'BTC/USD', etiqueta: 'BTC', clase: 'cripto', nombre: 'Bitcoin' });
  assert.equal(u.porEtiqueta('eth').simbolo, 'ETH/USD');
  assert.equal(u.porSimbolo('XRP/USD').etiqueta, 'XRP');
  assert.equal(u.porSimbolo('SHIB/USD'), null);
  assert.equal(u.esSoloDato('VIXY'), true);
  assert.equal(u.esSoloDato('SPY'), false);
  assert.equal(u.generacion('BTC/USD'), 1);
  assert.equal(u.generacion('ADA/USD'), 2);
  assert.equal(u.generacion('DIA'), 2);
});

test('clave y desdeClave: BTC/USD ↔ BTCUSD', () => {
  assert.equal(u.clave('BTC/USD'), 'BTCUSD');
  assert.equal(u.clave('SPY'), 'SPY');
  assert.equal(u.desdeClave('BTCUSD'), 'BTC/USD');
  assert.equal(u.desdeClave('DOGEUSD'), 'DOGE/USD');
  assert.equal(u.desdeClave('SPY'), 'SPY');
  assert.equal(u.desdeClave('BTC/USD'), 'BTC/USD');
  // Fuera del universo: por la moneda de cotización.
  assert.equal(u.desdeClave('XRPUSD'), 'XRP/USD');
  assert.equal(u.desdeClave('SHIBUSD'), 'SHIB/USD');
  assert.equal(u.desdeClave('BTCUSDT'), 'BTC/USDT');
  assert.equal(u.desdeClave('ETHBTC'), 'ETH/BTC');
  // Un ticker de acción no se parte.
  assert.equal(u.desdeClave('AAPL'), 'AAPL');
  assert.equal(u.desdeClave('BUSD', { clase: 'us_equity' }), 'BUSD');
});

test('esCripto y disponibles según haya claves', () => {
  assert.equal(u.esCripto('BTC/USD'), true);
  assert.equal(u.esCripto('SPY'), false);
  assert.equal(u.esCripto('XRP/USD'), true);
  assert.equal(u.disponibles({ hayAlpaca: false }).length, 10);
  // VIXY nunca sale de disponibles(): ninguna mesa lo puede operar.
  assert.equal(u.disponibles({ hayAlpaca: true }).length, 19);
  assert.ok(!u.disponibles({ hayAlpaca: true }).some(a => a.simbolo === 'VIXY'));
  assert.ok(u.disponibles().every(a => a.clase === 'cripto'));
});

test('marcos en ms', () => {
  assert.deepEqual({ ...u.MARCOS }, { '1Hour': 3_600_000, '4Hour': 14_400_000, '1Day': 86_400_000 });
});
