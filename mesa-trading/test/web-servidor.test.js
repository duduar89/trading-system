'use strict';
// La web en modo web (ARQUITECTURA-WEB W3 y W5-W): sin sesión todo cerrado
// salvo login, salud y estáticos públicos; login bueno, malo y frenado; cookie
// con sus banderas; CSRF; cabeceras de seguridad; un comando espera al
// cerrojo y se ejecuta una vez; el Megáfono interpreta fuera del cerrojo; el
// SSE entrega estado, mensajes, ejecuciones y agentes a partir de los ficheros.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { almacenMemoria } = require('../src/web/almacen');
const { ipDe, evaluarFreno } = require('../src/web/freno');
const { destinoEscucha } = require('../src/web');
const { RAIZ, arrancarWeb, pedir, entrar, abrirSSE, escribirInstantanea, anadirMensaje, instantaneaDePrueba } = require('./web-ayuda');

const dormir = ms => new Promise(r => setTimeout(r, ms));

test('sin sesión: páginas al login, API 401 y solo lo público abierto', async (t) => {
  let llamadas = 0;
  const w = await arrancarWeb({ conLaMesa: async () => { llamadas++; return { ok: true, resultado: { ok: true } }; } });
  t.after(w.cerrar);
  for (const ruta of ['/', '/index.html', '/web/', '/web/index.html']) {
    const r = await pedir(w.base, ruta, { cabeceras: { accept: 'text/html' } });
    assert.equal(r.status, 302, ruta);
    assert.equal(r.headers.location, '/login', ruta);
  }
  for (const ruta of ['/api/estado', '/api/eventos', '/api/mensajes', '/api/operaciones', '/api/costes-llm', '/api/comando/ajustes', '/api/sesion']) {
    const r = await pedir(w.base, ruta);
    assert.equal(r.status, 401, ruta);
    assert.equal(r.json.login, '/login', ruta);
    assert.ok(!('patrimonio' in (r.json || {})), 'sin datos del fondo');
  }
  const post = await pedir(w.base, '/api/comando/pausar', { metodo: 'POST', cuerpo: {} });
  assert.equal(post.status, 401);
  assert.equal(llamadas, 0, 'sin sesión no se toca la mesa');
  // Los ficheros del panel tampoco se sirven sin sesión.
  for (const ruta of ['/web/js/app.js', '/js/app.js', '/css/estilo.css', '/js/maqueta.js']) {
    const r = await pedir(w.base, ruta, { cabeceras: { accept: '*/*' } });
    assert.equal(r.status, 401, ruta);
  }
  // Lo público.
  const publicos = {
    '/login': 'text/html', '/css/login.css': 'text/css', '/js/login.js': 'text/javascript', '/js/pwa.js': 'text/javascript',
    '/manifest.webmanifest': 'application/manifest+json', '/sw.js': 'text/javascript', '/sin-conexion.html': 'text/html',
    '/iconos/icono-192.png': 'image/png', '/iconos/icono-512.png': 'image/png', '/iconos/icono-512-maskable.png': 'image/png',
    '/iconos/apple-touch-icon.png': 'image/png', '/web/manifest.webmanifest': 'application/manifest+json', '/web/iconos/apple-touch-icon.png': 'image/png',
  };
  for (const [ruta, tipo] of Object.entries(publicos)) {
    const r = await pedir(w.base, ruta, { crudo: true });
    assert.equal(r.status, 200, ruta);
    assert.ok(String(r.headers['content-type']).startsWith(tipo), `${ruta}: ${r.headers['content-type']}`);
  }
  const salud = await pedir(w.base, '/api/salud');
  assert.equal(salud.status, 200);
  // Nada fuera de la carpeta web/.
  const fuera = await pedir(w.base, '/iconos/..%2f..%2fpackage.json');
  assert.notEqual(fuera.status, 200);
});

