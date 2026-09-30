'use strict';
// Conexión y tablas (ARQUITECTURA-WEB W4 y W5-D): la configuración sale del
// .env y crear las tablas dos veces no cambia nada ni borra datos.

const test = require('node:test');
const assert = require('node:assert/strict');
const { configuracionBD, obtenerPool, cerrarPool } = require('../src/bd/conexion');
const { crearTablas, sqlTablas, NOMBRES } = require('../src/bd/tablas');
const { motivoSalto, prepararBD, sufijo } = require('./bd-ayuda');

test('configuracionBD: sin usuario o sin base no hay configuración', () => {
  assert.equal(configuracionBD({}), null);
  assert.equal(configuracionBD({ DB_USUARIO: 'u' }), null);
  assert.equal(configuracionBD({ DB_NOMBRE: 'b' }), null);
  assert.equal(obtenerPool(null), null);
});

test('configuracionBD: valores por defecto y la clave tal cual', () => {
  assert.deepEqual(configuracionBD({ DB_USUARIO: ' u ', DB_NOMBRE: 'b', DB_CLAVE: ' con espacios ' }),
    { host: 'localhost', port: 3306, user: 'u', password: ' con espacios ', database: 'b' });
  assert.equal(configuracionBD({ DB_USUARIO: 'u', DB_NOMBRE: 'b', DB_HOST: '127.0.0.1', DB_PUERTO: '3307' }).port, 3307);
  assert.throws(() => configuracionBD({ DB_USUARIO: 'u', DB_NOMBRE: 'b', DB_PUERTO: 'tres' }), /DB_PUERTO/);
});

test('obtenerPool: uno por proceso y perezoso', async () => {
  const cfg = { host: '127.0.0.1', port: 1, user: 'nadie', password: '', database: 'nada' };
  const a = obtenerPool(cfg);
  assert.equal(obtenerPool({ ...cfg }), a, 'la misma configuración da el mismo pool');
  await cerrarPool();
  assert.notEqual(obtenerPool(cfg), a, 'tras cerrarlo, uno nuevo');
  await cerrarPool();
});

test('el SQL de las tablas: prefijo mesa_, InnoDB, utf8mb4 e idempotente', () => {
  const sql = sqlTablas();
  assert.deepEqual(NOMBRES, ['mesa_usuarios', 'mesa_sesiones', 'mesa_intentos', 'mesa_registros', 'mesa_latidos']);
  for (const n of NOMBRES) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${n} \\(`));
  assert.equal((sql.match(/ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/g) || []).length, NOMBRES.length);
  assert.match(sql, /UNIQUE KEY uq_fuente_linea \(fuente, linea\)/);
  assert.doesNotMatch(sql, /\bDROP\b|\bALTER\b|\bDELETE\b/i);
});

test('crear las tablas dos veces no cambia nada ni borra datos', { skip: motivoSalto }, async (t) => {
  const { pool } = await prepararBD(t);
  const fuente = `p${sufijo()}`;
  await pool.query('INSERT INTO mesa_registros (fuente, linea, t, datos) VALUES (?, 1, 5, ?)', [fuente, '{"a":1}']);
  const r = await crearTablas(pool);
  assert.deepEqual(r.creadas, []);
  assert.deepEqual(r.existian, NOMBRES);
  const [filas] = await pool.query('SELECT datos FROM mesa_registros WHERE fuente = ?', [fuente]);
  assert.deepEqual(filas.map(f => f.datos), ['{"a":1}']);
  const [cols] = await pool.query("SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'mesa\\_%'");
  for (const n of NOMBRES) {
    const c = cols.find(x => x.TABLE_NAME === n);
    assert.ok(c, `falta ${n}`);
    assert.equal(c.ENGINE, 'InnoDB');
    assert.match(c.TABLE_COLLATION, /^utf8mb4/);
  }
  await pool.query('DELETE FROM mesa_registros WHERE fuente = ?', [fuente]);
});
