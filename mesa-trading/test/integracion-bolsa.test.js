'use strict';
// Acciones (ETF) con la bolsa cerrada: la cola de la apertura del fondo y la
// del sombra «sin comité». El sintético no trae acciones: se añaden SPY y QQQ
// a la fuente y dos mesas de ETF al orquestador, y se usa el calendario real
// (miércoles 3-jun-2026: abre a las 13:30 UTC).

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearOrquestador } = require('./integracion-ayuda');
const mesasDep = require('../src/agentes/departamentos/mesas');

const MIE_APERTURA = Date.UTC(2026, 5, 3, 13, 40);     // 9:40 ET
const MIE_NOCHE = Date.UTC(2026, 5, 3, 22, 0);          // 18:00 ET, cerrada
const JUE_APERTURA = Date.UTC(2026, 5, 4, 13, 40);
const MIN = 60_000;

async function montarBolsa() {
  const piezas = await crearOrquestador({});
  const { orquestador: o, reloj, datos } = piezas;
  const px = { SPY: 500, QQQ: 400 };
  const ultimos = datos.ultimos.bind(datos);
  datos.ultimos = async s => ({
    ...(await ultimos(s.filter(x => !(x in px)))),
    ...Object.fromEntries(s.filter(x => x in px).map(x => [x, { precio: px[x], t: reloj.ahora() }])),
  });
  const mesa = (id, nombre, familia, peso, estado) => ({
    id, nombre, familia, marco: '1Day', universo: ['SPY', 'QQQ'], params: {}, filtros: [], estado, peso,
    fechaAlta: reloj.ahora(), capitalBase: 100000 * peso, flujoPendiente: 0, curvaDiaria: [], metricas: null, backtest: null,
  });
  o.agregarMesa(mesa('momentum-etf', 'Momentum ETF', 'momentum', 0.4, 'titular'));
  o.agregarMesa(mesa('reversion-etf', 'Reversión ETF', 'reversion', 0.4, 'titular'));
  const irA = async (t, abierta) => {
    reloj.fijar(t);
    await o._actualizarPrecios(t);
    for (const s of Object.keys(px)) o.vivo.precios[s] = { precio: px[s], t };
    o.vivo.mercadoAbierto = { accion: abierta };
    await o.refrescarCartera();
  };
  const pendiente = (puestoId, mesaId, extra = {}) => ({
    puestoId, mesaId, simbolo: 'SPY', lado: 'compra', nocional: 10000, tipo: 'apertura', motivo: 'señal', accion: 'abrir',
    velaT: Date.UTC(2026, 5, 2, 4), stop: 480, precioReferencia: 500, enviarDesde: reloj.ahora() - MIN, ...extra,
  });
  const procesar = () => o.ejecutor.procesarPendientes(x => o._reevaluarPendiente(x));
  return { ...piezas, px, irA, pendiente, procesar };
}

test('aperturas encoladas en el mismo lote: la segunda se evalúa contra la primera (SPY no pasa del 10 %)', async () => {
  const { orquestador: o, irA, pendiente, procesar } = await montarBolsa();
  await irA(MIE_APERTURA, true);
  o.estado.pendientes = [pendiente('momentum-etf-SPY', 'momentum-etf'), pendiente('reversion-etf-SPY', 'reversion-etf')];
  await procesar();
  const val = o.libros.valorar(o.vivo.precios);
  const peso = val.exposicionPorActivo.SPY / o.vivo.patrimonio;
  assert.ok(peso <= o.limites.maxPesoPorActivo * 1.001, `SPY pesa ${peso}`);
  assert.equal(o.libros.puesto('reversion-etf-SPY').cantidad, 0, 'la segunda se veta: ya no cabe');
});

test('kill con la bolsa cerrada y el mismo ETF en dos mesas: a la apertura se vende todo y los dos puestos se cierran', async () => {
  const { orquestador: o, broker, irA } = await montarBolsa();
  await irA(MIE_APERTURA, true);
  for (const id of ['momentum-etf', 'reversion-etf']) {
    const r = await o.ejecutor.ejecutar({ puestoId: `${id}-SPY`, mesaId: id, simbolo: 'SPY', lado: 'compra', nocional: 4000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: MIE_APERTURA, stop: 480 });
    assert.equal(r.ok, true);
  }
  await irA(MIE_NOCHE, false);
  const k = await o.killSwitch('prueba de kill nocturno');
  assert.deepEqual(k.esperanApertura, ['SPY']);
  assert.deepEqual(k.quedanEnBroker, [], 'lo que espera a la apertura no se reintenta ni cuenta como fallo');
  assert.equal(o.estado.fondo.killReintento, null);
  assert.equal(o.estado.pendientes.length, 1);
  await irA(JUE_APERTURA, true);
  await o.ejecutor.procesarPendientes(x => o._reevaluarPendiente(x));
  assert.deepEqual((await broker.posiciones()).map(p => p.simbolo), [], 'el bróker queda sin SPY');
  assert.equal(o.libros.puesto('momentum-etf-SPY').cantidad, 0);
  assert.equal(o.libros.puesto('reversion-etf-SPY').cantidad, 0);
});

