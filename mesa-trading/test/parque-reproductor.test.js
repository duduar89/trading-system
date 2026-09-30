'use strict';
// Parqué · reproductor (web/js/reproductor.js, 30-sep-2026): lo que llega de
// golpe (un comité entero dentro de un latido, una operación entera) entra en
// el feed uno a uno, en su orden y con su hora real; la reunión se reparte en
// unos 2,5 min y la operación a un mensaje cada pocos segundos.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../web/js/reproductor.js');

const T = Date.UTC(2026, 8, 30, 8, 0);
let n = 0;
const msg = (extra) => { n++; return { id: `m${n}`, t: T + n, de: 'cio', para: 'todos', respondeA: null, hilo: null, canal: 'parque', tipo: 'nota', texto: `texto ${n}`, datos: null, importancia: 1, ...extra }; };

// Un comité como lo publica comite.celebrar: apertura, 6 puntos y la decisión, en el mismo hilo.
function comite() {
  const ap = msg({ canal: 'comite', tipo: 'comite', de: 'cio' });
  ap.hilo = ap.id;
  const lista = [ap];
  for (const de of ['controller', 'macro', 'riesgos', 'cio', 'laboratorio', 'cio']) lista.push(msg({ canal: 'comite', tipo: 'informe', de, hilo: ap.id, respondeA: lista[lista.length - 1].id }));
  lista.push(msg({ canal: 'comite', tipo: 'decision', de: 'cio', hilo: ap.id, respondeA: lista[lista.length - 1].id }));
  return lista;
}

function reloj() {
  let t = 1000;
  return { ahora: () => t, avanzar: ms => { t += ms; } };
}

// Avanza de 250 en 250 ms (el tic del panel) y apunta cuándo sale cada uno.
function correr(r, rel, ms, salidas) {
  for (let k = 0; k < ms / 250; k++) {
    rel.avanzar(250);
    for (const m of r.tic()) salidas.push({ id: m.id, en: rel.ahora() });
  }
}

test('un comité que llega de golpe: la apertura entra ya y el resto, uno a uno en unos 2,5 min, en su orden y con su hora', () => {
  const rel = reloj();
  const r = R.crearReproductor({ ahora: rel.ahora, ventana: () => R.ventanaReunionMs({ modo: 'alpaca' }) });
  const lista = comite();
  const horas = lista.map(m => m.t);
  const ya = r.recibir(lista.slice().reverse());   // llegan desordenados: da igual
  assert.deepEqual(ya.map(m => m.id), [lista[0].id], 'solo la apertura, en el acto');
  assert.equal(r.pendientes, 7);
  assert.deepEqual(r.reunionEnCurso(), { tipo: 'comite', nombre: 'Comité', vistos: 1, total: 8, quedan: 7 });
  assert.equal(r.esperaDe('riesgos'), true, 'Marta tiene su punto esperando: su bocadillo sale con él');
  const salidas = [];
  correr(r, rel, 200000, salidas);
  assert.deepEqual(salidas.map(s => s.id), lista.slice(1).map(m => m.id), 'en su orden');
  const paso = 150000 / 7;
  salidas.forEach((s, k) => assert.ok(Math.abs(s.en - (1000 + (k + 1) * paso)) <= 250, `el ${k + 2}º a los ${(k + 1) * paso} ms (sale a ${s.en - 1000})`));
  assert.ok(salidas[salidas.length - 1].en - 1000 <= 150250 && salidas[salidas.length - 1].en - 1000 >= 149750, 'la reunión entera en ~2,5 min');
  assert.deepEqual(lista.map(m => m.t), horas, 'la hora de cada mensaje no cambia');
  assert.equal(r.reunionEnCurso(), null);
  assert.equal(r.pendientes, 0);
});

