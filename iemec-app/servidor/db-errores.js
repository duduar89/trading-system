'use strict';
// Errores de PostgreSQL traducidos a lo que el código comprueba desde los tiempos de MariaDB
// (`err.code === 'ER_DUP_ENTRY'`, `err.errno === 1451`…). El error es el mismo objeto de pg, con
// sus campos (constraint, table, detail…), más:
//   · code     el nombre del error de MariaDB (si hay equivalente) o, si no, el SQLSTATE de siempre
//   · errno    el número de error de MariaDB (si hay equivalente)
//   · pgCode   el SQLSTATE original de PostgreSQL (23505, 40P01…)
//   · sqlState lo mismo que pgCode (los dos nombres, para quien comprobaba `err.sqlState`)
//   · sqlMessage el mensaje original
// Un fallo que no viene de PostgreSQL (conexión caída, tiempo agotado…) pasa tal cual.

// SQLSTATE → [code de MariaDB, errno]
const EQUIVALENCIAS = {
  '23505': ['ER_DUP_ENTRY', 1062],
  '40P01': ['ER_LOCK_DEADLOCK', 1213], // deadlock_detected
  '40001': ['ER_LOCK_DEADLOCK', 1213], // serialization_failure: también se repite la transacción
  '55P03': ['ER_LOCK_WAIT_TIMEOUT', 1205], // lock_not_available
  '22001': ['ER_DATA_TOO_LONG', 1406], // string_data_right_truncation
  '23502': ['ER_BAD_NULL_ERROR', 1048], // not_null_violation
  '23514': ['ER_CONSTRAINT_FAILED', 4025], // check_violation
  '42P01': ['ER_NO_SUCH_TABLE', 1146], // undefined_table
  '42703': ['ER_BAD_FIELD_ERROR', 1054], // undefined_column
  '42601': ['ER_PARSE_ERROR', 1064], // syntax_error
  '57014': ['ER_QUERY_INTERRUPTED', 1317], // query_canceled (también statement_timeout)
};

// Un error de verdad de PostgreSQL trae severity y un SQLSTATE de cinco caracteres.
const esErrorDeServidor = (err) => Boolean(err) && typeof err === 'object' && typeof err.severity === 'string' && /^[0-9A-Z]{5}$/.test(String(err.code));

// 23503 (foreign_key_violation) son dos errores distintos en MariaDB:
//   1452 ER_NO_REFERENCED_ROW_2 al insertar o cambiar una fila hija que apunta a algo que no existe
//   1451 ER_ROW_IS_REFERENCED_2 al borrar o cambiar una fila padre que aún usa otra tabla
function claveAjena(err) {
  const mensaje = String(err.message || '');
  const detalle = String(err.detail || '');
  const alBorrarOCambiarElPadre = /^update or delete on table/i.test(mensaje) || /is still referenced from table/i.test(detalle);
  return alBorrarOCambiarElPadre ? ['ER_ROW_IS_REFERENCED_2', 1451] : ['ER_NO_REFERENCED_ROW_2', 1452];
}

function traducirError(err) {
  if (!esErrorDeServidor(err) || err.pgCode) return err; // no es de PostgreSQL, o ya se tradujo
  const original = String(err.code);
  const [code, errno] = original === '23503' ? claveAjena(err) : EQUIVALENCIAS[original] || [null, null];
  err.pgCode = original;
  err.sqlState = original;
  err.sqlMessage = err.message;
  if (code) {
    err.code = code;
    err.errno = errno;
  }
  return err;
}

module.exports = { traducirError, esErrorDeServidor, EQUIVALENCIAS };
