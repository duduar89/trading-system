'use strict';
// Lo íntimo no se nombra en un mensaje que sale sin que el paciente pregunte.
const test = require('node:test');
const assert = require('node:assert/strict');
const { esSensible } = require('./filtro-legal');

test('lo íntimo, por su familia o porque lo marca la clínica', () => {
  for (const familia of ['ginecoestetica', 'sexualidad_masculina', 'perdida_peso']) assert.equal(esSensible({ familia, sensible: null }), true, familia);
  assert.equal(esSensible({ familia: 'facial', sensible: null }), false);
  // La clínica decide tratamiento a tratamiento (como sale de MariaDB: 0 o 1).
  assert.equal(esSensible({ familia: 'facial', sensible: 1 }), true);
  assert.equal(esSensible({ familia: 'ginecoestetica', sensible: 0 }), false);
  assert.equal(esSensible({ familia: 'perdida_peso' }), true, 'sin la columna, por su familia');
  assert.equal(esSensible(null), false);
});
