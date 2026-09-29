'use strict';
// Parqué · personajes y bocadillos.
const test = require('node:test');
const assert = require('node:assert/strict');
const pers = require('../web/js/personajes.js');
const mapa = require('../web/js/mapa.js');
const { crearMaqueta } = require('../web/js/maqueta.js');

test('duración del bocadillo: 6 s + 60 ms por carácter, como mucho 12 s', () => {
  assert.equal(pers.duracionBocadillo(''), 6000);
  assert.equal(pers.duracionBocadillo('x'.repeat(50)), 9000);      // 6.000 + 50·60
  assert.equal(pers.duracionBocadillo('x'.repeat(100)), 12000);    // 6.000 + 6.000 justo en el tope
  assert.equal(pers.duracionBocadillo('x'.repeat(150)), 12000);    // 15.000 → tope
});

test('texto del bocadillo: líneas de ≤ 40 caracteres, 3 como mucho, «…» si sobra', () => {
  const frase = 'Sin posición en SOL. Esperando a que SMA 7-25 dé LONG con filtro 200 (4H).';
  const l = pers.partirTexto(frase);
  assert.equal(l.length, 2);
  assert.ok(l.every(x => x.length <= 40));
  assert.equal(l.join(' '), frase);
  assert.deepEqual(l, ['Sin posición en SOL. Esperando a que SMA', '7-25 dé LONG con filtro 200 (4H).']);
  const larga = 'Nota de análisis ETH: sesgo muy alcista. Sobre la media de 50 días; RSI 4H 61, volatilidad en 48 % y subiendo desde hace tres días seguidos.';
  const l2 = pers.partirTexto(larga);
  assert.equal(l2.length, 3);
  assert.ok(l2.every(x => x.length <= 40));
  assert.ok(l2[2].endsWith('…'));
  const palabro = pers.partirTexto('a'.repeat(95));
  assert.deepEqual(palabro.map(x => x.length), [40, 40, 15]);   // 95 = 40 + 40 + 15
});

test('como mucho 5 bocadillos: primero importancia, luego los más nuevos', () => {
  const c = [1, 3, 2, 3, 1, 2, 1].map((importancia, k) => ({ id: k, importancia, desde: k }));
  const e = pers.elegirBocadillos(c);
  assert.equal(e.length, 5);
  assert.deepEqual(e.map(x => x.id), [3, 1, 5, 2, 6]);   // 3s (nuevo antes), 2s, y el 1 más nuevo
});

test('un personaje anda a 2 teselas/s por su ruta y se sienta al llegar', () => {
  const m = mapa.construirMapa({});
  const a = { id: 'x', departamento: 'mesas', estado: 'trabajando', sala: 'parque' };
  const desde = { id: 's1', sala: 'parque', col: 5.25, fila: 1.75, mira: 'N', postura: 'de_pie' };
  const hasta = { id: 's2', sala: 'parque', col: 9.25, fila: 1.75, mira: 'N', postura: 'sentado' };
  const p = new pers.Personaje(a, desde, m);
  assert.deepEqual([p.col, p.fila], [5.25, 1.75]);
  p.fijarDestino(hasta, a, m);
  assert.ok(p.andando);
  p.actualizar(0.5); p.actualizar(0.5);                   // 1 s → 2 teselas en línea recta
  assert.ok(Math.abs(p.col - 7.25) < 1e-9, `col ${p.col}`);
  assert.equal(p.postura, 'de_pie');
  assert.equal(p.mira, 'E');
  p.actualizar(0.5); p.actualizar(0.5);                   // otro segundo → las 4 teselas del trayecto
  assert.ok(!p.andando);
  assert.deepEqual([p.col, p.fila], [9.25, 1.75]);
  assert.equal(p.postura, 'sentado');
  assert.equal(p.mira, 'N');
});

test('el elenco sigue a la instantánea: crea, mueve al comité, pone de pie y quita', () => {
  const inst = crearMaqueta({ semilla: 3, ahora: Date.UTC(2026, 8, 29, 12) }).instantanea();
  const m = mapa.construirMapa(inst);
  const elenco = pers.crearElenco();
  let asig = mapa.asignarSitios(m, inst.agentes, inst.departamentos);
  elenco.sincronizar(inst.agentes, m, asig, { instantaneo: true });
  assert.equal(elenco.lista().length, inst.agentes.length);
  const cio = elenco.personajes.get('cio');
  assert.deepEqual([cio.col, cio.fila], [23.5, 2.45]);
  // La Presidenta va al comité: anda (no salta) y acaba sentada en la cabecera.
  const agentes = inst.agentes.map(a => (a.id === 'cio' ? { ...a, sala: 'comite', estado: 'reunion' } : a));
  asig = mapa.asignarSitios(m, agentes, inst.departamentos);
  elenco.sincronizar(agentes, m, asig, {});
  assert.ok(cio.andando);
  for (let k = 0; k < 200 && cio.andando; k++) elenco.actualizar(0.1);
  assert.deepEqual([cio.col, cio.fila], [18.55, 19.1]);
  assert.equal(cio.postura, 'sentado');
  assert.equal(mapa.salaEn(cio.col, cio.fila), 'comite');
  // Kill switch: todos de pie.
  elenco.sincronizar(agentes, m, asig, { forzarDePie: true, instantaneo: true });
  assert.ok(elenco.lista().every(p => p.postura === 'de_pie'));
  // Quien sale de la plantilla desaparece.
  elenco.sincronizar(agentes.filter(a => a.id !== 'auditor'), m, asig, { instantaneo: true });
  assert.ok(!elenco.personajes.has('auditor'));
});

test('dirección en la que mira quien anda', () => {
  assert.equal(pers.direccion(1, 0), 'E');
  assert.equal(pers.direccion(-1, 0.2), 'O');
  assert.equal(pers.direccion(0.1, 1), 'S');
  assert.equal(pers.direccion(0, -1), 'N');
});
