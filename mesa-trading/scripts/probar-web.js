'use strict';
// Caso conocido de la web (ARQUITECTURA-WEB W3 y W5-W): la mesa sintética
// latiendo por latidos (src/latido.js, como el cron) en una carpeta temporal,
// y la web en modo web sobre esa carpeta, con el cerrojo de verdad.
//
//   node scripts/probar-web.js                    (lo corre también probar-todo)
//   node scripts/probar-web.js --navegador [--capturas=carpeta]
//   TEST_DB_HOST=… TEST_DB_USUARIO=… TEST_DB_CLAVE=… TEST_DB_NOMBRE=… node scripts/probar-web.js
//
// Lo que tiene que cuadrar:
//   1. Sin sesión, nada; con sesión, /api/estado es la instantánea que publicó
//      el último latido (mismo patrimonio, misma hora de la mesa).
//   2. Un Pausar pulsado EN PLENO latido espera al cerrojo y se ejecuta UNA
//      vez: un solo mensaje «Pausa pedida desde el panel» en mensajes.jsonl,
//      el SSE lo entrega, y el latido siguiente sigue en pausa.
//   3. El Megáfono propone (interpretado fuera del cerrojo) y Aplicar veta el
//      activo: la instantánea lo dice.
//   4. Reabrir con REABRIR vuelve a nivel normal.
//   5. /api/salud: 200 con el latido de hace un momento.
// De extremo a extremo (W5, solo con TEST_DB_*; sin ellas se salta y lo dice):
// 3 procesos `node src/web.js` sobre la misma carpeta y la misma MariaDB, y el
// cron (`node scripts/latido.js` en bucle): login real, dos órdenes a la vez
// desde dos webs (en serie y una vez), matar una web con el cerrojo cogido, el
// kill (y el latido siguiente sigue bloqueado), Σ puestos = bróker tras cada
// latido, /api/salud y el espejo sin duplicar.
// Con --navegador, además, en Chromium real: login, panel, «Cerrar sesión»,
// la PWA instalable (manifest, service worker, iconos: Chrome no da errores
// de instalación), sin errores de consola ni de la CSP, y capturas a
// 1440×900 y 390×844.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
require('../src/util/log').fijarNivel('silencio');
const { crearConfig, leerArgs } = require('../src/config');
const { crearLLM } = require('../src/agentes/llm');
const { crearServidor } = require('../src/servidor');
const { almacenMemoria } = require('../src/web/almacen');
const { interpretarFuera } = require('../src/web/megafono');
const { leerJSONL, leerJSON } = require('../src/util/almacen');

const args = leerArgs();
let fallos = 0;
function comprobar(ok, texto, detalle = '') {
  console.log(`${ok ? 'OK   ' : 'FALLO'} ${texto}${!ok && detalle ? ` (${detalle})` : ''}`);
  if (!ok) fallos++;
  return ok;
}
const dormir = ms => new Promise(r => setTimeout(r, ms));

function pedir(base, ruta, { metodo = 'GET', cuerpo, cookie } = {}) {
  const u = new URL(ruta, base);
  const h = {};
  if (cookie) h.cookie = cookie;
  if (metodo !== 'GET') h.origin = base;
  let datos = null;
  if (cuerpo !== undefined) { datos = JSON.stringify(cuerpo); h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(datos); }
  return new Promise((resolver, rechazar) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: metodo, headers: h }, res => {
      const t = [];
      res.on('data', x => t.push(x));
      res.on('end', () => {
        const texto = Buffer.concat(t).toString('utf8');
        let json = null;
        try { json = JSON.parse(texto); } catch (_) { /* no es JSON */ }
        resolver({ status: res.statusCode, headers: res.headers, json, texto });
      });
    });
    req.on('error', rechazar);
    if (datos) req.write(datos);
    req.end();
  });
}

function abrirSSE(base, cookie) {
  const u = new URL('/api/eventos', base);
  const eventos = [];
  let resto = '';
  let res = null;
  http.get({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { cookie } }, r => {
    res = r;
    r.setEncoding('utf8');
    r.on('data', t => {
      resto += t;
      let i;
      while ((i = resto.indexOf('\n\n')) >= 0) {
        const b = resto.slice(0, i); resto = resto.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(b); const d = /^data: (.*)$/m.exec(b);
        if (ev && d) { try { eventos.push({ evento: ev[1], datos: JSON.parse(d[1]) }); } catch (_) { /* nada */ } }
      }
    });
  });
  return { eventos, cerrar: () => res && res.destroy() };
}

async function prepararMesa({ latidos = 3 } = {}) {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-probar-web-'));
  const config = crearConfig({ modo: 'sintetico', datos: carpeta, semilla: '42' });
  config.inicio = Date.UTC(2026, 5, 1);
  // Sin LLM de verdad: el caso conocido no gasta, aunque haya clave en el .env.
  const llm = () => crearLLM({ apiKey: '' });
  const mesa = require('../src/latido');
  const conLaMesa = (c, fn, o = {}) => mesa.conLaMesa(c, fn, { ...o, llm: llm() });
  const latido = () => mesa.latido(config, { llm: llm() });
  for (let i = 0; i < latidos; i++) {
    const r = await latido();
    if (!r.ok) throw new Error(`el latido ${i + 1} falló: ${r.resumen}`);
  }
  return { carpeta, config, conLaMesa, latido, llm };
}

