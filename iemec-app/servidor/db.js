'use strict';
// Conexión a PostgreSQL (el del portátil o el de Supabase) con la misma forma de uso que tenía
// mysql2/promise: `const [filas] = await pool.query(sql, params)`, getConnection(),
// beginTransaction(), commit(), rollback(), release()… Así el código de los módulos casi no cambia.
// Qué hace y qué no hace, y la tabla de «en MariaDB hacías X, ahora haz Y»: docs/PORTE-POSTGRES.md.
//
// Todos los instantes son timestamptz y viajan en UTC; la hora de Madrid se calcula en el motor
// (motor/tiempo.js), así el cambio de hora nunca descoloca una cita y no importa la zona de la sesión.
//
// Compatible con el pooler de Supabase en modo TRANSACCIÓN: ni SET de sesión, ni sentencias preparadas
// con nombre, ni bloqueos de sesión (los de transacción, pg_advisory_xact_lock, sí). Solo las
// migraciones usan un bloqueo de sesión: van por conexión directa o por el pooler en modo sesión.
const pg = require('pg');
const config = require('./config');
const { adaptarSql } = require('./db-sql');
const { traducirError, esErrorDeServidor } = require('./db-errores');
const { esLocal, opcionesSsl } = require('./db-ssl');

const SAVEPOINT = 'iemec_sp';

// ── Tipos: lo que devuelve cada columna, como lo daba mysql2 ──────────────────────────────────
//   bigint → número (error si no cabe), numeric → cadena (como DECIMAL), boolean → 1 o 0,
//   timestamptz → Date, date → Date a medianoche UTC, time → cadena, json y jsonb → cadena sin
//   analizar (el código ya hace JSON.parse a mano: en MariaDB el JSON era texto).
// Son analizadores de ESTAS conexiones (la opción `types` de pg), nunca los globales de pg.
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const defecto = (oid, formato) => pg.types.getTypeParser(oid, formato);
const ANALIZADORES = {
  16: (v) => (v === 't' ? 1 : 0),
  20: (v) => {
    const n = Number(v);
    if (!Number.isSafeInteger(n)) throw new RangeError(`El entero ${v} no cabe en un número de JavaScript sin perder precisión (máximo ${Number.MAX_SAFE_INTEGER})`);
    return n;
  },
  114: (v) => v,
  3802: (v) => v,
  1700: (v) => v,
  1082: (v) => (FECHA.test(v) ? new Date(`${v}T00:00:00Z`) : defecto(1082, 'text')(v)),
  // timestamp sin zona (no se usa en el esquema): se lee como UTC, no como hora local del proceso.
  1114: (v) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v) ? new Date(`${v.replace(' ', 'T')}Z`) : defecto(1114, 'text')(v)),
};
const TIPOS = {
  getTypeParser: (oid, formato) => (formato !== 'binary' && ANALIZADORES[oid]) || defecto(oid, formato),
};

// ── Configuración de las conexiones ───────────────────────────────────────────────────────────
function modoPooler(bd) {
  const m = String(bd.pooler || 'auto').toLowerCase();
  if (!['auto', 'transaccion', 'sesion'].includes(m)) throw new Error(`DB_MODO_POOLER=${bd.pooler} no vale: usa auto, transaccion o sesion`);
  return m === 'auto' ? (Number(bd.port) === 6543 ? 'transaccion' : 'sesion') : m;
}

// Con el pooler en modo transacción, el tiempo máximo de una sentencia no puede ir como parámetro de
// arranque: lo pone beginTransaction() con SET LOCAL (ms) en cada transacción.
function sentenciaEnTransaccion(bd) {
  return modoPooler(bd) === 'transaccion' && Number(bd.sentenciaMs) > 0 ? Math.floor(Number(bd.sentenciaMs)) : 0;
}

// Las opciones de pg para UNA conexión. bd: como config.bd (host, port, user, password, database y
// lo demás), con lo que se quiera cambiar encima.
function opcionesDeConexion(bd = config.bd) {
  const o = {
    host: bd.host,
    port: Number(bd.port),
    user: bd.user,
    password: bd.password,
    database: bd.database,
    // Siempre explícito: así ni PGSSLMODE ni nada del entorno puede quitar la verificación.
    ssl: opcionesSsl({ host: bd.host, modo: bd.ssl, ca: bd.sslCa }),
    application_name: 'iemec-app',
    types: TIPOS,
    keepAlive: true,
    connectionTimeoutMillis: Number(bd.conexionMs) || 10000,
  };
  // El tiempo máximo de una sentencia va como parámetro de arranque, salvo con el pooler en modo
  // transacción: ahí no vale (Supabase: «Session-level statement timeout… cannot be used with
  // Supavisor in Transaction mode»). Entonces lo pone beginTransaction() con SET LOCAL en cada
  // transacción, y para lo demás vale el del rol (ALTER ROLE … SET statement_timeout; docs/PORTE-POSTGRES.md).
  const ms = Number(bd.sentenciaMs);
  if (ms > 0 && modoPooler(bd) !== 'transaccion') o.statement_timeout = ms;
  return o;
}

