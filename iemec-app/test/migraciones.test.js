'use strict';
// Las migraciones sobre PostgreSQL: se aplican en una base limpia y son idempotentes, una que falla a
// medias no deja nada, dos procesos no migran a la vez, todas las tablas quedan con RLS y los roles de la
// API de datos de Supabase (anon y authenticated) no pueden ver ni tocar nada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepararBdDePrueba, crearBdVacia, BD_PRUEBAS } = require('./ayuda-bd');
const { migrar, listar } = require('../servidor/migraciones');
const db = require('../servidor/db');

const tablas = async (pool) => {
  const [filas] = await pool.query("SELECT tablename AS nombre, rowsecurity AS rls FROM pg_tables WHERE schemaname = 'public' ORDER BY 1");
  return filas;
};

test('las migraciones se aplican en una base limpia y son idempotentes', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    const nombres = (await tablas(pool)).map((f) => f.nombre);
    for (const imprescindible of ['clinica', 'salas', 'equipos', 'profesionales', 'tratamientos', 'pacientes', 'consentimientos', 'eventos', 'cola', 'candados', 'webhooks', 'citas', 'leads', 'resenas', 'passkeys']) {
      assert.ok(nombres.includes(imprescindible), `falta la tabla ${imprescindible}`);
    }
    const [[hechas]] = await pool.query('SELECT COUNT(*) AS n FROM _migraciones');
    assert.equal(Number(hechas.n), listar().length);
    // Segunda pasada: no aplica nada.
    const otraVez = await migrar({ bd: BD_PRUEBAS, log: () => {} });
    assert.deepEqual(otraVez, []);
  } finally {
    await pool.end();
  }
});

test('los instantes se guardan y se leen en UTC, sea cual sea la zona de la sesión', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    const instante = new Date('2026-10-25T00:30:00Z'); // la noche del cambio de hora en Madrid
    const [[fila]] = await pool.query('SELECT ?::timestamptz AS vuelta, now() AS ahora, CURRENT_DATE AS hoy', [instante]);
    assert.equal(fila.vuelta.toISOString(), instante.toISOString(), 'una fecha vuelve como el mismo instante');
    assert.ok(Math.abs(fila.ahora.getTime() - Date.now()) < 60000, 'now() es la hora real, como Date');
    assert.equal(fila.hoy.getUTCHours(), 0, 'un DATE llega a medianoche UTC');
    // Lo mismo aunque la sesión esté en otra zona (solo para esta prueba: la app no cambia la zona).
    const con = await pool.getConnection();
    try {
      await con.query("SET LOCAL TIME ZONE 'America/New_York'"); // fuera de transacción no persiste: SET de verdad
      await con.query("SET TIME ZONE 'America/New_York'");
      const [[otra]] = await con.query('SELECT ?::timestamptz AS vuelta', [instante]);
      assert.equal(otra.vuelta.toISOString(), instante.toISOString());
    } finally {
      con.release();
    }
  } finally {
    await pool.end();
  }
});

