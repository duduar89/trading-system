'use strict';
// BrokerSimulado: caso conocido de la comisión cripto cobrada en el activo,
// deslizamiento, rechazos, idempotencia y persistencia (§3.4, §9-B).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BrokerSimulado, COSTES_POR_DEFECTO } = require('../src/broker/simulado');
const { ErrorBroker } = require('../src/broker/errores');
const { RelojSimulado, DIA } = require('../src/util/reloj');
const { casiIgual } = require('../src/util/numeros');

// Martes 29-sep-2026 a las 15:00Z = 11:00 ET: bolsa abierta.
const ABIERTO = Date.UTC(2026, 8, 29, 15);
const CERRADO = Date.UTC(2026, 8, 29, 21);

function fuenteFija(precios) {
  const f = { precios, ultimos: async simbolos => Object.fromEntries(simbolos.filter(s => f.precios[s]).map(s => [s, { precio: f.precios[s], t: 0 }])) };
  return f;
}

function crear({ precios = { 'BTC/USD': 100000 }, t = ABIERTO, ruta = null, costes = { deslizamiento: 0 }, capitalInicial } = {}) {
  const fuente = fuenteFija(precios);
  const reloj = new RelojSimulado(t);
  const broker = new BrokerSimulado({ fuente, reloj, ruta, costes, capitalInicial });
  return { broker, fuente, reloj };
}

