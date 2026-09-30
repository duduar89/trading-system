// Service worker de la mesa (ARQUITECTURA-WEB W3).
//
// - Guarda la «carcasa» (páginas, css, js, iconos) en una caché con versión.
//   El servidor escribe la versión aquí dentro al servir este fichero: con
//   cada publicación cambian sus bytes, el navegador instala el nuevo, que se
//   activa en el acto (skipWaiting + clients.claim) y borra las cachés viejas.
// - NUNCA toca /api/* ni el flujo de eventos: las cifras siempre vienen de la
//   mesa, nunca de una copia guardada.
// - Sin red, una navegación cae en /sin-conexion.html.
// - Lo del panel (que pide sesión) se guarda al usarlo, no al instalar: al
//   instalar desde el login todavía no hay sesión.
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
    ev.respondWith(fetch(req).catch(() => caches.match('/sin-conexion.html').then(r => r || new Response('Sin conexión.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))));
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