async function arrancarWeb(m, { host = '127.0.0.1' } = {}) {
  const almacen = almacenMemoria();
  await almacen.crearUsuario({ usuario: 'eduardo', clave: 'una-clave-de-prueba-larga' });
  const servidor = crearServidor({
    modo: 'web', config: m.config, raizWeb: path.join(RAIZ, 'web'), carpetaDatos: m.carpeta, almacen,
    conLaMesa: m.conLaMesa, interpretarMegafono: a => interpretarFuera({ ...a, llm: m.llm() }),
  });
  await new Promise(r => servidor.listen(0, host, r));
  return { servidor, almacen, base: `http://${host}:${servidor.address().port}` };
}

async function casoConocido() {
  const m = await prepararMesa();
  const w = await arrancarWeb(m);
  const leerInst = () => leerJSON(path.join(m.carpeta, 'instantanea.json'));
  try {
    // 1. Sin sesión, nada; con sesión, la instantánea del último latido.
    const sin = await pedir(w.base, '/api/estado');
    comprobar(sin.status === 401, 'sin sesión /api/estado responde 401', `${sin.status}`);
    const login = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: 'una-clave-de-prueba-larga' } });
    const cookie = String([].concat(login.headers['set-cookie'] || [])[0] || '').split(';')[0];
    comprobar(login.status === 200 && cookie.startsWith('mesa_sesion='), 'login con la clave buena da la cookie de sesión', `${login.status}`);
    const inst = leerInst();
    const e = await pedir(w.base, '/api/estado', { cookie });
    comprobar(e.status === 200 && e.json.cabecera.patrimonio === inst.cabecera.patrimonio && e.json.ahora === inst.ahora,
      `/api/estado = instantánea del último latido (patrimonio ${Math.round(inst.cabecera.patrimonio)} $)`, `${e.status}`);
    comprobar(e.json.edadSeg >= 0 && e.json.edadSeg < 30 && e.json.latidoMs === 60_000, `edadSeg ${e.json.edadSeg} s y latidoMs ${e.json.latidoMs}`);

    // 2. Pausar en pleno latido.
    const sse = abrirSSE(w.base, cookie);
    await dormir(300);
    let latidoEnCurso = true;
    const latidoLento = m.conLaMesa(m.config, async orq => { orq.reloj.avanzar(5 * 60_000); await orq.paso(); await dormir(1200); latidoEnCurso = false; return 'latido'; }, { espera: 0, motivo: 'latido lento' });
    await dormir(100);
    const t0 = Date.now();
    const pausa = await pedir(w.base, '/api/comando/pausar', { metodo: 'POST', cookie, cuerpo: {} });
    const rl = await latidoLento;
    comprobar(rl.ok, 'el latido lento acabó bien', rl.detalle);
    comprobar(pausa.status === 200 && pausa.json.ok, `Pausar en pleno latido: ${pausa.json && pausa.json.mensaje}`, `${pausa.status}`);
    comprobar(!latidoEnCurso && Date.now() - t0 >= 900, `esperó al cerrojo (${Date.now() - t0} ms)`);
    const pausas = leerJSONL(path.join(m.carpeta, 'mensajes.jsonl')).filter(x => /Pausa pedida desde el panel/.test(x.texto || ''));
    comprobar(pausas.length === 1, `un solo mensaje de pausa en mensajes.jsonl (${pausas.length})`);
    comprobar(leerInst().fondo.nivel === 'pausado', 'la instantánea publicada dice «pausado»');
    await dormir(1500);
    comprobar(sse.eventos.some(x => x.evento === 'mensaje' && /Pausa pedida desde el panel/.test(x.datos.texto || '')), 'el SSE entregó el mensaje de la pausa');
    comprobar(sse.eventos.some(x => x.evento === 'estado' && x.datos.fondo.nivel === 'pausado'), 'el SSE entregó el estado en pausa');
    const r2 = await m.latido();
    comprobar(r2.ok && leerInst().fondo.nivel === 'pausado', 'el latido siguiente sigue en pausa');

    // 3. Megáfono: propuesta y Aplicar.
    const mf = await pedir(w.base, '/api/comando/megafono', { metodo: 'POST', cookie, cuerpo: { texto: 'pausa SOL 24 h' } });
    const prop = leerInst().megafonoPendiente;
    comprobar(mf.status === 200 && mf.json.ok && prop && prop.directivas.some(d => d.tipo === 'pausar_activo' && d.simbolo === 'SOL/USD'),
      `Megáfono: propuesta guardada (${prop ? prop.directivas.map(d => d.tipo).join(', ') : 'ninguna'})`, mf.json && mf.json.mensaje);
    if (prop) {
      const ap = await pedir(w.base, '/api/comando/megafono-aplicar', { metodo: 'POST', cookie, cuerpo: { id: prop.id } });
      const vet = leerInst().directivas.activosVetados.map(x => x.simbolo);
      comprobar(ap.status === 200 && ap.json.ok && vet.includes('SOL/USD'), `Aplicar: SOL vetado 24 h (${vet.join(', ')})`, ap.json && ap.json.mensaje);
    }

    // 4. Reabrir.
    const re = await pedir(w.base, '/api/comando/reabrir', { metodo: 'POST', cookie, cuerpo: { confirmacion: 'REABRIR' } });
    comprobar(re.status === 200 && re.json.ok && leerInst().fondo.nivel === 'normal', `Reabrir: ${re.json && re.json.mensaje}`.slice(0, 140), `${re.status}`);

    // 5. Salud.
    const s = await pedir(w.base, '/api/salud');
    comprobar(s.status === 200 && s.json.ok && s.json.ultimoLatidoHaceSeg <= 10 && s.json.modo === 'sintetico', `/api/salud: último latido hace ${s.json.ultimoLatidoHaceSeg} s`);
    sse.cerrar();
  } finally {
    await new Promise(r => w.servidor.close(() => r()));
    fs.rmSync(m.carpeta, { recursive: true, force: true });
  }
}

