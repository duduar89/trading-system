'use strict';
// Base de datos de pruebas: se borra y se crea de cero, se migra y se devuelve un pool.
// Sin MariaDB a mano, o si su usuario no puede crear la base de pruebas, las pruebas de base de datos
// se saltan… salvo en CI (IEMEC_EXIGIR_BD=1), donde se exige: ahí una base que no arranca es un
// fallo, no un salto.
const mysql = require('mysql2/promise');
const config = require('../servidor/config');
const { crearPool } = require('../servidor/db');
const { migrar } = require('../servidor/migraciones');

const NOMBRE = process.env.DB_NAME_PRUEBAS || 'iemec_test';
const BD = { ...config.bd, database: NOMBRE };

async function prepararBdDePrueba(t) {
  let conexion;
  try {
    conexion = await mysql.createConnection({ ...BD, database: undefined });
  } catch (err) {
    if (process.env.IEMEC_EXIGIR_BD === '1') throw err;
    t.skip(`sin MariaDB (${err.code || err.message})`);
    return null;
  }
  try {
    await conexion.query(`DROP DATABASE IF EXISTS \`${NOMBRE}\``);
    await conexion.query(`CREATE DATABASE \`${NOMBRE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (err) {
    // El usuario de MariaDB no tiene permiso sobre esa base (la guía del portátil se lo da sobre
    // iemec_test: docs/DESPLIEGUE.md): se dice cuál es, en vez de fallar.
    if (err.code !== 'ER_DBACCESS_DENIED_ERROR' || process.env.IEMEC_EXIGIR_BD === '1') throw err;
    t.skip(`el usuario de MariaDB no puede crear la base ${NOMBRE} (${err.code}): dale permiso o elige otra con DB_NAME_PRUEBAS`);
    return null;
  } finally {
    await conexion.end();
  }
  await migrar({ bd: BD, log: () => {} });
  return crearPool({ database: NOMBRE });
}

module.exports = { prepararBdDePrueba, BD_PRUEBAS: BD };
