'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { apretarLimites, LIMITES_DUROS } = require('../src/config');

test('ajustes.json solo aprieta: lo que afloja, no es número o no existe se ignora', () => {
  const { limites, ignorados } = apretarLimites(LIMITES_DUROS, {
    riesgoPorOperacion: 0.005,   // aprieta
    caidaKill: 0.40,             // afloja
    minNocionalOrden: 25,        // aprieta (aquí más es más prudente)
    penalizacionPapel: 0,        // afloja
    maxPosiciones: 'muchas',     // no es número
    inventado: 1,                // no es un límite
  });
  assert.equal(limites.riesgoPorOperacion, 0.005);
  assert.equal(limites.caidaKill, LIMITES_DUROS.caidaKill);
  assert.equal(limites.minNocionalOrden, 25);
  assert.equal(limites.penalizacionPapel, LIMITES_DUROS.penalizacionPapel);
  assert.equal(limites.maxPosiciones, LIMITES_DUROS.maxPosiciones);
  assert.equal('inventado' in limites, false);
  assert.deepEqual(ignorados.sort(), ['caidaKill', 'inventado', 'maxPosiciones', 'penalizacionPapel']);
  assert.ok(Object.isFrozen(limites));
});

test('sin ajustes, los límites duros tal cual', () => {
  const { limites, ignorados } = apretarLimites(LIMITES_DUROS, undefined);
  assert.deepEqual({ ...limites }, { ...LIMITES_DUROS });
  assert.deepEqual(ignorados, []);
});