// Una conexión suelta de pg (sin conectar), con la misma configuración. Para quien necesita lo que el
// pool no da: las migraciones (bloqueo de sesión, varias sentencias de una vez) y crear o borrar bases.
function crearCliente(opciones = {}) {
  return new pg.Client(opcionesDeConexion({ ...config.bd, ...opciones }));
}

// ── Una conexión del pool, con el contrato de mysql2 ──────────────────────────────────────────
class Conexion {
  // contexto: { catalogo, sentenciaEnTransaccionMs } del pool (o de la conexión suelta) a la que pertenece.
  constructor(cliente, contexto, { prestada = false } = {}) {
    this._cliente = cliente;
    this._contexto = contexto;
    this._prestada = prestada; // la de pool.on('connection') o la suelta: release() no hace nada
    this._liberada = false;
    this._rota = false; // la conexión se cayó mientras la teníamos
    this._enTransaccion = false;
    this._savepoint = false; // hay un SAVEPOINT de sentencia sin soltar
    this._nSavepoints = 0;
    // Mientras la tenemos, el pool no escucha sus errores: si el servidor la corta entre dos consultas y
    // nadie escucha, el error tumbaría el proceso. Aquí se apunta, y la siguiente consulta falla con el
    // error de siempre.
    this._alError = () => { this._rota = true; };
    if (!prestada) cliente.on('error', this._alError);
    // En una transacción, cada INSERT, UPDATE o DELETE es atómico por sí mismo, como en MariaDB: si falla
    // (una clave repetida, una clave ajena…), se deshace esa sentencia y la transacción sigue viva.
    // PostgreSQL, sin esto, la da por rota. Cuesta una ida y vuelta más por sentencia: se puede quitar
    // en una carga masiva (con.sentenciasAtomicas = false) o en una sentencia ({ sql, values, atomica: false }).
    this.sentenciasAtomicas = true;
  }

  // pg a pelo, sin pasar por adaptarSql ni por los savepoints: con $1, $2…, o sin parámetros y con varias
  // sentencias de una vez (migraciones). Devuelve el resultado de pg; traduce el error como siempre.
  async crudo(texto, valores) {
    try {
      return await this._cliente.query(valores ? { text: texto, values: valores } : texto);
    } catch (err) {
      throw traducirError(err);
    }
  }

