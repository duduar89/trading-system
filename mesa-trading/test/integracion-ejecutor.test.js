'use strict';
// Ejecutor (§6.7) con un bróker simulado y el calendario real: intención
// antes de enviar, acciones con la bolsa cerrada a la apertura + 5 min,
// ventas = min(puesto, disponible) y órdenes del mismo símbolo en serie.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { carpetaTemporal } = require('./integracion-ayuda');
const { Ejecutor } = require('../src/agentes/departamentos/operaciones');
const { BrokerSimulado } = require('../src/broker/simulado');
const { Libros } = require('../src/cartera/libros');
const { RelojSimulado } = require('../src/util/reloj');
const { leerJSONL } = require('../src/util/almacen');
const calendario = require('../src/mercado/calendario');

function montar(t0) {
  const carpeta = carpetaTemporal();
  const reloj = new RelojSimulado(t0);
  const precios = { SPY: { precio: 500, t: t0 }, 'BTC/USD': { precio: 100000, t: t0 } };
  const fuente = { ultimos: async s => Object.fromEntries(s.filter(x => precios[x]).map(x => [x, { ...precios[x], t: reloj.ahora() }])) };
  const broker = new BrokerSimulado({ capitalInicial: 100000, fuente, reloj, ruta: path.join(carpeta, 'broker.json') });
  const libros = new Libros();
  libros.asegurarPuesto({ puestoId: 'momentum-etf-SPY', mesaId: 'momentum-etf', simbolo: 'SPY' });
  libros.asegurarPuesto({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD' });
  const mensajes = [];
  const ejecuciones = [];
  const ctx = {
    carpeta, reloj, broker, libros,
    estado: { pendientes: [], ordenesEnVuelo: {}, guardado: 0 },
    vivo: { mercadoAbierto: { accion: calendario.abierto(t0) }, relojMercado: calendario.relojMercado(t0), precios },
    bus: { publicar: m => { mensajes.push(m); return m; } },
    registroOrdenes: [],
    registrarEjecucion: ej => ejecuciones.push(ej),
    registrarOperacion: () => {},
  };
  return { ctx, carpeta, reloj, broker, libros, mensajes, ejecuciones, precios };
}

test('acciones con la bolsa cerrada: la orden espera a la apertura + 5 min y entonces se envía', async () => {
  const sabado = Date.UTC(2026, 9, 3, 15);               // sábado 3-oct-2026
  const { ctx, reloj, broker, libros, mensajes } = montar(sabado);
  const ej = new Ejecutor(ctx);
  const r = await ej.ejecutar({ puestoId: 'momentum-etf-SPY', mesaId: 'momentum-etf', simbolo: 'SPY', lado: 'compra', nocional: 1000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: sabado, precioReferencia: 500 });
  assert.equal(r.pendiente, true);
  assert.equal(broker.estado.ordenes.length, 0, 'no se envía nada con la bolsa cerrada');
  const p = ctx.estado.pendientes[0];
  assert.equal(p.enviarDesde, calendario.proximaApertura(sabado) + 5 * 60_000);
  assert.match(mensajes[0].texto, /Bolsa cerrada/);
  // El lunes a las 9:31 ET aún no; a las 9:35 sí.
  reloj.fijar(p.enviarDesde - 4 * 60_000);
  ctx.vivo.mercadoAbierto = { accion: true };
  assert.equal(await ej.procesarPendientes(async o => o), 0);
  reloj.fijar(p.enviarDesde);
  assert.equal(await ej.procesarPendientes(async o => o), 1);
  assert.equal(ctx.estado.pendientes.length, 0);
  assert.ok(Math.abs(libros.puesto('momentum-etf-SPY').cantidad - 1000 / (500 * 1.0002)) < 1e-6);
  const reg = leerJSONL(path.join(ctx.carpeta, 'ordenes.jsonl'));
  assert.deepEqual(reg.map(x => x.estado), ['INTENCION', 'ENVIADA', 'EJECUTADA'], 'la intención se apunta antes de enviar');
  assert.match(reg[0].idCliente, /^mt-momentum-etf-SPY-\d{8}T\d{4}Z-abrir-1$/);
});

test('ventas = min(puesto, disponible en el bróker) y órdenes del mismo símbolo en serie', async () => {
  const t0 = Date.UTC(2026, 9, 5, 15);
  const { ctx, broker, libros } = montar(t0);
  const ej = new Ejecutor(ctx);
  // Dos compras seguidas del mismo símbolo: la segunda espera a la primera.
  const orden = [];
  const enviar = broker.enviarOrden.bind(broker);
  broker.enviarOrden = async o => { orden.push(`inicio ${o.idCliente}`); const r = await enviar(o); await new Promise(x => setTimeout(x, 20)); orden.push(`fin ${o.idCliente}`); return r; };
  const a = ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 });
  const b = ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 500, tipo: 'aumento', motivo: 'señal', accion: 'abrir', velaT: t0 });
  await Promise.all([a, b]);
  assert.match(orden[0], /^inicio .*-1$/);
  assert.match(orden[1], /^fin .*-1$/);
  assert.match(orden[2], /^inicio .*-2$/, 'mismo símbolo y vela: n = 2 y después de la primera');
  // Los libros creen tener más de lo que hay (p. ej. comisión sin conciliar): se vende lo disponible.
  const enBroker = broker.estado.posiciones['BTC/USD'].cantidad;
  const p = libros.puesto('tendencia-BTC');
  broker.estado.posiciones['BTC/USD'].cantidad = Number((enBroker * 0.99).toFixed(9));
  const r = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'venta', cantidad: p.cantidad, tipo: 'cierre', motivo: 'señal', accion: 'cerrar', velaT: t0 });
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.cantidad - enBroker * 0.99) < 1e-9);
  assert.equal(broker.estado.posiciones['BTC/USD'], undefined, 'no queda nada en el bróker');
  assert.ok(libros.puesto('tendencia-BTC').cantidad > 0, 'lo que falta lo verá la conciliación, no se inventa');
});

