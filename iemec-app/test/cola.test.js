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
    await t.test('candado: dos a la vez, solo uno ejecuta', async () => {
      const r = await Promise.all([1, 2].map((n) => cola.conCandado(pool, 'cron-minuto', 55000, async () => { await new Promise((ok) => setTimeout(ok, 50)); return n; })));
      assert.equal(r.filter((x) => x.ejecutado).length, 1);
    });
  } finally {
    await pool.end();
  }
});
