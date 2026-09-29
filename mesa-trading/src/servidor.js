'use strict';
// Servidor del panel (§7) con node:http, sin dependencias.
//
// - Estáticos de web/ en «/» y en «/web/*», con su tipo MIME y sin poder salir
//   de la carpeta (../ o rutas absolutas codificadas se rechazan).
// - GET /api/estado, /api/mensajes?desde=, /api/operaciones, /api/costes-llm.
// - SSE en /api/eventos: 'estado' (como mucho uno cada 2 s reales, lo limita
//   el orquestador), 'mensaje', 'agente', 'ejecucion' y 'ping' cada 15 s. Al
//   cerrar la conexión se quitan sus oyentes.
// - POST /api/comando/<nombre> con cuerpo JSON de 64 KB como mucho.
// - Con PANEL_TOKEN, todo /api/* pide el token en x-panel-token o ?token=
//   (EventSource no admite cabeceras). Escucha en 127.0.0.1 por defecto.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { leerJSONL } = require('./util/almacen');
const { diaUTC } = require('./util/reloj');
const log = require('./util/log').crear('servidor');

const MAX_CUERPO = 64 * 1024;
const PING_MS = 15_000;
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
});
const COMANDOS_GET = new Set(['ajustes']);

function tokenIgual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function enviarJSON(res, status, cuerpo) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(texto),
  });
  res.end(texto);
}

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    let total = 0;
    const trozos = [];
    let pasado = false;
    req.on('data', trozo => {
      if (pasado) return;
      total += trozo.length;
      if (total > MAX_CUERPO) {
        pasado = true;
        const e = new Error(`cuerpo de más de ${MAX_CUERPO / 1024} KB`);
        e.status = 413;
        rechazar(e);
        req.resume();
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => { if (!pasado) resolver(Buffer.concat(trozos).toString('utf8')); });
    req.on('error', rechazar);
  });
}

// Ruta de un estático dentro de web/, o null si intenta salir de la carpeta.
// Además de «/» y «/web/*» (§7) se sirven las demás rutas desde web/: servida
// en «/», index.html pone su <base href="/web/"> con document.write, pero el
// escáner de precarga del navegador pide antes css/ y js/ relativos a «/», y
// esas 404 salían como errores de consola.
function rutaEstatica(raizWeb, rutaUrl) {
  let rel;
  try { rel = decodeURIComponent(rutaUrl); } catch (_) { return null; }
  if (rel.includes('\0') || !rel.startsWith('/')) return null;
  if (rel === '/' || rel === '/web' || rel === '/web/') rel = '/index.html';
  else if (rel.startsWith('/web/')) rel = rel.slice(4);
  const destino = path.resolve(raizWeb, '.' + path.posix.normalize(rel));
  if (destino !== raizWeb && !destino.startsWith(raizWeb + path.sep)) return null;
  return destino;
}

function costesLLM(ruta) {
  const porDia = {};
  const porProposito = {};
  let total = 0;
  let llamadas = 0;
  for (const r of leerJSONL(ruta)) {
    if (!r || !Number.isFinite(r.t)) continue;
    const coste = Number(r.costeUsd) || 0;
    const dia = diaUTC(r.t);
    const d = porDia[dia] || (porDia[dia] = { usd: 0, llamadas: 0 });
    d.usd += coste; d.llamadas += 1;
    const p = porProposito[r.proposito || 'otro'] || (porProposito[r.proposito || 'otro'] = { usd: 0, llamadas: 0 });
    p.usd += coste; p.llamadas += 1;
    total += coste; llamadas += 1;
  }
  return { totalUsd: total, llamadas, porDia, porProposito };
}

