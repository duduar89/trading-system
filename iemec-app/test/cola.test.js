'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const cola = require('../servidor/cola');

test('cola y candados', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await t.test('cada trabajo lo hace un solo trabajador aunque haya varios a la vez', async () => {
      for (let i = 0; i < 30; i++) await cola.encolar(pool, 'prueba', { i });
      const hechos = [];
      const man = { prueba: async (c) => { hechos.push(c.i); } };
      await Promise.all([1, 2, 3].map(() => cola.procesar(pool, man, { limite: 30 })));
      assert.equal(hechos.length, 30);
      assert.equal(new Set(hechos).size, 30);
    });
    await t.test('la misma clave única no se encola dos veces', async () => {
      const a = await cola.encolar(pool, 'aviso', {}, { claveUnica: 'cita-7-24h' });
      const b = await cola.encolar(pool, 'aviso', {}, { claveUnica: 'cita-7-24h' });
      assert.equal(a, b);
    });
    await t.test('un fallo se reintenta con espera creciente y al final queda fallido', async () => {
      const id = await cola.encolar(pool, 'roto', {}, { maxIntentos: 2 });
      const man = { roto: async () => { throw new Error('proveedor caído'); } };
      const ahora = new Date();
      assert.equal((await cola.procesar(pool, man, { ahora })).reintentos, 1);
      assert.equal((await cola.procesar(pool, man, { ahora: new Date(ahora.getTime() + 5 * 60000) })).fallidos, 1);
      const [[f]] = await pool.query('SELECT estado, ultimo_error FROM cola WHERE id = ?', [id]);
      assert.equal(f.estado, 'fallido');
      assert.match(f.ultimo_error, /caído/);
    });
    await t.test('aplazar: vuelve a la cola sin gastar intento, aunque se aplace muchas veces', async () => {
      const ahora = new Date('2026-10-06T10:00:00Z');
      // Con su hora: sin ella, la del reloj de verdad, que desde el 6 de octubre ya no se coge a «ahora».
      const id = await cola.encolar(pool, 'espera', {}, { maxIntentos: 1, ejecutarEn: ahora });
      let listo = false;
      const man = { espera: async () => (listo ? 'hecho' : cola.aplazar({ minutos: 1 })) };
      for (let i = 0; i < 3; i++) assert.deepEqual(await cola.procesar(pool, man, { ahora: new Date(ahora.getTime() + i * 60000) }), { hechos: 0, reintentos: 0, fallidos: 0, aplazados: 1 });
      const [[f]] = await pool.query('SELECT estado, intentos, ejecutar_en FROM cola WHERE id = ?', [id]);
      assert.deepEqual([f.estado, f.intentos], ['pendiente', 0]);
      assert.equal(f.ejecutar_en.getTime(), ahora.getTime() + 3 * 60000, 'dentro de un minuto');
      assert.equal((await cola.procesar(pool, man, { ahora: new Date(ahora.getTime() + 2 * 60000) })).aplazados, 0, 'antes de su hora no se coge');
      listo = true;
      assert.equal((await cola.procesar(pool, man, { ahora: new Date(ahora.getTime() + 3 * 60000) })).hechos, 1);
    });
    await t.test('con el tiempo de la vuelta agotado, lo que queda vuelve a la cola para la siguiente', async () => {
      for (let i = 0; i < 3; i++) await cola.encolar(pool, 'lento', { i });
      const hechos = [];
      const man = { lento: async (c) => { hechos.push(c.i); } };
      const r = await cola.procesar(pool, man, { cortarEn: Date.now() - 1 });
      assert.deepEqual([r.hechos, r.aplazados, hechos.length], [0, 3, 0]);
      const [filas] = await pool.query("SELECT estado, intentos FROM cola WHERE tipo = 'lento'");
      assert.ok(filas.every((f) => f.estado === 'pendiente' && f.intentos === 0));
      assert.equal((await cola.procesar(pool, man)).hechos, 3, 'y el siguiente cron los hace');
    });
    await t.test('candado: dos a la vez, solo uno ejecuta', async () => {
      const r = await Promise.all([1, 2].map((n) => cola.conCandado(pool, 'cron-minuto', 55000, async () => { await new Promise((ok) => setTimeout(ok, 50)); return n; })));
      assert.equal(r.filter((x) => x.ejecutado).length, 1);
    });
  } finally {
    await pool.end();
  }
});