// ---------- Chromium ----------

function cargarPlaywright() {
  try { return require('playwright'); } catch (_) { /* no está local */ }
  try { return require(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch (_) { return null; }
}

function opcionesChromium() {
  const opciones = { headless: true };
  if (fs.existsSync('/opt/pw-browsers/chromium')) {
    const cand = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } });
    if (cand) opciones.executablePath = cand;
  }
  return opciones;
}

async function navegador() {
  const pw = cargarPlaywright();
  if (!pw) { console.log('AVISO sin playwright: no se comprueba en Chromium'); return; }
  const capturas = path.resolve(String(args.capturas || path.join(os.tmpdir(), 'mesa-capturas')));
  fs.mkdirSync(capturas, { recursive: true });
  const m = await prepararMesa({ latidos: 60 });
  const w = await arrancarWeb(m);
  const base = w.base.replace('127.0.0.1', 'localhost');   // Chromium acepta cookies Secure en localhost
  const opciones = opcionesChromium();
  const navegadorPW = await pw.chromium.launch(opciones);
  try {
    for (const [ancho, alto, movil] of [[1440, 900, false], [390, 844, true]]) {
      const ctx = await navegadorPW.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: movil ? 2 : 1, isMobile: movil, hasTouch: movil });
      const pagina = await ctx.newPage();
      const errores = [];
      pagina.on('console', msg => { if (msg.type() === 'error') errores.push(msg.text()); });
      pagina.on('pageerror', e => errores.push(e.message));
      await pagina.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', e => { (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`); });
      });
      await pagina.goto(`${base}/`, { waitUntil: 'load' });
      comprobar(new URL(pagina.url()).pathname === '/login', `${ancho}×${alto}: sin sesión, / lleva a /login`);
      await pagina.screenshot({ path: path.join(capturas, `web-login-${ancho}x${alto}.png`) });
      await pagina.fill('#usuario', 'eduardo');
      await pagina.fill('#clave', 'mala');
      await pagina.click('#entrar');
      await pagina.waitForSelector('#error:not([hidden])');
      comprobar((await pagina.textContent('#error')).includes('incorrectos'), `${ancho}×${alto}: clave mala → «Usuario o contraseña incorrectos»`);
      await pagina.fill('#clave', 'una-clave-de-prueba-larga');
      await Promise.all([pagina.waitForURL(`${base}/`), pagina.click('#entrar')]);
      await pagina.waitForFunction(() => { const v = document.getElementById('v-patrimonio'); return v && /\d/.test(v.textContent); }, null, { timeout: 15000 });
      const patr = await pagina.textContent('#v-patrimonio');
      comprobar(/\d/.test(patr), `${ancho}×${alto}: panel con cifras (patrimonio ${patr.trim()})`);
      const sw = await pagina.evaluate(async () => {
        const r = await Promise.race([navigator.serviceWorker.ready.then(x => x.active && x.active.scriptURL), new Promise(res => setTimeout(() => res(null), 8000))]);
        return r;
      });
      comprobar(Boolean(sw) && sw.endsWith('/sw.js'), `${ancho}×${alto}: service worker registrado y activo (${sw})`);
      await pagina.waitForTimeout(1500);
      await pagina.screenshot({ path: path.join(capturas, `web-panel-${ancho}x${alto}.png`) });
      // Ajustes → Cerrar sesión.
      const boton = pagina.locator('#acciones button', { hasText: 'Ajustes' });
      if (await boton.count()) await boton.first().click();
      else await pagina.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Ajustes/.test(x.textContent) || /Ajustes/.test(x.getAttribute('aria-label') || '')); if (b) b.click(); });
      const salir = pagina.locator('dialog#modal button', { hasText: 'Cerrar sesión' });
      await salir.waitFor({ timeout: 8000 });
      if (movil) await pagina.screenshot({ path: path.join(capturas, `web-ajustes-${ancho}x${alto}.png`) });
      await Promise.all([pagina.waitForURL(`${base}/login`), salir.click()]);
      comprobar(true, `${ancho}×${alto}: «Cerrar sesión» en Ajustes lleva al login`);
      const trasSalir = await pagina.evaluate(async () => (await fetch('/api/estado')).status);
      comprobar(trasSalir === 401, `${ancho}×${alto}: tras cerrar sesión la API responde 401`);
      const csp = await pagina.evaluate(() => window.__csp || []);
      const ruido = errores.filter(e => !/401|Unauthorized/.test(e));
      comprobar(!csp.length, `${ancho}×${alto}: sin violaciones de la CSP`, csp.join(' | '));
      comprobar(!ruido.length, `${ancho}×${alto}: sin errores en la consola`, ruido.slice(0, 3).join(' | '));
      await ctx.close();
    }
    // Instalable: en un perfil normal (los contextos de Playwright son de
    // incógnito, y ahí Chrome nunca ofrece instalar).
    const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-perfil-'));
    const persistente = await pw.chromium.launchPersistentContext(perfil, { ...opciones, viewport: { width: 1440, height: 900 } });
    try {
      const pagina = persistente.pages()[0] || await persistente.newPage();
      await pagina.goto(`${base}/login`, { waitUntil: 'load' });
      await pagina.fill('#usuario', 'eduardo');
      await pagina.fill('#clave', 'una-clave-de-prueba-larga');
      await Promise.all([pagina.waitForURL(`${base}/`), pagina.click('#entrar')]);
      await pagina.evaluate(() => navigator.serviceWorker.ready);
      const cdp = await persistente.newCDPSession(pagina);
      const man = await cdp.send('Page.getAppManifest');
      comprobar(!man.errors.length && /"short_name": "Mesa"/.test(man.data || ''), `manifest leído por Chrome sin errores (${man.url})`, JSON.stringify(man.errors));
      const inst = await cdp.send('Page.getInstallabilityErrors');
      comprobar(inst.installabilityErrors.length === 0, 'Chrome da la PWA por instalable (sin errores de instalación)', JSON.stringify(inst.installabilityErrors));
      const iconos = await pagina.evaluate(async () => {
        const m = await (await fetch('/manifest.webmanifest')).json();
        const r = [];
        for (const i of m.icons) {
          const img = new Image(); img.src = i.src; await img.decode();
          r.push(`${img.naturalWidth}x${img.naturalHeight}` === i.sizes);
        }
        return r;
      });
      comprobar(iconos.length === 3 && iconos.every(Boolean), 'los tres iconos del manifest cargan con su tamaño');
    } finally {
      await persistente.close();
      fs.rmSync(perfil, { recursive: true, force: true });
    }
    // iPhone con Safari: la pista de «Añadir a pantalla de inicio», una vez.
    const ios = await navegadorPW.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    const p = await ios.newPage();
    await p.goto(`${base}/login`, { waitUntil: 'load' });
    const visible = await p.isVisible('#pista-ios');
    comprobar(visible, 'iPhone (Safari): se ve la pista «Compartir → Añadir a pantalla de inicio»');
    await p.screenshot({ path: path.join(capturas, 'web-login-ios-390x844.png') });
    await p.click('#cerrar-pista');
    await p.reload({ waitUntil: 'load' });
    comprobar(!(await p.isVisible('#pista-ios')), 'la pista sale solo la primera vez');
    await ios.close();
    console.log(`Capturas en ${capturas}`);
  } finally {
    await navegadorPW.close();
    await new Promise(r => w.servidor.close(() => r()));
    fs.rmSync(m.carpeta, { recursive: true, force: true });
  }
}

