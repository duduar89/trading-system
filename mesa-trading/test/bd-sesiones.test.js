'use strict';
// Sesiones, caducidad y freno contra MariaDB (ARQUITECTURA-WEB W3, W4 y W5-D).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const usuarios = require('../src/bd/usuarios');
const sesiones = require('../src/bd/sesiones');
const { motivoSalto, prepararBD, sufijo, ipAleatoria } = require('./bd-ayuda');

const MIN = 60_000;
const DIA = 24 * 60 * MIN;
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

async function conUsuario(t) {
  const { pool, alAcabar } = await prepararBD(t);
  const usuario = `s-${sufijo()}`;
  const { usuarioId } = await usuarios.crearUsuario(pool, { usuario, clave: 'una-clave-larga-de-prueba' });
  alAcabar(async () => {
    await pool.query('DELETE FROM mesa_sesiones WHERE usuario_id = ?', [usuarioId]);
    await pool.query('DELETE FROM mesa_usuarios WHERE id = ?', [usuarioId]);
  });
  return { pool, usuario, usuarioId };
}

test('leerSesion rechaza tokens mal formados sin preguntar a la base', async () => {
  const pool = { query: async () => { throw new Error('no debería consultar'); } };
  for (const malo of [undefined, null, '', 'corto', 'x'.repeat(44), 'a'.repeat(42) + '=', 42]) {
    assert.equal(await sesiones.leerSesion(pool, malo), null);
  }
  await sesiones.cerrarSesion(pool, 'corto');
});

test('sesión: token de 32 bytes, en la base solo su SHA-256, 30 días', { skip: motivoSalto }, async (t) => {
  const { pool, usuario, usuarioId } = await conUsuario(t);
  const ahora = Date.UTC(2026, 8, 30, 10, 0, 0);
  const s = await sesiones.crearSesion(pool, { usuarioId, ip: '203.0.113.7', agente: 'x'.repeat(400), ahora });
  assert.match(s.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(s.token, 'base64url').length, 32);
  assert.equal(s.expira, ahora + 30 * DIA);

  const [filas] = await pool.query('SELECT id, usuario_id, creada, expira, ultima, ip, agente FROM mesa_sesiones WHERE usuario_id = ?', [usuarioId]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].id, sha(s.token));
  assert.equal(filas[0].expira.getTime(), ahora + 30 * DIA, 'en UTC, sin corrimiento de zona');
  assert.equal(filas[0].agente.length, 255);
  const [crudo] = await pool.query('SELECT COUNT(*) AS n FROM mesa_sesiones WHERE id = ? OR ip = ?', [s.token, s.token]);
  assert.equal(crudo[0].n, 0, 'el token no está en la base');

  assert.deepEqual(await sesiones.leerSesion(pool, s.token, { ahora: ahora + DIA }), { usuarioId, usuario, expira: ahora + 30 * DIA });
  // Otro token cualquiera, bien formado: nada.
  assert.equal(await sesiones.leerSesion(pool, crypto.randomBytes(32).toString('base64url'), { ahora }), null);
});

test('sesión: «ultima» se renueva como mucho una vez por minuto', { skip: motivoSalto }, async (t) => {
  const { pool, usuarioId } = await conUsuario(t);
  const ahora = Date.UTC(2026, 8, 30, 10, 0, 0);
  const s = await sesiones.crearSesion(pool, { usuarioId, ahora });
  const ultima = async () => (await pool.query('SELECT ultima FROM mesa_sesiones WHERE id = ?', [sha(s.token)]))[0][0].ultima.getTime();
  await sesiones.leerSesion(pool, s.token, { ahora: ahora + 30_000 });
  assert.equal(await ultima(), ahora, 'a los 30 s no se toca');
  await sesiones.leerSesion(pool, s.token, { ahora: ahora + 59_000 });
  assert.equal(await ultima(), ahora);
  await sesiones.leerSesion(pool, s.token, { ahora: ahora + 61_000 });
  assert.equal(await ultima(), ahora + 61_000, 'pasado el minuto, sí');
  await sesiones.leerSesion(pool, s.token, { ahora: ahora + 90_000 });
  assert.equal(await ultima(), ahora + 61_000);
  // La caducidad NO se alarga con el uso.
  const [f] = await pool.query('SELECT expira FROM mesa_sesiones WHERE id = ?', [sha(s.token)]);
  assert.equal(f[0].expira.getTime(), ahora + 30 * DIA);
});

