'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const S = require('../servidor/resenas');
const { crearGoogle } = require('../servidor/integraciones/google');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { crearIa } = require('../servidor/integraciones/ia');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');

test('reseñas con la base', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, google_place_id) VALUES (1, 'IEMEC', 'IEMEC', 'ChIJiemec')");
    for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
    await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial')");
    await pool.query("INSERT INTO tratamientos (id, nombre, familia, duracion_min, regimen_legal) VALUES ('limpieza-facial', 'Limpieza facial', 'facial', 60, 'cosmetico')");
    const r = BIBLIOTECA.find((p) => p.uso === 'resena');
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, estado, calidad) VALUES (?, 'resena', 'utilidad', ?, 'aprobada', 'verde')", [r.nombre, r.cuerpo]);
    const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Laura', '+34611000100')");
    const [c] = await pool.query(`INSERT INTO citas (paciente_id, tratamiento_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, token)
      VALUES (?, 'limpieza-facial', '2026-10-06 09:00', '2026-10-06 10:00', '2026-10-06 09:00', '2026-10-06 10:10', '2026-10-06 09:00', '2026-10-06 10:00', 'completada', REPEAT('b', 43))`, [p.insertId]);

    await t.test('tras la cita completada se programa la petición y sale a su hora, una sola vez', async () => {
      const d = await S.programarPeticion(pool, c.insertId);
      assert.equal(d.pedir, true);
      assert.deepEqual(await S.enviarPeticionesPendientes(deps, { ahora: new Date('2026-10-06T11:00:00Z') }), []);
      const hechas = await S.enviarPeticionesPendientes(deps, { ahora: new Date('2026-10-06T12:05:00Z') });
      assert.equal(hechas.length, 1);
      assert.equal(whatsapp.enviados.at(-1).nombre, 'iemec_opinion_visita');
      assert.deepEqual(await S.enviarPeticionesPendientes(deps, { ahora: new Date('2026-10-06T12:10:00Z') }), []);
      // Aunque la cita se vuelva a marcar, no se programa otra.
      await S.programarPeticion(pool, c.insertId);
      const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM peticiones_resena');
      assert.equal(n.n, 1);
    });

    await t.test('el enlace corto registra el clic y lleva a escribir la reseña', async () => {
      const [[pr]] = await pool.query('SELECT token FROM peticiones_resena LIMIT 1');
      const url = await S.abrirEnlace(pool, pr.token, 'ChIJiemec');
      assert.equal(url, 'https://search.google.com/local/writereview?placeid=ChIJiemec');
      const [[f]] = await pool.query('SELECT pulsada_en FROM peticiones_resena LIMIT 1');
      assert.ok(f.pulsada_en);
    });

    await t.test('importar reseñas: análisis, borrador y nada se publica sin aprobación', async () => {
      const google = crearGoogle('simulado', { resenas: [
        { googleId: 'g1', autor: 'Laura G.', nota: 5, texto: 'Trato encantador y resultados naturales', publicadaEn: '2026-10-06T15:00:00Z' },
        { googleId: 'g2', autor: 'Pedro', nota: 1, texto: 'Fatal, no contestan al teléfono', publicadaEn: '2026-10-07T09:00:00Z' },
      ] });
      assert.deepEqual(await S.importarResenas(pool, google), { leidas: 2, nuevas: 2 });
      assert.deepEqual(await S.importarResenas(pool, google), { leidas: 2, nuevas: 0 });
      const [filas] = await pool.query('SELECT * FROM resenas ORDER BY google_id');
      assert.equal(filas[1].prioridad, 'alta');
      assert.ok(filas.every((f) => f.estado === 'borrador' && f.borrador_respuesta));
      assert.equal(google.publicadas.length, 0);
      await S.aprobarYPublicar(pool, google, { resenaId: filas[0].id, aprobadaPor: 'recepcion@iemec' });
      assert.equal(google.publicadas.length, 1);
      await assert.rejects(S.aprobarYPublicar(pool, google, { resenaId: filas[1].id, texto: 'Sentimos lo del relleno', aprobadaPor: 'x' }), /datos de salud/);
    });
  } finally {
    await pool.end();
  }
});

test('las publicaciones del panel: solo lo que se reserva, con las filas tal como salen de la base', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const express = require('express');
  const { rutasPanel } = require('../servidor/rutas/panel');
  const app = express();
  app.use((req, _res, next) => { req.ahora = new Date('2026-07-15T10:00:00Z'); next(); }); // julio: head spa
  app.use('/api/panel', rutasPanel({ pool }));
  const servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  try {
    // Un agrupador que no se reserva y un tratamiento retirado del catálogo (activo = 0, sin
    // publicidad restringida), junto a uno que sí se reserva.
    await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('head_spa', 'Head Spa')");
    await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, regimen_legal, publicidad_restringida, activo) VALUES
      ('head-spa-japones', 'Head Spa japonés', 'head_spa', 0, 'cosmetico', FALSE, FALSE),
      ('head-spa-retirado', 'Head Spa de antes', 'head_spa', 45, 'cosmetico', FALSE, FALSE),
      ('head-spa-detox', 'Head Spa Detox', 'head_spa', 45, 'cosmetico', FALSE, TRUE)`);
    const r = await fetch(`http://127.0.0.1:${servidor.address().port}/api/panel/resenas`);
    assert.equal(r.status, 200);
    const { publicaciones } = await r.json();
    assert.deepEqual(publicaciones.map((i) => i.tratamientoId).filter(Boolean), ['head-spa-detox']);
  } finally {
    servidor.close();
    await pool.end();
  }
});