// ---------- De extremo a extremo (W5): 3 webs + cron + MariaDB ----------
//
// Lo que corre en producción, en pequeño: tres procesos `node src/web.js` en
// tres puertos sobre la MISMA carpeta de datos (sintético) y la MISMA base, y
// un bucle que lanza `node scripts/latido.js` cada ~1 s (5 min de mesa por
// latido), como el crontab. Necesita TEST_DB_* (la base de pruebas): sin ellas
// se salta diciendo por qué, y el resto del script sigue.
//
// Ojo: vacía mesa_registros y mesa_latidos de la base de PRUEBAS al empezar y
// al acabar (el espejo numera por línea y la carpeta es nueva). Crea un
// usuario e2e-xxxx y lo borra al acabar, con sus sesiones e intentos.

const { spawn } = require('child_process');
const net = require('net');
const { tomarBloqueo, soltarBloqueo, rutaBloqueo } = require('../src/util/proceso');

const E = process.env;
const ENTORNO_BD = { DB_HOST: E.TEST_DB_HOST, DB_PUERTO: E.TEST_DB_PUERTO, DB_USUARIO: E.TEST_DB_USUARIO, DB_CLAVE: E.TEST_DB_CLAVE, DB_NOMBRE: E.TEST_DB_NOMBRE };
const HAY_BD = Boolean(E.TEST_DB_HOST && E.TEST_DB_USUARIO && E.TEST_DB_NOMBRE);
const TOL = 1e-6;
// Mercado sintético fijo: con este inicio hay 2 posiciones abiertas desde el
// primer latido, y el kill tiene algo que cerrar.
const INICIO_E2E = '--inicio=2026-06-01T00:00Z';

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const s = net.createServer();
    s.once('error', rechazar);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolver(p)); });
  });
}

// Entorno de los hijos: el de producción (DB_*, MODO, CARPETA_DATOS), sin LLM
// de verdad aunque haya clave, y sin el PORT de Passenger.
function entornoHijos(carpeta, extra = {}) {
  const env = { ...process.env, ...ENTORNO_BD, MODO: 'sintetico', CARPETA_DATOS: carpeta, SEMILLA: '42', ANTHROPIC_API_KEY: '', ...extra };
  for (const k of ['PORT', 'ALPACA_API_KEY_ID', 'ALPACA_API_SECRET_KEY', 'PANEL_TOKEN', 'MESA_URL', 'URL_PUBLICA']) delete env[k];
  return env;
}

