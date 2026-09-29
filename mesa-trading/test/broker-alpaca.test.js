'use strict';
// AlpacaBroker con fetch FALSO (sin red): forma exacta de las peticiones,
// mapeo de respuestas, errores y el envío idempotente ante timeouts (§3.4, §9-B).
const test = require('node:test');
const assert = require('node:assert/strict');
const { AlpacaBroker, URL_PAPER, mapearOrden, decimalTexto } = require('../src/broker/alpaca-broker');
const { ErrorBroker } = require('../src/broker/errores');
const { Limitador } = require('../src/mercado/limitador');
const { RelojSimulado } = require('../src/util/reloj');

// ---- fetch falso -----------------------------------------------------------
function respuesta({ status = 200, json, texto, cabeceras = {} } = {}) {
  const cuerpo = texto !== undefined ? texto : json === undefined ? '' : JSON.stringify(json);
  return new Response(status === 204 ? null : cuerpo, { status, headers: cabeceras });
}

// `guion(llamada, n)` devuelve { status, json | texto, cabeceras }, 'colgar'
// (nunca responde) o un Error (fallo de red).
function fetchFalso(guion) {
  const llamadas = [];
  const f = async (url, init = {}) => {
    const llamada = {
      url, metodo: init.method || 'GET', cabeceras: init.headers || {},
      cuerpo: init.body ? JSON.parse(init.body) : undefined,
    };
    llamadas.push(llamada);
    const r = guion(llamada, llamadas.length);
    if (r === 'colgar') return new Promise(() => {});
    if (r instanceof Error) throw r;
    return respuesta(r);
  };
  f.llamadas = llamadas;
  return f;
}

const sinEspera = async () => {};

function crear(guion, extra = {}) {
  const fetch = fetchFalso(guion);
  const broker = new AlpacaBroker({
    claveId: 'PKTEST', secreto: 'SECRETO', fetch, limitador: null, dormir: sinEspera,
    reloj: new RelojSimulado(Date.UTC(2026, 8, 29, 14)), ...extra,
  });
  return { broker, fetch };
}

function ordenAlpaca(extra = {}) {
  return {
    id: 'b0b6dd9d-8b9b-48a9-ba46-b9d54906e415', client_order_id: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1',
    created_at: '2026-09-29T16:00:01.123Z', updated_at: '2026-09-29T16:00:01.456Z', submitted_at: '2026-09-29T16:00:01.123Z',
    filled_at: null, asset_class: 'crypto', symbol: 'BTC/USD', notional: '1000', qty: null, filled_qty: '0',
    filled_avg_price: null, order_class: '', type: 'market', side: 'buy', time_in_force: 'gtc', status: 'pending_new',
    ...extra,
  };
}

// ---- solo papel --------------------------------------------------------------
test('solo papel: el constructor rechaza cualquier URL que no sea la de paper', () => {
  const base = { claveId: 'a', secreto: 'b', fetch: async () => {} };
  assert.throws(() => new AlpacaBroker({ ...base, urlBase: 'https://api.alpaca.markets' }), /solo opera en papel/);
  assert.throws(() => new AlpacaBroker({ ...base, urlBase: 'http://paper-api.alpaca.markets' }), /solo opera en papel/);
  assert.throws(() => new AlpacaBroker({ ...base, urlBase: 'https://paper-api.alpaca.markets.evil.com' }), /solo opera en papel/);
  assert.equal(new AlpacaBroker({ ...base, urlBase: 'https://paper-api.alpaca.markets/' }).urlBase, URL_PAPER);
  assert.equal(new AlpacaBroker(base).nombre, 'alpaca-paper');
  assert.throws(() => new AlpacaBroker({ fetch: async () => {} }), /claveId y secreto/);
});

