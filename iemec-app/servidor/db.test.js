'use strict';
// La capa de base de datos sobre PostgreSQL con el contrato de mysql2: adaptarSql (pura) y, contra un
// PostgreSQL de verdad, lo que el código da por hecho desde los tiempos de MariaDB (insertId,
// affectedRows, 0/1 en los booleanos, fechas en UTC, errores traducidos, transacciones y bloqueos).
const test = require('node:test');
const assert = require('node:assert/strict');
const { adaptarSql, ErrorDeSql } = require('./db-sql');
const { traducirError } = require('./db-errores');
const { esLocal, opcionesSsl } = require('./db-ssl');
const db = require('./db');
const { crearBdVacia, BD_PRUEBAS } = require('../test/ayuda-bd');

test('adaptarSql: ? → $n respetando textos, identificadores, comentarios y dólares', () => {
  const a = adaptarSql("SELECT * FROM t WHERE a = ? AND b = '¿?' AND \"c?\" = ? -- ¿?\n AND d = ? /* ? */ AND e = $$?$$", [1, 2, 3]);
  assert.equal(a.text, "SELECT * FROM t WHERE a = $1 AND b = '¿?' AND \"c?\" = $2 -- ¿?\n AND d = $3 /* ? */ AND e = $$?$$");
  assert.deepEqual(a.values, [1, 2, 3]);
  assert.equal(a.tipo, 'select');
  assert.equal(a.modifica, false);
});

test('adaptarSql: listas, filas, objetos tras SET, IS NULL y lo que no se admite', () => {
  assert.equal(adaptarSql('SELECT 1 FROM t WHERE id IN (?) AND x = ?', [[1, 2, 3], 'a']).text, 'SELECT 1 FROM t WHERE id IN ($1, $2, $3) AND x = $4');
  const filas = adaptarSql('INSERT INTO t (a, b) VALUES ?', [[[1, 'x'], [2, 'y']]]);
  assert.equal(filas.text, 'INSERT INTO t (a, b) VALUES ($1, $2), ($3, $4)');
  assert.deepEqual(filas.values, [1, 'x', 2, 'y']);
  assert.deepEqual(filas.tabla, { esquema: null, nombre: 't' });
  assert.equal(filas.textoConId, 'INSERT INTO t (a, b) VALUES ($1, $2), ($3, $4)\nRETURNING id');
  const set = adaptarSql('UPDATE t SET ? WHERE id = ?', [{ a: 1, b: null }, 7]);
  assert.equal(set.text, 'UPDATE t SET "a" = $1, "b" = $2 WHERE id = $3');
  assert.equal(adaptarSql('INSERT INTO t SET ?', [{ a: 1 }]).text, 'INSERT INTO t ("a") VALUES ($1)');
  assert.equal(adaptarSql('SELECT 1 WHERE ? IS NULL', [null]).text, 'SELECT 1 WHERE $1::text IS NULL');
  assert.equal(adaptarSql('INSERT INTO t (a) VALUES (?) RETURNING id', [1]).tieneReturning, true);
  assert.equal(adaptarSql('WITH x AS (DELETE FROM t RETURNING id) SELECT * FROM x').modifica, true);
  assert.equal(adaptarSql('SELECT ? AS fecha', [new Date('2026-10-06T12:05:00Z')]).values[0], '2026-10-06T12:05:00.000Z');
  assert.equal(adaptarSql('SELECT ?', ['a?b']).text, 'SELECT $1', 'un ? dentro de un parámetro no es un marcador');
  for (const [sql, params, motivo] of [
    ['SELECT ?', [undefined], /undefined/],
    ['SELECT ?', [[]], /array vacío/],
    ['SELECT ?, ?', [1], /Faltan parámetros/],
    ['SELECT ?', [1, 2], /Sobran parámetros/],
    ['SELECT ?', [{ a: 1 }], /justo después de SET/],
    ['UPDATE t SET ? WHERE 1', [{ 'a; DROP TABLE': 1 }, 1], /no es un nombre de columna/],
    ['SELECT ?', [Number.NaN], /no es un número/],
    ['SELECT ? AND $1', [1], /mezcla/],
  ]) {
    assert.throws(() => adaptarSql(sql, params), (err) => err instanceof ErrorDeSql && motivo.test(err.message), `${sql}: ${motivo}`);
  }
  // Sin parámetros, el texto no se toca (SQL de las migraciones con ? dentro de funciones).
  assert.equal(adaptarSql("SELECT '?'").text, "SELECT '?'");
});

