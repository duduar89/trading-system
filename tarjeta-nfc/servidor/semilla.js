// Deja la base lista para probar: dos empleados, tres recompensas y, si le pasas
// --demo, un puñado de clientes con historial.
//
//   node servidor/semilla.js --db tarjetas.db --pin-encargado 4271 --demo

import { randomInt } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as DB from './db.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const db = DB.abrir(arg('db', join(RAIZ, 'tarjetas.db')));

function altaEmpleado(nombre, rol, pin) {
  const { salt, hash } = DB.hashPin(pin);
  db.prepare('INSERT INTO staff (nombre, pin_hash, salt, rol) VALUES (?, ?, ?, ?)')
    .run(nombre, hash, salt, rol);
  console.log(`  ${rol.padEnd(10)} ${nombre.padEnd(12)} PIN ${pin}`);
}

const yaHay = db.prepare('SELECT COUNT(*) n FROM staff').get().n;
if (yaHay === 0) {
  const pinEnc = arg('pin-encargado', String(randomInt(1000, 9999)));
  const pinMos = arg('pin-mostrador', String(randomInt(1000, 9999)));
  console.log('Empleados creados (apunta estos PIN, no se vuelven a mostrar):');
  altaEmpleado('Encargado', 'encargado', pinEnc);
  altaEmpleado('Mostrador', 'mostrador', pinMos);
} else {
  console.log(`Ya había ${yaHay} empleados, no toco nada.`);
}

if (db.prepare('SELECT COUNT(*) n FROM recompensas').get().n === 0) {
  const r = db.prepare('INSERT INTO recompensas (nombre, coste_puntos) VALUES (?, ?)');
  r.run('Café o refresco gratis', 5);
  r.run('Postre de la casa', 8);
  r.run('Plato principal gratis', 10);
  console.log('Recompensas creadas: 3');
}

if (process.argv.includes('--demo')) {
  const nombres = ['Ana Ruiz', 'Marc Soler', 'Lucia Prieto', 'Iker Mendia', 'Sofia Camps'];
  const ahora = Date.now();
  nombres.forEach((nombre, i) => {
    const alta = new Date(ahora - (60 - i * 7) * 86_400_000).toISOString();
    const cid = Number(db.prepare(
      'INSERT INTO clientes (nombre, alta_ts, consentimiento_marketing) VALUES (?, ?, 1)')
      .run(nombre, alta).lastInsertRowid);
    const tid = Number(db.prepare(
      'INSERT INTO tarjetas (uid_hash, token, cliente_id, alta_ts) VALUES (?, ?, ?, ?)')
      .run(DB.hashUid(db, `04DEMO${i}0`), DB.nuevoToken(), cid, alta).lastInsertRowid);
    for (let v = 0; v < randomInt(1, 12); v++) {
      DB.anotar(db, { cliente_id: cid, tarjeta_id: tid, tipo: 'acumular', puntos: 1,
                      importe_cents: randomInt(800, 4200), staff_id: 1,
                      ts: new Date(ahora - randomInt(1, 55) * 86_400_000).toISOString() });
    }
  });
  console.log(`Clientes de demostración: ${nombres.length}`);
}
console.log('Listo.');
