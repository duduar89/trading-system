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
  assert.match(mensajes[0].texto, /[Bb]olsa está cerrada/);
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
  // Los libros creen tener bastante más de lo que hay (un 5 %: no es comisión,
  // es un descuadre grave): se vende lo disponible y el resto no se inventa.
  const enBroker = broker.estado.posiciones['BTC/USD'].cantidad;
  const p = libros.puesto('tendencia-BTC');
  broker.estado.posiciones['BTC/USD'].cantidad = Number((enBroker * 0.95).toFixed(9));
  const r = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'venta', cantidad: p.cantidad, tipo: 'cierre', motivo: 'señal', accion: 'cerrar', velaT: t0 });
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.cantidad - enBroker * 0.95) < 1e-9);
  assert.equal(broker.estado.posiciones['BTC/USD'], undefined, 'no queda nada en el bróker');
  assert.ok(libros.puesto('tendencia-BTC').cantidad > 0, 'un descuadre grave lo verá la conciliación, no se inventa');
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

// ---------- Casos de la revisión (bróker que informa como Alpaca, red, órdenes vivas) ----------

const { ErrorBroker } = require('../src/broker/errores');
const { conciliar } = require('../src/cartera/conciliacion');

// Como AlpacaBroker antes de estimar la comisión: la compra cripto informa la
// cantidad BRUTA y comisión null, mientras la posición del bróker es la neta.
function comoAlpaca(broker) {
  const mapear = o => (o ? { ...o, cantidadEjecutada: o.lado === 'compra' && o.cantidadBruta ? o.cantidadBruta : o.cantidadEjecutada, comision: null } : o);
  for (const m of ['enviarOrden', 'ordenPorIdCliente', 'esperarEjecucion']) {
    const f = broker[m].bind(broker);
    broker[m] = async (...a) => mapear(await f(...a));
  }
}

async function cuadra(ctx) {
  return conciliar({ posicionesBroker: await ctx.broker.posiciones(), libros: ctx.libros, precios: ctx.vivo.precios });
}

test('stop justo tras la compra, antes de la conciliación (comisión cobrada en el activo): el puesto se cierra entero, sin resto fantasma', async () => {
  const t0 = Date.UTC(2026, 9, 5, 15);
  const { ctx, broker, libros, reloj } = montar(t0);
  comoAlpaca(broker);
  const ej = new Ejecutor(ctx);
  const c = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 8000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 });
  assert.equal(c.ok, true);
  const p = libros.puesto('tendencia-BTC');
  assert.ok(p.cantidad > broker.estado.posiciones['BTC/USD'].cantidad, 'los libros tienen la bruta y el bróker la neta');
  reloj.avanzar(60_000);
  const v = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'venta', cantidad: p.cantidad, cantidadPuesto: p.cantidad, tipo: 'stop', motivo: 'stop', accion: 'stop', velaT: t0, cierraTodo: true });
  assert.equal(v.ok, true);
  assert.equal(broker.estado.posiciones['BTC/USD'], undefined);
  assert.equal(libros.puesto('tendencia-BTC').cantidad, 0, 'sin resto en los libros');
  const r = await cuadra(ctx);
  assert.equal(r.limpia, true, r.resumen);
  // La comisión cobrada en el activo pasó a comisiones de la operación.
  assert.ok(v.operaciones[0].comisiones > 8000 * 0.0025 * 0.99);
});

test('kill justo tras las compras de dos mesas en el mismo símbolo: los dos puestos cerrados y la conciliación limpia', async () => {
  const t0 = Date.UTC(2026, 9, 5, 15);
  const { ctx, broker, libros } = montar(t0);
  libros.asegurarPuesto({ puestoId: 'ruptura-BTC', mesaId: 'ruptura', simbolo: 'BTC/USD' });
  comoAlpaca(broker);
  const ej = new Ejecutor(ctx);
  await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 3000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 });
  await ej.ejecutar({ puestoId: 'ruptura-BTC', mesaId: 'ruptura', simbolo: 'BTC/USD', lado: 'compra', nocional: 5000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 });
  const pos = (await broker.posiciones()).find(x => x.simbolo === 'BTC/USD');
  const reparto = ['tendencia-BTC', 'ruptura-BTC'].map(id => ({ puestoId: id, cantidad: libros.puesto(id).cantidad }));
  const v = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'fondo', simbolo: 'BTC/USD', lado: 'venta', cantidad: pos.disponible, tipo: 'kill', motivo: 'kill', accion: 'kill', velaT: t0, reparto, cierraTodo: true });
  assert.equal(v.ok, true);
  assert.equal(libros.puesto('tendencia-BTC').cantidad, 0);
  assert.equal(libros.puesto('ruptura-BTC').cantidad, 0);
  assert.deepEqual(await broker.posiciones(), []);
  assert.equal((await cuadra(ctx)).limpia, true);
});