test('traducirError: los SQLSTATE de PostgreSQL con los nombres de MariaDB que comprueba el código', () => {
  const pg = (code, extra = {}) => Object.assign(new Error('x'), { severity: 'ERROR', code, ...extra });
  assert.equal(traducirError(pg('23505')).code, 'ER_DUP_ENTRY');
  assert.equal(traducirError(pg('23505')).errno, 1062);
  assert.equal(traducirError(pg('40P01')).code, 'ER_LOCK_DEADLOCK');
  assert.equal(traducirError(pg('23503', { message: 'update or delete on table "salas" violates foreign key constraint', detail: 'Key (id)=(1) is still referenced from table "citas".' })).errno, 1451);
  assert.equal(traducirError(pg('23503', { message: 'insert or update on table "citas" violates foreign key constraint', detail: 'Key (sala_id)=(9) is not present in table "salas".' })).errno, 1452);
  const otro = traducirError(pg('XX000'));
  assert.equal(otro.code, 'XX000', 'sin equivalente, se queda el SQLSTATE');
  assert.equal(otro.pgCode, 'XX000');
  const ajeno = new Error('ECONNREFUSED');
  assert.equal(traducirError(ajeno), ajeno, 'un error que no es de PostgreSQL pasa tal cual');
});

test('db-ssl: lo que no es local va cifrado y verificado, sin excepciones', () => {
  assert.equal(esLocal('localhost'), true);
  assert.equal(esLocal('127.0.0.1'), true);
  assert.equal(esLocal('::1'), true);
  assert.equal(esLocal('db.abc.supabase.co'), false);
  assert.equal(opcionesSsl({ host: '127.0.0.1' }), false);
  const remoto = opcionesSsl({ host: 'db.abc.supabase.co' });
  assert.equal(remoto.rejectUnauthorized, true);
  assert.match(remoto.ca, /BEGIN CERTIFICATE/);
  assert.equal(opcionesSsl({ host: 'db.abc.supabase.co', ca: 'sistema' }).ca, undefined);
  assert.throws(() => opcionesSsl({ host: 'db.abc.supabase.co', modo: 'disable' }), /solo se admite con localhost/);
  assert.throws(() => opcionesSsl({ host: 'localhost', modo: 'loquesea' }), /no vale/);
  assert.equal(opcionesSsl({ host: 'localhost', modo: 'require' }).rejectUnauthorized, true);
});

