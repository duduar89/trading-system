'use strict';
// La PWA por fichero (ARQUITECTURA-WEB W3): manifest con lo que pide Chrome
// para instalar, iconos PNG de verdad con su tamaño y al día con su
// generador, service worker que nunca cachea /api/*, páginas con el
// apple-touch-icon y las metas de iOS, y la franja de «Cifras sin actualizar»
// a 2,5 × latidoMs. La instalación en Chromium real la comprueba
// scripts/probar-web.js --navegador.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { generar, crc32 } = require('../scripts/generar-iconos');
const cifras = require('../web/js/cifras.js');
const { huellasScriptsEnLinea } = require('../src/web/cabeceras');

const WEB = path.join(__dirname, '..', 'web');
const leer = f => fs.readFileSync(path.join(WEB, f), 'utf8');

function dimensionesPNG(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'firma PNG');
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR');
  // Cada trozo con su CRC bien.
  let i = 8;
  while (i < buf.length) {
    const largo = buf.readUInt32BE(i);
    const cuerpo = buf.subarray(i + 4, i + 8 + largo);
    assert.equal(buf.readUInt32BE(i + 8 + largo), crc32(cuerpo), `CRC de ${cuerpo.subarray(0, 4)}`);
    i += 12 + largo;
  }
  return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20) };
}

