#!/usr/bin/env node
'use strict';
// Carga los datos de la clínica en la base del .env. Idempotente. `--demo` aprueba las plantillas y
// activa las ofertas (solo para enseñar la app, nunca en producción).
const db = require('../servidor/db');
const { semillar } = require('../servidor/semillas');

const demo = process.argv.includes('--demo');
if (demo && process.env.NODE_ENV === 'production') { console.error('✗ --demo no se usa en producción'); process.exit(1); }
semillar(db.pool(), { demo, log: (m) => console.log(`▸ ${m}`) })
  .then(() => console.log('✓ Semillas cargadas'))
  .catch((err) => { console.error(`✗ ${err.message}`); process.exitCode = 1; })
  .finally(() => db.cerrar());
