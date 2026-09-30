'use strict';
// Defensas generales de la app: cabeceras de seguridad, comprobación del origen de lo que cambia cosas
// (contra CSRF, además de la cookie SameSite=Strict) y límite de intentos. El límite se guarda en
// MariaDB, no en memoria: en cPanel puede haber varios procesos de la app y aquí no hay temporizadores
// (las ventanas pasadas las borra el cron). De la IP solo se guarda una huella con el secreto de la
// sesión, que no se puede deshacer sin él.
const crypto = require('crypto');
const config = require('./config');
const { secreto } = require('./sesion');

// El panel se abre desde URL_PUBLICA. Fuera de producción vale también el servidor de Vite
// (`npm run dev`, el puerto de vite.config.mjs), que pasa la API al Express.
const VITE = 'http://localhost:5174';
function origenesPermitidos() {
  const principal = new URL(process.env.URL_PUBLICA || config.urlPublica).origin;
  return process.env.NODE_ENV === 'production' ? [principal] : [...new Set([principal, VITE])];
}

// Política de contenido del panel compilado: nada de fuera, ni scripts en línea, ni marcos. (Los
// estilos en línea sí: los pone React en algunos elementos.)
const CSP_PANEL = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
  "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Las que falten, en todas las respuestas. La API solo devuelve JSON: ni scripts ni marcos.