test('una orden de acciones que ya espera a la apertura no se encola dos veces', async () => {
  const sabado = Date.UTC(2026, 9, 3, 15);
  const { ctx } = montar(sabado);
  const ej = new Ejecutor(ctx);
  const orden = { puestoId: 'momentum-etf-SPY', mesaId: 'momentum-etf', simbolo: 'SPY', lado: 'venta', cantidad: 2, tipo: 'stop', motivo: 'stop', accion: 'stop', velaT: sabado };
  assert.equal((await ej.ejecutar(orden)).pendiente, true);
  const r = await ej.ejecutar(orden);
  assert.equal(r.repetida, true);
  assert.equal(ctx.estado.pendientes.length, 1);
});

test('orden sin estado final (como en Alpaca tras 20 s): queda en vuelo, bloquea otra del mismo símbolo y se aplica al terminar', async () => {
  const t0 = Date.UTC(2026, 9, 5, 15);
  const { ctx, broker, libros } = montar(t0);
  const { conciliarCadaLatido } = require('../src/agentes/departamentos/operaciones');
  ctx.estado.conciliacion = { limpia: true };
  ctx.vivo.posicionesBroker = [];
  let final = false;
  const esperar = broker.esperarEjecucion.bind(broker);
  broker.esperarEjecucion = async id => ({ ...(await esperar(id)), ...(final ? {} : { estado: 'pendiente' }) });
  const enviar = broker.enviarOrden.bind(broker);
  broker.enviarOrden = async o => ({ ...(await enviar(o)), estado: 'pendiente' });
  const ej = new Ejecutor(ctx);
  const r1 = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 });
  assert.equal(r1.ok, false);
  assert.equal(r1.motivo, 'en_vuelo');
  assert.equal(libros.puesto('tendencia-BTC').cantidad, 0, 'nada en los libros hasta que se ejecuta');
  assert.equal(Object.keys(ctx.estado.ordenesEnVuelo).length, 1);
  const r2 = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 500, tipo: 'aumento', motivo: 'señal', accion: 'abrir', velaT: t0 });
  assert.equal(r2.motivo, 'orden_en_vuelo');
  assert.equal(broker.estado.ordenes.length, 1, 'no se manda otra encima');
  ctx.vivo.posicionesBroker = await broker.posiciones();
  assert.equal(conciliarCadaLatido(ctx).aplazada, true, 'la conciliación espera');
  final = true;
  assert.equal(await ej.resolverEnVuelo(), 1);
  assert.ok(libros.puesto('tendencia-BTC').cantidad > 0);
  assert.deepEqual(Object.keys(ctx.estado.ordenesEnVuelo), []);
});
