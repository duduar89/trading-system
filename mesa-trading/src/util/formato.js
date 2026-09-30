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

// Hora local HH:MM de un instante (el panel la enseña en la hora del portátil).
function hora(t, zona = 'Europe/Madrid') {
  return new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: zona }).format(new Date(t));
}

module.exports = { usd, pct, precio, cantidad, numero, hora };
