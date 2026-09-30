'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Bus, CANALES, TIPOS } = require('../src/agentes/bus');
const { RelojSimulado } = require('../src/util/reloj');
const { leerJSONL } = require('../src/util/almacen');
const { carpetaTemporal } = require('./agentes-ayuda');

const T0 = Date.UTC(2026, 8, 29, 12, 0, 0);
const AGENTES = [
  { id: 'riesgos', nombre: 'Marta Solís', departamento: 'riesgos' },
  { id: 'puesto-tendencia-SOL', nombre: 'Lucía García', departamento: 'mesas' },
];

test('publicar: devuelve el Mensaje completo con nombre y departamento del emisor', () => {
  const bus = new Bus({ reloj: new RelojSimulado(T0), agentes: AGENTES });
  const m = bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'veto', texto: 'Veto a SOL: precio viejo.', datos: { simbolo: 'SOL/USD' }, importancia: 2 });
  assert.deepEqual(Object.keys(m).sort(),
    ['canal', 'costeUsd', 'datos', 'de', 'deNombre', 'departamento', 'hilo', 'id', 'importancia', 'para', 'respondeA', 't', 'texto', 'tipo'].sort());
  assert.equal(m.t, T0);
  assert.equal(m.deNombre, 'Marta Solís');
  assert.equal(m.departamento, 'riesgos');
  assert.equal(m.para, 'todos');
  assert.equal(m.importancia, 2);
  assert.equal(m.costeUsd, 0);
  assert.equal(m.respondeA, null);
  assert.equal(m.hilo, null);
  assert.deepEqual(m.datos, { simbolo: 'SOL/USD' });
  const sis = bus.publicar({ de: 'sistema', canal: 'sistema', tipo: 'sistema', texto: 'Arranque.' });
  assert.equal(sis.deNombre, 'Sistema');
  assert.equal(sis.departamento, null);
  assert.equal(sis.datos, null);
  assert.notEqual(sis.id, m.id);
});

test("emite 'mensaje' y registrarAgente añade emisores", () => {
  const bus = new Bus({ reloj: new RelojSimulado(T0) });
  const vistos = [];
  bus.on('mensaje', m => vistos.push(m));
  bus.registrarAgente({ id: 'cio', nombre: 'Carmen Aguirre', departamento: 'direccion' });
  bus.publicar({ de: 'cio', canal: 'comite', tipo: 'decision', texto: 'Modo NORMAL.' });
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0].deNombre, 'Carmen Aguirre');
});

test('persiste en JSONL y un bus nuevo recupera los últimos', () => {
  const dir = carpetaTemporal();
  const ruta = path.join(dir, 'mensajes.jsonl');
  const reloj = new RelojSimulado(T0);
  const bus = new Bus({ reloj, ruta, agentes: AGENTES });
  for (let i = 0; i < 5; i++) { reloj.avanzar(1000); bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'nota', texto: `n${i}` }); }
  assert.equal(leerJSONL(ruta).length, 5);
  const otro = new Bus({ reloj, ruta, agentes: AGENTES, maxMemoria: 3 });
  assert.deepEqual(otro.ultimos().map(m => m.texto), ['n2', 'n3', 'n4']);
  // Ids nuevos no chocan con los recuperados aunque el reloj repita instante.
  const recuperados = new Set(otro.ultimos().map(m => m.id));
  const nuevo = otro.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'nota', texto: 'n5' });
  assert.equal(recuperados.has(nuevo.id), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('maxMemoria recorta y ultimos(n, filtro) filtra por objeto o función', () => {
  const reloj = new RelojSimulado(T0);
  const bus = new Bus({ reloj, agentes: AGENTES, maxMemoria: 4 });
  const canales = ['riesgo', 'parque', 'riesgo', 'parque', 'riesgo', 'parque'];
  canales.forEach((c, i) => { reloj.avanzar(1000); bus.publicar({ de: 'riesgos', canal: c, tipo: 'nota', texto: String(i) }); });
  assert.deepEqual(bus.ultimos().map(m => m.texto), ['2', '3', '4', '5']);
  assert.deepEqual(bus.ultimos(2).map(m => m.texto), ['4', '5']);
  assert.deepEqual(bus.ultimos(150, { canal: 'riesgo' }).map(m => m.texto), ['2', '4']);
  assert.deepEqual(bus.ultimos(150, { canal: ['riesgo', 'parque'], tipo: 'nota' }).length, 4);
  assert.deepEqual(bus.ultimos(150, m => m.texto === '3').map(m => m.texto), ['3']);
  // `desde` incluye el propio instante.
  assert.deepEqual(bus.desde(T0 + 4000).map(m => m.texto), ['3', '4', '5']);
  assert.deepEqual(bus.desde(T0 + 4001).map(m => m.texto), ['4', '5']);
  assert.deepEqual(bus.ultimos(0), []);
});

test('canal o tipo fuera de lista: sistema (o error en modo estricto)', () => {
  const bus = new Bus({ reloj: new RelojSimulado(T0) });
  const m = bus.publicar({ de: 'x', canal: 'chismes', tipo: 'rumor', texto: 'hola' });
  assert.equal(m.canal, 'sistema');
  assert.equal(m.tipo, 'sistema');
  const estricto = new Bus({ reloj: new RelojSimulado(T0), estricto: true });
  assert.throws(() => estricto.publicar({ de: 'x', canal: 'chismes', tipo: 'nota', texto: 'hola' }), /canal desconocido/);
  assert.equal(CANALES.length, 10);
  assert.equal(TIPOS.length, 24);
  assert.ok(TIPOS.includes('reunion'));
});

test('desde(t) incluye los mensajes de ese mismo instante: paginar con el último t visto no pierde ninguno', () => {
  const reloj = new RelojSimulado(T0);
  const bus = new Bus({ reloj, agentes: AGENTES });
  // Caso de la revisión: en sintético muchos mensajes comparten t.
  bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'nota', texto: 'a' });
  bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'nota', texto: 'b' });
  const vistos = bus.desde(-Infinity);
  const ultimoT = vistos[vistos.length - 1].t;
  bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'nota', texto: 'c' });   // mismo instante, después de leer
  const nuevos = bus.desde(ultimoT);
  assert.deepEqual(nuevos.map(m => m.texto), ['a', 'b', 'c']);
  // Quien pagina quita los repetidos por id y se queda exactamente con el nuevo.
  const ids = new Set(vistos.map(m => m.id));
  assert.deepEqual(nuevos.filter(m => !ids.has(m.id)).map(m => m.texto), ['c']);
  assert.deepEqual(bus.ultimos(150, { desde: ultimoT, tipo: 'nota' }).length, 3);
});

