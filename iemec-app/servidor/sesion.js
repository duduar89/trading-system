'use strict';
// Sesión del panel: cookie firmada (HMAC-SHA256), httpOnly, SameSite=Strict y Secure en producción.
// Entrada provisional con correo del personal + clave de acceso de la clínica (PANEL_CLAVE); las
// passkeys, como en El Método, sustituyen a la clave en la F5.2 (puerta en PROGRESO.md).
// Con MODO_DEMO=1 (solo fuera de producción) se entra como usuario de demostración.
const crypto = require('crypto');
const express = require('express');

const NOMBRE = 'iemec_sesion';
const DURACION_MS = 12 * 3600 * 1000;
const intentos = new Map();

function secreto() {
  const s = process.env.SESION_SECRETO;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('Falta SESION_SECRETO (32+ caracteres) en el .env del servidor');
  return 'desarrollo-no-usar-en-produccion-0123456789';
}

function firmar(datos) {
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
  const firma = crypto.createHmac('sha256', secreto()).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

function verificar(valor) {
  if (!valor || !valor.includes('.')) return null;
  const [cuerpo, firma] = valor.split('.');
  const esperada = crypto.createHmac('sha256', secreto()).update(cuerpo).digest('base64url');
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  return datos.hasta > Date.now() ? datos : null;
}

function leerCookie(req) {
  const c = req.headers.cookie || '';
  const m = new RegExp(`(?:^|; )${NOMBRE}=([^;]+)`).exec(c);
  return m ? decodeURIComponent(m[1]) : null;
}

function ponerCookie(res, valor, maxAge) {
  const seguro = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.set('Set-Cookie', `${NOMBRE}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAge / 1000)}${seguro}`);
}

function modoDemo() {
  return process.env.MODO_DEMO === '1' && process.env.NODE_ENV !== 'production';
}

function requiereSesion(req, res, next) {
  const datos = verificar(leerCookie(req));
  if (datos) { req.usuario = datos; return next(); }
  if (modoDemo()) { req.usuario = { email: 'demo@iemec', nombre: 'Demostración', rol: 'direccion' }; return next(); }
  res.status(401).json({ error: 'Hay que entrar al panel' });
}

function rutasSesion({ pool }) {
  const r = express.Router();
  const p = () => (typeof pool === 'function' ? pool() : pool);
  r.post('/sesion', express.json(), async (req, res) => {
    const ip = req.ip || 'x';
    const n = (intentos.get(ip) || 0) + 1;
    intentos.set(ip, n);
    setTimeout(() => intentos.set(ip, Math.max(0, (intentos.get(ip) || 1) - 1)), 15 * 60000).unref();
    if (n > 10) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    const { email, clave } = req.body || {};
    const buena = process.env.PANEL_CLAVE || '';
    const ok = buena.length >= 12 && typeof clave === 'string' && clave.length === buena.length
      && crypto.timingSafeEqual(Buffer.from(clave), Buffer.from(buena));
    const [[u]] = ok ? await p().query('SELECT id, email, nombre, rol FROM usuarios WHERE email = ? AND activo = TRUE', [String(email || '').toLowerCase()]) : [[null]];
    if (!u) return res.status(401).json({ error: 'Correo o clave incorrectos' });
    ponerCookie(res, firmar({ id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, hasta: Date.now() + DURACION_MS }), DURACION_MS);
    res.json({ nombre: u.nombre, rol: u.rol });
  });
  r.post('/sesion/salir', (_req, res) => { ponerCookie(res, '', 0); res.json({ ok: true }); });
  r.get('/sesion', requiereSesion, (req, res) => res.json({ nombre: req.usuario.nombre, rol: req.usuario.rol, demo: modoDemo() }));
  return r;
}

module.exports = { requiereSesion, rutasSesion, firmar, verificar };
