'use strict';
// La web contra MariaDB de verdad (ARQUITECTURA-WEB W4 y W5-W): el mismo
// login, sesión, freno y logout que web-servidor.test.js, pero con el almacén
// de src/bd/ (almacenBD). Se salta, diciendo por qué, si faltan TEST_DB_*,
// o los módulos de src/bd/. Las tablas las crea (idempotente) y lo que deja
// en la base lo borra al acabar.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { arrancarWeb, pedir, entrar } = require('./web-ayuda');
const { prepararBD } = require('./bd-ayuda');

const E = process.env;
const entorno = {
  DB_HOST: E.TEST_DB_HOST, DB_PUERTO: E.TEST_DB_PUERTO, DB_USUARIO: E.TEST_DB_USUARIO, DB_CLAVE: E.TEST_DB_CLAVE, DB_NOMBRE: E.TEST_DB_NOMBRE,
};
const hayBD = Boolean(E.TEST_DB_HOST && E.TEST_DB_USUARIO && E.TEST_DB_NOMBRE);
const hayModulos = ['conexion', 'usuarios', 'sesiones'].every(m => fs.existsSync(path.join(__dirname, '..', 'src', 'bd', `${m}.js`)));
const motivo = !hayBD ? 'sin TEST_DB_* no hay MariaDB de prueba' : !hayModulos ? 'faltan src/bd/{conexion,usuarios,sesiones}.js' : false;

test('login, sesión, freno y logout con la base de datos de verdad', { skip: motivo }, async (t) => {
  const { almacenBD } = require('../src/web/almacen');
  const usuarios = require('../src/bd/usuarios');
  // prepararBD crea las tablas (idempotente) y cierra el pool al acabar,
  // después de las limpiezas: la prueba no deja usuarios, sesiones ni intentos.
  const { pool, alAcabar } = await prepararBD(t);
  const usuario = `web-${crypto.randomBytes(4).toString('hex')}`;
  const clave = 'una-clave-larga-de-prueba';
  const ips = [];
  alAcabar(async () => {
    const [u] = await pool.query('SELECT id FROM mesa_usuarios WHERE usuario = ?', [usuario]);
    for (const f of u) await pool.query('DELETE FROM mesa_sesiones WHERE usuario_id = ?', [f.id]);
    await pool.query('DELETE FROM mesa_intentos WHERE usuario = ?', [usuario]);
    if (ips.length) await pool.query('DELETE FROM mesa_intentos WHERE ip IN (?)', [ips]);
    await pool.query('DELETE FROM mesa_usuarios WHERE usuario = ?', [usuario]);
  });
  await usuarios.crearUsuario(pool, { usuario, clave });
  const almacen = almacenBD(entorno);
  const w = await arrancarWeb({ almacen, usuarios: [] });
  t.after(w.cerrar);
  const ip = `198.18.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 255)}`;
  ips.push(ip);
  const cookie = await entrar(w.base, usuario, clave, { 'x-forwarded-for': ip });
  const token = cookie.split('=')[1];
  // En la base solo el SHA-256 del token.
  const [filas] = await pool.query('SELECT id FROM mesa_sesiones WHERE id = ?', [crypto.createHash('sha256').update(token).digest('hex')]);
  assert.equal(filas.length, 1);
  const [crudo] = await pool.query('SELECT id FROM mesa_sesiones WHERE id = ?', [token]);
  assert.equal(crudo.length, 0);
  assert.equal((await pedir(w.base, '/api/estado', { cookie })).status, 200);
  const fuera = await pedir(w.base, '/api/logout', { metodo: 'POST', cookie, cuerpo: {} });
  assert.equal(fuera.status, 200);
  assert.equal((await pedir(w.base, '/api/estado', { cookie })).status, 401);
  // Freno por IP: 5 fallos → 429 aunque la clave sea buena.
  const otraIp = `198.19.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 255)}`;
  ips.push(otraIp);
  for (let i = 0; i < 5; i++) {
    const r = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario, clave: 'mala' }, cabeceras: { 'x-forwarded-for': otraIp } });
    assert.equal(r.status, 401);
  }
  const frenada = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario, clave }, cabeceras: { 'x-forwarded-for': otraIp } });
  assert.equal(frenada.status, 429);
  assert.ok(frenada.json.esperaSeg > 0 && frenada.json.esperaSeg <= 900);
});
