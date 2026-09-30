'use strict';
// Una vuelta del cron de cada minuto contra la base: no rompe con la base vacía, respeta el
// candado (dos a la vez, solo uno trabaja) y hace el trabajo diario una sola vez.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { vuelta } = require('../servidor/cron');
const { semillar } = require('../servidor/semillas');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');

test('cron de cada minuto', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const deps = { pool, ia: crearIa('simulado'), whatsapp: crearWhatsApp('simulado') };
  try {
    await t.test('con la base recién creada no falla', async () => {
      const i = await vuelta({ pool, deps, ahora: new Date('2026-10-06T05:00:00Z') }); // 7:00 en Madrid: aún no toca la revisión diaria
      assert.equal(i.sinProximoPaso, undefined);
      assert.equal(i.seguimientos, 0);
      assert.equal(i.secuencias, 0);
      assert.deepEqual(i.cola, { hechos: 0, reintentos: 0, fallidos: 0 });
    });
    await t.test('con los datos de la clínica cargados tampoco', async () => {
      await semillar(pool);
      const i = await vuelta({ pool, deps, ahora: new Date('2026-10-06T09:00:00Z') });
      assert.equal(i.retencionesCaducadas, 0);
      assert.equal(i.sinProximoPaso, 0, 'a las 11:00 de Madrid se hace la revisión diaria');
    });
    await t.test('dos cron a la vez: uno trabaja y el otro se aparta', async () => {
      const ahora = new Date('2026-10-06T09:01:00Z');
      const [a, b] = await Promise.all([vuelta({ pool, deps, ahora }), vuelta({ pool, deps, ahora })]);
      assert.equal([a, b].filter((x) => x.saltado).length, 1);
    });
    await t.test('la revisión diaria solo se hace una vez al día', async () => {
      const i = await vuelta({ pool, deps, ahora: new Date('2026-10-06T10:00:00Z') });
      assert.equal(i.sinProximoPaso, undefined);
    });
  } finally {
    await pool.end();
  }
});
