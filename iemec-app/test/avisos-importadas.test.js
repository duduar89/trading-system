'use strict';
// Avisos de las citas importadas de Flowww (servidor/avisos-cita.js): sin confirmación, que ya la
// tuvieron en Flowww, pero con los recordatorios de víspera y 2 horas aunque se importaran hace nada
// (el paciente la pidió hace tiempo); y ninguno si a la cita se le han quitado (citas.recordatorios).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { prepararBdDePrueba } = require('./ayuda-bd');
const avisos = require('../servidor/avisos-cita');

test('citas importadas: sin confirmación y con víspera y 2 horas; sin nada si se le quitan los recordatorios', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial')");
    await pool.query("INSERT INTO tratamientos (id, nombre, familia, duracion_min) VALUES ('limpieza', 'Limpieza facial', 'facial', 60)");
    const [p] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Ana', '+34611000901')");
    const jueves = new Date('2026-10-15T10:00:00Z'); // jueves 15 de octubre, 12:00 en Madrid
    const cita = async (origen, creada, { recordatorios = true } = {}) => {
      const fin = new Date(jueves.getTime() + 3600000);
      const [r] = await pool.query(
        `INSERT INTO citas (paciente_id, tratamiento_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, origen, recordatorios, token, creado_en)
         VALUES (?, 'limpieza', ?, ?, ?, ?, ?, ?, 'confirmada', ?, ?, ?, ?)`,
        [p.insertId, jueves, fin, jueves, fin, jueves, fin, origen, recordatorios, crypto.randomBytes(32).toString('base64url'), creada]);
      return r.insertId;
    };
    const importada = await cita('importacion', new Date('2026-10-14T08:00:00Z'));
    const recepcion = await cita('recepcion', new Date('2026-10-14T08:00:00Z'));
    const sinRecordatorios = await cita('importacion', new Date('2026-10-01T08:00:00Z'), { recordatorios: false });
    const tipos = (lista, id) => lista.filter((a) => a.id === id).map((a) => a.tipo);

    // Miércoles 10:05: las dos se dieron hace 5 minutos.
    const miercoles = await avisos.pendientes(pool, new Date('2026-10-14T08:05:00Z'));
    assert.deepEqual(tipos(miercoles, importada), ['vispera'], 'sin confirmación; la víspera, aunque se importara hace nada');
    assert.deepEqual(tipos(miercoles, recepcion), ['confirmacion'], 'la de recepción: la confirmación, y la víspera sobra');
    assert.deepEqual(tipos(miercoles, sinRecordatorios), []);

    // Jueves 10:05, a dos horas: también la importada esa misma mañana.
    const deHoy = await cita('importacion', new Date('2026-10-15T07:30:00Z'));
    const jueves10 = await avisos.pendientes(pool, new Date('2026-10-15T08:05:00Z'));
    assert.deepEqual(tipos(jueves10, importada), ['dos_horas']);
    assert.deepEqual(tipos(jueves10, deHoy), ['dos_horas']);
    assert.deepEqual(tipos(jueves10, sinRecordatorios), []);

    // Los recordatorios se pueden quitar a cualquier cita, también a una de recepción.
    await pool.query('UPDATE citas SET recordatorios = FALSE WHERE id = ?', [recepcion]);
    assert.deepEqual(tipos(await avisos.pendientes(pool, new Date('2026-10-15T08:05:00Z')), recepcion), ['confirmacion']);
  } finally {
    await pool.end();
  }
});
