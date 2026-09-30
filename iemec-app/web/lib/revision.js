'use strict';
// Lo que se revisa de cada página ya pintada: texto visible, atributos que se leen o se envían,
// enlaces (y el texto de WhatsApp), nombres de archivo y datos estructurados. Todo pasa por las
// prohibidas de normas.json: en la web todo cuenta como publicidad.
const { prohibidasEn, comoTexto } = require('./normas');

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
function decodificar(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

function textoVisible(html) {
  const cuerpo = html.replace(/<head>[\s\S]*?<\/head>/i, ' ');
  return decodificar(cuerpo
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

const titulo = (html) => decodificar((/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
const meta = (html, nombre) => decodificar((new RegExp(`<meta name="${nombre}" content="([^"]*)"`, 'i').exec(html) || [])[1] || '');
const canonical = (html) => (/<link rel="canonical" href="([^"]*)"/i.exec(html) || [])[1] || '';
const h1s = (html) => (html.match(/<h1[\s>]/gi) || []).length;

function atributos(html, nombres = ['alt', 'title', 'aria-label', 'placeholder', 'content', 'value', 'data-p', 'data-e']) {
  const salida = [];
  const re = new RegExp(`\\s(${nombres.join('|')})="([^"]*)"`, 'gi');
  let m;
  while ((m = re.exec(html))) salida.push({ nombre: m[1], valor: decodificar(m[2]) });
  return salida;
}

function enlaces(html) {
  const salida = [];
  const re = /\s(href|src|action)="([^"]*)"/gi;
  let m;
  while ((m = re.exec(html))) salida.push({ nombre: m[1], valor: decodificar(m[2]) });
  const rs = /\ssrcset="([^"]*)"/gi;
  while ((m = rs.exec(html))) for (const parte of decodificar(m[1]).split(',')) salida.push({ nombre: 'srcset', valor: parte.trim().split(/\s+/)[0] });
  return salida;
}

function whatsapps(html) {
  return enlaces(html).filter((e) => e.valor.startsWith('https://wa.me/')).map((e) => {
    const u = new URL(e.valor);
    return { url: e.valor, texto: u.searchParams.get('text') || '' };
  });
}

function jsonld(html) {
  const salida = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) salida.push(m[1]);
  return salida;
}

// Cadenas de un JSON (valores de texto).
function cadenas(v, salida = []) {
  if (typeof v === 'string') salida.push(v);
  else if (Array.isArray(v)) v.forEach((x) => cadenas(x, salida));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => cadenas(x, salida));
  return salida;
}

// Todo lo que se revisa de una página, con de dónde sale.
function piezas(html, ruta) {
  const salida = [];
  salida.push({ donde: 'texto visible', texto: textoVisible(html) });
  salida.push({ donde: '<title>', texto: titulo(html) });
  salida.push({ donde: 'meta description', texto: meta(html, 'description') });
  salida.push({ donde: 'URL', texto: comoTexto(ruta) });
  for (const a of atributos(html)) {
    const identificador = a.nombre === 'value' || a.nombre === 'data-p' || a.nombre === 'data-e';
    salida.push({ donde: `atributo ${a.nombre}`, texto: identificador ? comoTexto(a.valor) : a.valor });
  }
  for (const e of enlaces(html)) {
    if (e.valor.startsWith('https://wa.me/')) continue;
    if (e.valor.startsWith('/') || e.valor.startsWith('#')) salida.push({ donde: `enlace ${e.nombre}`, texto: comoTexto(e.valor.split('?')[0]) });
  }
  for (const w of whatsapps(html)) salida.push({ donde: 'texto de WhatsApp', texto: w.texto });
  for (const j of jsonld(html)) {
    try { for (const c of cadenas(JSON.parse(j))) salida.push({ donde: 'JSON-LD', texto: /^https?:/.test(c) ? comoTexto(new URL(c).pathname) : c }); } catch { salida.push({ donde: 'JSON-LD', texto: j }); }
  }
  return salida;
}

function revisarPagina(html, ruta, normas, { permitir = [] } = {}) {
  const fallos = [];
  for (const p of piezas(html, ruta)) {
    for (const f of prohibidasEn(p.texto, normas, permitir)) fallos.push({ ruta, donde: p.donde, coincidencia: f.coincidencia, motivo: f.motivo });
  }
  return fallos;
}

module.exports = { textoVisible, titulo, meta, canonical, h1s, atributos, enlaces, whatsapps, jsonld, piezas, revisarPagina, decodificar, cadenas };
