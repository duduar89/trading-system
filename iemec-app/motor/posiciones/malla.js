'use strict';
// La malla de posiciones: puntos alrededor de la clínica desde los que se mira en qué puesto sale en
// Google Maps (con DataForSEO) y las cifras de cada pasada. Sin base de datos ni red.
//
// Por defecto, 7 × 7 puntos separados 1,5 km (unos 9 × 9 km: Boadilla entera, Villaviciosa y el borde
// de Majadahonda y Pozuelo), más el centro de los 4 municipios de alrededor, y las 12 búsquedas del
// informe de búsqueda local. El zoom se fija (15z) y no se toca: cambia los resultados.
// Los puntos se nombran por su fila (norte +, sur −) y su columna (este +, oeste −): «f+2c-2» está 3
// km al norte y 3 km al oeste de la clínica; «f0c0» es la clínica.

// Coordenadas públicas de la ficha de la clínica en Google Maps (29-09-2026): el centro de la malla si
// la base no tiene otro.
const CENTRO_CLINICA = { lat: 40.4066059, lng: -3.9001441 };
const MUNICIPIOS = [
  { id: 'majadahonda', lat: 40.4735, lng: -3.8718 },
  { id: 'pozuelo', lat: 40.435, lng: -3.8138 },
  { id: 'las-rozas', lat: 40.4929, lng: -3.8737 },
  { id: 'villaviciosa', lat: 40.3571, lng: -3.9003 },
];
// Lo que busca la gente (informe de búsqueda local, 30-09-2026). Se revisa cada mes con las palabras
// que dé la Performance API. Medir en qué puesto sale una búsqueda no es anunciar nada.
const PALABRAS = [
  'medicina estética', 'clínica estética', 'médico estético', 'botox', 'ácido hialurónico', 'injerto capilar',
  'clínica capilar', 'mesoterapia capilar', 'láser fotona', 'hifu facial', 'lipoláser', 'head spa',
];

// Metros por grado de latitud y de longitud a esa latitud (elipsoide WGS84).
function metrosPorGrado(lat) {
  const f = (lat * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f) - 0.0023 * Math.cos(6 * f),
    lng: 111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f) + 0.118 * Math.cos(5 * f),
  };
}

const signo = (n) => (n > 0 ? `+${n}` : String(n));
// DataForSEO admite 7 decimales como mucho (1 cm).
const siete = (x) => Math.round(x * 1e7) / 1e7;

/**
 * Los puntos de la malla, de norte a sur y de oeste a este.
 * @param {object} o { centro: { lat, lng }, lado: puntos por lado (impar), pasoKm }
 * @returns {Array<{ id, fila, columna, lat, lng }>}
 */
function malla({ centro = CENTRO_CLINICA, lado = 7, pasoKm = 1.5 } = {}) {
  if (!Number.isInteger(lado) || lado < 1 || lado > 15 || lado % 2 === 0) throw new Error('La malla lleva un número impar de puntos por lado, de 1 a 15');
  if (!(pasoKm > 0 && pasoKm <= 10)) throw new Error('La separación entre puntos va de 0 a 10 km');
  const lat = Number(centro?.lat);
  const lng = Number(centro?.lng);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw new Error('El centro de la malla no es una coordenada');
  const m = metrosPorGrado(lat);
  const dLat = (pasoKm * 1000) / m.lat;
  const dLng = (pasoKm * 1000) / m.lng;
  const k = (lado - 1) / 2;
  const puntos = [];
  for (let f = k; f >= -k; f--) {
    for (let c = -k; c <= k; c++) puntos.push({ id: `f${signo(f)}c${signo(c)}`, fila: f, columna: c, lat: siete(lat + f * dLat), lng: siete(lng + c * dLng) });
  }
  return puntos;
}

// «lat,lng,zoom» para DataForSEO (location_coordinate de Google Maps: zoom de 3z a 21z).
function coordenada(p, zoom = 15) {
  if (!Number.isInteger(zoom) || zoom < 3 || zoom > 21) throw new Error('El zoom va de 3 a 21');
  return `${Number(p.lat).toFixed(7)},${Number(p.lng).toFixed(7)},${zoom}z`;
}

// Lo que cuesta una búsqueda: DataForSEO cobra cada página de resultados (en móvil, 20 por página).
function costeTarea({ profundidad = 20, precioPagina = 0.0006, porPagina = 20 } = {}) {
  return Math.ceil(profundidad / porPagina) * precioPagina;
}

// El puesto de la clínica entre los resultados (por su place ID, cualquiera de los que se le conocen,
// o su CID); null si no sale. Google puede cambiar el place ID de una ficha: por eso pueden ser varios.
function puestoDe(items = [], { placeId = null, placeIds = [], cid = null } = {}) {
  const ids = new Set([placeId, ...placeIds].filter(Boolean));
  const x = items.find((i) => (i.placeId && ids.has(i.placeId)) || (cid && i.cid != null && String(i.cid) === String(cid)));
  return x ? x.puesto : null;
}

const media = (lista) => (lista.length ? Math.round((lista.reduce((s, x) => s + x, 0) / lista.length) * 10) / 10 : null);

/**
 * Las cifras de una pasada, por búsqueda: en cuántos puntos sale, su puesto medio donde sale, el
 * puesto medio contando «profundidad + 1» donde no sale, el % de puntos en el top 3 y quién es el 1.º
 * donde no lo es la clínica.
 * @param {Array<{ palabra, punto, puesto: number|null, primero: string|null }>} filas
 */
function resumirPasada(filas = [], { profundidad = 20 } = {}) {
  const porPalabra = new Map();
  for (const f of filas) {
    if (!porPalabra.has(f.palabra)) porPalabra.set(f.palabra, []);
    porPalabra.get(f.palabra).push(f);
  }
  return [...porPalabra].map(([palabra, l]) => {
    const con = l.filter((x) => x.puesto != null);
    const rivales = new Map();
    for (const x of l) if (x.puesto !== 1 && x.primero) rivales.set(x.primero, (rivales.get(x.primero) || 0) + 1);
    return {
      palabra,
      puntos: l.length,
      conPuesto: con.length,
      puestoMedio: media(con.map((x) => x.puesto)),
      puestoMedioTotal: media(l.map((x) => (x.puesto == null ? profundidad + 1 : x.puesto))),
      top3: l.length ? Math.round((con.filter((x) => x.puesto <= 3).length / l.length) * 100) : 0,
      primero: con.filter((x) => x.puesto === 1).length,
      rivales: [...rivales].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([nombre, puntos]) => ({ nombre, puntos })),
    };
  });
}

// El puesto en cada punto de la malla, fila a fila de norte a sur (para pintar la cuadrícula).
function cuadricula(filas = [], { lado = 7 } = {}) {
  const k = (lado - 1) / 2;
  const porPunto = new Map(filas.map((f) => [f.punto, f.puesto ?? null]));
  const salida = [];
  for (let f = k; f >= -k; f--) {
    const fila = [];
    for (let c = -k; c <= k; c++) fila.push(porPunto.get(`f${signo(f)}c${signo(c)}`) ?? null);
    salida.push(fila);
  }
  return salida;
}

module.exports = { CENTRO_CLINICA, MUNICIPIOS, PALABRAS, metrosPorGrado, malla, coordenada, costeTarea, puestoDe, resumirPasada, cuadricula };
