'use strict';
// Base de datos de pruebas: se borra y se crea de cero, se migra y se devuelve un pool.
// Sin PostgreSQL a mano, o si su usuario no puede crear la base de pruebas, las pruebas de base de datos
// se saltan… salvo en CI (IEMEC_EXIGIR_BD=1), donde se exige: ahí una base que no arranca es un
// fallo, no un salto.
//
// La base es la que diga DB_NAME_PRUEBAS (por defecto iemec_test): quien trabaja a la vez que otros en
// la misma instancia usa una propia (iemec_w_<lo suyo>). Se borra y se crea CADA VEZ, por eso hay
// freno: solo en localhost (a menos que se diga IEMEC_PRUEBAS_EN_REMOTO=1, para una base de CI que no es
// la de nadie) y nunca la base de la app (DB_NAME).
//
// El reloj de la base: PostgreSQL no tiene el SET timestamp de MariaDB. Cada base de pruebas lleva un
// reloj propio (esquema reloj): los DEFAULT now() y el disparador de actualizado_en leen reloj.ahora(), que
// da la hora real mientras nadie la fije; fijarRelojBd(pool, fecha) la congela y liberarRelojBd(pool) la
// suelta. Vale para todas las conexiones a la vez (no es de sesión). Pero la regla de oro sigue siendo
// que el código no use now() para su lógica: la hora entra por el parámetro `ahora` (docs/PORTE-POSTGRES.md).
const config = require('../servidor/config');
const db = require('../servidor/db');
const { esLocal } = require('../servidor/db-ssl');
const { migrar } = require('../servidor/migraciones');

const NOMBRE = process.env.DB_NAME_PRUEBAS || 'iemec_test';
const BD = { ...config.bd, database: NOMBRE };

function comprobarQueSePuedeBorrar() {
  if (!/^[A-Za-z0-9_]+$/.test(NOMBRE)) throw new Error(`DB_NAME_PRUEBAS=${NOMBRE}: solo letras, números y guiones bajos`);
  // Poner a mano en DB_NAME_PRUEBAS la base de la app sería borrarla (sin DB_NAME_PRUEBAS, el nombre por
  // defecto es iemec_test, que es la que usa CI como DB_NAME).
  if (process.env.DB_NAME_PRUEBAS && NOMBRE === config.bd.database) throw new Error(`DB_NAME_PRUEBAS (${NOMBRE}) es la misma base que la de la app (DB_NAME): las pruebas la borrarían. Pon otro nombre.`);
  if (!esLocal(BD.host) && process.env.IEMEC_PRUEBAS_EN_REMOTO !== '1') {
    throw new Error(`Las pruebas borran y crean la base ${NOMBRE} y el servidor (${BD.host}) no es localhost: no se tocan bases de otras máquinas. Si es una base de CI que no es de nadie, IEMEC_PRUEBAS_EN_REMOTO=1.`);
  }
}

// Una conexión de administración (a la base de mantenimiento) para borrar y crear la de pruebas.
async function conectarComoAdministrador() {
  let ultimo;
  for (const mantenimiento of ['postgres', 'template1']) {
    try {
      return await db.conectar({ ...BD, database: mantenimiento });
    } catch (err) {
      ultimo = err;
    }
  }
  throw ultimo;
}

// Borra y crea la base de pruebas, vacía. true si lo ha hecho; si no puede (sin PostgreSQL, o su usuario
// no tiene permiso), salta la prueba y devuelve null (en CI, falla).
async function crearBdVacia(t) {
  comprobarQueSePuedeBorrar();
  let admin;
  try {
    admin = await conectarComoAdministrador();
  } catch (err) {
    if (process.env.IEMEC_EXIGIR_BD === '1') throw err;
    t.skip(`sin PostgreSQL (${err.code || err.message})`);
    return null;
  }
  try {
    await admin.crudo(`DROP DATABASE IF EXISTS ${NOMBRE} WITH (FORCE)`);
    await admin.crudo(`CREATE DATABASE ${NOMBRE}`);
  } catch (err) {
    // El usuario de PostgreSQL no puede crear bases (le falta CREATEDB: docs/DESPLIEGUE.md): se dice
    // cuál es, en vez de fallar.
    if (err.pgCode !== '42501' || process.env.IEMEC_EXIGIR_BD === '1') throw err;
    t.skip(`el usuario de PostgreSQL no puede crear la base ${NOMBRE} (${err.message}): dale CREATEDB o elige otra con DB_NAME_PRUEBAS`);
    return null;
  } finally {
    await admin.end();
  }
  return true;
}

// El reloj de la base (ver arriba). Se instala después de migrar, sin tocar las migraciones: cambia los
// DEFAULT now() por reloj.ahora() y hace que el disparador de actualizado_en use también el reloj.
async function instalarReloj() {
  const con = await db.conectar({ ...BD, sentenciaMs: 0 });
  try {
    await con.crudo(`
      CREATE SCHEMA reloj;
      CREATE TABLE reloj.estado (unica BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (unica), ahora TIMESTAMPTZ);
      INSERT INTO reloj.estado (unica, ahora) VALUES (TRUE, NULL);
      CREATE FUNCTION reloj.ahora() RETURNS timestamptz LANGUAGE sql STABLE AS $f$
        SELECT COALESCE((SELECT ahora FROM reloj.estado), pg_catalog.now())
      $f$;
      DO $d$
      DECLARE c record;
      BEGIN
        FOR c IN SELECT t.relname AS tabla, a.attname AS columna
                   FROM pg_attrdef d JOIN pg_class t ON t.oid = d.adrelid JOIN pg_namespace n ON n.oid = t.relnamespace
                   JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                  WHERE n.nspname = 'public' AND pg_get_expr(d.adbin, d.adrelid) = 'now()'
        LOOP
          EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT reloj.ahora()', c.tabla, c.columna);
        END LOOP;
      END
      $d$;
      CREATE OR REPLACE FUNCTION set_actualizado_en() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN
        IF NEW.actualizado_en IS NOT DISTINCT FROM OLD.actualizado_en AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
          NEW.actualizado_en := reloj.ahora();
        END IF;
        RETURN NEW;
      END
      $f$;`);
  } finally {
    await con.end();
  }
}

// Fija la hora de la base (la de now() en los DEFAULT y en actualizado_en) para todas las conexiones.
async function fijarRelojBd(pool, fecha) {
  await pool.query('UPDATE reloj.estado SET ahora = ?', [fecha]);
}

async function liberarRelojBd(pool) {
  await pool.query('UPDATE reloj.estado SET ahora = NULL');
}

async function prepararBdDePrueba(t) {
  if (!(await crearBdVacia(t))) return null;
  await migrar({ bd: BD, log: () => {} });
  await instalarReloj();
  return db.crearPool({ database: NOMBRE });
}

module.exports = { prepararBdDePrueba, crearBdVacia, fijarRelojBd, liberarRelojBd, BD_PRUEBAS: BD };
