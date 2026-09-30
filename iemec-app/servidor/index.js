'use strict';
// Entrada del servidor. Sirve la API y la PWA compilada. En cPanel lo arranca Passenger (lsnode.js);
// en el portátil, `npm start` o `npm run dev:servidor`.
const path = require('path');
const fs = require('fs');
const express = require('express');
const { version } = require('../package.json');
const config = require('./config');
const db = require('./db');
const { rutasPublicas } = require('./rutas/publicas');
const { rutasPanel } = require('./rutas/panel');
const { rutasWebhooks } = require('./rutas/webhooks');
const { rutasAcceso } = require('./rutas/acceso');
const { rutasEquipo } = require('./rutas/equipo');
const { rutasSesion, exigirSesion } = require('./sesion');
const { avisosDeArranque } = require('./acceso');
const { cabeceras, mismoOrigen, CSP_PANEL } = require('./seguridad');
const { crearIa } = require('./integraciones/ia');
const { crearWhatsApp } = require('./integraciones/whatsapp');
const { crearGoogle } = require('./integraciones/google');

// El despliegue deja aquí el commit que sube: así /api/version dice qué hay de verdad arriba.
const COMMIT = (() => {
  try { return fs.readFileSync(path.join(__dirname, 'commit.txt'), 'utf8').trim(); } catch { return null; }
})();

// publico: la carpeta del panel compilado (las pruebas de punta a punta compilan el suyo aparte).
function crearApp({ pool = db.pool, deps = null, reloj, publico = path.join(__dirname, 'public') } = {}) {
  const dependencias = deps || {
    ia: crearIa(config.modos.ia),
    whatsapp: crearWhatsApp(config.modos.whatsapp),
    google: crearGoogle(config.modos.google),
  };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cabeceras());
  // Webhooks de WhatsApp y Meta y alta de leads: antes del lector de JSON, porque la firma se
  // comprueba sobre el cuerpo tal cual llega.
  app.use(rutasWebhooks({ pool, reloj }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/version', (_req, res) => {
    res.json({ app: 'iemec-app', version, commit: COMMIT, modos: config.modos });
  });

  // Salud: la usa el monitor externo cada pocos minutos (mantiene la app despierta y avisa si cae).
  app.get('/api/salud', async (_req, res) => {
    try {
      const p = typeof pool === 'function' ? pool() : pool;
      await p.query('SELECT 1');
      res.json({ ok: true, bd: true });
    } catch (err) {
      res.status(503).json({ ok: false, bd: false, error: err.code || 'sin_bd' });
    }
  });

  app.use(rutasPublicas({ pool }));
  // Lo que cambia cosas en la API del panel tiene que venir del propio panel (CSRF).
  app.use('/api', mismoOrigen());
  app.use('/api', rutasSesion({ pool }));
  app.use('/api/acceso', rutasAcceso({ pool }));
  app.use('/api/panel', exigirSesion({ pool }));
  app.use('/api/panel', rutasEquipo({ pool }));
  app.use('/api/panel', rutasPanel({ pool, deps: { ...dependencias, pool: typeof pool === 'function' ? pool() : pool } }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'No existe esa ruta de la API' }));

  // La PWA compilada; cualquier otra ruta devuelve la app (la navegación la lleva el cliente).
  const conCsp = (res) => res.set('Content-Security-Policy', CSP_PANEL);
  app.use(express.static(publico, { setHeaders: (res, fichero) => { if (fichero.endsWith('.html')) conCsp(res); } }));
  app.get('/{*ruta}', (_req, res) => {
    const indice = path.join(publico, 'index.html');
    if (fs.existsSync(indice)) { conCsp(res); res.sendFile(indice); }
    else res.status(404).send('Falta compilar el panel: npm run build');
  });
  return app;
}

module.exports = { crearApp };

const lanzadoPorElHosting = /lsnode/.test(require.main?.filename || '');
if (require.main === module || lanzadoPorElHosting) {
  for (const aviso of avisosDeArranque()) console.warn(aviso);
  crearApp().listen(config.puerto, () => console.log(`iemec-app escuchando en ${config.puerto}`));
}
