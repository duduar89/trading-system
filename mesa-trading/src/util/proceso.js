'use strict';
// Un solo proceso por carpeta de datos: fichero de bloqueo <carpeta>/.proceso
// con el pid. Dos procesos sobre la misma carpeta escribirían a la vez
// estado.json, ordenes.jsonl y broker-simulado.json y mandarían órdenes con el
// mismo idCliente (con Alpaca, sobre la misma cuenta).
//
// - Si el fichero es de otro pid que sigue vivo en esta máquina → error claro.
// - Si ese pid ya no existe (el proceso murió sin soltarlo) → se toma.
// - Si es de otra máquina (carpeta compartida) no se puede saber si vive: se
//   niega igual, y el mensaje dice cómo quitarlo si de verdad sobra.
// - El mismo proceso puede volver a tomarlo (la demo reinicia el orquestador
//   dentro del proceso, y las pruebas crean varios).

const fs = require('fs');
const os = require('os');
const path = require('path');

const NOMBRE = '.proceso';

function rutaBloqueo(carpeta) { return path.join(carpeta, NOMBRE); }

function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';   // existe, pero es de otro usuario
  }
}

function leer(ruta) {
  try {
    const texto = fs.readFileSync(ruta, 'utf8');
    try { return JSON.parse(texto); } catch (_) { return { pid: parseInt(texto, 10) }; }
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function tomarBloqueo(carpeta, { ahora = Date.now() } = {}) {
  fs.mkdirSync(carpeta, { recursive: true });
  const ruta = rutaBloqueo(carpeta);
  const mio = { pid: process.pid, host: os.hostname(), desde: new Date(ahora).toISOString() };
  for (let intento = 0; intento < 2; intento++) {
    try {
      fs.writeFileSync(ruta, JSON.stringify(mio), { flag: 'wx' });
      return { ruta, tomado: true };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const otro = leer(ruta) || {};
    const mismaMaquina = !otro.host || otro.host === mio.host;
    if (mismaMaquina && otro.pid === process.pid) {
      fs.writeFileSync(ruta, JSON.stringify(mio));
      return { ruta, tomado: true, reentrada: true };
    }
    if (mismaMaquina && !pidVivo(otro.pid)) {
      try { fs.unlinkSync(ruta); } catch (_) { /* otro lo quitó a la vez */ }
      continue;
    }
    const quien = `pid ${otro.pid ?? '?'}${otro.host && !mismaMaquina ? ` en ${otro.host}` : ''}${otro.desde ? `, desde ${otro.desde}` : ''}`;
    const err = new Error(`Otra mesa ya usa la carpeta ${carpeta} (${quien}). Dos procesos sobre los mismos datos se pisarían las órdenes y el estado. Cierra el otro, arranca con otra carpeta (--datos=…) o, si estás seguro de que no hay ninguno, borra ${ruta}.`);
    err.code = 'EBLOQUEO';
    throw err;
  }
  const err = new Error(`No se pudo tomar ${ruta}: otro proceso lo toma a la vez.`);
  err.code = 'EBLOQUEO';
  throw err;
}

// Suelta el bloqueo solo si es de este proceso.
function soltarBloqueo(carpeta) {
  const ruta = rutaBloqueo(carpeta);
  try {
    const otro = leer(ruta);
    if (otro && otro.pid === process.pid) fs.unlinkSync(ruta);
  } catch (_) { /* ya no está */ }
}

module.exports = { tomarBloqueo, soltarBloqueo, rutaBloqueo, pidVivo, NOMBRE };
