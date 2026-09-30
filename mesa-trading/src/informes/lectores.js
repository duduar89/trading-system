'use strict';
// Lectores de los registros para las vistas (Evolución, Estrategias, Noticias,
// Decisiones y Laboratorio). Solo leen: nunca escriben ni tocan el estado.
//
// - Lecturas acotadas: de un JSONL solo se lee la cola (como mucho `maxBytes`
//   y `lineas` líneas), nunca el fichero entero; un historial de años no
//   tumba el servidor ni el móvil.
// - Nunca rompen: un fichero que no existe, que no se puede leer o con líneas
//   cortadas da lo que haya ([] si nada). Una vista vacía se explica sola; un
//   500 no explica nada.
// - Caché por fichero (tamaño + fecha de modificación): los registros solo
//   crecen, así que si no ha cambiado ninguna de las dos, lo leído vale.
// - Reducción de puntos (LTTB, «largest triangle three buckets»): se queda con
//   los puntos que conservan la forma de la curva (picos y valles incluidos),
//   no con uno de cada N, que se come justo las caídas que importan.

const fs = require('fs');
const path = require('path');
const registros = require('../registros');

const MAX_LINEAS = 20000;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PUNTOS = 2000;
const MIN_PUNTOS = 20;

// ---------- cola de un JSONL ----------

const cache = new Map();   // ruta|lineas → { size, mtimeMs, filas }
const MAX_CACHE = 6;

// Últimas `lineas` líneas válidas de `ruta`, leyendo como mucho `maxBytes`
// del final. La primera línea del trozo, si el trozo no empieza en el byte 0,
// puede estar cortada: se descarta. Nunca lanza.
function leerCola(ruta, { lineas = MAX_LINEAS, maxBytes = MAX_BYTES } = {}) {
  const n = Math.max(1, Math.floor(Number(lineas) || MAX_LINEAS));
  let st;
  try { st = fs.statSync(ruta); } catch (_) { return []; }
  if (!st.isFile() || st.size === 0) return [];
  const clave = `${ruta}|${n}|${maxBytes}`;
  const c = cache.get(clave);
  if (c && c.size === st.size && c.mtimeMs === st.mtimeMs) return c.filas;
  let fd;
  let texto = '';
  try {
    fd = fs.openSync(ruta, 'r');
    // Se lee hacia atrás en trozos crecientes hasta tener n líneas o el tope.
    let bytes = Math.min(st.size, Math.max(64 * 1024, n * 1200));
    for (;;) {
      bytes = Math.min(bytes, st.size, maxBytes);
      const buf = Buffer.alloc(bytes);
      fs.readSync(fd, buf, 0, bytes, st.size - bytes);
      texto = buf.toString('utf8');
      const saltos = contarSaltos(texto);
      if (bytes >= st.size || bytes >= maxBytes || saltos > n) break;
      bytes *= 2;
    }
    if (bytes < st.size) texto = texto.slice(texto.indexOf('\n') + 1);
  } catch (_) {
    return [];
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* ya cerrado */ }
  }
  const filas = [];
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue;
    try {
      const x = JSON.parse(linea);
      if (x && typeof x === 'object' && !Array.isArray(x)) filas.push(x);
    } catch (_) { /* línea cortada o rota: fuera */ }
  }
  const salida = filas.length > n ? filas.slice(-n) : filas;
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(clave, { size: st.size, mtimeMs: st.mtimeMs, filas: salida });
  return salida;
}

function contarSaltos(texto) {
  let k = 0;
  for (let i = texto.indexOf('\n'); i >= 0; i = texto.indexOf('\n', i + 1)) k++;
  return k;
}

function vaciarCache() { cache.clear(); }

// ---------- reducción de puntos (LTTB) ----------