test('CASO CONOCIDO: comprar 1.000 $ de BTC a 100.000 con 0,25 % → 0,009975 BTC; el efectivo baja 1.000 $ exactos', async () => {
  // 1.000 / 100.000 = 0,01 BTC brutos; la comisión se lleva el 0,25 % del
  // activo: 0,01 × (1 − 0,0025) = 0,009975 BTC. Salen exactamente 1.000 $.
  const { broker } = crear();
  const o = await broker.enviarOrden({ idCliente: 'c1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  assert.equal(o.estado, 'ejecutada');
  assert.equal(o.cantidadEjecutada, 0.009975);
  assert.equal(o.cantidadBruta, 0.01);
  assert.equal(o.precioMedio, 100000);
  assert.ok(casiIgual(o.comision, 2.5), `comisión ${o.comision} = 0,01 × 0,0025 × 100.000 = 2,5 $`);
  const c = await broker.cuenta();
  assert.equal(c.efectivo, 99000);
  const [p] = await broker.posiciones();
  assert.equal(p.simbolo, 'BTC/USD');
  assert.equal(p.cantidad, 0.009975);
  assert.equal(p.disponible, 0.009975);
  assert.ok(casiIgual(c.patrimonio, 99000 + 997.5), 'patrimonio = efectivo + 0,009975 × 100.000');
});

test('CASO CONOCIDO: vender esas 0,009975 BTC a 110.000 → entran 0,009975 × 110.000 × (1 − 0,0025) $', async () => {
  // 0,009975 × 110.000 = 1.097,25 $ brutos; comisión 0,25 % en dólares =
  // 2,743125 $; entran 1.094,506875 $. Efectivo final 100.094,506875 $.
  const { broker, fuente } = crear();
  await broker.enviarOrden({ idCliente: 'c1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  fuente.precios['BTC/USD'] = 110000;
  const v = await broker.enviarOrden({ idCliente: 'v1', simbolo: 'BTC/USD', lado: 'venta', cantidad: 0.009975 });
  assert.equal(v.cantidadEjecutada, 0.009975);
  assert.ok(casiIgual(v.comision, 2.743125));
  const c = await broker.cuenta();
  assert.ok(casiIgual(c.efectivo, 99000 + 0.009975 * 110000 * (1 - 0.0025)), `efectivo ${c.efectivo}`);
  assert.ok(casiIgual(c.efectivo, 100094.506875));
  assert.deepEqual(await broker.posiciones(), [], 'posición cerrada del todo');
  assert.ok(casiIgual(c.patrimonio, 100094.506875));
});

test('deslizamiento por defecto: BTC 5 pb (compra más cara, venta más barata)', async () => {
  const { broker, fuente } = crear({ costes: {} });
  const o = await broker.enviarOrden({ idCliente: 'c', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  // precio 100.000 × 1,0005 = 100.050; 1.000 / 100.050 × 0,9975.
  assert.ok(casiIgual(o.precioMedio, 100050));
  assert.ok(casiIgual(o.cantidadEjecutada, Number(((1000 / 100050) * 0.9975).toFixed(9))));
  fuente.precios['BTC/USD'] = 100000;
  const v = await broker.enviarOrden({ idCliente: 'v', simbolo: 'BTC/USD', lado: 'venta', cantidad: o.cantidadEjecutada });
  assert.ok(casiIgual(v.precioMedio, 99950));
});

test('costes por defecto del contrato', () => {
  assert.equal(COSTES_POR_DEFECTO.comision('BTC/USD'), 0.0025);
  assert.equal(COSTES_POR_DEFECTO.comision('SPY'), 0);
  assert.equal(COSTES_POR_DEFECTO.deslizamiento('BTC/USD'), 0.0005);
  assert.equal(COSTES_POR_DEFECTO.deslizamiento('ETH/USD'), 0.0005);
  assert.equal(COSTES_POR_DEFECTO.deslizamiento('SOL/USD'), 0.0015);
  assert.equal(COSTES_POR_DEFECTO.deslizamiento('DOGE/USD'), 0.0015);
  assert.equal(COSTES_POR_DEFECTO.deslizamiento('SPY'), 0.0002);
});

test('acciones: sin comisión, la cantidad entra entera; con el mercado cerrado se rechaza', async () => {
  const { broker, reloj } = crear({ precios: { SPY: 500 } });
  const o = await broker.enviarOrden({ idCliente: 's1', simbolo: 'SPY', lado: 'compra', nocional: 1000 });
  assert.equal(o.cantidadEjecutada, 2);
  assert.equal(o.comision, 0);
  assert.equal((await broker.cuenta()).efectivo, 99000);
  reloj.fijar(CERRADO);
  await assert.rejects(
    broker.enviarOrden({ idCliente: 's2', simbolo: 'SPY', lado: 'venta', cantidad: 1 }),
    e => e instanceof ErrorBroker && e.tipo === 'mercado_cerrado',
  );
});

test('la cripto se opera con la bolsa cerrada (24/7)', async () => {
  const { broker } = crear({ t: CERRADO });
  const o = await broker.enviarOrden({ idCliente: 'b1', simbolo: 'BTC/USD', lado: 'compra', nocional: 10 });
  assert.equal(o.estado, 'ejecutada');
});

test('rechazos: sin efectivo → fondos; venta mayor que lo disponible → cantidad; sin precio → invalida', async () => {
  const { broker } = crear({ capitalInicial: 500 });
  await assert.rejects(broker.enviarOrden({ idCliente: 'x1', simbolo: 'BTC/USD', lado: 'compra', nocional: 600 }), e => e.tipo === 'fondos');
  await assert.rejects(broker.enviarOrden({ idCliente: 'x2', simbolo: 'BTC/USD', lado: 'venta', cantidad: 0.001 }), e => e.tipo === 'cantidad');
  await broker.enviarOrden({ idCliente: 'x3', simbolo: 'BTC/USD', lado: 'compra', nocional: 100 });
  await assert.rejects(broker.enviarOrden({ idCliente: 'x4', simbolo: 'BTC/USD', lado: 'venta', cantidad: 0.001 }), e => e.tipo === 'cantidad', 'no hay cortos');
  await assert.rejects(broker.enviarOrden({ idCliente: 'x5', simbolo: 'ETH/USD', lado: 'compra', nocional: 10 }), e => e.tipo === 'invalida');
  await assert.rejects(broker.enviarOrden({ idCliente: 'x6', simbolo: 'BTC/USD', lado: 'compra', nocional: 0.5 }), e => e.tipo === 'invalida');
  // Los rechazos no tocan el estado.
  const c = await broker.cuenta();
  assert.equal(c.efectivo, 400);
  assert.equal(await broker.ordenPorIdCliente('x1'), null);
});

test('idempotente: repetir el idCliente devuelve la misma orden y no compra dos veces', async () => {
  const { broker } = crear();
  const a = await broker.enviarOrden({ idCliente: 'mt-x', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  const b = await broker.enviarOrden({ idCliente: 'mt-x', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  assert.deepEqual(a, b);
  assert.equal((await broker.cuenta()).efectivo, 99000);
  assert.deepEqual(await broker.esperarEjecucion('mt-x'), a);
  assert.deepEqual(await broker.ordenesAbiertas(), []);
  assert.equal(await broker.cancelarTodas(), 0);
});

test('persistencia: JSON atómico y al recargar queda igual', async () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-sim-'));
  const ruta = path.join(carpeta, 'broker-simulado.json');
  const { broker, fuente, reloj } = crear({ ruta, precios: { 'BTC/USD': 100000, 'ETH/USD': 4000 } });
  await broker.enviarOrden({ idCliente: 'p1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  await broker.enviarOrden({ idCliente: 'p2', simbolo: 'ETH/USD', lado: 'compra', nocional: 400 });
  const antes = { cuenta: await broker.cuenta(), posiciones: await broker.posiciones() };
  assert.ok(fs.existsSync(ruta));
  assert.deepEqual(fs.readdirSync(carpeta), ['broker-simulado.json'], 'sin temporales sueltos');
  const otro = new BrokerSimulado({ fuente, reloj, ruta, costes: { deslizamiento: 0 }, capitalInicial: 5 });
  assert.deepEqual(await otro.cuenta(), antes.cuenta);
  assert.deepEqual(await otro.posiciones(), antes.posiciones);
  assert.equal((await otro.ordenPorIdCliente('p1')).cantidadEjecutada, 0.009975);
  // Y sigue siendo idempotente tras recargar.
  await otro.enviarOrden({ idCliente: 'p1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  assert.equal((await otro.cuenta()).efectivo, antes.cuenta.efectivo);
});

test('cerrarTodo vende todo; las acciones con la bolsa cerrada quedan en errores', async () => {
  const { broker, reloj } = crear({ precios: { 'BTC/USD': 100000, SPY: 500 } });
  await broker.enviarOrden({ idCliente: 'a', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  await broker.enviarOrden({ idCliente: 'b', simbolo: 'SPY', lado: 'compra', nocional: 1000 });
  reloj.fijar(CERRADO);
  const r = await broker.cerrarTodo();
  assert.deepEqual(r.cerradas, ['BTC/USD']);
  assert.equal(r.errores.length, 1);
  assert.equal(r.errores[0].simbolo, 'SPY');
  assert.equal(r.errores[0].tipo, 'mercado_cerrado');
  const pos = await broker.posiciones();
  assert.deepEqual(pos.map(p => p.simbolo), ['SPY']);
  // Igual que AlpacaBroker: la orden de cada liquidación vuelve para poder apuntarla.
  assert.equal(r.ordenes.length, 1);
  assert.equal(r.ordenes[0].simbolo, 'BTC/USD');
  assert.equal(r.ordenes[0].lado, 'venta');
  assert.equal(r.ordenes[0].estado, 'ejecutada');
  assert.equal(r.ordenes[0].cantidadEjecutada, 0.009975);
  assert.equal(await broker.cancelarOrden(r.ordenes[0].id), false, 'todo se llena al instante: nada que cancelar');
});

test('patrimonioAyer: el último patrimonio visto el día UTC anterior', async () => {
  const { broker, fuente, reloj } = crear();
  await broker.enviarOrden({ idCliente: 'a', simbolo: 'BTC/USD', lado: 'compra', nocional: 10000 });
  const hoy = await broker.cuenta();
  assert.equal(hoy.patrimonioAyer, 100000);
  reloj.avanzar(DIA);
  fuente.precios['BTC/USD'] = 90000;
  const manana = await broker.cuenta();
  assert.ok(casiIgual(manana.patrimonioAyer, hoy.patrimonio));
  assert.ok(manana.patrimonio < hoy.patrimonio);
});

test('relojMercado y activo del simulado', async () => {
  const { broker } = crear();
  const r = await broker.relojMercado();
  assert.equal(r.abierto, true);
  assert.equal(r.proximoCierre, Date.UTC(2026, 8, 29, 20));
  const a = await broker.activo('BTC/USD');
  assert.equal(a.negociable, true);
  assert.equal(a.fraccionable, true);
  assert.equal(a.minNocional, 1);
  assert.equal(broker.nombre, 'simulado');
});

test('idCliente repetido con OTRA orden (símbolo, lado o importe distintos) → invalida, sin tocar nada', async () => {
  const { broker } = crear({ precios: { 'BTC/USD': 100000, 'SOL/USD': 125 } });
  const a = await broker.enviarOrden({ idCliente: 'mt-x', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  const ok = e => e instanceof ErrorBroker && e.tipo === 'invalida' && /ya usado/.test(e.message);
  await assert.rejects(broker.enviarOrden({ idCliente: 'mt-x', simbolo: 'BTC/USD', lado: 'compra', nocional: 5000 }), ok);
  await assert.rejects(broker.enviarOrden({ idCliente: 'mt-x', simbolo: 'SOL/USD', lado: 'compra', nocional: 1000 }), ok);
  await assert.rejects(broker.enviarOrden({ idCliente: 'mt-x', simbolo: 'BTC/USD', lado: 'venta', cantidad: 0.001 }), ok);
  assert.equal((await broker.cuenta()).efectivo, 99000);
  assert.deepEqual(await broker.ordenPorIdCliente('mt-x'), a);
});

// En Windows un rename puede dar EPERM/EBUSY un instante (OneDrive, antivirus,
// indexador). Si pasa justo después de llenar, la orden YA está hecha en
// memoria: no puede volver como error, o los libros no la apuntarían y
// quedaría una posición huérfana en el bróker.
function fallarRenames(codigo = 'EPERM') {
  const original = fs.renameSync;
  const control = { activo: true, fallos: 0 };
  fs.renameSync = (...args) => {
    if (control.activo) {
      control.fallos++;
      const e = new Error(`${codigo}: operation not permitted, rename '${args[0]}'`);
      e.code = codigo;
      throw e;
    }
    return original(...args);
  };
  control.restaurar = () => { fs.renameSync = original; };
  return control;
}

test('un fallo al guardar tras llenar (EPERM) no convierte la ejecución en error: vuelve ejecutada y se guarda en el siguiente cuenta()', async () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-sim-eperm-'));
  const ruta = path.join(carpeta, 'broker-simulado.json');
  const { broker, fuente, reloj } = crear({ ruta });
  const fallo = fallarRenames();
  let compra;
  try {
    compra = await broker.enviarOrden({ idCliente: 'e1', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000 });
  } finally { fallo.activo = false; }
  try {
    assert.ok(fallo.fallos >= 1, 'el rename falló de verdad');
    assert.equal(compra.estado, 'ejecutada');
    assert.equal(compra.cantidadEjecutada, 0.009975);
    // El disco aún no la tiene; el siguiente cuenta() la guarda.
    assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf8')).ordenes.length, 0);
    await broker.cuenta();
    assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf8')).ordenes.length, 1);

    // Lo mismo en una venta.
    fallo.activo = true;
    let venta;
    try {
      venta = await broker.enviarOrden({ idCliente: 'e2', simbolo: 'BTC/USD', lado: 'venta', cantidad: 0.009975 });
    } finally { fallo.activo = false; }
    assert.equal(venta.estado, 'ejecutada');
    await broker.cuenta();
    const recargado = new BrokerSimulado({ fuente, reloj, ruta, costes: { deslizamiento: 0 } });
    assert.deepEqual(await recargado.posiciones(), []);
    assert.ok(casiIgual((await recargado.cuenta()).efectivo, 99000 + 0.009975 * 100000 * (1 - 0.0025)));
    assert.equal((await recargado.ordenPorIdCliente('e2')).estado, 'ejecutada');
  } finally {
    fallo.restaurar();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});
