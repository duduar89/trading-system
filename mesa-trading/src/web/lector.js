'use strict';
// Lo que la web lee del disco en modo web (ARQUITECTURA-WEB W3). La web no
// tiene orquestador: sirve lo que publicó el último latido.
//
// - data/instantanea.json: se relee solo cuando cambian su fecha de
//   modificación o su tamaño (el latido la escribe de forma atómica: o la
//   vieja o la nueva, nunca media).
// - data/mensajes.jsonl: se sigue su cola por posición en bytes, como `tail -f`.
//   Una línea a medias (el latido escribiendo) se guarda hasta que llega su
//   salto de línea. Si el fichero encoge (se ha rehecho), se vuelve a empezar.
// - data/latidos.jsonl: cuándo acabó el último latido bueno, para /api/salud.
//
// Las edades se miden con el reloj de la máquina (Date.now y la fecha del
// fichero): son marcas de infraestructura, no de la mesa. En sintético el
// reloj de la mesa va por delante y no sirve para saber si el cron late.

const fs = require('fs');
const path = require('path');
const log = require('../util/log').crear('web');

const MAX_COLA_BYTES = 4 * 1024 * 1024;   // lo que se lee de una vez de la cola de mensajes

function statSeguro(ruta) {
  try { return fs.statSync(ruta); } catch (_) { return null; }
}

// Últimas líneas de un JSONL sin leerlo entero (lee los últimos `bytes`).
function ultimasLineas(ruta, bytes = 8192) {
  let fd;
  try {
    fd = fs.openSync(ruta, 'r');
    const { size } = fs.fstatSync(fd);
    const desde = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - desde);
    fs.readSync(fd, buf, 0, buf.length, desde);
    const lineas = buf.toString('utf8').split('\n').map(l => l.trim()).filter(Boolean);
    if (desde > 0) lineas.shift();   // la primera puede venir cortada
    const salida = [];
    for (const l of lineas) { try { salida.push(JSON.parse(l)); } catch (_) { /* línea rota */ } }
    return salida;
  } catch (_) {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* ya cerrado */ }
  }
}

function msDe(v) {
  if (Number.isFinite(v)) return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}

// Clave de una ejecución para saber si ya se había visto.
function claveEjecucion(ej) {
  if (!ej || typeof ej !== 'object') return String(ej);
  if (ej.id !== undefined) return `id:${ej.id}`;
  return JSON.stringify(ej);
}

// Lo que cambia entre dos instantáneas y el panel recibe como eventos sueltos:
// agentes que cambian de sala, de estado o de bocadillo, y ejecuciones nuevas
// (en orden de llegada, la más vieja primero).
function diferencias(anterior, nueva) {
  const salida = { agentes: [], ejecuciones: [] };
  if (!anterior || !nueva) return salida;
  const antes = new Map((anterior.agentes || []).map(a => [a.id, a]));
  for (const a of nueva.agentes || []) {
    const b = antes.get(a.id);
    if (!b) continue;
    const bocA = JSON.stringify(a.bocadillo || null);
    const bocB = JSON.stringify(b.bocadillo || null);
    if (a.sala !== b.sala || a.estado !== b.estado || bocA !== bocB) {
      salida.agentes.push({ id: a.id, sala: a.sala, estado: a.estado, bocadillo: a.bocadillo || null });
    }
  }
  const vistas = new Set((anterior.ejecuciones || []).map(claveEjecucion));
  salida.ejecuciones = (nueva.ejecuciones || []).filter(e => !vistas.has(claveEjecucion(e))).reverse();
  return salida;
}

class LectorMesa {
  constructor({ carpetaDatos }) {
    this.carpeta = path.resolve(carpetaDatos);
    this.rutas = {
      instantanea: path.join(this.carpeta, 'instantanea.json'),
      mensajes: path.join(this.carpeta, 'mensajes.jsonl'),
      latidos: path.join(this.carpeta, 'latidos.jsonl'),
      operaciones: path.join(this.carpeta, 'operaciones.jsonl'),
      costes: path.join(this.carpeta, 'llm-costes.jsonl'),
    };
    this._inst = null;          // { datos, firma, mtimeMs }
    this._cola = null;          // { posicion, resto }
  }

