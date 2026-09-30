'use strict';
// Sesiones HTTP del modo web (ARQUITECTURA-WEB W3): la cookie `mesa_sesion`.
//
// El token (32 bytes aleatorios en base64url, 43 caracteres) solo viaja en la
// cookie; en la base se guarda su SHA-256 (lo hace src/bd/sesiones.js). La
// cookie va HttpOnly (el JavaScript de la página no la ve: un script inyectado
// no puede robarla), Secure (solo por https), SameSite=Strict (otra web no la
// manda en sus peticiones: es la primera defensa contra CSRF) y dura 30 días.

const NOMBRE_COOKIE = 'mesa_sesion';
const MAX_AGE_SEG = 30 * 24 * 3600;
const FORMA_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function leerCookies(req) {
  const salida = {};
  const texto = String(req.headers.cookie || '');
  for (const trozo of texto.split(';')) {
    const i = trozo.indexOf('=');
    if (i < 0) continue;
    const k = trozo.slice(0, i).trim();
    if (!k || k in salida) continue;
    let v = trozo.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try { v = decodeURIComponent(v); } catch (_) { /* se deja tal cual */ }
    salida[k] = v;
  }
  return salida;
}

// Token de la petición, o null si no hay o no tiene la forma de uno nuestro
// (así la basura ni llega a la base).
function tokenDe(req) {
  const t = leerCookies(req)[NOMBRE_COOKIE];
  return t && FORMA_TOKEN.test(t) ? t : null;
}

function cookieSesion(token, maxAgeSeg = MAX_AGE_SEG) {
  return `${NOMBRE_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeg))}`;
}

function cookieBorrada() {
  return `${NOMBRE_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

// Sesión válida de la petición: { usuarioId, usuario, expira, token } o null.
// Un fallo de la base se propaga (quien llama responde 503: no es «sin sesión»).
async function sesionDe(req, almacen) {
  const token = tokenDe(req);
  if (!token || !almacen) return null;
  const s = await almacen.leerSesion(token);
  return s ? { ...s, token } : null;
}

module.exports = { NOMBRE_COOKIE, MAX_AGE_SEG, FORMA_TOKEN, leerCookies, tokenDe, cookieSesion, cookieBorrada, sesionDe };
