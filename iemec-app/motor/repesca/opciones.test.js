'use strict';
// El nivel o la técnica de un tratamiento que agrupa varios: cuál elige al contestar «¿Cuál te
// interesa?». Lo que no está claro no se adivina.
const test = require('node:test');
const assert = require('node:assert/strict');
const { elegirOpcion, textoOpciones } = require('./opciones');

// Como las deja el catálogo: los alias comparten palabras («Head Spa Japonés», «Mujer»…).
const HEAD_SPA = [
  { id: 'head-spa-express', nombre: 'Head Spa Express', alias: ['Mujer - Tratamiento capilar spa · Headspa Express'] },
  { id: 'head-spa-detox', nombre: 'Head Spa Detox Purificante', alias: ['Head Spa Japonés · Head Detox Purificante', 'Mujer - Tratamiento capilar spa · Headspa Detox Purificante'] },
  { id: 'head-spa-synergie', nombre: 'Head Spa Synergie', alias: '["Head Spa Japonés · Head Synergie"]' },
  { id: 'head-spa-zen-premium', nombre: 'Head Spa Zen Premium', alias: null },
];
const id = (texto, o) => elegirOpcion(texto, HEAD_SPA, o)?.id || null;

test('elige por su nombre, por lo que la distingue de las demás o por su orden', () => {
  assert.equal(id('El detox'), 'head-spa-detox');
  assert.equal(id('Quiero el Zen'), 'head-spa-zen-premium');
  assert.equal(id('La de purificante, por favor'), 'head-spa-detox');
  assert.equal(id('el head spa synergie'), 'head-spa-synergie');
  assert.equal(id('Express'), 'head-spa-express');
  assert.equal(id('La primera'), 'head-spa-express');
  assert.equal(id('la segunda opción'), 'head-spa-detox');
  assert.equal(id('El último'), 'head-spa-zen-premium');
  assert.equal(id('2'), 'head-spa-detox');
});

test('no adivina: ninguna, dos a la vez, lo que tienen todas, una fecha o un «sí»', () => {
  for (const t of ['Ninguno', 'No sé, ¿cuál me recomiendas?', 'El head spa japonés', 'El detox o el zen', 'el 2 de noviembre', 'Sí', 'Vale', '']) {
    assert.equal(id(t), null, t);
  }
  assert.equal(id('la primera', { porOrden: false }), null, 'si aún no se le han dicho, «la primera» no es ninguna');
  assert.equal(id('el detox', { porOrden: false }), 'head-spa-detox', 'pero su nombre sí');
  assert.equal(elegirOpcion('el detox', []), null);
});

test('las opciones, dichas con «o»', () => {
  assert.equal(textoOpciones(['Head Spa Express', 'Head Spa Detox Purificante', 'Head Spa Zen Premium']), 'Head Spa Express, Head Spa Detox Purificante o Head Spa Zen Premium');
  assert.equal(textoOpciones(['Una', 'Otra']), 'Una o Otra');
  assert.equal(textoOpciones(['Una']), 'Una');
});