test('login bueno: cookie HttpOnly, Secure, SameSite=Strict, 30 días, y el panel abierto', async (t) => {
  const w = await arrancarWeb();
  t.after(w.cerrar);
  const r = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: 'clave-larga-de-prueba' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const sc = [].concat(r.headers['set-cookie'])[0];
  const partes = sc.split(';').map(s => s.trim());
  const [nombre, token] = partes[0].split('=');
  assert.equal(nombre, 'mesa_sesion');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, '32 bytes en base64url');
  for (const bandera of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=2592000']) assert.ok(partes.includes(bandera), `${bandera} en ${sc}`);
  // En el almacén solo está su SHA-256, no el token.
  const claves = [...w.almacen._sesiones.keys()];
  assert.deepEqual(claves, [crypto.createHash('sha256').update(token).digest('hex')]);
  const cookie = partes[0];
  const estado = await pedir(w.base, '/api/estado', { cookie });
  assert.equal(estado.status, 200);
  assert.equal(estado.json.web, true);
  assert.equal(estado.json.sesion.usuario, 'eduardo');
  assert.ok(Number.isFinite(estado.json.edadSeg) && estado.json.edadSeg >= 0 && estado.json.edadSeg < 30);
  assert.equal(estado.json.latidoMs, 60_000, 'el ritmo del latido llega al panel');
  assert.equal(typeof estado.json.cabecera.patrimonio, 'number');
  const pagina = await pedir(w.base, '/', { cookie, crudo: true });
  assert.equal(pagina.status, 200);
  assert.match(pagina.texto, /<canvas id="lienzo"/);
  const app = await pedir(w.base, '/web/js/app.js', { cookie, crudo: true });
  assert.equal(app.status, 200);
  const login = await pedir(w.base, '/login', { cookie });
  assert.equal(login.status, 302, 'con sesión, /login lleva al panel');
  assert.equal(login.headers.location, '/');
  const quien = await pedir(w.base, '/api/sesion', { cookie });
  assert.deepEqual(quien.json, { ok: true, usuario: 'eduardo' });
});

test('login malo: el mismo mensaje para usuario o contraseña, y sin cookie', async (t) => {
  const w = await arrancarWeb();
  t.after(w.cerrar);
  const a = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: 'otra' } });
  const b = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'nadie', clave: 'clave-larga-de-prueba' } });
  for (const r of [a, b]) {
    assert.equal(r.status, 401);
    assert.equal(r.json.mensaje, 'Usuario o contraseña incorrectos.');
    assert.equal(r.headers['set-cookie'], undefined);
  }
  const vacio = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: '', clave: '' } });
  assert.equal(vacio.status, 400);
  const cookieFalsa = `mesa_sesion=${crypto.randomBytes(32).toString('base64url')}`;
  assert.equal((await pedir(w.base, '/api/estado', { cookie: cookieFalsa })).status, 401);
  assert.equal((await pedir(w.base, '/api/estado', { cookie: 'mesa_sesion=basura' })).status, 401);
  // Todos los intentos quedan anotados con su IP y su resultado.
  assert.deepEqual(w.almacen._intentos.map(i => [i.usuario, i.ok]), [['eduardo', false], ['nadie', false]]);
});

test('freno: 5 fallos por IP en 15 min → 429 con la espera, aunque la clave sea buena; la IP es el ÚLTIMO valor de X-Forwarded-For', async (t) => {
  let ahora = Date.UTC(2026, 8, 30, 10);
  const almacen = almacenMemoria({ ahora: () => ahora });
  const w = await arrancarWeb({ almacen });
  t.after(w.cerrar);
  // Lo de delante lo escribe el cliente; LiteSpeed añade la IP de verdad al final.
  const desde = ip => ({ 'x-forwarded-for': `10.0.0.1, ${ip}` });
  for (let i = 0; i < 5; i++) {
    const r = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: `mala-${i}` }, cabeceras: desde('203.0.113.7') });
    assert.equal(r.status, 401);
    ahora += 60_000;
  }
  const frenada = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: 'clave-larga-de-prueba' }, cabeceras: desde('203.0.113.7') });
  assert.equal(frenada.status, 429);
  assert.equal(frenada.headers['set-cookie'], undefined);
  // El primer fallo fue hace 5 min: faltan 10 min para que salga de la ventana.
  assert.equal(frenada.json.esperaSeg, 600);
  assert.equal(frenada.headers['retry-after'], '600');
  assert.match(frenada.json.mensaje, /Espera 10 min/);
  // Otra IP (el último valor de X-Forwarded-For es el que cuenta) entra.
  await entrar(w.base, 'eduardo', 'clave-larga-de-prueba', desde('198.51.100.2'));
  // Pasada la ventana, la primera IP vuelve a poder.
  ahora += 10 * 60_000 + 1000;
  await entrar(w.base, 'eduardo', 'clave-larga-de-prueba', desde('203.0.113.7'));
});

