'use strict';
// Del SQL «al estilo mysql2» al de PostgreSQL. Función pura: no toca la base.
//
//   adaptarSql('SELECT * FROM citas WHERE id IN (?) AND estado = ?', [[1, 2, 3], 'confirmada'])
//   → { text: 'SELECT * FROM citas WHERE id IN ($1, $2, $3) AND estado = $4', values: [1, 2, 3, 'confirmada'], … }
//
// Lo que hace, igual que mysql2:
//   · cada ? pasa a $n, sin tocar los que están dentro de un texto ('…'), de un identificador
//     entrecomillado ("…"), de un comentario (-- … y /* … */) ni de un texto entre dólares ($$…$$)
//   · un array se expande en una lista (IN (?) → IN ($1, $2, $3)) y un array de arrays, en filas
//     (VALUES ? → VALUES ($1, $2), ($3, $4))
//   · un objeto después de SET (UPDATE t SET ? WHERE …, INSERT INTO t SET ?) pasa a columna = valor
// Y lo que mysql2 no hacía, para que PostgreSQL no dé sorpresas:
//   · un parámetro undefined, un array vacío o parámetros de más o de menos lanzan error (mysql2 los
//     dejaba pasar y se acababa guardando un NULL o rompiendo más adelante)
//   · `? IS NULL` pasa a `$1::text IS NULL`: PostgreSQL no sabe de qué tipo es un parámetro que solo se
//     mira si es nulo
//   · una fecha viaja siempre en UTC (ISO 8601), sea cual sea la zona del proceso
// Si se pasa SQL sin parámetros (params undefined), el texto no se toca: los ? se quedan como están.
//
// Con el análisis del texto devuelve también lo que db.js necesita para dar el resultado como mysql2:
//   tipo ('select', 'insert', 'update', 'delete', 'merge' u 'otro'), modifica (¿escribe?), tabla (en un
//   INSERT, { esquema, nombre }), tieneReturning y textoConId (el INSERT con RETURNING id al final).
//
// Fuera de alcance, a propósito: los operadores ? de jsonb (usa jsonb_exists…) y los marcadores ?? de
// identificadores de mysql2 (ya no se usan).

class ErrorDeSql extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorDeSql';
    // Como un error de sintaxis de la base: el código que distingue «error de la base» de «fallo de
    // configuración» (estados-cita.js) lo trata como lo primero, y rompe en vez de seguir.
    this.code = 'ER_PARSE_ERROR';
    this.errno = 1064;
    this.sqlState = '42000';
  }
}

const DML = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE']);
const PRINCIPALES = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'VALUES', 'TABLE']);
const INICIO_ID = /[A-Za-z_\u0080-￿]/;
const RESTO_ID = /[A-Za-z0-9_$\u0080-￿]/;
const ETIQUETA_DOLAR = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;
const COLUMNA = /^[a-z_][a-z0-9_]*$/;
const PREFIJOS_DE_TEXTO = new Set(['E', 'B', 'X', 'N']);

