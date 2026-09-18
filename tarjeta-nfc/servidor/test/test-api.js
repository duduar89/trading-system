// Prueba de extremo a extremo: levanta el servidor de verdad contra una base
// temporal y recorre el ciclo completo -> alta, taps, antipassback, canje.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as DB from '../db.js';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'tarjeta-nfc-'));
const rutaDb = join(dir, 'prueba.db');
const PUERTO = 8731;
const BASE = `http://127.0.0.1:${PUERTO}`;

let proceso, sesion;

const api = async (metodo, ruta, cuerpo, token = sesion) => {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { estado: res.status, cuerpo: await res.json() };
};

before(async () => {
  // Base preparada a mano: un empleado encargado con PIN conocido.
  const db = DB.abrir(rutaDb);
  const { salt, hash } = DB.hashPin('4271');
  db.prepare('INSERT INTO staff (nombre, pin_hash, salt, rol) VALUES (?, ?, ?, ?)')
    .run('Test', hash, salt, 'encargado');
  db.prepare('INSERT INTO recompensas (nombre, coste_puntos) VALUES (?, ?)').run('Cafe gratis', 5);
  db.close();

  // Config sin consumo minimo, para no tener que pasar importes en cada tap.
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    modo: 'sellos', sellos: { objetivo: 10, importe_minimo_cents: 0 },
    antipassback_minutos: 90, max_acumulaciones_dia: 2, puntos_bienvenida: 0,
  }));

  proceso = spawn(process.execPath,
    [join(RAIZ, 'servidor', 'servidor.js'), '--puerto', String(PUERTO), '--db', rutaDb, '--config', join(dir, 'config.json')],
    { cwd: dir, stdio: 'ignore', env: { ...process.env } });

  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/api/config`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('el servidor no arranco');
});

after(() => { proceso?.kill(); rmSync(dir, { recursive: true, force: true }); });

test('sin sesion no se puede dar de alta una tarjeta', async () => {
  const r = await api('POST', '/api/tarjetas', { uid: '04:11:22:33', nombre: 'X' }, null);
  assert.equal(r.estado, 401);
});

test('un PIN incorrecto no abre sesion', async () => {
  const r = await api('POST', '/api/sesion', { pin: '0000' }, null);
  assert.equal(r.estado, 401);
});

test('con el PIN correcto se abre sesion', async () => {
  const r = await api('POST', '/api/sesion', { pin: '4271' }, null);
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.staff.rol, 'encargado');
  sesion = r.cuerpo.token;
});

let clienteId, tokenTarjeta, tarjetaId;

test('alta de tarjeta: devuelve la URL que hay que grabar en el chip', async () => {
  const r = await api('POST', '/api/tarjetas', {
    uid: '04:A1:B2:C3:D4:E5:F6', nombre: 'Ana Ruiz', telefono: '600111222',
    consentimiento_marketing: true });
  assert.equal(r.estado, 201);
  assert.match(r.cuerpo.url_ndef, /\/t\/[\w-]+$/);
  assert.equal(r.cuerpo.saldo, 0);
  ({ cliente_id: clienteId, token: tokenTarjeta, tarjeta_id: tarjetaId } = r.cuerpo);
});

test('la misma tarjeta fisica no se puede dar de alta dos veces', async () => {
  const r = await api('POST', '/api/tarjetas', { uid: '04:A1:B2:C3:D4:E5:F6', nombre: 'Otro' });
  assert.equal(r.estado, 409);
});

test('el UID se guarda pseudonimizado, nunca en claro', async () => {
  const db = DB.abrir(rutaDb);
  const filas = db.prepare('SELECT uid_hash FROM tarjetas').all();
  db.close();
  assert.ok(filas.length > 0);
  for (const f of filas) {
    assert.equal(f.uid_hash.length, 64);
    assert.ok(!f.uid_hash.includes('A1B2C3'));
  }
});

test('primer tap: suma un sello', async () => {
  const r = await api('POST', '/api/tap', { uid: '04:A1:B2:C3:D4:E5:F6', idem: 'tap-1' });
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.sumados, 1);
  assert.equal(r.cuerpo.sellos, 1);
  assert.equal(r.cuerpo.nombre, 'Ana');
});

test('reintentar el mismo tap (red que se cae) no duplica puntos', async () => {
  const r = await api('POST', '/api/tap', { uid: '04:A1:B2:C3:D4:E5:F6', idem: 'tap-1' });
  assert.equal(r.cuerpo.repetido, true);
  assert.equal(r.cuerpo.saldo, 1);
});

test('tap inmediato con otra clave: lo para el antipassback', async () => {
  const r = await api('POST', '/api/tap', { uid: '04:A1:B2:C3:D4:E5:F6', idem: 'tap-2' });
  assert.equal(r.estado, 409);
  assert.equal(r.cuerpo.motivo, 'antipassback');
});

test('un encargado puede forzarlo cuando hace falta', async () => {
  const r = await api('POST', '/api/tap', { uid: '04:A1:B2:C3:D4:E5:F6', idem: 'tap-3', forzado: true });
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.saldo, 2);
});

test('el tope diario corta la tercera visita del dia, aunque se fuerce', async () => {
  const r = await api('POST', '/api/tap', { uid: '04:A1:B2:C3:D4:E5:F6', idem: 'tap-4', forzado: true });
  assert.equal(r.estado, 409);
  assert.equal(r.cuerpo.motivo, 'tope_diario');
});

test('una tarjeta desconocida avisa de que hay que darla de alta', async () => {
  const r = await api('POST', '/api/tap', { uid: '04:99:99:99', idem: 'tap-5' });
  assert.equal(r.estado, 404);
  assert.equal(r.cuerpo.alta_necesaria, true);
});

test('la pagina publica de la tarjeta no pide contrasena y no filtra datos', async () => {
  const res = await fetch(`${BASE}/api/tarjeta/${tokenTarjeta}`);
  const cuerpo = await res.json();
  assert.equal(res.status, 200);
  assert.equal(cuerpo.nombre, 'Ana');            // solo el nombre de pila
  assert.equal(cuerpo.saldo, 2);
  assert.equal(cuerpo.telefono, undefined);      // el telefono no sale
  assert.equal(cuerpo.email, undefined);
});

test('un token inventado no devuelve nada', async () => {
  const res = await fetch(`${BASE}/api/tarjeta/noexiste`);
  assert.equal(res.status, 404);
});

test('canjear sin saldo suficiente dice cuantos puntos faltan', async () => {
  const r = await api('POST', '/api/canjear', { cliente_id: clienteId, recompensa_id: 1, idem: 'c-1' });
  assert.equal(r.estado, 409);
  assert.equal(r.cuerpo.faltan, 3);
});

test('con saldo, el canje resta los puntos', async () => {
  const db = DB.abrir(rutaDb);
  DB.anotar(db, { cliente_id: clienteId, tipo: 'ajuste', puntos: 5, concepto: 'carga de prueba' });
  db.close();
  const r = await api('POST', '/api/canjear', { cliente_id: clienteId, recompensa_id: 1, idem: 'c-2' });
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.gastados, 5);
  assert.equal(r.cuerpo.saldo, 2);
});

test('repetir el canje con la misma clave no cobra dos veces', async () => {
  const r = await api('POST', '/api/canjear', { cliente_id: clienteId, recompensa_id: 1, idem: 'c-2' });
  assert.equal(r.cuerpo.repetido, true);
  assert.equal(r.cuerpo.saldo, 2);
});

test('tarjeta perdida: se sustituye y el saldo viaja con el cliente', async () => {
  const r = await api('POST', '/api/tarjetas/sustituir',
                      { tarjeta_id: tarjetaId, uid_nuevo: '04:FF:EE:DD:CC:BB:AA' });
  assert.equal(r.estado, 200);
  const nueva = await fetch(`${BASE}/api/tarjeta/${r.cuerpo.token}`).then((x) => x.json());
  assert.equal(nueva.saldo, 2);
  const vieja = await api('POST', '/api/tap', { uid: '04:A1:B2:C3:D4:E5:F6', idem: 'tap-6' });
  assert.equal(vieja.estado, 403);              // la vieja ya no vale
});

test('el saldo del libro mayor cuadra con la suma de movimientos', async () => {
  const db = DB.abrir(rutaDb);
  const suma = db.prepare('SELECT SUM(puntos) s FROM movimientos WHERE cliente_id = ?').get(clienteId).s;
  db.close();
  assert.equal(Number(suma), 2);
});

test('las metricas responden al encargado', async () => {
  const r = await api('GET', '/api/metricas');
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.tarjetas_activas, 1);
  assert.ok(r.cuerpo.taps_30d >= 2);
});

test('no se puede salir de web/ pidiendo ../', async () => {
  const res = await fetch(`${BASE}/../config.json`);
  assert.ok(res.status === 404 || res.status === 403, `estado inesperado ${res.status}`);
});