test('sesión: caduca a los 30 días y se borra; cerrarla la quita', { skip: motivoSalto }, async (t) => {
  const { pool, usuarioId } = await conUsuario(t);
  const ahora = Date.UTC(2026, 8, 30, 10, 0, 0);
  const a = await sesiones.crearSesion(pool, { usuarioId, ahora });
  const b = await sesiones.crearSesion(pool, { usuarioId, ahora });
  assert.notEqual(a.token, b.token);
  assert.ok(await sesiones.leerSesion(pool, a.token, { ahora: ahora + 30 * DIA - 1000 }), 'un segundo antes, vale');
  assert.equal(await sesiones.leerSesion(pool, a.token, { ahora: ahora + 30 * DIA }), null, 'al cumplir 30 días, no');
  const [quedan] = await pool.query('SELECT COUNT(*) AS n FROM mesa_sesiones WHERE id = ?', [sha(a.token)]);
  assert.equal(quedan[0].n, 0, 'la caducada se borra al leerla');

  assert.ok(await sesiones.leerSesion(pool, b.token, { ahora }));
  await sesiones.cerrarSesion(pool, b.token);
  assert.equal(await sesiones.leerSesion(pool, b.token, { ahora }), null);

  // Una sesión de un usuario borrado no vale.
  const c = await sesiones.crearSesion(pool, { usuarioId, ahora });
  await pool.query('UPDATE mesa_sesiones SET usuario_id = ? WHERE id = ?', [2_000_000_000, sha(c.token)]);
  assert.equal(await sesiones.leerSesion(pool, c.token, { ahora }), null);
  await pool.query('DELETE FROM mesa_sesiones WHERE id = ?', [sha(c.token)]);
});

test('freno: 5 fallos por IP en 15 min', { skip: motivoSalto }, async (t) => {
  const { pool, alAcabar } = await prepararBD(t);
  const ip = ipAleatoria();
  const usuario = `f-${sufijo()}`;
  alAcabar(() => pool.query('DELETE FROM mesa_intentos WHERE ip = ? OR usuario = ?', [ip, usuario]));
  const t0 = Date.UTC(2026, 8, 30, 10, 0, 0);
  for (let i = 0; i < 4; i++) await sesiones.anotarIntento(pool, { ip, usuario, ok: false, ahora: t0 + i * 1000 });
  await sesiones.anotarIntento(pool, { ip, usuario, ok: true, ahora: t0 + 4000 });
  assert.deepEqual(await sesiones.frenado(pool, { ip, usuario, ahora: t0 + 10_000 }), { frenado: false, esperaSeg: 0 }, '4 fallos y un acierto: no');
  await sesiones.anotarIntento(pool, { ip, usuario, ok: false, ahora: t0 + 5000 });
  // El más viejo (t0) sale de la ventana a t0 + 15 min.
  assert.deepEqual(await sesiones.frenado(pool, { ip, usuario, ahora: t0 + 10_000 }), { frenado: true, esperaSeg: 890 });
  assert.deepEqual(await sesiones.frenado(pool, { ip, usuario: `otro-${sufijo()}`, ahora: t0 + 10_000 }), { frenado: true, esperaSeg: 890 }, 'por IP, sea quien sea el usuario');
  assert.equal((await sesiones.frenado(pool, { ip: ipAleatoria(), usuario, ahora: t0 + 10_000 })).frenado, false, 'otra IP, mismo usuario (5 < 20): no');
  assert.equal((await sesiones.frenado(pool, { ip, usuario, ahora: t0 + 15 * MIN + 1 })).frenado, false, 'fuera de la ventana');
});

