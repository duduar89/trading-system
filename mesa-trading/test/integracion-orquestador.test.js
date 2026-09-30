'use strict';
// Orquestador por dentro: comité (§6.8) con un LLM falso, plan por defecto,
// arranque seguro con órdenes a medias (§6.10) y el redondeo de cantidades
// que usa el Ejecutor.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { crearOrquestador, carpetaTemporal, PASO } = require('./integracion-ayuda');
const comite = require('../src/agentes/comite');
const { leerJSONL, anadirJSONL } = require('../src/util/almacen');
const { redondearAbajo } = require('../src/util/numeros');

const HORA = 3_600_000;

function llmFalso(respuestas) {
  const llamadas = [];
  return {
    llamadas,
    activo: true,
    async pedirJSON(args) {
      llamadas.push(args);
      const r = respuestas[args.proposito];
      const datos = typeof r === 'function' ? r(args) : r;
      if (!datos) return { ok: false, motivo: 'error', detalle: 'sin respuesta en la prueba', costeUsd: 0 };
      return { ok: true, datos, costeUsd: 0.0123, modelo: 'claude-opus-5-5', tokens: {} };
    },
    estado: () => ({ activo: true, modeloComite: 'claude-opus-5-5', modeloAgentes: 'claude-opus-5-5', gastoHoyUsd: 0, presupuestoDiaUsd: 2, llamadasHoy: 0, ultimoError: null }),
    gastoHoy: () => 0,
    gastoDelDia: () => 0,
    gastoEntre: () => 0,
    fijarModelos() {},
    fijarPresupuesto() {},
  };
}

test('comité con LLM: una llamada con esquema estricto; Riesgos veta NORMAL; las cifras inventadas no salen', async () => {
  const llm = llmFalso({
    comite: args => ({
      modo: 'NORMAL',
      multiplicadores: Object.fromEntries(Object.keys(args.esquema.properties.multiplicadores.properties).map((id, k) => [id, k === 0 ? 0 : k === 1 ? 0.5 : 1])),
      vetos: ['DOGE/USD'],
      razon: 'El patrimonio es de 987.654.321 $.',
      intervenciones: [
        { agente: 'controller', texto: 'Patrimonio de 123.456.789 $ y todo en orden.' },
        { agente: 'macro', texto: 'Régimen sin cambios desde el último comité.' },
      ],
    }),
  });
  const { orquestador: o, reloj } = await crearOrquestador({ llm, pasos: 2 });
  const mensajes = [];
  const agentes = [];
  o.on('mensaje', m => mensajes.push(m));
  o.on('agente', a => agentes.push(a));
  o.estado.fondo.nivel = 'solo_cerrar';        // Riesgos votará DEFENSIVO
  const r = await comite.celebrar(o, { motivo: 'demanda' });
  assert.equal(r.ok, true);

  const llamada = llm.llamadas.find(x => x.proposito === 'comite');
  assert.equal(llamada.uso, 'comite');
  assert.equal(llamada.maxTokens, 4000);
  assert.equal(llamada.esfuerzo, 'medium');
  const esq = llamada.esquema;
  assert.deepEqual(esq.properties.modo.enum, ['NORMAL', 'DEFENSIVO', 'SOLO_CERRAR']);
  assert.deepEqual(esq.properties.multiplicadores.required.sort(), ['momentum', 'reversion', 'ruptura', 'tendencia']);
  assert.deepEqual(esq.properties.multiplicadores.properties.momentum.enum, [0, 0.5, 1]);
  assert.equal(esq.additionalProperties, false);
  assert.ok(esq.properties.vetos.items.enum.includes('BTC/USD'));
  assert.equal(llm.llamadas.filter(x => x.proposito === 'comite').length, 1);

  const d = o.estado.directivas;
  assert.equal(d.modo, 'DEFENSIVO', 'el voto DEFENSIVO de Riesgos es veto');
  const ids = Object.keys(esq.properties.multiplicadores.properties);
  assert.equal(d.multiplicadores[ids[0]], 0);
  assert.equal(d.multiplicadores[ids[1]], 0.5);
  const veto = d.activosVetados.find(v => v.simbolo === 'DOGE/USD' && v.origen === 'comite');
  assert.ok(veto);
  assert.equal(veto.hasta, reloj.ahora() + 24 * HORA);

  const delComite = mensajes.filter(m => m.canal === 'comite');
  assert.deepEqual(delComite.map(m => m.tipo), ['comite', 'informe', 'voto', 'voto', 'informe', 'informe', 'informe', 'decision']);
  const controller = delComite.find(m => m.de === 'controller');
  assert.doesNotMatch(controller.texto, /123\.456\.789/, 'una cifra que no está en los datos no llega a la pantalla');
  assert.equal(controller.datos.fuente, 'plantilla');
  const macro = delComite.find(m => m.de === 'macro');
  assert.equal(macro.datos.fuente, 'llm');
  assert.match(macro.texto, /Régimen sin cambios.*Mi voto: NORMAL/);
  const riesgos = delComite.find(m => m.de === 'riesgos');
  assert.equal(riesgos.datos.voto, 'DEFENSIVO');
  const decision = delComite.find(m => m.tipo === 'decision');
  assert.match(decision.texto, /DEFENSIVO/);
  assert.match(decision.texto, /Marta ha votado DEFENSIVO y su voto es veto/, 'la Presidenta cita a quien vetó, por su nombre');
  assert.doesNotMatch(decision.texto, /987/);
  assert.equal(decision.costeUsd, 0.0123);

  // Los jefes van a la sala de comité y vuelven.
  for (const id of comite.JEFES) {
    assert.ok(agentes.some(a => a.id === id && a.sala === 'comite' && a.estado === 'reunion'), `${id} no fue al comité`);
    const ultimo = [...agentes].reverse().find(a => a.id === id);
    assert.notEqual(ultimo.sala, 'comite');
  }
  assert.equal(o.comiteEnCurso, false);
  // Con DEFENSIVO el capital de cada mesa es la mitad.
  const inst = o.instantanea();
  const m = inst.mesas.find(x => x.id === ids[2]);
  assert.ok(Math.abs(m.capital - inst.cabecera.patrimonio * m.peso * m.multiplicador * 0.5) < 1e-6);
  reloj.avanzar(PASO);
  await o.detener();
});

