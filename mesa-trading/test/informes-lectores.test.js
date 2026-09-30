'use strict';
// Lectores de las vistas (src/informes/lectores.js): colas acotadas de los
// JSONL que nunca rompen, historial reducido que conserva la forma y los
// sucesos, y el filtro de noticias por activo y gravedad.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lectores = require('../src/informes/lectores');
const registros = require('../src/registros');

const HORA = 3600e3;
const carpetas = [];
process.on('exit', () => { for (const c of carpetas) { try { fs.rmSync(c, { recursive: true, force: true }); } catch (_) { /* ya no está */ } } });
function carpeta() {
  const c = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-informes-'));
  carpetas.push(c);
  return c;
}
const escribir = (ruta, filas) => fs.writeFileSync(ruta, filas.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n');
const P = o => new URLSearchParams(o);

test('leerCola: fichero que no existe, vacío, carpeta o con líneas rotas → nunca lanza', () => {
  const c = carpeta();
  assert.deepEqual(lectores.leerCola(path.join(c, 'no-existe.jsonl')), []);
  fs.writeFileSync(path.join(c, 'vacio.jsonl'), '');
  assert.deepEqual(lectores.leerCola(path.join(c, 'vacio.jsonl')), []);
  assert.deepEqual(lectores.leerCola(c), [], 'una carpeta no es un registro');
  const ruta = path.join(c, 'roto.jsonl');
  fs.writeFileSync(ruta, '{"t":1}\n{"t":2,"roto":\nno es json\n[1,2]\n{"t":3}\n{"t":4');
  assert.deepEqual(lectores.leerCola(ruta).map(x => x.t), [1, 3], 'la rota, la que no es objeto y la cortada del final fuera');
});

test('leerCola: de un fichero grande lee solo la cola y no pasa del tope de bytes', () => {
  const c = carpeta();
  const ruta = path.join(c, 'grande.jsonl');
  const filas = Array.from({ length: 30000 }, (_, i) => ({ t: i, relleno: 'x'.repeat(60) }));
  escribir(ruta, filas);
  const cola = lectores.leerCola(ruta, { lineas: 500 });
  assert.equal(cola.length, 500);
  assert.equal(cola[0].t, 29500);
  assert.equal(cola[499].t, 29999);
  // Con un tope de bytes pequeño: lo que quepa, sin la primera línea (puede venir cortada).
  const poco = lectores.leerCola(ruta, { lineas: 20000, maxBytes: 8000 });
  assert.ok(poco.length > 50 && poco.length < 120, `${poco.length} líneas en 8 KB`);
  assert.equal(poco[poco.length - 1].t, 29999);
  for (let i = 1; i < poco.length; i++) assert.equal(poco[i].t, poco[i - 1].t + 1, 'seguidas, sin huecos');
});

test('leerCola: la caché se invalida al crecer el fichero', () => {
  const c = carpeta();
  const ruta = path.join(c, 'crece.jsonl');
  escribir(ruta, [{ t: 1 }]);
  assert.equal(lectores.leerCola(ruta).length, 1);
  fs.appendFileSync(ruta, `${JSON.stringify({ t: 2 })}\n`);
  assert.deepEqual(lectores.leerCola(ruta).map(x => x.t), [1, 2]);
});

test('LTTB: conserva el primero, el último, el máximo y el mínimo', () => {
  const puntos = Array.from({ length: 5000 }, (_, i) => ({ t: i, v: Math.sin(i / 200) * 100 + (i === 3217 ? 900 : 0) - (i === 1234 ? 700 : 0) }));
  const r = lectores.reducir(puntos, 300);
  assert.ok(r.length <= 300);
  assert.equal(r[0].t, 0);
  assert.equal(r[r.length - 1].t, 4999);
  assert.ok(r.some(p => p.t === 3217), 'el pico');
  assert.ok(r.some(p => p.t === 1234), 'el valle');
  for (let i = 1; i < r.length; i++) assert.ok(r[i].t > r[i - 1].t, 'en orden y sin repetir');
  assert.equal(lectores.reducir(puntos.slice(0, 10), 300).length, 10, 'con menos puntos que el umbral, todos');
});

function historialSintetico(n, { sucesos = {} } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    t: 1_780_000_000_000 + i * HORA, motivo: sucesos[i] || 'hora', patrimonio: 100000 + Math.sin(i / 50) * 1000 + (i === 777 ? -5000 : 0),
    sombras: { btc: 100000 + i, cesta: 100000 - i, sinComite: 100000 }, modoComite: 'NORMAL', mesas: [],
  }));
}

