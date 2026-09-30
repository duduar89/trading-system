'use strict';
// Conexión con MariaDB (ARQUITECTURA-WEB W4). Solo la usa el modo web del
// cPanel: el modo local (portátil, demo) no tiene base de datos.
//
//   configuracionBD(entorno)  → { host, port, user, password, database } | null
//   obtenerPool(config)       → Pool de mysql2/promise | null   (perezoso, uno por proceso)
//   cerrarPool()              → cierra los que haya
//
// Variables del .env: DB_HOST (por defecto localhost), DB_PUERTO (3306),
// DB_USUARIO, DB_CLAVE, DB_NOMBRE. Sin usuario o sin nombre de base no hay
// configuración (null): la web arranca sin login y el latido opera sin copia.
//
// Pocas conexiones por proceso: en el hosting compartido el límite de
// conexiones es por usuario de MariaDB y puede haber varios procesos de la web
// y un latido a la vez. Las horas se guardan y se leen en UTC (timezone 'Z'),
// así que un DATETIME de la base es siempre UTC, lo escriba quien lo escriba.

const PUERTO_POR_DEFECTO = 3306;
const OPCIONES_POOL = Object.freeze({
  waitForConnections: true,
  connectionLimit: 3,
  maxIdle: 1,
  idleTimeout: 30_000,
  queueLimit: 0,
  connectTimeout: 10_000,
  enableKeepAlive: true,
  charset: 'utf8mb4',
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: false,
  dateStrings: false,
});

function limpio(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function configuracionBD(entorno = process.env) {
  const user = limpio(entorno.DB_USUARIO);
  const database = limpio(entorno.DB_NOMBRE);
  if (!user || !database) return null;
  const textoPuerto = limpio(entorno.DB_PUERTO);
  const port = textoPuerto === '' ? PUERTO_POR_DEFECTO : Number(textoPuerto);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`DB_PUERTO=${entorno.DB_PUERTO} no es un puerto válido (un número como 3306)`);
  }
  // La clave NO se recorta: un espacio al final puede ser parte de ella.
  const password = entorno.DB_CLAVE === undefined || entorno.DB_CLAVE === null ? '' : String(entorno.DB_CLAVE);
  return { host: limpio(entorno.DB_HOST) || 'localhost', port, user, password, database };
}

// Un pool por configuración distinta y por proceso (casi siempre uno solo).
const pools = new Map();

function claveDe(config) {
  return `${config.user}@${config.host}:${config.port}/${config.database}`;
}

function obtenerPool(config) {
  if (!config) return null;
  const clave = claveDe(config);
  let pool = pools.get(clave);
  if (!pool) {
    const mysql = require('mysql2/promise');   // se carga al pedirlo: el modo local no lo necesita
    pool = mysql.createPool({
      ...OPCIONES_POOL,
      host: config.host, port: config.port, user: config.user, password: config.password, database: config.database,
    });
    pools.set(clave, pool);
  }
  return pool;
}

async function cerrarPool() {
  const todos = [...pools.values()];
  pools.clear();
  await Promise.all(todos.map(p => p.end().catch(() => { /* ya cerrado o sin conexión */ })));
}

module.exports = { configuracionBD, obtenerPool, cerrarPool, OPCIONES_POOL };
