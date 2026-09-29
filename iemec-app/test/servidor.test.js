'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearApp } = require('../servidor/index');
const { prepararBdDePrueba } = require('./ayuda-bd');

async function conServidor(app, fn) {
  const servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try { return await fn(base); } finally { servidor.close(); }
}

test('/api/version dice qué app y versión hay', async () => {
  await conServidor(crearApp({ pool: { query: async () => [[]] } }), async (base) => {
    const r = await fetch(`${base}/api/version`);
    assert.equal(r.status, 200);
    const cuerpo = await r.json();
    assert.equal(cuerpo.app, 'iemec-app');
    assert.equal(cuerpo.modos.whatsapp, 'simulado');
  });
});

test('/api/salud responde 503 si la base no contesta', async () => {
  const roto = { query: async () => { const e = new Error('x'); e.code = 'ECONNREFUSED'; throw e; } };
  await conServidor(crearApp({ pool: roto }), async (base) => {
    const r = await fetch(`${base}/api/salud`);
    assert.equal(r.status, 503);
  });
});

test('/api/salud responde 200 con la base de pruebas', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await conServidor(crearApp({ pool }), async (base) => {
      const r = await fetch(`${base}/api/salud`);
      assert.equal(r.status, 200);
    });
  } finally { await pool.end(); }
});

test('una ruta de la API que no existe da 404 en JSON', async () => {
  await conServidor(crearApp({ pool: { query: async () => [[]] } }), async (base) => {
    const r = await fetch(`${base}/api/no-existe`);
    assert.equal(r.status, 404);
    assert.match((await r.json()).error, /No existe/);
  });
});