// ── Análisis léxico ──────────────────────────────────────────────────────────────────────────
// Trozos: ws (espacios), com (comentario), pal (palabra o palabra clave), idq (identificador
// entrecomillado), str (texto), num, ph (el marcador ?), nat (un $1 de PostgreSQL) y op (el resto,
// de uno en uno).
function tokenizar(sql) {
  const tokens = [];
  const n = sql.length;
  let i = 0;
  const poner = (k, fin) => { tokens.push({ k, t: sql.slice(i, fin) }); i = fin; };
  // Texto entre comillas simples; con escapes de barra solo si lleva el prefijo E.
  const finDeTexto = (desde, conEscapes) => {
    let j = desde + 1;
    while (j < n) {
      const c = sql[j];
      if (conEscapes && c === '\\') { j += 2; continue; }
      if (c === "'") {
        if (sql[j + 1] === "'") { j += 2; continue; }
        return j + 1;
      }
      j++;
    }
    return n; // sin cerrar: que lo diga la base
  };
  const finDeIdentificador = (desde, comilla) => {
    let j = desde + 1;
    while (j < n) {
      if (sql[j] === comilla) {
        if (sql[j + 1] === comilla) { j += 2; continue; }
        return j + 1;
      }
      j++;
    }
    return n;
  };
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) {
      let j = i + 1;
      while (j < n && /\s/.test(sql[j])) j++;
      poner('ws', j);
    } else if (c === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i);
      poner('com', j === -1 ? n : j);
    } else if (c === '/' && sql[i + 1] === '*') {
      let prof = 1;
      let j = i + 2;
      while (j < n && prof > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { prof++; j += 2; } else if (sql[j] === '*' && sql[j + 1] === '/') { prof--; j += 2; } else j++;
      }
      poner('com', j);
    } else if (c === "'") {
      poner('str', finDeTexto(i, false));
    } else if (c === '"' || c === '`') {
      poner('idq', finDeIdentificador(i, c));
    } else if (c === '$') {
      const num = /^\$\d+/.exec(sql.slice(i, i + 12));
      const dolar = num ? null : ETIQUETA_DOLAR.exec(sql.slice(i, i + 80));
      if (num) {
        poner('nat', i + num[0].length);
      } else if (dolar) {
        const cierre = sql.indexOf(dolar[0], i + dolar[0].length);
        poner('str', cierre === -1 ? n : cierre + dolar[0].length);
      } else {
        poner('op', i + 1);
      }
    } else if (c === '?') {
      poner('ph', i + 1);
    } else if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < n && sql[j] >= '0' && sql[j] <= '9') j++;
      poner('num', j);
    } else if (INICIO_ID.test(c)) {
      let j = i + 1;
      while (j < n && RESTO_ID.test(sql[j])) j++;
      // E'…' (con escapes), B'…', X'…' y N'…': el prefijo y el texto van juntos.
      if (j - i === 1 && PREFIJOS_DE_TEXTO.has(c.toUpperCase()) && sql[j] === "'") poner('str', finDeTexto(j, c.toUpperCase() === 'E'));
      else poner('pal', j);
    } else {
      poner('op', i + 1);
    }
  }
  return tokens;
}

const esIgnorable = (t) => t.k === 'ws' || t.k === 'com';

// El nombre de una tabla a partir de una posición: nombre o esquema.nombre, con o sin comillas.
function leerNombre(tokens, desde) {
  const partes = [];
  let i = desde;
  for (;;) {
    while (i < tokens.length && esIgnorable(tokens[i])) i++;
    const t = tokens[i];
    if (!t || (t.k !== 'pal' && t.k !== 'idq')) return null;
    partes.push(t.k === 'pal' ? t.t.toLowerCase() : t.t.slice(1, -1).replace(/""/g, '"'));
    let j = i + 1;
    while (j < tokens.length && esIgnorable(tokens[j])) j++;
    if (tokens[j]?.k === 'op' && tokens[j].t === '.') { i = j + 1; continue; }
    break;
  }
  return partes.length >= 2 ? { esquema: partes[partes.length - 2], nombre: partes[partes.length - 1] } : { esquema: null, nombre: partes[0] };
}

