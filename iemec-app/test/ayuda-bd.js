'use strict';
// Base de datos de pruebas: se borra y se crea de cero, se migra y se devuelve un pool.
// Sin MariaDB a mano, las pruebas de base de datos se saltan… salvo en CI (IEMEC_EXIGIR_BD=1),
// donde se exige: ahí una base que no arranca es un fallo, no un salto.
// Con sufijo, otra base aparte con ese final (la demostración de las pruebas del panel: «_panel»).
const mysql = require('mysql2/promise');
const config = require('../servidor/config');
const { crearPool } = require('../servidor/db');
const { migrar } = require('../servidor/migraciones');

const NOMBRE = process.env.DB_NAME_PRUEBAS || 'iemec_test';
const BD = { ...config.bd, database: NOMBRE };

async function prepararBdDePrueba(t, { sufijo = '' } = {}) {
  const nombre = `${NOMBRE}${sufijo}`;
  let conexion;
  try {
    conexion = await mysql.createConnection({ ...BD, database: undefined });
  } catch (err) {
    if (process.env.IEMEC_EXIGIR_BD === '1') throw err;
    t.skip(`sin MariaDB (${err.code || err.message})`);
    return null;
  }
  await conexion.query(`DROP DATABASE IF EXISTS \`${nombre}\``);
  await conexion.query(`CREATE DATABASE \`${nombre}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conexion.end();
  await migrar({ bd: { ...BD, database: nombre }, log: () => {} });
  return crearPool({ database: nombre });
}

module.exports = { prepararBdDePrueba, BD_PRUEBAS: BD };