test('al revés (paper que no cobra en el activo): el bróker tiene algo más que los libros y la venta total lo vende todo', async () => {
  const t0 = Date.UTC(2026, 9, 5, 15);
  const { ctx, broker, libros } = montar(t0);
  const ej = new Ejecutor(ctx);
  await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 8000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 });
  const q = broker.estado.posiciones['BTC/USD'];
  q.cantidad = Number((q.cantidad / 0.9975).toFixed(9));
  const p = libros.puesto('tendencia-BTC');
  const v = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'venta', cantidad: p.cantidad, cantidadPuesto: p.cantidad, tipo: 'cierre', motivo: 'señal', accion: 'cerrar', velaT: t0, cierraTodo: true });
  assert.equal(v.ok, true);
  assert.deepEqual(await broker.posiciones(), [], 'no queda una huérfana en el bróker');
  assert.equal(libros.puesto('tendencia-BTC').cantidad, 0);
});

test('error de red al enviar: la orden pudo entrar → DESCONOCIDA en vuelo (no ERROR); se comprueba por idCliente y no se compra dos veces', async () => {
  const t0 = Date.UTC(2026, 9, 5, 15);
  const { ctx, broker, libros, mensajes } = montar(t0);
  const enviar = broker.enviarOrden.bind(broker);
  broker.enviarOrden = async o => { await enviar(o); throw new ErrorBroker('POST /v2/orders: sin respuesta (timeout de 20000 ms)', { tipo: 'red' }); };
  const ej = new Ejecutor(ctx);
  const r = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 5000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'incierta');
  assert.equal(Object.keys(ctx.estado.ordenesEnVuelo).length, 1);
  assert.ok(!mensajes.some(m => /rechazó/.test(m.texto)), 'no dice que el bróker la rechazó');
  // La vela siguiente no puede mandar otra de BTC mientras no se sepa.
  broker.enviarOrden = enviar;
  const r2 = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 5000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 + 4 * 3_600_000 });
  assert.equal(r2.motivo, 'orden_en_vuelo');
  assert.equal(await ej.resolverEnVuelo(), 1);
  assert.equal(broker.estado.ordenes.length, 1, 'una sola compra en el bróker');
  assert.ok(Math.abs(libros.puesto('tendencia-BTC').cantidad - broker.estado.posiciones['BTC/USD'].cantidad) < 1e-12);
  const reg = leerJSONL(path.join(ctx.carpeta, 'ordenes.jsonl')).map(x => x.estado);
  assert.deepEqual(reg.slice(0, 3), ['INTENCION', 'DESCONOCIDA', 'EJECUTADA']);
  assert.ok(!reg.includes('ERROR'));
});

test('error de red y la orden NO llegó: en el latido siguiente el bróker no la conoce y se abandona', async () => {
  const t0 = Date.UTC(2026, 9, 5, 15);
  const { ctx, broker, libros } = montar(t0);
  const enviar = broker.enviarOrden.bind(broker);
  broker.enviarOrden = async () => { throw new ErrorBroker('sin respuesta', { tipo: 'red' }); };
  const ej = new Ejecutor(ctx);
  await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 5000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 });
  broker.enviarOrden = enviar;
  assert.equal(await ej.resolverEnVuelo(), 0);
  assert.deepEqual(ctx.estado.ordenesEnVuelo, {});
  assert.equal(libros.puesto('tendencia-BTC').cantidad, 0);
  assert.ok(leerJSONL(path.join(ctx.carpeta, 'ordenes.jsonl')).some(x => x.estado === 'ABANDONADA'));
});

test('orden fantasma en vuelo (tras un reinicio sin red): si la consulta falla sigue en vuelo; con red y 404 se abandona y deja libre el símbolo', async () => {
  const t0 = Date.UTC(2026, 9, 5, 15);
  const { ctx, broker } = montar(t0);
  const ej = new Ejecutor(ctx);
  ctx.estado.ordenesEnVuelo['mt-tendencia-BTCUSD-x-cerrar-1'] = { idCliente: 'mt-tendencia-BTCUSD-x-cerrar-1', simbolo: 'BTC/USD', puestoId: 'tendencia-BTC', lado: 'venta', estado: 'INTENCION', t: t0 };
  const consultar = broker.ordenPorIdCliente.bind(broker);
  broker.ordenPorIdCliente = async () => { throw new ErrorBroker('sin red', { tipo: 'red' }); };
  let esperas = 0;
  const esperar = broker.esperarEjecucion.bind(broker);
  broker.esperarEjecucion = async (...a) => { esperas++; return esperar(...a); };
  await ej.resolverEnVuelo();
  assert.equal(Object.keys(ctx.estado.ordenesEnVuelo).length, 1, 'sin red no se abandona');
  broker.ordenPorIdCliente = consultar;
  await ej.resolverEnVuelo();
  assert.deepEqual(ctx.estado.ordenesEnVuelo, {});
  assert.equal(esperas, 0, 'no se gastan 20 s sondeando una orden que no existe');
  const r = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 1000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 });
  assert.equal(r.ok, true, 'el símbolo vuelve a operar');
});

