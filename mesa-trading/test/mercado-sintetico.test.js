'use strict';
// DatosSinteticos: determinista por semilla, velas cerradas, agregación
// coherente, correlación entre cripto y velocidad (§3.1).
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatosSinteticos, PARAMETROS } = require('../src/mercado/sintetico');
const { RelojSimulado, HORA, DIA } = require('../src/util/reloj');

const INICIO = Date.UTC(2026, 8, 1);
const CRIPTO = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD'];

function retornos(velas) {
  const r = [];
  for (let i = 1; i < velas.length; i++) r.push(Math.log(velas[i].c / velas[i - 1].c));
  return r;
}
function correlacion(a, b) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
}
function volAnual(r) {
  const m = r.reduce((s, x) => s + x, 0) / r.length;
  return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(365);
}

test('900 días × 6 cripto se generan en menos de 2 s', async () => {
  const t0 = process.hrtime.bigint();
  const d = new DatosSinteticos({ semilla: 1, reloj: new RelojSimulado(INICIO) });
  for (const s of CRIPTO) await d.velas(s, '1Hour', { desde: INICIO - 900 * DIA, hasta: INICIO });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 2000, `tardó ${ms.toFixed(0)} ms`);
});

test('misma semilla → mismas velas; otra semilla → otras', async () => {
  const a = new DatosSinteticos({ semilla: 42, reloj: new RelojSimulado(INICIO) });
  const b = new DatosSinteticos({ semilla: 42, reloj: new RelojSimulado(INICIO) });
  const c = new DatosSinteticos({ semilla: 43, reloj: new RelojSimulado(INICIO) });
  const va = await a.velas('ETH/USD', '4Hour', { desde: INICIO - 200 * DIA, hasta: INICIO });
  const vb = await b.velas('ETH/USD', '4Hour', { desde: INICIO - 200 * DIA, hasta: INICIO });
  const vc = await c.velas('ETH/USD', '4Hour', { desde: INICIO - 200 * DIA, hasta: INICIO });
  assert.deepEqual(va, vb);
  assert.notDeepEqual(va, vc);
});

test('el resultado no depende de en qué trozos se pida ni del universo pedido', async () => {
  const relojA = new RelojSimulado(INICIO);
  const a = new DatosSinteticos({ semilla: 9, reloj: relojA });
  relojA.fijar(INICIO + 40 * DIA);
  const todo = await a.velas('SOL/USD', '1Hour', { desde: INICIO - 10 * DIA, hasta: relojA.ahora() });

  const relojB = new RelojSimulado(INICIO);
  const b = new DatosSinteticos({ semilla: 9, reloj: relojB, universo: ['SOL/USD'] });
  for (let dia = 1; dia <= 40; dia++) {
    relojB.fijar(INICIO + dia * DIA);
    await b.velas('SOL/USD', '1Hour', { desde: relojB.ahora() - DIA, hasta: relojB.ahora() });
  }
  const trozos = await b.velas('SOL/USD', '1Hour', { desde: INICIO - 10 * DIA, hasta: relojB.ahora() });
  assert.deepEqual(trozos, todo);
});

test('solo velas cerradas respecto al reloj, y las viejas no cambian al avanzar', async () => {
  const reloj = new RelojSimulado(INICIO + 10 * HORA + 30 * 60_000);   // 10:30
  const d = new DatosSinteticos({ semilla: 5, reloj });
  const antes = await d.velas('BTC/USD', '1Hour', { desde: INICIO, hasta: reloj.ahora() });
  assert.equal(antes.length, 10);
  assert.equal(antes[antes.length - 1].t, INICIO + 9 * HORA, 'la de 10:00 aún no ha cerrado');
  assert.ok(antes.every(v => v.t + HORA <= reloj.ahora()));
  const h4 = await d.velas('BTC/USD', '4Hour', { desde: INICIO, hasta: reloj.ahora() });
  assert.deepEqual(h4.map(v => v.t), [INICIO, INICIO + 4 * HORA]);
  reloj.avanzar(DIA);
  const despues = await d.velas('BTC/USD', '1Hour', { desde: INICIO, hasta: reloj.ahora() });
  assert.deepEqual(despues.slice(0, 10), antes, 'causal: generar más no toca lo ya generado');
  const u = await d.ultimos(['BTC/USD']);
  assert.ok(u['BTC/USD'].t <= reloj.ahora());
});

