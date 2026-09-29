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
    ['canal', 'costeUsd', 'datos', 'de', 'deNombre', 'departamento', 'id', 'importancia', 'para', 't', 'texto', 'tipo'].sort());
  assert.equal(m.t, T0);
  assert.equal(m.deNombre, 'Marta Solís');
  assert.equal(m.departamento, 'riesgos');
  assert.equal(m.para, 'todos');
  assert.equal(m.importancia, 2);
  assert.equal(m.costeUsd, 0);
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
  assert.deepEqual(bus.desde(T0 + 4000).map(m => m.texto), ['4', '5']);
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
  assert.equal(TIPOS.length, 23);
});
