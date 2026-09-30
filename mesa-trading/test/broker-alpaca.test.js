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
  // filled_qty es bruto; en la posición entra el neto (la comisión se cobra en el activo).
  assert.equal(o.cantidadBruta, 0.0119);
  assert.equal(o.cantidadEjecutada, 0.01187025);
  assert.ok(Math.abs(o.comision - 2.499) < 1e-9, `comisión ${o.comision} = 0,0119 × 84.000 × 0,0025`);
  assert.equal(o.comisionEstimada, true);
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

test('422 «client_order_id must be unique» en el PRIMER envío: no es nuestra, no se adopta → invalida', async () => {
  // Nada de esta llamada llegó antes al bróker: el id lo usa otra orden (otra
  // carpeta de datos sobre la misma cuenta). Adoptarla apuntaría una compra que no se hizo.
  const { broker, fetch } = crear((ll) => (ll.metodo === 'POST'
    ? { status: 422, json: { code: 40010001, message: 'client_order_id must be unique' } }
    : { json: ordenAlpaca({ status: 'filled', filled_qty: '0.0119', filled_avg_price: '84000' }) }));
  await assert.rejects(
    broker.enviarOrden({ idCliente: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 }),
    e => e instanceof ErrorBroker && e.tipo === 'invalida' && /ya usado/.test(e.message),
  );
  assert.equal(fetch.llamadas.filter(l => l.metodo === 'POST').length, 1);
  assert.equal(fetch.llamadas.filter(l => l.metodo === 'GET').length, 0, 'ni se consulta');
});

