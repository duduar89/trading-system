'use strict';
// Enlace de alta de un solo uso (docs/06-app-web.md): así Eduardo elige su
// usuario y su contraseña sin que pasen por ningún registro.
//
// - scripts/crear-alta.js genera 32 bytes aleatorios y guarda en
//   data/alta.json solo su SHA-256 y la caducidad (24 h), con permisos 600.
// - El enlace lleva el token detrás de «#»: el navegador no manda esa parte al
//   servidor, así que no queda en el registro de accesos de LiteSpeed. La
//   página lo lee y lo manda en el cuerpo de un POST.
// - Se consume renombrando el fichero: rename es atómico, así que con dos
//   peticiones a la vez (o varios procesos) solo una se lo queda. Si el alta
//   falla después (usuario no válido, base caída), el fichero se devuelve y el
//   enlace sigue valiendo.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FICHERO = 'alta.json';
const DURACION_MS = 24 * 3600 * 1000;
const sha256 = t => crypto.createHash('sha256').update(String(t)).digest();

function rutaAlta(carpetaDatos) { return path.join(carpetaDatos, FICHERO); }

// `ahora`: reloj de infraestructura, no el de la mesa.
function crearAlta(carpetaDatos, { ahora = Date.now(), duracionMs = DURACION_MS } = {}) {
  fs.mkdirSync(carpetaDatos, { recursive: true });
  const token = crypto.randomBytes(32).toString('base64url');
  const datos = { hash: sha256(token).toString('hex'), expira: ahora + duracionMs };
  const tmp = `${rutaAlta(carpetaDatos)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(datos), { mode: 0o600 });
  fs.renameSync(tmp, rutaAlta(carpetaDatos));   // un enlace nuevo anula el anterior
  return { token, expira: datos.expira };
}

function leer(ruta) {
  try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch (_) { return null; }
}

function coincide(datos, token, ahora) {
  if (!datos || typeof datos.hash !== 'string' || !Number.isFinite(datos.expira)) return false;
  if (datos.expira <= ahora) return false;
  const esperado = Buffer.from(datos.hash, 'hex');
  const dado = sha256(token);
  return esperado.length === dado.length && crypto.timingSafeEqual(esperado, dado);
}

// ¿Vale este token? No lo gasta.
function altaValida(carpetaDatos, token, { ahora = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return false;
  return coincide(leer(rutaAlta(carpetaDatos)), token, ahora);
}

// Gasta el token: devuelve { devolver } (para deshacerlo si el alta falla) o null.
function consumirAlta(carpetaDatos, token, { ahora = Date.now() } = {}) {
  if (!altaValida(carpetaDatos, token, { ahora })) return null;
  const ruta = rutaAlta(carpetaDatos);
  const apartado = `${ruta}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.usado`;
  try { fs.renameSync(ruta, apartado); } catch (_) { return null; }   // otro llegó antes
  // Entre leer y renombrar pudo entrar un enlace nuevo: se comprueba lo apartado.
  if (!coincide(leer(apartado), token, ahora)) {
    try { fs.renameSync(apartado, ruta); } catch (_) { /* ya hay otro */ }
    return null;
  }
  return {
    devolver() { try { fs.linkSync(apartado, ruta); } catch (_) { /* ya hay uno nuevo: manda ese */ } try { fs.unlinkSync(apartado); } catch (_) { /* ya no está */ } },
    confirmar() { try { fs.unlinkSync(apartado); } catch (_) { /* ya no está */ } },
  };
}

module.exports = { crearAlta, altaValida, consumirAlta, rutaAlta, DURACION_MS };
