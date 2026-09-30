'use strict';
// Copia consultable de los registros de la mesa en MariaDB (ARQUITECTURA-WEB W4).
//
//   sincronizar(config, opciones?) → { copiados, fuentes }
//
// Lee los JSONL de config.carpetaDatos desde donde se quedó la vez anterior y
// los añade a mesa_registros, una fila por línea con su número de línea. Los
// latidos van además a mesa_latidos (id = número de línea).
//
// Reglas:
// - Idempotente: (fuente, linea) es único y se inserta con ON DUPLICATE KEY
//   UPDATE. Copiar dos veces, perder data/espejo.json o cortarse entre el
//   INSERT y el guardado de posiciones deja las mismas filas.
// - Posiciones en data/espejo.json: { fuente: { byte, linea } }. Se guardan
//   (atómico) después de cada fuente copiada, nunca antes del INSERT.
// - Un fichero que no existe todavía no es un error: se salta.
// - Solo se copian líneas terminadas en «\n». Una última línea a medio
//   escribir (el motor la está añadiendo) se queda para la vez siguiente.
// - Una línea que no es JSON válido se copia igual (datos = el texto, t = NULL)
//   para no descuadrar los números de línea. Las líneas vacías cuentan como
//   línea pero no se copian.
// - Si un fichero es más corto que la posición guardada (lo han sustituido),
//   se vuelve a copiar desde el principio y se avisa en el resultado.
// - Tope por fuente y por llamada (MAX_BYTES): la primera copia de un historial
//   largo se hace en varios latidos en vez de alargar uno.
// - Un cerrojo propio (data/.espejo) evita que dos latidos copien a la vez.
//   Si está cogido, sale sin copiar ({ ocupado: true }).
// - Sin configuración de base (DB_*): no hace nada ({ omitido }).
//
// La mesa opera sin base de datos: quien llama (scripts/latido.js) apunta el
// error y sigue.

const fs = require('fs');
const path = require('path');
const { escribirJSON, leerJSON } = require('../util/almacen');
const { configuracionBD, obtenerPool, cerrarPool } = require('./conexion');
const { romperMuerto, leerTexto } = require('../util/proceso');

const FUENTES = Object.freeze({
  operaciones: 'operaciones.jsonl',
  'operaciones-sombra': 'operaciones-sombra.jsonl',
  ordenes: 'ordenes.jsonl',
  incidentes: 'incidentes.jsonl',
  'llm-costes': 'llm-costes.jsonl',
  informes: 'informes.jsonl',
  mensajes: 'mensajes.jsonl',
  latidos: 'latidos.jsonl',
  // Para las pantallas (src/registros.js).
  noticias: 'noticias.jsonl',
  historial: 'historial.jsonl',
  decisiones: 'decisiones.jsonl',
});
const FICHERO_POSICIONES = 'espejo.json';
const CERROJO = '.espejo';
const CERROJO_VIEJO_MS = 10 * 60 * 1000;
const MAX_BYTES = 4 * 1024 * 1024;
const FILAS_POR_INSERT = 200;
const MAX_RESUMEN = 255;
const NL = 0x0a;

const TABLAS_POR_DEFECTO = Object.freeze({ registros: 'mesa_registros', latidos: 'mesa_latidos' });

// Lee de `desde` hasta el último «\n» (como mucho `max` bytes, salvo que una
// sola línea sea más larga: entonces se lee hasta su final). Devuelve
// { lineas: [texto], bytes } con los bytes consumidos, o null si no hay nada
// completo.
function leerLineasCompletas(ruta, desde, max = MAX_BYTES) {
  const fd = fs.openSync(ruta, 'r');
  try {
    const tamano = fs.fstatSync(fd).size;
    if (tamano <= desde) return { lineas: [], bytes: 0, tamano };
    let largo = Math.min(max, tamano - desde);
    let buf;
    for (;;) {
      buf = Buffer.alloc(largo);
      const leidos = fs.readSync(fd, buf, 0, largo, desde);
      buf = buf.subarray(0, leidos);
      const ultimo = buf.lastIndexOf(NL);
      if (ultimo >= 0) {
        buf = buf.subarray(0, ultimo + 1);
        break;
      }
      if (desde + leidos >= tamano) return { lineas: [], bytes: 0, tamano };   // solo una línea a medias
      largo = Math.min(largo * 2, tamano - desde);
    }
    // Se corta por bytes «\n» y se decodifica línea a línea: un carácter de
    // varios bytes nunca queda partido.
    const lineas = [];
    let inicio = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === NL) {
        lineas.push(buf.toString('utf8', inicio, i).replace(/\r$/, ''));
        inicio = i + 1;
      }
    }
    return { lineas, bytes: buf.length, tamano };
  } finally {
    fs.closeSync(fd);
  }
}

// Instante de un registro: su `t` (ms de la mesa) o, en los latidos, `inicio`.
function instanteDe(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of ['t', 'inicio']) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  }
  return null;
}

function filaLatido(linea, obj) {
  const inicio = obj && typeof obj.inicio === 'number' && Number.isFinite(obj.inicio) ? new Date(obj.inicio) : null;
  const ms = obj && Number.isFinite(obj.ms) ? Math.max(0, Math.min(2_147_483_647, Math.round(obj.ms))) : null;
  const resumen = obj && obj.resumen !== undefined && obj.resumen !== null ? String(obj.resumen).slice(0, MAX_RESUMEN) : null;
  return [linea, inicio, ms, obj && obj.ok ? 1 : 0, resumen];
}

async function insertarPorTandas(pool, sql, filas) {
  for (let i = 0; i < filas.length; i += FILAS_POR_INSERT) {
    await pool.query(sql, [filas.slice(i, i + FILAS_POR_INSERT)]);
  }
}