// ---- cuerpos exactos de las órdenes ------------------------------------------
test('orden cripto: cuerpo exacto (BTC/USD, notional string, gtc), URL y cabeceras', async () => {
  const { broker, fetch } = crear(() => ({ json: ordenAlpaca() }));
  const o = await broker.enviarOrden({ idCliente: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  assert.equal(fetch.llamadas.length, 1);
  const [ll] = fetch.llamadas;
  assert.equal(ll.url, 'https://paper-api.alpaca.markets/v2/orders');
  assert.equal(ll.metodo, 'POST');
  assert.deepEqual(ll.cuerpo, {
    symbol: 'BTC/USD', notional: '1000', side: 'buy', type: 'market', time_in_force: 'gtc',
    client_order_id: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1',
  });
  assert.equal(ll.cabeceras['APCA-API-KEY-ID'], 'PKTEST');
  assert.equal(ll.cabeceras['APCA-API-SECRET-KEY'], 'SECRETO');
  assert.equal(ll.cabeceras['Content-Type'], 'application/json');
  assert.equal(o.estado, 'pendiente');
  assert.equal(o.simbolo, 'BTC/USD');
  assert.equal(o.lado, 'compra');
  assert.equal(o.nocional, 1000);
  assert.equal(o.cantidad, null);
  assert.equal(o.comision, null);
});

test('orden de acción: venta por cantidad con time_in_force day', async () => {
  const { broker, fetch } = crear(() => ({ json: ordenAlpaca({ symbol: 'SPY', asset_class: 'us_equity', side: 'sell', qty: '3.654', notional: null, time_in_force: 'day', client_order_id: 'mt-momentum-etf-SPY-x' }) }));
  const o = await broker.enviarOrden({ idCliente: 'mt-momentum-etf-SPY-x', simbolo: 'SPY', lado: 'venta', cantidad: 3.654 });
  assert.deepEqual(fetch.llamadas[0].cuerpo, {
    symbol: 'SPY', qty: '3.654', side: 'sell', type: 'market', time_in_force: 'day', client_order_id: 'mt-momentum-etf-SPY-x',
  });
  assert.equal(o.simbolo, 'SPY');
  assert.equal(o.lado, 'venta');
  assert.equal(o.cantidad, 3.654);
});

test('las cantidades van como string sin notación científica y con ≤ 9 decimales', () => {
  assert.equal(decimalTexto(1000), '1000');
  assert.equal(decimalTexto(0.009975), '0.009975');
  assert.equal(decimalTexto(1e-7), '0.0000001');
  assert.equal(decimalTexto(0.1234567894), '0.123456789');
  assert.equal(decimalTexto(15.5), '15.5');
});

test('una orden mal formada no llega a enviarse', async () => {
  const { broker, fetch } = crear(() => ({ json: ordenAlpaca() }));
  await assert.rejects(broker.enviarOrden({ idCliente: 'x', simbolo: 'BTC/USD', lado: 'compra' }), e => e.tipo === 'invalida');
  await assert.rejects(broker.enviarOrden({ idCliente: 'x', simbolo: 'BTC/USD', lado: 'compra', cantidad: 1, nocional: 5 }), e => e.tipo === 'invalida');
  await assert.rejects(broker.enviarOrden({ idCliente: 'x'.repeat(129), simbolo: 'BTC/USD', lado: 'compra', nocional: 5 }), e => e.tipo === 'invalida');
  await assert.rejects(broker.enviarOrden({ idCliente: 'x', simbolo: 'BTC/USD', lado: 'buy', nocional: 5 }), e => e.tipo === 'invalida');
  assert.equal(fetch.llamadas.length, 0);
});

// ---- cuenta y posiciones ------------------------------------------------------
test('cuenta: importes string → número; sin campos PDT no pasa nada', async () => {
  const { broker, fetch } = crear(() => ({
    json: {
      status: 'ACTIVE', equity: '100250.5', last_equity: '100000', cash: '90000.25', buying_power: '180000.5',
      non_marginable_buying_power: '90000.25', trading_blocked: false, account_blocked: false, trade_suspended_by_user: false,
    },
  }));
  const c = await broker.cuenta();
  assert.deepEqual(c, {
    patrimonio: 100250.5, efectivo: 90000.25, poderCompra: 90000.25, patrimonioAyer: 100000,
    bloqueada: false, estado: 'ACTIVE', poderCompraMargen: 180000.5,
  });
  assert.equal(fetch.llamadas[0].url, 'https://paper-api.alpaca.markets/v2/account');
  assert.equal(fetch.llamadas[0].metodo, 'GET');
});

test('cuenta bloqueada si trading_blocked o estado no ACTIVE', async () => {
  const { broker } = crear(() => ({ json: { status: 'ACTIVE', equity: '1', last_equity: '1', cash: '1', trading_blocked: true } }));
  assert.equal((await broker.cuenta()).bloqueada, true);
  const { broker: b2 } = crear(() => ({ json: { status: 'ACCOUNT_UPDATED', equity: '1', last_equity: '1', cash: '1' } }));
  assert.equal((await b2.cuenta()).bloqueada, true);
});

test('posiciones: BTCUSD → BTC/USD, qty_available como disponible, SPY igual', async () => {
  const { broker } = crear(() => ({
    json: [
      { asset_id: 'u1', symbol: 'BTCUSD', exchange: 'CRYPTO', asset_class: 'crypto', avg_entry_price: '83000.1', qty: '0.012',
        qty_available: '0.010', side: 'long', market_value: '1002.4', cost_basis: '996.0', unrealized_pl: '6.4', current_price: '83533' },
      { asset_id: 'u2', symbol: 'SPY', exchange: 'ARCA', asset_class: 'us_equity', avg_entry_price: '500', qty: '2',
        qty_available: '2', side: 'long', market_value: '1010', cost_basis: '1000', unrealized_pl: '10', current_price: '505' },
    ],
  }));
  const p = await broker.posiciones();
  assert.deepEqual(p[0], {
    simbolo: 'BTC/USD', cantidad: 0.012, disponible: 0.01, precioMedio: 83000.1, precioActual: 83533,
    valor: 1002.4, pnlNoRealizado: 6.4, clase: 'cripto', idActivo: 'u1',
  });
  assert.equal(p[1].simbolo, 'SPY');
  assert.equal(p[1].clase, 'accion');
});

// ---- errores -------------------------------------------------------------------
async function errorDe(status, cuerpo) {
  const { broker, fetch } = crear(() => ({ status, json: cuerpo }));
  try {
    await broker.enviarOrden({ idCliente: 'id-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 50 });
  } catch (e) {
    return { e, posts: fetch.llamadas.filter(l => l.metodo === 'POST').length };
  }
  throw new Error('no lanzó');
}

test('403 insufficient buying power → fondos (sin reintento)', async () => {
  const { e, posts } = await errorDe(403, { code: 40310000, message: 'insufficient buying power' });
  assert.ok(e instanceof ErrorBroker);
  assert.equal(e.tipo, 'fondos');
  assert.equal(e.status, 403);
  assert.equal(posts, 1);
});

test('403 insufficient qty → cantidad', async () => {
  const { e } = await errorDe(403, { code: 40310000, message: 'insufficient qty available for order (requested: 1, available: 0)' });
  assert.equal(e.tipo, 'cantidad');
});

test('403 wash trade → lavado', async () => {
  const { e } = await errorDe(403, { message: 'potential wash trade detected. use complex orders' });
  assert.equal(e.tipo, 'lavado');
});

test('422 → invalida', async () => {
  const { e } = await errorDe(422, { code: 42210000, message: 'fractional orders must be DAY orders' });
  assert.equal(e.tipo, 'invalida');
  assert.equal(e.reintentable, false);
});

test('401 → auth', async () => {
  const { e } = await errorDe(401, { message: 'unauthorized.' });
  assert.equal(e.tipo, 'auth');
});

test('429 en un POST de orden → limite, sin reintentar a ciegas', async () => {
  const { e, posts } = await errorDe(429, { message: 'too many requests' });
  assert.equal(e.tipo, 'limite');
  assert.equal(e.reintentable, true);
  assert.equal(posts, 1);
});

test('429 en un GET se reintenta con espera y frena el limitador compartido', async () => {
  // Reloj falso: dormir avanza el tiempo, así no se espera de verdad.
  let t = 0;
  const esperas = [];
  const limitador = new Limitador({ maxPorMinuto: 180, ahora: () => t, dormir: async ms => { esperas.push(ms); t += ms; } });
  const { broker, fetch } = crear((ll, n) => (n === 1
    ? { status: 429, texto: 'Too Many Requests', cabeceras: { 'Retry-After': '3' } }
    : { json: { is_open: false, next_open: '2026-09-30T09:30:00-04:00', next_close: '2026-09-30T16:00:00-04:00', timestamp: '2026-09-29T20:00:00-04:00' } }), { limitador });
  const r = await broker.relojMercado();
  assert.equal(fetch.llamadas.length, 2);
  assert.deepEqual(esperas, [3000]);
  assert.equal(r.abierto, false);
  assert.equal(r.proximaApertura, Date.parse('2026-09-30T13:30:00Z'));
  assert.equal(r.proximoCierre, Date.parse('2026-09-30T20:00:00Z'));
});

test('GET con 5xx reintenta con backoff 1-2-4 s y acaba lanzando si no se recupera', async () => {
  const esperas = [];
  const { broker, fetch } = crear(() => ({ status: 503, texto: '' }), { dormir: async ms => { esperas.push(ms); }, maxReintentos: 3 });
  await assert.rejects(broker.cuenta(), e => e.tipo === 'red');
  assert.equal(fetch.llamadas.length, 4);
  assert.deepEqual(esperas, [1000, 2000, 4000]);
});

// ---- envío idempotente --------------------------------------------------------
test('timeout en el envío → consulta por idCliente, la encuentra y NO duplica', async () => {
  const { broker, fetch } = crear((ll) => {
    if (ll.metodo === 'POST') return 'colgar';
    if (ll.url.includes('orders:by_client_order_id')) return { json: ordenAlpaca({ status: 'filled', filled_qty: '0.0119', filled_avg_price: '84000' }) };
    throw new Error('inesperado');
  }, { timeoutMs: 30 });
  const o = await broker.enviarOrden({ idCliente: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  const posts = fetch.llamadas.filter(l => l.metodo === 'POST');
  const consultas = fetch.llamadas.filter(l => l.url.includes('by_client_order_id'));
  assert.equal(posts.length, 1, 'un solo POST');
  assert.equal(consultas.length, 1);
  assert.equal(consultas[0].url, 'https://paper-api.alpaca.markets/v2/orders:by_client_order_id?client_order_id=mt-tendencia-BTCUSD-20260929T1600-abrir-1');
  assert.equal(o.estado, 'ejecutada');
  assert.equal(o.cantidadEjecutada, 0.0119);
  assert.equal(o.precioMedio, 84000);
});

test('timeout en el envío y la orden no existe → consulta primero y reenvía una vez', async () => {
  const orden = [];
  const { broker, fetch } = crear((ll, n) => {
    orden.push(ll.metodo + (ll.url.includes('by_client') ? ':consulta' : ''));
    if (ll.metodo === 'POST') return n === 1 ? 'colgar' : { json: ordenAlpaca() };
    return { status: 404, json: { code: 40410000, message: 'order not found' } };
  }, { timeoutMs: 30 });
  const o = await broker.enviarOrden({ idCliente: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  assert.deepEqual(orden, ['POST', 'GET:consulta', 'POST']);
  assert.equal(fetch.llamadas.filter(l => l.metodo === 'POST').length, 2);
  assert.equal(o.estado, 'pendiente');
});

test('500 en el envío → consulta por idCliente antes de nada', async () => {
  const { broker, fetch } = crear((ll) => (ll.metodo === 'POST'
    ? { status: 500, json: { message: 'internal error' } }
    : { json: ordenAlpaca({ status: 'accepted' }) }));
  const o = await broker.enviarOrden({ idCliente: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  assert.equal(fetch.llamadas.filter(l => l.metodo === 'POST').length, 1);
  assert.equal(o.estado, 'pendiente');
});

test('422 «client_order_id must be unique» prueba que ya entró: devuelve la existente', async () => {
  const { broker, fetch } = crear((ll) => (ll.metodo === 'POST'
    ? { status: 422, json: { code: 40010001, message: 'client_order_id must be unique' } }
    : { json: ordenAlpaca({ status: 'filled', filled_qty: '0.0119', filled_avg_price: '84000' }) }));
  const o = await broker.enviarOrden({ idCliente: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  assert.equal(o.estado, 'ejecutada');
  assert.equal(fetch.llamadas.filter(l => l.metodo === 'POST').length, 1);
});

test('fallo de red persistente: tres POST separados por consultas y lanza red', async () => {
  const { broker, fetch } = crear((ll) => (ll.metodo === 'POST' ? new TypeError('fetch failed') : { status: 404, json: {} }));
  await assert.rejects(broker.enviarOrden({ idCliente: 'id-red', simbolo: 'BTC/USD', lado: 'compra', nocional: 20 }), e => e.tipo === 'red');
  const secuencia = fetch.llamadas.map(l => (l.metodo === 'POST' ? 'P' : 'C')).join('');
  assert.equal(secuencia, 'PCPCPC');
});

// ---- consultas y mapeo ----------------------------------------------------------
test('ordenPorIdCliente: 404 → null y el id va codificado', async () => {
  const { broker, fetch } = crear(() => ({ status: 404, json: { message: 'order not found for id' } }));
  assert.equal(await broker.ordenPorIdCliente('a b/c'), null);
  assert.equal(fetch.llamadas[0].url, 'https://paper-api.alpaca.markets/v2/orders:by_client_order_id?client_order_id=a%20b%2Fc');
});

test('esperarEjecucion sondea hasta un estado final', async () => {
  const estados = ['pending_new', 'partially_filled', 'filled'];
  const { broker, fetch } = crear((ll, n) => ({
    json: ordenAlpaca({ status: estados[Math.min(n - 1, 2)], filled_qty: n === 1 ? '0' : n === 2 ? '0.005' : '0.0119', filled_avg_price: n === 1 ? null : '84000' }),
  }));
  const o = await broker.esperarEjecucion('mt-tendencia-BTCUSD-20260929T1600-abrir-1', { timeoutMs: 20_000, intervaloMs: 1000 });
  assert.equal(fetch.llamadas.length, 3);
  assert.equal(o.estado, 'ejecutada');
  assert.equal(o.cantidadEjecutada, 0.0119);
});

test('esperarEjecucion devuelve la última vista si no llega a final (reloj parado)', async () => {
  const { broker, fetch } = crear(() => ({ json: ordenAlpaca({ status: 'new' }) }));
  const o = await broker.esperarEjecucion('x', { timeoutMs: 3000, intervaloMs: 1000 });
  assert.equal(o.estado, 'pendiente');
  assert.equal(fetch.llamadas.length, 4);
});

test('mapeo de estados de Alpaca a los del contrato', () => {
  const m = s => mapearOrden(ordenAlpaca({ status: s })).estado;
  assert.equal(m('new'), 'pendiente');
  assert.equal(m('accepted'), 'pendiente');
  assert.equal(m('pending_new'), 'pendiente');
  assert.equal(m('partially_filled'), 'parcial');
  assert.equal(m('filled'), 'ejecutada');
  assert.equal(m('canceled'), 'cancelada');
  assert.equal(m('expired'), 'caducada');
  assert.equal(m('rejected'), 'rechazada');
  assert.equal(m('replaced'), 'cancelada');
  assert.equal(mapearOrden(ordenAlpaca({ status: 'done_for_day', filled_qty: '1' })).estado, 'parcial');
  const o = mapearOrden(ordenAlpaca({ status: 'rejected' }));
  assert.equal(o.motivo, 'alpaca: rejected');
  assert.equal(o.creada, Date.parse('2026-09-29T16:00:01.123Z'));
});

test('ordenesAbiertas, cancelarTodas (207) y cerrarTodo (207 con un fallo)', async () => {
  const { broker, fetch } = crear((ll) => {
    if (ll.metodo === 'GET') return { json: [ordenAlpaca({ status: 'new' })] };
    if (ll.url.endsWith('/v2/orders')) return { status: 207, json: [{ id: 'a', status: 200 }, { id: 'b', status: 500 }] };
    return {
      status: 207, json: [
        { symbol: 'BTCUSD', status: 200, body: { asset_class: 'crypto', symbol: 'BTCUSD' } },
        { symbol: 'SPY', status: 403, body: { message: 'market closed', asset_class: 'us_equity' } },
      ],
    };
  });
  const abiertas = await broker.ordenesAbiertas();
  assert.equal(abiertas.length, 1);
  assert.match(fetch.llamadas[0].url, /\/v2\/orders\?status=open&limit=500/);
  assert.equal(await broker.cancelarTodas(), 1);
  assert.equal(fetch.llamadas[1].metodo, 'DELETE');
  const r = await broker.cerrarTodo();
  assert.equal(fetch.llamadas[2].url, 'https://paper-api.alpaca.markets/v2/positions?cancel_orders=true');
  assert.deepEqual(r.cerradas, ['BTC/USD']);
  assert.equal(r.errores.length, 1);
  assert.equal(r.errores[0].simbolo, 'SPY');
});

test('cerrarTodo no lanza aunque Alpaca devuelva 500', async () => {
  const { broker } = crear(() => ({ status: 500, json: { message: 'Failed to liquidate' } }), { maxReintentos: 0 });
  const r = await broker.cerrarTodo();
  assert.deepEqual(r.cerradas, []);
  assert.equal(r.errores.length, 1);
});

test('activo: la barra va codificada y los mínimos salen del activo', async () => {
  const { broker, fetch } = crear(() => ({
    json: { class: 'crypto', symbol: 'BTC/USD', status: 'active', tradable: true, fractionable: true,
      min_order_size: '0.0001', min_trade_increment: '0.0001', price_increment: '1' },
  }));
  const a = await broker.activo('BTC/USD');
  assert.equal(fetch.llamadas[0].url, 'https://paper-api.alpaca.markets/v2/assets/BTC%2FUSD');
  assert.deepEqual(a, { negociable: true, fraccionable: true, minCantidad: 0.0001, incremento: 0.0001, minNocional: null, incrementoPrecio: 1, clase: 'cripto' });
});

test('todas las peticiones van a la URL de papel', async () => {
  const { broker, fetch } = crear(() => ({ json: {} }));
  await broker.relojMercado().catch(() => {});
  await broker.ordenesAbiertas().catch(() => {});
  for (const ll of fetch.llamadas) assert.ok(ll.url.startsWith('https://paper-api.alpaca.markets/'), ll.url);
});
