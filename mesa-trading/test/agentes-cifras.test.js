'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verificarCifras, extraerNumeros, lecturas } = require('../src/agentes/cifras');

test('cifras buenas: 1.234,56 $ presente como 1234.56 y 12,5 % presente como 0.125', () => {
  const r = verificarCifras('Patrimonio 1.234,56 $ y caída del 12,5 %.', { patrimonio: 1234.56, caida: 0.125 });
  assert.deepEqual(r, { ok: true, noEncontradas: [] });
});

test('cifras buenas en formato inglés y redondeadas a 0-2 decimales', () => {
  assert.equal(verificarCifras('Equity 1,234.56 $', { p: 1234.56 }).ok, true);
  // 84.123,4 redondeado a 0 decimales = 84.123; a 1 decimal = 84.123,4.
  assert.equal(verificarCifras('BTC en 84.123', { c: 84123.4 }).ok, true);
  assert.equal(verificarCifras('BTC en 84.123,4', { c: 84123.4 }).ok, true);
  // 1.234,56 $ pintado por formato.usd como «1.235 $»: redondeo a 0 decimales.
  assert.equal(verificarCifras('ganó 1.235 $', { pnl: 1234.56 }).ok, true);
  // Porcentaje con redondeo: 0,12534 → 12,53 % o 12,5 % o 13 %.
  assert.equal(verificarCifras('sube 12,53 %', { r: 0.12534 }).ok, true);
  assert.equal(verificarCifras('sube 13 %', { r: 0.12534 }).ok, true);
  // El signo lo pone la palabra: «pérdida de 45,20 $» con pnl −45,2.
  assert.equal(verificarCifras('pérdida de 45,20 $', { pnl: -45.2 }).ok, true);
});

test('cifras malas: un número inventado no pasa', () => {
  const r = verificarCifras('Patrimonio 1.234,56 $ y ganamos 1.999 $ hoy.', { patrimonio: 1234.56 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.noEncontradas, ['1.999']);
  // 84.120 NO es el redondeo de 84.123,4 (sería 84.123).
  assert.deepEqual(verificarCifras('BTC en 84.120', { c: 84123.4 }).noEncontradas, ['84.120']);
  // Un porcentaje pequeño tampoco pasa gratis: «12 %» con caída real del 3 %.
  assert.deepEqual(verificarCifras('Cayó un 12 %', { c: 0.03 }).noEncontradas, ['12 %']);
});

test('enteros 0-31 sin unidad pasan siempre (conteos, días, horas)', () => {
  assert.equal(verificarCifras('3 operaciones en 12 días y 4 horas', {}).ok, true);
  assert.equal(verificarCifras('32 operaciones', {}).ok, false);
  assert.equal(verificarCifras('5 $', {}).ok, false);
});

test('números dentro de textos de la entrada cuentan como datos', () => {
  const entrada = { motivo: 'SMA7 84.120 > SMA25 83.900' };
  assert.equal(verificarCifras('La rápida está en 84.120 y la lenta en 83.900.', entrada).ok, true);
});

test('identificadores (SMA200, RSI2) no son cifras; las horas solo si están en los datos', () => {
  assert.equal(verificarCifras('Cierre sobre la SMA200 y RSI2 bajo', {}).ok, true);
  assert.deepEqual(verificarCifras('Comité a las 16:00', {}).noEncontradas, ['16:00']);
  assert.equal(verificarCifras('Comité a las 16:00', { proximo: '16:00' }).ok, true);
});

test('puntos básicos y multiplicadores k / M', () => {
  assert.equal(verificarCifras('deslizamiento de 5 pb', { d: 0.0005 }).ok, true);
  assert.equal(verificarCifras('BTC ronda los 84k', { p: 84123 }).ok, true);
  assert.equal(verificarCifras('BTC ronda los 90k', { p: 84123 }).ok, false);
  assert.equal(verificarCifras('volumen de 1,2 M', { v: 1234567 }).ok, true);
});

test('lecturas de números ambiguos', () => {
  assert.deepEqual(lecturas('1.234').map(l => l.valor), [1.234, 1234]);
  assert.deepEqual(lecturas('12,5').map(l => l.valor), [12.5]);
  assert.deepEqual(lecturas('1.234.567').map(l => l.valor), [1234567]);
  assert.deepEqual(lecturas('4.1.2'), []);
  assert.deepEqual(extraerNumeros('SMA 7-25, vol. 48 % y 0,0123 BTC. Fin.').numeros.map(n => n.texto), ['7', '25', '48 %', '0,0123']);
});

test('texto vacío o sin números: ok', () => {
  assert.equal(verificarCifras('', { a: 1 }).ok, true);
  assert.equal(verificarCifras(null, null).ok, true);
  assert.equal(verificarCifras('Sin posición. Esperando señal.', {}).ok, true);
});

test('signo: una pérdida escrita como ganancia no pasa (y al revés)', () => {
  // Caso de la revisión: «hoy +523,40 $» con el día en −523,40 $.
  assert.deepEqual(verificarCifras('hoy +523,40 $', { pnlDia: -523.4 }).noEncontradas, ['+523,40']);
  assert.equal(verificarCifras('hoy -523,40 $', { pnlDia: -523.4 }).ok, true);
  assert.equal(verificarCifras('+1.587,45 $', { pnl: -1587.45 }).ok, false);
  assert.equal(verificarCifras('−2,10 %', { r: 0.021 }).ok, false);
  assert.equal(verificarCifras('(+1,13 %)', { r: -0.0113 }).ok, false);
  assert.equal(verificarCifras('(-1,13 %)', { r: -0.0113 }).ok, true);
  // Sin signo escrito se sigue comparando el valor absoluto.
  assert.equal(verificarCifras('perdió 45,20 $', { pnl: -45.2 }).ok, true);
  // Un entero pequeño con signo ya no pasa gratis: «(+3)» con −3 puntos.
  assert.equal(verificarCifras('Régimen RISK-OFF (+3)', { puntos: -3 }).ok, false);
  assert.equal(verificarCifras('Régimen RISK-OFF (−3)', { puntos: -3 }).ok, true);
  // Guiones que no son signo: rangos y restas.
  assert.equal(verificarCifras('SMA 7-25 y 83.900 - 84.120', { a: 83900, b: 84120 }).ok, true);
  // Un cero redondeado no tiene signo que contradecir.
  assert.equal(verificarCifras('Caída -0,00 %', { c: 0 }).ok, true);
  assert.equal(verificarCifras('hoy +0,00 %', { r: -0.00001 }).ok, true);
  // El signo de un número escrito dentro de un texto de la entrada se conserva.
  assert.equal(verificarCifras('kill en -15 %', { regla: '(kill en -15 %)' }).ok, true);
  assert.equal(verificarCifras('kill en +15 %', { regla: '(kill en -15 %)' }).ok, false);
  assert.deepEqual(extraerNumeros('(-0,53 %) y +3').numeros.map(n => [n.texto, n.signo]), [['-0,53 %', -1], ['+3', 1]]);
});
