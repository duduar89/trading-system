'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba, BD_PRUEBAS } = require('./ayuda-bd');
const { migrar, listar } = require('../servidor/migraciones');

test('las migraciones se aplican en una base limpia y son idempotentes', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    const [tablas] = await pool.query('SHOW TABLES');
    const nombres = tablas.map((f) => Object.values(f)[0]);
    for (const imprescindible of ['clinica', 'salas', 'equipos', 'profesionales', 'tratamientos', 'pacientes', 'consentimientos', 'eventos', 'cola', 'candados', 'webhooks']) {
      assert.ok(nombres.includes(imprescindible), `falta la tabla ${imprescindible}`);
    }
    const [hechas] = await pool.query('SELECT COUNT(*) AS n FROM _migraciones');
    assert.equal(hechas[0].n, listar().length);
    // Segunda pasada: no aplica nada.
    const otraVez = await migrar({ bd: BD_PRUEBAS, log: () => {} });
    assert.deepEqual(otraVez, []);
  } finally {
    await pool.end();
  }
});

test('la base trabaja en UTC', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    const [[fila]] = await pool.query('SELECT @@session.time_zone AS zona');
    assert.equal(fila.zona, '+00:00');
  } finally {
    await pool.end();
  }
});