test('alineadas a UTC y OHLC coherente: o = c anterior, h ≥ max(o,c), l ≤ min(o,c)', async () => {
  const d = new DatosSinteticos({ semilla: 3, reloj: new RelojSimulado(INICIO) });
  for (const [marco, m] of [['1Hour', HORA], ['4Hour', 4 * HORA], ['1Day', DIA]]) {
    const v = await d.velas('DOGE/USD', marco, { desde: INICIO - 30 * DIA, hasta: INICIO });
    for (let i = 0; i < v.length; i++) {
      assert.equal(v[i].t % m, 0);
      assert.ok(v[i].h >= Math.max(v[i].o, v[i].c));
      assert.ok(v[i].l <= Math.min(v[i].o, v[i].c));
      assert.ok(v[i].l > 0);
      if (i) assert.equal(v[i].o, v[i - 1].c);
    }
  }
});

test('agregación: la diaria sale exacta de sus 24 horarias', async () => {
  const d = new DatosSinteticos({ semilla: 11, reloj: new RelojSimulado(INICIO) });
  const [dia] = await d.velas('ETH/USD', '1Day', { desde: INICIO - 5 * DIA, hasta: INICIO - 5 * DIA });
  const horas = await d.velas('ETH/USD', '1Hour', { desde: INICIO - 5 * DIA, hasta: INICIO - 4 * DIA - 1 });
  assert.equal(horas.length, 24);
  assert.equal(dia.o, horas[0].o);
  assert.equal(dia.c, horas[23].c);
  assert.equal(dia.h, Math.max(...horas.map(h => h.h)));
  assert.equal(dia.l, Math.min(...horas.map(h => h.l)));
});

test('precio anclado en el inicio, correlación BTC-ETH > 0,4 y volatilidades plausibles', async () => {
  const d = new DatosSinteticos({ semilla: 42, reloj: new RelojSimulado(INICIO) });
  const u = await d.ultimos(CRIPTO);
  for (const s of CRIPTO) assert.ok(Math.abs(u[s].precio / PARAMETROS[s].ref - 1) < 1e-9, s);
  const diarias = {};
  for (const s of CRIPTO) diarias[s] = await d.velas(s, '1Day', { desde: INICIO - 900 * DIA, hasta: INICIO });
  assert.equal(diarias['BTC/USD'].length, 900);
  const rBtc = retornos(diarias['BTC/USD']);
  const rEth = retornos(diarias['ETH/USD']);
  const rho = correlacion(rBtc, rEth);
  assert.ok(rho > 0.4, `correlación BTC-ETH ${rho.toFixed(3)}`);
  const vBtc = volAnual(rBtc);
  const vDoge = volAnual(retornos(diarias['DOGE/USD']));
  assert.ok(vBtc > 0.35 && vBtc < 0.8, `vol BTC ${vBtc.toFixed(3)}`);
  assert.ok(vDoge > vBtc, `vol DOGE ${vDoge.toFixed(3)} > BTC`);
});

test('regímenes: aparecen los tres en 900 días', () => {
  const d = new DatosSinteticos({ semilla: 42, reloj: new RelojSimulado(INICIO) });
  const vistos = new Set();
  for (let t = INICIO - 900 * DIA; t < INICIO; t += DIA) vistos.add(d.regimenEn(t));
  assert.deepEqual([...vistos].sort(), ['alcista', 'bajista', 'lateral']);
});

test('solo las 6 cripto; sin noticias', async () => {
  const d = new DatosSinteticos({ semilla: 1, reloj: new RelojSimulado(INICIO) });
  assert.equal(d.disponible('BTC/USD'), true);
  assert.equal(d.disponible('SPY'), false);
  assert.deepEqual(await d.velas('SPY', '1Day', { desde: INICIO - 10 * DIA, hasta: INICIO }), []);
  assert.deepEqual(await d.ultimos(['SPY']), {});
  assert.deepEqual(await d.noticias(['BTC/USD'], {}), []);
  await assert.rejects(d.velas('BTC/USD', '15Min', {}), /marco no admitido/);
});
