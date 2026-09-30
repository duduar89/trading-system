'use strict';
// Parqué · actividad del paso (§7 `actividad`): la planificación de paseos
// (web/js/personajes.js) reproduce lo que hizo cada agente en el último paso,
// una vez por paso, sin solapar paseos, sin mover a quien está en el comité o
// en el descanso, y dentro del intervalo entre pasos.
const test = require('node:test');
const assert = require('node:assert/strict');
const pers = require('../web/js/personajes.js');
const mapa = require('../web/js/mapa.js');
const { crearMaqueta } = require('../web/js/maqueta.js');

const T = Date.UTC(2026, 8, 29, 12);

function escena(cambios) {
  const inst = crearMaqueta({ semilla: 3, ahora: T }).instantanea();
  if (cambios) inst.agentes = inst.agentes.map(a => (cambios[a.id] ? { ...a, ...cambios[a.id] } : a));
  const m = mapa.construirMapa(inst);
  const asignacion = mapa.asignarSitios(m, inst.agentes, inst.departamentos);
  const elenco = pers.crearElenco();
  elenco.sincronizar(inst.agentes, m, asignacion, { instantaneo: true });
  return { inst, m, asignacion, elenco };
}

const LISTA = [
  { agente: 'controller', accion: 'precios', objetivo: 'pantalla-cotizaciones' },
  { agente: 'riesgos', accion: 'riesgo', objetivo: 'mesas', detalle: 'limites' },
  { agente: 'controller', accion: 'conciliacion', objetivo: 'monitor' },
  { agente: 'macro', accion: 'regimen', objetivo: 'pantalla-regimen' },
  { agente: 'analista-BTC', accion: 'nota', objetivo: 'monitor', detalle: 'BTC' },
  { agente: 'puesto-tendencia-BTC', accion: 'senal', objetivo: 'ejecucion', detalle: 'abrir', puestoId: 'tendencia-BTC' },
  { agente: 'riesgos', accion: 'riesgo', objetivo: 'mesas', detalle: 'propuesta', puestoId: 'tendencia-BTC' },
  { agente: 'ejecutor', accion: 'orden', objetivo: 'monitor', detalle: 'compra BTC', puestoId: 'tendencia-BTC' },
  { agente: 'cio', accion: 'comite', objetivo: 'sala-comite', detalle: 'programado' },
];

function entrada(e, extra) {
  return { mapa: e.m, agentes: e.inst.agentes, asignacion: e.asignacion, departamentos: e.inst.departamentos, ventanaMs: 40000, ahora: 1000, ...extra };
}

test('ventana de reproducción: 40 s en el modo web, lo que dura un paso en el local acelerado', () => {
  assert.equal(pers.intervaloPasoMs({ latidoMs: 60000, modo: 'sintetico', velocidad: 60 }), 60000);   // web: manda el cron
  assert.equal(pers.intervaloPasoMs({ modo: 'sintetico', velocidad: 60 }), 5000);                     // 5 min / 60
  assert.equal(pers.intervaloPasoMs({ modo: 'simulado' }), 60000);
  assert.equal(pers.ventanaActividad({ latidoMs: 60000 }, 0), 40000);                                 // tope de 40 s
  assert.equal(pers.ventanaActividad({ latidoMs: 60000 }, 30000), 10000);                             // 30 s ya pasados
  assert.equal(pers.ventanaActividad({ modo: 'sintetico', velocidad: 60 }, 0), 4500);                 // 90 % de 5 s
  assert.equal(pers.ventanaActividad({ modo: 'sintetico', velocidad: 600 }, 0), 450);
});

