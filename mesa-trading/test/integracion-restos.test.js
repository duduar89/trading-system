'use strict';
// Restos de la verificación independiente del 30-sep (A, B, C y E del lado
// del servidor): la sombra «sin comité» tras un kill y Reabrir, el factor de
// tamaño sobre el nocional final, la sombra con el fondo bloqueado y la fecha
// en los avisos de una directiva de más de un día.

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearOrquestador, PASO } = require('./integracion-ayuda');
const mesasDep = require('../src/agentes/departamentos/mesas');
const riesgos = require('../src/agentes/departamentos/riesgos');
const megafono = require('../src/agentes/megafono');
const comite = require('../src/agentes/comite');
const f = require('../src/util/formato');

const HORA = 3600_000;
const DIA = 24 * HORA;
const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

// ---------- A: la caída de la sombra tras un kill y Reabrir ----------

test('A · tras un kill y Reabrir, la sombra «sin comité» mide la caída desde la reapertura, como el fondo; su pico histórico no se toca', async () => {
  const { orquestador: o, reloj } = await crearOrquestador();
  const paso = async () => { reloj.avanzar(PASO); await o.paso(); };
  for (let i = 0; i < 3; i++) await paso();
  // El caso del verificador: los dos vienen de un máximo un 12 % más alto
  // (entre el ×0,5 del −10 % y el kill del −15 %).
  o.estado.pico = o.vivo.patrimonio / 0.88;
  o.estado.sombra.pico = o.vivo.patrimonioSombra / 0.88;
  await paso();
  const multSombra = () => riesgos.contexto(o, { sombra: true }).multiplicadorCaida;
  assert.equal(o.estado.fondo.multiplicadorCaida, 0.5);
  assert.equal(multSombra(), 0.5, 'antes del kill, los dos a ×0,5');
  const picoSombra = o.estado.sombra.pico;

  assert.equal((await o.comando('kill', { confirmacion: 'KILL' })).ok, true);
  await paso();
  const r = await o.comando('reabrir', { confirmacion: 'REABRIR' });
  assert.equal(r.ok, true, r.mensaje);
  // En el mismo instante que la del fondo: el patrimonio sombra al reabrir.
  cerca(o.estado.sombra.picoVigilancia, o.vivo.patrimonioSombra);
  await paso();
  assert.equal(o.estado.fondo.multiplicadorCaida, 1, 'el fondo mide desde la reapertura');
  assert.equal(multSombra(), 1, 'y la sombra también: si no, su ×0,5 se le cargaría al comité');
  assert.equal(o.estado.sombra.pico, picoSombra, 'el pico histórico de la sombra (cabecera, informes) no se toca');
  for (let i = 0; i < 12; i++) await paso();
  assert.equal(multSombra(), 1, 'una hora después, igual');

  // La referencia de vigilancia manda: un −10 % desde ella vuelve a poner ×0,5.
  o.estado.sombra.picoVigilancia = o.vivo.patrimonioSombra / 0.9;
  assert.equal(multSombra(), 0.5);
  // Sube con el patrimonio y desaparece al volver al máximo histórico, como la del fondo.
  o.estado.sombra.picoVigilancia = o.vivo.patrimonioSombra * 0.99;
  o.revalorarSombra();
  cerca(o.estado.sombra.picoVigilancia, o.vivo.patrimonioSombra);
  o.estado.sombra.pico = o.vivo.patrimonioSombra;
  o.revalorarSombra();
  assert.equal(o.estado.sombra.picoVigilancia, null);
  await o.detener();
});

test('A · Reabrir desde una pausa no pone referencia aparte, ni al fondo ni a la sombra', async () => {
  const { orquestador: o } = await crearOrquestador();
  await o.comando('pausar');
  assert.equal((await o.comando('reabrir', { confirmacion: 'REABRIR' })).ok, true);
  assert.equal(o.estado.picoVigilancia ?? null, null);
  assert.equal(o.estado.sombra.picoVigilancia ?? null, null);
  await o.detener();
});

// ---------- B: el factor de tamaño, sobre el nocional final ----------

