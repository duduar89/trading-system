#!/usr/bin/env node
'use strict';
// Servidor estático mínimo para ver la web en local, con URL limpias como en Apache:
//   node web/servir.js [puerto] [carpeta]      (por defecto 4321 y web/dist)
// /ruta/ sirve /ruta/index.html; /ruta (carpeta) redirige a /ruta/; lo que no existe da 404.html con
// estado 404. Aplica las RewriteRule 301 del .htaccess generado y manda sus cabeceras de seguridad
// (la CSP, sin upgrade-insecure-requests, que en http://localhost no tiene sentido).
const http = require('http');
const fs = require('fs');
const path = require('path');

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};

function leerHtaccess(carpeta) {
  const ruta = path.join(carpeta, '.htaccess');
  const reglas = [];
  let csp = null;
  if (!fs.existsSync(ruta)) return { reglas, csp };
  for (const linea of fs.readFileSync(ruta, 'utf8').split('\n')) {
    const r = /^\s*RewriteRule "([^"]+)" "([^"]+)" \[R=301,L(,NC)?\]/.exec(linea);
    if (r) reglas.push({ re: new RegExp(r[1], r[3] ? 'i' : ''), hacia: r[2] });
    const c = /Header always set Content-Security-Policy "([^"]+)"/.exec(linea);
    if (c) csp = c[1].split(';').map((x) => x.trim()).filter((x) => x && x !== 'upgrade-insecure-requests').join('; ');
  }
  return { reglas, csp };
}

function crearServidor(carpeta) {
  const raiz = path.resolve(carpeta);
  const { reglas, csp } = leerHtaccess(raiz);
  return http.createServer((req, res) => {
    const cabeceras = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' };
    if (csp) cabeceras['Content-Security-Policy'] = csp;
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
    let ruta;
    try { ruta = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
    const sinBarra = ruta.replace(/^\//, '');
    for (const r of reglas) {
      if (r.re.test(sinBarra)) { res.writeHead(301, { ...cabeceras, Location: r.hacia + url.search }); res.end(); return; }
    }
    if (/(^|\/)\.|informe\.json$/.test(sinBarra)) { res.writeHead(403, cabeceras); res.end('Prohibido'); return; }
    let archivo = path.join(raiz, ruta);
    if (!archivo.startsWith(raiz)) { res.writeHead(403, cabeceras); res.end(); return; }
    if (fs.existsSync(archivo) && fs.statSync(archivo).isDirectory()) {
      if (!ruta.endsWith('/')) { res.writeHead(301, { ...cabeceras, Location: `${ruta}/${url.search}` }); res.end(); return; }
      archivo = path.join(archivo, 'index.html');
    }
    let estado = 200;
    if (!fs.existsSync(archivo)) { estado = 404; archivo = path.join(raiz, '404.html'); }
    const tipo = TIPOS[path.extname(archivo)] || 'application/octet-stream';
    const cache = /^\/(fuentes|fotos|recursos)\//.test(ruta) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(estado, { ...cabeceras, 'Content-Type': tipo, 'Cache-Control': cache });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(archivo).pipe(res);
  });
}

if (require.main === module) {
  const puerto = Number(process.argv[2]) || 4321;
  const carpeta = process.argv[3] || path.join(__dirname, 'dist');
  if (!fs.existsSync(path.join(carpeta, 'index.html'))) {
    console.error(`No hay web construida en ${carpeta}: ejecuta antes «npm run web».`);
    process.exit(1);
  }
  crearServidor(carpeta).listen(puerto, '127.0.0.1', () => console.log(`Web de IEMEC en http://localhost:${puerto}/ (carpeta ${path.relative(process.cwd(), carpeta) || '.'})`));
}

module.exports = { crearServidor, leerHtaccess };