test('una apertura encolada que ya se hizo (corte entre enviarla y guardar estado.json) no se repite', async () => {
  const { orquestador: o, broker, irA, pendiente, procesar } = await montarBolsa();
  await irA(MIE_APERTURA, true);
  await o.ejecutor.ejecutar({ puestoId: 'momentum-etf-SPY', mesaId: 'momentum-etf', simbolo: 'SPY', lado: 'compra', nocional: 6000, tipo: 'apertura', motivo: 'señal', accion: 'abrir', velaT: MIE_APERTURA, stop: 480 });
  const compras = broker.estado.ordenes.filter(x => x.lado === 'compra').length;
  o.estado.pendientes = [pendiente('momentum-etf-SPY', 'momentum-etf', { nocional: 6000 })];
  await procesar();
  assert.equal(broker.estado.ordenes.filter(x => x.lado === 'compra').length, compras, 'una sola compra de SPY');
});

test('una apertura encolada se vuelve a dimensionar a la apertura: DEFENSIVO y ×0,5 de la noche cuentan; en el banquillo, se descarta', async () => {
  const { orquestador: o, irA, pendiente, procesar } = await montarBolsa();
  await irA(MIE_APERTURA, true);
  // Decidida a las 16:10 ET con el fondo normal: 10.000 $ (tope por activo).
  o.estado.directivas.modo = 'DEFENSIVO';
  o.estado.directivas.multiplicadores['momentum-etf'] = 0.5;
  o.estado.pendientes = [pendiente('momentum-etf-SPY', 'momentum-etf', { pesoSenal: 0.5, volAnual: 0.15 })];
  await procesar();
  const valor = o.libros.puesto('momentum-etf-SPY').cantidad * 500;
  assert.ok(valor > 4900 && valor < 5100, `se compran unos 5.000 $ (100.000 · 0,4 · 0,5 · 0,5 · 0,5), no 10.000: ${valor}`);

  o.mesaPorId('reversion-etf').estado = 'banquillo';
  const mensajes = [];
  o.bus.on('mensaje', m => mensajes.push(m));
  o.estado.pendientes = [pendiente('reversion-etf-SPY', 'reversion-etf', { pesoSenal: 1 })];
  await procesar();
  assert.equal(o.libros.puesto('reversion-etf-SPY').cantidad, 0);
  assert.ok(mensajes.some(m => /banquillo/.test(m.texto) && /se descarta/.test(m.texto)));
});

test('sombra «sin comité» con ETF: la decisión de la noche espera a la apertura (no la veta «mercado cerrado») y el stop de noche también', async () => {
  const { orquestador: o, irA } = await montarBolsa();
  const mesa = o.mesaPorId('momentum-etf');
  const sid = 'momentum-etf-SPY@sombra';
  await irA(MIE_NOCHE, false);
  const r = mesasDep.abrirSombra(o, { mesa, simbolo: 'SPY', senal: { peso: 0.5, stop: 480, objetivoPrecio: null }, cierre: 500, tVela: Date.UTC(2026, 5, 3, 4), vol: 0.15 });
  assert.equal(r, null);
  assert.equal(o.estado.sombra.pendientes.length, 1, 'queda en la cola del sombra');
  assert.equal(o.libros.puesto(sid).cantidad, 0);
  // Otra vela antes de la apertura no la duplica.
  mesasDep.abrirSombra(o, { mesa, simbolo: 'SPY', senal: { peso: 0.5, stop: 480, objetivoPrecio: null }, cierre: 500, tVela: Date.UTC(2026, 5, 3, 4), vol: 0.15 });
  assert.equal(o.estado.sombra.pendientes.length, 1);
  await irA(JUE_APERTURA, true);
  assert.equal(mesasDep.procesarPendientesSombra(o), 1);
  const cantidad = o.libros.puesto(sid).cantidad;
  assert.ok(cantidad * 500 > 1000, 'el sombra compra SPY a la apertura');
  assert.equal(o.estado.sombra.pendientes.length, 0);
  // Stop del sombra de noche: se vende a la apertura, no al precio de la noche.
  await irA(Date.UTC(2026, 5, 4, 22), false);
  mesasDep.cerrarSombra(o, { puestoId: sid, motivo: 'stop' });
  mesasDep.cerrarSombra(o, { puestoId: sid, motivo: 'stop' });
  assert.equal(o.libros.puesto(sid).cantidad, cantidad);
  assert.equal(o.estado.sombra.pendientes.length, 1);
  await irA(Date.UTC(2026, 5, 5, 13, 40), true);
  mesasDep.procesarPendientesSombra(o);
  assert.equal(o.libros.puesto(sid).cantidad, 0);
});
