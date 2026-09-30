#!/usr/bin/env node
'use strict';
// Enlace de alta desde el servidor, para cuando todavía no hay nadie en el panel que pueda darlo (la
// primera persona de dirección) o quien gestiona el equipo ha perdido todas sus passkeys. Lo demás se
// hace desde el panel, en «Equipo».
//   node scripts/invitar.js --email direccion@ejemplo.com --nombre "Nombre Apellido" --rol direccion
//   node scripts/invitar.js --email direccion@ejemplo.com      (ya existe: enlace nuevo; anula el anterior)
// El enlace es de un solo uso y caduca a las 24 h. Sale por la terminal y no se guarda en ningún
// sitio: en la base solo queda su huella.
const db = require('../servidor/db');
const acceso = require('../servidor/acceso');
const T = require('../motor/tiempo');

function opcion(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = String(opcion('email') || '').trim().toLowerCase();
  if (!email) throw new Error('Uso: node scripts/invitar.js --email correo [--nombre "Nombre" --rol direccion]');
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
