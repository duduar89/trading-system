'use strict';
// Persistencia en disco sin base de datos: un JSON por estado y JSONL para los
// registros que solo crecen (mensajes, operaciones, costes de LLM).
//
// Escritura atómica: se escribe a un temporal y se renombra, para que un corte
// de luz a mitad no deje un estado.json a medias que impida arrancar.

const fs = require('fs');
const path = require('path');

function asegurarCarpeta(ruta) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
}

function leerJSON(ruta, porDefecto = null) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return porDefecto;
    // Un JSON corrupto no se pisa en silencio: se aparta para poder mirarlo.
    const apartado = `${ruta}.corrupto-${Date.now()}`;
    try { fs.renameSync(ruta, apartado); } catch (_) { /* ya no existe */ }
    console.error(`[almacen] ${ruta} no se pudo leer (${e.message}); apartado en ${apartado}`);
    return porDefecto;
  }
}

function escribirJSON(ruta, datos) {
  asegurarCarpeta(ruta);
  const tmp = `${ruta}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 2));
  fs.renameSync(tmp, ruta);
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

module.exports = { leerJSON, escribirJSON, anadirJSONL, leerJSONL, asegurarCarpeta };