test('freno: 20 fallos por usuario en 1 h, desde IPs distintas', { skip: motivoSalto }, async (t) => {
  const { pool, alAcabar } = await prepararBD(t);
  const usuario = `g-${sufijo()}`;
  alAcabar(() => pool.query('DELETE FROM mesa_intentos WHERE usuario = ?', [usuario]));
  const t0 = Date.UTC(2026, 8, 30, 10, 0, 0);
  for (let i = 0; i < 19; i++) await sesiones.anotarIntento(pool, { ip: ipAleatoria(), usuario, ok: false, ahora: t0 + i * 60_000 });
  const nueva = ipAleatoria();
  assert.equal((await sesiones.frenado(pool, { ip: nueva, usuario, ahora: t0 + 20 * MIN })).frenado, false, '19: no');
  await sesiones.anotarIntento(pool, { ip: ipAleatoria(), usuario, ok: false, ahora: t0 + 19 * MIN });
  assert.deepEqual(await sesiones.frenado(pool, { ip: nueva, usuario, ahora: t0 + 20 * MIN }), { frenado: true, esperaSeg: 40 * 60 });
  assert.equal((await sesiones.frenado(pool, { ip: nueva, usuario, ahora: t0 + 60 * MIN + 1 })).frenado, false);
  // Sin usuario (login vacío) solo cuenta la IP.
  assert.equal((await sesiones.frenado(pool, { ip: nueva, usuario: '', ahora: t0 + 20 * MIN })).frenado, false);
});

// Hallazgo de la revisión del 30-sep-2026: con frenado + anotarIntento
// (mirar, scrypt, apuntar), una ráfaga pasaba entera. reservarIntento apunta
// el fallo antes de mirar la cuenta: con 30 a la vez sobre varias conexiones
// del pool, como mucho pasan 5.
test('reservarIntento: 30 a la vez desde una IP → como mucho 5 pasan; los frenados no dejan fila', { skip: motivoSalto }, async (t) => {
  const { pool, alAcabar } = await prepararBD(t);
  const ip = ipAleatoria();
  const usuario = `r-${sufijo()}`;
  alAcabar(() => pool.query('DELETE FROM mesa_intentos WHERE ip = ? OR usuario = ?', [ip, usuario]));
  const ahora = Date.now();
  const rs = await Promise.all(Array.from({ length: 30 }, () => sesiones.reservarIntento(pool, { ip, usuario, ahora })));
  const pasan = rs.filter(r => !r.frenado);
  assert.ok(pasan.length <= 5, `pasan ${pasan.length}`);
  assert.ok(pasan.every(r => Number.isInteger(r.id) && r.id > 0));
  assert.ok(rs.filter(r => r.frenado).every(r => r.id === null && r.esperaSeg > 0));
  const [filas] = await pool.query('SELECT ok FROM mesa_intentos WHERE ip = ?', [ip]);
  assert.equal(filas.length, pasan.length, 'solo quedan los que pasaron, como fallos');
  assert.ok(filas.every(f => f.ok === 0));
  // Uno que entra se corrige a bueno.
  if (pasan.length) {
    await sesiones.resolverIntento(pool, { id: pasan[0].id, ok: true });
    const [[f]] = await pool.query('SELECT ok FROM mesa_intentos WHERE id = ?', [pasan[0].id]);
    assert.equal(f.ok, 1);
  }
});

test('reservarIntento: 60 a la vez desde IPs distintas → como mucho 20 para el usuario; desde su IP de confianza, entra', { skip: motivoSalto }, async (t) => {
  const { pool, alAcabar } = await prepararBD(t);
  const usuario = `c-${sufijo()}`;
  alAcabar(() => pool.query('DELETE FROM mesa_intentos WHERE usuario = ?', [usuario]));
  const ahora = Date.now();
  const casa = ipAleatoria();
  await sesiones.anotarIntento(pool, { ip: casa, usuario, ok: true, ahora: ahora - 2 * 24 * 60 * MIN });
  const rs = await Promise.all(Array.from({ length: 60 }, () => sesiones.reservarIntento(pool, { ip: ipAleatoria(), usuario, ahora })));
  const pasan = rs.filter(r => !r.frenado).length;
  assert.ok(pasan <= 20, `pasan ${pasan}`);
  // Completa hasta 20 fallos si la carrera fue conservadora.
  for (let i = pasan; i < 20; i++) await sesiones.anotarIntento(pool, { ip: ipAleatoria(), usuario, ok: false, ahora });
  assert.equal((await sesiones.reservarIntento(pool, { ip: ipAleatoria(), usuario, ahora: ahora + 1000 })).frenado, true, 'IP nueva: frenado por usuario');
  const r = await sesiones.reservarIntento(pool, { ip: casa, usuario, ahora: ahora + 1000 });
  assert.equal(r.frenado, false, 'desde la IP desde la que ya entró no le deja fuera');
});
