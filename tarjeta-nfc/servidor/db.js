// Base de datos: esquema + acceso. SQLite embebido (node:sqlite, sin dependencias).
//
// Principio de diseño: el saldo NO se guarda como columna editable. La verdad es
// `movimientos`, una tabla de solo-anexado (libro mayor). El saldo se calcula
// sumando. Así ningún bug ni ningún empleado puede "pintar" puntos sin dejar
// rastro, y cualquier discrepancia se audita leyendo el libro.

import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ESQUEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clientes (
  id                       INTEGER PRIMARY KEY,
  nombre                   TEXT NOT NULL,
  telefono                 TEXT,
  email                    TEXT,
  fecha_nacimiento         TEXT,                      -- YYYY-MM-DD (bonus cumpleanos)
  consentimiento_marketing INTEGER NOT NULL DEFAULT 0,
  alta_ts                  TEXT NOT NULL,
  anonimizado_ts           TEXT                       -- RGPD art. 17, ver docs/05
);

CREATE TABLE IF NOT EXISTS tarjetas (
  id            INTEGER PRIMARY KEY,
  uid_hash      TEXT NOT NULL UNIQUE,                 -- HMAC(secreto, UID), nunca el UID en claro
  token         TEXT NOT NULL UNIQUE,                 -- 128 bits, es lo que va en la URL del NDEF
  cliente_id    INTEGER REFERENCES clientes(id),
  estado        TEXT NOT NULL DEFAULT 'activa',       -- activa | bloqueada | sustituida
  clave_424     TEXT,                                 -- AES-128 hex, solo si es NTAG424 DNA
  contador_424  INTEGER NOT NULL DEFAULT 0,           -- ultimo contador visto (anti-replay)
  alta_ts       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tarjetas_cliente ON tarjetas(cliente_id);

CREATE TABLE IF NOT EXISTS movimientos (
  id            INTEGER PRIMARY KEY,
  cliente_id    INTEGER NOT NULL REFERENCES clientes(id),
  tarjeta_id    INTEGER REFERENCES tarjetas(id),
  tipo          TEXT NOT NULL,                        -- acumular|canjear|ajuste|caducidad|alta
  puntos        INTEGER NOT NULL,                     -- con signo: +acumula, -canjea
  importe_cents INTEGER,
  concepto      TEXT,
  staff_id      INTEGER REFERENCES staff(id),
  local         TEXT,
  idem          TEXT UNIQUE,                          -- clave de idempotencia del dispositivo
  ts            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mov_cliente ON movimientos(cliente_id, ts);
CREATE INDEX IF NOT EXISTS idx_mov_ts ON movimientos(ts);

CREATE TABLE IF NOT EXISTS recompensas (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT NOT NULL,
  coste_puntos  INTEGER NOT NULL,
  activa        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS staff (
  id        INTEGER PRIMARY KEY,
  nombre    TEXT NOT NULL,
  pin_hash  TEXT NOT NULL,
  salt      TEXT NOT NULL,
  rol       TEXT NOT NULL DEFAULT 'mostrador',        -- mostrador | encargado
  activo    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sesiones (
  token      TEXT PRIMARY KEY,
  staff_id   INTEGER NOT NULL REFERENCES staff(id),
  expira_ts  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
`;

export function abrir(ruta = 'tarjetas.db') {
  const db = new DatabaseSync(ruta);
  db.exec(ESQUEMA);
  // El secreto de pseudonimizacion vive en la propia base: si alguien roba el
  // fichero se lleva ambos, pero evita que un volcado parcial (un CSV de
  // tarjetas exportado por error) contenga UIDs clonables.
  if (!leerAjuste(db, 'secreto_uid')) {
    guardarAjuste(db, 'secreto_uid', randomBytes(32).toString('hex'));
  }
  return db;
}

export const leerAjuste = (db, clave) =>
  db.prepare('SELECT valor FROM ajustes WHERE clave = ?').get(clave)?.valor ?? null;

export const guardarAjuste = (db, clave, valor) =>
  db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ' +
             'ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, valor);

/** UID del chip -> identificador estable no reversible. */
export function hashUid(db, uid) {
  const secreto = leerAjuste(db, 'secreto_uid');
  return createHmac('sha256', Buffer.from(secreto, 'hex'))
    .update(uid.toUpperCase().replace(/[^0-9A-F]/g, ''))
    .digest('hex');
}

export const nuevoToken = () => randomBytes(16).toString('base64url');

// --- PIN de empleado: scrypt, nunca en claro ---------------------------------

export function hashPin(pin, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(pin, salt, 32).toString('hex') };
}

export function pinCorrecto(pin, salt, hashEsperado) {
  const calculado = scryptSync(pin, salt, 32);
  const esperado = Buffer.from(hashEsperado, 'hex');
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

// --- Consultas de saldo ------------------------------------------------------

export function saldo(db, clienteId) {
  const fila = db.prepare('SELECT COALESCE(SUM(puntos), 0) AS s FROM movimientos WHERE cliente_id = ?')
    .get(clienteId);
  return Number(fila.s);
}

/** Puntos acumulados desde el ultimo canje: sirve para pintar "3 de 10 sellos". */
export function progresoSellos(db, clienteId, objetivo) {
  const s = saldo(db, clienteId);
  return { saldo: s, sellos: s % objetivo, objetivo, canjes_disponibles: Math.floor(s / objetivo) };
}

export function movimientos(db, clienteId, limite = 50) {
  return db.prepare(
    'SELECT id, tipo, puntos, importe_cents, concepto, ts FROM movimientos ' +
    'WHERE cliente_id = ? ORDER BY id DESC LIMIT ?').all(clienteId, limite);
}

export function tarjetaPorUid(db, uid) {
  return db.prepare('SELECT * FROM tarjetas WHERE uid_hash = ?').get(hashUid(db, uid));
}

export const tarjetaPorToken = (db, token) =>
  db.prepare('SELECT * FROM tarjetas WHERE token = ?').get(token);

export const cliente = (db, id) =>
  db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);

/**
 * Anota un movimiento. `idem` (clave de idempotencia) hace que reintentar la
 * misma operacion -- red que se cae, empleado que pulsa dos veces -- no duplique
 * puntos: la segunda vez devuelve el movimiento ya escrito.
 */
export const movimientoPorIdem = (db, idem) =>
  idem ? db.prepare('SELECT * FROM movimientos WHERE idem = ?').get(idem) ?? null : null;

export function anotar(db, mov) {
  const ts = mov.ts ?? new Date().toISOString();
  if (mov.idem) {
    const previo = db.prepare('SELECT * FROM movimientos WHERE idem = ?').get(mov.idem);
    if (previo) return { movimiento: previo, repetido: true };
  }
  const info = db.prepare(
    'INSERT INTO movimientos (cliente_id, tarjeta_id, tipo, puntos, importe_cents, concepto, staff_id, local, idem, ts) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(mov.cliente_id, mov.tarjeta_id ?? null, mov.tipo, mov.puntos,
        mov.importe_cents ?? null, mov.concepto ?? null, mov.staff_id ?? null,
        mov.local ?? null, mov.idem ?? null, ts);
  const movimiento = db.prepare('SELECT * FROM movimientos WHERE id = ?').get(info.lastInsertRowid);
  return { movimiento, repetido: false };
}
