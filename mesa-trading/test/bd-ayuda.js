'use strict';
// Ayuda de las pruebas de base de datos (test/bd-*.test.js). Van contra un
// MariaDB de verdad: en CI el servicio mariadb:11.4 del workflow, en local el
// que digan TEST_DB_HOST, TEST_DB_PUERTO, TEST_DB_USUARIO, TEST_DB_CLAVE y
// TEST_DB_NOMBRE. Sin ellas, las pruebas se saltan diciendo por qué.
//
// Las pruebas corren en paralelo (un proceso por fichero) sobre la misma base:
// cada una usa usuarios, IPs y tablas propias con un sufijo aleatorio.

const crypto = require('crypto');

const E = process.env;
const entorno = {
  DB_HOST: E.TEST_DB_HOST, DB_PUERTO: E.TEST_DB_PUERTO, DB_USUARIO: E.TEST_DB_USUARIO, DB_CLAVE: E.TEST_DB_CLAVE, DB_NOMBRE: E.TEST_DB_NOMBRE,
};
const hayBD = Boolean(E.TEST_DB_HOST && E.TEST_DB_USUARIO && E.TEST_DB_NOMBRE);
const motivoSalto = hayBD ? false : 'sin TEST_DB_* no hay MariaDB de prueba (ver test/bd-ayuda.js)';

// Pool con las tablas creadas. Al acabar la prueba se ejecutan las limpiezas
// apuntadas con alAcabar (en orden inverso) y DESPUÉS se cierra el pool.
async function prepararBD(t) {
  const { configuracionBD, obtenerPool, cerrarPool } = require('../src/bd/conexion');
  const { crearTablas } = require('../src/bd/tablas');
  const pool = obtenerPool(configuracionBD(entorno));
  const limpiezas = [];
  t.after(async () => {
    for (const fn of limpiezas.reverse()) await fn();
    await cerrarPool();
  });
  await crearTablas(pool);
  return { pool, alAcabar: fn => limpiezas.push(fn) };
}

const sufijo = () => crypto.randomBytes(4).toString('hex');
const ipAleatoria = () => `198.51.${crypto.randomInt(0, 256)}.${crypto.randomInt(1, 255)}`;

module.exports = { entorno, hayBD, motivoSalto, prepararBD, sufijo, ipAleatoria };