test('historial reducido: ≤ puntos, con los extremos del patrimonio y todos los sucesos', () => {
  const c = carpeta();
  const filas = historialSintetico(6000, { sucesos: { 100: 'comite', 2500: 'asignacion', 5999: 'kill' } });
  escribir(path.join(c, 'historial.jsonl'), filas);
  const r = lectores.historial(c, P({ puntos: '400' }));
  assert.ok(r.length <= 400, `${r.length}`);
  assert.equal(r[0].t, filas[0].t);
  assert.equal(r[r.length - 1].t, filas[5999].t);
  assert.ok(r.some(l => l.t === filas[777].t), 'la caída de la hora 777');
  assert.deepEqual(r.filter(l => l.motivo !== 'hora').map(l => l.motivo), ['comite', 'asignacion', 'kill']);
  for (let i = 1; i < r.length; i++) assert.ok(r[i].t >= r[i - 1].t);
  // desde: solo el tramo pedido.
  const tramo = lectores.historial(c, P({ puntos: '400', desde: String(filas[5000].t) }));
  assert.ok(tramo.every(l => l.t >= filas[5000].t) && tramo.length <= 400 && tramo.length > 300);
  // puntos fuera de rango se acotan (mínimo 20, máximo 2000).
  assert.ok(lectores.historial(c, P({ puntos: '3' })).length <= 20);
  assert.ok(lectores.historial(c, P({ puntos: '999999' })).length <= 2000);
});

test('historial sin «puntos»: exactamente lo de registros.consultar', () => {
  const c = carpeta();
  escribir(path.join(c, 'historial.jsonl'), historialSintetico(50));
  for (const q of [{}, { limite: '10' }, { desde: String(1_780_000_000_000 + 40 * HORA) }]) {
    assert.deepEqual(lectores.historial(c, P(q)), registros.consultar(c, 'historial', P(q)), JSON.stringify(q));
  }
  assert.deepEqual(lectores.historial(carpeta(), P({ puntos: '100' })), [], 'sin fichero, lista vacía');
});

test('noticias: filtro por activo (BTC, BTC/USD, btcusd) y solo graves, con las actualizaciones fusionadas', () => {
  const c = carpeta();
  const r = registros.rutas(c).noticias;
  escribir(r, [
    { t: 10, id: 'a', titular: 'A', simbolos: ['BTC/USD'], clasificacion: null, veto: null },
    { t: 20, id: 'b', titular: 'B', simbolos: ['ETH/USD'], clasificacion: [{ simbolo: 'ETH/USD', categoria: 'hackeo', grave: true }], veto: { simbolo: 'ETH/USD', hasta: 99, simbolos: ['ETH/USD'] } },
    { t: 30, id: 'c', titular: 'C', simbolos: ['SOL/USD', 'BTC/USD'], clasificacion: null, veto: null },
    { t: 40, id: 'a', clasificacion: [{ simbolo: 'BTC/USD', categoria: 'quiebra', grave: true }], veto: null, actualiza: true },
    '{"t":50,"id":"roto"',
  ]);
  assert.deepEqual(lectores.noticias(c, P({})), registros.consultar(c, 'noticias', P({})), 'sin filtros, lo de siempre');
  for (const s of ['BTC', 'btc', 'BTC/USD', 'BTCUSD']) assert.deepEqual(lectores.noticias(c, P({ simbolo: s })).map(n => n.id), ['c', 'a'], s);
  assert.deepEqual(lectores.noticias(c, P({ graves: '1' })).map(n => n.id), ['b', 'a'], 'la de A es grave por su actualización');
  assert.deepEqual(lectores.noticias(c, P({ graves: '1', simbolo: 'ETH' })).map(n => n.id), ['b']);
  assert.deepEqual(lectores.noticias(c, P({ simbolo: 'DOGE' })), []);
  assert.deepEqual(lectores.noticias(c, P({ simbolo: 'BTC', limite: '1' })).map(n => n.id), ['c']);
  assert.deepEqual(lectores.noticias(carpeta(), P({ simbolo: 'BTC' })), [], 'sin fichero');
});

test('decisionesDe: solo los tipos pedidos, de la cola del fichero', () => {
  const c = carpeta();
  const filas = [];
  for (let i = 0; i < 3000; i++) filas.push({ t: i, tipo: i % 1000 === 7 ? 'laboratorio' : 'orden', quien: 'x', resumen: '', datos: {} });
  escribir(registros.rutas(c).decisiones, filas);
  assert.deepEqual(lectores.decisionesDe(c, ['laboratorio']).map(d => d.t), [7, 1007, 2007]);
  assert.deepEqual(lectores.decisionesDe(carpeta(), ['laboratorio']), []);
});