test('plan: agentes que existen, dentro de la ventana, sin solapar, determinista', () => {
  const e = escena();
  const act = { t: T, lista: LISTA };
  const plan = pers.planificarActividad(entrada(e, { actividad: act }));
  const plan2 = pers.planificarActividad(entrada(e, { actividad: act }));
  const sinMapa = p => p.map(({ mapa: _m, departamentos: _d, ...x }) => x);
  assert.deepEqual(sinMapa(plan), sinMapa(plan2));
  const ids = new Set(e.inst.agentes.map(a => a.id));
  assert.ok(plan.length >= 7, `plan de ${plan.length}`);
  for (const p of plan) {
    assert.ok(ids.has(p.id));
    assert.ok(p.inicio >= 1000 && p.fin <= 1000 + 40000, `${p.id} ${p.inicio}–${p.fin}`);
    // Mira 3–6 s; si no cabe, se anda más deprisa y se mira menos en la misma proporción.
    assert.ok(p.ritmo >= 1 && p.ritmo <= 3 + 1e-9);
    assert.ok(p.mirarMs * p.ritmo >= 3000 - 1 && p.mirarMs * p.ritmo <= 6000 + 1, `${p.id} mira ${p.mirarMs} ms a ×${p.ritmo}`);
    assert.ok(p.texto && !/\d/.test(p.texto), `sin cifras: ${p.texto}`);
  }
  // El comité no es un paseo: a la sala van por su estado.
  assert.ok(!plan.some(p => p.objetivo === 'sala-comite'));
  // Controller y Riesgos tienen dos entradas: una detrás de otra, sin solaparse.
  for (const id of ['controller', 'riesgos']) {
    const suyos = plan.filter(p => p.id === id).sort((a, b) => a.inicio - b.inicio);
    assert.equal(suyos.length, 2, id);
    assert.ok(suyos[1].inicio >= suyos[0].fin, `${id}: ${suyos[0].fin} > ${suyos[1].inicio}`);
  }
  // Puntos de cada objetivo: la pantalla gigante (fondo del parqué), el puesto de ejecución y el del BTC.
  const precios = plan.find(p => p.accion === 'precios');
  assert.equal(mapa.salaEn(precios.punto.col, precios.punto.fila), 'parque');
  assert.ok(precios.punto.fila < 2.5 && precios.punto.mira === 'N');
  const senal = plan.find(p => p.accion === 'senal');
  assert.equal(mapa.salaEn(senal.punto.col, senal.punto.fila), 'riesgos');
  const ronda = plan.find(p => p.id === 'riesgos' && p.puestoId === 'tendencia-BTC');
  const g = e.m.puestos.get('tendencia-BTC');
  assert.ok(Math.hypot(ronda.punto.col - g.sitio.col, ronda.punto.fila - g.sitio.fila) < 1.5);
});

test('plan: no mueve a quien está en el comité, en el descanso, en el banquillo o fuera de su sala', () => {
  const e = escena({
    riesgos: { sala: 'comite', estado: 'reunion' },
    controller: { sala: 'descanso', estado: 'descanso' },
    'puesto-tendencia-BTC': { estado: 'banquillo' },
    macro: { sala: 'parque' },
  });
  const plan = pers.planificarActividad(entrada(e, { actividad: { t: T, lista: LISTA } }));
  const quien = new Set(plan.map(p => p.id));
  for (const id of ['riesgos', 'controller', 'puesto-tendencia-BTC', 'macro', 'cio']) assert.ok(!quien.has(id), id);
  assert.ok(quien.has('ejecutor') && quien.has('analista-BTC'));
});

test('ventana corta (local acelerado): se anda más deprisa y se mira menos, pero cabe', () => {
  const e = escena();
  const plan = pers.planificarActividad(entrada(e, { actividad: { t: T, lista: LISTA }, ventanaMs: 4500 }));
  assert.ok(plan.length > 0);
  for (const p of plan) assert.ok(p.fin <= 1000 + 4500, `${p.id} acaba en ${p.fin}`);
  assert.ok(plan.some(p => p.ritmo > 1));
  // Sin ventana (ya pasó el paso) o con movimiento reducido, no hay paseos.
  assert.deepEqual(pers.planificarActividad(entrada(e, { actividad: { t: T, lista: LISTA }, ventanaMs: 500 })), []);
  assert.deepEqual(e.elenco.programarActividad({ t: T, lista: LISTA }, entrada(e, { reducir: true })), []);
});

