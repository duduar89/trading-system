'use strict';
// Formato de cifras en español de España para los mensajes de los agentes:
// 99.999 $ · -1,25 % · 0,0123 BTC. Solo para texto; los cálculos van con números.

const nf = (min, max) => new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: true,
});
const F0 = nf(0, 0);
const F2 = nf(2, 2);

// Intl en es-ES no agrupa miles en números de 4 cifras (1234 → "1234"); en
// cifras de dinero lo queremos siempre (1.234 $), así que se agrupa a mano.
// Un cero redondeado no lleva signo: «-0,00 %» (un −0 o un −0,00001) se lee
// como una pérdida que no existe.
const hayDigito = texto => /[1-9]/.test(texto);
function agrupar(texto) {
  const [ent, dec] = texto.split(',');
  const signo = ent.startsWith('-') && hayDigito(texto) ? '-' : '';
  const digitos = ent.replace(/^-/, '').replace(/\./g, '');
  const conPuntos = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return signo + conPuntos + (dec !== undefined ? ',' + dec : '');
}

// Dólares: sin decimales a partir de 1.000, con dos por debajo.
function usd(x, { signo = false } = {}) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const abs = Math.abs(x);
  const cuerpo = agrupar(abs >= 1000 ? F0.format(x) : F2.format(x));
  const pref = signo && x > 0 && hayDigito(cuerpo) ? '+' : '';
  return `${pref}${cuerpo} $`;
}

// Fracción → porcentaje: 0.0125 → "1,25 %".
function pct(fraccion, { decimales = 2, signo = false } = {}) {
  if (fraccion === null || fraccion === undefined || !Number.isFinite(fraccion)) return '—';
  const v = fraccion * 100;
  const cuerpo = agrupar(nf(decimales, decimales).format(v));
  const pref = signo && v > 0 && hayDigito(cuerpo) ? '+' : '';
  return `${pref}${cuerpo} %`;
}

// Precio de un activo: más decimales cuanto más barato (DOGE 0,1234; BTC 83.547).
function precio(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const abs = Math.abs(x);
  const dec = abs >= 1000 ? 0 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4;
  return agrupar(nf(dec, dec).format(x));
}

function cantidad(x, maxDecimales = 6) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return agrupar(nf(0, maxDecimales).format(x));
}

function numero(x, decimales = 0) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return agrupar(nf(decimales, decimales).format(x));
}

// Factor «×0,25»: hasta tres decimales, sin ceros de más (cifras.factorTexto del panel).
function factor(f) {
  if (f === null || f === undefined || !Number.isFinite(f)) return '—';
  return `×${agrupar(nf(0, 3).format(f))}`;
}

// Hora local HH:MM de un instante (el panel la enseña en la hora del portátil).
function hora(t, zona = 'Europe/Madrid') {
  return new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: zona }).format(new Date(t));
}

// Día de calendario «AAAA-MM-DD» de un instante en la zona dada.
function dia(t, zona = 'Europe/Madrid') {
  const partes = {};
  for (const p of new Intl.DateTimeFormat('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zona }).formatToParts(new Date(t))) partes[p.type] = p.value;
  return `${partes.year}-${partes.month}-${partes.day}`;
}

// «5 oct»: la fecha corta del feed del panel (web/js/cifras.js).
function fechaCorta(t, zona = 'Europe/Madrid') {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: zona }).format(new Date(t)).replace(/\.$/, '');
}

// «5 oct 2026»: la fecha para leer en frases (el semáforo). «2026-10-05» se
// corta mal en el móvil y se lee peor.
function fechaLarga(t, zona = 'Europe/Madrid') {
  const partes = {};
  for (const p of new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: zona }).formatToParts(new Date(t))) partes[p.type] = p.value;
  return `${partes.day} ${String(partes.month).replace(/\.$/, '')} ${partes.year}`;
}

// Un instante contado para quien mira «ahora» (el reloj de la mesa): «21:55»
// si es del mismo día y «3 oct 21:55» si no. El mismo formato que el feed
// (cifras.momento): una directiva de 72 h que acaba «a las 21:55» se leía
// como de hoy y parecía caducada.
function momento(t, ahora, zona = 'Europe/Madrid') {
  if (Number.isFinite(ahora) && dia(t, zona) === dia(ahora, zona)) return hora(t, zona);
  return `${fechaCorta(t, zona)} ${hora(t, zona)}`;
}

// Lo que va detrás de «hasta»: «las 21:55» hoy, «el 3 oct 21:55» otro día.
function hastaLas(t, ahora, zona = 'Europe/Madrid') {
  if (Number.isFinite(ahora) && dia(t, zona) === dia(ahora, zona)) return `las ${hora(t, zona)}`;
  return `el ${momento(t, ahora, zona)}`;
}

module.exports = { usd, pct, precio, cantidad, numero, factor, hora, dia, fechaCorta, fechaLarga, momento, hastaLas };