test('freno: 20 fallos del mismo usuario en 1 h desde IPs distintas → 429 para ese usuario', async (t) => {
  let ahora = Date.UTC(2026, 8, 30, 10);
  const almacen = almacenMemoria({ ahora: () => ahora });
  const w = await arrancarWeb({ almacen, usuarios: [['eduardo', 'clave-larga-de-prueba'], ['otra', 'clave-de-otra-persona']] });
  t.after(w.cerrar);
  for (let i = 0; i < 20; i++) {
    const r = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: 'mala' }, cabeceras: { 'x-forwarded-for': `192.0.2.${i}` } });
    assert.equal(r.status, 401, `intento ${i}`);
    ahora += 1000;
  }
  const r = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: 'clave-larga-de-prueba' }, cabeceras: { 'x-forwarded-for': '192.0.2.200' } });
  assert.equal(r.status, 429);
  assert.ok(r.json.esperaSeg > 3500 && r.json.esperaSeg <= 3600);
  await entrar(w.base, 'otra', 'clave-de-otra-persona', { 'x-forwarded-for': '192.0.2.201' });
});

test('regla del freno y la IP del cliente, sueltas', () => {
  const t0 = 1_000_000_000;
  const fallos = n => Array.from({ length: n }, (_, i) => ({ ip: 'a', usuario: 'u', ok: false, t: t0 + i * 1000 }));
  assert.equal(evaluarFreno(fallos(4), { ip: 'a', usuario: 'u', ahora: t0 + 10_000 }).frenado, false);
  assert.deepEqual(evaluarFreno(fallos(5), { ip: 'a', usuario: 'u', ahora: t0 + 10_000 }), { frenado: true, esperaSeg: 890 });
  assert.equal(evaluarFreno(fallos(5), { ip: 'a', usuario: 'u', ahora: t0 + 15 * 60_000 + 1 }).frenado, false, 'fuera de la ventana');
  assert.equal(evaluarFreno([...fallos(4), { ip: 'a', usuario: 'u', ok: true, t: t0 + 5000 }], { ip: 'a', usuario: 'u', ahora: t0 + 10_000 }).frenado, false, 'los aciertos no cuentan');
  assert.equal(ipDe({ headers: { 'x-forwarded-for': '10.1.1.1, 203.0.113.9' }, socket: { remoteAddress: '127.0.0.1' } }), '203.0.113.9');
  assert.equal(ipDe({ headers: { 'x-forwarded-for': '203.0.113.9' }, socket: {} }), '203.0.113.9', 'un solo valor: el que puso el proxy');
  assert.equal(ipDe({ headers: { 'x-forwarded-for': ['1.1.1.1', '2.2.2.2, 198.51.100.4'] }, socket: {} }), '198.51.100.4', 'cabecera repetida: el último de todos');
  assert.equal(ipDe({ headers: {}, socket: { remoteAddress: '::ffff:10.2.3.4' } }), '10.2.3.4');
});

test('la sesión caduca a los 30 días y el logout la cierra (y borra la cookie)', async (t) => {
  let ahora = Date.UTC(2026, 8, 30, 10);
  const almacen = almacenMemoria({ ahora: () => ahora });
  const w = await arrancarWeb({ almacen });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  ahora += 29 * 24 * 3600 * 1000;
  assert.equal((await pedir(w.base, '/api/estado', { cookie })).status, 200);
  ahora += 2 * 24 * 3600 * 1000;
  assert.equal((await pedir(w.base, '/api/estado', { cookie })).status, 401, 'caducada');
  const otra = await entrar(w.base);
  const fuera = await pedir(w.base, '/api/logout', { metodo: 'POST', cuerpo: {}, cookie: otra });
  assert.equal(fuera.status, 200);
  const sc = [].concat(fuera.headers['set-cookie'])[0];
  assert.match(sc, /^mesa_sesion=;/);
  assert.match(sc, /Max-Age=0/);
  assert.equal((await pedir(w.base, '/api/estado', { cookie: otra })).status, 401, 'la cookie vieja ya no vale');
});

