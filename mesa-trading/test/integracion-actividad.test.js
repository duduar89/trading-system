'use strict';
// Actividad del paso (§7 `actividad`): lo que de verdad hizo cada agente en el
// último paso(), con acciones de la lista cerrada, agentes que existen y la
// misma lista para el mismo paso.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { crearOrquestador, PASO } = require('./integracion-ayuda');
const { ACCIONES, OBJETIVOS, MAX_ACTIVIDAD, RegistroActividad } = require('../src/agentes/actividad');
const { leerJSON } = require('../src/util/almacen');

function comprobarForma(inst) {
  const a = inst.actividad;
  assert.ok(a && Number.isFinite(a.t) && Array.isArray(a.lista));
  assert.ok(a.lista.length <= MAX_ACTIVIDAD);
  const ids = new Set(inst.agentes.map(x => x.id));
  for (const x of a.lista) {
    assert.ok(ACCIONES.includes(x.accion), `acción ${x.accion}`);
    assert.ok(!x.objetivo || OBJETIVOS.includes(x.objetivo), `objetivo ${x.objetivo}`);
    assert.ok(ids.has(x.agente), `agente ${x.agente}`);
  }
}

test('tras un paso, la instantánea trae la actividad del paso con su reloj', async () => {
  const { orquestador: o, reloj, carpeta } = await crearOrquestador();
  try {
    assert.equal(o.instantanea().actividad, null);   // sin pasos todavía
    reloj.avanzar(PASO);
    await o.paso();
    const inst = o.instantanea();
    comprobarForma(inst);
    assert.equal(inst.actividad.t, reloj.ahora());
    const acciones = inst.actividad.lista.map(x => `${x.agente}:${x.accion}`);
    // Cada paso: precios (controller), vigilante (riesgos) y conciliación (controller), en ese orden.
    assert.deepEqual(acciones.slice(0, 3), ['controller:precios', 'riesgos:riesgo', 'controller:conciliacion']);
    // Primer paso: vela 1H nueva → régimen y notas.
    assert.ok(acciones.includes('macro:regimen'));
    assert.ok(inst.actividad.lista.some(x => x.accion === 'nota' && x.agente.startsWith('analista-')));
    // Va al estado (un comando en el modo latido publica la misma).
    o.guardar();
    assert.deepEqual(leerJSON(path.join(carpeta, 'estado.json'), null).actividad, inst.actividad);
    // Un comando fuera del paso no la toca.
    await o.comando('pausar', {});
    assert.deepEqual(o.instantanea().actividad, inst.actividad);
  } finally {
    await o.detener();
  }
});

test('dos mesas iguales dan la misma actividad paso a paso; «orden» solo cuando se mandó una', async () => {
  const a = await crearOrquestador({ semilla: 42 });
  const b = await crearOrquestador({ semilla: 42 });
  let ordenes = 0;
  let senales = 0;
  try {
    for (let k = 0; k < 400 && !ordenes; k++) {
      a.reloj.avanzar(PASO); await a.orquestador.paso();
      b.reloj.avanzar(PASO); await b.orquestador.paso();
      const ia = a.orquestador.instantanea();
      const ib = b.orquestador.instantanea();
      comprobarForma(ia);
      assert.deepEqual(ia.actividad, ib.actividad, `paso ${k}`);
      senales += ia.actividad.lista.filter(x => x.accion === 'senal').length;
      const conOrden = ia.actividad.lista.filter(x => x.accion === 'orden');
      // Cada «orden» tiene su mensaje del Ejecutor en ese mismo paso.
      const mensajes = ia.mensajes.filter(m => m.de === 'ejecutor' && m.tipo === 'orden' && m.t === ia.actividad.t);
      assert.equal(conOrden.length > 0, mensajes.length > 0, `paso ${k}`);
      if (conOrden.length) {
        ordenes += conOrden.length;
        // La señal que la pidió va al puesto de ejecución, y Riesgos la revisó.
        const pid = conOrden[0].puestoId;
        assert.ok(ia.actividad.lista.some(x => x.accion === 'senal' && x.puestoId === pid && x.objetivo === 'ejecucion'));
        assert.ok(ia.actividad.lista.some(x => x.accion === 'riesgo' && x.puestoId === pid));
      }
    }
    assert.ok(ordenes > 0, 'alguna orden en 400 pasos');
    assert.ok(senales > 0);
  } finally {
    await a.orquestador.detener();
    await b.orquestador.detener();
  }
});

test('registro: sin repetidas, tope de 20 y fuera primero la rutina', () => {
  const r = new RegistroActividad(1000);
  assert.equal(r.anotar({ agente: 'x', accion: 'inventada' }), false);
  assert.equal(r.anotar({ agente: 'x', accion: 'precios', objetivo: 'otra-cosa' }), false);
  assert.equal(r.anotar({ agente: 'controller', accion: 'precios', objetivo: 'pantalla-cotizaciones' }), true);
  assert.equal(r.anotar({ agente: 'controller', accion: 'precios', objetivo: 'pantalla-cotizaciones' }), false);
  for (let k = 0; k < 25; k++) r.anotar({ agente: `puesto-${k}`, accion: 'senal', objetivo: 'monitor', puestoId: `p${k}` });
  assert.equal(r.lista.length, 20);
  assert.equal(r.anotar({ agente: 'ejecutor', accion: 'orden', objetivo: 'monitor', detalle: 'compra BTC' }), true);
  const j = r.aJSON();
  assert.equal(j.lista.length, 20);
  assert.equal(j.lista[0].accion, 'precios');                 // lo que no es rutina se queda
  assert.equal(j.lista[j.lista.length - 1].accion, 'orden');  // y el orden del paso se respeta
  assert.equal(j.lista[1].agente, 'puesto-1');                // salió la señal más antigua
});
