'use strict';
// Freno del login contra ráfagas y contra X-Forwarded-For falsificado
// (ARQUITECTURA-WEB W3). Cada prueba es un hallazgo de la revisión del
// 30-sep-2026 que las pruebas anteriores no veían:
// - el freno se miraba antes del scrypt y el fallo se apuntaba después, así
//   que N peticiones a la vez pasaban todas;
// - la IP salía del PRIMER valor de X-Forwarded-For, que escribe el cliente;
// - con 20 fallos desde IPs inventadas, cualquiera dejaba a Eduardo fuera.

const test = require('node:test');
const assert = require('node:assert/strict');
const { almacenMemoria } = require('../src/web/almacen');
const { arrancarWeb, pedir, entrar } = require('./web-ayuda');

// Cuenta las comprobaciones de clave (los scrypt) que llegan a hacerse.
function contarComprobaciones(almacen) {
  const original = almacen.comprobarClave;
  const cuenta = { n: 0 };
  almacen.comprobarClave = async (d) => { cuenta.n++; return original(d); };
  return cuenta;
}

const loginMalo = (base, xff, usuario = 'eduardo') => pedir(base, '/api/login', {
  metodo: 'POST', cuerpo: { usuario, clave: 'mala-mala' }, cabeceras: { 'x-forwarded-for': xff },
});
const porEstado = rs => rs.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});

test('ráfaga desde una IP: 30 logins malos a la vez → como mucho 5 comprobaciones de clave, el resto 429', async (t) => {
  const almacen = almacenMemoria();
  const w = await arrancarWeb({ almacen });
  t.after(w.cerrar);
  const cuenta = contarComprobaciones(almacen);
  const rs = await Promise.all(Array.from({ length: 30 }, () => loginMalo(w.base, '203.0.113.50')));
  const e = porEstado(rs);
  assert.ok(cuenta.n <= 5, `comprobaciones de clave: ${cuenta.n}`);
  assert.equal((e[401] || 0), cuenta.n);
  assert.equal((e[429] || 0), 30 - cuenta.n);
  assert.ok(almacen._intentos.filter(i => !i.ok).length <= 5, 'no se apuntan más fallos que el tope');
  // Y en frío, el siguiente sigue frenado aunque la clave sea buena... si ya van 5.
  while (almacen._intentos.filter(i => !i.ok).length < 5) await loginMalo(w.base, '203.0.113.50');
  const frenada = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: 'clave-larga-de-prueba' }, cabeceras: { 'x-forwarded-for': '203.0.113.50' } });
  assert.equal(frenada.status, 429);
});

test('ráfaga desde 300 IPs distintas: como mucho 20 comprobaciones para el usuario (el tope por hora)', async (t) => {
  const almacen = almacenMemoria();
  const w = await arrancarWeb({ almacen });
  t.after(w.cerrar);
  const cuenta = contarComprobaciones(almacen);
  const rs = await Promise.all(Array.from({ length: 300 }, (_, i) => loginMalo(w.base, `198.18.${Math.floor(i / 250)}.${(i % 250) + 1}`)));
  const e = porEstado(rs);
  assert.ok(cuenta.n <= 20, `comprobaciones de clave: ${cuenta.n}`);
  assert.equal(e[401] || 0, cuenta.n);
  assert.equal(e[429] || 0, 300 - cuenta.n);
});

test('X-Forwarded-For falsificado: cambiar lo de delante no reinicia el freno (cuenta la IP que añade el proxy)', async (t) => {
  const almacen = almacenMemoria();
  const w = await arrancarWeb({ almacen });
  t.after(w.cerrar);
  const estados = [];
  for (let i = 0; i < 12; i++) estados.push((await loginMalo(w.base, `10.0.0.${i}, 203.0.113.9`)).status);
  assert.deepEqual(estados, [401, 401, 401, 401, 401, 429, 429, 429, 429, 429, 429, 429]);
  assert.deepEqual([...new Set(almacen._intentos.map(i => i.ip))], ['203.0.113.9'], 'lo que se guarda es la IP de verdad');
});

test('el freno por usuario no deja a Eduardo fuera desde una IP desde la que ya entró', async (t) => {
  let ahora = Date.UTC(2026, 8, 30, 10);
  const almacen = almacenMemoria({ ahora: () => ahora });
  const w = await arrancarWeb({ almacen });
  t.after(w.cerrar);
  // Eduardo entra desde su casa.
  await entrar(w.base, 'eduardo', 'clave-larga-de-prueba', { 'x-forwarded-for': '85.1.1.1' });
  ahora += 3600_000;
  // Alguien que sabe el nombre falla 20 veces desde IPs cualesquiera.
  for (let i = 0; i < 20; i++) {
    assert.equal((await loginMalo(w.base, `7.7.${i}.1`)).status, 401, `fallo ${i}`);
    ahora += 1000;
  }
  // Desde una IP nueva, el freno por usuario manda (sigue siendo la barrera
  // contra la fuerza bruta repartida).
  const nueva = await pedir(w.base, '/api/login', { metodo: 'POST', cuerpo: { usuario: 'eduardo', clave: 'clave-larga-de-prueba' }, cabeceras: { 'x-forwarded-for': '7.7.200.1' } });
  assert.equal(nueva.status, 429);
  // Desde su casa entra, con la clave buena.
  await entrar(w.base, 'eduardo', 'clave-larga-de-prueba', { 'x-forwarded-for': '85.1.1.1' });
  // Y desde su casa sigue valiendo el freno por IP (5 en 15 min).
  for (let i = 0; i < 5; i++) assert.equal((await loginMalo(w.base, '85.1.1.1')).status, 401);
  assert.equal((await loginMalo(w.base, '85.1.1.1')).status, 429);
});

test('un intento que entra queda apuntado como bueno; uno frenado no se apunta', async (t) => {
  const almacen = almacenMemoria();
  const w = await arrancarWeb({ almacen });
  t.after(w.cerrar);
  await entrar(w.base, 'eduardo', 'clave-larga-de-prueba', { 'x-forwarded-for': '192.0.2.9' });
  assert.deepEqual(almacen._intentos.map(i => [i.ip, i.usuario, i.ok]), [['192.0.2.9', 'eduardo', true]]);
  for (let i = 0; i < 6; i++) await loginMalo(w.base, '192.0.2.10');
  assert.equal(almacen._intentos.filter(i => i.ip === '192.0.2.10').length, 5, 'el sexto (429) no suma');
});