test('conversación: hilo nuevo, respuestas encadenadas y para quién va', () => {
  const reloj = new RelojSimulado(T0);
  const bus = new Bus({ reloj, agentes: AGENTES });
  const propuesta = bus.publicar({ de: 'puesto-tendencia-SOL', para: 'riesgos', canal: 'parque', tipo: 'propuesta', texto: 'Marta, quiero comprar SOL.', hilo: true });
  assert.equal(propuesta.hilo, propuesta.id, 'hilo: true abre la conversación con su propio id');
  assert.equal(propuesta.respondeA, null);
  assert.equal(propuesta.para, 'riesgos');
  const respuesta = bus.publicar({ de: 'riesgos', para: 'puesto-tendencia-SOL', canal: 'riesgo', tipo: 'aprobacion', texto: 'Lucía, adelante.', respondeA: propuesta.id });
  assert.equal(respuesta.respondeA, propuesta.id);
  assert.equal(respuesta.hilo, propuesta.id, 'sin hilo, el del mensaje al que responde');
  const tercero = bus.publicar({ de: 'ejecutor', para: 'puesto-tendencia-SOL', canal: 'ejecucion', tipo: 'orden', texto: 'Recibido.', respondeA: respuesta.id });
  assert.equal(tercero.hilo, propuesta.id, 'el hilo se hereda a lo largo de la cadena');
  assert.deepEqual(bus.ultimos(150, { hilo: propuesta.id }).map(m => m.id), [propuesta.id, respuesta.id, tercero.id]);
  // Responder a algo que ya no está en memoria: el hilo es ese id.
  const suelto = bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'nota', texto: 'x', respondeA: 'viejo-0001' });
  assert.equal(suelto.hilo, 'viejo-0001');
});

test('ids deterministas: un bus nuevo sobre el mismo fichero sigue la numeración (continuo = latido a latido)', () => {
  const dir = carpetaTemporal();
  const reloj = new RelojSimulado(T0);
  // (a) un solo bus que publica cuatro mensajes
  const a = new Bus({ reloj, ruta: path.join(dir, 'a.jsonl'), agentes: AGENTES });
  const idsA = [1, 2, 3, 4].map(i => a.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'nota', texto: `n${i}` }).id);
  // (b) un bus nuevo por mensaje, como cada latido
  const idsB = [1, 2, 3, 4].map(i => new Bus({ reloj, ruta: path.join(dir, 'b.jsonl'), agentes: AGENTES }).publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'nota', texto: `n${i}` }).id);
  assert.deepEqual(idsB, idsA);
  assert.equal(new Set(idsA).size, 4);
  // Un fichero con ids de antes (marca al azar) sigue su numeración sin repetir.
  const ruta = path.join(dir, 'viejo.jsonl');
  fs.writeFileSync(ruta, JSON.stringify({ id: `${T0.toString(36)}-k3xf`, t: T0, de: 'riesgos', canal: 'riesgo', tipo: 'nota', texto: 'viejo' }) + '\n');
  const c = new Bus({ reloj, ruta, agentes: AGENTES });
  assert.equal(c.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'nota', texto: 'nuevo' }).id, `${T0.toString(36)}-k3xg`);
  fs.rmSync(dir, { recursive: true, force: true });
});
