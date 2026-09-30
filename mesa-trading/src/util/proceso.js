'use strict';
// Un solo proceso por carpeta de datos: fichero de bloqueo <carpeta>/.proceso
// con el pid. Dos procesos sobre la misma carpeta escribirían a la vez
// estado.json, ordenes.jsonl y broker-simulado.json y mandarían órdenes con el
// mismo idCliente (con Alpaca, sobre la misma cuenta).
//
// - Si el fichero es de otro pid que sigue vivo en esta máquina → error claro.
//   «Vivo» es el mismo proceso, no solo el mismo número: en Linux el cerrojo
//   guarda también el instante de arranque del proceso (/proc/<pid>/stat,
//   campo 22) y, si el pid existe pero arrancó en otro momento, es que el
//   sistema ha reciclado el número (un kill -9 o el vigía del latido dejan el
//   cerrojo huérfano, y con un cron que lanza un proceso por minuto el pid
//   vuelve pronto): el cerrojo está muerto. Sin eso, la mesa se quedaba
//   parada para siempre con cada latido «omitido: ocupado».
// - Si ese pid ya no existe (el proceso murió sin soltarlo) → se toma. Romper
//   un cerrojo muerto se hace bajo otro cerrojo (<carpeta>/.proceso.romper) y
//   volviendo a leer que sigue siendo el mismo: sin eso, dos procesos que lo
//   ven muerto a la vez (la web matada a mitad de un botón y el latido del
//   minuto) podían acabar los dos dueños, porque el segundo borraba el
//   cerrojo que el primero acababa de tomar.
// - Si es de otra máquina (carpeta compartida) no se puede saber si vive: se
//   niega igual, y el mensaje dice cómo quitarlo si de verdad sobra.
// - El mismo proceso puede volver a tomarlo (la demo reinicia el orquestador
//   dentro del proceso, y las pruebas crean varios).

const fs = require('fs');
const os = require('os');
const path = require('path');

const NOMBRE = '.proceso';
// Un .romper más viejo que esto es de un proceso que murió en mitad de romper
// (una ventana de microsegundos): se quita.
const ROMPER_VIEJO_MS = 10_000;

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

// Instante de arranque del proceso en ticks desde el arranque de la
// máquina (Linux, /proc/<pid>/stat campo 22), como texto. null si no se puede
// saber (otro sistema, pid que no existe): entonces solo se mira el pid.
function arranqueDe(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // El nombre del proceso (campo 2) va entre paréntesis y puede llevar
    // espacios: se cuenta desde el último ')'. Tras él, el campo 3 es el 0.
    const campos = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const v = campos[19];
    return v && /^\d+$/.test(v) ? v : null;
  } catch (_) {
    return null;
  }
}

// ¿Sigue vivo el dueño del cerrojo? Mismo pid y, si los dos se conocen, mismo
// instante de arranque.
function duenoVivo(otro) {
  if (!pidVivo(otro.pid)) return false;
  if (!otro.arranque) return true;   // cerrojo antiguo o de un sistema sin /proc
  const actual = arranqueDe(otro.pid);
  return actual === null || actual === String(otro.arranque);
}

function leerTexto(ruta) {
  try {
    return fs.readFileSync(ruta, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function interpretar(texto) {
  if (texto === null) return null;
  try { return JSON.parse(texto); } catch (_) { return { pid: parseInt(texto, 10) }; }
}

function leer(ruta) { return interpretar(leerTexto(ruta)); }

// Quita el cerrojo muerto SOLO si sigue siendo exactamente el que se vio
// (`visto`), y solo quien tiene .romper. Devuelve false si otro lo está
// rompiendo a la vez (quien llama sale con EBLOQUEO y reintenta después).
function romperMuerto(ruta, visto) {
  const romper = `${ruta}.romper`;
  try {
    fs.writeFileSync(romper, String(process.pid), { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try {
      if (Date.now() - fs.statSync(romper).mtimeMs > ROMPER_VIEJO_MS) fs.unlinkSync(romper);
    } catch (_) { /* ya no está */ }
    return false;
  }
  try {
    if (leerTexto(ruta) === visto) fs.unlinkSync(ruta);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return true;
    throw e;
  } finally {
    try { fs.unlinkSync(romper); } catch (_) { /* nada */ }
  }
}

function tomarBloqueo(carpeta, { ahora = Date.now() } = {}) {
  fs.mkdirSync(carpeta, { recursive: true });
  const ruta = rutaBloqueo(carpeta);
  const arranque = arranqueDe(process.pid);
  const mio = { pid: process.pid, host: os.hostname(), desde: new Date(ahora).toISOString(), ...(arranque ? { arranque } : {}) };
  for (let intento = 0; intento < 3; intento++) {
    try {
      fs.writeFileSync(ruta, JSON.stringify(mio), { flag: 'wx' });
      return { ruta, tomado: true };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const visto = leerTexto(ruta);
    if (visto === null) continue;   // lo soltaron entre medias: otra vuelta
    const otro = interpretar(visto) || {};
    const mismaMaquina = !otro.host || otro.host === mio.host;
    if (mismaMaquina && otro.pid === process.pid && duenoVivo(otro)) {
      fs.writeFileSync(ruta, JSON.stringify(mio));
      return { ruta, tomado: true, reentrada: true };
    }
    if (mismaMaquina && !duenoVivo(otro)) {
      if (romperMuerto(ruta, visto)) continue;
      break;
    }
    const quien = `pid ${otro.pid ?? '?'}${otro.host && !mismaMaquina ? ` en ${otro.host}` : ''}${otro.desde ? `, desde ${otro.desde}` : ''}`;
    const err = new Error(`Otra mesa ya usa la carpeta ${carpeta} (${quien}). Dos procesos sobre los mismos datos se pisarían las órdenes y el estado. Cierra el otro, arranca con otra carpeta (--datos=…) o, si estás seguro de que no hay ninguno, borra ${ruta}.`);
    err.code = 'EBLOQUEO';
    err.dueno = otro;
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

module.exports = { tomarBloqueo, soltarBloqueo, rutaBloqueo, pidVivo, arranqueDe, duenoVivo, romperMuerto, leerTexto, NOMBRE };
