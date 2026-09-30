'use strict';
// AlpacaDatos con fetch FALSO: cripto sin cabeceras, un símbolo por petición,
// paginación, solo velas cerradas, caché en disco que pide solo lo que falta,
// acciones con feed=iex y noticias (§3.1, §9-B).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AlpacaDatos } = require('../src/mercado/alpaca-datos');
const { RelojSimulado, HORA, DIA } = require('../src/util/reloj');

function respuesta({ status = 200, json, texto, cabeceras = {} } = {}) {
  const cuerpo = texto !== undefined ? texto : JSON.stringify(json === undefined ? {} : json);
  return new Response(cuerpo, { status, headers: cabeceras });
}

function fetchFalso(guion) {
  const llamadas = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const llamada = { url, ruta: u.pathname, params: Object.fromEntries(u.searchParams), cabeceras: init.headers || {} };
    llamadas.push(llamada);
    return respuesta(guion(llamada, llamadas.length));
  };
  f.llamadas = llamadas;
  return f;
}

// «Servidor» de velas horarias de BTC: una por hora desde T0, con precio = índice.
const T0 = Date.UTC(2026, 8, 1);
function barraHora(i) {
  return { t: new Date(T0 + i * HORA).toISOString(), o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 0.1, n: 3, vw: 100 + i };
}
// Pagina de `porPagina` en `porPagina` y respeta start/end como Alpaca (inclusivos, sobre t).
function servidorVelas({ porPagina = 5, publicadasHasta = Infinity } = {}) {
  return (ll) => {
    const ini = Date.parse(ll.params.start);
    const fin = Date.parse(ll.params.end);
    const desdeIdx = ll.params.page_token ? Number(ll.params.page_token) : Math.ceil((ini - T0) / HORA);
    const barras = [];
    let i = Math.max(0, desdeIdx);
    for (; barras.length < porPagina && T0 + i * HORA <= fin && T0 + i * HORA <= publicadasHasta; i++) barras.push(barraHora(i));
    const hayMas = T0 + i * HORA <= fin && T0 + i * HORA <= publicadasHasta;
    return { json: { bars: { 'BTC/USD': barras }, next_page_token: hayMas ? String(i) : null } };
  };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mt-datos-'));

test('cripto: sin cabeceras aunque haya claves, un símbolo, paginación y solo cerradas', async () => {
  const reloj = new RelojSimulado(T0 + 12 * HORA + 30 * 60_000); // 12:30 → la vela de 12:00 aún no ha cerrado
  const fetch = fetchFalso(servidorVelas({ porPagina: 5 }));
  const d = new AlpacaDatos({ claveId: 'PK', secreto: 'S', fetch, reloj, limitador: null, dormir: async () => {} });
  const velas = await d.velas('BTC/USD', '1Hour', { desde: T0, hasta: reloj.ahora() });
  assert.equal(velas.length, 12, '00:00 … 11:00 cerradas');
  assert.equal(velas[0].t, T0);
  assert.equal(velas[11].t, T0 + 11 * HORA);
  assert.deepEqual(velas[3], { t: T0 + 3 * HORA, o: 103, h: 104, l: 102, c: 103.5, v: 0.1 });
  // 12 velas de 5 en 5 → 3 páginas encadenadas por page_token.
  assert.equal(fetch.llamadas.length, 3);
  const [p1, p2, p3] = fetch.llamadas;
  assert.equal(p1.ruta, '/v1beta3/crypto/us/bars');
  assert.equal(p1.params.symbols, 'BTC/USD');
  assert.equal(p1.params.timeframe, '1Hour');
  assert.equal(p1.params.sort, 'asc');
  assert.equal(p1.params.page_token, undefined);
  assert.equal(p2.params.page_token, '5');
  assert.equal(p3.params.page_token, '10');
  assert.equal(p2.params.start, p1.params.start, 'mismos parámetros en cada página');
  for (const ll of fetch.llamadas) {
    assert.equal(ll.cabeceras['APCA-API-KEY-ID'], undefined, 'cripto va sin claves');
    assert.equal(ll.cabeceras['APCA-API-SECRET-KEY'], undefined);
  }
  // Ascendentes y sin duplicados.
  for (let i = 1; i < velas.length; i++) assert.ok(velas[i].t > velas[i - 1].t);
});

test('caché: la misma petición no vuelve a pedir; al avanzar solo pide la cola', async () => {
  const carpeta = tmp();
  const reloj = new RelojSimulado(T0 + 12 * HORA);
  const fetch = fetchFalso(servidorVelas({ porPagina: 1000 }));
  const d = new AlpacaDatos({ fetch, reloj, carpetaCache: carpeta, limitador: null });
  const a = await d.velas('BTC/USD', '1Hour', { desde: T0, hasta: reloj.ahora() });
  assert.equal(a.length, 12);
  assert.equal(fetch.llamadas.length, 1);
  await d.velas('BTC/USD', '1Hour', { desde: T0, hasta: reloj.ahora() });
  assert.equal(fetch.llamadas.length, 1, 'todo estaba en caché');
  assert.ok(fs.existsSync(path.join(carpeta, 'velas', 'BTCUSD_1Hour.json')));

  reloj.avanzar(3 * HORA);   // 15:00 → cierran 12:00, 13:00 y 14:00
  const b = await d.velas('BTC/USD', '1Hour', { desde: T0, hasta: reloj.ahora() });
  assert.equal(b.length, 15);
  assert.equal(fetch.llamadas.length, 2);
  const cola = fetch.llamadas[1];
  assert.ok(Date.parse(cola.params.start) > T0 + 6 * HORA, `solo la cola, no desde el principio (start=${cola.params.start})`);
  assert.equal(Date.parse(cola.params.end), T0 + 14 * HORA);

  // Otra instancia con la misma carpeta lee del disco sin pedir nada.
  const fetch2 = fetchFalso(() => { throw new Error('no debería pedir'); });
  const d2 = new AlpacaDatos({ fetch: fetch2, reloj, carpetaCache: carpeta, limitador: null });
  const c = await d2.velas('BTC/USD', '1Hour', { desde: T0 + 2 * HORA, hasta: T0 + 10 * HORA });
  assert.equal(c.length, 9);
  assert.equal(fetch2.llamadas.length, 0);
  assert.deepEqual(c[0], b[2]);

  // Pedir más atrás solo pide el tramo anterior.
  const fetch3 = fetchFalso(servidorVelas({ porPagina: 1000 }));
  const d3 = new AlpacaDatos({ fetch: fetch3, reloj, carpetaCache: carpeta, limitador: null });
  await d3.velas('BTC/USD', '1Hour', { desde: T0 - 5 * HORA, hasta: T0 + 3 * HORA });
  assert.equal(fetch3.llamadas.length, 1);
  assert.equal(Date.parse(fetch3.llamadas[0].params.start), T0 - 5 * HORA);
  assert.equal(Date.parse(fetch3.llamadas[0].params.end), T0 - 1);
});

test('una vela que se publica tarde no se pierde: se vuelve a mirar la cola', async () => {
  const reloj = new RelojSimulado(T0 + 12 * HORA + 10_000);   // 12:00:10, la de 11:00 aún no publicada
  let publicadas = T0 + 10 * HORA;
  const fetch = fetchFalso((ll, n) => servidorVelas({ porPagina: 1000, publicadasHasta: publicadas })(ll, n));
  const d = new AlpacaDatos({ fetch, reloj, limitador: null });
  const a = await d.velas('BTC/USD', '1Hour', { desde: T0, hasta: reloj.ahora() });
  assert.equal(a.length, 11, 'falta la de 11:00');
  publicadas = T0 + 11 * HORA;
  reloj.avanzar(60_000);
  const b = await d.velas('BTC/USD', '1Hour', { desde: T0, hasta: reloj.ahora() });
  assert.equal(b.length, 12, 'la de 11:00 llega en la siguiente llamada');
  assert.equal(b[11].t, T0 + 11 * HORA);
  const n = fetch.llamadas.length;
  reloj.avanzar(60_000);
  await d.velas('BTC/USD', '1Hour', { desde: T0, hasta: reloj.ahora() });
  assert.equal(fetch.llamadas.length, n, 'con la cola completa no se vuelve a pedir');
});

test('cripto: una vela revisada tras la primera lectura se corrige (también en disco) al pedir la siguiente', async () => {
  const carpeta = tmp();
  const reloj = new RelojSimulado(T0 + 12 * HORA + 10_000);   // 12:00:10: la de 11:00 recién cerrada
  let revisada = false;
  const fetch = fetchFalso((ll, n) => {
    const r = servidorVelas({ porPagina: 1000 })(ll, n);
    for (const b of r.json.bars['BTC/USD']) if (b.t === new Date(T0 + 11 * HORA).toISOString() && !revisada) b.c = 1;   // provisional
    return r;
  });
  const d = new AlpacaDatos({ fetch, reloj, carpetaCache: carpeta, limitador: null });
  const a = await d.velas('BTC/USD', '1Hour', { desde: T0, hasta: reloj.ahora() });
  assert.equal(a[11].c, 1, 'primera lectura: la provisional');
  revisada = true;
  reloj.avanzar(HORA);   // 13:00:10: se pide la de 12:00 desde lo firme, que incluye otra vez la de 11:00
  const b = await d.velas('BTC/USD', '1Hour', { desde: T0, hasta: reloj.ahora() });
  assert.equal(b[11].c, 111.5);
  const enDisco = JSON.parse(fs.readFileSync(path.join(carpeta, 'velas', 'BTCUSD_1Hour.json'), 'utf8'));
  assert.equal(enDisco.velas.find(v => v[0] === T0 + 11 * HORA)[4], 111.5, 'la caché en disco guarda la definitiva');
});

test('acciones 1Day: una diaria publicada tarde (16:20 ET) y provisional hasta las 17:00 ET no se pierde ni se congela', async () => {
  // Servidor pesimista: la diaria de D aparece a las 16:20 ET (20:20Z en
  // verano) y su cierre es provisional (400+i) hasta las 17:00 ET (500+i).
  const dias = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29'];
  const carpeta = tmp();
  const reloj = new RelojSimulado(Date.UTC(2026, 8, 24, 21, 0));
  const fetch = fetchFalso((ll) => {
    const ini = Date.parse(ll.params.start), fin = Date.parse(ll.params.end);
    const bars = [];
    dias.forEach((dia, i) => {
      const t = Date.parse(`${dia}T04:00:00Z`);
      const minutos = (reloj.ahora() - Date.parse(`${dia}T00:00:00Z`)) / 60_000;
      if (t < ini || t > fin || minutos < 20 * 60 + 20) return;
      bars.push({ t: `${dia}T04:00:00Z`, o: 500 + i, h: 510 + i, l: 390 + i, c: minutos < 21 * 60 ? 400 + i : 500 + i, v: 1 });
    });
    return { json: { bars: { SPY: bars }, next_page_token: null } };
  });
  const d = new AlpacaDatos({ claveId: 'PK', secreto: 'S', fetch, reloj, carpetaCache: carpeta, limitador: null });
  const desde = Date.UTC(2026, 8, 18);
  await d.velas('SPY', '1Day', { desde, hasta: reloj.ahora() });
  // Macro pide SPY 1Day en el primer latido de cada hora: justo al cierre (16:00 ET), antes de que se publique.
  const consultas = [
    '2026-09-25T20:00:30Z', '2026-09-25T20:30:30Z', '2026-09-25T21:15:30Z', '2026-09-25T23:00:30Z',
    '2026-09-28T20:00:30Z', '2026-09-28T20:40:30Z', '2026-09-29T20:30:30Z', '2026-09-29T21:30:30Z', '2026-09-30T02:00:00Z',
  ];
  let v = [];
  for (const iso of consultas) {
    reloj.fijar(Date.parse(iso));
    v = await d.velas('SPY', '1Day', { desde, hasta: reloj.ahora() });
  }
  const cierres = Object.fromEntries(v.map(x => [new Date(x.t).toISOString().slice(0, 10), x.c]));
  assert.deepEqual(cierres, {
    '2026-09-21': 500, '2026-09-22': 501, '2026-09-23': 502, '2026-09-24': 503,
    '2026-09-25': 504, '2026-09-28': 505, '2026-09-29': 506,
  }, 'todas las diarias, con el cierre definitivo');
  // Lo guardado en disco (lo que leen backtests y walk-forward) también es lo definitivo.
  const enDisco = JSON.parse(fs.readFileSync(path.join(carpeta, 'velas', 'SPY_1Day.json'), 'utf8'));
  assert.deepEqual(enDisco.velas.map(x => x[4]), [500, 501, 502, 503, 504, 505, 506]);
  // Y pasado el margen ya no se vuelve a pedir.
  const n = fetch.llamadas.length;
  reloj.fijar(Date.parse('2026-09-30T03:00:00Z'));
  await d.velas('SPY', '1Day', { desde, hasta: reloj.ahora() });
  assert.equal(fetch.llamadas.length, n);
});

test('marco no admitido lanza; acciones sin claves no se piden', async () => {
  const fetch = fetchFalso(() => { throw new Error('no debería pedir'); });
  const d = new AlpacaDatos({ fetch, reloj: new RelojSimulado(T0), limitador: null });
  await assert.rejects(d.velas('BTC/USD', '15Min', {}), /marco no admitido/);
  assert.equal(d.disponible('BTC/USD'), true);
  assert.equal(d.disponible('SPY'), false);
  assert.deepEqual(await d.velas('SPY', '1Day', { desde: T0, hasta: T0 + 10 * DIA }), []);
  assert.deepEqual(await d.noticias(['BTC/USD'], {}), []);
  assert.deepEqual(await d.ultimos(['SPY']), {});
  assert.equal(fetch.llamadas.length, 0);
});

test('acciones: con cabeceras, feed=iex, adjustment=all; la diaria cuenta como cerrada al cierre de la sesión', async () => {
  // Diarias de SPY con la marca de medianoche de Nueva York (04:00Z en verano).
  const dias = ['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29'];
  const fetch = fetchFalso((ll) => {
    const ini = Date.parse(ll.params.start), fin = Date.parse(ll.params.end);
    const bars = dias.map((dia, i) => ({ t: `${dia}T04:00:00Z`, o: 500 + i, h: 505 + i, l: 495 + i, c: 502 + i, v: 1000 }))
      .filter(b => Date.parse(b.t) >= ini && Date.parse(b.t) <= fin);
    return { json: { bars: { SPY: bars }, next_page_token: null } };
  });
  // 29-sep-2026 a las 15:00 ET (19:00Z): la sesión de hoy no ha terminado.
  const reloj = new RelojSimulado(Date.UTC(2026, 8, 29, 19, 0));
  const d = new AlpacaDatos({ claveId: 'PK', secreto: 'S', fetch, reloj, limitador: null });
  const a = await d.velas('SPY', '1Day', { desde: Date.UTC(2026, 8, 20), hasta: reloj.ahora() });
  assert.deepEqual(a.map(v => new Date(v.t).toISOString().slice(0, 10)), ['2026-09-24', '2026-09-25', '2026-09-28']);
  const ll = fetch.llamadas[0];
  assert.equal(ll.ruta, '/v2/stocks/bars');
  assert.equal(ll.params.feed, 'iex');
  assert.equal(ll.params.adjustment, 'all');
  assert.equal(ll.params.symbols, 'SPY');
  assert.equal(ll.cabeceras['APCA-API-KEY-ID'], 'PK');
  assert.equal(ll.cabeceras['APCA-API-SECRET-KEY'], 'S');
  // 16:01 ET: ya cuenta la de hoy.
  reloj.fijar(Date.UTC(2026, 8, 29, 20, 1));
  const b = await d.velas('SPY', '1Day', { desde: Date.UTC(2026, 8, 20), hasta: reloj.ahora() });
  assert.equal(b.length, 4);
  assert.equal(b[3].c, 505);
});

test('ultimos: cripto por latest/quotes (punto medio) sin cabeceras, respaldo en latest/bars; acciones por snapshots', async () => {
  const fetch = fetchFalso((ll) => {
    if (ll.ruta === '/v1beta3/crypto/us/latest/quotes') {
      return { json: { quotes: {
        'BTC/USD': { ap: 83600.81, as: 0.001, bp: 83579.7, bs: 0.001, t: '2026-09-29T20:39:20.809471604Z' },
        'ETH/USD': { ap: 0, bp: 0, t: '2026-09-29T20:39:15Z' },     // cotización rota → respaldo
      } } };
    }
    if (ll.ruta === '/v1beta3/crypto/us/latest/bars') {
      return { json: { bars: { 'ETH/USD': { c: 2691.8345, h: 1, l: 1, o: 1, n: 0, t: '2026-09-29T20:38:00Z', v: 0 } } } };
    }
    return { json: { SPY: { latestTrade: { p: 505.12, t: '2026-09-29T19:59:58.5Z' }, prevDailyBar: { c: 501 } } } };
  });
  const d = new AlpacaDatos({ claveId: 'PK', secreto: 'S', fetch, reloj: new RelojSimulado(Date.UTC(2026, 8, 29, 20, 40)), limitador: null });
  const u = await d.ultimos(['BTC/USD', 'ETH/USD', 'SOL/USD', 'SPY']);
  // (83.579,7 + 83.600,81) / 2 = 83.590,255
  assert.ok(Math.abs(u['BTC/USD'].precio - 83590.255) < 1e-9);
  assert.equal(u['BTC/USD'].t, Date.parse('2026-09-29T20:39:20.809Z'));
  assert.equal(u['BTC/USD'].demanda, 83579.7);
  assert.equal(u['BTC/USD'].oferta, 83600.81);
  assert.deepEqual(u['ETH/USD'], { precio: 2691.8345, t: Date.parse('2026-09-29T20:38:00Z') });
  assert.equal(u['SOL/USD'], undefined, 'sin dato no se inventa');
  assert.deepEqual(u.SPY, { precio: 505.12, t: Date.parse('2026-09-29T19:59:58.5Z'), cierreAnterior: 501 });
  const [q, b, s] = fetch.llamadas;
  assert.equal(q.params.symbols, 'BTC/USD,ETH/USD,SOL/USD');
  assert.equal(q.cabeceras['APCA-API-KEY-ID'], undefined);
  assert.equal(b.params.symbols, 'ETH/USD,SOL/USD', 'el respaldo solo pide lo que falta');
  assert.equal(b.cabeceras['APCA-API-KEY-ID'], undefined);
  assert.equal(s.ruta, '/v2/stocks/snapshots');
  assert.equal(s.params.feed, 'iex');
  assert.equal(s.cabeceras['APCA-API-KEY-ID'], 'PK');
});

test('noticias: símbolos cripto sin barra en la consulta y canónicos en la respuesta', async () => {
  const fetch = fetchFalso(() => ({ json: { news: [
    { id: 7, headline: 'BTC sube', summary: 'resumen', source: 'benzinga', author: 'Ana Pérez', created_at: '2026-09-29T10:00:00Z', url: 'https://x', symbols: ['BTCUSD', 'MSTR'] },
  ], next_page_token: null } }));
  const d = new AlpacaDatos({ claveId: 'PK', secreto: 'S', fetch, reloj: new RelojSimulado(T0), limitador: null });
  const n = await d.noticias(['BTC/USD', 'SPY'], { desde: Date.UTC(2026, 8, 28), limite: 10 });
  assert.deepEqual(n, [{ id: 7, titular: 'BTC sube', resumen: 'resumen', fuente: 'benzinga', autor: 'Ana Pérez', t: Date.parse('2026-09-29T10:00:00Z'), url: 'https://x', simbolos: ['BTC/USD', 'MSTR'] }]);
  const ll = fetch.llamadas[0];
  assert.equal(ll.ruta, '/v1beta1/news');
  assert.equal(ll.params.symbols, 'BTCUSD,SPY');
  assert.equal(ll.params.limit, '10');
  assert.equal(ll.params.start, '2026-09-28T00:00:00.000Z');
  assert.equal(ll.cabeceras['APCA-API-KEY-ID'], 'PK');
});

test('un 429 en datos se reintenta y la segunda vez responde', async () => {
  const esperas = [];
  const fetch = fetchFalso((ll, n) => (n === 1 ? { status: 429, texto: 'Too Many Requests' } : servidorVelas({ porPagina: 1000 })(ll, n)));
  const d = new AlpacaDatos({ fetch, reloj: new RelojSimulado(T0 + 3 * HORA), limitador: null, dormir: async ms => { esperas.push(ms); } });
  const v = await d.velas('BTC/USD', '1Hour', { desde: T0, hasta: T0 + 3 * HORA });
  assert.equal(v.length, 3);
  assert.equal(fetch.llamadas.length, 2);
  assert.deepEqual(esperas, [1000]);
});

test('ultimos: timeout corto y un solo reintento, para no retener el latido minutos con la red colgada; velas() conserva los suyos', async () => {
  const llamadas = { ultimos: 0, velas: 0 };
  const colgado = async (url) => {
    llamadas[String(url).includes('/latest/') ? 'ultimos' : 'velas']++;
    return new Promise(() => {});
  };
  const d = new AlpacaDatos({ fetch: colgado, reloj: new RelojSimulado(T0 + 3 * HORA), limitador: null, dormir: async () => {}, timeoutMs: 20, timeoutUltimosMs: 20 });
  await assert.rejects(d.ultimos(['BTC/USD']), e => e.tipo === 'red');
  assert.equal(llamadas.ultimos, 2, 'un intento y un reintento');
  await assert.rejects(d.velas('BTC/USD', '1Hour', { desde: T0, hasta: T0 + 3 * HORA }), e => e.tipo === 'red');
  assert.equal(llamadas.velas, 6, 'las velas mantienen sus 5 reintentos');
  const porDefecto = new AlpacaDatos({ fetch: colgado, limitador: null });
  assert.equal(porDefecto.timeoutUltimosMs, 10_000);
  assert.equal(porDefecto.reintentosUltimos, 1);
});