test('venta llenada a medias que no termina (cripto gtc fuera del collar): a los 60 s se cancela, lo ejecutado se apunta y el símbolo queda libre', async () => {
  const t0 = Date.UTC(2026, 9, 5, 15);
  const { ctx, reloj, libros, mensajes } = montar(t0);
  const ordenes = new Map();
  ctx.broker = {
    nombre: 'falso',
    async posiciones() { return [{ simbolo: 'BTC/USD', cantidad: 1, disponible: 1, valor: 100000 }]; },
    async activo() { return { incremento: 1e-9 }; },
    async enviarOrden(o) { const x = { id: 'a-1', idCliente: o.idCliente, simbolo: o.simbolo, lado: o.lado, cantidad: o.cantidad, estado: 'parcial', cantidadEjecutada: 0.4, precioMedio: 100000, comision: 100 }; ordenes.set(o.idCliente, x); return { ...x }; },
    async ordenPorIdCliente(id) { const x = ordenes.get(id); return x ? { ...x } : null; },
    async esperarEjecucion(id) { return { ...ordenes.get(id) }; },
    async cancelarOrden(id) { for (const x of ordenes.values()) if (x.id === id) x.estado = 'cancelada'; return true; },
  };
  libros.aplicarEjecucion({ puestoId: 'tendencia-BTC', lado: 'compra', cantidad: 1, precio: 90000, comision: 0, t: t0 });
  const ej = new Ejecutor(ctx);
  const r = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'venta', cantidad: 1, cantidadPuesto: 1, tipo: 'stop', motivo: 'stop', accion: 'stop', velaT: t0, cierraTodo: true });
  assert.equal(r.motivo, 'en_vuelo');
  reloj.avanzar(30_000);
  await ej.resolverEnVuelo();
  assert.equal(Object.keys(ctx.estado.ordenesEnVuelo).length, 1, 'a los 30 s aún se espera');
  reloj.avanzar(31_000);
  assert.equal(await ej.resolverEnVuelo(), 1);
  assert.deepEqual(ctx.estado.ordenesEnVuelo, {});
  assert.ok(Math.abs(libros.puesto('tendencia-BTC').cantidad - 0.6) < 1e-12, 'lo ejecutado (0,4) se apunta; el resto lo vuelve a pedir el stop');
  assert.ok(mensajes.some(m => /cancelo lo que falta/.test(m.texto)));
  assert.ok(leerJSONL(path.join(ctx.carpeta, 'ordenes.jsonl')).some(x => x.estado === 'CANCELADA'));
});

test('idCliente con la sal de la carpeta: otra carpeta sobre la misma cuenta no repite el id de una orden vieja', async () => {
  const t0 = Date.UTC(2026, 9, 5, 15);
  const a = montar(t0);
  const b = montar(t0);
  a.ctx.estado.creado = Date.UTC(2026, 5, 1);
  b.ctx.estado.creado = Date.UTC(2026, 8, 30, 12, 34, 56);
  const idA = new Ejecutor(a.ctx).idCliente({ mesaId: 'tendencia', simbolo: 'BTC/USD', velaT: t0, accion: 'abrir' });
  const idB = new Ejecutor(b.ctx).idCliente({ mesaId: 'tendencia', simbolo: 'BTC/USD', velaT: t0, accion: 'abrir' });
  assert.match(idA, /^mt-[0-9a-z]+-tendencia-BTCUSD-20261005T1500Z-abrir-1$/);
  assert.notEqual(idA, idB);
  assert.ok(idA.length <= 128);
});

test('stop de una mesa con otra en el mismo símbolo, antes de conciliar: cada una paga su comisión y los libros cuadran con el bróker', async () => {
  const t0 = Date.UTC(2026, 9, 5, 15);
  const { ctx, broker, libros } = montar(t0);
  libros.asegurarPuesto({ puestoId: 'ruptura-BTC', mesaId: 'ruptura', simbolo: 'BTC/USD' });
  comoAlpaca(broker);
  const ej = new Ejecutor(ctx);
  await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'compra', nocional: 4000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 });
  await ej.ejecutar({ puestoId: 'ruptura-BTC', mesaId: 'ruptura', simbolo: 'BTC/USD', lado: 'compra', nocional: 4000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: t0 });
  const p = libros.puesto('tendencia-BTC');
  const v = await ej.ejecutar({ puestoId: 'tendencia-BTC', mesaId: 'tendencia', simbolo: 'BTC/USD', lado: 'venta', cantidad: p.cantidad, cantidadPuesto: p.cantidad, tipo: 'stop', motivo: 'stop', accion: 'stop', velaT: t0, cierraTodo: true });
  assert.equal(v.ok, true);
  assert.equal(libros.puesto('tendencia-BTC').cantidad, 0);
  const qB = broker.estado.posiciones['BTC/USD'].cantidad;
  assert.ok(Math.abs(libros.puesto('ruptura-BTC').cantidad - qB) < 1e-9, 'lo que queda en el bróker es de ruptura, entero');
  assert.equal((await cuadra(ctx)).limpia, true);
});
