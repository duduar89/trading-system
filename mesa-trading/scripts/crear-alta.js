'use strict';
// Crea el enlace de alta de un solo uso del panel web (src/web/alta.js).
//
//   node scripts/crear-alta.js                 enlace con la URL de MESA_URL (.env)
//   node scripts/crear-alta.js --url=https://mesa.ejemplo.es
//
// El enlace vale una vez y caduca en 24 h. Quien lo abre elige usuario y
// contraseña; si el usuario ya existe, le cambia la contraseña (y cierra sus
// sesiones): sirve también para recuperar el acceso. Crear otro anula el anterior.

const { crearConfig, leerArgs } = require('../src/config');
const { crearAlta, DURACION_MS } = require('../src/web/alta');

const args = leerArgs();
const config = crearConfig(args);
const base = String(args.url || process.env.MESA_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\/[^/\s]+$/.test(base)) {
  console.error('Falta la dirección del panel: pon MESA_URL en el .env o usa --url=https://…');
  process.exit(1);
}
const { token } = crearAlta(config.carpetaDatos);
console.log(`Enlace de alta (un solo uso, caduca en ${DURACION_MS / 3600000} h):`);
console.log(`${base}/alta#${token}`);