test('contra PostgreSQL: resultados, tipos, errores, transacciones y bloqueos como los espera el código', async (t) => {
  if (!(await crearBdVacia(t))) return;
  const pool = db.crearPool({ database: BD_PRUEBAS.database, connectionLimit: 3 });
  try {
    await pool.query(`CREATE TABLE padres (id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, nombre VARCHAR(10) NOT NULL UNIQUE,
      activo BOOLEAN NOT NULL DEFAULT TRUE, grande BIGINT, precio NUMERIC(8,2), cuando TIMESTAMPTZ, dia DATE, datos TEXT, creado_en TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query('CREATE TABLE hijos (id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, padre_id INTEGER NOT NULL REFERENCES padres (id))');
    await pool.query('CREATE TABLE sin_id (clave TEXT PRIMARY KEY, valor TEXT)');

    await t.test('insertId, affectedRows y RETURNING', async () => {
      const [r] = await pool.query('INSERT INTO padres (nombre) VALUES (?)', ['a']);
      assert.equal(r.insertId, 1);
      assert.equal(r.affectedRows, 1);
      const [varios] = await pool.query('INSERT INTO padres (nombre) VALUES ?', [[['b'], ['c']]]);
      assert.equal(varios.insertId, 2, 'con varias filas, el primero');
      assert.equal(varios.affectedRows, 2);
      const [sinId] = await pool.query('INSERT INTO sin_id (clave, valor) VALUES (?, ?)', ['k', 'v']);
      assert.equal(sinId.insertId, 0);
      const [u] = await pool.query("UPDATE padres SET activo = FALSE WHERE nombre IN (?)", [['b', 'c']]);
      assert.equal(u.affectedRows, 2);
      assert.equal(u.changedRows, 2);
      const [d] = await pool.query("DELETE FROM padres WHERE nombre = ?", ['zzz']);
      assert.equal(d.affectedRows, 0);
      const [filas] = await pool.query("INSERT INTO padres (nombre) VALUES (?) RETURNING id, nombre", ['d']);
      assert.deepEqual(filas, [{ id: 4, nombre: 'd' }]);
      const [ignorado] = await pool.query("INSERT INTO padres (nombre) VALUES (?) ON CONFLICT (nombre) DO NOTHING", ['d']);
      assert.equal(ignorado.affectedRows, 0, 'INSERT … DO NOTHING: 0 filas, como INSERT IGNORE');
    });

    await t.test('tipos: 0/1, enteros grandes, decimales como texto, fechas en UTC, json como texto', async () => {
      const cuando = new Date('2026-03-29T01:30:00Z');
      await pool.query('UPDATE padres SET grande = ?, precio = ?, cuando = ?, dia = ?, datos = ? WHERE id = 1', [9007199254740991, '12.50', cuando, '2026-10-06', JSON.stringify({ a: 1 })]);
      const [[f]] = await pool.query('SELECT activo, grande, precio, cuando, dia, datos, creado_en FROM padres WHERE id = 1');
      assert.equal(f.activo, 1);
      assert.equal(f.grande, 9007199254740991);
      assert.equal(f.precio, '12.50');
      assert.equal(f.cuando.toISOString(), cuando.toISOString());
      assert.equal(f.dia.toISOString(), '2026-10-06T00:00:00.000Z');
      assert.equal(f.datos, '{"a":1}');
      assert.ok(f.creado_en instanceof Date);
      await pool.query('UPDATE padres SET grande = ? WHERE id = 1', ['9007199254740993']);
      await assert.rejects(pool.query('SELECT grande FROM padres WHERE id = 1'), RangeError, 'un bigint que no cabe no se lee a medias');
      const [[b]] = await pool.query('SELECT (1 = 1) AS si, (1 = 2) AS no, COUNT(*) AS n FROM padres');
      assert.deepEqual([b.si, b.no, typeof b.n], [1, 0, 'number']);
    });

    await t.test('errores traducidos: clave repetida, clave ajena en los dos sentidos', async () => {
      await assert.rejects(pool.query('INSERT INTO padres (nombre) VALUES (?)', ['a']), (err) => err.code === 'ER_DUP_ENTRY' && err.errno === 1062 && err.pgCode === '23505');
      await assert.rejects(pool.query('INSERT INTO hijos (padre_id) VALUES (?)', [999]), (err) => err.code === 'ER_NO_REFERENCED_ROW_2' && err.errno === 1452);
      await pool.query('INSERT INTO hijos (padre_id) VALUES (?)', [1]);
      await assert.rejects(pool.query('DELETE FROM padres WHERE id = ?', [1]), (err) => err.code === 'ER_ROW_IS_REFERENCED_2' && err.errno === 1451);
      await assert.rejects(pool.query('INSERT INTO padres (nombre) VALUES (?)', ['demasiado-largo']), (err) => err.code === 'ER_DATA_TOO_LONG');
      await assert.rejects(pool.query('SELECT * FROM no_existe'), (err) => err.code === 'ER_NO_SUCH_TABLE');
    });

    await t.test('transacciones: rollback deshace; un error en una sentencia no rompe la transacción', async () => {
      await assert.rejects(db.transaccion(async (con) => {
        await con.query('INSERT INTO padres (nombre) VALUES (?)', ['tx1']);
        throw new Error('me arrepiento');
      }, pool), /me arrepiento/);
      const [[n1]] = await pool.query("SELECT COUNT(*) AS n FROM padres WHERE nombre = 'tx1'");
      assert.equal(n1.n, 0);
      // Como en MariaDB: una clave repetida dentro de la transacción se captura y se sigue.
      const r = await db.transaccion(async (con) => {
        try {
          await con.query('INSERT INTO padres (nombre) VALUES (?)', ['a']);
        } catch (err) {
          assert.equal(err.code, 'ER_DUP_ENTRY');
        }
        const [ins] = await con.query('INSERT INTO padres (nombre) VALUES (?)', ['tx2']);
        return ins.insertId;
      }, pool);
      assert.ok(r > 0);
      const [[n2]] = await pool.query("SELECT COUNT(*) AS n FROM padres WHERE nombre = 'tx2'");
      assert.equal(n2.n, 1);
      // Una conexión devuelta con la transacción abierta no vuelve al pool a medias.
      const con = await pool.getConnection();
      await con.beginTransaction();
      await con.query('INSERT INTO padres (nombre) VALUES (?)', ['tx3']);
      con.release();
      const [[n3]] = await pool.query("SELECT COUNT(*) AS n FROM padres WHERE nombre = 'tx3'");
      assert.equal(n3.n, 0, 'lo que no se confirmó se ha deshecho');
    });

    await t.test('FOR UPDATE y bloquear(): dos transacciones sobre lo mismo van en fila', async () => {
      const orden = [];
      const una = async (etiqueta, ms) => db.transaccion(async (con) => {
        await con.bloquear('hueco:1');
        orden.push(`${etiqueta}:dentro`);
        await new Promise((r) => setTimeout(r, ms));
        orden.push(`${etiqueta}:fuera`);
      }, pool);
      await Promise.all([una('A', 150), new Promise((r) => setTimeout(r, 30)).then(() => una('B', 10))]);
      assert.deepEqual(orden, ['A:dentro', 'A:fuera', 'B:dentro', 'B:fuera']);
      await assert.rejects(pool.getConnection().then(async (con) => { try { await con.bloquear('x'); } finally { con.release(); } }), /solo vale dentro de una transacción/);
    });

    await t.test('SKIP LOCKED: una fila bloqueada no se la lleva otro', async () => {
      await pool.query("INSERT INTO sin_id (clave, valor) VALUES ('t1', 'pendiente'), ('t2', 'pendiente')");
      const a = await pool.getConnection();
      const b = await pool.getConnection();
      try {
        await a.beginTransaction();
        await b.beginTransaction();
        const [[fa]] = await a.query("SELECT clave FROM sin_id WHERE valor = 'pendiente' ORDER BY clave LIMIT 1 FOR UPDATE SKIP LOCKED");
        const [[fb]] = await b.query("SELECT clave FROM sin_id WHERE valor = 'pendiente' ORDER BY clave LIMIT 1 FOR UPDATE SKIP LOCKED");
        assert.notEqual(fa.clave, fb.clave);
        await a.rollback();
        await b.rollback();
      } finally {
        a.release();
        b.release();
      }
    });
  } finally {
    await pool.end();
  }
});