function analizar(sql) {
  const tokens = tokenizar(sql);
  // Posiciones de los tokens que importan, con su profundidad de paréntesis.
  const sig = [];
  let prof = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (esIgnorable(t)) continue;
    if (t.k === 'op' && t.t === ')') prof = Math.max(0, prof - 1);
    sig.push({ i, prof, mayus: t.k === 'pal' ? t.t.toUpperCase() : null, op: t.k === 'op' ? t.t : null, k: t.k });
    if (t.k === 'op' && t.t === '(') prof++;
  }
  const primero = sig.find((s) => s.mayus)?.mayus || '';
  let tipo = 'otro';
  let principal = null; // la posición (en sig) de la sentencia principal
  let modifica = false;
  if (['SELECT', 'VALUES', 'TABLE', 'SHOW', 'EXPLAIN'].includes(primero)) tipo = 'select';
  else if (DML.has(primero)) tipo = primero.toLowerCase();
  if (primero === 'WITH') {
    // La sentencia principal es la primera palabra clave a profundidad 0 tras las CTE.
    const p = sig.findIndex((s, k) => k > 0 && s.prof === 0 && s.mayus && PRINCIPALES.has(s.mayus));
    if (p !== -1) {
      principal = p;
      tipo = DML.has(sig[p].mayus) ? sig[p].mayus.toLowerCase() : 'select';
    }
    // Una CTE que escribe (WITH x AS (DELETE … RETURNING …) SELECT …) también modifica.
    modifica = sig.some((s, k) => k > 0 && s.mayus && DML.has(s.mayus) && sig[k - 1].op === '(');
  } else if (tipo === 'insert' || tipo === 'update' || tipo === 'delete' || tipo === 'merge') {
    principal = sig.findIndex((s) => s.mayus === primero);
  }
  if (DML.has(tipo.toUpperCase())) modifica = true;
  const tieneReturning = modifica && sig.some((s) => s.prof === 0 && s.mayus === 'RETURNING');

  // La tabla de un INSERT: lo que sigue a INTO.
  let tabla = null;
  if (tipo === 'insert' && principal !== null) {
    const into = sig.findIndex((s, k) => k > principal && s.prof === 0 && s.mayus === 'INTO');
    if (into !== -1) tabla = leerNombre(tokens, sig[into].i + 1);
  }

  // Los marcadores: cuáles van seguidos de IS [NOT] NULL y cuáles van tras un SET (y si ese SET es el
  // de INSERT INTO t SET ?, que va antes de cualquier VALUES, SELECT u ON CONFLICT).
  const marcadores = [];
  let nativos = 0;
  for (let k = 0; k < sig.length; k++) {
    const s = sig[k];
    if (s.k === 'nat') nativos++;
    if (s.k !== 'ph') continue;
    const m = { i: s.i, esNulo: false, trasSet: null, insertSet: false };
    const siguiente = (d) => sig[k + d]?.mayus;
    if (siguiente(1) === 'IS' && (siguiente(2) === 'NULL' || (siguiente(2) === 'NOT' && siguiente(3) === 'NULL'))) m.esNulo = true;
    if (sig[k - 1]?.mayus === 'SET') {
      m.trasSet = sig[k - 1].i;
      m.insertSet = tipo === 'insert' && !sig.slice(0, k).some((x) => x.mayus === 'VALUES' || x.mayus === 'SELECT' || x.mayus === 'ON');
    }
    marcadores.push(m);
  }

  // Dónde acaba el texto «de verdad»: sin el ; final ni comentarios, para poder añadirle RETURNING.
  let fin = sig.length - 1;
  if (fin >= 0 && sig[fin].op === ';') fin--;
  const ultimo = fin >= 0 ? sig[fin].i : -1;
  return { tokens, tipo, modifica, tabla, tieneReturning, marcadores, nativos, ultimo };
}

// El análisis de un texto no cambia: se guarda (las consultas son casi siempre las mismas). Acotado,
// por si alguna se construye con trozos distintos cada vez.
const CACHE = new Map();
const CACHE_MAX = 2000;
function analisis(sql) {
  let a = CACHE.get(sql);
  if (!a) {
    a = analizar(sql);
    if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
    CACHE.set(sql, a);
  }
  return a;
}

// ── Valores ──────────────────────────────────────────────────────────────────────────────────
const cuantos = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const esObjetoPlano = (v) => v !== null && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

// Un valor suelto, listo para pg: null, texto, número, booleano, Buffer o fecha en ISO 8601 (UTC).
function prepararValor(v, donde) {
  if (v === undefined) throw new ErrorDeSql(`${donde} es undefined: usa null para NULL`);
  if (v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString(); // como mysql2: una fecha inválida es NULL
  switch (typeof v) {
    case 'string': case 'boolean': return v;
    case 'number':
      if (!Number.isFinite(v)) throw new ErrorDeSql(`${donde} es ${v}: no es un número que la base acepte`);
      return v;
    case 'bigint': return v.toString();
    default: break;
  }
  if (Buffer.isBuffer(v)) return v;
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) throw new ErrorDeSql(`${donde} es un array dentro de otro array: solo se admiten listas de valores y listas de filas`);
  throw new ErrorDeSql(`${donde} es ${typeof v === 'object' ? 'un objeto' : typeof v}: serialízalo (JSON.stringify) o usa un valor simple`);
}

