'use strict';
// Las normas de publicidad sanitaria (web/datos/normas.json, copia de la carpeta compartida) más la
// lista base de validar-contenido.py, que normas.json amplía sin contradecir. Los patrones valen igual
// en JavaScript (flag i, sin u) y en Python (re.I).
const fs = require('fs');
const path = require('path');

const RUTA = path.join(__dirname, '..', 'datos', 'normas.json');

// Copia literal de PROHIBIDAS_BASE de validar-contenido.py. «precio» se puede permitir en la página de
// tarjetas regalo: el importe es el producto, no el precio de un tratamiento.
const BASE = [
  ['toxina\\s+botul', 'medicamento de receta'],
  ['\\bb[oó]tox', 'medicamento de receta (marca)'],
  ['vistabel|azzalure|bocouture|dysport|xeomin|letybo|alluzience|relfydess', 'marca de toxina'],
  ['semaglutid|tirzepatid|liraglutid|ozempic|wegovy|mounjaro|saxenda|rybelsus', 'medicamento de receta (GLP-1)'],
  ['finasterid|dutasterid|minoxidil\\s+oral', 'medicamento de receta'],
  ['juv[eé]derm|restylane|radiesse|sculptra|profhilo|harmonyca|ellans[eé]|belotero|teosyal|stylage|saypha|revolax|sunekos|jalupro', 'marca de producto sanitario'],
  ['garantizad|garant[ií]a\\s+de\\s+resultado', 'promesa de resultado'],
  ['\\bpara\\s+siempre\\b|\\bdefinitiv[oa]s?\\b', 'promesa de resultado'],
  ['sin\\s+riesgos?\\b|sin\\s+efectos\\s+secundarios|100\\s*%\\s*segur', 'promesa de seguridad'],
  ['\\bindolor[oa]?\\b', 'promesa (usar «molestias mínimas»)'],
  ['\\bel\\s+mejor\\b|\\bla\\s+mejor\\b|\\blos\\s+mejores\\b|\\blas\\s+mejores\\b', 'superlativo comparativo'],
  ['resultados?\\s+inmediatos?', 'promesa de resultado'],
  ['\\d+\\s*(kg|kilos?)\\s+en\\s+\\d+', 'cifra de resultado'],
  ['hasta\\s+\\d+\\s*(kg|kilos?)', 'cifra de resultado'],
  ['antes\\s+y\\s+despu[eé]s', 'antes y después'],
  ['\\d+\\s*€|\\beuros?\\b', 'precio (no se publican en esta versión)', 'precio'],
];

// En JavaScript, \b solo entiende letras ASCII: «La mejoría» daría «la mejor» porque la «í» cuenta
// como separador. Python (el validador de los redactores) usa letras Unicode. Para que los dos digan
// lo mismo, \b pasa a ser un límite de palabra Unicode (con la flag u); si un patrón no compila así,
// se queda como estaba.
const LETRA = '[\\p{L}\\p{N}_]';
const LIMITE = `(?:(?<=${LETRA})(?!${LETRA})|(?<!${LETRA})(?=${LETRA}))`;
function compilar(patron) {
  const unicode = patron.replace(/(\\\\)|\\b/g, (m, doble) => (doble ? m : LIMITE));
  try { return new RegExp(unicode, 'iu'); } catch { return new RegExp(patron, 'i'); }
}

function cargarNormas(ruta = RUTA) {
  const n = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const prohibidas = BASE.map(([patron, motivo, clave]) => ({ patron, motivo, clave: clave || null, re: compilar(patron), base: true }));
  for (const r of n.prohibidas || []) prohibidas.push({ patron: r.patron, motivo: r.motivo, alternativa: r.alternativa, clave: null, re: compilar(r.patron) });
  const avisos = (n.avisos || []).map((r) => ({ patron: r.patron, motivo: r.motivo, re: compilar(r.patron) }));
  const obligatorias = (n.obligatorias || []).map((r) => ({ donde: r.donde, patron: r.texto_o_patron, motivo: r.motivo, re: compilar(r.texto_o_patron) }));
  return { version: n._version, prohibidas, avisos, obligatorias };
}

// Lo que se prohíbe en un texto. `permitir`: claves de la lista base que no aplican (p. ej. «precio»).
function prohibidasEn(txt, normas, permitir = []) {
  const fallos = [];
  if (!txt) return fallos;
  for (const r of normas.prohibidas) {
    if (r.clave && permitir.includes(r.clave)) continue;
    const m = r.re.exec(txt);
    if (m) fallos.push({ coincidencia: m[0], motivo: r.motivo, patron: r.patron });
  }
  return fallos;
}

function avisosEn(txt, normas) {
  const salida = [];
  if (!txt) return salida;
  for (const r of normas.avisos) {
    const m = r.re.exec(txt);
    if (m) salida.push({ coincidencia: m[0], motivo: r.motivo });
  }
  return salida;
}

const limpio = (txt, normas, permitir) => prohibidasEn(txt, normas, permitir).length === 0;
// Un identificador o una URL se mira con espacios en vez de guiones (como validar-contenido.py).
const comoTexto = (s) => String(s || '').replace(/[-_/.]+/g, ' ');

module.exports = { cargarNormas, prohibidasEn, avisosEn, limpio, comoTexto, compilar };
