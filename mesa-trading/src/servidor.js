'use strict';
// Servidor del panel (§7) con node:http, sin dependencias.
//
// - Estáticos de web/ en «/» y en «/web/*», con su tipo MIME y sin poder salir
//   de la carpeta (../ o rutas absolutas codificadas se rechazan).
// - GET /api/estado, /api/mensajes?desde= (t mayor O IGUAL; lo que ya no está
//   en memoria se lee de mensajes.jsonl), /api/operaciones, /api/costes-llm.
// - SSE en /api/eventos: 'estado' (como mucho uno cada 2 s reales, lo limita
//   el orquestador), 'mensaje', 'agente', 'ejecucion' y 'ping' cada 15 s. Al
//   cerrar la conexión se quitan sus oyentes. Como mucho 20 paneles a la vez
//   (el 21 recibe 503). Un panel que deja de leer (móvil dormido, pestaña
//   congelada) se corta: si no, lo que no vacía se queda en la memoria del
//   proceso sin límite. EventSource vuelve a conectar solo.
// - POST /api/comando/<nombre> con cuerpo JSON de 64 KB como mucho.
// - Con PANEL_TOKEN, todo /api/* pide el token en x-panel-token o ?token=
//   (EventSource no admite cabeceras). Escucha en 127.0.0.1 por defecto.
// - Mientras el orquestador arranca (el servidor escucha ANTES de iniciar, para
//   que un puerto ocupado no deje tocar los datos), /api/* responde 503.
//
// Defensas del navegador (otra web abierta en el mismo ordenador):
// - CSRF: los POST exigen Content-Type application/json (una web ajena solo
//   manda text/plain o formularios sin pedir permiso antes) y /api/* rechaza
//   con 403 un Origin que no sea el del propio panel o Sec-Fetch-Site
//   cross-site. Las palabras KILL, REABRIR o PRUEBA no protegen: la web
//   atacante las mete en el cuerpo.
// - DNS rebinding: la página del atacante pasa a resolver a 127.0.0.1 y queda
//   en el MISMO origen que el panel (Origin y Host son los dos suyos). Por eso
//   el Host se compara con una lista FIJA (127.0.0.1, localhost y [::1] con el
//   puerto en que escucha, más el HOST configurado) y el Origin contra esa
//   misma lista, nunca contra el Host que llega. Con el panel abierto a la red
//   (HOST=0.0.0.0) no hay un Host fijo: ahí protege el PANEL_TOKEN, que
//   index.js exige.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { leerJSONL } = require('./util/almacen');
const { diaUTC } = require('./util/reloj');
const { esLoopback } = require('./config');
const log = require('./util/log').crear('servidor');

const MAX_CUERPO = 64 * 1024;
const PING_MS = 15_000;
const MAX_CLIENTES_SSE = 20;
// Lo que un panel puede tener sin leer antes de cortarlo: unas 8 instantáneas.
const MAX_PENDIENTE_SSE = 1024 * 1024;
// Tiempo que un panel puede estar sin vaciar lo que se le manda (sin 'drain').
const MAX_ATASCO_SSE_MS = 60_000;
// Mensajes que se leen de mensajes.jsonl cuando `desde` es anterior a la memoria.
const MAX_MENSAJES_DISCO = 5000;
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

function enviarJSON(res, status, cuerpo, extra = {}) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(texto),
    ...extra,
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

// Mensajes con t >= desde (inclusivo: con el reloj acelerado muchos comparten
// instante; quien pagina con el último t visto recibe otra vez los que ya
// tenía y los reconoce por su id). El bus guarda en memoria los últimos 500:
// si `desde` puede ser anterior al más viejo de la memoria, se completa con
// mensajes.jsonl (sus últimas MAX_MENSAJES_DISCO líneas), sin repetir ids.
function mensajesDesde(bus, desde) {
  const memoria = bus.memoria || [];
  const recientes = bus.desde(desde);
  const lleno = memoria.length >= (bus.maxMemoria || Infinity);
  if (!bus.ruta || !memoria.length || !lleno || !(memoria[0].t >= desde)) return recientes;
  let disco;
  try { disco = leerJSONL(bus.ruta, MAX_MENSAJES_DISCO); } catch (e) { log.aviso(`no se pudo leer ${bus.ruta}: ${e.message}`); return recientes; }
  const vistos = new Set(recientes.map(m => m.id));
  const antiguos = disco.filter(m => m && m.t >= desde && !vistos.has(m.id) && m.t <= memoria[0].t);
  return [...antiguos, ...recientes];
}

