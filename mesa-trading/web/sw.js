// Service worker de la mesa (ARQUITECTURA-WEB W3).
//
// - Guarda la «carcasa» (páginas, css, js, iconos) en una caché con versión.
//   El servidor escribe la versión aquí dentro al servir este fichero: con
//   cada publicación cambian sus bytes, el navegador instala el nuevo, que se
//   activa en el acto (skipWaiting + clients.claim) y borra las cachés viejas.
// - NUNCA toca /api/* ni el flujo de eventos: las cifras siempre vienen de la
//   mesa, nunca de una copia guardada.
// - Sin red, una navegación cae en /sin-conexion.html.
// - Lo del panel (que pide sesión) no se guarda al instalar: al instalar desde
//   el login todavía no hay sesión. Se guarda entero (PANEL), en segundo plano,
//   la primera vez que el panel abre con sesión con esta versión; y cada
//   fichero, además, al usarlo.
'use strict';

const VERSION = '__VERSION__';
const CACHE = `mesa-carcasa-${VERSION}`;
const PRECARGA = [
  '/css/login.css',
  '/js/login.js',
  '/js/pwa.js',
  '/sin-conexion.html',
  '/manifest.webmanifest',
  '/iconos/icono-32.png',
  '/iconos/icono-192.png',
  '/iconos/icono-512.png',
  '/iconos/apple-touch-icon.png',
];
// La carcasa del panel: lo que enlaza index.html (con su <base href="/web/">).
// test/web-pwa.test.js comprueba que no falta ninguno: un fichero nuevo del
// panel entra aquí también.
const PANEL = [
  '/web/css/estilo.css', '/web/css/vistas.css',
  '/web/js/cifras.js', '/web/js/iso.js', '/web/js/mapa.js', '/web/js/dibujo.js', '/web/js/personajes.js', '/web/js/caras.js',
  '/web/js/paneles.js', '/web/js/reproductor.js', '/web/js/maqueta.js', '/web/js/pwa.js', '/web/js/graficas.js', '/web/js/vistas.js', '/web/js/app.js',
];

// Guarda lo que falte de la carcasa del panel (con la cookie de sesión: mismo
// origen). Lo que no llegue se guardará al usarlo.
function guardarPanel() {
  return caches.open(CACHE).then(c => Promise.all(PANEL.map(ruta => c.match(ruta).then(ya => ya || fetch(ruta, { credentials: 'same-origin' })
    .then(r => (r && r.ok && r.type === 'basic' ? c.put(ruta, r) : null))
    .catch(() => null)))));
}

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECARGA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k.startsWith('mesa-carcasa-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function esCarcasa(url) {
  return /\.(css|js|png|webmanifest)$/.test(url.pathname) && url.pathname !== '/sw.js';
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/web/api/')) return;   // nunca: ni cifras ni eventos

  if (req.mode === 'navigate') {
    // Red primero: la página siempre la de ahora (y el servidor decide si hay sesión).
    const red = fetch(req);
    ev.respondWith(red.catch(() => caches.match('/sin-conexion.html').then(r => r || new Response('Sin conexión.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))));
    // El panel abrió con sesión (sin sesión, el servidor redirige al login y
    // la respuesta no es ok): su carcasa entera a la caché de esta versión.
    if (url.pathname === '/' || url.pathname === '/web/' || url.pathname === '/index.html' || url.pathname === '/web/index.html') {
      ev.waitUntil(red.then(r => (r && r.ok && !r.redirected ? guardarPanel() : null)).catch(() => null));
    }
    return;
  }

  if (esCarcasa(url)) {
    // Carcasa: de la caché de esta versión; si no está, de la red y se guarda.
    ev.respondWith(caches.open(CACHE).then(c => c.match(req).then(guardada => {
      if (guardada) return guardada;
      return fetch(req).then(r => {
        if (r.ok && r.type === 'basic') c.put(req, r.clone());
        return r;
      });
    })));
  }
});