test('una migración que falla a medias no deja nada y la huella protege las ya aplicadas', async (t) => {
  if (!(await crearBdVacia(t))) return;
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'iemec-migraciones-'));
  fs.writeFileSync(path.join(carpeta, '001-buena.sql'), 'CREATE TABLE prueba_a (id INTEGER PRIMARY KEY);');
  fs.writeFileSync(path.join(carpeta, '002-rota.sql'), 'CREATE TABLE prueba_b (id INTEGER PRIMARY KEY); INSERT INTO prueba_b VALUES (1), (1);');
  const pool = db.crearPool({ database: BD_PRUEBAS.database });
  try {
    await assert.rejects(migrar({ bd: BD_PRUEBAS, carpeta, log: () => {} }), (err) => err.code === 'ER_DUP_ENTRY');
    const nombres = (await tablas(pool)).map((f) => f.nombre);
    assert.ok(nombres.includes('prueba_a'), 'la primera migración queda aplicada');
    assert.ok(!nombres.includes('prueba_b'), 'de la rota no queda ni la tabla');
    const [anotadas] = await pool.query('SELECT nombre FROM _migraciones ORDER BY nombre');
    assert.deepEqual(anotadas.map((f) => f.nombre), ['001-buena.sql']);

    // Arreglada, se aplica; editada una ya aplicada, se para en seco.
    fs.writeFileSync(path.join(carpeta, '002-rota.sql'), 'CREATE TABLE prueba_b (id INTEGER PRIMARY KEY);');
    assert.deepEqual(await migrar({ bd: BD_PRUEBAS, carpeta, log: () => {} }), ['002-rota.sql']);
    fs.writeFileSync(path.join(carpeta, '001-buena.sql'), 'CREATE TABLE prueba_a (id INTEGER PRIMARY KEY, otra TEXT);');
    await assert.rejects(migrar({ bd: BD_PRUEBAS, carpeta, log: () => {} }), /ya estaba aplicada y ha cambiado/);
  } finally {
    await pool.end();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test('dos procesos que migran a la vez no se pisan', async (t) => {
  if (!(await crearBdVacia(t))) return;
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'iemec-migraciones-'));
  fs.writeFileSync(path.join(carpeta, '001-lenta.sql'), 'CREATE TABLE prueba_lenta (id INTEGER PRIMARY KEY); SELECT pg_sleep(0.5);');
  const pool = db.crearPool({ database: BD_PRUEBAS.database });
  try {
    const resultados = await Promise.all([1, 2, 3].map(() => migrar({ bd: BD_PRUEBAS, carpeta, log: () => {} })));
    assert.deepEqual(resultados.filter((r) => r.length).length, 1, 'solo uno la aplica; los demás esperan y la ven hecha');
    const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM _migraciones');
    assert.equal(Number(n.n), 1);
  } finally {
    await pool.end();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test('con el pooler en modo transacción las migraciones se niegan a arrancar', async () => {
  await assert.rejects(migrar({ bd: { ...BD_PRUEBAS, pooler: 'transaccion' }, log: () => {} }), /modo transacción/);
});

test('todas las tablas quedan con RLS y los roles de la API de datos de Supabase no ven nada', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  let admin;
  try {
    for (const f of await tablas(pool)) assert.equal(f.rls, 1, `la tabla ${f.nombre} no tiene RLS: añade ENABLE ROW LEVEL SECURITY en su migración`);

    // Como en Supabase: existen anon y authenticated. Se crean, se vuelve a pasar la 018 (es lo que haría
    // una base nueva de Supabase, donde ya existen al migrar) y se comprueba que no pueden nada. Hace
    // falta poder crear roles (en CI el usuario es el superusuario; en el portátil, ALTER ROLE iemec CREATEROLE).
    admin = await db.conectar({ ...BD_PRUEBAS, sentenciaMs: 0 });
    const { rows: [yo] } = await admin.crudo('SELECT rolcreaterole OR rolsuper AS puede FROM pg_roles WHERE rolname = current_user');
    if (!yo.puede && process.env.IEMEC_EXIGIR_BD !== '1') {
      t.diagnostic('el usuario de PostgreSQL no puede crear roles: la parte de anon y authenticated no se comprueba aquí (en CI sí)');
      return;
    }
    for (const rol of ['anon', 'authenticated']) {
      await admin.crudo(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${rol}') THEN CREATE ROLE ${rol} NOLOGIN; END IF; END $$`);
      await admin.crudo(`GRANT ${rol} TO CURRENT_USER`); // para poder ponerse en su piel con SET ROLE (un superusuario no lo necesita)
      await admin.crudo(`GRANT USAGE ON SCHEMA public TO ${rol}`);
      // Lo que hace Supabase al nacer una tabla: dársela entera a esos roles.
      await admin.crudo(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${rol}`);
    }
    const sql018 = fs.readFileSync(path.join(__dirname, '..', 'sql', '018-seguridad-supabase.sql'), 'utf8');
    await admin.crudo(sql018);
    await admin.crudo('CREATE TABLE public.tabla_nueva (id INTEGER PRIMARY KEY, dato TEXT)'); // creada después: los DEFAULT PRIVILEGES
    await admin.crudo("INSERT INTO pacientes (nombre, apellidos, telefono) VALUES ('Prueba', 'RLS', '+34600000000')");
    for (const rol of ['anon', 'authenticated']) {
      await admin.crudo(`SET ROLE ${rol}`);
      for (const tabla of ['pacientes', 'citas', '_migraciones', 'tabla_nueva']) {
        await assert.rejects(admin.crudo(`SELECT * FROM public.${tabla}`), (err) => err.pgCode === '42501', `${rol} no puede leer ${tabla}`);
        await assert.rejects(admin.crudo(`DELETE FROM public.${tabla}`), (err) => err.pgCode === '42501', `${rol} no puede borrar en ${tabla}`);
      }
      await assert.rejects(admin.crudo("SELECT nextval('pacientes_id_seq')"), (err) => err.pgCode === '42501', `${rol} no toca las secuencias`);
      await admin.crudo('RESET ROLE');
    }
  } finally {
    if (admin) {
      // Los roles son de la instancia, no de la base: se quitan (primero lo que les dio esta base) para no
      // dejar rastro en el PostgreSQL de quien prueba.
      await admin.crudo('RESET ROLE').catch(() => {});
      for (const rol of ['anon', 'authenticated']) {
        await admin.crudo(`DROP OWNED BY ${rol}`).catch(() => {});
        await admin.crudo(`DROP ROLE IF EXISTS ${rol}`).catch(() => {});
      }
      await admin.end();
    }
    await pool.end();
  }
});