test('elenco: cada paso se reproduce una vez (dedupe por t) y nadie repite paseo mientras anda', () => {
  const e = escena();
  const primero = e.elenco.programarActividad({ t: T, lista: LISTA }, entrada(e));
  assert.ok(primero.length > 0);
  // Otra instantánea del mismo paso (o una anterior): nada nuevo.
  assert.deepEqual(e.elenco.programarActividad({ t: T, lista: LISTA }, entrada(e)), []);
  assert.deepEqual(e.elenco.programarActividad({ t: T - 1, lista: LISTA }, entrada(e)), []);
  // Paso siguiente con los del anterior aún pendientes: esos no salen otra vez.
  const segundo = e.elenco.programarActividad({ t: T + 60000, lista: LISTA }, entrada(e));
  const pendientes = new Set(primero.map(p => p.id));
  assert.ok(segundo.every(p => !pendientes.has(p.id)));
});

test('un paseo entero: se levanta, va a la pantalla, la mira de pie y vuelve a sentarse', () => {
  const e = escena();
  const lista = [{ agente: 'controller', accion: 'precios', objetivo: 'pantalla-cotizaciones' }];
  const [plan] = e.elenco.programarActividad({ t: T, lista }, entrada(e, { ahora: 0 }));
  const c = e.elenco.personajes.get('controller');
  const casa = { col: c.col, fila: c.fila };
  assert.equal(c.postura, 'sentado');
  let t = 0;
  let mirando = false;
  let enPantalla = false;
  while (t <= 40000) {
    e.elenco.actualizar(0.05, t);
    if (c.paseo && c.paseo.fase === 'mirar') {
      mirando = true;
      assert.equal(c.postura, 'de_pie');
      assert.equal(c.mira, 'N');
      enPantalla = enPantalla || (mapa.salaEn(c.col, c.fila) === 'parque' && c.fila < 2.5);
    }
    if (mirando && !c.paseo) break;
    t += 50;
  }
  assert.ok(mirando && enPantalla, 'llegó a mirar la pantalla');
  assert.ok(t <= plan.fin + 200, `vuelve a tiempo: ${t} ≤ ${plan.fin}`);
  assert.deepEqual([c.col, c.fila], [casa.col, casa.fila]);
  assert.equal(c.postura, 'sentado');
  // El bocadillo corto de la acción, con importancia 0 (detrás de los mensajes reales).
  assert.equal(c.bocadillo.texto, 'Precios al día');
  assert.equal(c.bocadillo.importancia, 0);
});

test('si le llaman al comité a mitad de paseo, deja el paseo y va a la sala', () => {
  const e = escena();
  e.elenco.programarActividad({ t: T, lista: [{ agente: 'riesgos', accion: 'riesgo', objetivo: 'mesas', detalle: 'limites' }] }, entrada(e, { ahora: 0 }));
  const r = e.elenco.personajes.get('riesgos');
  e.elenco.actualizar(0.05, 50);
  assert.ok(r.paseo && r.andando);
  const agentes = e.inst.agentes.map(a => (a.id === 'riesgos' ? { ...a, sala: 'comite', estado: 'reunion' } : a));
  const asig = mapa.asignarSitios(e.m, agentes, e.inst.departamentos);
  e.elenco.sincronizar(agentes, e.m, asig, {});
  assert.equal(r.paseo, null);
  for (let k = 0; k < 400 && r.andando; k++) e.elenco.actualizar(0.1, 100 + k * 100);
  assert.equal(mapa.salaEn(r.col, r.fila), 'comite');
  assert.equal(r.postura, 'sentado');
});

test('adorno: el giro de cabeza va de 0 a ±1 y vuelve, sin pasarse; fase distinta por agente', () => {
  let max = 0;
  for (let t = 0; t < 60000; t += 20) {
    const g = pers.giroCabeza(t, 0.37);
    assert.ok(Math.abs(g) <= 1 + 1e-9);
    max = Math.max(max, Math.abs(g));
  }
  assert.ok(max > 0.95);
  // Quieta la mayor parte del tiempo.
  let quieta = 0;
  for (let t = 0; t < 60000; t += 100) if (pers.giroCabeza(t, 0.37) === 0) quieta++;
  assert.ok(quieta / 600 > 0.8);
  const a = []; const b = [];
  for (let t = 0; t < 30000; t += 100) { a.push(pers.giroCabeza(t, 0.1)); b.push(pers.giroCabeza(t, 0.8)); }
  assert.notDeepEqual(a, b);
});