test('reunión de la mañana: su número de turnos sale de la apertura; y en el sintético acelerado se reparte en menos', () => {
  const rel = reloj();
  let inst = { modo: 'sintetico', velocidad: 120 };
  const r = R.crearReproductor({ ahora: rel.ahora, ventana: () => R.ventanaReunionMs(inst) });
  assert.equal(R.ventanaReunionMs(inst), 60000, 'a ×120 un comité cada 2 min reales: se reparte en 1 min');
  assert.equal(R.ventanaReunionMs({ modo: 'sintetico', velocidad: 1 }), 150000);
  const ap = msg({ canal: 'direccion', tipo: 'reunion', datos: { reunion: 'manana', fase: 'apertura', nombre: 'Reunión de la mañana', turnos: ['noche', 'mercado', 'riesgos', 'resumen'] } });
  ap.hilo = ap.id;
  const turnos = ['noche', 'mercado', 'riesgos', 'resumen'].map(t => msg({ canal: 'direccion', tipo: t === 'resumen' ? 'reunion' : 'informe', hilo: ap.id, datos: { reunion: 'manana', turno: t, ...(t === 'resumen' ? { fase: 'cierre' } : {}) } }));
  assert.equal(r.recibir([ap, ...turnos]).length, 1);
  assert.deepEqual(r.reunionEnCurso(), { tipo: 'manana', nombre: 'Reunión de la mañana', vistos: 1, total: 5, quedan: 4 });
  const salidas = [];
  correr(r, rel, 70000, salidas);
  assert.equal(salidas.length, 4);
  assert.ok(Math.abs(salidas[3].en - 1000 - 60000) <= 250, `los 5 en 1 min (15 s entre uno y otro): ${salidas[3].en - 1000}`);
  inst = null;
});

test('una operación de golpe: un mensaje cada 8 s; la propuesta pone al operador a esperar y la ejecución lo libera', () => {
  const rel = reloj();
  const r = R.crearReproductor({ ahora: rel.ahora, ventana: () => R.ventanaReunionMs({ modo: 'alpaca' }) });
  const pid = 'momentum-SOL';
  const op = 'puesto-momentum-SOL';
  const senal = msg({ de: op, tipo: 'senal', datos: { puestoId: pid } });
  senal.hilo = senal.id;
  const propuesta = msg({ de: op, para: 'riesgos', tipo: 'propuesta', hilo: senal.id, respondeA: senal.id, datos: { puestoId: pid } });
  const aprobacion = msg({ de: 'riesgos', para: op, tipo: 'aprobacion', canal: 'riesgo', hilo: senal.id, respondeA: propuesta.id, datos: {} });
  const orden = msg({ de: 'ejecutor', tipo: 'orden', canal: 'ejecucion', hilo: senal.id, respondeA: aprobacion.id, datos: { puestoId: pid } });
  const ejec = msg({ de: 'ejecutor', tipo: 'ejecucion', canal: 'ejecucion', hilo: senal.id, respondeA: orden.id, datos: { puestoId: pid } });
  const suelto = msg({ de: 'macro', canal: 'macro', tipo: 'regimen' });
  const ya = r.recibir([senal, propuesta, aprobacion, orden, ejec, suelto]);
  assert.deepEqual(ya.map(m => m.id), [senal.id, suelto.id], 'la señal abre en el acto; lo que no es de la operación no espera');
  assert.equal(R.clasificar(aprobacion, new Map([[senal.id, senal]])).clase, 'operacion', 'la aprobación de Riesgos es de la operación por su hilo');
  const salidas = [];
  correr(r, rel, 40000, salidas);
  assert.deepEqual(salidas.map(s => s.id), [propuesta.id, aprobacion.id, orden.id, ejec.id]);
  salidas.forEach((s, k) => assert.ok(Math.abs(s.en - 1000 - (k + 1) * R.PASO_OPERACION_MAX_MS) <= 250, `${k}: ${s.en - 1000}`));
  assert.equal(R.abreEspera(propuesta), true);
  assert.equal(R.cierraEspera(aprobacion), false, 'la aprobación no: aún falta el Ejecutor');
  assert.equal(R.cierraEspera(orden), false);
  assert.equal(R.cierraEspera(ejec), true);
  assert.equal(R.cierraEspera(msg({ de: 'riesgos', tipo: 'veto', hilo: senal.id })), true, 'un veto también la acaba');
});

