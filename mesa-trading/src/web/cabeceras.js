'use strict';
// Cabeceras de seguridad del modo web (ARQUITECTURA-WEB W3).
//
// - Strict-Transport-Security: la app vive detrás de LiteSpeed con SSL; el
//   navegador no vuelve a probar por http.
// - Content-Security-Policy con solo recursos propios y frame-ancestors 'none'
//   (nadie puede meter el panel en un iframe para engañar un clic en «Kill»).
//   Los <script> en línea de las páginas propias (el <base> de index.html) se
//   admiten por su SHA-256, calculado al arrancar leyendo los HTML de web/:
//   si alguien cambia el script, la huella cambia con él.
// - nosniff, Referrer-Policy same-origin, X-Frame-Options (navegadores viejos).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Huellas 'sha256-…' de los <script> sin src de los HTML de la carpeta.
function huellasScriptsEnLinea(raizWeb) {
  const huellas = new Set();
  let ficheros = [];
  try { ficheros = fs.readdirSync(raizWeb).filter(f => f.endsWith('.html')); } catch (_) { return []; }
  for (const f of ficheros) {
    let html;
    try { html = fs.readFileSync(path.join(raizWeb, f), 'utf8'); } catch (_) { continue; }
    const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      if (m[1] && /\ssrc\s*=/i.test(m[1])) continue;
      huellas.add(`'sha256-${crypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
    }
  }
  return [...huellas].sort();
}

function politicaCSP(huellas = []) {
  return [
    "default-src 'self'",
    `script-src 'self'${huellas.length ? ' ' + huellas.join(' ') : ''}`,
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function crearCabeceras(raizWeb) {
  const csp = politicaCSP(huellasScriptsEnLinea(raizWeb));
  const fijas = {
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': csp,
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  };
  return {
    csp,
    fijas,
    poner(res) { for (const [k, v] of Object.entries(fijas)) res.setHeader(k, v); },
  };
}

module.exports = { crearCabeceras, huellasScriptsEnLinea, politicaCSP };