test('comité sin LLM: plan por defecto (mayoría; empate → el más prudente; vetos = eventos graves)', () => {
  const mesas = [{ id: 'a' }, { id: 'b' }];
  const base = { votos: { macro: 'NORMAL', riesgos: 'NORMAL' }, eventosGraves: [] };
  assert.equal(comite.planPorDefecto(base, mesas).modo, 'NORMAL');
  assert.equal(comite.planPorDefecto({ ...base, votos: { macro: 'DEFENSIVO', riesgos: 'NORMAL' } }, mesas).modo, 'DEFENSIVO');
  assert.equal(comite.planPorDefecto({ ...base, votos: { macro: 'NORMAL', riesgos: 'DEFENSIVO' } }, mesas).modo, 'DEFENSIVO');
  const p = comite.planPorDefecto({ ...base, eventosGraves: ['SOL/USD'] }, mesas);
  assert.deepEqual(p.multiplicadores, { a: 1, b: 1 });
  assert.deepEqual(p.vetos, ['SOL/USD']);
});

test('arranque seguro: resuelve las órdenes a medias por idCliente, no reenvía y un fondo bloqueado sigue bloqueado', async () => {
  const carpeta = carpetaTemporal();
  const a = await crearOrquestador({ carpeta, pasos: 12 });
  const o = a.orquestador;
  const ahora = a.reloj.ahora();
  const ruta = path.join(carpeta, 'ordenes.jsonl');
  // Corte a mitad: la orden llegó al bróker pero no a los libros…
  const enviada = await a.broker.enviarOrden({ idCliente: 'mt-ruptura-BTCUSD-prueba-abrir-1', simbolo: 'BTC/USD', lado: 'compra', nocional: 500 });
  anadirJSONL(ruta, { t: ahora, estado: 'INTENCION', idCliente: 'mt-ruptura-BTCUSD-prueba-abrir-1', puestoId: 'ruptura-BTC', mesaId: 'ruptura', simbolo: 'BTC/USD', lado: 'compra', nocional: 500, cantidad: null, tipo: 'apertura', motivo: 'señal', stop: 90000, precioReferencia: 100000 });
  anadirJSONL(ruta, { t: ahora, estado: 'ENVIADA', idCliente: 'mt-ruptura-BTCUSD-prueba-abrir-1', id: enviada.id });
  // …y otra que se quedó en intención sin llegar a enviarse.
  anadirJSONL(ruta, { t: ahora, estado: 'INTENCION', idCliente: 'mt-ruptura-ETHUSD-prueba-abrir-1', puestoId: 'ruptura-ETH', mesaId: 'ruptura', simbolo: 'ETH/USD', lado: 'compra', nocional: 400, cantidad: null, tipo: 'apertura', motivo: 'señal' });
  o.estado.fondo.nivel = 'bloqueado';
  o.estado.fondo.motivo = 'prueba de arranque';
  o.guardar();
  const ordenesAntes = a.broker.estado.ordenes.length;

  const b = await crearOrquestador({ carpeta });
  const o2 = b.orquestador;
  assert.equal(o2.estado.fondo.nivel, 'bloqueado');
  const p = o2.libros.puesto('ruptura-BTC');
  assert.ok(Math.abs(p.cantidad - enviada.cantidadEjecutada) < 1e-12, 'la ejecución se aplica a los libros');
  assert.equal(p.stop, 90000);
  assert.equal(o2.libros.puesto('ruptura-ETH').cantidad, 0);
  assert.equal(b.broker.estado.ordenes.length, ordenesAntes, 'no se reenvía nada');
  const registros = leerJSONL(ruta);
  assert.ok(registros.some(r => r.idCliente === 'mt-ruptura-ETHUSD-prueba-abrir-1' && r.estado === 'ABANDONADA'));
  assert.ok(registros.some(r => r.idCliente === 'mt-ruptura-BTCUSD-prueba-abrir-1' && r.estado === 'EJECUTADA'));
  assert.equal(o2.estado.conciliacion.limpia, true, o2.estado.conciliacion.resumen);
  assert.deepEqual(Object.keys(o2.estado.ordenesEnVuelo), []);
  // Bloqueado: el latido no abre nada. Lo que el bróker aún tiene es un kill
  // que no terminó: el vigilante lo vuelve a vender (solo ventas de kill).
  const ordenes0 = b.broker.estado.ordenes.length;
  for (let i = 0; i < 12; i++) { b.reloj.avanzar(PASO); await o2.paso(); }
  assert.equal(o2.estado.fondo.nivel, 'bloqueado');
  const nuevas = b.broker.estado.ordenes.slice(ordenes0);
  assert.ok(nuevas.length > 0 && nuevas.every(x => x.lado === 'venta'), 'bloqueado: solo ventas');
  assert.deepEqual(await b.broker.posiciones(), [], 'el reintento del kill lo vende todo');
  assert.equal(o2.estado.fondo.killReintento, null);
  // Un tercer arranque no vuelve a aplicar la misma ejecución (ni la venta del kill).
  o2.guardar();
  const c = await crearOrquestador({ carpeta });
  assert.equal(c.orquestador.libros.puesto('ruptura-BTC').cantidad, 0);
  assert.deepEqual(await c.broker.posiciones(), []);
  await o.detener(); await o2.detener(); await c.orquestador.detener();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('un error dentro de un departamento se publica en sistema y no tumba el latido', async () => {
  const { orquestador: o, reloj, datos } = await crearOrquestador({ pasos: 1 });
  const original = datos.velas.bind(datos);
  let fallar = true;
  datos.velas = async (...args) => { if (fallar && args[1] === '4Hour') throw new Error('datos caídos'); return original(...args); };
  const alertas = [];
  o.on('mensaje', m => { if (m.canal === 'sistema' && m.tipo === 'alerta') alertas.push(m); });
  for (let i = 0; i < 60; i++) { reloj.avanzar(PASO); assert.equal(await o.paso(), true); }
  assert.ok(alertas.length >= 1);
  assert.match(alertas[0].texto, /datos caídos/);
  assert.ok(alertas.length < 10, 'el mismo error no se repite en cada latido');
  fallar = false;
  reloj.avanzar(PASO);
  assert.equal(await o.paso(), true);
  await o.detener();
});

test('paso() no se solapa: si el anterior sigue, se salta', async () => {
  const { orquestador: o, reloj, datos } = await crearOrquestador({ pasos: 1 });
  const original = datos.ultimos.bind(datos);
  let soltar;
  datos.ultimos = async s => { await new Promise(r => { soltar = r; }); return original(s); };
  reloj.avanzar(PASO);
  const primero = o.paso();
  await new Promise(r => setImmediate(r));
  assert.equal(await o.paso(), false);
  assert.equal(o.saltados, 1);
  datos.ultimos = original;
  soltar();
  assert.equal(await primero, true);
  await o.detener();
});

test('redondearAbajo no pierde un incremento con cantidades de 9 decimales (causa del polvo tras cerrar)', () => {
  assert.equal(redondearAbajo(167.363836, 1e-9), 167.363836);
  assert.equal(redondearAbajo(13702.122795, 1e-9), 13702.122795);
  assert.equal(redondearAbajo(0.009975, 1e-9), 0.009975);
  assert.equal(redondearAbajo(0.30000000000000004, 1e-9), 0.3);
  assert.equal(redondearAbajo(1.0000000009, 1e-9), 1);
  assert.equal(redondearAbajo(0.0199999, 0.0001), 0.0199);
  assert.equal(redondearAbajo(5.99, 0.01), 5.99);
});