function cabeceras() {
  return (req, res, next) => {
    const poner = (nombre, valor) => { if (!res.get(nombre)) res.set(nombre, valor); };
    poner('X-Content-Type-Options', 'nosniff');
    poner('X-Frame-Options', 'DENY');
    poner('Referrer-Policy', 'same-origin');
    poner('Cross-Origin-Opener-Policy', 'same-origin');
    poner('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (process.env.NODE_ENV === 'production') poner('Strict-Transport-Security', 'max-age=31536000');
    if (req.path.startsWith('/api/')) poner('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    next();
  };
}

/**
 * CSRF: lo que cambia cosas (POST, PUT, PATCH, DELETE) tiene que venir del propio panel. Con cabecera
 * Origin, tiene que ser la de URL_PUBLICA (o la de la propia petición); sin ella, Sec-Fetch-Site tiene
 * que decir «same-origin». Sin ninguna de las dos no es un navegador (o es uno muy antiguo): ahí basta
 * la cookie SameSite=Strict, que un navegador no manda desde otra web. Como la protección de origen
 * cruzado de Go (net/http, 2025).
 */
function mismoOrigen() {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origen = req.get('origin');
    const sitio = req.get('sec-fetch-site');
    const propio = `${req.protocol}://${req.get('host')}`;
    const vale = origen ? origenesPermitidos().includes(origen) || origen === propio : !sitio || sitio === 'same-origin' || sitio === 'none';
    if (vale) return next();
    res.status(403).json({ error: 'Petición rechazada: no viene del panel de la clínica', codigo: 'ORIGEN' });
  };
}

// Detrás de qué proxy está la app (el «trust proxy» de Express): solo del que está en la misma máquina
// (el servidor web del alojamiento o el nginx del VPS, que hablan con Node por 127.0.0.1 o por un
// socket Unix). La IP del visitante es entonces la que ese proxy añade al final de X-Forwarded-For. Si
// alguien llega a Node sin pasar por él, la cabecera no cuenta: manda la IP de la conexión (si no,
// cambiándola en cada petición se saltaría el límite de intentos). Cómo comprobarlo en el alojamiento:
// docs/DESPLIEGUE.md.
const PROXY_LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const confiarEnProxyLocal = (ip, salto) => salto === 0 && (!ip || PROXY_LOCAL.has(ip));

// Compara dos secretos en tiempo constante, también si miden distinto.
function igualesSeguro(a, b) {
  const h = (x) => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

// ── Límite de intentos ────────────────────────────────────────────────────────────────────────
// Por IP y ventana de 15 minutos: retos pedidos para entrar y para registrar una passkey (alta o una
// más), fallos (una passkey o un enlace que no cuadran, la clave de emergencia equivocada) e intentos con
// la clave de emergencia. Todo el equipo puede salir a internet con la misma IP de la clínica: los
// límites no se quedan cortos, y el de entrar (que no se puede adivinar) es el más holgado.
const LIMITES = {
  entrar: { max: 300, ventanaMs: 15 * 60000 },
  retos: { max: 60, ventanaMs: 15 * 60000 },
  fallos: { max: 20, ventanaMs: 15 * 60000 },
  emergencia: { max: 5, ventanaMs: 15 * 60000 },
  // El formulario de la web pública (anónimo): envíos por IP cada 15 minutos y al día, y por teléfono al
  // día (que nadie use la clínica para escribir sin parar a un número ajeno). El del teléfono no se le
  // dice a quien envía: diría si otra persona ha pedido información con ese número.
  web: { max: 8, ventanaMs: 15 * 60000 },
  webDia: { max: 20, ventanaMs: 24 * 3600000 },
  webTelefono: { max: 3, ventanaMs: 24 * 3600000 },
  // Lo que el formulario pone en marcha solo (el WhatsApp de confirmación o una tarea para recepción),
  // entre todos los envíos: si alguien lo usa desde muchas IP, pasado esto se guarda sin hacer nada y
  // una sola tarea avisa (servidor/rutas/web.js).
  webAcciones: { max: 20, ventanaMs: 3600000 },
};

const dame = (pool) => (typeof pool === 'function' ? pool() : pool);
const huellaIp = (ip) => crypto.createHmac('sha256', secreto()).update(`ip:${ip || '?'}`).digest('base64url').slice(0, 32);
const claveLimite = (tipo, req) => `${tipo}:${huellaIp(req.ip)}`;

// Suma un intento a la ventana (que empieza con el primero y dura ventanaMs) y dice cuántos lleva.
async function sumarIntento(pool, clave, { ventanaMs, ahora = new Date() }) {
  await pool.query(
    `INSERT INTO limites_acceso (clave, intentos, hasta) VALUES (?, 1, ?)
     ON DUPLICATE KEY UPDATE intentos = IF(hasta <= ?, 1, LEAST(intentos + 1, 65535)), hasta = IF(hasta <= ?, VALUES(hasta), hasta)`,
    [clave, new Date(ahora.getTime() + ventanaMs), ahora, ahora]);
  return intentos(pool, clave, ahora);
}

async function intentos(pool, clave, ahora = new Date()) {
  const [[f]] = await pool.query('SELECT intentos, hasta FROM limites_acceso WHERE clave = ? AND hasta > ?', [clave, ahora]);
  return f ? { n: f.intentos, hasta: new Date(f.hasta) } : { n: 0, hasta: null };
}

function demasiados(res, { hasta }, ahora) {
  res.set('Retry-After', String(Math.max(1, Math.ceil((hasta.getTime() - ahora.getTime()) / 1000))));
  res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.', codigo: 'DEMASIADOS_INTENTOS' });
}

// Middleware: cuenta esta petición y la para si la IP se ha pasado del límite.
function contar(pool, tipo) {
  const { max, ventanaMs } = LIMITES[tipo];
  return async (req, res, next) => {
    try {
      const ahora = req.ahora || new Date();
      const n = await sumarIntento(dame(pool), claveLimite(tipo, req), { ventanaMs, ahora });
      return n.n > max ? demasiados(res, n, ahora) : next();
    } catch (err) { next(err); }
  };
}

// Middleware: para la petición si la IP ya lleva demasiados fallos (los suma sumarFallo).
function frenar(pool, tipo = 'fallos') {
  const { max } = LIMITES[tipo];
  return async (req, res, next) => {
    try {
      const ahora = req.ahora || new Date();
      const n = await intentos(dame(pool), claveLimite(tipo, req), ahora);
      return n.n >= max ? demasiados(res, n, ahora) : next();
    } catch (err) { next(err); }
  };
}

const sumarFallo = (pool, req) => sumarIntento(dame(pool), claveLimite('fallos', req), { ventanaMs: LIMITES.fallos.ventanaMs, ahora: req.ahora || new Date() });

async function purgarLimites(pool, ahora = new Date()) {
  const [r] = await pool.query('DELETE FROM limites_acceso WHERE hasta <= ?', [ahora]);
  return r.affectedRows;
}

module.exports = {
  origenesPermitidos, CSP_PANEL, cabeceras, mismoOrigen, igualesSeguro, huellaIp, LIMITES, contar, frenar, sumarFallo, purgarLimites,
  sumarIntento, claveLimite, confiarEnProxyLocal,
};