function tomarCerrojo(carpeta, ahora) {
  const ruta = path.join(carpeta, CERROJO);
  for (let intento = 0; intento < 3; intento++) {
    try {
      fs.writeFileSync(ruta, JSON.stringify({ pid: process.pid, desde: ahora }), { flag: 'wx' });
      return ruta;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    // Un cerrojo de hace más de 10 min es de un proceso que murió a mitad.
    // Se rompe solo si sigue siendo ese mismo (src/util/proceso.js): si no,
    // dos espejos que lo ven viejo a la vez podían acabar copiando los dos.
    const visto = leerTexto(ruta);
    if (visto === null) continue;
    let viejo = false;
    try { viejo = ahora - fs.statSync(ruta).mtimeMs > CERROJO_VIEJO_MS; } catch (_) { continue; }
    if (!viejo || !romperMuerto(ruta, visto)) return null;
  }
  return null;
}

// Copia una fuente. Devuelve { copiados, linea, pendiente, reiniciada? }.
async function copiarFuente(pool, { carpeta, fuente, fichero, posicion, tablas, maxBytes }) {
  const ruta = path.join(carpeta, fichero);
  if (!fs.existsSync(ruta)) return { copiados: 0, linea: posicion.linea, pendiente: false, noExiste: true };
  let { byte, linea } = posicion;
  let reiniciada = false;
  if (fs.statSync(ruta).size < byte) {
    byte = 0;
    linea = 0;
    reiniciada = true;
  }
  const { lineas, bytes, tamano } = leerLineasCompletas(ruta, byte, maxBytes);
  const filas = [];
  const latidos = [];
  for (const texto of lineas) {
    linea += 1;
    if (texto.trim() === '') continue;
    let obj = null;
    try { obj = JSON.parse(texto); } catch (_) { obj = null; }
    filas.push([fuente, linea, instanteDe(obj), texto]);
    if (fuente === 'latidos' && obj) latidos.push(filaLatido(linea, obj));
  }
  await insertarPorTandas(pool,
    `INSERT INTO ${tablas.registros} (fuente, linea, t, datos) VALUES ? ON DUPLICATE KEY UPDATE t = VALUES(t), datos = VALUES(datos)`,
    filas);
  await insertarPorTandas(pool,
    `INSERT INTO ${tablas.latidos} (id, inicio, ms, ok, resumen) VALUES ? ON DUPLICATE KEY UPDATE inicio = VALUES(inicio), ms = VALUES(ms), ok = VALUES(ok), resumen = VALUES(resumen)`,
    latidos);
  const nuevaPosicion = { byte: byte + bytes, linea };
  return {
    // Quedaba más de lo que cabe en una llamada: el latido siguiente sigue.
    copiados: filas.length, linea, pendiente: tamano - byte > maxBytes,
    posicion: nuevaPosicion, ...(reiniciada ? { reiniciada: true } : {}),
  };
}

function validarTablas(tablas) {
  for (const n of Object.values(tablas)) {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(n)) throw new Error(`nombre de tabla no válido: ${n}`);
  }
  return tablas;
}

// opciones: { pool, entorno = process.env, tablas, maxBytes, ahora }
// Sin `pool`, abre el del proceso con DB_* del entorno y lo cierra al acabar
// (el latido es un proceso corto). Con `pool`, no lo cierra.
async function sincronizar(config, opciones = {}) {
  const carpeta = config && config.carpetaDatos;
  if (!carpeta) throw new Error('sincronizar: falta config.carpetaDatos');
  const tablas = validarTablas({ ...TABLAS_POR_DEFECTO, ...(opciones.tablas || {}) });
  const maxBytes = opciones.maxBytes || MAX_BYTES;
  const ahora = opciones.ahora || Date.now();   // solo para el cerrojo (infraestructura)
  let pool = opciones.pool || null;
  const propio = !pool;
  if (propio) {
    const cfg = configuracionBD(opciones.entorno || process.env);
    if (!cfg) return { copiados: 0, fuentes: {}, omitido: 'sin DB_* en el .env: no hay base de datos a la que copiar' };
    pool = obtenerPool(cfg);
  }
  fs.mkdirSync(carpeta, { recursive: true });
  const cerrojo = tomarCerrojo(carpeta, ahora);
  if (!cerrojo) {
    if (propio) await cerrarPool();
    return { copiados: 0, fuentes: {}, ocupado: true };
  }
  const rutaPos = path.join(carpeta, FICHERO_POSICIONES);
  const posiciones = leerJSON(rutaPos, {}) || {};
  const fuentes = {};
  let copiados = 0;
  try {
    for (const [fuente, fichero] of Object.entries(FUENTES)) {
      const p = posiciones[fuente] || {};
      const posicion = { byte: Number.isInteger(p.byte) && p.byte >= 0 ? p.byte : 0, linea: Number.isInteger(p.linea) && p.linea >= 0 ? p.linea : 0 };
      const r = await copiarFuente(pool, { carpeta, fuente, fichero, posicion, tablas, maxBytes });
      if (r.posicion) {
        posiciones[fuente] = r.posicion;
        escribirJSON(rutaPos, posiciones);
      }
      copiados += r.copiados;
      fuentes[fuente] = {
        copiados: r.copiados, linea: r.linea,
        ...(r.pendiente ? { pendiente: true } : {}), ...(r.noExiste ? { noExiste: true } : {}), ...(r.reiniciada ? { reiniciada: true } : {}),
      };
    }
  } finally {
    try { fs.unlinkSync(cerrojo); } catch (_) { /* ya no está */ }
    if (propio) await cerrarPool();
  }
  return { copiados, fuentes };
}

module.exports = { sincronizar, leerLineasCompletas, FUENTES, FICHERO_POSICIONES, MAX_BYTES };