test('CSRF: Origin ajeno, Sec-Fetch-Site cross-site y Content-Type que no es JSON se rechazan sin tocar la mesa', async (t) => {
  let llamadas = 0;
  const w = await arrancarWeb({ conLaMesa: async () => { llamadas++; return { ok: true, resultado: { ok: true, mensaje: 'Hecho.' } }; } });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const casos = [
    [{ origin: 'https://atacante.example' }, {}, 403],
    [{ origin: 'null' }, {}, 403],
    [{ origin: 'https://portal.brainstormersagency.es' }, {}, 403],
    [{ 'sec-fetch-site': 'cross-site' }, {}, 403],
    [{ 'content-type': 'text/plain' }, 'KILL', 415],
    [{ 'content-type': 'application/x-www-form-urlencoded' }, 'confirmacion=KILL', 415],
  ];
  for (const [cab, cuerpo, esperado] of casos) {
    const r = await pedir(w.base, '/api/comando/kill', { metodo: 'POST', cookie, cuerpo: typeof cuerpo === 'string' ? cuerpo : { confirmacion: 'KILL', ...cuerpo }, cabeceras: cab });
    assert.equal(r.status, esperado, JSON.stringify(cab));
  }
  const loginAjeno = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: 'clave-larga-de-prueba' }, cabeceras: { origin: 'https://atacante.example' } });
  assert.equal(loginAjeno.status, 403);
  assert.equal(llamadas, 0);
  // El propio origen (el Host que llega, también detrás del proxy) sí.
  const bien = await pedir(w.base, '/api/comando/pausar', { metodo: 'POST', cookie, cuerpo: {} });
  assert.equal(bien.status, 200);
  const trasProxy = await pedir(w.base, '/api/comando/pausar', { metodo: 'POST', cookie, cuerpo: {}, cabeceras: { origin: 'https://mesa.brainstormersagency.es', 'x-forwarded-host': 'mesa.brainstormersagency.es' } });
  assert.equal(trasProxy.status, 200);
  assert.equal(llamadas, 2);
  // Cuerpo demasiado grande.
  const grande = await pedir(w.base, '/api/comando/megafono', { metodo: 'POST', cookie, cuerpo: { texto: 'x'.repeat(70 * 1024) } });
  assert.equal(grande.status, 413);
});

test('cabeceras de seguridad en todo, y la CSP admite el <script> en línea del panel por su huella', async (t) => {
  const w = await arrancarWeb();
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const html = fs.readFileSync(path.join(RAIZ, 'web', 'index.html'), 'utf8');
  const enLinea = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const huella = `'sha256-${crypto.createHash('sha256').update(enLinea, 'utf8').digest('base64')}'`;
  for (const [ruta, opciones] of [['/login', {}], ['/', { cookie }], ['/api/estado', { cookie }], ['/api/salud', {}], ['/iconos/icono-192.png', {}], ['/api/estado', {}]]) {
    const r = await pedir(w.base, ruta, { ...opciones, crudo: true });
    const h = r.headers;
    assert.match(h['strict-transport-security'] || '', /max-age=\d+/, ruta);
    assert.equal(h['x-content-type-options'], 'nosniff', ruta);
    assert.equal(h['referrer-policy'], 'same-origin', ruta);
    const csp = h['content-security-policy'] || '';
    assert.match(csp, /frame-ancestors 'none'/, ruta);
    assert.match(csp, /default-src 'self'/, ruta);
    assert.ok(csp.includes(huella), `${ruta}: la CSP trae la huella del script en línea de index.html`);
    assert.ok(!/unsafe-inline|unsafe-eval|https?:/.test(csp.replace(/'sha256-[^']+'/g, '')), `${ruta}: solo recursos propios (${csp})`);
  }
});

// Cerrojo falso con la misma semántica que src/latido.js: espera hasta `espera`
// ms reintentando cada 25 ms; mientras está cogido, nadie más entra.
function mesaFalsa() {
  const m = { cogido: false, ejecutadas: [], solapes: 0 };
  m.conLaMesa = async (config, fn, { espera = 0 } = {}) => {
    const t0 = Date.now();
    while (m.cogido) {
      if (Date.now() - t0 >= espera) return { ok: false, motivo: 'ocupado', detalle: 'cerrojo cogido' };
      await dormir(25);
    }
    m.cogido = true;
    try {
      const orq = {
        comando: async (nombre, datos, interno) => {
          m.ejecutadas.push({ nombre, datos, espera, ...(interno && Object.keys(interno).length ? { interno } : {}) });
          await dormir(20);
          return { ok: true, mensaje: `${nombre} hecho` };
        },
      };
      return { ok: true, resultado: await fn(orq) };
    } finally { m.cogido = false; }
  };
  m.latido = async (ms) => { m.cogido = true; await dormir(ms); m.cogido = false; };
  return m;
}

test('un comando desde la web espera a que acabe el latido y se ejecuta UNA vez', async (t) => {
  const mesa = mesaFalsa();
  const w = await arrancarWeb({ conLaMesa: mesa.conLaMesa });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const latido = mesa.latido(400);
  const t0 = Date.now();
  const r = await pedir(w.base, '/api/comando/pausar', { metodo: 'POST', cookie, cuerpo: {} });
  await latido;
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, mensaje: 'pausar hecho' });
  assert.ok(Date.now() - t0 >= 350, 'esperó al latido');
  assert.equal(mesa.ejecutadas.length, 1);
  assert.equal(mesa.ejecutadas[0].nombre, 'pausar');
  assert.ok(mesa.ejecutadas[0].espera > 19_000 && mesa.ejecutadas[0].espera <= 20_000, `espera de 20 s (${mesa.ejecutadas[0].espera})`);
});

