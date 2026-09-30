'use strict';
// CASO CONOCIDO de la contabilidad en modo Alpaca: AlpacaBroker contra un
// Alpaca falso con estado (cobra la comisión cripto como dice la ficha §4: al
// comprar en el activo, al vender en dólares), con las órdenes aplicadas a
// Libros como las aplica el Ejecutor y conciliadas como en cada latido.
//
// Se comprueba lo que se rompía cuando el adaptador daba filled_qty bruto y
// comisión null:
//  - la comisión de una compra la paga el puesto que compra, no los demás
//    puestos del símbolo a prorrata;
//  - la comisión de la venta entra en el realizado;
//  - patrimonio del bróker = capital + Σ realizado + Σ abierto neto, al céntimo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { AlpacaBroker } = require('../src/broker/alpaca-broker');
const { Libros } = require('../src/cartera/libros');
const { conciliar } = require('../src/cartera/conciliacion');
const { RelojSimulado } = require('../src/util/reloj');

const CAPITAL = 100000;
const TASA = 0.0025;
const r9 = x => Number(x.toFixed(9));

// Alpaca falso mínimo: una cuenta, órdenes a mercado que se llenan al
// instante al precio fijado y las respuestas con la forma de la API (strings).
function alpacaFalso({ comision = TASA } = {}) {
  const cuenta = { efectivo: CAPITAL, posiciones: {}, ordenes: new Map(), precio: { 'BTC/USD': 100000 }, n: 0 };
  const orden = o => ({
    id: o.id, client_order_id: o.idCliente, symbol: o.simbolo, asset_class: 'crypto', side: o.lado,
    notional: o.nocional === null ? null : String(o.nocional), qty: o.qty === null ? null : String(o.qty),
    filled_qty: String(o.bruta), filled_avg_price: String(o.precio), status: 'filled', type: 'market', time_in_force: 'gtc',
    created_at: '2026-09-29T16:00:00Z', updated_at: '2026-09-29T16:00:00Z',
  });
  const responder = (status, json) => new Response(JSON.stringify(json), { status });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const metodo = init.method || 'GET';
    if (metodo === 'POST' && u.pathname === '/v2/orders') {
      const c = JSON.parse(init.body);
      const s = c.symbol;
      const px = cuenta.precio[s];
      const pos = cuenta.posiciones[s] || (cuenta.posiciones[s] = 0);
      let bruta;
      if (c.side === 'buy') {
        bruta = r9(Number(c.notional) / px);
        cuenta.efectivo -= Number(c.notional);
        cuenta.posiciones[s] = r9(pos + bruta * (1 - comision));   // la comisión se queda con parte del activo
      } else {
        bruta = Number(c.qty);
        if (bruta > pos + 1e-12) return responder(403, { message: 'insufficient balance for BTC' });
        cuenta.efectivo += bruta * px * (1 - comision);              // en la venta, en dólares
        cuenta.posiciones[s] = r9(pos - bruta);
      }
      const o = { id: `o-${++cuenta.n}`, idCliente: c.client_order_id, simbolo: s, lado: c.side, nocional: c.notional ?? null, qty: c.qty ?? null, bruta, precio: px };
      cuenta.ordenes.set(o.idCliente, o);
      return responder(200, orden(o));
    }
    if (metodo === 'GET' && u.pathname === '/v2/orders:by_client_order_id') {
      const o = cuenta.ordenes.get(u.searchParams.get('client_order_id'));
      return o ? responder(200, orden(o)) : responder(404, { message: 'order not found' });
    }
    if (metodo === 'GET' && u.pathname === '/v2/positions') {
      return responder(200, Object.entries(cuenta.posiciones).filter(([, q]) => q > 0).map(([s, q]) => ({
        symbol: s.replace('/', ''), asset_class: 'crypto', qty: String(q), qty_available: String(q),
        avg_entry_price: '0', market_value: String(q * cuenta.precio[s]), unrealized_pl: '0', current_price: String(cuenta.precio[s]),
      })));
    }
    throw new Error(`petición inesperada: ${metodo} ${u.pathname}`);
  };
  const patrimonio = () => cuenta.efectivo + Object.entries(cuenta.posiciones).reduce((a, [s, q]) => a + q * cuenta.precio[s], 0);
  return { cuenta, fetch, patrimonio };
}

