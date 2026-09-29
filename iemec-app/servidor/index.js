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

// El despliegue deja aquí el commit que sube: así /api/version dice qué hay de verdad arriba.
const COMMIT = (() => {
  try { return fs.readFileSync(path.join(__dirname, 'commit.txt'), 'utf8').trim(); } catch { return null; }
})();

function crearApp({ pool = db.pool } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
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

  app.use('/api', (_req, res) => res.status(404).json({ error: 'No existe esa ruta de la API' }));

  // La PWA compilada; cualquier otra ruta devuelve la app (la navegación la lleva el cliente).
  const publico = path.join(__dirname, 'public');
  app.use(express.static(publico));
  app.get('/{*ruta}', (_req, res) => {
    const indice = path.join(publico, 'index.html');
    if (fs.existsSync(indice)) res.sendFile(indice);
    else res.status(404).send('Falta compilar el panel: npm run build');
  });
  return app;
}

module.exports = { crearApp };

const lanzadoPorElHosting = /lsnode/.test(require.main?.filename || '');
if (require.main === module || lanzadoPorElHosting) {
  crearApp().listen(config.puerto, () => console.log(`iemec-app escuchando en ${config.puerto}`));
}