  // { datos, mtimeMs, cambiada } o null si aún no hay instantánea.
  instantanea() {
    const st = statSeguro(this.rutas.instantanea);
    if (!st) return null;
    const firma = `${st.mtimeMs}|${st.size}`;
    if (this._inst && this._inst.firma === firma) return { datos: this._inst.datos, mtimeMs: this._inst.mtimeMs, cambiada: false };
    let datos;
    try {
      datos = JSON.parse(fs.readFileSync(this.rutas.instantanea, 'utf8'));
    } catch (e) {
      // Con la escritura atómica no debería pasar; si pasa, vale la anterior.
      log.aviso(`instantanea.json ilegible: ${e.message}`);
      return this._inst ? { datos: this._inst.datos, mtimeMs: this._inst.mtimeMs, cambiada: false } : null;
    }
    if (!datos || typeof datos !== 'object') return null;
    this._inst = { datos, firma, mtimeMs: st.mtimeMs };
    return { datos, mtimeMs: st.mtimeMs, cambiada: true };
  }

  // Segundos desde que se publicó la instantánea que se tiene.
  edadSeg(mtimeMs, ahora = Date.now()) {
    return Math.max(0, Math.round((ahora - mtimeMs) / 100) / 10);
  }

  // Empieza a seguir la cola de mensajes desde el final de ahora.
  seguirMensajesDesdeAhora() {
    const st = statSeguro(this.rutas.mensajes);
    this._cola = { posicion: st ? st.size : 0, resto: '' };
  }

  // Mensajes escritos desde la última llamada (en orden).
  mensajesNuevos() {
    if (!this._cola) this.seguirMensajesDesdeAhora();
    const st = statSeguro(this.rutas.mensajes);
    if (!st) { this._cola = { posicion: 0, resto: '' }; return []; }
    if (st.size < this._cola.posicion) this._cola = { posicion: 0, resto: '' };   // rehecho
    if (st.size === this._cola.posicion) return [];
    const largo = Math.min(st.size - this._cola.posicion, MAX_COLA_BYTES);
    const buf = Buffer.alloc(largo);
    let fd;
    try {
      fd = fs.openSync(this.rutas.mensajes, 'r');
      fs.readSync(fd, buf, 0, largo, this._cola.posicion);
    } catch (e) {
      log.aviso(`no se pudo leer mensajes.jsonl: ${e.message}`);
      return [];
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* ya cerrado */ }
    }
    this._cola.posicion += largo;
    const texto = this._cola.resto + buf.toString('utf8');
    const trozos = texto.split('\n');
    this._cola.resto = trozos.pop();   // lo que va tras el último salto: a medias
    const salida = [];
    for (const l of trozos) {
      if (!l.trim()) continue;
      try { salida.push(JSON.parse(l)); } catch (_) { /* línea rota: se salta */ }
    }
    return salida;
  }

  // Momento (ms) en que acabó el último latido BUENO (ok: true) de
  // data/latidos.jsonl; si el fichero no existe, la fecha de la instantánea.
  // null si no hay nada. Los omitidos por el cerrojo y los fallidos también se
  // apuntan (con ok: false) y no cuentan: con un cerrojo huérfano, cada minuto
  // llegaba un «Latido omitido» y /api/salud decía «último latido hace 2 s» con
  // la mesa parada. Si en la cola que se lee (los últimos 16 KB, decenas de
  // latidos) no hay ninguno bueno, es que hace demasiado: null.
  ultimoLatidoMs() {
    if (!statSeguro(this.rutas.latidos)) {
      const st = statSeguro(this.rutas.instantanea);
      return st ? st.mtimeMs : null;
    }
    const ultimas = ultimasLineas(this.rutas.latidos, 16384);
    for (let i = ultimas.length - 1; i >= 0; i--) {
      const l = ultimas[i];
      if (!l || l.ok !== true) continue;
      const inicio = msDe(l.inicio ?? l.t);
      if (inicio !== null) return inicio + (Number(l.ms) || 0);
    }
    return null;
  }

  // Latidos no buenos seguidos al final de data/latidos.jsonl (omitidos o
  // fallidos), para que /api/salud diga por qué está en rojo.
  latidosMalosSeguidos() {
    const ultimas = ultimasLineas(this.rutas.latidos, 16384);
    let n = 0;
    for (let i = ultimas.length - 1; i >= 0 && !(ultimas[i] && ultimas[i].ok === true); i--) n++;
    return n;
  }
}

module.exports = { LectorMesa, diferencias, ultimasLineas, claveEjecucion };