test('dos comandos a la vez van en serie, cada uno una vez; con el cerrojo cogido más de la espera → 503', async (t) => {
  const mesa = mesaFalsa();
  const w = await arrancarWeb({ conLaMesa: mesa.conLaMesa, esperaComandoMs: 300 });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const [a, b] = await Promise.all([
    pedir(w.base, '/api/comando/pausar', { metodo: 'POST', cookie, cuerpo: {} }),
    pedir(w.base, '/api/comando/reabrir', { metodo: 'POST', cookie, cuerpo: { confirmacion: 'REABRIR' } }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(mesa.ejecutadas.map(e => e.nombre).sort(), ['pausar', 'reabrir']);
  assert.deepEqual(mesa.ejecutadas.find(e => e.nombre === 'reabrir').datos, { confirmacion: 'REABRIR' });
  const latido = mesa.latido(800);
  const ocupada = await pedir(w.base, '/api/comando/pausar', { metodo: 'POST', cookie, cuerpo: {} });
  await latido;
  assert.equal(ocupada.status, 503);
  assert.equal(ocupada.json.mensaje, 'La mesa está en pleno latido, vuelve a intentarlo.');
  assert.ok(ocupada.headers['retry-after']);
  assert.equal(mesa.ejecutadas.length, 2, 'la que no entró no se ejecutó');
  // Comando desconocido: 404 sin tocar la mesa. Un error de la mesa: 500 con el detalle.
  assert.equal((await pedir(w.base, '/api/comando/borrar-todo', { metodo: 'POST', cookie, cuerpo: {} })).status, 404);
  assert.equal(mesa.ejecutadas.length, 2);
});

test('el código HTTP del resultado del orquestador se respeta (400 de una confirmación mal escrita)', async (t) => {
  const w = await arrancarWeb({
    conLaMesa: async (c, fn) => ({ ok: true, resultado: await fn({ comando: async () => ({ ok: false, codigo: 400, mensaje: 'Para el kill switch hay que escribir KILL.' }) }) }),
  });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const r = await pedir(w.base, '/api/comando/kill', { metodo: 'POST', cookie, cuerpo: { confirmacion: 'kill' } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { ok: false, mensaje: 'Para el kill switch hay que escribir KILL.' });
  const w2 = await arrancarWeb({ conLaMesa: async () => ({ ok: false, motivo: 'error', detalle: 'estado.json ilegible' }) });
  t.after(w2.cerrar);
  const c2 = await entrar(w2.base);
  const e = await pedir(w2.base, '/api/comando/pausar', { metodo: 'POST', cookie: c2, cuerpo: {} });
  assert.equal(e.status, 500);
  assert.match(e.json.mensaje, /estado\.json ilegible/);
});

test('Megáfono: interpreta FUERA del cerrojo y solo lo toma para guardar; la interpretación nunca viene del navegador', async (t) => {
  const mesa = mesaFalsa();
  const vistas = [];
  const interpretarMegafono = async ({ texto, instantanea, config }) => {
    vistas.push({ texto, cerrojo: mesa.cogido, conInstantanea: Boolean(instantanea && instantanea.cabecera), carpeta: config.carpetaDatos });
    await dormir(50);
    return { directivas: [{ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 24 }], explicacion: 'Pausa SOL 24 h.', fuente: 'palabras_clave' };
  };
  const w = await arrancarWeb({ conLaMesa: mesa.conLaMesa, interpretarMegafono });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const r = await pedir(w.base, '/api/comando/megafono', {
    metodo: 'POST', cookie,
    cuerpo: { texto: '  pausa SOL 24 h  ', interpretacion: { directivas: [{ tipo: 'reducir_riesgo', factor: 0 }] } },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(vistas, [{ texto: 'pausa SOL 24 h', cerrojo: false, conInstantanea: true, carpeta: w.carpeta }]);
  assert.equal(mesa.ejecutadas.length, 1);
  // La interpretación va por el canal interno, nunca entre los datos (que son
  // los del navegador): así el modo local tampoco la puede recibir de fuera.
  assert.deepEqual(mesa.ejecutadas[0].datos, { texto: 'pausa SOL 24 h' });
  assert.deepEqual(mesa.ejecutadas[0].interno, {
    interpretacion: { directivas: [{ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 24 }], explicacion: 'Pausa SOL 24 h.', fuente: 'palabras_clave' },
  });
  // Texto vacío: ni se interpreta ni se toca la mesa.
  const vacio = await pedir(w.base, '/api/comando/megafono', { metodo: 'POST', cookie, cuerpo: { texto: '   ' } });
  assert.equal(vacio.json.ok, false);
  assert.equal(vistas.length, 1);
  // En cualquier otro comando, una «interpretacion» del navegador se quita.
  await pedir(w.base, '/api/comando/megafono-aplicar', { metodo: 'POST', cookie, cuerpo: { id: 'mf-1', interpretacion: { x: 1 } } });
  assert.deepEqual(mesa.ejecutadas[1].datos, { id: 'mf-1' });
});

test('Ajustes (GET) salen de la instantánea sin tomar el cerrojo', async (t) => {
  let llamadas = 0;
  const w = await arrancarWeb({ conLaMesa: async () => { llamadas++; return { ok: false, motivo: 'ocupado' }; } });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const r = await pedir(w.base, '/api/comando/ajustes', { cookie });
  assert.equal(r.status, 200);
  const inst = instantaneaDePrueba();
  assert.equal(r.json.datos.modo, inst.modo);
  assert.equal(r.json.datos.presupuestoDiaUsd, inst.llm.presupuestoDiaUsd);
  assert.deepEqual(r.json.datos.limites, inst.limites);
  assert.ok(r.json.datos.modelosDisponibles.includes('claude-haiku-4-5'));
  assert.equal(llamadas, 0);
  assert.equal((await pedir(w.base, '/api/comando/pausar', { cookie })).status, 405, 'los demás comandos van por POST');
});

test('SSE: estado al conectar, y mensajes, ejecuciones, agentes y estado nuevos a partir de los ficheros', async (t) => {
  const w = await arrancarWeb({ vigiaMs: 50 });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const sse = abrirSSE(w.base, cookie);
  t.after(() => sse.cerrar());
  const res = await sse.abierto;
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-cache, no-transform');
  assert.equal(res.headers['x-accel-buffering'], 'no');
  await sse.esperar(ev => ev.some(e => e.evento === 'estado'));
  const primero = sse.eventos.find(e => e.evento === 'estado').datos;
  assert.equal(primero.web, true);
  assert.equal(primero.sesion.usuario, 'eduardo');

  // Un mensaje nuevo en mensajes.jsonl (escrito en dos trozos: la línea a medias no sale).
  const m = { id: 'm-web-1', t: Date.UTC(2026, 5, 1, 12, 1), de: 'riesgos', canal: 'riesgo', tipo: 'alerta', texto: 'Prueba de la web.', importancia: 2 };
  const linea = JSON.stringify(m) + '\n';
  fs.appendFileSync(path.join(w.carpeta, 'mensajes.jsonl'), linea.slice(0, 20));
  await dormir(200);
  assert.equal(sse.eventos.filter(e => e.evento === 'mensaje').length, 0, 'media línea no es un mensaje');
  fs.appendFileSync(path.join(w.carpeta, 'mensajes.jsonl'), linea.slice(20));
  await sse.esperar(ev => ev.some(e => e.evento === 'mensaje'));
  assert.deepEqual(sse.eventos.filter(e => e.evento === 'mensaje').map(e => e.datos), [m]);

  // El latido publica otra instantánea: un agente cambia de sala y hay una ejecución nueva.
  const inst = instantaneaDePrueba();
  const ag = inst.agentes[0];
  const nueva = JSON.parse(JSON.stringify(inst));
  nueva.agentes[0].sala = ag.sala === 'comite' ? 'parque' : 'comite';
  const ej = { id: 'ej-web-1', t: Date.UTC(2026, 5, 1, 12, 2), puestoId: inst.puestos[0].id, simbolo: inst.puestos[0].simbolo, lado: 'compra', cantidad: 1, precio: 100 };
  nueva.ejecuciones = [ej, ...(inst.ejecuciones || [])];
  nueva.cabecera.patrimonio += 123;
  await dormir(20);
  escribirInstantanea(w.carpeta, nueva);
  await sse.esperar(ev => ev.filter(e => e.evento === 'estado').length >= 2);
  const ejecs = sse.eventos.filter(e => e.evento === 'ejecucion').map(e => e.datos);
  assert.deepEqual(ejecs, [ej]);
  const agentes = sse.eventos.filter(e => e.evento === 'agente').map(e => e.datos);
  assert.deepEqual(agentes.map(a => [a.id, a.sala]), [[ag.id, nueva.agentes[0].sala]]);
  const ultimo = sse.eventos.filter(e => e.evento === 'estado').pop().datos;
  assert.equal(ultimo.cabecera.patrimonio, inst.cabecera.patrimonio + 123);
  // Orden: la ejecución y el agente llegan antes que el estado que los trae.
  const orden = sse.eventos.map(e => e.evento);
  assert.ok(orden.lastIndexOf('ejecucion') < orden.lastIndexOf('estado'));
  // Sin cambios, no se repite el estado.
  const estados = () => sse.eventos.filter(e => e.evento === 'estado').length;
  const n = estados();
  await dormir(250);
  assert.equal(estados(), n);
});

test('SSE: la sesión cerrada con el panel abierto lo corta con un evento «sesion»', async (t) => {
  const w = await arrancarWeb({ vigiaMs: 30, revisarSesionMs: 60 });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const sse = abrirSSE(w.base, cookie);
  t.after(() => sse.cerrar());
  await sse.esperar(ev => ev.some(e => e.evento === 'estado'));
  await pedir(w.base, '/api/logout', { metodo: 'POST', cookie, cuerpo: {} });
  await sse.esperar(ev => ev.some(e => e.evento === 'sesion'), 3000);
  assert.equal(w.servidor.clientesSSE.size, 0);
});

test('mensajes, operaciones y costes del LLM salen de los JSONL de la carpeta', async (t) => {
  const w = await arrancarWeb();
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  anadirMensaje(w.carpeta, { id: 'a', t: 100, de: 'x', texto: 'uno' });
  anadirMensaje(w.carpeta, { id: 'b', t: 200, de: 'x', texto: 'dos' });
  const r = await pedir(w.base, '/api/mensajes?desde=200', { cookie });
  assert.deepEqual(r.json.map(m => m.id), ['b']);
  fs.writeFileSync(path.join(w.carpeta, 'operaciones.jsonl'), `${JSON.stringify({ id: 'op1', pnl: 5 })}\n`);
  assert.deepEqual((await pedir(w.base, '/api/operaciones', { cookie })).json, [{ id: 'op1', pnl: 5 }]);
  fs.writeFileSync(path.join(w.carpeta, 'llm-costes.jsonl'), `${JSON.stringify({ t: Date.UTC(2026, 8, 30), costeUsd: 0.25, proposito: 'megafono' })}\n`);
  const c = (await pedir(w.base, '/api/costes-llm', { cookie })).json;
  assert.equal(c.totalUsd, 0.25);
  assert.equal(c.llamadas, 1);
});

test('salud: sin sesión ni datos del fondo; 503 si el último latido pasa de 3 min', async (t) => {
  const w = await arrancarWeb();
  t.after(w.cerrar);
  const ok = await pedir(w.base, '/api/salud');
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.json).sort(), ['latidosMalosSeguidos', 'modo', 'ok', 'ultimoLatidoHaceSeg', 'version']);
  assert.equal(ok.json.version, 'prueba-1');
  assert.equal(ok.json.modo, 'sintetico');
  const hace = (s, extra = {}) => ({ t: Date.now() - s * 1000, inicio: Date.now() - s * 1000, ms: 2000, ok: true, resumen: 'x', ...extra });
  const escribir = (...l) => fs.writeFileSync(path.join(w.carpeta, 'latidos.jsonl'), l.map(x => `${JSON.stringify(x)}\n`).join(''));
  escribir(hace(400), hace(62));
  const r1 = await pedir(w.base, '/api/salud');
  assert.equal(r1.status, 200);
  assert.equal(r1.json.ultimoLatidoHaceSeg, 60, 'el último, contando lo que tardó');
  assert.equal(r1.json.latidosMalosSeguidos, 0);
  escribir(hace(200));
  const r2 = await pedir(w.base, '/api/salud');
  assert.equal(r2.status, 503);
  assert.equal(r2.json.ok, false);
  // Mesa parada por un cerrojo huérfano: cada minuto un «omitido» (ok: false)
  // recién apuntado. No cuentan: el último BUENO es de hace 400 s.
  const omitido = s => hace(s, { ok: false, ms: 1, resumen: 'ocupado: Otra mesa ya usa la carpeta' });
  escribir(hace(400), omitido(300), omitido(240), omitido(180), omitido(120), omitido(60), omitido(2));
  const r4 = await pedir(w.base, '/api/salud');
  assert.equal(r4.status, 503, 'omitidos recientes no son latidos');
  assert.equal(r4.json.ultimoLatidoHaceSeg, 398);
  assert.equal(r4.json.latidosMalosSeguidos, 6);
  // Fallidos, igual.
  escribir(hace(400), hace(5, { ok: false, resumen: 'error: estado ilegible' }));
  assert.equal((await pedir(w.base, '/api/salud')).status, 503);
  // Solo omitidos en el fichero: no hay latido bueno que enseñar.
  escribir(omitido(2));
  const r5 = await pedir(w.base, '/api/salud');
  assert.equal(r5.status, 503);
  assert.equal(r5.json.ultimoLatidoHaceSeg, null);
  const vacia = await arrancarWeb({ instantanea: null });
  t.after(vacia.cerrar);
  const r3 = await pedir(vacia.base, '/api/salud');
  assert.equal(r3.status, 503);
  assert.equal(r3.json.ultimoLatidoHaceSeg, null);
});

test('sin instantánea todavía: /api/estado responde 503 «arrancando»; sin base de datos, el login 503', async (t) => {
  const w = await arrancarWeb({ instantanea: null });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  const r = await pedir(w.base, '/api/estado', { cookie });
  assert.equal(r.status, 503);
  assert.match(r.json.mensaje, /arrancando/, 'el panel lo lee como «arrancando» (cifras.motivo503)');
  const sinBD = await arrancarWeb({ almacen: null });
  t.after(sinBD.cerrar);
  const l = await pedir(sinBD.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: 'x' } });
  assert.equal(l.status, 503);
  assert.equal((await pedir(sinBD.base, '/api/estado')).status, 401);
});

test('la base de datos caída: 503, no «sin sesión» (y nunca se abre el panel)', async (t) => {
  const almacen = almacenMemoria();
  const w = await arrancarWeb({ almacen });
  t.after(w.cerrar);
  const cookie = await entrar(w.base);
  almacen.leerSesion = async () => { throw new Error('ECONNREFUSED'); };
  const r = await pedir(w.base, '/api/estado', { cookie });
  assert.equal(r.status, 503);
  const p = await pedir(w.base, '/', { cookie, crudo: true });
  assert.equal(p.status, 503);
  almacen.reservarIntento = async () => { throw new Error('ECONNREFUSED'); };
  const l = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: 'clave-larga-de-prueba' } });
  assert.equal(l.status, 503);
});

test('el service worker lleva la versión y no es el fichero tal cual', async (t) => {
  const w = await arrancarWeb();
  t.after(w.cerrar);
  const r = await pedir(w.base, '/sw.js', { crudo: true });
  assert.equal(r.status, 200);
  assert.equal(r.headers['service-worker-allowed'], '/');
  assert.ok(!r.texto.includes('__VERSION__'));
  assert.ok(r.texto.includes(`'${w.servidor.versionSW}'`));
  assert.match(w.servidor.versionSW, /^prueba-1-[0-9a-f]{10}$/);
});

test('src/web.js: puerto de Passenger (PORT, número o socket), PUERTO o 3000', () => {
  assert.deepEqual(destinoEscucha({ PORT: '41234' }), { puerto: 41234, host: undefined });
  assert.deepEqual(destinoEscucha({ PORT: '/tmp/passenger.sock' }), { socket: '/tmp/passenger.sock' });
  assert.deepEqual(destinoEscucha({ PUERTO: '8123' }), { puerto: 8123, host: '127.0.0.1' });
  assert.deepEqual(destinoEscucha({}), { puerto: 3000, host: '127.0.0.1' });
});
