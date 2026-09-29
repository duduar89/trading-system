#!/usr/bin/env node
'use strict';
// Aplica las migraciones pendientes de sql/ a la base del .env (DB_NAME).
const { migrar } = require('../servidor/migraciones');

migrar()
  .then((aplicadas) => {
    console.log(aplicadas.length ? `✓ ${aplicadas.length} migraciones aplicadas` : '✓ La base ya estaba al día');
  })
  .catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
