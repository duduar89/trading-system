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