  async query(sql, params) {
    let opciones = {};
    if (sql !== null && typeof sql === 'object' && !Array.isArray(sql)) { // query({ sql, values }), como mysql2
      const { sql: texto, values, ...resto } = sql;
      sql = texto;
      params = params === undefined ? values : params;
      opciones = resto;
    }
    if (this._liberada) throw new Error('Esta conexión ya se ha liberado: no se puede usar');
    const a = adaptarSql(sql, params);
    let texto = a.text;
    let pideId = false;
    // insertId: si la tabla tiene una columna id generada, se le pide al INSERT que la devuelva.
    if (a.textoConId && a.tabla && await this._contexto.catalogo.tieneId(this, a.tabla)) {
      texto = a.textoConId;
      pideId = true;
    }
    const protegida = this._enTransaccion && a.modifica && this.sentenciasAtomicas && opciones.atomica !== false;
    if (protegida) await this._abrirSavepoint();
    let r;
    try {
      r = await this._cliente.query(a.values.length ? { text: texto, values: a.values } : texto);
    } catch (err) {
      if (protegida) {
        // Se deshace solo esta sentencia; si ni eso se puede (conexión rota), el rollback de quien llama manda.
        try { await this._cliente.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`); } catch { /* conexión rota */ }
      }
      throw traducirError(err);
    }
    return resultadoComoMysql(a, r, pideId);
  }

  execute(sql, params) { return this.query(sql, params); }

  async _abrirSavepoint() {
    // El de la sentencia anterior se suelta en el mismo viaje: así son dos idas y vueltas por sentencia, no tres.
    await this.crudo(this._savepoint ? `RELEASE SAVEPOINT ${SAVEPOINT}; SAVEPOINT ${SAVEPOINT}` : `SAVEPOINT ${SAVEPOINT}`);
    this._savepoint = true;
  }

  async beginTransaction() {
    if (this._enTransaccion) throw new Error('Ya hay una transacción abierta en esta conexión');
    // Con el pooler en modo transacción el tiempo de las sentencias se fija aquí, con SET LOCAL (que vale
    // solo para esta transacción) y en el mismo viaje que el BEGIN.
    const ms = this._contexto.sentenciaEnTransaccionMs;
    await this.crudo(ms ? `BEGIN; SET LOCAL statement_timeout = ${ms}` : 'BEGIN');
    this._enTransaccion = true;
    this._savepoint = false;
  }

  async commit() {
    const r = await this.crudo('COMMIT');
    this._enTransaccion = false;
    this._savepoint = false;
    // COMMIT sobre una transacción que un error dejó rota no falla: devuelve ROLLBACK y lo deshace todo.
    if (r.command === 'ROLLBACK') throw new Error('La transacción se había roto por un error anterior (capturado y seguido) y se ha deshecho entera: no se ha guardado nada');
  }

  async rollback() {
    await this.crudo('ROLLBACK');
    this._enTransaccion = false;
    this._savepoint = false;
  }

  // Un trozo de la transacción que se deshace o se mantiene entero: con.savepoint(async () => { … }).
  // Si fn lanza, se deshace lo que hiciera y el error sigue su camino; la transacción queda viva.
  async savepoint(fn) {
    if (!this._enTransaccion) throw new Error('savepoint() solo vale dentro de una transacción');
    const nombre = `iemec_sv_${++this._nSavepoints}`;
    await this.crudo(`SAVEPOINT ${nombre}`);
    this._savepoint = false; // soltar o deshacer este se lleva por delante el de la sentencia, si lo había
    try {
      const r = await fn(this);
      await this.crudo(`RELEASE SAVEPOINT ${nombre}`);
      this._savepoint = false;
      return r;
    } catch (err) {
      try { await this._cliente.query(`ROLLBACK TO SAVEPOINT ${nombre}`); } catch { /* conexión rota */ }
      this._savepoint = false;
      throw err;
    }
  }

  // Serializa por una clave de texto hasta el final de la transacción (pg_advisory_xact_lock: vale con el
  // pooler en modo transacción). Con varias claves, las coge siempre en el mismo orden: no hay
  // interbloqueo. PostgreSQL no tiene bloqueos de hueco: para «nadie más a la vez en esto» y sin fila
  // a la que echar el cerrojo, esto o un SELECT … FOR UPDATE de una fila padre.
  async bloquear(...claves) {
    if (!this._enTransaccion) throw new Error('bloquear() solo vale dentro de una transacción');
    for (const clave of [...new Set(claves.map(String))].sort()) {
      await this.query('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [clave]);
    }
  }

  release() {
    if (this._liberada || this._prestada) return;
    this._liberada = true;
    this._cliente.removeListener('error', this._alError);
    // Con una transacción abierta (alguien no hizo commit ni rollback) o una conexión caída, no vuelve al
    // pool: se cierra (y el servidor deshace lo que hubiera). Nunca se presta una conexión a medias.
    this._cliente.release(this._enTransaccion || this._rota ? true : undefined);
  }
}

// El resultado de pg con la forma de mysql2:
//   SELECT, WITH, SHOW…        → [filas, campos]
//   con RETURNING escrito      → [filas]
//   INSERT, UPDATE, DELETE     → [{ insertId, affectedRows, changedRows, warningStatus: 0 }, undefined]
function resultadoComoMysql(a, r, pideId) {
  if (Array.isArray(r)) return [r.map((x) => (x.fields?.length ? x.rows : confirmacion(a, x, false))), r.map((x) => x.fields)]; // varias sentencias de una vez
  if (a.tieneReturning) return [r.rows];
  if (pideId) return [confirmacion(a, r, true), undefined];
  if (r.fields?.length) return [r.rows, r.fields];
  return [confirmacion(a, r, false), undefined];
}

function confirmacion(a, r, pideId) {
  const filas = r.rowCount ?? 0;
  return {
    insertId: pideId && r.rows?.length ? Number(r.rows[0].id) : 0,
    affectedRows: filas,
    changedRows: a.tipo === 'update' ? filas : 0,
    warningStatus: 0,
  };
}

// ── Qué tablas tienen una columna id generada (para el insertId) ──────────────────────────────
// Se mira en el catálogo, una vez por pool (o por conexión suelta) y para todas las tablas; si aparece
// una que no estaba (creada después), se vuelve a mirar. Va por la misma conexión que el INSERT: con un
// pool de una sola conexión, pedir otra sería esperarse a sí mismo.
class CatalogoDeIds {
  constructor() {
    this._datos = null; // { ruta: ['public'], tablas: Map('esquema.tabla' → bool) }
    this._carga = null;
  }

  async tieneId(con, tabla) {
    let v = this._buscar(tabla);
    if (v === undefined) {
      await this._cargar(con);
      v = this._buscar(tabla);
    }
    return Boolean(v);
  }

  _buscar({ esquema, nombre }) {
    if (!this._datos) return undefined;
    for (const e of esquema ? [esquema] : this._datos.ruta) {
      const v = this._datos.tablas.get(`${e}.${nombre}`);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  async _cargar(con) {
    if (!this._carga) {
      this._carga = con.crudo(
        `SELECT n.nspname AS esquema, c.relname AS tabla, current_schemas(false)::text[] AS ruta,
                EXISTS (SELECT 1 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                         WHERE a.attrelid = c.oid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped
                           AND (a.attidentity <> '' OR pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%')) AS auto
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'`)
        .then((r) => {
          // Los boolean llegan como 1 o 0 (ver ANALIZADORES).
          this._datos = { ruta: r.rows[0]?.ruta || ['public'], tablas: new Map(r.rows.map((f) => [`${f.esquema}.${f.tabla}`, Boolean(f.auto)])) };
        })
        .finally(() => { this._carga = null; });
    }
    await this._carga;
  }
}

// ── El pool ───────────────────────────────────────────────────────────────────────────────────
class Pool {
  constructor(bd) {
    this.bd = bd;
    const opciones = {
      ...opcionesDeConexion(bd),
      max: Math.max(1, Number(bd.conexiones) || 5),
      idleTimeoutMillis: Number(bd.inactivaMs) >= 0 ? Number(bd.inactivaMs) : 10000,
      allowExitOnIdle: true, // un script que olvida cerrar el pool no se queda colgado
    };
    this.pg = new pg.Pool(opciones);
    // Un error de una conexión inactiva (el servidor la cierra, se cae la red) no puede tumbar el
    // proceso: pg la quita del pool y la siguiente consulta abre otra.
    this.pg.on('error', () => {});
    this._contexto = { catalogo: new CatalogoDeIds(), sentenciaEnTransaccionMs: sentenciaEnTransaccion(bd) };
  }

  async getConnection() {
    let cliente;
    try {
      cliente = await this.pg.connect();
    } catch (err) {
      throw traducirError(err);
    }
    return new Conexion(cliente, this._contexto);
  }

  async query(sql, params) {
    const con = await this.getConnection();
    try {
      return await con.query(sql, params);
    } finally {
      con.release();
    }
  }

  execute(sql, params) { return this.query(sql, params); }

  // pool.on('connection', (con) => …): para cada conexión nueva, antes de usarla (como mysql2). Lo demás
  // (error, etc.) se acepta y no hace nada.
  on(evento, fn) {
    if (evento === 'connection' || evento === 'connect') this.pg.on('connect', (cliente) => fn(new Conexion(cliente, this._contexto, { prestada: true })));
    return this;
  }

  async end() {
    await this.pg.end();
  }
}

// Una conexión propia, fuera del pool y ya conectada, con el contrato de mysql2 (query con ?, insertId…)
// y `cliente` (el de pg) para lo que pide pg a pelo: varias sentencias de una vez, bloqueos de sesión.
// Se cierra con con.end(). La usan las migraciones y las pruebas que crean o borran bases.
async function conectar(opciones = {}) {
  const bd = { ...config.bd, ...opciones };
  const cliente = new pg.Client(opcionesDeConexion(bd));
  cliente.on('error', () => {}); // si se cae, la siguiente consulta falla con su error
  try {
    await cliente.connect();
  } catch (err) {
    throw traducirError(err);
  }
  const con = new Conexion(cliente, { catalogo: new CatalogoDeIds(), sentenciaEnTransaccionMs: sentenciaEnTransaccion(bd) }, { prestada: true });
  con.cliente = cliente;
  con.end = () => cliente.end();
  return con;
}

function crearPool(opciones = {}) {
  const { connectionLimit, ...resto } = opciones; // el nombre que tenía en mysql2
  return new Pool({ ...config.bd, ...(connectionLimit ? { conexiones: connectionLimit } : {}), ...resto });
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
  if (poolCompartido) {
    const p = poolCompartido;
    poolCompartido = null;
    await p.end();
  }
}

module.exports = { crearPool, pool, transaccion, cerrar, adaptarSql, conectar, crearCliente, opcionesDeConexion, modoPooler, traducirError, esErrorDeServidor, esLocal, opcionesSsl, TIPOS };
