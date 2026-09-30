'use strict';
// Miedo y codicia: etiquetas traducidas de la API, caché de 1 h, histórico con
// ?limit=0 en disco 24 h y modo sintético (§3.2).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MiedoCodicia, traducir, valorSintetico, valorEn, RETRASO_FG } = require('../src/mercado/sentimiento');
const { DatosSinteticos } = require('../src/mercado/sintetico');
const { RelojSimulado, HORA, DIA } = require('../src/util/reloj');

// Respuesta literal de la ficha §3 (29-sep-2026).
const RESPUESTA = {
  name: 'Fear and Greed Index',
  data: [
    { value: '73', value_classification: 'Greed', timestamp: '1790640000', time_until_update: '16018' },
    { value: '74', value_classification: 'Greed', timestamp: '1790553600' },
    { value: '20', value_classification: 'Extreme Fear', timestamp: '1790467200' },
  ],
  metadata: { error: null },
};

function fetchFalso(generar) {
  const llamadas = [];
  const f = async (url) => {
    llamadas.push(url);
    const r = generar(url, llamadas.length);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r), { status: 200 });
  };
  f.llamadas = llamadas;
  return f;
}

test('etiquetas: traducción literal de value_classification', () => {
  assert.equal(traducir('Extreme Fear'), 'Miedo extremo');
  assert.equal(traducir('Fear'), 'Miedo');
  assert.equal(traducir('Neutral'), 'Neutral');
  assert.equal(traducir('Greed'), 'Codicia');
  assert.equal(traducir('Extreme Greed'), 'Codicia extrema');
  assert.equal(traducir('Something New'), 'Something New', 'lo desconocido se enseña tal cual');
});

test('actual(): valor, etiqueta y t en ms; caché de 1 h', async () => {
  const reloj = new RelojSimulado(Date.UTC(2026, 8, 29, 12));
  const fetch = fetchFalso(() => RESPUESTA);
  const mc = new MiedoCodicia({ fetch, reloj });
  assert.deepEqual(await mc.actual(), { valor: 73, etiqueta: 'Codicia', t: 1790640000000 });
  assert.equal(fetch.llamadas[0], 'https://api.alternative.me/fng/?limit=1&format=json');
  reloj.avanzar(59 * 60_000);
  await mc.actual();
  assert.equal(fetch.llamadas.length, 1);
  reloj.avanzar(2 * 60_000);
  await mc.actual();
  assert.equal(fetch.llamadas.length, 2);
});

test('actual(): sin red devuelve el último conocido, o null si nunca hubo', async () => {
  const reloj = new RelojSimulado(Date.UTC(2026, 8, 29, 12));
  const sinRed = new MiedoCodicia({ fetch: fetchFalso(() => new TypeError('fetch failed')), reloj, dormir: async () => {} });
  assert.equal(await sinRed.actual(), null);
  let caida = false;
  const mc = new MiedoCodicia({ fetch: fetchFalso(() => (caida ? new TypeError('fetch failed') : RESPUESTA)), reloj, dormir: async () => {} });
  await mc.actual();
  caida = true;
  reloj.avanzar(2 * HORA);
  assert.equal((await mc.actual()).valor, 73);
});

test('historico(): ?limit=0, ascendente por día y caché en disco de 24 h', async () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-fng-'));
  const reloj = new RelojSimulado(Date.UTC(2026, 8, 29, 12));
  const fetch = fetchFalso(() => RESPUESTA);
  const mc = new MiedoCodicia({ fetch, reloj, carpetaCache: carpeta });
  const h = await mc.historico();
  assert.equal(fetch.llamadas[0], 'https://api.alternative.me/fng/?limit=0&format=json');
  assert.deepEqual(h, [
    { dia: '2026-09-27', valor: 20, etiqueta: 'Miedo extremo' },
    { dia: '2026-09-28', valor: 74, etiqueta: 'Codicia' },
    { dia: '2026-09-29', valor: 73, etiqueta: 'Codicia' },
  ]);
  assert.ok(fs.existsSync(path.join(carpeta, 'miedo-codicia.json')));
  // Otra instancia, 23 h después: del disco.
  reloj.avanzar(23 * HORA);
  const fetch2 = fetchFalso(() => RESPUESTA);
  const mc2 = new MiedoCodicia({ fetch: fetch2, reloj, carpetaCache: carpeta });
  assert.deepEqual(await mc2.historico(), h);
  assert.equal(fetch2.llamadas.length, 0);
  // Pasadas 24 h: se vuelve a pedir.
  reloj.avanzar(2 * HORA);
  await mc2.historico();
  assert.equal(fetch2.llamadas.length, 1);
  assert.equal(valorEn(h, Date.UTC(2026, 8, 28, 23)).valor, 74);
  assert.equal(valorEn(h, Date.UTC(2026, 8, 26)), null);
});

test('valor sintético: logística de la rentabilidad a 30 días (casos a mano)', () => {
  // 100 / (1 + e^0) = 50; r = 0,12 → 100 / (1 + e^-1) = 73,1 → 73; r = −0,12 → 26,9 → 27.
  assert.equal(valorSintetico(0), 50);
  assert.equal(valorSintetico(0.12), 73);
  assert.equal(valorSintetico(-0.12), 27);
  assert.equal(valorSintetico(5), 100);
  assert.equal(valorSintetico(-5), 0);
});

test('modo sintético: marcado, 0-100, etiqueta en español y el histórico acaba en el valor actual', async () => {
  const inicio = Date.UTC(2026, 8, 1);
  const reloj = new RelojSimulado(inicio + 10 * HORA);
  const sintetico = new DatosSinteticos({ semilla: 42, reloj });
  const fetch = fetchFalso(() => { throw new Error('no debe pedir nada'); });
  const mc = new MiedoCodicia({ fetch, reloj, sintetico });
  const a = await mc.actual();
  assert.equal(a.sintetico, true);
  assert.ok(a.valor >= 0 && a.valor <= 100);
  assert.ok(['Miedo extremo', 'Miedo', 'Neutral', 'Codicia', 'Codicia extrema'].includes(a.etiqueta));
  assert.equal(a.t, inicio);
  const h = await mc.historico();
  assert.ok(h.length > 800);
  assert.equal(h[h.length - 1].dia, '2026-09-01');
  assert.equal(h[h.length - 1].valor, a.valor);
  // Causal: el valor de un día no cambia al avanzar el reloj.
  reloj.avanzar(3 * DIA);
  const h2 = await mc.historico();
  assert.deepEqual(h2.slice(0, h.length), h);
  assert.equal(fetch.llamadas.length, 0);
});

test('RETRASO_FG: una decisión a las 00:00 UTC usa el valor de AYER (el de hoy se publica en ese mismo instante); a las 04:00, el de hoy', () => {
  // Una sola regla para vivo y backtest: el valor vigente en t es valorEn(hist, t − RETRASO_FG).
  assert.equal(RETRASO_FG, HORA);
  const hist = [{ dia: '2026-09-28', valor: 20 }, { dia: '2026-09-29', valor: 29 }, { dia: '2026-09-30', valor: 30 }];
  const medianoche = Date.UTC(2026, 8, 30);
  assert.equal(valorEn(hist, medianoche - RETRASO_FG).valor, 29);
  assert.equal(valorEn(hist, medianoche + 4 * HORA - RETRASO_FG).valor, 30);
});
