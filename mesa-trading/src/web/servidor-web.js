'use strict';
// Servidor del panel en MODO WEB (ARQUITECTURA-WEB W3): la app de Node del
// cPanel. No tiene orquestador ni opera por su cuenta: sirve lo que publicó el
// último latido (data/instantanea.json y data/mensajes.jsonl) y, para un
// botón, toma el MISMO cerrojo que el motor con conLaMesa (src/latido.js), así
// que nunca actúan dos a la vez, haya los procesos que haya. Si LiteSpeed mata
// este proceso, no se pierde nada.
//
// - Sin sesión solo se ve: /login (y sus css/js), /api/login, /api/salud, el
//   manifest, los iconos, el service worker y la página sin conexión. Lo demás
//   manda a /login (páginas) o responde 401 (API y el resto).
// - CSRF: SameSite=Strict en la cookie, Origin igual al del propio panel (o
//   uno de `origenes`), Sec-Fetch-Site cross-site rechazado y los POST solo
//   con Content-Type application/json.
// - SSE (/api/eventos): un vigía por proceso mira cada segundo la instantánea y
//   la cola de mensajes.jsonl y reparte 'mensaje', 'ejecucion', 'agente' y
//   'estado' a los paneles; 'ping' cada 15 s. Cabeceras para que LiteSpeed no
//   retenga el flujo y flushHeaders().
// - Comandos: en cola dentro del proceso (uno detrás de otro) y cada uno con
//   el cerrojo de la mesa, 20 s como mucho de espera. El Megáfono interpreta
//   con el LLM FUERA del cerrojo (src/web/megafono.js).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { leerJSONL } = require('../util/almacen');
const { TARIFAS } = require('../agentes/llm');
const { crearCabeceras } = require('./cabeceras');
const { ipDe, textoEspera } = require('./freno');
const { LectorMesa, diferencias } = require('./lector');
const ses = require('./sesiones');
const alta = require('./alta');
const log = require('../util/log').crear('web');

const PING_MS = 15_000;
const VIGIA_MS = 1000;
const MAX_CLIENTES_SSE = 20;
const MAX_PENDIENTE_SSE = 2 * 1024 * 1024;
const MAX_CUERPO = 64 * 1024;
const MAX_CUERPO_LOGIN = 4 * 1024;
const ESPERA_COMANDO_MS = 20_000;
const SALUD_MAX_SEG = 180;
const REVISAR_SESION_SSE_MS = 60_000;
const MAX_MENSAJES_DISCO = 5000;
// Los mismos que ofrece Ajustes en el modo local (orquestador.MODELOS_DISPONIBLES).
const MODELOS_DISPONIBLES = Object.keys(TARIFAS).filter(m => m !== 'claude-opus-4-8');
const COMANDOS = new Set(['comite', 'megafono', 'megafono-aplicar', 'prueba', 'pausar', 'reabrir', 'kill', 'ajustes', 'rebalancear']);

// Lo que se ve sin sesión (rutas ya sin el prefijo /web).
const PUBLICOS = new Set([
  '/login.html', '/css/login.css', '/js/login.js', '/js/pwa.js',
  '/manifest.webmanifest', '/sin-conexion.html', '/favicon.ico', '/js/alta.js',
]);
const esPublico = r => PUBLICOS.has(r) || /^\/iconos\/[a-z0-9-]+\.png$/.test(r);

// Ficheros de la «carcasa»: su huella entra en la versión del service worker,
// así un cambio en cualquiera de ellos lo renueva aunque no cambie VERSION.
function huellaCarcasa(raizWeb) {
  const h = crypto.createHash('sha256');
  const recorrer = (dir) => {
    let entradas = [];
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entradas.sort((a, b) => a.name.localeCompare(b.name))) {
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(html|css|js|png|webmanifest)$/.test(e.name)) {
        h.update(path.relative(raizWeb, ruta));
        try { h.update(fs.readFileSync(ruta)); } catch (_) { /* desaparecido */ }
      }
    }
  };
  recorrer(raizWeb);
  return h.digest('hex').slice(0, 10);
}

