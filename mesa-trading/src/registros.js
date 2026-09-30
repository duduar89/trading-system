'use strict';
// Registros en disco para las pantallas de Noticias, Evolución y Decisiones
// (ARQUITECTURA §6.10 y §7). Tres JSONL que solo crecen:
//
//   data/noticias.jsonl    una línea por noticia nueva que trae Alpaca, y una de
//                          «actualización» si su clasificación llega después.
//   data/historial.jsonl   una línea por hora de reloj de la mesa y otra en cada
//                          suceso que cambia el reparto o el modo del fondo.
//   data/decisiones.jsonl  una línea por decisión real, con quién la tomó y sus datos.
//
// Nada de lo que se escribe aquí se inventa: cada línea sale de un dato ya
// calculado por el código (o de la noticia tal y como la da la fuente).
// Escribir nunca lanza: un registro no puede tumbar un latido.

const fs = require('fs');
const path = require('path');
const { anadirJSONL, leerJSONL } = require('./util/almacen');
const log = require('./util/log').crear('registros');

const FICHEROS = Object.freeze({
  noticias: 'noticias.jsonl',
  historial: 'historial.jsonl',
  decisiones: 'decisiones.jsonl',
});

const TIPOS_DECISION = Object.freeze([
  'comite', 'orden', 'veto', 'recorte', 'asignacion', 'ascenso', 'descarte', 'despido',
  'laboratorio', 'kill', 'pausa', 'megafono', 'noticia',
  'reunion',   // reuniones informativas de las 9:00 y las 22:15 (§6.9): no cambian nada, pero se cuentan
]);

const MOTIVOS_HISTORIAL = Object.freeze(['hora', 'comite', 'asignacion', 'ascenso', 'descarte', 'despido', 'kill']);

const MAX_RESUMEN_NOTICIA = 400;
const MAX_TEXTO_DECISION = 400;

function rutas(carpeta) {
  return Object.fromEntries(Object.entries(FICHEROS).map(([k, f]) => [k, path.join(carpeta, f)]));
}

function anadir(ruta, obj) {
  if (!ruta) return false;
  try {
    anadirJSONL(ruta, obj);
    return true;
  } catch (e) {
    log.aviso(`no se pudo apuntar en ${path.basename(ruta)}: ${e.message}`);
    return false;
  }
}

// Última línea válida de un JSONL sin leerlo entero (null si no hay).
function ultimaLinea(ruta) {
  let fd;
  try {
    fd = fs.openSync(ruta, 'r');
    const { size } = fs.fstatSync(fd);
    let bytes = Math.min(size, 16 * 1024);
    for (;;) {
      const buf = Buffer.alloc(bytes);
      fs.readSync(fd, buf, 0, bytes, size - bytes);
      const lineas = buf.toString('utf8').split('\n').map(l => l.trim()).filter(Boolean);
      for (let i = lineas.length - 1; i >= (bytes < size ? 1 : 0); i--) {
        try { return JSON.parse(lineas[i]); } catch (_) { /* rota: la anterior */ }
      }
      if (bytes >= size) return null;
      bytes = Math.min(size, bytes * 4);
    }
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* ya cerrado */ }
  }
}

// ---------- Noticias ----------

// Una noticia de la fuente (AlpacaDatos.noticias) → la línea de noticias.jsonl.
// `simbolos`: solo los del universo de la mesa.
function lineaNoticia(n, { t, universo, clasificacion = null, veto = null }) {
  const univ = new Set(universo || []);
  return {
    t,
    id: String(n.id),
    titular: String(n.titular || ''),
    resumen: String(n.resumen || '').slice(0, MAX_RESUMEN_NOTICIA),
    url: n.url || null,
    fuente: n.fuente || null,
    autor: n.autor || null,
    publicada: Number.isFinite(n.t) ? n.t : null,
    simbolos: (n.simbolos || []).filter(s => univ.has(s)),
    clasificacion,
    veto,
  };
}

