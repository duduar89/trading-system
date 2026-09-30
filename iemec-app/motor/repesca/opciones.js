'use strict';
// Le preguntamos el nivel o la técnica de un tratamiento que agrupa varios («Del Head Spa japonés
// tenemos: Express, Detox Purificante, Synergie o Zen Premium. ¿Cuál te interesa?»). ¿Cuál elige?
//
//   por su nombre o un alias          «el Head Spa Detox Purificante»
//   por lo que lo distingue           «el detox», «quiero el zen»
//   por su orden                      «la primera», «el último»
//   nada de eso, dos a la vez o «ninguno» → null (no se adivina: sigue la repesca o una persona)
//
// Sin base de datos: las opciones llegan ya cargadas ([{ id, nombre, alias }]), en el orden en que
// se le dijeron.
const { normalizar } = require('./interpretar');

const ORDINALES = [
  [/\b(el primero|la primera|el primer|primera opcion|opcion 1)\b/, 0],
  [/\b(el segundo|la segunda|segunda opcion|opcion 2)\b/, 1],
  [/\b(el tercero|la tercera|el tercer|tercera opcion|opcion 3)\b/, 2],
  [/\b(el cuarto|la cuarta|cuarta opcion|opcion 4)\b/, 3],
  [/\b(el quinto|la quinta|quinta opcion|opcion 5)\b/, 4],
  [/\b(el ultimo|la ultima|ultima opcion)\b/, -1],
];
// Un número a secas («2», «la 2») solo si no dice nada más: «el 2 de noviembre» es una fecha.
const SOLO_NUMERO = /^(?:el |la |opcion )?([1-5])$/;
const NINGUNA = /\b(ninguno|ninguna|ni uno ni otro|no me interesa|ninguno me|no se|no lo se)\b/;
// Palabras que no distinguen nada.
const VACIAS = new Set(['con', 'para', 'por', 'del', 'los', 'las', 'una', 'uno', 'que', 'sin', 'mas', 'tratamiento', 'tratamientos',
  'sesion', 'sesiones', 'facial', 'corporal', 'capilar', 'quiero', 'prefiero', 'mejor', 'este', 'esta', 'ese', 'esa']);

const palabras = (t) => normalizar(t).replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((p) => p.length >= 3 && !VACIAS.has(p));

function aliasDe(o) {
  let a = o.alias;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = []; } }
  return Array.isArray(a) ? a.map(String) : [];
}

/**
 * @param {string} texto  lo que contesta
 * @param {Array} opciones [{ id, nombre, alias }] en el orden en que se le dijeron
 * @param {object} o { porOrden: false si aún no se le han dicho (entonces «la primera» no es ninguna) }
 * @returns la opción elegida o null
 */
function elegirOpcion(texto, opciones, { porOrden = true } = {}) {
  const lista = Array.isArray(opciones) ? opciones.filter(Boolean) : [];
  if (!lista.length) return null;
  const t = normalizar(texto).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!t || NINGUNA.test(t)) return null;

  if (porOrden) {
    const numero = SOLO_NUMERO.exec(t);
    const orden = numero ? [Number(numero[1]) - 1] : ORDINALES.filter(([rx]) => rx.test(t)).map(([, i]) => (i === -1 ? lista.length - 1 : i));
    if (orden.length === 1 && lista[orden[0]]) return lista[orden[0]];
  }

  // Por lo que distingue a cada una de las demás: las palabras de su nombre y sus alias que no
  // tiene ninguna otra.
  const suyas = lista.map((o) => new Set([o.nombre, ...aliasDe(o)].flatMap(palabras)));
  const dichas = new Set(palabras(t));
  const puntos = suyas.map((s, i) => [...s].filter((p) => dichas.has(p) && !suyas.some((otra, j) => j !== i && otra.has(p))).length);
  const max = Math.max(...puntos);
  if (max > 0 && puntos.filter((p) => p === max).length === 1) return lista[puntos.indexOf(max)];
  return null;
}

// «A, B, C o D»
function textoOpciones(nombres) {
  const l = nombres.filter(Boolean);
  return l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} o ${l.at(-1)}`;
}

module.exports = { elegirOpcion, textoOpciones };