// Lo que propone el operador (bus 'propuesta') para una apertura de BTC en
// ruptura con el stop a `stopFrac` del precio, en un orquestador recién hecho.
async function propuestaBTC({ stopFrac, preparar = () => {} }) {
  const { orquestador: o } = await crearOrquestador();
  preparar(o);
  const mesa = o.mesaPorId('ruptura');
  const q = o.vivo.precios['BTC/USD'];
  let prop = null;
  let respuesta = null;
  o.bus.on('mensaje', m => {
    if (m.tipo === 'propuesta' && m.datos && m.datos.lado === 'compra') prop = m.datos;
    if ((m.tipo === 'aprobacion' || m.tipo === 'veto') && m.datos && m.datos.lado === 'compra') respuesta = m.datos;
  });
  await mesasDep.proponerApertura(o, { mesa, simbolo: 'BTC/USD', senal: { peso: 1, stop: q.precio * (1 - stopFrac), objetivoPrecio: null }, cierre: q.precio, tVela: o.reloj.ahora() - 4 * HORA, vol: 0.3 });
  await o.detener();
  return { prop, respuesta };
}

const DEFENSIVO = o => comite.aplicarDecision(o, { modo: 'DEFENSIVO', multiplicadores: {}, vetos: [] }, o.reloj.ahora());

test('B · con DEFENSIVO la apertura sale a ×0,5 exacto aunque mande el riesgo por operación (antes salía a ×1)', async () => {
  // Stop al 10 %: el riesgo por operación (0,5 % del patrimonio) deja 5.000 $,
  // menos que el capital de la mesa: dimensionar() se queda con él.
  const normal = await propuestaBTC({ stopFrac: 0.10 });
  const def = await propuestaBTC({ stopFrac: 0.10, preparar: DEFENSIVO });
  assert.equal(normal.prop.limitadoPor, 'riesgo');
  cerca(def.prop.nocional / normal.prop.nocional, 0.5, 1e-9);
  assert.equal(def.prop.factorTamano, 0.5);
  // Riesgos lo comprueba sin volver a multiplicar: aprueba el ×0,5 tal cual.
  assert.equal(def.respuesta.decision, 'aprobar', JSON.stringify(def.respuesta.motivos));
  cerca(def.respuesta.nocional, def.prop.nocional);
});

test('B · con DEFENSIVO la apertura sale a ×0,5 exacto aunque mande el tope por activo', async () => {
  // Stop al 2 %: el riesgo deja 25.000 $ y el tope por activo (10 %) 10.000 $.
  const normal = await propuestaBTC({ stopFrac: 0.02 });
  const def = await propuestaBTC({ stopFrac: 0.02, preparar: DEFENSIVO });
  assert.equal(normal.prop.limitadoPor, 'maxActivo');
  cerca(def.prop.nocional / normal.prop.nocional, 0.5, 1e-9);
});

test('B · el multiplicador ×0,5 de la mesa, el Megáfono y la caída multiplican lo mismo, una sola vez', async () => {
  const conTodo = o => {
    comite.aplicarDecision(o, { modo: 'DEFENSIVO', multiplicadores: { ruptura: 0.5 }, vetos: [] }, o.reloj.ahora());
    o.estado.directivas = megafono.aplicarDirectiva(o.estado.directivas, { tipo: 'reducir_riesgo', factor: 0.5, horas: 3 }, o.reloj.ahora());
    o.estado.fondo.multiplicadorCaida = 0.5;
  };
  const normal = await propuestaBTC({ stopFrac: 0.10 });
  const todo = await propuestaBTC({ stopFrac: 0.10, preparar: conTodo });
  cerca(todo.prop.nocional / normal.prop.nocional, 0.0625, 1e-9);
  assert.equal(todo.prop.factorTamano, 0.0625);
  // Riesgos no vuelve a aplicar el Megáfono ni la caída.
  assert.equal(todo.respuesta.decision, 'aprobar', JSON.stringify(todo.respuesta.motivos));
  cerca(todo.respuesta.nocional, todo.prop.nocional);
});

test('B · la mesa a ×0 del comité: se propone y la veta Riesgos con su motivo', async () => {
  const cero = await propuestaBTC({ stopFrac: 0.10, preparar: o => comite.aplicarDecision(o, { modo: 'NORMAL', multiplicadores: { ruptura: 0 }, vetos: [] }, o.reloj.ahora()) });
  assert.ok(cero.prop.nocional > 0);
  assert.equal(cero.respuesta.decision, 'vetar');
  assert.ok(cero.respuesta.motivos.some(m => m.limite === 'multiplicadorComite'));
});