test('reintento: POST sin respuesta → GET 404 → POST 422 duplicado → adopta la existente si es la misma orden', async () => {
  const secuencia = [];
  const { broker } = crear((ll, n) => {
    secuencia.push(ll.metodo);
    if (ll.metodo === 'POST') return n === 1 ? 'colgar' : { status: 422, json: { code: 40010001, message: 'client_order_id must be unique' } };
    return secuencia.filter(x => x === 'GET').length === 1
      ? { status: 404, json: { message: 'order not found' } }
      : { json: ordenAlpaca({ status: 'filled', filled_qty: '0.0119', filled_avg_price: '84000' }) };
  }, { timeoutMs: 30 });
  const o = await broker.enviarOrden({ idCliente: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  assert.deepEqual(secuencia, ['POST', 'GET', 'POST', 'GET']);
  assert.equal(o.estado, 'ejecutada');
  assert.equal(o.idCliente, 'mt-tendencia-BTCUSD-20260929T1600-abrir-1');
});

test('una orden existente con nuestro idCliente pero OTRO contenido no se adopta en ninguno de los tres caminos', async () => {
  const pedida = { idCliente: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 };
  const otras = [
    ordenAlpaca({ status: 'filled', notional: '5000', filled_qty: '0.06', filled_avg_price: '84000' }),   // otro importe
    ordenAlpaca({ status: 'filled', symbol: 'SOL/USD', filled_qty: '8', filled_avg_price: '125' }),     // otro símbolo
    ordenAlpaca({ status: 'filled', side: 'sell', notional: null, qty: '0.01', filled_qty: '0.01', filled_avg_price: '84000' }), // otro lado
  ];
  const ok = e => e instanceof ErrorBroker && e.tipo === 'invalida' && /ya usado/.test(e.message);
  for (const otra of otras) {
    // (1) Tras un POST sin respuesta, la consulta del reintento la encuentra.
    const a = crear(ll => (ll.metodo === 'POST' ? 'colgar' : { json: otra }), { timeoutMs: 30 });
    await assert.rejects(a.broker.enviarOrden(pedida), ok, 'consulta del reintento');
    // (2) POST sin respuesta → 404 → POST 422 duplicado → la consulta la encuentra.
    let gets = 0;
    const b = crear((ll, n) => {
      if (ll.metodo === 'POST') return n === 1 ? new TypeError('fetch failed') : { status: 422, json: { message: 'client_order_id must be unique' } };
      return ++gets === 1 ? { status: 404, json: {} } : { json: otra };
    });
    await assert.rejects(b.broker.enviarOrden(pedida), ok, 'consulta tras el 422');
    // (3) Tres POST sin respuesta; la comprobación final la encuentra.
    let consultas = 0;
    const c = crear(ll => (ll.metodo === 'POST' ? new TypeError('fetch failed') : ++consultas < 3 ? { status: 404, json: {} } : { json: otra }));
    await assert.rejects(c.broker.enviarOrden(pedida), ok, 'comprobación final');
  }
});

test('tras un POST sin respuesta, si la consulta por idCliente falla con otro error (401) se avisa como red: pudo entrar', async () => {
  const { broker } = crear(ll => (ll.metodo === 'POST' ? new TypeError('fetch failed') : { status: 401, json: { message: 'unauthorized.' } }));
  await assert.rejects(
    broker.enviarOrden({ idCliente: 'id-incierta', simbolo: 'BTC/USD', lado: 'compra', nocional: 50 }),
    e => e instanceof ErrorBroker && e.tipo === 'red' && /pudo entrar/.test(e.message),
  );
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
  assert.equal(o.cantidadBruta, 0.0119);
  assert.equal(o.cantidadEjecutada, 0.01187025);
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
        { symbol: 'BTCUSD', status: 200, body: ordenAlpaca({ id: 'liq-1', client_order_id: 'alpaca-liq-1', symbol: 'BTC/USD', side: 'sell', notional: null, qty: '0.012', status: 'accepted' }) },
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
  // La liquidación es una orden nueva que el fondo no envió: se devuelve para poder seguirla.
  assert.equal(r.ordenes.length, 1);
  assert.equal(r.ordenes[0].idCliente, 'alpaca-liq-1');
  assert.equal(r.ordenes[0].simbolo, 'BTC/USD');
  assert.equal(r.ordenes[0].lado, 'venta');
  assert.equal(r.ordenes[0].cantidad, 0.012);
  assert.equal(r.ordenes[0].estado, 'pendiente');
});

test('cerrarTodo no lanza aunque Alpaca devuelva 500', async () => {
  const { broker } = crear(() => ({ status: 500, json: { message: 'Failed to liquidate' } }), { maxReintentos: 0 });
  const r = await broker.cerrarTodo();
  assert.deepEqual(r.cerradas, []);
  assert.deepEqual(r.ordenes, []);
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

// ---- comisión cripto estimada (ficha §4) --------------------------------------
// Alpaca cobra la comisión sobre lo que se RECIBE: al comprar, en el activo
// (filled_qty es bruto y a la posición llega menos); al vender, en dólares. La
// orden no trae la comisión, así que el adaptador la estima a la tasa taker y
// deja la orden con el mismo contrato que BrokerSimulado.
const compraBTC = extra => ordenAlpaca({ status: 'filled', notional: '1000', filled_qty: '0.01', filled_avg_price: '100000', ...extra });
const ventaBTC = extra => ordenAlpaca({ status: 'filled', side: 'sell', notional: null, qty: '0.009975', filled_qty: '0.009975', filled_avg_price: '110000', ...extra });

test('CASO CONOCIDO: compra de 1.000 $ de BTC a 100.000 → filled_qty 0,01 bruto; entran 0,009975 y la comisión estimada es 2,5 $', () => {
  const o = mapearOrden(compraBTC());
  assert.equal(o.cantidadBruta, 0.01);
  assert.equal(o.cantidadEjecutada, 0.009975, '0,01 × (1 − 0,0025)');
  assert.ok(Math.abs(o.comision - 2.5) < 1e-9, `comisión ${o.comision}`);
  assert.equal(o.comisionEstimada, true);
  // Mismas cifras que el caso conocido de BrokerSimulado (test/broker-simulado.test.js).
});

test('CASO CONOCIDO: venta de 0,009975 BTC a 110.000 → la cantidad sale entera y la comisión es 2,743125 $', () => {
  const o = mapearOrden(ventaBTC());
  assert.equal(o.cantidadBruta, 0.009975);
  assert.equal(o.cantidadEjecutada, 0.009975);
  assert.ok(Math.abs(o.comision - 2.743125) < 1e-9, `comisión ${o.comision} = 0,009975 × 110.000 × 0,0025`);
  assert.equal(o.comisionEstimada, true);
});

test('comisión: acciones 0 y cantidad entera; cripto sin ejecutar null; ejecución parcial neta de lo ejecutado', () => {
  const spy = mapearOrden(ordenAlpaca({ symbol: 'SPY', asset_class: 'us_equity', status: 'filled', notional: '1000', filled_qty: '2', filled_avg_price: '500', time_in_force: 'day' }));
  assert.equal(spy.comision, 0);
  assert.equal(spy.cantidadEjecutada, 2);
  assert.equal(spy.comisionEstimada, false);
  const pendiente = mapearOrden(ordenAlpaca());
  assert.equal(pendiente.comision, null);
  assert.equal(pendiente.cantidadEjecutada, 0);
  const parcial = mapearOrden(compraBTC({ status: 'partially_filled', filled_qty: '0.004' }));
  assert.equal(parcial.estado, 'parcial');
  assert.equal(parcial.cantidadBruta, 0.004);
  assert.equal(parcial.cantidadEjecutada, 0.00399);
  assert.ok(Math.abs(parcial.comision - 1) < 1e-9);
});

test('la tasa se puede configurar: con comisión 0 (paper que no cobra) lo ejecutado es lo bruto', async () => {
  const { broker } = crear(() => ({ json: compraBTC() }), { costes: { comision: 0 } });
  const o = await broker.enviarOrden({ idCliente: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  assert.equal(o.cantidadEjecutada, 0.01);
  assert.equal(o.comision, 0);
  const tasaFija = mapearOrden(compraBTC(), { comision: 0.0022 });
  assert.equal(tasaFija.cantidadEjecutada, 0.009978);
  assert.ok(Math.abs(tasaFija.comision - 2.2) < 1e-9);
});

test('todas las lecturas de órdenes estiman igual (enviar, consultar, esperar, abiertas)', async () => {
  const { broker } = crear(ll => (ll.url.includes('status=open') ? { json: [compraBTC({ status: 'partially_filled' })] } : { json: compraBTC() }));
  const vistas = [
    await broker.enviarOrden({ idCliente: 'mt-tendencia-BTCUSD-20260929T1600-abrir-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 }),
    await broker.ordenPorIdCliente('mt-tendencia-BTCUSD-20260929T1600-abrir-1'),
    await broker.esperarEjecucion('mt-tendencia-BTCUSD-20260929T1600-abrir-1'),
    (await broker.ordenesAbiertas())[0],
  ];
  for (const o of vistas) {
    assert.equal(o.cantidadEjecutada, 0.009975);
    assert.ok(Math.abs(o.comision - 2.5) < 1e-9);
  }
});

// ---- cancelar una orden concreta ------------------------------------------------
test('cancelarOrden: DELETE /v2/orders/{id}; 204 → true; 422 (ya no se puede) o 404 → false, sin lanzar', async () => {
  const respuestas = [{ status: 204 }, { status: 422, json: { message: 'order is not cancelable' } }, { status: 404, json: { message: 'order not found' } }];
  const { broker, fetch } = crear((ll, n) => respuestas[n - 1]);
  assert.equal(await broker.cancelarOrden('b0b6dd9d-8b9b 1'), true);
  assert.equal(fetch.llamadas[0].metodo, 'DELETE');
  assert.equal(fetch.llamadas[0].url, 'https://paper-api.alpaca.markets/v2/orders/b0b6dd9d-8b9b%201');
  assert.equal(await broker.cancelarOrden('x'), false);
  assert.equal(await broker.cancelarOrden('y'), false);
  await assert.rejects(broker.cancelarOrden(''), e => e.tipo === 'invalida');
});

test('comisiones (CFEE): la de compra viene en el activo y la de venta en dólares; importeUsd las pone en dólares', async () => {
  const { broker, fetch } = crear(() => ({ json: [
    { id: 'a1', activity_type: 'CFEE', date: '2026-09-29', symbol: 'BTCUSD', qty: '-0.000025', price: '100000', net_amount: '0' },
    { id: 'a2', activity_type: 'CFEE', date: '2026-09-29', symbol: 'BTCUSD', qty: '0', price: '110000', net_amount: '-2.743125' },
    { id: 'a3', activity_type: 'CFEE', date: '2026-09-29', symbol: 'ETHUSD', qty: '-0.001', net_amount: '0' },
  ] }));
  const c = await broker.comisiones({ desde: Date.UTC(2026, 8, 29) });
  assert.equal(fetch.llamadas[0].url, 'https://paper-api.alpaca.markets/v2/account/activities/CFEE?after=2026-09-29T00%3A00%3A00.000Z');
  assert.equal(c[0].simbolo, 'BTC/USD');
  assert.ok(Math.abs(c[0].importeUsd - 2.5) < 1e-9, 'compra: 0,000025 BTC × 100.000');
  assert.ok(Math.abs(c[1].importeUsd - 2.743125) < 1e-9, 'venta: en dólares');
  assert.equal(c[2].importeUsd, null, 'sin precio no se inventa');
});