function correrNodo(argsNodo, env) {
  return new Promise(resolver => {
    const t0 = Date.now();
    const h = spawn(process.execPath, argsNodo, { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let salida = '';
    h.stdout.on('data', d => { salida += d; });
    h.stderr.on('data', d => { salida += d; });
    h.on('close', codigo => resolver({ codigo, salida, ms: Date.now() - t0 }));
  });
}

async function arrancarWebHijo(nombre, carpeta, puerto) {
  const h = spawn(process.execPath, ['src/web.js'], { cwd: RAIZ, env: entornoHijos(carpeta, { PUERTO: String(puerto), HOST: '127.0.0.1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  const w = { nombre, h, puerto, base: `http://127.0.0.1:${puerto}`, salida: '', vivo: true };
  h.stdout.on('data', d => { w.salida += d; });
  h.stderr.on('data', d => { w.salida += d; });
  h.on('exit', () => { w.vivo = false; });
  const t0 = Date.now();
  for (;;) {
    try { await pedir(w.base, '/api/salud'); return w; } catch (_) { /* aún no escucha */ }
    if (!w.vivo || Date.now() - t0 > 15000) throw new Error(`la web ${nombre} no arrancó: ${w.salida.slice(-400)}`);
    await dormir(100);
  }
}

// Σ puestos (no sombra) = bróker por símbolo, leyendo los ficheros CON el
// cerrojo de la mesa cogido (así estado.json y broker-simulado.json son del
// mismo paso). null si el cerrojo estaba cogido por otro.
function sumaPuestosContraBroker(carpeta) {
  try { tomarBloqueo(carpeta); } catch (e) { if (e.code === 'EBLOQUEO') return null; throw e; }
  try {
    const estado = leerJSON(path.join(carpeta, 'estado.json'));
    const broker = leerJSON(path.join(carpeta, 'broker-simulado.json'));
    return compararPosiciones(
      (estado.libros.puestos || []).filter(p => !p.sombra).map(p => [p.simbolo, p.cantidad]),
      Object.entries(broker.posiciones || {}).map(([s, p]) => [s, p.cantidad]));
  } finally {
    soltarBloqueo(carpeta);
  }
}

function compararPosiciones(puestos, broker) {
  const suma = (lista) => { const m = {}; for (const [s, q] of lista) m[s] = (m[s] || 0) + q; return m; };
  const a = suma(puestos); const b = suma(broker);
  const malos = [];
  for (const s of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[s] || 0; const y = b[s] || 0;
    if (Math.abs(x - y) > TOL * Math.max(1, Math.abs(y))) malos.push(`${s}: puestos ${x} ≠ bróker ${y}`);
  }
  return { ok: !malos.length, malos, simbolos: Object.keys(b).filter(s => Math.abs(b[s]) > 1e-12).length };
}

// La misma cuenta en una instantánea servida por la web.
function sumaEnInstantanea(inst) {
  return compararPosiciones(
    (inst.puestos || []).filter(p => p.posicion).map(p => [p.simbolo, p.posicion.cantidad]),
    (inst.posiciones || []).map(p => [p.simbolo, p.cantidad]));
}

const lineasJSONL = ruta => { try { return fs.readFileSync(ruta, 'utf8').split('\n').filter(l => l.trim()); } catch (_) { return []; } };

async function extremoAExtremo() {
  if (!HAY_BD) {
    console.log('AVISO sin TEST_DB_* no hay MariaDB de prueba: se salta la prueba de extremo a extremo (3 webs + cron + base).');
    return;
  }
  console.log('— De extremo a extremo: 3 × node src/web.js + scripts/latido.js en bucle + MariaDB —');
  const { configuracionBD, obtenerPool, cerrarPool } = require('../src/bd/conexion');
  const { sincronizar, FUENTES } = require('../src/bd/espejo');
  const pool = obtenerPool(configuracionBD(ENTORNO_BD));
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-e2e-'));
  const usuario = `e2e-${require('crypto').randomBytes(4).toString('hex')}`;
  const clave = `clave-e2e-${require('crypto').randomBytes(8).toString('hex')}`;
  const envLatido = entornoHijos(carpeta);
  const webs = {};
  const bucle = { parar: false, corridas: [], sumas: [], promesa: null };
  const inst = () => leerJSON(path.join(carpeta, 'instantanea.json'));
  const estado = () => leerJSON(path.join(carpeta, 'estado.json'));
  const broker = () => leerJSON(path.join(carpeta, 'broker-simulado.json'));
  const mensajes = () => leerJSONL(path.join(carpeta, 'mensajes.jsonl'));
  const latidosOkDesde = (n) => bucle.corridas.slice(n).filter(c => c.codigo === 0 && /^Latido \(/m.test(c.salida)).length;
  async function esperarLatidos(n, maxMs = 30000) {
    const desde = bucle.corridas.length;
    const t0 = Date.now();
    while (latidosOkDesde(desde) < n) {
      if (Date.now() - t0 > maxMs) return false;
      await dormir(100);
    }
    return true;
  }
  const vaciarEspejo = async () => { await pool.query('DELETE FROM mesa_registros'); await pool.query('DELETE FROM mesa_latidos'); };
  try {
    // 0. Base: tablas con el script de verdad (idempotente), usuario sin teclado.
    const t = await correrNodo(['scripts/crear-tablas.js', '--si'], envLatido);
    comprobar(t.codigo === 0, 'crear-tablas --si contra la base de pruebas', t.salida.slice(-300));
    await vaciarEspejo();
    const u = await correrNodo(['scripts/crear-usuario.js', `--usuario=${usuario}`, '--clave-desde-entorno=MESA_CLAVE_E2E'], { ...envLatido, MESA_CLAVE_E2E: clave });
    comprobar(u.codigo === 0 && !u.salida.includes(clave), `crear-usuario ${usuario} (la contraseña no sale en pantalla)`, u.salida.slice(-300));

    // 1. Dos latidos del cron para que haya instantánea; después las 3 webs.
    for (let i = 0; i < 2; i++) {
      const r = await correrNodo(['scripts/latido.js', INICIO_E2E], envLatido);
      if (r.codigo !== 0) throw new Error(`latido inicial: ${r.salida}`);
    }
    for (const n of ['A', 'B', 'C']) webs[n] = await arrancarWebHijo(n, carpeta, await puertoLibre());
    comprobar(true, `3 webs escuchando en ${Object.values(webs).map(w => w.puerto).join(', ')}`);

    // 2. El cron: un latido detrás de otro, y Σ puestos = bróker tras cada uno.
    bucle.promesa = (async () => {
      while (!bucle.parar) {
        const r = await correrNodo(['scripts/latido.js', INICIO_E2E], envLatido);
        bucle.corridas.push(r);
        // Si un botón tiene el cerrojo, se espera a que lo suelte: una comprobación por latido.
        let s = null;
        for (let i = 0; i < 100 && !s; i++) { s = sumaPuestosContraBroker(carpeta); if (!s) await dormir(50); }
        bucle.sumas.push(s || { ok: false, malos: ['no se pudo coger el cerrojo en 5 s'] });
        await dormir(1000);
      }
    })();

    // 3. Login real (MariaDB): malo, bueno, y la MISMA sesión vale en las tres webs.
    const malo = await pedir(webs.A.base, '/api/login', { metodo: 'POST', cuerpo: { usuario, clave: 'no-es-esta' } });
    comprobar(malo.status === 401, 'login con la clave mala: 401', `${malo.status}`);
    const login = await pedir(webs.A.base, '/api/login', { metodo: 'POST', cuerpo: { usuario, clave } });
    const cookie = String([].concat(login.headers['set-cookie'] || [])[0] || '').split(';')[0];
    comprobar(login.status === 200 && cookie.startsWith('mesa_sesion='), 'login bueno en la web A: cookie de sesión', `${login.status} ${login.texto.slice(0, 100)}`);
    for (const n of ['A', 'B', 'C']) {
      const s = await pedir(webs[n].base, '/api/sesion', { cookie });
      const e = await pedir(webs[n].base, '/api/estado', { cookie });
      const suma = e.json ? sumaEnInstantanea(e.json) : { ok: false, malos: ['sin instantánea'] };
      comprobar(s.status === 200 && s.json.usuario === usuario && e.status === 200 && e.json.web === true && suma.ok,
        `web ${n}: la sesión vale (${s.json && s.json.usuario}) y /api/estado cuadra Σ puestos = posiciones`, `${s.status}/${e.status} ${suma.malos.join('; ')}`);
    }
    comprobar(await esperarLatidos(4), 'el cron late con las tres webs sirviendo');

    // 4. Dos órdenes a la vez desde dos procesos: Pausar en A y el Megáfono en B.
    const antesPausas = mensajes().filter(m => /Pausa pedida desde el panel/.test(m.texto || '')).length;
    const [pa, mf] = await Promise.all([
      pedir(webs.A.base, '/api/comando/pausar', { metodo: 'POST', cookie, cuerpo: {} }),
      pedir(webs.B.base, '/api/comando/megafono', { metodo: 'POST', cookie, cuerpo: { texto: 'pausa SOL 24 h' } }),
    ]);
    comprobar(pa.status === 200 && pa.json.ok && mf.status === 200 && mf.json.ok, `a la vez: Pausar (A) «${pa.json && pa.json.mensaje}» y Megáfono (B) «${mf.json && mf.json.mensaje}»`, `${pa.status}/${mf.status}`);
    const e1 = estado();
    comprobar(e1.fondo.nivel === 'pausado' && e1.megafonoPendiente && e1.megafonoPendiente.texto === 'pausa SOL 24 h',
      'en serie: estado.json guarda las DOS (ninguna pisó a la otra)', `${e1.fondo.nivel} ${JSON.stringify(e1.megafonoPendiente)}`);
    const ms = mensajes();
    const pausas = ms.filter(m => /Pausa pedida desde el panel/.test(m.texto || '')).length - antesPausas;
    const ordenes = ms.filter(m => m.de === 'humano' && m.canal === 'megafono' && m.texto === '«pausa SOL 24 h»').length;
    comprobar(pausas === 1 && ordenes === 1, `una sola vez: ${pausas} mensaje de pausa y ${ordenes} orden del Megáfono`);
    comprobar(fs.readFileSync(path.join(carpeta, 'mensajes.jsonl'), 'utf8').split('\n').filter(Boolean).every(l => { try { JSON.parse(l); return true; } catch (_) { return false; } }),
      'mensajes.jsonl sin líneas mezcladas');
    const ap = await pedir(webs.C.base, '/api/comando/megafono-aplicar', { metodo: 'POST', cookie, cuerpo: { id: e1.megafonoPendiente.id } });
    comprobar(ap.status === 200 && ap.json.ok && estado().directivas.activosVetados.some(v => v.simbolo === 'SOL/USD'), `Aplicar desde la web C: ${ap.json && ap.json.mensaje}`);
    const re = await pedir(webs.A.base, '/api/comando/reabrir', { metodo: 'POST', cookie, cuerpo: { confirmacion: 'REABRIR' } });
    comprobar(re.status === 200 && re.json.ok && estado().fondo.nivel === 'normal', 'Reabrir desde A: nivel normal', re.json && re.json.mensaje);
    comprobar(await esperarLatidos(2) && inst().fondo.nivel === 'normal', 'los latidos siguientes siguen en normal');

    // 5. Capturas servidas por src/web.js (con la base y el cron de verdad).
    if (args.navegador) await capturasFinales(webs.A, usuario, clave);

    // 6. Matar la web B a mitad de un botón (con el cerrojo cogido, si se pilla).
    const pidB = webs.B.h.pid;
    const enVuelo = pedir(webs.B.base, '/api/comando/pausar', { metodo: 'POST', cookie, cuerpo: {} }).catch(e => ({ status: 0, error: e.message }));
    let conCerrojo = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      let c = null;
      try { c = JSON.parse(fs.readFileSync(rutaBloqueo(carpeta), 'utf8')); } catch (_) { /* libre */ }
      if (c && c.pid === pidB) { conCerrojo = true; break; }
      await dormir(2);
    }
    webs.B.h.kill('SIGKILL');
    const rVuelo = await enVuelo;
    comprobar(rVuelo.status === 0, `web B matada ${conCerrojo ? 'CON el cerrojo cogido' : 'sin llegar a coger el cerrojo'}: la petición se corta`);
    const tras = bucle.corridas.length;
    comprobar(await esperarLatidos(2, 30000), 'tras matarla, el cron sigue latiendo (el cerrojo del pid muerto se toma)',
      bucle.corridas.slice(tras).map(c => c.salida.trim().split('\n').pop()).join(' | ').slice(0, 300));
    const eB = await pedir(webs.A.base, '/api/estado', { cookie });
    const eC = await pedir(webs.C.base, '/api/estado', { cookie });
    comprobar(eB.status === 200 && eC.status === 200 && webs.A.vivo && webs.C.vivo, 'A y C siguen sirviendo');
    webs.B = await arrancarWebHijo('B', carpeta, webs.B.puerto);   // LiteSpeed la levanta con la siguiente petición
    const eB2 = await pedir(webs.B.base, '/api/estado', { cookie });
    comprobar(eB2.status === 200, 'B levantada de nuevo: la misma sesión sigue valiendo (vive en la base)');

    // 7. El kill desde C cierra todo y el latido siguiente sigue bloqueado.
    const antes = broker();
    const abiertas = Object.values(antes.posiciones || {}).filter(p => Math.abs(p.cantidad) > 1e-12).length;
    const k = await pedir(webs.C.base, '/api/comando/kill', { metodo: 'POST', cookie, cuerpo: { confirmacion: 'KILL' } });
    const trasKill = broker();
    const sinVender = Object.entries(trasKill.posiciones || {}).filter(([, p]) => Math.abs(p.cantidad) > 1e-12);
    comprobar(k.status === 200 && k.json.ok && abiertas > 0 && sinVender.length === 0 && estado().fondo.nivel === 'bloqueado',
      `kill desde C: ${abiertas} posiciones cerradas, nivel bloqueado`, `${k.status} ${k.json && k.json.mensaje} quedan ${sinVender.map(([s]) => s).join(',')}`);
    comprobar(await esperarLatidos(3), 'tres latidos más tras el kill');
    const trasLatidos = broker();
    comprobar(inst().fondo.nivel === 'bloqueado' && Object.values(trasLatidos.posiciones || {}).every(p => Math.abs(p.cantidad) <= 1e-12),
      'el latido siguiente sigue bloqueado y sin posiciones');

    // 8. Salud de las tres.
    for (const n of ['A', 'B', 'C']) {
      const s = await pedir(webs[n].base, '/api/salud');
      comprobar(s.status === 200 && s.json.ok && s.json.modo === 'sintetico' && s.json.ultimoLatidoHaceSeg <= 10 && typeof s.json.version === 'string',
        `web ${n}: /api/salud ok, último latido hace ${s.json && s.json.ultimoLatidoHaceSeg} s, versión ${s.json && s.json.version}`);
    }

    // 9. Logout en A: la sesión deja de valer en las tres.
    await pedir(webs.A.base, '/api/logout', { metodo: 'POST', cookie, cuerpo: {} });
    const fuera = await Promise.all(['A', 'B', 'C'].map(n => pedir(webs[n].base, '/api/estado', { cookie })));
    comprobar(fuera.every(r => r.status === 401), 'logout en A: 401 en A, B y C');

    // 10. Se para el cron y se mira el bucle entero.
    bucle.parar = true;
    await bucle.promesa;
    const malos = bucle.corridas.filter(c => c.codigo !== 0);
    const omitidos = bucle.corridas.filter(c => /Latido omitido/.test(c.salida)).length;
    comprobar(!malos.length, `${bucle.corridas.length} latidos del cron salen con 0 (${omitidos} omitidos por el cerrojo)`, malos.map(c => c.salida.slice(-200)).join(' | '));
    const sumasMal = bucle.sumas.filter(s => !s.ok);
    comprobar(bucle.sumas.length === bucle.corridas.length && bucle.sumas.length >= 8 && !sumasMal.length, `Σ puestos = bróker en las ${bucle.sumas.length} comprobaciones tras cada latido`, sumasMal.map(s => s.malos.join('; ')).join(' | '));
    const fallosEspejo = lineasJSONL(path.join(carpeta, 'espejo-fallos.jsonl'));
    comprobar(!fallosEspejo.length, 'el espejo no apuntó ningún fallo', fallosEspejo.slice(0, 2).join(' | '));

    // 11. El espejo: la base tiene cada línea una vez; otra pasada no copia nada.
    const ultimo = await correrNodo(['scripts/latido.js', INICIO_E2E], envLatido);
    comprobar(ultimo.codigo === 0, 'un último latido (con su copia a la base)');
    const cuadran = async () => {
      const r = [];
      for (const [fuente, fichero] of Object.entries(FUENTES)) {
        const lineas = lineasJSONL(path.join(carpeta, fichero)).length;
        const [[f]] = await pool.query('SELECT COUNT(*) AS n, COUNT(DISTINCT linea) AS d FROM mesa_registros WHERE fuente = ?', [fuente]);
        r.push({ fuente, lineas, filas: Number(f.n), distintas: Number(f.d) });
      }
      const [[l]] = await pool.query('SELECT COUNT(*) AS n FROM mesa_latidos');
      return { r, latidos: Number(l.n) };
    };
    const c1 = await cuadran();
    const nLat = lineasJSONL(path.join(carpeta, 'latidos.jsonl')).length;
    comprobar(c1.r.every(x => x.filas === x.lineas && x.distintas === x.filas) && c1.latidos === nLat,
      `espejo: cada línea una vez (${c1.r.filter(x => x.lineas).map(x => `${x.fuente} ${x.filas}`).join(', ')}; mesa_latidos ${c1.latidos})`,
      JSON.stringify(c1.r.filter(x => x.filas !== x.lineas || x.distintas !== x.filas)));
    const otra = await sincronizar({ carpetaDatos: carpeta }, { pool });
    const c2 = await cuadran();
    comprobar(otra.copiados === 0 && JSON.stringify(c2) === JSON.stringify(c1), `otra pasada del espejo no copia nada (${otra.copiados})`);
    const quedan = ['.proceso', '.proceso.romper', '.espejo', '.laboratorio'].filter(f => fs.existsSync(path.join(carpeta, f)));
    comprobar(!quedan.length, 'al acabar no queda ningún cerrojo', quedan.join(', '));
  } finally {
    bucle.parar = true;
    if (bucle.promesa) await bucle.promesa.catch(() => {});
    for (const w of Object.values(webs)) if (w.vivo) w.h.kill('SIGTERM');
    await dormir(300);
    for (const w of Object.values(webs)) if (w.vivo) w.h.kill('SIGKILL');
    try {
      const [us] = await pool.query('SELECT id FROM mesa_usuarios WHERE usuario = ?', [usuario]);
      for (const f of us) await pool.query('DELETE FROM mesa_sesiones WHERE usuario_id = ?', [f.id]);
      await pool.query('DELETE FROM mesa_intentos WHERE usuario = ?', [usuario]);
      await pool.query('DELETE FROM mesa_usuarios WHERE usuario = ?', [usuario]);
      await vaciarEspejo();
    } catch (e) { console.log(`AVISO no se pudo limpiar la base de pruebas: ${e.message}`); }
    await cerrarPool();
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
}

// Capturas de login y panel servidas por src/web.js de verdad (base y cron
// reales), a 1440×900 y 390×844: capturas/web-final-*.png.
async function capturasFinales(web, usuario, clave) {
  const pw = cargarPlaywright();
  if (!pw) { console.log('AVISO sin playwright: sin capturas finales'); return; }
  const capturas = path.resolve(String(args.capturas || path.join(os.tmpdir(), 'mesa-capturas')));
  fs.mkdirSync(capturas, { recursive: true });
  const base = web.base.replace('127.0.0.1', 'localhost');   // cookies Secure en localhost
  const nav = await pw.chromium.launch(opcionesChromium());
  try {
    for (const [ancho, alto, movil] of [[1440, 900, false], [390, 844, true]]) {
      const ctx = await nav.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: movil ? 2 : 1, isMobile: movil, hasTouch: movil });
      const p = await ctx.newPage();
      const errores = [];
      p.on('pageerror', e => errores.push(e.message));
      p.on('console', m => { if (m.type() === 'error' && !/401|Unauthorized/.test(m.text())) errores.push(m.text()); });
      await p.goto(`${base}/`, { waitUntil: 'load' });
      await p.waitForSelector('#usuario');
      await p.screenshot({ path: path.join(capturas, `web-final-login-${ancho}x${alto}.png`) });
      await p.fill('#usuario', usuario);
      await p.fill('#clave', clave);
      await Promise.all([p.waitForURL(`${base}/`), p.click('#entrar')]);
      await p.waitForFunction(() => { const v = document.getElementById('v-patrimonio'); return v && /\d/.test(v.textContent); }, null, { timeout: 15000 });
      await p.waitForTimeout(2500);
      await p.screenshot({ path: path.join(capturas, `web-final-panel-${ancho}x${alto}.png`) });
      comprobar(!errores.length, `src/web.js en Chromium ${ancho}×${alto}: login y panel sin errores (web-final-*.png)`, errores.slice(0, 3).join(' | '));
      await ctx.close();
    }
    console.log(`Capturas finales en ${capturas}`);
  } finally {
    await nav.close();
  }
}

async function main() {
  await casoConocido();
  if (args.navegador) await navegador();
  await extremoAExtremo();
  console.log(fallos ? `FALLO: ${fallos} comprobaciones de la web no cuadran.` : 'OK: la web cuadra con el caso conocido.');
  process.exit(fallos ? 1 : 0);
}

main().catch(e => { console.error(`FALLO ${e.stack || e.message}`); process.exit(1); });