function leerVersion(raiz) {
  try {
    const v = fs.readFileSync(path.join(raiz, 'VERSION'), 'utf8').trim();
    if (v) return v.slice(0, 64);
  } catch (_) { /* sin VERSION: la del package.json */ }
  try { return `v${JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version}`; } catch (_) { return 'desconocida'; }
}

function enviarJSON(res, status, cuerpo, extra = {}) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(texto),
    ...extra,
  });
  res.end(texto);
}

function redirigir(res, destino) {
  res.writeHead(302, { Location: destino, 'Cache-Control': 'no-store', 'Content-Length': 0 });
  res.end();
}

function leerCuerpo(req, max) {
  return new Promise((resolver, rechazar) => {
    let total = 0;
    const trozos = [];
    let pasado = false;
    req.on('data', trozo => {
      if (pasado) return;
      total += trozo.length;
      if (total > max) {
        pasado = true;
        rechazar(Object.assign(new Error(`cuerpo de más de ${max / 1024} KB`), { status: 413 }));
        req.resume();
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => { if (!pasado) resolver(Buffer.concat(trozos).toString('utf8')); });
    req.on('error', rechazar);
  });
}

async function leerObjetoJSON(req, max) {
  const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'application/json') {
    req.resume();
    throw Object.assign(new Error('Van con Content-Type: application/json.'), { status: 415 });
  }
  let texto;
  try { texto = await leerCuerpo(req, max); } catch (e) {
    throw Object.assign(new Error(`Cuerpo demasiado grande (máx. ${max / 1024} KB).`), { status: e.status || 400 });
  }
  let datos;
  try { datos = texto.trim() ? JSON.parse(texto) : {}; } catch (e) {
    throw Object.assign(new Error(`JSON no válido: ${e.message}`), { status: 400 });
  }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw Object.assign(new Error('JSON no válido: el cuerpo tiene que ser un objeto JSON'), { status: 400 });
  return datos;
}

function costesLLM(ruta) {
  return require('../servidor').costesLLM(ruta);
}

function crearServidorWeb({
  config, raizWeb, carpetaDatos, almacen = null, conLaMesa = null, interpretarMegafono = null, version = null,
  origenes = [], pingMs = PING_MS, vigiaMs = VIGIA_MS, maxClientesSSE = MAX_CLIENTES_SSE, maxPendienteSSE = MAX_PENDIENTE_SSE,
  esperaComandoMs = ESPERA_COMANDO_MS, saludMaxSeg = SALUD_MAX_SEG, revisarSesionMs = REVISAR_SESION_SSE_MS,
} = {}) {
  if (!config) throw new Error('crearServidorWeb necesita la config');
  const web = path.resolve(raizWeb || path.join(config.raiz, 'web'));
  const carpeta = path.resolve(carpetaDatos || config.carpetaDatos);
  const cfg = { ...config, carpetaDatos: carpeta };
  const lector = new LectorMesa({ carpetaDatos: carpeta });
  const cabeceras = crearCabeceras(web);
  const versionApp = version || leerVersion(config.raiz || path.join(web, '..'));
  const versionSW = `${versionApp}-${huellaCarcasa(web)}`;
  const latidoMs = (config.cadencias && config.cadencias.latidoMs) || 60_000;
  const origenesExtra = new Set((origenes || []).map(o => String(o).trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean));
  const conMesa = conLaMesa || ((...a) => require('../latido').conLaMesa(...a));
  const interpretar = interpretarMegafono || ((...a) => require('./megafono').interpretarFuera(...a));

  // ---------- CSRF ----------

  function origenAdmitido(req) {
    if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false;
    const o = req.headers.origin;
    if (o === undefined) return true;
    let u;
    try { u = new URL(String(o)); } catch (_) { return false; }   // incluye 'null'
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (origenesExtra.has(u.origin.toLowerCase())) return true;
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    return Boolean(host) && u.host.toLowerCase() === host;
  }

  // ---------- instantánea con lo que añade la web ----------

  // Lo que la web añade a la instantánea publicada: su edad, el ritmo del
  // latido (si el motor no lo trae), que es el modo web y quién mira.
  function extras(r, sesion) {
    const e = { edadSeg: lector.edadSeg(r.mtimeMs), web: true };
    if (!Number.isFinite(r.datos.latidoMs)) e.latidoMs = latidoMs;
    if (sesion) e.sesion = { usuario: sesion.usuario || null };
    return e;
  }
  function textoInstantanea(r, sesion) {
    const base = JSON.stringify(r.datos);
    const mas = JSON.stringify(extras(r, sesion));
    if (base === '{}') return mas;
    return `${base.slice(0, -1)},${mas.slice(1)}`;
  }
  const SIN_INSTANTANEA = 'La mesa está arrancando: aún no ha publicado ninguna instantánea (llega con el próximo latido, cada minuto).';

  // ---------- SSE ----------

  const clientes = new Set();
  let vigia = null;
  let ultimaEmitida = null;

  function repartir(evento, datos) {
    const texto = JSON.stringify(datos);
    for (const c of clientes) c.escribir(evento, texto);
  }

  function tickVigia() {
    let mensajes = [];
    try { mensajes = lector.mensajesNuevos(); } catch (e) { log.aviso(`cola de mensajes: ${e.message}`); }
    for (const m of mensajes) repartir('mensaje', m);
    const r = lector.instantanea();
    if (r && r.datos !== ultimaEmitida) {
      const dif = diferencias(ultimaEmitida, r.datos);
      for (const ej of dif.ejecuciones) repartir('ejecucion', ej);
      for (const ag of dif.agentes) repartir('agente', ag);
      ultimaEmitida = r.datos;
      for (const c of clientes) c.escribir('estado', textoInstantanea(r, c.sesion));
    }
    const ahora = Date.now();
    for (const c of clientes) {
      if (ahora - c.pingT >= pingMs) { c.pingT = ahora; c.escribir('ping', JSON.stringify({ t: ahora })); }
      if (almacen && ahora - c.revisadaT >= revisarSesionMs && !c.revisando) {
        c.revisando = true;
        c.revisadaT = ahora;
        Promise.resolve(almacen.leerSesion(c.sesion.token))
          .then(s => { if (!s) { c.escribir('sesion', JSON.stringify({ ok: false, mensaje: 'La sesión ha caducado o se ha cerrado.' })); c.terminar(); } })
          .catch(() => { /* base caída: se revisa en la siguiente */ })
          .finally(() => { c.revisando = false; });
      }
    }
  }

  function arrancarVigia() {
    if (vigia) return;
    lector.seguirMensajesDesdeAhora();
    const r = lector.instantanea();
    ultimaEmitida = r ? r.datos : null;
    vigia = setInterval(() => { try { tickVigia(); } catch (e) { log.error(`vigía SSE: ${e.message}`); } }, vigiaMs);
    if (vigia.unref) vigia.unref();
  }

  function pararVigiaSiVacio() {
    if (clientes.size || !vigia) return;
    clearInterval(vigia);
    vigia = null;
  }

  function sse(req, res, sesion) {
    if (clientes.size >= maxClientesSSE) {
      return enviarJSON(res, 503, { ok: false, mensaje: `Ya hay ${maxClientesSSE} paneles conectados: cierra alguna pestaña y vuelve a intentarlo.` }, { 'Retry-After': '10' });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    const cliente = {
      sesion, pingT: Date.now(), revisadaT: Date.now(), revisando: false,
      escribir(evento, texto) {
        if (res.destroyed || res.writableEnded) return;
        // Un panel que no lee (móvil dormido) no puede llenar la memoria.
        if (res.writableLength > maxPendienteSSE) { cliente.cerrar(); return; }
        try { res.write(`event: ${evento}\ndata: ${texto}\n\n`); } catch (_) { /* cerrada */ }
      },
      cerrar() { if (!res.destroyed) res.destroy(); },
      // Cierre ordenado: lo ya escrito sale antes de colgar.
      terminar() { if (!res.destroyed && !res.writableEnded) res.end(); clientes.delete(cliente); pararVigiaSiVacio(); },
    };
    res.write('retry: 3000\n\n');
    arrancarVigia();
    clientes.add(cliente);
    const r = lector.instantanea();
    if (r) cliente.escribir('estado', textoInstantanea(r, sesion));
    let limpio = false;
    const limpiar = () => {
      if (limpio) return;
      limpio = true;
      clientes.delete(cliente);
      pararVigiaSiVacio();
    };
    req.on('close', limpiar);
    res.on('close', limpiar);
    res.on('error', limpiar);
  }

  // ---------- comandos: en cola y con el cerrojo de la mesa ----------

  let cola = Promise.resolve();
  function enCola(fn) {
    const p = cola.then(fn, fn);
    cola = p.catch(() => {});
    return p;
  }

  // `interno` va aparte de los datos del navegador (orquestador.comando).
  async function conCerrojo(nombre, datos, interno = {}) {
    const encolado = Date.now();
    return enCola(async () => {
      const espera = Math.max(0, esperaComandoMs - (Date.now() - encolado));
      return conMesa(cfg, orq => orq.comando(nombre, datos, interno), { espera, motivo: `web:${nombre}` });
    });
  }

  function responderMesa(res, r) {
    if (r && r.ok) {
      const resultado = r.resultado && typeof r.resultado === 'object' ? r.resultado : { ok: true, mensaje: 'Hecho.' };
      const { codigo, ...cuerpo } = resultado;
      return enviarJSON(res, codigo || 200, cuerpo);
    }
    if (r && r.motivo === 'ocupado') {
      return enviarJSON(res, 503, { ok: false, mensaje: 'La mesa está en pleno latido, vuelve a intentarlo.' }, { 'Retry-After': '5' });
    }
    const detalle = r && r.detalle ? (r.detalle.message || String(r.detalle)) : 'error desconocido';
    log.error(`comando: ${detalle}`);
    return enviarJSON(res, 500, { ok: false, mensaje: `La mesa no pudo ejecutar la orden: ${detalle}` });
  }

  function datosAjustes() {
    const r = lector.instantanea();
    if (!r) return null;
    const i = r.datos;
    const llm = i.llm || {};
    return {
      modo: i.modo, broker: i.broker, presupuestoDiaUsd: llm.presupuestoDiaUsd, modeloComite: llm.modeloComite, modeloAgentes: llm.modeloAgentes,
      velocidad: i.velocidad, limites: { ...(i.limites || {}) }, modelosDisponibles: MODELOS_DISPONIBLES,
    };
  }

  async function comando(req, res, nombre) {
    if (!COMANDOS.has(nombre)) { req.resume(); return enviarJSON(res, 404, { ok: false, mensaje: `Comando desconocido: ${nombre}` }); }
    if (req.method === 'GET') {
      if (nombre !== 'ajustes') return enviarJSON(res, 405, { ok: false, mensaje: 'Los comandos van por POST.' });
      const d = datosAjustes();
      if (!d) return enviarJSON(res, 503, { ok: false, mensaje: SIN_INSTANTANEA }, { 'Retry-After': '10' });
      return enviarJSON(res, 200, { ok: true, mensaje: '', datos: d });
    }
    if (req.method !== 'POST') { req.resume(); return enviarJSON(res, 405, { ok: false, mensaje: 'Método no admitido.' }); }
    let datos;
    try { datos = await leerObjetoJSON(req, MAX_CUERPO); } catch (e) {
      return enviarJSON(res, e.status || 400, { ok: false, mensaje: e.status === 415 ? 'Los comandos van con Content-Type: application/json.' : e.message });
    }
    // La interpretación del Megáfono la pone SOLO este servidor, nunca el navegador.
    delete datos.interpretacion;
    if (nombre === 'megafono') {
      const texto = typeof datos.texto === 'string' ? datos.texto.trim().slice(0, 500) : '';
      if (!texto) return enviarJSON(res, 200, { ok: false, mensaje: 'Escribe qué quieres que haga la mesa.' });
      let interpretacion;
      try {
        const r = lector.instantanea();
        interpretacion = await interpretar({ config: cfg, texto, instantanea: r ? r.datos : null });
      } catch (e) {
        log.error(`megáfono: ${e.message}`);
        return enviarJSON(res, 500, { ok: false, mensaje: `No se pudo interpretar la orden: ${e.message}` });
      }
      return responderMesa(res, await conCerrojo('megafono', { texto }, { interpretacion }));
    }
    return responderMesa(res, await conCerrojo(nombre, datos));
  }

  // ---------- login ----------

  const loginsEnCurso = new Set();   // IPs con una comprobación de clave en marcha
  function tomarTurnoLogin(ip) {
    if (loginsEnCurso.has(ip)) return false;
    loginsEnCurso.add(ip);
    return true;
  }
  function soltarTurnoLogin(ip) { loginsEnCurso.delete(ip); }

  async function login(req, res) {
    if (req.method !== 'POST') { req.resume(); return enviarJSON(res, 405, { ok: false, mensaje: 'El login va por POST.' }); }
    let d;
    try { d = await leerObjetoJSON(req, MAX_CUERPO_LOGIN); } catch (e) { return enviarJSON(res, e.status || 400, { ok: false, mensaje: e.message }); }
    const usuario = typeof d.usuario === 'string' ? d.usuario.trim().slice(0, 64) : '';
    const clave = typeof d.clave === 'string' ? d.clave.slice(0, 1024) : '';
    if (!usuario || !clave) return enviarJSON(res, 400, { ok: false, mensaje: 'Escribe el usuario y la contraseña.' });
    if (!almacen) return enviarJSON(res, 503, { ok: false, mensaje: 'La base de datos no está configurada: nadie puede entrar todavía.' });
    const ip = ipDe(req);
    // Una comprobación de clave a la vez por IP en este proceso: el scrypt
    // cuesta ~75 ms de CPU y una ráfaga no tiene por qué pagarse entera.
    if (!tomarTurnoLogin(ip)) {
      return enviarJSON(res, 429, { ok: false, esperaSeg: 2, mensaje: 'Ya hay un intento de entrada en marcha desde aquí. Espera un momento.' }, { 'Retry-After': '2' });
    }
    try {
      // Freno y apunte a la vez (el intento cuenta como fallo desde ya): ver
      // reservarIntento en src/bd/sesiones.js.
      const f = await almacen.reservarIntento({ ip, usuario });
      if (f && f.frenado) {
        const seg = Math.max(1, Math.ceil(f.esperaSeg || 60));
        return enviarJSON(res, 429, { ok: false, esperaSeg: seg, mensaje: `Demasiados intentos fallidos. Espera ${textoEspera(seg)} y vuelve a intentarlo.` }, { 'Retry-After': String(seg) });
      }
      const c = await almacen.comprobarClave({ usuario, clave });
      if (!c || !c.ok) return enviarJSON(res, 401, { ok: false, mensaje: 'Usuario o contraseña incorrectos.' });
      await almacen.resolverIntento({ id: f.id, ok: true });
      const s = await almacen.crearSesion({ usuarioId: c.usuarioId, ip, agente: String(req.headers['user-agent'] || '').slice(0, 255) });
      return enviarJSON(res, 200, { ok: true, mensaje: 'Dentro.', usuario }, { 'Set-Cookie': ses.cookieSesion(s.token) });
    } catch (e) {
      log.error(`login: ${e.message}`);
      return enviarJSON(res, 503, { ok: false, mensaje: 'La base de datos no responde: vuelve a intentarlo en un momento.' });
    } finally {
      soltarTurnoLogin(ip);
    }
  }

  // Alta con el enlace de un solo uso (src/web/alta.js). Sin freno por
  // contraseña: el token tiene 256 bits y no se adivina; sí un turno por IP.
  async function darDeAlta(req, res) {
    if (req.method !== 'POST') { req.resume(); return enviarJSON(res, 405, { ok: false, mensaje: 'El alta va por POST.' }); }
    let d;
    try { d = await leerObjetoJSON(req, MAX_CUERPO_LOGIN); } catch (e) { return enviarJSON(res, e.status || 400, { ok: false, mensaje: e.message }); }
    const token = typeof d.token === 'string' ? d.token.trim() : '';
    const usuario = typeof d.usuario === 'string' ? d.usuario.trim().slice(0, 64) : '';
    const clave = typeof d.clave === 'string' ? d.clave.slice(0, 1024) : '';
    if (!almacen || typeof almacen.darDeAlta !== 'function') return enviarJSON(res, 503, { ok: false, mensaje: 'La base de datos no está configurada.' });
    const ip = ipDe(req);
    if (!tomarTurnoLogin(ip)) return enviarJSON(res, 429, { ok: false, esperaSeg: 2, mensaje: 'Ya hay un alta en marcha desde aquí. Espera un momento.' }, { 'Retry-After': '2' });
    try {
      if (!alta.altaValida(carpeta, token)) return enviarJSON(res, 410, { ok: false, mensaje: 'Este enlace ya no vale: se usó, caducó o se creó otro. Pide uno nuevo.' });
      if (!usuario || !clave) return enviarJSON(res, 400, { ok: false, mensaje: 'Escribe el usuario y la contraseña.' });
      const reserva = alta.consumirAlta(carpeta, token);
      if (!reserva) return enviarJSON(res, 410, { ok: false, mensaje: 'Este enlace ya no vale: se usó, caducó o se creó otro. Pide uno nuevo.' });
      let r;
      try { r = await almacen.darDeAlta({ usuario, clave }); } catch (e) {
        reserva.devolver();
        if (/usuario|contraseña/i.test(e.message)) return enviarJSON(res, 400, { ok: false, mensaje: e.message });
        throw e;
      }
      reserva.confirmar();
      log.info(`alta por enlace: ${r.nuevo ? 'usuario nuevo' : 'contraseña cambiada'} «${usuario}»`);
      const s = await almacen.crearSesion({ usuarioId: r.usuarioId, ip, agente: String(req.headers['user-agent'] || '').slice(0, 255) });
      return enviarJSON(res, 200, { ok: true, mensaje: r.nuevo ? 'Usuario creado.' : 'Contraseña cambiada.', usuario }, { 'Set-Cookie': ses.cookieSesion(s.token) });
    } catch (e) {
      log.error(`alta: ${e.message}`);
      return enviarJSON(res, 503, { ok: false, mensaje: 'La base de datos no responde: vuelve a intentarlo en un momento (el enlace sigue valiendo).' });
    } finally {
      soltarTurnoLogin(ip);
    }
  }

  async function logout(req, res) {
    req.resume();
    if (req.method !== 'POST') return enviarJSON(res, 405, { ok: false, mensaje: 'Cerrar sesión va por POST.' });
    const token = ses.tokenDe(req);
    if (token && almacen) {
      try { await almacen.cerrarSesion(token); } catch (e) { log.aviso(`logout: ${e.message}`); }
    }
    return enviarJSON(res, 200, { ok: true, mensaje: 'Sesión cerrada.' }, { 'Set-Cookie': ses.cookieBorrada() });
  }

  // Solo cuentan los latidos buenos (ok: true): un latido omitido porque el
  // cerrojo está cogido, o uno fallido, no dice que la mesa esté viva.
  // latidosMalosSeguidos: cuántos omitidos o fallidos lleva al final.
  function salud(res) {
    const t = lector.ultimoLatidoMs();
    const hace = t === null ? null : Math.max(0, Math.round((Date.now() - t) / 1000));
    const ok = hace !== null && hace <= saludMaxSeg;
    return enviarJSON(res, ok ? 200 : 503, {
      ok, version: versionApp, ultimoLatidoHaceSeg: hace, modo: config.modo, latidosMalosSeguidos: lector.latidosMalosSeguidos(),
    });
  }

  // ---------- API con sesión ----------

  async function apiConSesion(req, res, url, sesion) {
    const ruta = url.pathname;
    if (req.method === 'GET' && ruta === '/api/estado') {
      const r = lector.instantanea();
      if (!r) return enviarJSON(res, 503, { ok: false, mensaje: SIN_INSTANTANEA }, { 'Retry-After': '10' });
      const texto = textoInstantanea(r, sesion);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(texto) });
      return res.end(texto);
    }
    if (req.method === 'GET' && ruta === '/api/eventos') return sse(req, res, sesion);
    if (req.method === 'GET' && ruta === '/api/sesion') return enviarJSON(res, 200, { ok: true, usuario: sesion.usuario || null });
    if (req.method === 'GET' && ruta === '/api/mensajes') {
      const texto = url.searchParams.get('desde');
      const desde = texto === null || texto.trim() === '' ? -Infinity : Number(texto);
      const lista = leerJSONL(lector.rutas.mensajes, MAX_MENSAJES_DISCO).filter(m => m && m.t >= (Number.isFinite(desde) ? desde : -Infinity));
      return enviarJSON(res, 200, lista);
    }
    if (req.method === 'GET' && ruta === '/api/operaciones') return enviarJSON(res, 200, leerJSONL(lector.rutas.operaciones, 200));
    if (req.method === 'GET' && ruta === '/api/costes-llm') return enviarJSON(res, 200, costesLLM(lector.rutas.costes));
    const m = /^\/api\/comando\/([a-z-]+)$/.exec(ruta);
    if (m) return comando(req, res, m[1]);
    req.resume();
    return enviarJSON(res, 404, { ok: false, mensaje: 'Ruta desconocida.' });
  }

  // ---------- estáticos ----------

  function servirFichero(req, res, destino, extra = {}) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    fs.stat(destino, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No existe.'); return; }
      const { MIME } = require('../servidor');
      const ext = path.extname(destino).toLowerCase();
      res.writeHead(200, {
        'Content-Type': ext === '.webmanifest' ? 'application/manifest+json; charset=utf-8' : (MIME[ext] || 'application/octet-stream'),
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
        ...extra,
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(destino).on('error', () => res.destroy()).pipe(res);
    });
  }

  // El service worker lleva la versión dentro: con cada publicación (o cambio
  // en la carcasa) cambian sus bytes y el navegador lo renueva solo.
  let swCache = null;
  function servirSW(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (!swCache) {
      try { swCache = fs.readFileSync(path.join(web, 'sw.js'), 'utf8').replace(/__VERSION__/g, versionSW.replace(/[^A-Za-z0-9._-]/g, '')); } catch (_) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No existe.'); return;
      }
    }
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(swCache),
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    });
    res.end(req.method === 'HEAD' ? undefined : swCache);
  }

  const quiereHTML = (req, ruta) => ruta === '/' || ruta.endsWith('.html') || ruta.endsWith('/')
    || String(req.headers['sec-fetch-mode'] || '') === 'navigate' || /text\/html/.test(String(req.headers.accept || ''));

  // ---------- el enrutado ----------

  async function atender(req, res, url) {
    const crudo = url.pathname;
    const ruta = crudo === '/web' ? '/' : crudo.startsWith('/web/') ? crudo.slice(4) : crudo;

    if (crudo.startsWith('/api/')) {
      if (!origenAdmitido(req)) {
        req.resume();
        return enviarJSON(res, 403, { ok: false, mensaje: 'Petición de otra web rechazada: la API solo atiende al propio panel.' });
      }
      if (crudo === '/api/salud') { req.resume(); return salud(res); }
      if (crudo === '/api/login') return login(req, res);
      if (crudo === '/api/logout') return logout(req, res);
      if (crudo === '/api/alta') return darDeAlta(req, res);
    }

    if (ruta === '/sw.js') return servirSW(req, res);
    if (ruta === '/login' || ruta === '/login.html') {
      // Con sesión válida, directo al panel.
      try { if (await ses.sesionDe(req, almacen)) return redirigir(res, '/'); } catch (_) { /* base caída: se enseña el login */ }
      return servirFichero(req, res, path.join(web, 'login.html'));
    }
    if (ruta === '/alta' || ruta === '/alta.html') return servirFichero(req, res, path.join(web, 'alta.html'), { 'Cache-Control': 'no-store' });
    if (esPublico(ruta)) {
      const { rutaEstatica } = require('../servidor');
      const destino = rutaEstatica(web, ruta);
      if (!destino) { res.writeHead(404); res.end(); return; }
      return servirFichero(req, res, destino);
    }

    let sesion;
    try { sesion = await ses.sesionDe(req, almacen); } catch (e) {
      log.error(`sesión: ${e.message}`);
      req.resume();
      if (crudo.startsWith('/api/')) return enviarJSON(res, 503, { ok: false, mensaje: 'La base de datos no responde: vuelve a intentarlo en un momento.' }, { 'Retry-After': '10' });
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '10', 'Cache-Control': 'no-store' });
      res.end('La base de datos no responde: vuelve a intentarlo en un momento.');
      return;
    }
    if (!sesion) {
      req.resume();
      if (crudo.startsWith('/api/')) return enviarJSON(res, 401, { ok: false, mensaje: 'Inicia sesión para ver la mesa.', login: '/login' });
      if (quiereHTML(req, ruta)) return redirigir(res, '/login');
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Inicia sesión.');
      return;
    }
    if (crudo.startsWith('/api/')) return apiConSesion(req, res, url, sesion);
    const { rutaEstatica } = require('../servidor');
    const destino = rutaEstatica(web, crudo);
    if (!destino) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No existe.'); return; }
    return servirFichero(req, res, destino);
  }

  const servidor = http.createServer((req, res) => {
    cabeceras.poner(res);
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (_) { res.writeHead(400); res.end(); return; }
    atender(req, res, url).catch(e => {
      log.error(`${req.method} ${url.pathname}: ${e.message}`);
      if (!res.headersSent) enviarJSON(res, 500, { ok: false, mensaje: `Error interno: ${e.message}` });
      else res.end();
    });
  });

  const cerrarOriginal = servidor.close.bind(servidor);
  servidor.close = (cb) => {
    for (const c of clientes) { try { c.cerrar(); } catch (_) { /* ya cerrada */ } }
    clientes.clear();
    pararVigiaSiVacio();
    return cerrarOriginal(cb);
  };
  servidor.clientesSSE = clientes;
  servidor.modoWeb = true;
  servidor.version = versionApp;
  servidor.versionSW = versionSW;
  servidor.csp = cabeceras.csp;
  return servidor;
}

module.exports = { crearServidorWeb, leerVersion, huellaCarcasa, MODELOS_DISPONIBLES, COMANDOS, PUBLICOS };
