'use strict';
// Crea las tablas de la mesa en MariaDB (ARQUITECTURA-WEB W4).
//
//   node scripts/crear-tablas.js          enseña el SQL y pregunta antes de ejecutarlo
//   node scripts/crear-tablas.js --si     sin preguntar (despliegue, pruebas)
//   npm run crear-tablas
//
// Lee DB_HOST, DB_PUERTO, DB_USUARIO, DB_CLAVE y DB_NOMBRE del .env de esta
// carpeta. Es idempotente (CREATE TABLE IF NOT EXISTS): lanzarlo otra vez no
// toca las tablas que ya existen ni sus datos. No borra ni altera nada.
// Sale con 0 si las tablas quedan creadas, con 1 si no.

const readline = require('readline');
const { cargarEnv, leerArgs } = require('../src/config');
const { configuracionBD, obtenerPool, cerrarPool } = require('../src/bd/conexion');
const { sqlTablas, crearTablas, NOMBRES } = require('../src/bd/tablas');

function preguntar(texto) {
  return new Promise(resolver => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(texto, r => { rl.close(); resolver(String(r || '').trim()); });
  });
}

async function main() {
  cargarEnv();
  const args = leerArgs();
  const cfg = configuracionBD(process.env);
  if (!cfg) {
    console.error('Faltan DB_USUARIO y DB_NOMBRE en el .env (y DB_CLAVE, DB_HOST si hacen falta). Ver docs/06-app-web.md.');
    return 1;
  }
  console.log(`Base de datos: ${cfg.database} en ${cfg.host}:${cfg.port} (usuario ${cfg.user})\n`);
  console.log('SQL que se va a ejecutar:\n');
  console.log(sqlTablas());
  console.log('');
  if (!args.si) {
    if (!process.stdin.isTTY) {
      console.error('Sin terminal no se puede confirmar: añade --si para ejecutarlo.');
      return 1;
    }
    const r = (await preguntar('¿Crear las tablas que falten? Escribe «si» para seguir: ')).toLowerCase();
    if (r !== 'si' && r !== 'sí' && r !== 's') {
      console.log('No se ha tocado nada.');
      return 1;
    }
  }
  const pool = obtenerPool(cfg);
  try {
    const r = await crearTablas(pool);
    if (r.creadas.length) console.log(`OK creadas: ${r.creadas.join(', ')}`);
    if (r.existian.length) console.log(`OK ya existían (sin tocar): ${r.existian.join(', ')}`);
    const faltan = NOMBRES.filter(n => !r.creadas.includes(n) && !r.existian.includes(n));
    if (faltan.length) {
      console.error(`FALLO: siguen sin existir: ${faltan.join(', ')}`);
      return 1;
    }
    console.log(`OK las ${NOMBRES.length} tablas mesa_* están listas.`);
    return 0;
  } finally {
    await cerrarPool();
  }
}

main().then(c => process.exit(c), e => {
  console.error(`FALLO: ${e.code ? `${e.code}: ` : ''}${e.message}`);
  process.exit(1);
});
