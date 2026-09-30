'use strict';
// Persistencia en disco sin base de datos: un JSON por estado y JSONL para los
// registros que solo crecen (mensajes, operaciones, costes de LLM).
//
// Escritura atómica: se escribe a un temporal y se renombra, para que un corte
// de luz a mitad no deje un estado.json a medias que impida arrancar. Con
// { durable: true } el temporal se sincroniza con el disco (fsync) antes de
// renombrar: sin eso, tras un corte de luz NTFS puede dejar el fichero a ceros
// aunque el renombrado conste.
//
// Windows: un antivirus, el indexador o OneDrive pueden tener el fichero
// abierto un instante y el renombrado falla con EPERM, EBUSY o EACCES. Se
// reintenta con esperas crecientes (como graceful-fs) antes de dar error.
//
// Lectura: un fichero que no se puede leer NO es lo mismo que uno que no
// existe. Con { critico: true } (estado.json, broker-simulado.json) un bloqueo
// de un instante se reintenta y, si sigue, o si el JSON está roto, se lanza un
// error y el fichero se queda donde está: arrancar un fondo nuevo encima
// borraría el bloqueo del kill y la historia. Sin `critico` (cachés), un JSON
// roto se aparta como .corrupto-<t> y se devuelve el valor por defecto.

const fs = require('fs');
const path = require('path');

const BLOQUEADO = new Set(['EBUSY', 'EPERM', 'EACCES']);
const REINTENTOS_LECTURA = 20;           // × 250 ms: 5 s
const ESPERA_LECTURA_MS = 250;
const ESPERAS_RENOMBRADO_MS = [10, 20, 40, 80, 160, 320, 400];   // ~1 s en total

// Espera síncrona sin gastar CPU (un bucle activo impediría que el otro
// programa soltara el fichero).
const celda = new Int32Array(new SharedArrayBuffer(4));
function dormirSinc(ms) {
  Atomics.wait(celda, 0, 0, ms);
}

function asegurarCarpeta(ruta) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
}

function leerJSON(ruta, porDefecto = null, { critico = false } = {}) {
  let ultimo = null;
  const intentos = critico ? REINTENTOS_LECTURA : 1;
  for (let k = 0; k < intentos; k++) {
    let texto;
    try {
      texto = fs.readFileSync(ruta, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return porDefecto;
      // Bloqueado por otro programa (o ilegible por otra causa): nunca se aparta, no está roto.
      ultimo = e;
      if (!critico) {
        console.error(`[almacen] ${ruta} no se pudo leer (${e.code || e.message}); se usa el valor por defecto sin tocar el fichero`);
        return porDefecto;
      }
      if (!BLOQUEADO.has(e.code)) throw e;
      if (k < intentos - 1) dormirSinc(ESPERA_LECTURA_MS);
      continue;
    }
    try {
      return JSON.parse(texto);
    } catch (e) {
      if (critico) {
        const err = new Error(`${ruta} no es un JSON válido (${e.message}). No se arranca encima para no empezar un fondo nuevo: revísalo o, si de verdad sobra, apártalo a mano.`);
        err.code = 'EJSON';
        throw err;
      }
      // Un JSON corrupto de una caché no se pisa en silencio: se aparta para poder mirarlo.
      const apartado = `${ruta}.corrupto-${Date.now()}`;
      try { fs.renameSync(ruta, apartado); } catch (_) { /* ya no existe */ }
      console.error(`[almacen] ${ruta} no se pudo leer (${e.message}); apartado en ${apartado}`);
      return porDefecto;
    }
  }
  const err = new Error(`${ruta} sigue bloqueado por otro programa (${ultimo && ultimo.code}) tras ${REINTENTOS_LECTURA} intentos: no se arranca sin poder leerlo.`);
  err.code = ultimo && ultimo.code;
  throw err;
}

function renombrarConReintentos(origen, destino) {
  for (let k = 0; ; k++) {
    try {
      fs.renameSync(origen, destino);
      return;
    } catch (e) {
      if (!BLOQUEADO.has(e.code) || k >= ESPERAS_RENOMBRADO_MS.length) throw e;
      dormirSinc(ESPERAS_RENOMBRADO_MS[k]);
    }
  }
}

function escribirJSON(ruta, datos, { durable = false } = {}) {
  asegurarCarpeta(ruta);
  const tmp = `${ruta}.tmp-${process.pid}`;
  const texto = JSON.stringify(datos, null, 2);
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, texto);
      if (durable) fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renombrarConReintentos(tmp, ruta);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* no llegó a crearse o ya se renombró */ }
    throw e;
  }
}

function anadirJSONL(ruta, registro) {
  asegurarCarpeta(ruta);
  fs.appendFileSync(ruta, JSON.stringify(registro) + '\n');
}

// Lee las últimas `n` líneas válidas de un JSONL. Para ficheros grandes lee solo
// la cola, no el fichero entero.
function leerJSONL(ruta, n = Infinity) {
  let texto;
  try {
    if (n === Infinity) {
      texto = fs.readFileSync(ruta, 'utf8');
    } else {
      const st = fs.statSync(ruta);
      const bytes = Math.min(st.size, Math.max(64 * 1024, n * 2048));
      const fd = fs.openSync(ruta, 'r');
      const buf = Buffer.alloc(bytes);
      fs.readSync(fd, buf, 0, bytes, st.size - bytes);
      fs.closeSync(fd);
      texto = buf.toString('utf8');
      if (bytes < st.size) texto = texto.slice(texto.indexOf('\n') + 1);
    }
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const filas = [];
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue;
    try { filas.push(JSON.parse(linea)); } catch (_) { /* línea cortada */ }
  }
  return n === Infinity ? filas : filas.slice(-n);
}

module.exports = { leerJSON, escribirJSON, anadirJSONL, leerJSONL, asegurarCarpeta, dormirSinc };
