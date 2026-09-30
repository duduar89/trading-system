'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularRegimen, regimenEnFecha } = require('../src/mercado/regimen');
const { DIA, T0, serieSintetica } = require('./cuant-ayuda');

// Serie diaria con cierres dados (o = h = l = c: solo importan los cierres).
const diaria = cierres => cierres.map((c, i) => ({ t: T0 + i * DIA, o: c, h: c, l: c, c, v: 0 }));
const subiendo = diaria(Array.from({ length: 250 }, (_, i) => 100 + i));
const bajando = diaria(Array.from({ length: 250 }, (_, i) => 400 - i));

test('BTC subiendo sin SPY: +1 +1 0 = 2 → RISK-ON', () => {
  // último cierre 349; SMA200 = media(150..349) = 249,5; SMA50 = media(300..349) = 324,5;
  // volatilidad 30 d minúscula (< 100 %) → 0 puntos
  const r = calcularRegimen({ btcDiario: subiendo });
  assert.equal(r.puntos, 2);
  assert.equal(r.valor, 'RISK-ON');
  assert.equal(r.componentes.find(c => c.nombre === 'btc_sobre_sma200').referencia, 249.5);
  assert.equal(r.componentes.find(c => c.nombre === 'btc_sma50_sobre_sma200').valor, 324.5);
  assert.match(r.detalle, /RISK-ON/);
  assert.match(r.detalle, /SMA200 249,50/);
});

test('con SPY bajando resta 1: 2 − 1 = 1 → NEUTRAL', () => {
  const r = calcularRegimen({ btcDiario: subiendo, spyDiario: bajando });
  assert.equal(r.puntos, 1);
  assert.equal(r.valor, 'NEUTRAL');
});

test('BTC bajando: −1 −1 = −2 → RISK-OFF', () => {
  const r = calcularRegimen({ btcDiario: bajando });
  assert.equal(r.puntos, -2);
  assert.equal(r.valor, 'RISK-OFF');
});

test('volatilidad 30 d > 100 % resta 1', () => {
  // cierres que alternan ±10 %: log-rent. ≈ ±0,095 → vol anual ≈ 0,095·√365 ≈ 1,8
  const loca = diaria(Array.from({ length: 250 }, (_, i) => (100 + i) * (i % 2 ? 1.1 : 1)));
  const r = calcularRegimen({ btcDiario: loca });
  const vol = r.componentes.find(c => c.nombre === 'btc_vol30');
  assert.ok(vol.valor > 1);
  assert.equal(vol.puntos, -1);
  assert.equal(r.puntos, 1); // +1 +1 −1
  assert.equal(r.valor, 'NEUTRAL');
});

test('sin 200 velas los componentes de SMA200 suman 0 y se dice', () => {
  const r = calcularRegimen({ btcDiario: subiendo.slice(0, 120) });
  assert.equal(r.puntos, 0);
  assert.equal(r.valor, 'NEUTRAL');
  assert.match(r.detalle, /sin 200 velas/);
});

test('regimenEnFecha usa solo velas cerradas antes de t', () => {
  const ultima = subiendo[subiendo.length - 1];
  // En t = inicio de la última vela, esa vela aún no ha cerrado: se usa la anterior.
  const antes = regimenEnFecha(subiendo, null, ultima.t);
  assert.equal(antes.t, subiendo[subiendo.length - 2].t);
  // Al cerrar (t + 1 día) coincide con calcularRegimen sobre la serie entera.
  const despues = regimenEnFecha(subiendo, null, ultima.t + DIA);
  assert.deepEqual(despues, calcularRegimen({ btcDiario: subiendo }));
});

test('CAUSALIDAD: regimenEnFecha con 50 velas de más da lo mismo que con la serie cortada', () => {
  const btc = serieSintetica(700, 5);
  const spy = serieSintetica(700, 6);
  for (const n of [210, 400, 650]) {
    const t = btc[n - 1].t + DIA;
    const corto = calcularRegimen({ btcDiario: btc.slice(0, n), spyDiario: spy.slice(0, n) });
    assert.deepEqual(regimenEnFecha(btc, spy, t), corto);
  }
});

test('SPY (t a medianoche de Nueva York) cuenta como cerrada al terminar la sesión, como en vivo', () => {
  const cal = require('../src/mercado/calendario');
  const { cierreVelaDiaria } = require('../src/mercado/regimen');
  // 230 sesiones de 2026 con cierres crecientes (SMA200 existe al final).
  const spy = [];
  for (let d = Date.UTC(2026, 0, 2); spy.length < 230; d += DIA) {
    const dia = new Date(d).toISOString().slice(0, 10);
    if (cal.esDiaHabil(dia)) spy.push({ t: cal.msDesdeET(dia, 0, 0), o: 400 + spy.length, h: 400 + spy.length, l: 400 + spy.length, c: 400 + spy.length, v: 0 });
  }
  const k = spy.findIndex(v => cal.diaET(v.t) === '2026-11-27');      // cierre temprano (13:00 ET)
  const k2 = spy.findIndex(v => cal.diaET(v.t) === '2026-11-25');     // sesión normal
  assert.ok(k > 200 && k2 > 200);
  assert.equal(cierreVelaDiaria(spy[k2].t), cal.msDesdeET('2026-11-25', 16, 0));
  assert.equal(cierreVelaDiaria(spy[k].t), cal.msDesdeET('2026-11-27', 13, 0));
  assert.equal(cierreVelaDiaria(Date.UTC(2026, 10, 25)), Date.UTC(2026, 10, 26)); // cripto: t + 1 día
  const spyEn = t => regimenEnFecha([], spy, t).componentes.find(c => c.nombre === 'spy_sobre_sma200').valor;
  // Un minuto antes del cierre, la vela del día aún no cuenta; al cierre, sí.
  assert.equal(spyEn(cal.msDesdeET('2026-11-25', 15, 59)), spy[k2 - 1].c);
  assert.equal(spyEn(cal.msDesdeET('2026-11-25', 16, 0)), spy[k2].c);
  assert.equal(spyEn(cal.msDesdeET('2026-11-27', 13, 0)), spy[k].c);
  // Decisión cripto a las 00:00 UTC del día siguiente: ya ve la SPY del día (antes esperaba a las 05:00Z).
  assert.equal(spyEn(Date.UTC(2026, 10, 26)), spy[k2].c);
});