function crearServidor({ orquestador, raizWeb, carpetaDatos, token = '', pingMs = PING_MS } = {}) {
  if (!orquestador) throw new Error('crearServidor necesita el orquestador');
  const web = path.resolve(raizWeb);
  const clientes = new Set();

  function autorizado(req, url) {
    if (!token) return true;
    return tokenIgual(req.headers['x-panel-token'], token) || tokenIgual(url.searchParams.get('token'), token);
  }

  function sse(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const enviar = (evento, datos) => {
      try { res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`); } catch (_) { /* conexión ya cerrada */ }
    };
    res.write('retry: 3000\n\n');
    enviar('estado', orquestador.instantanea());
    const oyentes = {
      estado: x => enviar('estado', x),
      mensaje: x => enviar('mensaje', x),
      agente: x => enviar('agente', x),
      ejecucion: x => enviar('ejecucion', x),
    };
    for (const [ev, fn] of Object.entries(oyentes)) orquestador.on(ev, fn);
    const ping = setInterval(() => enviar('ping', { t: Date.now() }), pingMs);
    const cliente = { res, cerrar: () => res.end() };
    clientes.add(cliente);
    const limpiar = () => {
      clearInterval(ping);
      for (const [ev, fn] of Object.entries(oyentes)) orquestador.off(ev, fn);
      clientes.delete(cliente);
    };
    req.on('close', limpiar);
    res.on('error', limpiar);
  }

  async function api(req, res, url) {
    const ruta = url.pathname;
    if (!autorizado(req, url)) return enviarJSON(res, 401, { ok: false, mensaje: 'Falta el token del panel (PANEL_TOKEN).' });
    if (req.method === 'GET' && ruta === '/api/estado') return enviarJSON(res, 200, orquestador.instantanea());
    if (req.method === 'GET' && ruta === '/api/eventos') return sse(req, res);
    if (req.method === 'GET' && ruta === '/api/mensajes') {
      const desde = Number(url.searchParams.get('desde'));
      return enviarJSON(res, 200, orquestador.bus.desde(Number.isFinite(desde) ? desde : -Infinity));
    }
    if (req.method === 'GET' && ruta === '/api/operaciones') return enviarJSON(res, 200, orquestador.operaciones.slice(-200));
    if (req.method === 'GET' && ruta === '/api/costes-llm') return enviarJSON(res, 200, costesLLM(path.join(carpetaDatos || orquestador.carpeta, 'llm-costes.jsonl')));
    const m = /^\/api\/comando\/([a-z-]+)$/.exec(ruta);
    if (m) {
      const nombre = m[1];
      if (req.method === 'GET') {
        if (!COMANDOS_GET.has(nombre)) return enviarJSON(res, 405, { ok: false, mensaje: 'Los comandos van por POST.' });
        const r = await orquestador.comando(nombre, null);
        const { codigo, ...cuerpo } = r;
        return enviarJSON(res, codigo || 200, cuerpo);
      }
      if (req.method !== 'POST') return enviarJSON(res, 405, { ok: false, mensaje: 'Método no admitido.' });
      let datos = {};
      try {
        const texto = await leerCuerpo(req);
        datos = texto.trim() ? JSON.parse(texto) : {};
        if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw Object.assign(new Error('el cuerpo tiene que ser un objeto JSON'), { status: 400 });
      } catch (e) {
        return enviarJSON(res, e.status || 400, { ok: false, mensaje: e.status === 413 ? `Cuerpo demasiado grande (máx. ${MAX_CUERPO / 1024} KB).` : `JSON no válido: ${e.message}` });
      }
      const r = await orquestador.comando(nombre, datos);
      const { codigo, ...cuerpo } = r;
      return enviarJSON(res, codigo || 200, cuerpo);
    }
    return enviarJSON(res, 404, { ok: false, mensaje: 'Ruta desconocida.' });
  }

  function estatico(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const destino = rutaEstatica(web, url.pathname);
    if (!destino) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No existe.'); return; }
    fs.stat(destino, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No existe.'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(destino).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(destino).on('error', () => res.destroy()).pipe(res);
    });
  }

  const servidor = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (_) { res.writeHead(400); res.end(); return; }
    if (url.pathname.startsWith('/api/')) {
      api(req, res, url).catch(e => {
        log.error(`${req.method} ${url.pathname}: ${e.message}`);
        if (!res.headersSent) enviarJSON(res, 500, { ok: false, mensaje: `Error interno: ${e.message}` });
        else res.end();
      });
      return;
    }
    estatico(req, res, url);
  });

  // Al cerrar, también las conexiones SSE (si no, close() esperaría para siempre).
  const cerrarOriginal = servidor.close.bind(servidor);
  servidor.close = (cb) => {
    for (const c of clientes) { try { c.cerrar(); } catch (_) { /* ya cerrada */ } }
    clientes.clear();
    return cerrarOriginal(cb);
  };
  servidor.clientesSSE = clientes;
  return servidor;
}

module.exports = { crearServidor, rutaEstatica, MIME, MAX_CUERPO, costesLLM };
