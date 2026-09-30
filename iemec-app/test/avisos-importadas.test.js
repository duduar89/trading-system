'use strict';
// Avisos de las citas traídas de Flowww (servidor/avisos-cita.js): sin confirmación, que ya la tuvieron
// en Flowww, pero con los recordatorios de víspera y 2 horas aunque se importaran hace nada (el paciente
// la pidió hace tiempo); y ninguno si a la cita se le han quitado (citas.recordatorios). Lo que las
// distingue es flowww_id y no el origen: la cita que sale de mover una importada (reprogramar, la lista
// de espera) hereda el origen, pero la acaba de dar la app y lleva su confirmación como cualquier otra.
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararBdDePrueba } = require('./ayuda-bd');
const avisos = require('../servidor/avisos-cita');
const agenda = require('../servidor/agenda');
const I = require('../servidor/importacion-flowww');

const CABECERA = 'Nº cita;Cliente;Móvil;Fecha;Hora;Servicio;Estado';
const F1 = 'F-1;Pinto, Rosa;611000901;15/10/2026;12:00;Limpieza facial;Confirmada';
const F2 = 'F-2;Sanz, Olga;611000902;15/10/2026;12:00;Limpieza facial;Confirmada';
const F3 = 'F-3;Mena, Lola;611000905;15/10/2026;12:00;Limpieza facial;Confirmada';

test('citas importadas: sin confirmación y con víspera y 2 horas; sin nada si se le quitan los recordatorios', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await pool.query("INSERT INTO clinica (id, nombre, nombre_corto) VALUES (1, 'Clínica de prueba', 'IEMEC')");
    for (const d of [1, 2, 3, 4, 5, 6]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '10:00', '20:00')", [d]);
    for (const s of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO salas (id, codigo, nombre, tipo, orden) VALUES (?, ?, ?, 'cabina_estetica', ?)", [s, `cabina-${s}`, `Cabina ${s}`, s]);
    await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial')");
    await pool.query("INSERT INTO tratamientos (id, nombre, familia, duracion_min) VALUES ('limpieza', 'Limpieza facial', 'facial', 60)");
    // Todas el jueves 15 de octubre a las 12:00 (Madrid). Cada exportación, completa (docs/MIGRAR-FLOWWW.md).
    const importar = async (filas, o) => {
      const r = await I.importar(pool, { citas: { nombre: 'citas.csv', contenido: Buffer.from([CABECERA, ...filas].join('\n')) }, aplicar: true, ...o });
      assert.equal(r.aplicado, true, r.informe);
    };
    const id = async (codigo) => (await pool.query('SELECT id FROM citas WHERE flowww_id = ?', [codigo]))[0][0].id;
    // F-2 se trajo hace tiempo, sin recordatorios (Flowww aún mandaba los suyos); F-1, el miércoles a las 10:00.
    await importar([F2], { sinRecordatorios: true, ahora: new Date('2026-10-01T08:00:00Z') });
    await importar([F1, F2], { ahora: new Date('2026-10-14T08:00:00Z') });
    const [importada, sinRecordatorios] = [await id('F-1'), await id('F-2')];
    // Y el miércoles a las 10:00, dos que da la app: una recepción y la otra sale de mover una
    // importada (hereda su origen, pero no viene de Flowww).
    const [ana] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Ana', '+34611000903')");
    const [eva] = await pool.query("INSERT INTO pacientes (nombre, telefono) VALUES ('Eva', '+34611000904')");
    const dada = { tratamientoId: 'limpieza', fecha: '2026-10-15', hora: '12:00', ahora: new Date('2026-10-14T08:00:00Z') };
    const recepcion = (await agenda.reservar(pool, { ...dada, pacienteId: ana.insertId, origen: 'recepcion' })).id;
    const movida = (await agenda.reservar(pool, { ...dada, pacienteId: eva.insertId, origen: 'importacion' })).id;
    const tipos = (lista, citaId) => lista.filter((a) => a.id === citaId).map((a) => a.tipo);

    // Miércoles 10:05: todas se dieron (o se trajeron) hace 5 minutos.
    const miercoles = await avisos.pendientes(pool, new Date('2026-10-14T08:05:00Z'));
    assert.deepEqual(tipos(miercoles, importada), ['vispera'], 'sin confirmación; la víspera, aunque se importara hace nada');
    assert.deepEqual(tipos(miercoles, recepcion), ['confirmacion'], 'la de recepción: la confirmación, y la víspera sobra');
    assert.deepEqual(tipos(miercoles, movida), ['confirmacion'], 'la movida de una importada, igual que cualquier cita nueva: su confirmación y sin víspera');
    assert.deepEqual(tipos(miercoles, sinRecordatorios), []);

    // Jueves 10:05, a dos horas: también la importada esa misma mañana.
    await importar([F1, F2, F3], { ahora: new Date('2026-10-15T07:30:00Z') });
    const deHoy = await id('F-3');
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
