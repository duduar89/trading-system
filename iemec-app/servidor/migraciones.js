'use strict';
// Migraciones SQL numeradas (sql/NNN-nombre.sql). Cada una se aplica una sola vez y queda anotada
// en _migraciones con su huella: si alguien edita una ya aplicada, se para en seco. Los cambios
// nuevos van siempre en un fichero nuevo.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const config = require('./config');

const CARPETA = path.join(__dirname, '..', 'sql');

// Lo que una migración necesita y no se puede hacer en SQL. Va después de la suya, en cada pasada:
// cuando ya no queda nada que hacer, no hace nada.
const PASOS = [
  // 010: los tokens de «Tu cita» que aún estén en claro se cifran con CLAVE_CIFRADO.
  { tras: '010-privacidad-cita.sql', hacer: (con, { log }) => require('./agenda').cifrarTokensAntiguos(con, { log }) },
];

function listar(carpeta = CARPETA) {
  return fs.readdirSync(carpeta)
    .filter((f) => /^\d{3}-[a-z0-9-]+\.sql$/.test(f))
    .sort()
    .map((nombre) => {
      const sql = fs.readFileSync(path.join(carpeta, nombre), 'utf8');
      return { nombre, sql, huella: crypto.createHash('sha256').update(sql).digest('hex') };
    });
}

async function migrar({ bd = config.bd, carpeta = CARPETA, log = console.log } = {}) {
  const conexion = await mysql.createConnection({ ...bd, multipleStatements: true, timezone: 'Z' });
  try {
    await conexion.query("SET time_zone = '+00:00'");
    await conexion.query(`CREATE TABLE IF NOT EXISTS _migraciones (
      nombre VARCHAR(120) PRIMARY KEY,
      huella CHAR(64) NOT NULL,
      aplicada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const [filas] = await conexion.query('SELECT nombre, huella FROM _migraciones');
    const hechas = new Map(filas.map((f) => [f.nombre, f.huella]));
    const aplicadas = [];
    for (const m of listar(carpeta)) {
      if (hechas.has(m.nombre)) {
        if (hechas.get(m.nombre) !== m.huella) {
          throw new Error(`La migración ${m.nombre} ya estaba aplicada y ha cambiado. No se editan: crea una nueva.`);
        }
        continue;
      }
      log(`▸ Aplicando ${m.nombre}`);
      await conexion.query(m.sql);
      await conexion.query('INSERT INTO _migraciones (nombre, huella) VALUES (?, ?)', [m.nombre, m.huella]);
      aplicadas.push(m.nombre);
    }
    for (const paso of PASOS) {
      if (hechas.has(paso.tras) || aplicadas.includes(paso.tras)) await paso.hacer(conexion, { log });
    }
    return aplicadas;
  } finally {
    await conexion.end();
  }
}

module.exports = { migrar, listar };