// Direcciones IP de esta máquina (para un servidor que escucha en 0.0.0.0).
function direccionesLocales() {
  const lista = [];
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) if (i && i.address) lista.push(i.address);
  }
  return lista;
}

function conPuerto(host, puerto) {
  const h = String(host).trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h.includes(':') ? `[${h}]:${puerto}` : `${h}:${puerto}`;
}

function esComodin(host) {
  const h = String(host || '').trim().replace(/^\[|\]$/g, '');
  return h === '0.0.0.0' || h === '::' || h === '';
}

// Dos modos:
// - local (por defecto): el de siempre, con el orquestador en este proceso.
// - web ({ modo: 'web', config, almacen, conLaMesa? }): la app del cPanel, sin
//   orquestador, con login y leyendo lo que publica el latido
//   (src/web/servidor-web.js, ARQUITECTURA-WEB W3).
function crearServidor(opciones = {}) {
  if (opciones && opciones.modo === 'web') return require('./web/servidor-web').crearServidorWeb(opciones);
  return crearServidorLocal(opciones);
}

// Opciones: `host` es el HOST configurado (se admite también como nombre del
// panel); el puerto es el real en que escucha (vale con listen(0)).
function crearServidorLocal({
  orquestador, raizWeb, carpetaDatos, token = '', host = '', pingMs = PING_MS,
  maxClientesSSE = MAX_CLIENTES_SSE, maxPendienteSSE = MAX_PENDIENTE_SSE, maxAtascoSSEMs = MAX_ATASCO_SSE_MS,
} = {}) {
  if (!orquestador) throw new Error('crearServidor necesita el orquestador');
  const web = path.resolve(raizWeb);
  const clientes = new Set();
  // Un mismo evento va a todos los paneles: se serializa una vez.
  const serializados = new WeakMap();
  let servidor;

  // Nombres con los que se admite el panel: lista fija por puerto real.
  let anfitrionesCache = null;
  function anfitriones() {
    const dir = servidor.address();
    if (!dir || typeof dir === 'string') return null;
    const ahora = Date.now();
    if (anfitrionesCache && anfitrionesCache.puerto === dir.port && anfitrionesCache.direccion === dir.address && ahora - anfitrionesCache.t < 60_000) return anfitrionesCache;
    const p = dir.port;
    const nombres = ['127.0.0.1', 'localhost', '::1'];
    const abierto = !esLoopback(dir.address);
    if (host && !esComodin(host)) nombres.push(host);
    if (esComodin(dir.address)) nombres.push(...direccionesLocales());
    else nombres.push(dir.address);
    const lista = new Set(nombres.map(n => conPuerto(n, p)));
    // En el puerto estándar el navegador no escribe el puerto en Host ni en Origin.
    if (p === 80) for (const n of nombres) lista.add(conPuerto(n, p).replace(/:80$/, ''));
    anfitrionesCache = { t: ahora, puerto: p, direccion: dir.address, lista, abierto, principal: `http://${conPuerto(esComodin(dir.address) || abierto ? '127.0.0.1' : dir.address, p)}/` };
    return anfitrionesCache;
  }

  // Host ajeno → no es el panel (DNS rebinding). Sin Host (HTTP/1.0, no es un
  // navegador) se admite. Abierto a la red con token: el token protege.
  function hostAdmitido(req) {
    const h = req.headers.host;
    if (h === undefined) return true;
    const a = anfitriones();
    if (!a) return true;
    if (a.lista.has(String(h).trim().toLowerCase())) return true;
    return a.abierto && Boolean(token);
  }

  // Petición que viene de otra web: Sec-Fetch-Site cross-site, u Origin que no
  // es el del propio panel (se compara con la lista fija, no con el Host).
  function origenAdmitido(req) {
    if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false;
    const o = req.headers.origin;
    if (o === undefined) return true;
    let u;
    try { u = new URL(String(o)); } catch (_) { return false; }   // incluye 'null'
    if (u.protocol !== 'http:') return false;
    const a = anfitriones();
    if (!a) return false;
    const suyo = u.host.toLowerCase();
    if (a.lista.has(suyo)) return true;
    return a.abierto && Boolean(token) && suyo === String(req.headers.host || '').trim().toLowerCase();
  }

  function autorizado(req, url) {
    if (!token) return true;
    return tokenIgual(req.headers['x-panel-token'], token) || tokenIgual(url.searchParams.get('token'), token);
  }

  function textoDe(datos) {
    if (!datos || typeof datos !== 'object') return JSON.stringify(datos);
    let t = serializados.get(datos);
    if (t === undefined) { t = JSON.stringify(datos); serializados.set(datos, t); }
    return t;
  }

  function sse(req, res) {
    if (clientes.size >= maxClientesSSE) {
      return enviarJSON(res, 503, { ok: false, mensaje: `Ya hay ${maxClientesSSE} paneles conectados: cierra alguna pestaña y vuelve a intentarlo.` }, { 'Retry-After': '10' });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Contrapresión: lo que el socket no vacía se queda en la memoria del
    // proceso. Si pasa de maxPendienteSSE, o lleva maxAtascoSSEMs sin vaciarse,
    // el panel se corta. Mientras un panel lento vacía, un 'estado' nuevo no se
    // amontona: sustituye al anterior y sale en el 'drain' (cada instantánea
    // es completa). Mensajes, agentes y ejecuciones sí salen todos.
    let atascadoDesde = null;
    let estadoPendiente = null;
    const cortar = () => { if (!res.destroyed) res.destroy(); };
    const enviar = (evento, datos) => {
      if (res.destroyed || res.writableEnded) return;
      if (res.writableLength > maxPendienteSSE || (atascadoDesde !== null && Date.now() - atascadoDesde > maxAtascoSSEMs)) { cortar(); return; }
      if (evento === 'estado' && res.writableNeedDrain) { estadoPendiente = datos; return; }
      try {
        const ok = res.write(`event: ${evento}\ndata: ${textoDe(datos)}\n\n`);
        if (!ok && atascadoDesde === null) atascadoDesde = Date.now();
      } catch (_) { /* conexión ya cerrada */ }
    };
    res.on('drain', () => {
      atascadoDesde = null;
      if (estadoPendiente) { const d = estadoPendiente; estadoPendiente = null; enviar('estado', d); }
    });
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
    // Al cerrar el servidor: destroy, no end (end esperaría a que un panel
    // atascado vaciara, y close() no acabaría nunca).
    const cliente = { res, cerrar: cortar };
    clientes.add(cliente);
    let limpio = false;
    const limpiar = () => {
      if (limpio) return;
      limpio = true;
      clearInterval(ping);
      estadoPendiente = null;
      for (const [ev, fn] of Object.entries(oyentes)) orquestador.off(ev, fn);
      clientes.delete(cliente);
    };
    req.on('close', limpiar);
    res.on('close', limpiar);
    res.on('error', limpiar);
  }

  async function api(req, res, url) {
    const ruta = url.pathname;
    if (!origenAdmitido(req)) {
      return enviarJSON(res, 403, { ok: false, mensaje: 'Petición de otra web rechazada: la API solo atiende al propio panel.' });
    }
    if (!autorizado(req, url)) {
      const dado = req.headers['x-panel-token'] || url.searchParams.get('token');
      return enviarJSON(res, 401, { ok: false, mensaje: dado ? 'El token del panel no vale: revisa el ?token=… de la URL (el de PANEL_TOKEN).' : 'Falta el token del panel: abre la URL con ?token=… (el valor de PANEL_TOKEN).' });
    }
    if (!orquestador.iniciado) {
      return enviarJSON(res, 503, { ok: false, mensaje: 'La mesa está arrancando: reintenta en unos segundos.' }, { 'Retry-After': '2' });
    }
    if (req.method === 'GET' && ruta === '/api/estado') return enviarJSON(res, 200, orquestador.instantanea());
    if (req.method === 'GET' && ruta === '/api/eventos') return sse(req, res);
    if (req.method === 'GET' && ruta === '/api/mensajes') {
      const texto = url.searchParams.get('desde');
      const desde = texto === null || texto.trim() === '' ? -Infinity : Number(texto);
      return enviarJSON(res, 200, mensajesDesde(orquestador.bus, Number.isFinite(desde) ? desde : -Infinity));
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
      // Solo JSON: text/plain y los formularios son peticiones «simples» que
      // cualquier web manda sin pedir permiso al navegador.
      const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (tipo !== 'application/json') {
        req.resume();
        return enviarJSON(res, 415, { ok: false, mensaje: 'Los comandos van con Content-Type: application/json.' });
      }
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

  servidor = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (_) { res.writeHead(400); res.end(); return; }
    if (!hostAdmitido(req)) {
      req.resume();
      const a = anfitriones();
      const texto = `Este panel no responde al nombre «${req.headers.host}»${a ? `: ábrelo en ${a.principal}` : ''}.`;
      if (url.pathname.startsWith('/api/')) return enviarJSON(res, 421, { ok: false, mensaje: texto });
      res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(texto);
      return;
    }
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

module.exports = { crearServidor, rutaEstatica, mensajesDesde, MIME, MAX_CUERPO, MAX_CLIENTES_SSE, costesLLM };
