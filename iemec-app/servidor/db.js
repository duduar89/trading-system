'use strict';
// Conexión a MariaDB. Todas las fechas y horas se guardan en UTC; la hora de Madrid se calcula en
// el motor (motor/tiempo.js), así el cambio de hora nunca descoloca una cita.
const mysql = require('mysql2/promise');
const config = require('./config');

function crearPool(opciones = {}) {
  return mysql.createPool({
    ...config.bd,
    ...opciones,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONEXIONES || 5),
    queueLimit: 0,
    timezone: 'Z',
    dateStrings: false,
    charset: 'utf8mb4_unicode_ci',
    // Cada conexión nueva trabaja en UTC, también para CURRENT_TIMESTAMP.
    connectAttributes: { program_name: 'iemec-app' },
  }).on('connection', (conexion) => {
    conexion.query("SET time_zone = '+00:00'");
  });
}

let poolCompartido = null;
function pool() {
  if (!poolCompartido) poolCompartido = crearPool();
  return poolCompartido;
}

// Ejecuta fn(conexion) dentro de una transacción. Si fn lanza, se deshace todo.
async function transaccion(fn, p = pool()) {
  const conexion = await p.getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await fn(conexion);
    await conexion.commit();
    return resultado;
  } catch (err) {
    try { await conexion.rollback(); } catch { /* la conexión ya estaba rota */ }
    throw err;
  } finally {
    conexion.release();
  }
}

async function cerrar() {
  if (poolCompartido) { await poolCompartido.end(); poolCompartido = null; }
}

module.exports = { crearPool, pool, transaccion, cerrar };