test('B · la sombra aplica lo suyo: Megáfono y caída sí (×0,5 exacto con el riesgo mandando), comité no', async () => {
  const { orquestador: o } = await crearOrquestador();
  const mesa = o.mesaPorId('ruptura');
  const q = o.vivo.precios['BTC/USD'];
  const pedir = () => mesasDep.tamanoApertura(o, mesa, { peso: 1, precio: q.precio, stop: q.precio * 0.9, volAnual: 0.3 }, { sombra: true });
  const base = pedir();
  assert.equal(base.limitadoPor, 'riesgo');
  cerca(base.nocional, base.nocionalBase);
  comite.aplicarDecision(o, { modo: 'DEFENSIVO', multiplicadores: { ruptura: 0.5 }, vetos: [] }, o.reloj.ahora());
  cerca(pedir().nocional, base.nocional, 1e-12);
  o.estado.directivas = megafono.aplicarDirectiva(o.estado.directivas, { tipo: 'reducir_riesgo', factor: 0.5, horas: 3 }, o.reloj.ahora());
  cerca(pedir().nocional / base.nocional, 0.5, 1e-12);
  o.estado.sombra.pico = o.vivo.patrimonioSombra / 0.88;
  cerca(pedir().nocional / base.nocional, 0.25, 1e-12);
  // Riesgos (contexto de la sombra) no lo vuelve a multiplicar.
  const t = pedir();
  const r = riesgos.evaluar(o, {
    puestoId: 'ruptura-BTC@sombra', mesaId: 'ruptura', simbolo: 'BTC/USD', clase: 'cripto', lado: 'compra', tipo: 'apertura',
    nocional: t.nocional, precio: q.precio, precioT: q.t, stop: q.precio * 0.9, precioDecision: q.precio, factorTamano: t.factor.total,
  }, { sombra: true });
  assert.equal(r.decision, 'aprobar', JSON.stringify(r.motivos));
  cerca(r.nocional, t.nocional);
  await o.detener();
});

test('B · fondo.factorTamano de la instantánea es el que se aplica: total = comité × Megáfono × caída', async () => {
  const { orquestador: o } = await crearOrquestador();
  const mesa = o.mesaPorId('ruptura');
  const q = o.vivo.precios['BTC/USD'];
  const pedir = () => mesasDep.tamanoApertura(o, mesa, { peso: 1, precio: q.precio, stop: q.precio * 0.9, volAnual: 0.3 });
  const normal = pedir().nocional;
  DEFENSIVO(o);
  o.estado.directivas = megafono.aplicarDirectiva(o.estado.directivas, { tipo: 'reducir_riesgo', factor: 0.5, horas: 3 }, o.reloj.ahora());
  const ft = o.instantanea().fondo.factorTamano;
  assert.deepEqual(ft, { total: 0.25, comite: 0.5, megafono: 0.5, caida: 1 });
  cerca(pedir().nocional / normal, ft.total, 1e-12);
  await o.detener();
});

// ---------- C: la sombra no decide aperturas con el fondo parado ----------

const MIE_NOCHE = Date.UTC(2026, 5, 3, 22, 0);          // bolsa cerrada
const JUE_APERTURA = Date.UTC(2026, 5, 4, 13, 40);

async function conETF() {
  const piezas = await crearOrquestador();
  const { orquestador: o, reloj, datos } = piezas;
  const ultimos = datos.ultimos.bind(datos);
  datos.ultimos = async s => ({ ...(await ultimos(s.filter(x => x !== 'SPY'))), ...(s.includes('SPY') ? { SPY: { precio: 500, t: reloj.ahora() } } : {}) });
  o.agregarMesa({
    id: 'etf', nombre: 'ETF', familia: 'momentum', marco: '1Day', universo: ['SPY'], params: {}, filtros: [], estado: 'titular', peso: 0.1,
    fechaAlta: reloj.ahora(), capitalBase: 10000, flujoPendiente: 0, curvaDiaria: [], metricas: null, backtest: null,
  });
  const irA = async (t, abierta) => {
    reloj.fijar(t);
    await o._actualizarPrecios(t);
    o.vivo.precios.SPY = { precio: 500, t };
    o.vivo.mercadoAbierto = { accion: abierta };
    await o.refrescarCartera();
  };
  const senal = { accion: 'abrir', peso: 1, stop: 480, objetivoPrecio: null };
  return { ...piezas, irA, senal, mesa: o.mesaPorId('etf') };
}

