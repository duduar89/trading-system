'use strict';
// Sesiones e intentos de login en MariaDB (ARQUITECTURA-WEB W3 y W4).
//
//   crearSesion(pool, { usuarioId, ip, agente })  → { token, expira }
//   leerSesion(pool, token)                       → { usuarioId, usuario, expira } | null
//   cerrarSesion(pool, token)
//   anotarIntento(pool, { ip, usuario, ok })
//   frenado(pool, { ip, usuario })                → { frenado, esperaSeg }
//   reservarIntento(pool, { ip, usuario })        → { frenado, esperaSeg, id }
//   resolverIntento(pool, { id, ok })
//
// - El token son 32 bytes aleatorios en base64url y va solo en la cookie. En la
//   base se guarda su SHA-256: quien lea la tabla no puede entrar con él.
// - Caduca a los 30 días de crearse (la cookie dura lo mismo). `ultima` (último
//   uso) se renueva como mucho una vez por minuto, para no escribir en la base
//   en cada petición del panel.
// - Freno: 5 fallos por IP en 15 min o 20 por usuario en 1 h. La regla es la
//   de src/web/freno.js (evaluarFreno), la misma del almacén en memoria; aquí
//   solo se leen los fallos de la ventana. La cuenta vive en la base porque
//   puede haber varios procesos de la web a la vez.
// - El login NO usa frenado + anotarIntento (mirar, gastar ~75 ms de scrypt y
//   apuntar al final): todas las peticiones de una ráfaga miraban la cuenta
//   antes de que la primera apuntara nada, y pasaban todas. Usa
//   reservarIntento: primero INSERTA el intento como fallo y después cuenta los
//   fallos de la ventana sin contar el suyo. Cada INSERT se confirma antes de
//   su SELECT, así que el k-ésimo en entrar ve al menos a los k − 1 anteriores:
//   como mucho pasan tantos como el tope, haya los procesos que haya. Si le toca
//   freno, borra su fila (un intento frenado no cuenta, como antes). Si la clave
//   es buena, resolverIntento la marca ok = 1. Un proceso que muere a mitad deja
//   su fila como fallo: se equivoca del lado seguro.
// - `ahora` (ms) se puede pasar en todas: es reloj de infraestructura, no el de
//   la mesa, y las pruebas lo mueven para probar caducidad y ventanas.
//
// Las horas van como Date y la conexión las guarda en UTC; DATETIME tiene
// resolución de segundos.

const crypto = require('crypto');
const { evaluarFreno, FRENO } = require('../web/freno');

const DURACION_SESION_MS = 30 * 24 * 3600 * 1000;
const RENOVAR_ULTIMA_MS = 60_000;
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{43}$/;   // 32 bytes en base64url sin relleno
const GUARDAR_INTENTOS_MS = 7 * 24 * 3600 * 1000;

const sha256 = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const recortar = (v, n) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, n));
const ms = d => (d instanceof Date ? d.getTime() : new Date(d).getTime());

async function crearSesion(pool, { usuarioId, ip, agente, ahora = Date.now() } = {}) {
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) throw new Error('crearSesion: usuarioId no válido');
  const token = crypto.randomBytes(32).toString('base64url');
  // DATETIME no guarda milisegundos: se trabaja con el segundo entero para que
  // lo devuelto y lo guardado sean lo mismo.
  const t = Math.floor(ahora / 1000) * 1000;
  const expira = t + DURACION_SESION_MS;
  await pool.query(
    'INSERT INTO mesa_sesiones (id, usuario_id, creada, expira, ultima, ip, agente) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sha256(token), usuarioId, new Date(t), new Date(expira), new Date(t), recortar(ip, 64), recortar(agente, 255)],
  );
  // Limpieza de paso: las caducadas no sirven para nada.
  await pool.query('DELETE FROM mesa_sesiones WHERE expira <= ?', [new Date(t)]);
  return { token, expira };
}

async function leerSesion(pool, token, { ahora = Date.now() } = {}) {
  if (typeof token !== 'string' || !TOKEN_VALIDO.test(token)) return null;
  const id = sha256(token);
  const [filas] = await pool.query(
    `SELECT s.usuario_id AS usuarioId, u.usuario AS usuario, s.expira AS expira, s.ultima AS ultima
       FROM mesa_sesiones s JOIN mesa_usuarios u ON u.id = s.usuario_id
      WHERE s.id = ?`,
    [id],
  );
  const s = filas[0];
  if (!s) return null;
  const expira = ms(s.expira);
  if (expira <= ahora) {
    await pool.query('DELETE FROM mesa_sesiones WHERE id = ?', [id]);
    return null;
  }
  if (ahora - ms(s.ultima) >= RENOVAR_ULTIMA_MS) {
    // Condicional: si dos procesos la leen a la vez, solo uno escribe.
    await pool.query('UPDATE mesa_sesiones SET ultima = ? WHERE id = ? AND ultima <= ?', [new Date(ahora), id, new Date(ahora - RENOVAR_ULTIMA_MS)]);
  }
  return { usuarioId: s.usuarioId, usuario: s.usuario, expira };
}