// Índices de los `umbral` puntos que mejor conservan la forma de (x, y).
// Siempre entran el primero y el último. Los puntos sin y (null) no compiten:
// se reducen solo los que tienen número.
function indicesLTTB(puntos, umbral, x, y) {
  const n = puntos.length;
  if (umbral >= n || n <= 2) return puntos.map((_, i) => i);
  const u = Math.max(2, Math.floor(umbral));
  if (u === 2) return [0, n - 1];
  const fuera = [0];
  const cubo = (n - 2) / (u - 2);
  let a = 0;
  for (let i = 0; i < u - 2; i++) {
    const ini = Math.floor(i * cubo) + 1;
    const fin = Math.min(n - 1, Math.floor((i + 1) * cubo) + 1);
    // Media del cubo siguiente (el último apunta al punto final).
    const sIni = fin;
    const sFin = Math.min(n, Math.floor((i + 2) * cubo) + 1);
    let mx = 0;
    let my = 0;
    let cuenta = 0;
    for (let j = sIni; j < Math.max(sFin, sIni + 1) && j < n; j++) {
      const yj = y(puntos[j]);
      if (!Number.isFinite(yj)) continue;
      mx += x(puntos[j]); my += yj; cuenta++;
    }
    if (!cuenta) { mx = x(puntos[n - 1]); my = Number.isFinite(y(puntos[n - 1])) ? y(puntos[n - 1]) : 0; } else { mx /= cuenta; my /= cuenta; }
    const ax = x(puntos[a]);
    const ay = Number.isFinite(y(puntos[a])) ? y(puntos[a]) : my;
    let mejor = -1;
    let elegido = ini;
    for (let j = ini; j < fin; j++) {
      const yj = y(puntos[j]);
      if (!Number.isFinite(yj)) continue;
      const area = Math.abs((ax - mx) * (yj - ay) - (ax - x(puntos[j])) * (my - ay));
      if (area > mejor) { mejor = area; elegido = j; }
    }
    fuera.push(elegido);
    a = elegido;
  }
  fuera.push(n - 1);
  return [...new Set(fuera)].sort((p, q) => p - q);
}

// LTTB suele quedarse con los extremos, pero no lo promete: el máximo y el
// mínimo de la serie entran siempre (una caída que no se ve es una mentira).
function indicesConExtremos(puntos, umbral, x, y) {
  if (umbral >= puntos.length) return puntos.map((_, i) => i);
  let iMax = -1;
  let iMin = -1;
  puntos.forEach((p, i) => {
    const v = y(p);
    if (!Number.isFinite(v)) return;
    if (iMax < 0 || v > y(puntos[iMax])) iMax = i;
    if (iMin < 0 || v < y(puntos[iMin])) iMin = i;
  });
  const idx = new Set(indicesLTTB(puntos, Math.max(2, umbral - 2), x, y));
  if (iMax >= 0) idx.add(iMax);
  if (iMin >= 0) idx.add(iMin);
  return [...idx].sort((a, b) => a - b);
}

function reducir(puntos, umbral, x = p => p.t, y = p => p.v) {
  return indicesConExtremos(puntos, umbral, x, y).map(i => puntos[i]);
}

// ---------- parámetros ----------

function numero(params, k, def, { min = -Infinity, max = Infinity, entero = false } = {}) {
  const v = params && typeof params.get === 'function' ? params.get(k) : null;
  let x = v === null || v === undefined || String(v).trim() === '' ? def : Number(v);
  if (!Number.isFinite(x)) x = def;
  if (!Number.isFinite(x)) return x;
  if (entero) x = Math.floor(x);
  return Math.max(min, Math.min(max, x));
}

function texto(params, k) {
  const v = params && typeof params.get === 'function' ? params.get(k) : null;
  return v === null || v === undefined ? '' : String(v).trim();
}

// ---------- historial ----------

// Una línea de historial «de suceso» (no la de cada hora): siempre se queda,
// son las marcas de la línea de tiempo.
const esSuceso = l => l && l.motivo && l.motivo !== 'hora';

// GET /api/historial?desde=&puntos=: todo el tramo (la cola del fichero,
// como mucho `limite` líneas) reducido a ≤ `puntos` líneas con la forma del
// patrimonio; los sucesos siempre están. Sin `puntos`, lo de siempre
// (registros.consultar: las últimas `limite` líneas tal cual).
function historialReducido(ruta, { desde = -Infinity, puntos = MAX_PUNTOS, limite = MAX_LINEAS } = {}) {
  const filas = leerCola(ruta, { lineas: limite }).filter(l => Number.isFinite(l.t) && l.t >= desde);
  filas.sort((a, b) => a.t - b.t);
  if (filas.length <= puntos) return filas;
  const sucesos = filas.filter(esSuceso);
  const horas = filas.filter(l => !esSuceso(l));
  const hueco = Math.max(2, puntos - Math.min(sucesos.length, Math.floor(puntos / 4)));
  const elegidas = reducir(horas, hueco, l => l.t, l => l.patrimonio);
  const salida = elegidas.concat(sucesos.slice(-Math.floor(puntos / 4)));
  salida.sort((a, b) => a.t - b.t || (esSuceso(a) ? 1 : 0) - (esSuceso(b) ? 1 : 0));
  return salida;
}