test('C · con el fondo bloqueado la sombra no decide aperturas de ETF: nada queda en su cola para después de Reabrir', async () => {
  const { orquestador: o, irA, senal, mesa } = await conETF();
  await irA(MIE_NOCHE, false);
  assert.equal((await o.comando('kill', { confirmacion: 'KILL' })).ok, true);
  mesasDep.abrirSombra(o, { mesa, simbolo: 'SPY', senal, cierre: 500, tVela: MIE_NOCHE - DIA, vol: 0.18 });
  assert.deepEqual(o.estado.sombra.pendientes.filter(x => x.lado === 'compra'), [], 'la sombra no deja nada en cola');
  assert.equal((await o.comando('reabrir', { confirmacion: 'REABRIR' })).ok, true);
  await irA(JUE_APERTURA, true);
  mesasDep.procesarPendientesSombra(o);
  assert.equal(o.libros.puesto('etf-SPY@sombra').cantidad, 0, 'la sombra no compra lo que el fondo no propuso');
  await o.detener();
});

test('C · en pausa, ni el fondo ni la sombra dejan una apertura de ETF en cola (igual los dos)', async () => {
  const { orquestador: o, irA, senal, mesa } = await conETF();
  await irA(MIE_NOCHE, false);
  await o.comando('pausar');
  await mesasDep.proponerApertura(o, { mesa, simbolo: 'SPY', senal, cierre: 500, tVela: MIE_NOCHE - DIA, vol: 0.18 });
  mesasDep.abrirSombra(o, { mesa, simbolo: 'SPY', senal, cierre: 500, tVela: MIE_NOCHE - DIA, vol: 0.18 });
  assert.deepEqual(o.estado.pendientes.filter(x => x.lado === 'compra'), [], 'el fondo no la encola');
  assert.deepEqual(o.estado.sombra.pendientes.filter(x => x.lado === 'compra'), [], 'la sombra tampoco');
  // Con el fondo en normal, los dos la encolan hasta la apertura.
  await o.comando('reabrir', { confirmacion: 'REABRIR' });
  await mesasDep.proponerApertura(o, { mesa, simbolo: 'SPY', senal, cierre: 500, tVela: MIE_NOCHE - DIA, vol: 0.18 });
  mesasDep.abrirSombra(o, { mesa, simbolo: 'SPY', senal, cierre: 500, tVela: MIE_NOCHE - DIA, vol: 0.18 });
  assert.equal(o.estado.pendientes.filter(x => x.lado === 'compra').length, 1);
  assert.equal(o.estado.sombra.pendientes.filter(x => x.lado === 'compra').length, 1);
  await o.detener();
});

test('C · el kill vacía la cola de aperturas de la sombra (y deja sus ventas)', async () => {
  const { orquestador: o, irA, senal, mesa } = await conETF();
  await irA(MIE_NOCHE, false);
  mesasDep.abrirSombra(o, { mesa, simbolo: 'SPY', senal, cierre: 500, tVela: MIE_NOCHE - DIA, vol: 0.18 });
  assert.equal(o.estado.sombra.pendientes.length, 1);
  await o.comando('kill', { confirmacion: 'KILL' });
  assert.deepEqual(o.estado.sombra.pendientes.filter(x => x.lado === 'compra'), []);
  await o.detener();
});

// ---------- E: avisos de una directiva de más de un día ----------

test('E · los avisos de una directiva que acaba otro día llevan fecha y hora, como el feed; las de hoy, solo la hora', async () => {
  const { orquestador: o } = await crearOrquestador();
  const ahora = o.reloj.ahora();
  const aplicar = d => { o.estado.directivas = megafono.aplicarDirectiva(o.estado.directivas, d, ahora); };
  aplicar({ tipo: 'pausar_mesa', mesaId: 'ruptura', horas: 72 });
  aplicar({ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 2 });
  let avisos = o.instantanea().avisos.join(' | ');
  const tres = ahora + 72 * HORA;
  assert.ok(avisos.includes(`hasta el ${f.momento(tres, ahora)}`), avisos);
  assert.match(f.momento(tres, ahora), /^\d{1,2} \S+ \d\d:\d\d$/);
  assert.ok(avisos.includes(`hasta las ${f.hora(ahora + 2 * HORA)}`), avisos);

  aplicar({ tipo: 'solo_cerrar', horas: 72 });
  avisos = o.instantanea().avisos.join(' | ');
  assert.ok(avisos.includes(`Solo cerrar por el Megáfono hasta el ${f.momento(tres, ahora)}`), avisos);
  // Reabrir lo recuerda con la misma fecha.
  await o.comando('pausar');
  const r = await o.comando('reabrir', { confirmacion: 'REABRIR' });
  assert.ok(r.mensaje.includes(`solo cerrar del Megáfono hasta el ${f.momento(tres, ahora)}`), r.mensaje);
  await o.detener();
});