test('al abrir el panel justo después de una reunión se reproduce desde la apertura; vaciar suelta lo que queda', () => {
  const rel = reloj();
  const r = R.crearReproductor({ ahora: rel.ahora, ventana: () => 150000 });
  const lista = comite();
  assert.deepEqual(r.recibir(lista, { retener: true }), [], 'también la apertura espera');
  rel.avanzar(250);
  assert.deepEqual(r.tic().map(m => m.id), [lista[0].id], 'y sale en el primer tic');
  assert.equal(r.retenido(lista[1].id), true);
  assert.deepEqual(r.vaciar().map(m => m.id), lista.slice(1).map(m => m.id));
  assert.equal(r.pendientes, 0);
  assert.equal(r.retenido(lista[1].id), false);
});

test('mensajes que llegan despacio (un comité local con pausas de 1,5 s) también se espacian; lo que llega después de acabar, entra ya', () => {
  const rel = reloj();
  const r = R.crearReproductor({ ahora: rel.ahora, ventana: () => 150000 });
  const lista = comite();
  const vistos = [];
  for (const m of lista) {
    vistos.push(...r.recibir([m]).map(x => x.id));
    rel.avanzar(1500);
    vistos.push(...r.tic().map(x => x.id));
  }
  assert.deepEqual(vistos, [lista[0].id], 'solo la apertura en los primeros 12 s');
  const salidas = [];
  correr(r, rel, 200000, salidas);
  assert.equal(salidas.length, 7);
  correr(r, rel, 70000, []);
  const luego = msg({ canal: 'comite', tipo: 'comite' });
  luego.hilo = luego.id;
  assert.deepEqual(r.recibir([luego]).map(m => m.id), [luego.id], 'otro comité (otro hilo) abre en el acto');
});

test('tras volver la red, un comité y una reunión de hace horas no se reproducen como en directo: entran como historia (revisión del 30-sep-2026)', () => {
  // El panel vuelve a las 11:00 UTC; la reunión de la mañana fue a las 07:00 y el comité a las 08:00.
  const ahora = Date.UTC(2026, 8, 30, 11, 0);
  const inst = { modo: 'alpaca', ahora };
  const limite = R.limiteHistoria(inst, ahora);
  assert.equal(limite, ahora - R.ventanaReunionMs(inst), 'lo que dura una reproducción, en tiempo de la mesa');
  const viejoComite = comite().map((m, k) => ({ ...m, t: Date.UTC(2026, 8, 30, 8, 0) + k }));
  const ap = msg({ canal: 'direccion', tipo: 'reunion', t: Date.UTC(2026, 8, 30, 7, 0), datos: { reunion: 'manana', fase: 'apertura', nombre: 'Reunión de la mañana', turnos: ['noche', 'macro', 'riesgos', 'resumen'] } });
  ap.hilo = ap.id;
  const reunion = [ap, ...['controller', 'macro', 'riesgos', 'cio'].map((de, k) => msg({ canal: 'direccion', tipo: 'informe', de, t: ap.t + k + 1, hilo: ap.id, datos: { reunion: 'manana', turno: 'x' } }))];
  const reciente = msg({ canal: 'comite', tipo: 'comite', t: ahora - 30000 });
  reciente.hilo = reciente.id;
  const { viejos, recientes } = R.separarViejos([...viejoComite, ...reunion, reciente], limite);
  assert.equal(viejos.length, viejoComite.length + reunion.length, 'lo de hace horas es historia');
  assert.deepEqual(recientes.map(m => m.id), [reciente.id], 'solo lo reciente pasa por el reproductor');
  // Lo que se le da al reproductor no deja nada «en curso» de antes.
  const rel = reloj();
  const r = R.crearReproductor({ ahora: rel.ahora, ventana: () => R.ventanaReunionMs(inst) });
  r.recibir(recientes);
  assert.equal(r.pendientes, 0);
  assert.equal(r.reunionEnCurso(), null, 'ni «Reunión de la mañana en curso» ni «Comité» de hace horas');
  assert.equal(r.esperaDe('riesgos'), false, 'nadie repite su frase de hace horas');
  // Sin reloj de la mesa, nada es historia (no se adivina).
  assert.equal(R.limiteHistoria(inst, null), null);
  assert.equal(R.separarViejos(viejoComite, null).viejos.length, 0);
  // En el sintético acelerado la ventana es de tiempo de la mesa (× su velocidad).
  const acel = { modo: 'sintetico', velocidad: 120 };
  assert.equal(R.limiteHistoria(acel, ahora), ahora - R.ventanaReunionMs(acel) * 120);
});
