'use strict';
// Usuarios del panel web (ARQUITECTURA-WEB W3 y W4). Solo se guarda el hash.
//
//   crearUsuario(pool, { usuario, clave })    → { usuarioId }
//   cambiarClave(pool, { usuario, clave })    → { usuarioId }   (y cierra sus sesiones)
//   comprobarClave(pool, { usuario, clave })  → { ok, usuarioId }
//
// Hash: crypto.scrypt con sal aleatoria de 16 bytes, N=2^15, r=8, p=1 y 64
// bytes de salida. El formato se describe a sí mismo, para que un cambio de
// parámetros no deje sin entrar a nadie:
//
//   scrypt$ln=15,r=8,p=1$<sal en base64>$<clave derivada en base64>
//
// La comparación es con timingSafeEqual y, si el usuario no existe, se gasta
// igualmente un scrypt: el tiempo de respuesta no dice qué usuarios existen.

const crypto = require('crypto');

const PARAMETROS = Object.freeze({ ln: 15, r: 8, p: 1 });
const BYTES_SAL = 16;
const BYTES_CLAVE = 64;
const CLAVE_MINIMA = 12;
const USUARIO_VALIDO = /^[A-Za-z0-9._@-]{1,64}$/;

// Memoria que pide scrypt: 128·N·r bytes (32 MiB con N=2^15, r=8). El tope por
// defecto de Node es justo 32 MiB y se queda corto: se da el doble.
function maxmemDe(N, r) {
  return 2 * 128 * N * r;
}

function scrypt(clave, sal, { ln, r, p }, largo = BYTES_CLAVE) {
  const N = 2 ** ln;
  return new Promise((resolver, rechazar) => {
    crypto.scrypt(Buffer.from(String(clave), 'utf8'), sal, largo, { N, r, p, maxmem: maxmemDe(N, r) }, (e, k) => (e ? rechazar(e) : resolver(k)));
  });
}

async function hashDeClave(clave, parametros = PARAMETROS) {
  const sal = crypto.randomBytes(BYTES_SAL);
  const k = await scrypt(clave, sal, parametros);
  const { ln, r, p } = parametros;
  return `scrypt$ln=${ln},r=${r},p=${p}$${sal.toString('base64')}$${k.toString('base64')}`;
}

// Lee un hash guardado. Devuelve null si no tiene el formato. Los parámetros
// tienen tope: un hash manipulado en la base no puede tumbar el proceso.
function leerHash(hash) {
  const partes = String(hash || '').split('$');
  if (partes.length !== 4 || partes[0] !== 'scrypt') return null;
  const params = {};
  for (const par of partes[1].split(',')) {
    const [k, v] = par.split('=');
    params[k] = Number(v);
  }
  const { ln, r, p } = params;
  if (![ln, r, p].every(Number.isInteger)) return null;
  if (ln < 10 || ln > 20 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  const sal = Buffer.from(partes[2], 'base64');
  const clave = Buffer.from(partes[3], 'base64');
  if (sal.length < 8 || clave.length < 32) return null;
  return { ln, r, p, sal, clave };
}

async function coincide(hash, clave) {
  const h = leerHash(hash);
  if (!h) return false;
  const k = await scrypt(clave, h.sal, h, h.clave.length);
  return k.length === h.clave.length && crypto.timingSafeEqual(k, h.clave);
}

function validarUsuario(usuario) {
  const u = String(usuario || '').trim();
  if (!USUARIO_VALIDO.test(u)) {
    throw new Error('El usuario tiene que tener entre 1 y 64 caracteres: letras sin tilde, números, punto, guion, guion bajo o @.');
  }
  return u;
}

function validarClave(clave) {
  const c = String(clave === undefined || clave === null ? '' : clave);
  if ([...c].length < CLAVE_MINIMA) throw new Error(`La contraseña tiene que tener al menos ${CLAVE_MINIMA} caracteres.`);
  if (Buffer.byteLength(c, 'utf8') > 1024) throw new Error('La contraseña es demasiado larga (más de 1024 bytes).');
  return c;
}

async function crearUsuario(pool, { usuario, clave, ahora = Date.now() } = {}) {
  const u = validarUsuario(usuario);
  const c = validarClave(clave);
  const hash = await hashDeClave(c);
  try {
    const [r] = await pool.query('INSERT INTO mesa_usuarios (usuario, hash, creado) VALUES (?, ?, ?)', [u, hash, new Date(ahora)]);
    return { usuarioId: r.insertId };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      const err = new Error(`El usuario «${u}» ya existe.`);
      err.code = 'EXISTE';
      throw err;
    }
    throw e;
  }
}

// Cambia la contraseña y cierra todas las sesiones de ese usuario (quien
// tuviera la vieja deja de estar dentro).
async function cambiarClave(pool, { usuario, clave } = {}) {
  const u = validarUsuario(usuario);
  const c = validarClave(clave);
  const [filas] = await pool.query('SELECT id FROM mesa_usuarios WHERE usuario = ?', [u]);
  if (!filas.length) {
    const err = new Error(`El usuario «${u}» no existe.`);
    err.code = 'NO_EXISTE';
    throw err;
  }
  const id = filas[0].id;
  await pool.query('UPDATE mesa_usuarios SET hash = ? WHERE id = ?', [await hashDeClave(c), id]);
  await pool.query('DELETE FROM mesa_sesiones WHERE usuario_id = ?', [id]);
  return { usuarioId: id };
}

async function existeUsuario(pool, usuario) {
  const [filas] = await pool.query('SELECT id FROM mesa_usuarios WHERE usuario = ?', [String(usuario || '').trim()]);
  return filas.length > 0;
}

// Un hash de relleno, calculado una vez por proceso, para gastar lo mismo
// cuando el usuario no existe.
let hashRelleno = null;

async function comprobarClave(pool, { usuario, clave, ahora = Date.now() } = {}) {
  const u = String(usuario === undefined || usuario === null ? '' : usuario).trim();
  const c = String(clave === undefined || clave === null ? '' : clave);
  let fila = null;
  if (USUARIO_VALIDO.test(u) && Buffer.byteLength(c, 'utf8') <= 1024) {
    const [filas] = await pool.query('SELECT id, hash FROM mesa_usuarios WHERE usuario = ?', [u]);
    fila = filas[0] || null;
  }
  if (!fila) {
    if (!hashRelleno) hashRelleno = await hashDeClave(crypto.randomBytes(16).toString('hex'));
    await coincide(hashRelleno, c.slice(0, 1024));
    return { ok: false, usuarioId: null };
  }
  const ok = await coincide(fila.hash, c);
  if (!ok) return { ok: false, usuarioId: null };
  await pool.query('UPDATE mesa_usuarios SET ultimo_acceso = ? WHERE id = ?', [new Date(ahora), fila.id]);
  return { ok: true, usuarioId: fila.id };
}

module.exports = {
  crearUsuario, cambiarClave, comprobarClave, existeUsuario,
  hashDeClave, leerHash, coincide, validarUsuario, validarClave,
  PARAMETROS, CLAVE_MINIMA,
};
