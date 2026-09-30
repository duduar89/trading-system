#!/usr/bin/env node
'use strict';
// Enlace de alta desde el servidor, para cuando todavía no hay nadie en el panel que pueda darlo (la
// primera persona de dirección) o quien gestiona el equipo ha perdido todas sus passkeys. Lo demás se
// hace desde el panel, en «Equipo».
//   node scripts/invitar.js --email direccion@ejemplo.com --nombre "Nombre Apellido" --rol direccion
//   node scripts/invitar.js --email direccion@ejemplo.com      (ya existe: enlace nuevo; anula el anterior)
// El enlace es de un solo uso y caduca a las 24 h. Sale por la terminal y no se guarda en ningún
// sitio: en la base solo queda su huella.
// En cPanel, con el Node de la app: . ~/nodevenv/iemec-app/22/bin/activate && cd ~/iemec-app && node …
// El enlace se hace con URL_PUBLICA del .env (la terminal no ve las variables de «Setup Node.js App»).
const db = require('../servidor/db');
const acceso = require('../servidor/acceso');
const T = require('../motor/tiempo');

function opcion(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// Sin URL_PUBLICA el enlace sale con la del portátil (http://localhost:3004), que en el servidor no abre
// nada: se avisa. En producción tiene que ser la https del panel; si no, ni se crea el enlace.
function comprobarUrlPublica(entorno = process.env) {
  const url = entorno.URL_PUBLICA || '';
  if (entorno.NODE_ENV === 'production' && !/^https:\/\//.test(url)) {
    throw new Error(`URL_PUBLICA tiene que ser la dirección https del panel (ahora: ${url || 'sin poner'}). Ponla en el .env de ~/iemec-app.`);
  }
  if (!url) console.warn('⚠ Falta URL_PUBLICA: el enlace sale con http://localhost:3004, que solo abre en el portátil. En el servidor, ponla en el .env de ~/iemec-app.');
}

async function main() {
  const email = String(opcion('email') || '').trim().toLowerCase();
  if (!email) throw new Error('Uso: node scripts/invitar.js --email correo [--nombre "Nombre" --rol direccion]');
  comprobarUrlPublica();
  const pool = db.pool();
  const actor = `consola:${process.env.USER || 'servidor'}`;
  const [[u]] = await pool.query('SELECT id, nombre, rol FROM usuarios WHERE email = ?', [email]);
  const r = u
    ? { usuario: u, ...(await acceso.invitar(pool, { usuarioId: u.id, actor })) }
    : await acceso.crearUsuario(pool, { email, nombre: opcion('nombre'), rol: opcion('rol') || 'direccion', actor });
  console.log(`✓ ${u ? 'Enlace nuevo' : 'Alta'} de ${r.usuario.nombre} (${r.usuario.rol})`);
  console.log(`  ${r.enlace}`);
  const p = T.partesMadrid(r.caduca);
  console.log(`  Un solo uso; caduca el ${p.fecha} a las ${p.hora} (hora de Madrid). Pásaselo en mano o por un canal de confianza.`);
}

main()
  .catch((err) => { console.error(`✗ ${err.message}`); process.exitCode = 1; })
  .finally(() => db.cerrar());