// Lee noticias.jsonl y fusiona las actualizaciones en su noticia. Devuelve
// las `limite` más recientes (por t de la línea base), de la más nueva a la
// más vieja, con `desde` (t ≥ desde) si se da.
//
// Una segunda línea BASE del mismo id (un latido la escribió y murió antes de
// guardar el estado, y el siguiente la volvió a escribir ya clasificada) se
// fusiona como una actualización: vale la clasificación o el veto no nulos más
// recientes, nunca un null posterior. La noticia conserva su primera `t`.
// Con `conHuerfanas` (un instante) cada noticia lleva además `ultimaLineaT`,
// la `t` de su última línea (analisis.alinearConRegistro).
function leerNoticias(ruta, { desde = -Infinity, limite = 200, conHuerfanas = null } = {}) {
  const lineas = leerJSONL(ruta, Math.max(limite * 3, 600));
  const porId = new Map();
  for (const l of lineas) {
    if (!l || l.id === undefined) continue;
    const id = String(l.id);
    const base = porId.get(id);
    if (l.actualiza || base) {
      if (!base) continue;
      if (l.actualiza) Object.assign(base, { clasificacion: l.clasificacion ?? null, veto: l.veto ?? null, clasificadaT: l.t });
      else {
        if (l.clasificacion !== null && l.clasificacion !== undefined) Object.assign(base, { clasificacion: l.clasificacion, clasificadaT: l.t });
        if (l.veto !== null && l.veto !== undefined) base.veto = l.veto;
      }
      if (conHuerfanas !== null) base.ultimaLineaT = Math.max(base.ultimaLineaT, l.t);
      continue;
    }
    porId.set(id, conHuerfanas !== null ? { ...l, ultimaLineaT: l.t } : { ...l });
  }
  return [...porId.values()].filter(n => n.t >= desde).sort((a, b) => b.t - a.t || (a.id < b.id ? 1 : -1)).slice(0, limite);
}

// ---------- Historial ----------

function leerHistorial(ruta, { desde = -Infinity, limite = 2000 } = {}) {
  return leerJSONL(ruta, limite).filter(l => l && l.t >= desde);
}

// ---------- Decisiones ----------

function recortar(texto, max = MAX_TEXTO_DECISION) {
  const s = String(texto || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function lineaDecision({ t, tipo, quien, resumen, datos }) {
  if (!TIPOS_DECISION.includes(tipo)) throw new Error(`tipo de decisión desconocido: ${tipo}`);
  return { t, tipo, quien: quien || 'sistema', resumen: recortar(resumen), datos: datos || {} };
}

// `tipo`: uno o varios separados por comas. `quien`: el id de quien decidió
// (un agente o 'humano'), para la ficha de un agente («sus decisiones»).
function leerDecisiones(ruta, { desde = -Infinity, tipo = null, quien = null, limite = 500 } = {}) {
  const tipos = tipo ? new Set(String(tipo).split(',')) : null;
  const de = quien ? String(quien) : null;
  const n = tipos || de ? Math.max(limite * 10, 5000) : limite;
  return leerJSONL(ruta, n).filter(l => l && l.t >= desde && (!tipos || tipos.has(l.tipo)) && (!de || l.quien === de)).slice(-limite);
}

// Para los servidores: GET /api/noticias, /api/historial, /api/decisiones.
// `params` es un URLSearchParams. Devuelve el cuerpo JSON.
function consultar(carpeta, fuente, params) {
  const r = rutas(carpeta);
  const num = (k, def, max) => {
    const v = params && params.get(k);
    const x = v === null || v === undefined || v === '' ? def : Number(v);
    return Number.isFinite(x) ? (max ? Math.max(1, Math.min(max, Math.floor(x))) : x) : def;
  };
  const desde = num('desde', -Infinity);
  if (fuente === 'noticias') return leerNoticias(r.noticias, { desde, limite: num('limite', 200, 1000) });
  if (fuente === 'historial') return leerHistorial(r.historial, { desde, limite: num('limite', 2000, 20000) });
  if (fuente === 'decisiones') {
    return leerDecisiones(r.decisiones, { desde, tipo: params && params.get('tipo'), quien: params && params.get('quien'), limite: num('limite', 500, 5000) });
  }
  return null;
}

module.exports = {
  FICHEROS, TIPOS_DECISION, MOTIVOS_HISTORIAL, MAX_RESUMEN_NOTICIA,
  rutas, anadir, ultimaLinea, lineaNoticia, leerNoticias, leerHistorial, lineaDecision, leerDecisiones, consultar,
};