function montar(opciones) {
  const falso = alpacaFalso(opciones);
  const broker = new AlpacaBroker({ claveId: 'PK', secreto: 'S', fetch: falso.fetch, limitador: null, dormir: async () => {}, reloj: new RelojSimulado(Date.UTC(2026, 8, 29, 16)) });
  const libros = new Libros();
  for (const mesa of ['ruptura', 'momentum']) libros.asegurarPuesto({ puestoId: `${mesa}-BTC`, mesaId: mesa, simbolo: 'BTC/USD' });
  let n = 0;
  // Lo mismo que hace el Ejecutor: enviar, esperar y aplicar la cantidad
  // ejecutada, el precio medio y la comisión de la orden al puesto.
  const operar = async (puestoId, orden) => {
    const idCliente = `mt-${puestoId}-${++n}`;
    await broker.enviarOrden({ idCliente, simbolo: 'BTC/USD', ...orden });
    const o = await broker.esperarEjecucion(idCliente);
    return libros.aplicarEjecucion({ puestoId, lado: orden.lado, cantidad: o.cantidadEjecutada, precio: o.precioMedio, comision: o.comision, idCliente, t: 0, motivo: 'senal' });
  };
  // Conciliación del latido: aplica los escalados que pida.
  const conciliarLatido = async () => {
    const r = conciliar({ posicionesBroker: await broker.posiciones(), libros, precios: { 'BTC/USD': { precio: falso.cuenta.precio['BTC/USD'] } } });
    for (const a of r.acciones) if (a.tipo === 'escalar') libros.escalarSimbolo(a.simbolo, a.factor, 'conciliación');
    return r;
  };
  const identidad = () => {
    const precios = { 'BTC/USD': { precio: falso.cuenta.precio['BTC/USD'] } };
    const v = libros.valorar(precios);
    const realizado = libros.listaPuestos({ sombra: false }).reduce((a, p) => a + p.realizado, 0);
    return falso.patrimonio() - (CAPITAL + realizado + v.pnlAbierto);
  };
  return { falso, broker, libros, operar, conciliarLatido, identidad };
}

test('CASO CONOCIDO: la comisión de la compra de momentum la paga momentum, no ruptura, y la conciliación no escala nada', async () => {
  const { libros, operar, conciliarLatido, identidad } = montar();
  await operar('ruptura-BTC', { lado: 'compra', nocional: 9000 });
  assert.deepEqual((await conciliarLatido()).acciones, []);
  const antes = libros.puesto('ruptura-BTC');
  assert.equal(antes.cantidad, 0.089775, '9.000 / 100.000 × (1 − 0,0025)');
  assert.ok(Math.abs(antes.comisiones - 22.5) < 1e-9);

  await operar('momentum-BTC', { lado: 'compra', nocional: 1000 });
  const r = await conciliarLatido();
  assert.deepEqual(r.acciones, [], 'libros y bróker ya cuadran: nada que repartir a prorrata');
  const ruptura = libros.puesto('ruptura-BTC');
  const momentum = libros.puesto('momentum-BTC');
  assert.equal(ruptura.cantidad, antes.cantidad, 'ruptura no paga la compra de otro');
  assert.ok(Math.abs(ruptura.comisiones - 22.5) < 1e-9);
  assert.equal(momentum.cantidad, 0.009975);
  assert.ok(Math.abs(momentum.comisiones - 2.5) < 1e-9, `momentum paga 1.000 × 0,25 % = 2,50 $ (${momentum.comisiones})`);
  assert.ok(Math.abs(identidad()) < 0.01, `identidad tras las compras: ${identidad()}`);
});

test('CASO CONOCIDO: vender a 110.000 apunta la comisión de venta; el realizado de momentum es 94,506875 $ y la identidad cuadra al céntimo', async () => {
  const { falso, libros, operar, conciliarLatido, identidad } = montar();
  await operar('ruptura-BTC', { lado: 'compra', nocional: 9000 });
  await operar('momentum-BTC', { lado: 'compra', nocional: 1000 });
  await conciliarLatido();
  falso.cuenta.precio['BTC/USD'] = 110000;
  const r = await operar('momentum-BTC', { lado: 'venta', cantidad: 0.009975 });
  // 0,009975 × 110.000 = 1.097,25 $; comisión de venta 2,743125 $; de entrada 2,50 $.
  // (110.000 − 100.000) × 0,009975 − 2,743125 − 2,5 = 94,506875 $.
  assert.ok(Math.abs(r.operacionCerrada.pnl - 94.506875) < 1e-6, `pnl ${r.operacionCerrada.pnl}`);
  assert.ok(Math.abs(r.operacionCerrada.comisiones - 5.243125) < 1e-6);
  assert.equal(libros.puesto('momentum-BTC').cantidad, 0, 'el puesto cierra entero');
  assert.deepEqual((await conciliarLatido()).acciones, [], 'sin resto fantasma ni huérfano');
  // Patrimonio del bróker: 91.000 + 1.094,506875 + 0,089775 × 110.000 = 100.969,756875 $.
  assert.ok(Math.abs(falso.patrimonio() - 100969.756875) < 1e-6);
  assert.ok(Math.abs(identidad()) < 0.01, `identidad tras la venta: ${identidad()}`);
});

test('si la cuenta paper NO cobrara comisión, la conciliación devuelve lo estimado de la compra y la identidad sigue cuadrando', async () => {
  // Solo la compra: la de venta estimada no la puede ver la conciliación (va
  // en dólares); para eso está contrastar con CFEE al cierre del día.
  const { libros, operar, conciliarLatido, identidad } = montar({ comision: 0 });
  await operar('momentum-BTC', { lado: 'compra', nocional: 1000 });
  const r = await conciliarLatido();
  assert.equal(r.acciones.length, 1);
  assert.equal(r.acciones[0].tipo, 'escalar');
  const p = libros.puesto('momentum-BTC');
  assert.ok(Math.abs(p.cantidad - 0.01) < 1e-12, 'vuelve a lo que de verdad hay en el bróker');
  assert.ok(Math.abs(p.comisionesPendientes) < 1e-9, 'la comisión estimada de entrada se deshace');
  assert.ok(Math.abs(identidad()) < 0.01, `identidad: ${identidad()}`);
});