function historial(carpeta, params) {
  const ruta = registros.rutas(carpeta).historial;
  const hayPuntos = params && typeof params.get === 'function' && params.get('puntos') !== null && params.get('puntos') !== '';
  if (!hayPuntos) {
    try { return registros.consultar(carpeta, 'historial', params); } catch (_) { return []; }
  }
  return historialReducido(ruta, {
    desde: numero(params, 'desde', -Infinity),
    puntos: numero(params, 'puntos', MAX_PUNTOS, { min: MIN_PUNTOS, max: MAX_PUNTOS, entero: true }),
    limite: numero(params, 'limite', MAX_LINEAS, { min: 1, max: MAX_LINEAS, entero: true }),
  });
}

// ---------- noticias ----------

// Un símbolo del filtro puede venir como «BTC», «btc», «BTC/USD» o «BTCUSD».
function encajaSimbolo(filtro) {
  const f = String(filtro || '').toUpperCase().replace(/\s+/g, '');
  if (!f) return () => true;
  const sinBarra = f.replace('/', '');
  return s => {
    const S = String(s || '').toUpperCase();
    return S === f || S.replace('/', '') === sinBarra || S.split('/')[0] === f;
  };
}

const esGrave = n => Array.isArray(n.clasificacion) && n.clasificacion.some(c => c && c.grave);

// GET /api/noticias?desde=&limite=&simbolo=&graves=1: las de noticias.jsonl
// con las actualizaciones fusionadas (registros.leerNoticias), de la más nueva
// a la más vieja. `simbolo` se queda con las que lo nombran (en sus símbolos,
// en su clasificación o en su veto); `graves=1`, con las que alguna
// clasificación marcó graves.
function noticias(carpeta, params) {
  const simbolo = texto(params, 'simbolo');
  const graves = ['1', 'true', 'si', 'sí'].includes(texto(params, 'graves').toLowerCase());
  if (!simbolo && !graves) {
    try { return registros.consultar(carpeta, 'noticias', params); } catch (_) { return []; }
  }
  const limite = numero(params, 'limite', 200, { min: 1, max: 1000, entero: true });
  let todas;
  try {
    todas = registros.leerNoticias(registros.rutas(carpeta).noticias, { desde: numero(params, 'desde', -Infinity), limite: 1000 });
  } catch (_) { return []; }
  const encaja = encajaSimbolo(simbolo);
  return todas.filter(n => {
    if (graves && !esGrave(n)) return false;
    if (!simbolo) return true;
    const nombrados = [...(n.simbolos || []), ...(Array.isArray(n.clasificacion) ? n.clasificacion.map(c => c && c.simbolo) : []),
      ...(n.veto && Array.isArray(n.veto.simbolos) ? n.veto.simbolos : n.veto ? [n.veto.simbolo] : [])];
    return nombrados.some(encaja);
  }).slice(0, limite);
}

// ---------- decisiones ----------

// Las decisiones de ciertos tipos, leyendo la cola del fichero (las de tipo
// raro, como el laboratorio, están entre cientos de órdenes y comités).
function decisionesDe(carpeta, tipos, { lineas = MAX_LINEAS } = {}) {
  const set = new Set(tipos);
  return leerCola(registros.rutas(carpeta).decisiones, { lineas }).filter(d => d && set.has(d.tipo) && Number.isFinite(d.t));
}

function decisiones(carpeta, params) {
  try { return registros.consultar(carpeta, 'decisiones', params); } catch (_) { return []; }
}

module.exports = {
  MAX_LINEAS, MAX_PUNTOS, MIN_PUNTOS,
  leerCola, vaciarCache, indicesLTTB, indicesConExtremos, reducir, numero, texto, esSuceso, historialReducido, historial,
  encajaSimbolo, noticias, decisiones, decisionesDe,
};