async function cerrarSesion(pool, token) {
  if (typeof token !== 'string' || !TOKEN_VALIDO.test(token)) return;
  await pool.query('DELETE FROM mesa_sesiones WHERE id = ?', [sha256(token)]);
}

async function anotarIntento(pool, { ip, usuario, ok, ahora = Date.now() } = {}) {
  await pool.query('INSERT INTO mesa_intentos (ip, usuario, t, ok) VALUES (?, ?, ?, ?)', [recortar(ip, 64), recortar(usuario, 64), new Date(ahora), ok ? 1 : 0]);
  // Limpieza de paso, uno de cada cincuenta: la ventana más larga es 1 h.
  if (crypto.randomInt(0, 50) === 0) {
    await pool.query('DELETE FROM mesa_intentos WHERE t < ?', [new Date(ahora - GUARDAR_INTENTOS_MS)]);
  }
}

// Los intentos que decide el freno: fallos de la IP (15 min) y del usuario
// (1 h) y los aciertos de esa pareja IP-usuario (7 días, la IP de confianza).
// `sinId`: la fila propia de reservarIntento, que no cuenta contra sí misma.
async function intentosDelFreno(pool, { ipR, usuarioR, ahora, sinId = 0 }) {
  const intentos = [];
  if (ipR) {
    const [filas] = await pool.query('SELECT t FROM mesa_intentos WHERE ip = ? AND ok = 0 AND t > ? AND id <> ?', [ipR, new Date(ahora - FRENO.ip.ventanaMs), sinId]);
    for (const f of filas) intentos.push({ ip: ipR, usuario: undefined, ok: false, t: ms(f.t) });
  }
  if (usuarioR) {
    const [filas] = await pool.query('SELECT t FROM mesa_intentos WHERE usuario = ? AND ok = 0 AND t > ? AND id <> ?', [usuarioR, new Date(ahora - FRENO.usuario.ventanaMs), sinId]);
    for (const f of filas) intentos.push({ ip: undefined, usuario: usuarioR, ok: false, t: ms(f.t) });
  }
  if (ipR && usuarioR) {
    const [filas] = await pool.query('SELECT t FROM mesa_intentos WHERE ip = ? AND usuario = ? AND ok = 1 AND t > ? ORDER BY t DESC LIMIT 1', [ipR, usuarioR, new Date(ahora - FRENO.confianzaMs)]);
    for (const f of filas) intentos.push({ ip: ipR, usuario: usuarioR, ok: true, t: ms(f.t) });
  }
  return intentos;
}

async function frenado(pool, { ip, usuario, ahora = Date.now() } = {}) {
  const ipR = recortar(ip, 64);
  const usuarioR = recortar(usuario, 64);
  const intentos = await intentosDelFreno(pool, { ipR, usuarioR, ahora });
  return evaluarFreno(intentos, { ip: ipR, usuario: usuarioR, ahora });
}

async function reservarIntento(pool, { ip, usuario, ahora = Date.now() } = {}) {
  const ipR = recortar(ip, 64);
  const usuarioR = recortar(usuario, 64);
  const [r] = await pool.query('INSERT INTO mesa_intentos (ip, usuario, t, ok) VALUES (?, ?, ?, 0)', [ipR, usuarioR, new Date(ahora)]);
  const id = r.insertId;
  const intentos = await intentosDelFreno(pool, { ipR, usuarioR, ahora, sinId: id });
  const f = evaluarFreno(intentos, { ip: ipR, usuario: usuarioR, ahora });
  if (f.frenado) {
    await pool.query('DELETE FROM mesa_intentos WHERE id = ?', [id]);
    return { ...f, id: null };
  }
  if (crypto.randomInt(0, 50) === 0) {
    await pool.query('DELETE FROM mesa_intentos WHERE t < ?', [new Date(ahora - GUARDAR_INTENTOS_MS)]);
  }
  return { ...f, id };
}

async function resolverIntento(pool, { id, ok } = {}) {
  if (!Number.isInteger(id) || id <= 0) return;
  await pool.query('UPDATE mesa_intentos SET ok = ? WHERE id = ?', [ok ? 1 : 0, id]);
}

module.exports = {
  crearSesion, leerSesion, cerrarSesion, anotarIntento, frenado, reservarIntento, resolverIntento, sha256,
  DURACION_SESION_MS, RENOVAR_ULTIMA_MS,
};