function adaptarSql(sql, params) {
  if (typeof sql !== 'string') throw new ErrorDeSql('El SQL tiene que ser un texto');
  const a = analisis(sql);
  const lista = params === undefined || params === null ? undefined : Array.isArray(params) ? params : [params];
  const salida = a.tokens.map((t) => t.t);
  const values = [];
  const poner = (v, donde) => { values.push(prepararValor(v, donde)); return `$${values.length}`; };

  if (a.marcadores.length && lista !== undefined) {
    if (a.nativos) throw new ErrorDeSql('El SQL mezcla marcadores ? y $1: usa solo una forma');
    a.marcadores.forEach((m, k) => {
      if (k >= lista.length) throw new ErrorDeSql(`Faltan parámetros: el SQL tiene ${cuantos(a.marcadores.length, 'marcador', 'marcadores')} ? y solo se ${lista.length === 1 ? 'ha pasado 1' : `han pasado ${lista.length}`}`);
      const v = lista[k];
      const donde = `El parámetro ${k + 1}`;
      if (Array.isArray(v)) {
        if (!v.length) throw new ErrorDeSql(`${donde} es un array vacío: IN () no es SQL válido; comprueba antes que haya elementos`);
        if (v.every(Array.isArray)) {
          if (v.some((fila) => !fila.length)) throw new ErrorDeSql(`${donde} lleva una fila vacía`);
          salida[m.i] = v.map((fila) => `(${fila.map((x) => poner(x, `${donde} (en una fila)`)).join(', ')})`).join(', ');
        } else if (v.some(Array.isArray)) {
          throw new ErrorDeSql(`${donde} mezcla valores y arrays: o una lista de valores o una lista de filas`);
        } else {
          salida[m.i] = v.map((x) => poner(x, `${donde} (en una lista)`)).join(', ');
        }
      } else if (esObjetoPlano(v)) {
        if (m.trasSet === null) throw new ErrorDeSql(`${donde} es un objeto y solo se admite justo después de SET (UPDATE … SET ?, INSERT … SET ?)`);
        const claves = Object.keys(v);
        if (!claves.length) throw new ErrorDeSql(`${donde} es un objeto vacío: no hay columnas que poner`);
        for (const c of claves) if (!COLUMNA.test(c)) throw new ErrorDeSql(`${donde}: «${c}» no es un nombre de columna válido (minúsculas y guiones bajos)`);
        if (m.insertSet) {
          salida[m.trasSet] = ''; // INSERT INTO t SET ? → INSERT INTO t (a, b) VALUES ($1, $2)
          salida[m.i] = `(${claves.map((c) => `"${c}"`).join(', ')}) VALUES (${claves.map((c) => poner(v[c], `${donde}.${c}`)).join(', ')})`;
        } else {
          salida[m.i] = claves.map((c) => `"${c}" = ${poner(v[c], `${donde}.${c}`)}`).join(', ');
        }
      } else {
        salida[m.i] = poner(v, donde) + (m.esNulo ? '::text' : '');
      }
    });
    if (lista.length > a.marcadores.length) throw new ErrorDeSql(`Sobran parámetros: el SQL tiene ${cuantos(a.marcadores.length, 'marcador', 'marcadores')} ? y se han pasado ${lista.length}`);
  } else if (lista !== undefined && lista.length) {
    if (!a.nativos) throw new ErrorDeSql(`Sobran parámetros: el SQL no tiene marcadores y se han pasado ${lista.length}`);
    // Con $1, $2… el SQL manda: los arrays van tal cual (ANY($1::int[])), y pg los convierte.
    lista.forEach((v, k) => values.push(Array.isArray(v) ? v.map((x) => prepararValor(x, `El parámetro ${k + 1}`)) : prepararValor(v, `El parámetro ${k + 1}`)));
  }

  const text = salida.join('');
  const conId = a.tipo === 'insert' && !a.tieneReturning && a.ultimo >= 0 ? `${salida.slice(0, a.ultimo + 1).join('')}\nRETURNING id` : null;
  return { text, values, tipo: a.tipo, modifica: a.modifica, tabla: a.tabla, tieneReturning: a.tieneReturning, textoConId: conId };
}

module.exports = { adaptarSql, tokenizar, ErrorDeSql };
