'use strict';
// Agenda contra MariaDB de verdad: reservas, concurrencia, retenciones y festivos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const agenda = require('../servidor/agenda');

async function sembrarMinimo(pool) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, retencion_hueco_min) VALUES (1, 'IEMEC', 'IEMEC', 15)");
  for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO festivos (fecha, nombre, ambito) VALUES ('2026-10-05', 'Virgen del Rosario', 'local')");
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'consulta-1', 'Consulta 1', 'consulta_medica')");
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (10, 'medico-1', 'Médico 1', 'medico')");
  for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (10, ?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, rol_profesional, sala_tipo, regimen_legal)
    VALUES ('toxina-facial', 'Toxina facial', 'facial', 30, 10, 'medico', 'consulta_medica', 'medicamento_receta')`);
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const [r] = await pool.query('INSERT INTO pacientes (nombre, telefono) VALUES (?, ?)', [`Paciente ${i}`, `+3460000000${i}`]);
    ids.push(r.insertId);
  }
  return ids;
}

const AHORA = new Date('2026-09-29T08:00:00Z');

test('agenda en la base: huecos, reserva, concurrencia, retención y cancelación', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    const pacientes = await sembrarMinimo(pool);

    await t.test('el día festivo no tiene huecos', async () => {
      assert.deepEqual(await agenda.huecos(pool, { fecha: '2026-10-05', tratamientoId: 'toxina-facial', ahora: AHORA }), []);
    });

    await t.test('un martes normal empieza a las 11:00', async () => {
      const h = await agenda.huecos(pool, { fecha: '2026-10-06', tratamientoId: 'toxina-facial', ahora: AHORA });
      assert.equal(h[0].hora, '11:00');
    });

    await t.test('diez reservas a la vez del mismo hueco: entra una sola', async () => {
      const intentos = await Promise.allSettled(pacientes.map((id) => agenda.reservar(pool, {
        pacienteId: id, tratamientoId: 'toxina-facial', fecha: '2026-10-06', hora: '17:00', ahora: AHORA,
      })));
      const bien = intentos.filter((x) => x.status === 'fulfilled');
      const mal = intentos.filter((x) => x.status === 'rejected');
      assert.equal(bien.length, 1);
      assert.ok(mal.every((x) => x.reason.codigo === 'HUECO_OCUPADO'), mal.map((x) => x.reason.message).join(' | '));
      const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM citas WHERE estado = 'confirmada'");
      assert.equal(n.n, 1);
      const c = bien[0].value;
      assert.equal(c.inicio.toISOString(), '2026-10-06T15:00:00.000Z');
      assert.equal(c.sala_hasta.toISOString(), '2026-10-06T15:40:00.000Z');
      assert.equal(c.token.length, 43);
    });

    await t.test('la cita ocupa la sala con su limpieza: 17:30 no, 17:40 sí', async () => {
      const h = (await agenda.huecos(pool, { fecha: '2026-10-06', tratamientoId: 'toxina-facial', ahora: AHORA })).map((x) => x.hora);
      assert.ok(!h.includes('17:00'));
      assert.ok(!h.includes('17:30'));
      assert.ok(h.includes('17:40'));
    });

    await t.test('retener, caducar y liberar el hueco', async () => {
      const ret = await agenda.reservar(pool, { pacienteId: pacientes[1], tratamientoId: 'toxina-facial', fecha: '2026-10-07', hora: '12:00', retener: true, ahora: AHORA });
      assert.equal(ret.estado, 'retenida');
      let h = (await agenda.huecos(pool, { fecha: '2026-10-07', tratamientoId: 'toxina-facial', ahora: AHORA })).map((x) => x.hora);
      assert.ok(!h.includes('12:00'), 'retenido, no se ofrece a otro');
      const luego = new Date(AHORA.getTime() + 16 * 60000);
      await assert.rejects(agenda.confirmar(pool, { token: ret.token, ahora: luego }), (e) => e.codigo === 'RETENCION_CADUCADA');
      assert.equal(await agenda.caducarRetenciones(pool, luego), 1);
      h = (await agenda.huecos(pool, { fecha: '2026-10-07', tratamientoId: 'toxina-facial', ahora: luego })).map((x) => x.hora);
      assert.ok(h.includes('12:00'), 'liberado');
    });

    await t.test('confirmar a tiempo y cancelar sube la versión del .ics', async () => {
      const ret = await agenda.reservar(pool, { pacienteId: pacientes[2], tratamientoId: 'toxina-facial', fecha: '2026-10-08', hora: '13:00', retener: true, ahora: AHORA });
      const conf = await agenda.confirmar(pool, { token: ret.token, ahora: new Date(AHORA.getTime() + 5 * 60000) });
      assert.equal(conf.estado, 'confirmada');
      const canc = await agenda.cancelar(pool, { token: ret.token, por: 'paciente', motivo: 'no puede venir', ahora: new Date(AHORA.getTime() + 10 * 60000) });
      assert.equal(canc.estado, 'cancelada');
      assert.equal(canc.secuencia_ics, 1);
      const [[ev]] = await pool.query("SELECT COUNT(*) AS n FROM eventos WHERE entidad = 'cita' AND entidad_id = ?", [String(ret.id)]);
      assert.equal(ev.n, 3);
    });
  } finally {
    await pool.end();
  }
});
