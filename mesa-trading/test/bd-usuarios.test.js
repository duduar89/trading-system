'use strict';
// Usuarios y contraseñas (ARQUITECTURA-WEB W3, W4 y W5-D): scrypt con sal de
// 16 bytes, N=2^15, r=8, p=1, formato autodescrito, timingSafeEqual y en la
// base solo el hash.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const usuarios = require('../src/bd/usuarios');
const { motivoSalto, prepararBD, sufijo } = require('./bd-ayuda');

test('el hash se describe a sí mismo y lleva sal de 16 bytes', async () => {
  const h = await usuarios.hashDeClave('una-clave-larga-de-prueba');
  assert.match(h, /^scrypt\$ln=15,r=8,p=1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  const l = usuarios.leerHash(h);
  assert.deepEqual([l.ln, l.r, l.p, l.sal.length, l.clave.length], [15, 8, 1, 16, 64]);
  const otro = await usuarios.hashDeClave('una-clave-larga-de-prueba');
  assert.notEqual(otro, h, 'misma clave, otra sal, otro hash');
  assert.equal(await usuarios.coincide(h, 'una-clave-larga-de-prueba'), true);
  assert.equal(await usuarios.coincide(h, 'una-clave-larga-de-prueb'), false);
  assert.equal(await usuarios.coincide(h, ''), false);
});

test('el hash es scrypt de verdad: coincide con crypto.scryptSync con los mismos parámetros', async () => {
  const h = await usuarios.hashDeClave('ñandú-con-tilde-y-€');
  const l = usuarios.leerHash(h);
  const esperado = crypto.scryptSync(Buffer.from('ñandú-con-tilde-y-€', 'utf8'), l.sal, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  assert.ok(esperado.equals(l.clave));
});

test('un hash con otros parámetros sigue valiendo, y uno manipulado no tumba nada', async () => {
  const sal = crypto.randomBytes(16);
  const k = crypto.scryptSync('clave-vieja-de-14', sal, 64, { N: 2 ** 14, r: 8, p: 1 });
  const viejo = `scrypt$ln=14,r=8,p=1$${sal.toString('base64')}$${k.toString('base64')}`;
  assert.equal(await usuarios.coincide(viejo, 'clave-vieja-de-14'), true);
  for (const malo of ['', 'texto', 'scrypt$ln=40,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(88), 'bcrypt$x$y$z', 'scrypt$ln=15$a$b']) {
    assert.equal(usuarios.leerHash(malo) === null || !(await usuarios.coincide(malo, 'x')), true);
    assert.equal(await usuarios.coincide(malo, 'x'), false);
  }
});

test('usuario y contraseña se validan antes de tocar la base', () => {
  assert.throws(() => usuarios.validarUsuario(''), /entre 1 y 64/);
  assert.throws(() => usuarios.validarUsuario('con espacio'), /entre 1 y 64/);
  assert.throws(() => usuarios.validarUsuario('x'.repeat(65)), /entre 1 y 64/);
  assert.equal(usuarios.validarUsuario(' eduardo '), 'eduardo');
  assert.throws(() => usuarios.validarClave('corta'), /al menos 12/);
  assert.equal(usuarios.validarClave('doce-letras!'), 'doce-letras!');
});

test('crear, comprobar, repetir y cambiar la contraseña contra MariaDB', { skip: motivoSalto }, async (t) => {
  const { pool, alAcabar } = await prepararBD(t);
  const usuario = `u-${sufijo()}`;
  const clave = 'una-clave-larga-de-prueba';
  alAcabar(() => pool.query('DELETE FROM mesa_usuarios WHERE usuario = ?', [usuario]));

  const { usuarioId } = await usuarios.crearUsuario(pool, { usuario, clave });
  assert.ok(Number.isInteger(usuarioId) && usuarioId > 0);

  // En la base solo el hash: ni la contraseña ni nada que la contenga.
  const [filas] = await pool.query('SELECT hash, creado, ultimo_acceso FROM mesa_usuarios WHERE id = ?', [usuarioId]);
  assert.match(filas[0].hash, /^scrypt\$ln=15,r=8,p=1\$/);
  assert.ok(!filas[0].hash.includes(clave));
  assert.ok(filas[0].creado instanceof Date);
  assert.equal(filas[0].ultimo_acceso, null);

  assert.deepEqual(await usuarios.comprobarClave(pool, { usuario, clave }), { ok: true, usuarioId });
  const [tras] = await pool.query('SELECT ultimo_acceso FROM mesa_usuarios WHERE id = ?', [usuarioId]);
  assert.ok(tras[0].ultimo_acceso instanceof Date, 'el acceso bueno se apunta');
  assert.deepEqual(await usuarios.comprobarClave(pool, { usuario, clave: 'mala' }), { ok: false, usuarioId: null });
  assert.deepEqual(await usuarios.comprobarClave(pool, { usuario: `nadie-${sufijo()}`, clave }), { ok: false, usuarioId: null });
  assert.deepEqual(await usuarios.comprobarClave(pool, { usuario: "x' OR '1'='1", clave }), { ok: false, usuarioId: null });
  assert.deepEqual(await usuarios.comprobarClave(pool, {}), { ok: false, usuarioId: null });

  await assert.rejects(usuarios.crearUsuario(pool, { usuario, clave: 'otra-clave-larga' }), e => e.code === 'EXISTE');
  assert.equal(await usuarios.existeUsuario(pool, usuario), true);

  // Cambiar la contraseña cierra sus sesiones.
  const { crearSesion, leerSesion } = require('../src/bd/sesiones');
  const s = await crearSesion(pool, { usuarioId, ip: '192.0.2.1', agente: 'prueba' });
  await usuarios.cambiarClave(pool, { usuario, clave: 'la-nueva-clave-larga' });
  assert.equal(await leerSesion(pool, s.token), null);
  assert.equal((await usuarios.comprobarClave(pool, { usuario, clave })).ok, false);
  assert.equal((await usuarios.comprobarClave(pool, { usuario, clave: 'la-nueva-clave-larga' })).ok, true);
  await assert.rejects(usuarios.cambiarClave(pool, { usuario: `nadie-${sufijo()}`, clave: 'la-nueva-clave-larga' }), e => e.code === 'NO_EXISTE');
});
