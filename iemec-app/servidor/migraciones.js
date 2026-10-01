'use strict';
// Migraciones SQL numeradas (sql/NNN-nombre.sql). Cada una se aplica una sola vez y queda anotada
// en _migraciones con su huella: si alguien edita una ya aplicada, se para en seco. Los cambios
// nuevos van siempre en un fichero nuevo.
//
// En PostgreSQL el DDL es transaccional: cada migración va en SU transacción (con la anotación en
// _migraciones), así que si falla no queda nada a medias. Y un pg_advisory_lock evita que dos procesos
// migren a la vez (dos despliegues, un npm run migrar y un arranque…): el segundo espera al primero y
// luego ve que ya está todo hecho.
//
// Ese bloqueo es de SESIÓN: las migraciones van por la conexión directa de Supabase (db.<ref>.supabase.co)
// o por el pooler en modo SESIÓN (puerto 5432 del pooler), nunca por el modo transacción (puerto 6543),
// que cambia de conexión de servidor entre transacciones y no mantiene ni el bloqueo ni la sesión. Si la
// app usa el pooler en modo transacción, las migraciones se lanzan con DATABASE_URL_MIGRACIONES.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');

const CARPETA = path.join(__dirname, '..', 'sql');
const CLAVE_DEL_BLOQUEO = 'iemec:migraciones';

// Lo que una migración necesita y no se puede hacer en SQL. Va después de las migraciones, en cada
// pasada: cuando ya no queda nada que hacer, no hace nada.
const PASOS = [
  // 010: los tokens de «Tu cita» que aún estén en claro se cifran con CLAVE_CIFRADO.
  { tras: '010-privacidad-cita.sql', hacer: (con, { log }) => require('./agenda').cifrarTokensAntiguos(con, { log }) },
  // 017: lo que pidieron en la web (página, referencia, tratamiento, interés), de claro a cifrado.
  { tras: '017-verificar-formulario-web.sql', hacer: (con, { log }) => require('./retencion').cifrarSolicitudesAntiguas(con, { log }) },
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

async function migrar({ bd = config.bdMigraciones || config.bd, carpeta = CARPETA, log = console.log } = {}) {
  if (db.modoPooler(bd) === 'transaccion') {
    throw new Error('Las migraciones no pueden ir por el pooler en modo transacción (puerto 6543): usa la conexión directa o el pooler en modo sesión (puerto 5432), por ejemplo con DATABASE_URL_MIGRACIONES.');
  }
  // Una sola conexión (sin límite de tiempo por sentencia: una migración puede tardar).
  const con = await db.conectar({ ...bd, sentenciaMs: 0 });
  try {
    await con.crudo('SELECT pg_advisory_lock(hashtextextended($1, 0))', [CLAVE_DEL_BLOQUEO]);
    await con.crudo(`CREATE TABLE IF NOT EXISTS _migraciones (
      nombre VARCHAR(120) PRIMARY KEY,
      huella CHAR(64) NOT NULL,
      aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await con.crudo('SELECT nombre, huella FROM _migraciones');
    const hechas = new Map(rows.map((f) => [f.nombre, f.huella]));
    const aplicadas = [];
    for (const m of listar(carpeta)) {
      if (hechas.has(m.nombre)) {
        if (hechas.get(m.nombre) !== m.huella) {
          throw new Error(`La migración ${m.nombre} ya estaba aplicada y ha cambiado. No se editan: crea una nueva.`);
        }
        continue;
      }
      log(`▸ Aplicando ${m.nombre}`);
      await con.crudo('BEGIN');
      try {
        await con.crudo(m.sql);
        await con.crudo('INSERT INTO _migraciones (nombre, huella) VALUES ($1, $2)', [m.nombre, m.huella]);
        await con.crudo('COMMIT');
      } catch (err) {
        await con.crudo('ROLLBACK').catch(() => {});
        throw err;
      }
      aplicadas.push(m.nombre);
    }
    for (const paso of PASOS) {
      if (hechas.has(paso.tras) || aplicadas.includes(paso.tras)) await paso.hacer(con, { log });
    }
    return aplicadas;
  } finally {
    try { await con.crudo('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [CLAVE_DEL_BLOQUEO]); } catch { /* la conexión ya estaba rota */ }
    await con.end();
  }
}

module.exports = { migrar, listar, CLAVE_DEL_BLOQUEO };
