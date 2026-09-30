'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const { semillar } = require('../servidor/semillas');
const agenda = require('../servidor/agenda');

test('las semillas de la clínica cargan y se pueden repetir sin duplicar', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await semillar(pool);
    await semillar(pool);
    const [[cl]] = await pool.query('SELECT nombre_corto, google_place_id, municipio FROM clinica');
    assert.deepEqual({ ...cl }, { nombre_corto: 'IEMEC', google_place_id: 'ChIJB6Pn5d2FQQ0ReZ4Qoqe8gtg', municipio: 'Boadilla del Monte' });
    const [[f]] = await pool.query("SELECT nombre FROM festivos WHERE fecha = '2026-10-05'");
    assert.equal(f.nombre, 'Virgen del Rosario');
    const [[n]] = await pool.query('SELECT (SELECT COUNT(*) FROM salas) AS salas, (SELECT COUNT(*) FROM profesionales) AS profs, (SELECT COUNT(*) FROM plantillas) AS plantillas, (SELECT COUNT(*) FROM ofertas WHERE activa) AS ofertas_activas');
    assert.equal(Number(n.salas), 7);
    assert.equal(Number(n.profs), 10);
    assert.equal(Number(n.plantillas), 17);
    assert.equal(Number(n.ofertas_activas), 0, 'las ofertas llegan desactivadas: las decide la clínica');
    const [[pl]] = await pool.query("SELECT COUNT(*) AS n FROM plantillas WHERE estado <> 'borrador'");
    assert.equal(Number(pl.n), 0, 'ninguna plantilla se da por aprobada sin Meta');
    const [trats] = await pool.query('SELECT id, duracion_min FROM tratamientos');
    if (trats.length) {
      assert.ok(trats.every((x) => x.duracion_min > 0));
      // Con el catálogo cargado, un día normal tiene huecos para una limpieza facial si existe.
      const limpieza = trats.find((x) => /limpieza-facial/.test(x.id));
      if (limpieza) {
        for (const d of [1, 2, 3, 4, 5]) {
          await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) SELECT id, ?, '11:00', '20:00' FROM profesionales WHERE rol = 'esteticista'", [d]);
        }
        const h = await agenda.huecos(pool, { fecha: '2026-10-06', tratamientoId: limpieza.id, ahora: new Date('2026-09-29T08:00:00Z') });
        assert.ok(h.length > 0);
      }
    }
  } finally {
    await pool.end();
  }
});

test('cada tratamiento tiene su sala concreta y el motor solo ofrece esa', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await semillar(pool);
    const [trats] = await pool.query('SELECT t.id, t.nombre, t.familia, t.equipo_codigo, t.rol_profesional FROM tratamientos t WHERE t.activo AND t.reservable_ia AND t.sala_tipo IS NOT NULL');
    const [pares] = await pool.query('SELECT ts.tratamiento_id, s.codigo FROM tratamiento_salas ts JOIN salas s ON s.id = ts.sala_id');
    const salasDe = new Map();
    for (const p of pares) (salasDe.get(p.tratamiento_id) || salasDe.set(p.tratamiento_id, []).get(p.tratamiento_id)).push(p.codigo);
    const sinSala = trats.filter((x) => !salasDe.has(x.id));
    assert.deepEqual(sinSala.map((x) => x.nombre), [], 'todos los tratamientos reservables tienen sala asignada');

    // Con todos los profesionales trabajando un martes normal, cada tratamiento tiene huecos… y solo en su sala.
    for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) SELECT id, ?, '11:00', '20:00' FROM profesionales", [d]);
    const [salas] = await pool.query('SELECT id, codigo FROM salas');
    const codigo = Object.fromEntries(salas.map((s) => [s.id, s.codigo]));
    const sinHueco = [];
    for (const x of trats) {
      const h = await agenda.huecos(pool, { fecha: '2026-10-06', tratamientoId: x.id, ahora: new Date('2026-09-29T08:00:00Z') });
      if (!h.length) { sinHueco.push(x.nombre); continue; }
      for (const hu of h) assert.ok(salasDe.get(x.id).includes(codigo[hu.salaId]), `${x.nombre} se ha ofrecido en ${codigo[hu.salaId]}`);
    }
    assert.deepEqual(sinHueco, [], 'ningún tratamiento reservable se queda sin huecos por falta de sala, aparato o profesional');

    // Fijar un tratamiento a UNA sala concreta: aunque la otra consulta esté libre, solo se ofrece esa.
    const medico = trats.find((x) => salasDe.get(x.id).length === 2);
    if (medico) {
      const c2 = salas.find((s) => s.codigo === 'consulta-2').id;
      await pool.query('DELETE FROM tratamiento_salas WHERE tratamiento_id = ?', [medico.id]);
      await pool.query('INSERT INTO tratamiento_salas (tratamiento_id, sala_id) VALUES (?, ?)', [medico.id, c2]);
      const h = await agenda.huecos(pool, { fecha: '2026-10-06', tratamientoId: medico.id, ahora: new Date('2026-09-29T08:00:00Z') });
      assert.ok(h.length > 0);
      assert.ok(h.every((x) => x.salaId === c2), 'solo en la consulta 2');
      // Y volver a sembrar no pisa lo que la clínica cambió.
      await semillar(pool);
      const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM tratamiento_salas WHERE tratamiento_id = ?', [medico.id]);
      assert.equal(Number(n.n), 1);
    }
  } finally {
    await pool.end();
  }
});
