'use strict';
// Enlace de alta de un solo uso (src/web/alta.js, POST /api/alta).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { arrancarWeb, pedir, entrar } = require('./web-ayuda');
const { crearAlta, altaValida, consumirAlta, rutaAlta } = require('../src/web/alta');

test('alta.json guarda solo el hash, con permisos 600; el token caduca y no vale otro', () => {
  const w = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mesa-alta-'));
  const { token, expira } = crearAlta(w, { ahora: 1000 });
  const texto = fs.readFileSync(rutaAlta(w), 'utf8');
  assert.equal(texto.includes(token), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(rutaAlta(w)).mode & 0o777, 0o600);
  assert.equal(altaValida(w, token, { ahora: 2000 }), true);
  assert.equal(altaValida(w, token, { ahora: expira }), false);
  assert.equal(altaValida(w, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), { ahora: 2000 }), false);
  // Un enlace nuevo anula el anterior.
  const otro = crearAlta(w, { ahora: 1000 });
  assert.equal(altaValida(w, token, { ahora: 2000 }), false);
  assert.equal(altaValida(w, otro.token, { ahora: 2000 }), true);
  // Se gasta una vez; devolver lo deja como estaba.
  const r = consumirAlta(w, otro.token, { ahora: 2000 });
  assert.ok(r);
  assert.equal(consumirAlta(w, otro.token, { ahora: 2000 }), null);
  r.devolver();
  assert.equal(altaValida(w, otro.token, { ahora: 2000 }), true);
});

test('POST /api/alta: crea el usuario, deja dentro y el enlace ya no vale', async () => {
  const w = await arrancarWeb({ usuarios: [] });
  try {
    const { token } = crearAlta(w.carpeta);
    const pagina = await pedir(w.base, '/alta', { crudo: true });
    assert.equal(pagina.status, 200);
    assert.match(pagina.texto, /Repite la contraseña/);
    // Contraseña corta: 400 y el enlace sigue valiendo.
    const corta = await pedir(w.base, '/api/alta', { metodo: 'POST', cuerpo: { token, usuario: 'eduardo', clave: 'corta' } });
    assert.equal(corta.status, 400);
    assert.equal(altaValida(w.carpeta, token), true);
    const ok = await pedir(w.base, '/api/alta', { metodo: 'POST', cuerpo: { token, usuario: 'eduardo', clave: 'una-clave-bien-larga' } });
    assert.equal(ok.status, 200, ok.texto);
    const cookie = [].concat(ok.headers['set-cookie'])[0].split(';')[0];
    assert.equal((await pedir(w.base, '/api/sesion', { cookie })).json.usuario, 'eduardo');
    assert.ok(await entrar(w.base, 'eduardo', 'una-clave-bien-larga'));
    const otra = await pedir(w.base, '/api/alta', { metodo: 'POST', cuerpo: { token, usuario: 'intruso', clave: 'otra-clave-bien-larga' } });
    assert.equal(otra.status, 410);
    assert.equal(fs.existsSync(rutaAlta(w.carpeta)), false);
  } finally { await w.cerrar(); }
});

test('POST /api/alta con un usuario que ya existe le cambia la contraseña y cierra sus sesiones', async () => {
  const w = await arrancarWeb();
  try {
    const vieja = await entrar(w.base);
    const { token } = crearAlta(w.carpeta);
    const r = await pedir(w.base, '/api/alta', { metodo: 'POST', cuerpo: { token, usuario: 'eduardo', clave: 'la-nueva-clave-larga' } });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await pedir(w.base, '/api/sesion', { cookie: vieja })).status, 401);
    await assert.rejects(entrar(w.base, 'eduardo', 'clave-larga-de-prueba'));
    assert.ok(await entrar(w.base, 'eduardo', 'la-nueva-clave-larga'));
  } finally { await w.cerrar(); }
});

test('POST /api/alta: sin enlace, con uno falso o desde otra web, nada', async () => {
  const w = await arrancarWeb({ usuarios: [] });
  try {
    const sin = await pedir(w.base, '/api/alta', { metodo: 'POST', cuerpo: { token: 'x'.repeat(43), usuario: 'a', clave: 'una-clave-bien-larga' } });
    assert.equal(sin.status, 410);
    const { token } = crearAlta(w.carpeta);
    const fuera = await pedir(w.base, '/api/alta', { metodo: 'POST', cuerpo: { token, usuario: 'a', clave: 'una-clave-bien-larga' }, cabeceras: { origin: 'https://malo.example' } });
    assert.equal(fuera.status, 403);
    assert.equal(altaValida(w.carpeta, token), true);
  } finally { await w.cerrar(); }
});

test('dos altas a la vez con el mismo enlace: solo una entra', async () => {
  const w = await arrancarWeb({ usuarios: [] });
  try {
    const { token } = crearAlta(w.carpeta);
    const rs = await Promise.all(['uno', 'dos', 'tres'].map((u, i) => pedir(w.base, '/api/alta', {
      metodo: 'POST', cuerpo: { token, usuario: u, clave: 'una-clave-bien-larga' }, cabeceras: { 'x-forwarded-for': `10.0.0.${i + 1}` },
    })));
    assert.equal(rs.filter(r => r.status === 200).length, 1, rs.map(r => r.status).join(','));
  } finally { await w.cerrar(); }
});