test('manifest: nombre, idioma, alcance, standalone, colores e iconos 192, 512 y 512 maskable', () => {
  const m = JSON.parse(leer('manifest.webmanifest'));
  assert.equal(m.name, 'Mesa de trading');
  assert.equal(m.short_name, 'Mesa');
  assert.equal(m.lang, 'es');
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.equal(m.background_color, '#0f1424');
  assert.equal(m.theme_color, '#0f1424');
  const clave = i => `${i.sizes}|${i.purpose || 'any'}`;
  assert.deepEqual(m.icons.map(clave).sort(), ['192x192|any', '512x512|any', '512x512|maskable']);
  for (const i of m.icons) {
    assert.equal(i.type, 'image/png');
    const buf = fs.readFileSync(path.join(WEB, i.src.replace(/^\//, '')));
    const d = dimensionesPNG(buf);
    assert.equal(`${d.ancho}x${d.alto}`, i.sizes, i.src);
  }
});

test('los iconos versionados son exactamente los que genera scripts/generar-iconos.js', () => {
  const generados = generar();
  assert.ok(generados.some(g => g.nombre === 'apple-touch-icon.png' && g.lado === 180));
  for (const g of generados) {
    const disco = fs.readFileSync(path.join(WEB, 'iconos', g.nombre));
    assert.ok(disco.equals(g.bytes), `${g.nombre} al día (node scripts/generar-iconos.js)`);
    const d = dimensionesPNG(disco);
    assert.deepEqual([d.ancho, d.alto], [g.lado, g.lado]);
  }
});

test('el cubo del icono: esquinas del color del panel y el centro de cada cara con su color', () => {
  const { rasterizar } = require('../scripts/generar-iconos');
  const lado = 64;
  const px = rasterizar(lado, 0.72);
  const color = (x, y) => [...px.subarray((y * lado + x) * 3, (y * lado + x) * 3 + 3)];
  assert.deepEqual(color(0, 0), [0x0f, 0x14, 0x24]);
  assert.deepEqual(color(32, 22), [0x60, 0xa5, 0xfa], 'arriba');
  assert.deepEqual(color(24, 40), [0x1d, 0x4e, 0xd8], 'izquierda');
  assert.deepEqual(color(40, 40), [0x1e, 0x3a, 0x8a], 'derecha');
});

test('service worker: carcasa con versión, nunca /api/*, sin conexión a su página, y se actualiza solo', () => {
  const sw = leer('sw.js');
  assert.match(sw, /const VERSION = '__VERSION__'/);
  assert.match(sw, /skipWaiting\(\)/);
  assert.match(sw, /clients\.claim\(\)/);
  assert.match(sw, /\/sin-conexion\.html/);
  // Se ejecuta en un entorno de mentira y se le pasan peticiones.
  const oyentes = {};
  const guardadas = [];
  const cache = { match: async () => undefined, put: async (req) => { guardadas.push(req.url); }, addAll: async () => {} };
  const self = { location: { origin: 'https://mesa.example' }, addEventListener: (ev, fn) => { oyentes[ev] = fn; }, skipWaiting: () => {}, clients: { claim: () => {} } };
  const ctx = {
    self, URL, Response: class { constructor(c, o) { this.cuerpo = c; this.status = o && o.status; } },
    caches: { open: async () => cache, match: async () => ({ pagina: 'sin-conexion' }), keys: async () => [], delete: async () => true },
    fetch: async (req) => ({ ok: true, type: 'basic', clone() { return this; }, url: req.url }),
  };
  vm.runInNewContext(sw, ctx);
  const pedir = (url, extra = {}) => {
    let respuesta = null;
    oyentes.fetch({ request: { url, method: 'GET', mode: 'cors', ...extra }, respondWith: (p) => { respuesta = p; } });
    return respuesta;
  };
  assert.equal(pedir('https://mesa.example/api/estado'), null, '/api/estado ni se toca');
  assert.equal(pedir('https://mesa.example/api/eventos'), null, 'el SSE ni se toca');
  assert.equal(pedir('https://mesa.example/web/api/estado'), null);
  assert.equal(pedir('https://otra.example/x.js'), null, 'lo ajeno tampoco');
  assert.equal(pedir('https://mesa.example/api/comando/kill', { method: 'POST' }), null);
  assert.ok(pedir('https://mesa.example/web/js/app.js'), 'la carcasa sí');
  assert.ok(pedir('https://mesa.example/', { mode: 'navigate' }), 'la navegación sí (red primero)');
});

test('las páginas traen manifest, apple-touch-icon 180, metas de iOS y el script de la PWA', () => {
  for (const f of ['index.html', 'login.html']) {
    const h = leer(f);
    assert.match(h, /<link rel="manifest" href="\/?manifest\.webmanifest">/, f);
    assert.match(h, /<link rel="apple-touch-icon" href="\/?iconos\/apple-touch-icon\.png">/, f);
    assert.match(h, /<meta name="apple-mobile-web-app-capable" content="yes">/, f);
    assert.match(h, /<meta name="apple-mobile-web-app-status-bar-style" content="[a-z-]+">/, f);
    assert.match(h, /<meta name="theme-color" content="#0f1424">/, f);
    assert.match(h, /js\/pwa\.js/, f);
  }
  const login = leer('login.html');
  assert.match(login, /Compartir/);
  assert.match(login, /Añadir a pantalla de inicio/);
  assert.match(login, /autocomplete="current-password"/);
  // Ni el login ni la página sin conexión llevan scripts en línea: la CSP solo
  // admite, por su huella, el <base> de index.html.
  assert.equal(huellasScriptsEnLinea(WEB).length, 1);
  assert.ok(!/<script>/.test(login));
  assert.ok(!/<script/.test(leer('sin-conexion.html')));
});

test('franja «Cifras sin actualizar»: en modo web salta a 2,5 × latidoMs (no a los 30 s)', () => {
  const llegada = 1_000_000;
  // Latido de 60 s: a los 149 s todavía no, a los 151 s sí.
  assert.equal(cifras.datosParados([llegada], llegada + 149_000, 60_000).parado, false);
  const p = cifras.datosParados([llegada], llegada + 151_000, 60_000);
  assert.deepEqual([p.parado, p.limiteMs], [true, 150_000]);
  // Aunque las llegadas vengan seguidas (instantánea doble al conectar), manda el latido declarado.
  assert.equal(cifras.datosParados([llegada, llegada + 2000, llegada + 4000], llegada + 4000 + 40_000, 60_000).parado, false);
  // Con otro ritmo, 2,5 veces ese ritmo.
  assert.equal(cifras.datosParados([llegada], llegada + 76_000, 30_000).parado, true);
  // Sin latidoMs, como siempre (modo local).
  assert.equal(cifras.datosParados([0, 300, 2300, 4300, 6300], 6300 + 21000).parado, true);
});
