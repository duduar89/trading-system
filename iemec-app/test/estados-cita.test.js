'use strict';
// Recepción marca qué pasa con cada cita y eso mueve el resto de la app: la petición de reseña, el
// paciente que pasa a cliente, su lead, «toca repetir» y la recuperación de un «no vino». El
// «Deshacer» lo anula todo. Y la ruta del panel, con y sin sesión.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { prepararBdDePrueba } = require('./ayuda-bd');
const agenda = require('../servidor/agenda');
const estados = require('../servidor/estados-cita');
const resenas = require('../servidor/resenas');
const R = require('../servidor/repesca/motor');
const { crearApp } = require('../servidor/index');
const { rutasPanel } = require('../servidor/rutas/panel');
const { firmar } = require('../servidor/sesion');
const { crearIa } = require('../servidor/integraciones/ia');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');
const T = require('../motor/tiempo');

delete process.env.MODO_DEMO; // sin sesión, el panel no se abre

const en = (fecha, hora) => T.desdeMadrid(fecha, hora);
const madrid = (d) => { const p = T.partesMadrid(new Date(d)); return `${p.fecha} ${p.hora}`; };
const RESERVADA = new Date('2026-09-29T08:00:00Z'); // cuando recepción dio las citas

async function sembrar(pool) {
  await pool.query("INSERT INTO clinica (id, nombre, nombre_corto, direccion, municipio, google_place_id) VALUES (1, 'Instituto Europeo de Medicina Estética y Capilar', 'IEMEC', 'Av. Siglo XXI 13, local 35', 'Boadilla del Monte', 'ChIJiemec')");
  for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (6, '10:00', '20:00')");
  await pool.query("INSERT INTO festivos (fecha, nombre, ambito) VALUES ('2026-10-05', 'Virgen del Rosario', 'local'), ('2026-10-12', 'Fiesta Nacional', 'nacional')");
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-facial', 'Cabina facial', 'cabina_estetica'), (2, 'consulta-1', 'Consulta 1', 'consulta_medica')");
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (20, 'estetica-1', 'Estética 1', 'esteticista'), (10, 'medico-1', 'Médico 1', 'medico')");
  for (const d of [1, 2, 3, 4, 5, 6]) {
    await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, ?, '11:00', '20:00'), (10, ?, '11:00', '20:00')", [d, d]);
  }
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Medicina estética facial')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, precio_eur, rol_profesional, sala_tipo, regimen_legal, publicidad_restringida, repetir_cada_dias) VALUES
    ('limpieza-facial', 'Limpieza facial profunda', 'facial', 60, 10, 54, 'esteticista', 'cabina_estetica', 'cosmetico', FALSE, NULL),
    ('hidratacion-facial', 'Hidratación facial', 'facial', 60, 10, 70, 'esteticista', 'cabina_estetica', 'cosmetico', FALSE, 120),
    ('toxina-facial', 'Toxina botulínica facial', 'facial', 30, 10, 300, 'medico', 'consulta_medica', 'medicamento_receta', TRUE, 120),
    ('botox-expres', 'Bótox exprés', 'facial', 30, 10, 250, 'medico', 'consulta_medica', 'desconocido', FALSE, NULL)`);
  for (const p of BIBLIOTECA) {
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
      [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones), JSON.stringify(p.ejemplos)]);
  }
}

// Pacientes inventados, cada uno con su teléfono.
let telefonos = 0;
async function paciente(pool, { nombre, consentimiento = false }) {
  const telefono = `+3461100${3000 + ++telefonos}`;
  const [p] = await pool.query("INSERT INTO pacientes (nombre, apellidos, telefono) VALUES (?, 'Ejemplo', ?)", [nombre, telefono]);
  if (consentimiento) await pool.query("INSERT INTO consentimientos (paciente_id, tipo, estado, fuente) VALUES (?, 'whatsapp_marketing', 'otorgado', 'recepcion')", [p.insertId]);
  return { id: p.insertId, telefono };
}

const citaDe = (pool, pacienteId, tratamientoId, fecha, hora, extra = {}) => agenda.reservar(pool, { pacienteId, tratamientoId, fecha, hora, ahora: RESERVADA, ...extra });
const fila = async (pool, id) => (await pool.query('SELECT * FROM citas WHERE id = ?', [id]))[0][0];
const rechaza = (promesa, codigo) => assert.rejects(promesa, (e) => { assert.equal(e.codigo, codigo, e.message); return true; });
const alTelefono = (whatsapp, telefono) => whatsapp.enviados.filter((m) => m.telefono === telefono);
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

test('recepción marca qué pasa con cada cita y eso mueve el resto de la app', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  const clara = {};
  try {
    await sembrar(pool);

    await t.test('«Ha llegado»: solo el día de la cita; queda la hora y el hecho; se deshace durante 30 minutos', async () => {
      const p = await paciente(pool, { nombre: 'Alba' });
      const c = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-06', '11:00');
      await rechaza(estados.marcar(pool, { id: c.id, estado: 'llegada', ahora: en('2026-10-02', '12:00') }), 'FUERA_DE_HORA');
      const r = await estados.marcar(pool, { id: c.id, estado: 'llegada', actor: 'recepcion@iemec', ahora: en('2026-10-06', '10:50') });
      assert.equal(r.estado, 'llegada');
      let f = await fila(pool, c.id);
      assert.equal(madrid(f.llegada_en), '2026-10-06 10:50');
      assert.equal(f.estado_anterior, 'confirmada');
      const [[ev]] = await pool.query("SELECT actor, datos FROM eventos WHERE tipo = 'cita_llegada' AND entidad_id = ?", [String(c.id)]);
      assert.equal(ev.actor, 'recepcion@iemec');
      assert.equal(json(ev.datos).de, 'confirmada');
      await rechaza(estados.marcar(pool, { id: c.id, estado: 'llegada', ahora: en('2026-10-06', '10:51') }), 'ESTADO_NO_VALIDO');
      await rechaza(estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-06', '11:20') }), 'ESTADO_NO_VALIDO');

      const d = await estados.deshacer(pool, { id: c.id, actor: 'recepcion@iemec', ahora: en('2026-10-06', '11:05') });
      assert.equal(d.estado, 'confirmada');
      f = await fila(pool, c.id);
      assert.deepEqual([f.estado, f.llegada_en, f.estado_anterior, f.estado_cambiado_en], ['confirmada', null, null, null]);
      await rechaza(estados.deshacer(pool, { id: c.id, ahora: en('2026-10-06', '11:06') }), 'NADA_QUE_DESHACER');
      await estados.marcar(pool, { id: c.id, estado: 'llegada', ahora: en('2026-10-06', '11:10') });
      await rechaza(estados.deshacer(pool, { id: c.id, ahora: en('2026-10-06', '11:40') }), 'DESHACER_CADUCADO');
      const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM eventos WHERE entidad = 'cita' AND entidad_id = ? AND tipo IN ('cita_llegada','cita_estado_deshecho')", [String(c.id)]);
      assert.equal(n.n, 3, 'llegada, deshecha y llegada otra vez');
    });

    await t.test('«Completada»: reseña 2 h después del fin, pasa a cliente, su lead a «asistio» y entra en «toca repetir»', async () => {
      const p = await paciente(pool, { nombre: 'Clara' });
      const [l] = await pool.query("INSERT INTO leads (paciente_id, telefono, nombre, origen, tratamiento_interes_id, etapa) VALUES (?, ?, 'Clara Ejemplo', 'meta_formulario', 'hidratacion-facial', 'conversando')", [p.id, p.telefono]);
      const c = await citaDe(pool, p.id, 'hidratacion-facial', '2026-10-06', '13:00', { leadId: l.insertId });
      Object.assign(clara, { ...p, citaId: c.id, leadId: l.insertId });
      await rechaza(estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-06', '12:59') }), 'FUERA_DE_HORA');
      await estados.marcar(pool, { id: c.id, estado: 'llegada', ahora: en('2026-10-06', '12:50') });
      const r = await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-06', '14:05') });
      const f = await fila(pool, c.id);
      assert.deepEqual([f.estado, madrid(f.completada_en), f.estado_anterior], ['completada', '2026-10-06 14:05', 'llegada']);
      // La reseña: acabó a las 14:00 → se le pide a las 16:00.
      const [[pr]] = await pool.query('SELECT estado, programada_para FROM peticiones_resena WHERE cita_id = ?', [c.id]);
      assert.deepEqual([pr.estado, madrid(pr.programada_para)], ['programada', '2026-10-06 16:00']);
      assert.equal(madrid(r.efectos.resena.cuando), '2026-10-06 16:00');
      const [[pac]] = await pool.query('SELECT es_cliente FROM pacientes WHERE id = ?', [p.id]);
      assert.equal(pac.es_cliente, 1);
      const [[lead]] = await pool.query('SELECT etapa FROM leads WHERE id = ?', [l.insertId]);
      assert.equal(lead.etapa, 'asistio');
      // Toca repetir: 6-oct + 120 días = miércoles 3-feb-2027; se le avisa 12 días antes, el viernes 22-ene.
      const [[ins]] = await pool.query("SELECT * FROM inscripciones WHERE cita_id = ? AND secuencia = 'toca_repetir'", [c.id]);
      assert.deepEqual([ins.estado, ins.paciente_id, madrid(ins.siguiente_en)], ['activa', p.id, '2027-01-22 11:30']);
      assert.equal(r.efectos.tocaRepetir.toca, '2027-02-03');
      // Todo queda en el evento de la cita (con eso se deshace).
      const [[ev]] = await pool.query("SELECT datos FROM eventos WHERE tipo = 'cita_completada' AND entidad_id = ?", [String(c.id)]);
      const datos = json(ev.datos);
      assert.equal(datos.de, 'llegada');
      assert.equal(datos.efectos.esCliente, true);
      assert.deepEqual(datos.efectos.leads, [{ id: l.insertId, etapa: 'cita' }]);
    });

    await t.test('deshacer «Completada»: se anula la reseña, deja de ser cliente, el lead vuelve y sale de «toca repetir»', async () => {
      const d = await estados.deshacer(pool, { id: clara.citaId, ahora: en('2026-10-06', '14:20') });
      assert.equal(d.estado, 'llegada');
      assert.deepEqual(d.anulado, { secuencia: 'toca_repetir', resena: { anuladas: 1, yaEnviada: false }, esCliente: false, leads: 1 });
      const f = await fila(pool, clara.citaId);
      assert.deepEqual([f.estado, f.completada_en, f.estado_anterior, madrid(f.estado_cambiado_en)], ['llegada', null, 'confirmada', '2026-10-06 12:50'],
        'vuelve la llegada con su hora');
      const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM peticiones_resena WHERE cita_id = ?', [clara.citaId]);
      assert.equal(n.n, 0);
      const [[pac]] = await pool.query('SELECT es_cliente FROM pacientes WHERE id = ?', [clara.id]);
      assert.equal(pac.es_cliente, 0);
      const [[lead]] = await pool.query('SELECT etapa FROM leads WHERE id = ?', [clara.leadId]);
      assert.equal(lead.etapa, 'cita');
      const [[ins]] = await pool.query("SELECT estado, motivo_fin FROM inscripciones WHERE cita_id = ? AND secuencia = 'toca_repetir'", [clara.citaId]);
      assert.deepEqual({ ...ins }, { estado: 'cancelada', motivo_fin: 'se deshizo el cambio de la cita' });
      // La llegada se marcó hace más de 30 minutos: esa ya no se deshace.
      await rechaza(estados.deshacer(pool, { id: clara.citaId, ahora: en('2026-10-06', '14:21') }), 'DESHACER_CADUCADO');

      // Se vuelve a completar: todo otra vez, y la reseña sale a su hora, una sola vez.
      await estados.marcar(pool, { id: clara.citaId, estado: 'completada', ahora: en('2026-10-06', '14:30') });
      const [[pr]] = await pool.query('SELECT estado, programada_para FROM peticiones_resena WHERE cita_id = ?', [clara.citaId]);
      assert.deepEqual([pr.estado, madrid(pr.programada_para)], ['programada', '2026-10-06 16:00']);
      assert.deepEqual(await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-06', '15:59') }), []);
      assert.equal((await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-06', '16:00') })).length, 1);
      assert.deepEqual(alTelefono(whatsapp, clara.telefono).map((m) => m.nombre), ['iemec_opinion_visita']);
      await rechaza(estados.deshacer(pool, { id: clara.citaId, ahora: en('2026-10-06', '16:01') }), 'DESHACER_CADUCADO');
    });

    await t.test('si recepción la marca tarde, la reseña espera a que ya no se pueda deshacer; si es de hace días, no se pide', async () => {
      const p = await paciente(pool, { nombre: 'Elena' });
      const c = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-07', '11:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-07', '17:00') });
      assert.equal(madrid(r.efectos.resena.cuando), '2026-10-07 17:30', 'no a las 14:00, que ya pasó: cuando acaba el rato para deshacer');
      assert.deepEqual(await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-07', '17:25') }), []);
      await estados.deshacer(pool, { id: c.id, ahora: en('2026-10-07', '17:25') });
      assert.deepEqual(await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-07', '17:31') }), []);
      assert.deepEqual(alTelefono(whatsapp, p.telefono), [], 'no le llega nada');
      // Una cita de hace días que se marca ahora: no se le da las gracias «por venir hoy».
      const vieja = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-02', '12:00');
      const rv = await estados.marcar(pool, { id: vieja.id, estado: 'completada', ahora: en('2026-10-07', '17:40') });
      assert.deepEqual([rv.efectos.resena.estado, rv.efectos.resena.motivo], ['omitida', 'la cita se marcó como completada días después']);
    });

    await t.test('si ya tiene otra cita de ese tratamiento, no entra en «toca repetir»', async () => {
      const p = await paciente(pool, { nombre: 'Irene' });
      const c = await citaDe(pool, p.id, 'hidratacion-facial', '2026-10-08', '12:00');
      await citaDe(pool, p.id, 'hidratacion-facial', '2026-10-22', '12:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-08', '13:05') });
      assert.deepEqual(r.efectos.tocaRepetir, { omitido: 'ya tiene otra cita de ese tratamiento' });
      const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM inscripciones WHERE paciente_id = ? AND secuencia = 'toca_repetir'", [p.id]);
      assert.equal(n.n, 0);
    });

    await t.test('«No vino»: pasada la hora; entra en la secuencia para recuperar la cita; deshacer la cancela', async () => {
      const p = await paciente(pool, { nombre: 'Marta', consentimiento: true });
      const c = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-08', '16:00');
      await rechaza(estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-08', '16:00') }), 'FUERA_DE_HORA');
      const r = await estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-08', '16:20') });
      let f = await fila(pool, c.id);
      assert.deepEqual([f.estado, madrid(f.no_presentada_en)], ['no_presentada', '2026-10-08 16:20']);
      const [[ins]] = await pool.query('SELECT secuencia, cita_id, estado FROM inscripciones WHERE id = ?', [r.efectos.recuperar.inscripcion]);
      assert.deepEqual({ ...ins }, { secuencia: 'cancelacion', cita_id: c.id, estado: 'activa' });
      assert.equal(madrid(r.efectos.recuperar.primerMensaje), '2026-10-10 16:20', 'el primer mensaje, a las 48 h');
      const [[pac]] = await pool.query('SELECT es_cliente FROM pacientes WHERE id = ?', [p.id]);
      assert.equal(pac.es_cliente, 0, 'no venir no le hace cliente');

      await estados.deshacer(pool, { id: c.id, ahora: en('2026-10-08', '16:30') });
      f = await fila(pool, c.id);
      assert.deepEqual([f.estado, f.no_presentada_en], ['confirmada', null]);
      const [[cancelada]] = await pool.query('SELECT estado FROM inscripciones WHERE id = ?', [r.efectos.recuperar.inscripcion]);
      assert.equal(cancelada.estado, 'cancelada');

      // Se vuelve a marcar y a las 48 h le escribimos para buscarle otro hueco.
      const r2 = await estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-08', '16:35') });
      const hechos = await R.avanzarSecuencias(deps, { ahora: en('2026-10-10', '16:40') });
      assert.ok(hechos.some((x) => x.inscripcion === r2.efectos.recuperar.inscripcion && x.envio === 'enviado'), JSON.stringify(hechos));
      const m = alTelefono(whatsapp, p.telefono);
      assert.equal(m.length, 1);
      assert.equal(m[0].nombre, 'iemec_cancelacion_nuevo_hueco');
      assert.deepEqual(m[0].variables, ['Marta', 'limpieza facial profunda']);

      // Si ya tiene otra cita más adelante, no se le persigue.
      const p2 = await paciente(pool, { nombre: 'Nuria', consentimiento: true });
      const c2 = await citaDe(pool, p2.id, 'limpieza-facial', '2026-10-08', '18:00');
      await citaDe(pool, p2.id, 'limpieza-facial', '2026-10-15', '12:00');
      const r3 = await estados.marcar(pool, { id: c2.id, estado: 'no_presentada', ahora: en('2026-10-08', '18:15') });
      assert.deepEqual(r3.efectos, { recuperar: { omitido: 'ya tiene otra cita' } });
    });

    await t.test('un «no vino» de un medicamento con receta: el mensaje para recuperarla no lo nombra', async () => {
      const p = await paciente(pool, { nombre: 'Sara', consentimiento: true });
      const c = await citaDe(pool, p.id, 'toxina-facial', '2026-10-09', '12:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-09', '12:20') });
      // 48 h después es domingo y el lunes 12 es fiesta: el martes a las 11:00.
      assert.equal(madrid(r.efectos.recuperar.primerMensaje), '2026-10-13 11:00');
      // Uno mal clasificado en el catálogo (sin marcar como medicamento) lo para el filtro legal.
      const p2 = await paciente(pool, { nombre: 'Rocío', consentimiento: true });
      const c2 = await citaDe(pool, p2.id, 'botox-expres', '2026-10-09', '13:00');
      await estados.marcar(pool, { id: c2.id, estado: 'no_presentada', ahora: en('2026-10-09', '13:20') });

      const hechos = await R.avanzarSecuencias(deps, { ahora: en('2026-10-13', '11:01') });
      const [m] = alTelefono(whatsapp, p.telefono);
      assert.equal(m.nombre, 'iemec_cancelacion_nuevo_hueco');
      assert.deepEqual(m.variables, ['Sara', 'medicina estética facial']);
      assert.ok(!JSON.stringify(m).toLowerCase().includes('toxina'));
      assert.deepEqual(alTelefono(whatsapp, p2.telefono), [], 'el mal clasificado no sale');
      assert.ok(hechos.some((x) => x.bloqueado === 'filtro legal'));
      const [[tarea]] = await pool.query("SELECT titulo FROM tareas WHERE paciente_id = ? AND tipo = 'revisar_ia'", [p2.id]);
      assert.match(tarea.titulo, /no pasa el filtro de publicidad sanitaria/);
    });

    await t.test('lo que no vale no cambia nada: cancelada, retenida, desconocida', async () => {
      const p = await paciente(pool, { nombre: 'Paula' });
      const c = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-14', '12:00');
      await agenda.cancelar(pool, { id: c.id, por: 'paciente', motivo: 'no puede venir', ahora: en('2026-10-10', '10:00') });
      await rechaza(estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-14', '13:00') }), 'ESTADO_NO_VALIDO');
      await rechaza(estados.deshacer(pool, { id: c.id, ahora: en('2026-10-10', '10:05') }), 'NADA_QUE_DESHACER');
      const ret = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-14', '15:00', { retener: true, ahora: en('2026-10-14', '09:00') });
      await rechaza(estados.marcar(pool, { id: ret.id, estado: 'llegada', ahora: en('2026-10-14', '09:05') }), 'ESTADO_NO_VALIDO');
      await rechaza(estados.marcar(pool, { id: 999999, estado: 'llegada' }), 'CITA_DESCONOCIDA');
      await rechaza(estados.marcar(pool, { id: c.id, estado: 'cancelada' }), 'ESTADO_DESCONOCIDO');
      assert.equal((await fila(pool, c.id)).estado, 'cancelada');
      assert.equal((await fila(pool, ret.id)).estado, 'retenida');
    });

    await t.test('llegada la fecha, «toca repetir» le escribe nombrando su tratamiento', async () => {
      await R.avanzarSecuencias(deps, { ahora: en('2027-01-22', '11:31') });
      const m = alTelefono(whatsapp, clara.telefono).at(-1);
      assert.equal(m.nombre, 'iemec_toca_repetir');
      assert.deepEqual(m.variables, ['Clara', 'hidratación facial']);
    });
  } finally {
    await pool.end();
  }
});

async function conServidor(app, fn) {
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try { return await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); }
}

// Una cita en tiempo real (para la app entera, que usa el reloj de verdad).
async function citaAhora(pool, pacienteId, inicio) {
  const fin = new Date(inicio.getTime() + 60 * 60000);
  const [r] = await pool.query(
    `INSERT INTO citas (paciente_id, tratamiento_id, profesional_id, sala_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, token)
     VALUES (?, 'limpieza-facial', 20, 1, ?, ?, ?, ?, ?, ?, 'confirmada', ?)`,
    [pacienteId, inicio, fin, inicio, fin, inicio, fin, crypto.randomBytes(32).toString('base64url')]);
  return r.insertId;
}

test('ruta del panel: sin sesión no entra; con sesión marca, explica lo que no vale y se ve en Hoy y en la agenda', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);

    await t.test('con la app entera: sin sesión, 401 y nada cambia; con sesión, se marca y queda quién fue', async () => {
      const p = await paciente(pool, { nombre: 'Lucía' });
      const ahora = new Date();
      const empezada = await citaAhora(pool, p.id, new Date(ahora.getTime() - 10 * 60000));
      const luego = await citaAhora(pool, p.id, new Date(ahora.getTime() + 3 * 3600000));
      const cookie = `iemec_sesion=${encodeURIComponent(firmar({ id: 1, email: 'recepcion@iemec', nombre: 'Recepción', rol: 'recepcion', hasta: Date.now() + 3600000 }))}`;
      await conServidor(crearApp({ pool }), async (base) => {
        const post = (id, cuerpo, sesion = true) => fetch(`${base}/api/panel/citas/${id}/estado`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(sesion ? { Cookie: cookie } : {}) }, body: JSON.stringify(cuerpo),
        });
        assert.equal((await post(empezada, { estado: 'completada' }, false)).status, 401);
        assert.equal((await fetch(`${base}/api/panel/citas/${empezada}`)).status, 401);
        assert.equal((await fila(pool, empezada)).estado, 'confirmada', 'sin sesión no cambia nada');

        const ok = await post(empezada, { estado: 'completada' });
        assert.equal(ok.status, 200);
        const cuerpo = await ok.json();
        assert.equal(cuerpo.estado, 'completada');
        assert.equal(cuerpo.efectos.resena.estado, 'programada');
        assert.equal(cuerpo.deshacer.a, 'confirmada');
        const [[ev]] = await pool.query("SELECT actor FROM eventos WHERE tipo = 'cita_completada' AND entidad_id = ?", [String(empezada)]);
        assert.equal(ev.actor, 'recepcion@iemec', 'queda quién lo marcó');

        const pronto = await post(luego, { estado: 'no_presentada' });
        assert.equal(pronto.status, 409);
        assert.match((await pronto.json()).error, /^Aún no es la hora de la cita: «No vino» se marca pasadas las \d\d:\d\d$/);
        assert.equal((await post(empezada, { estado: 'volando' })).status, 400);
        assert.equal((await post(999999, { estado: 'llegada' })).status, 404);
        const des = await post(empezada, { deshacer: true });
        assert.equal(des.status, 200);
        assert.equal((await des.json()).estado, 'confirmada');
      });
    });

    await t.test('a una hora dada: detalle con enlaces y botones, 409 claros y la cifra de «no vino» en Hoy y en la agenda', async () => {
      const [a, b, c] = [await paciente(pool, { nombre: 'Andrea' }), await paciente(pool, { nombre: 'Beatriz' }), await paciente(pool, { nombre: 'Carmen' })];
      const c1 = await citaDe(pool, a.id, 'limpieza-facial', '2026-10-13', '11:00');
      const c2 = await citaDe(pool, b.id, 'limpieza-facial', '2026-10-13', '12:30');
      await citaDe(pool, c.id, 'toxina-facial', '2026-10-13', '17:00');
      const [conv] = await pool.query("INSERT INTO conversaciones (telefono, paciente_id, estado) VALUES (?, ?, 'cerrada')", [a.telefono, a.id]);
      const reloj = { ahora: en('2026-10-13', '12:00') };
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.ahora = reloj.ahora; req.usuario = { email: 'recepcion@iemec' }; next(); });
      app.use('/api/panel', rutasPanel({ pool }));
      await conServidor(app, async (base) => {
        const get = async (ruta) => (await fetch(`${base}/api/panel${ruta}`)).json();
        const post = async (id, cuerpo) => {
          const r = await fetch(`${base}/api/panel/citas/${id}/estado`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
          return { status: r.status, cuerpo: await r.json() };
        };
        const d1 = await get(`/citas/${c1.id}`);
        assert.deepEqual(
          { paciente: d1.paciente, tratamiento: d1.tratamiento, profesional: d1.profesional, sala: d1.sala, fecha: d1.fecha, inicio: d1.inicio, fin: d1.fin, estado: d1.estado },
          { paciente: 'Andrea Ejemplo', tratamiento: 'Limpieza facial profunda', profesional: 'Estética 1', sala: 'Cabina facial', fecha: '2026-10-13', inicio: '11:00', fin: '12:00', estado: 'confirmada' });
        assert.equal(d1.enlaceCita, `/c/${c1.token}`);
        assert.equal(d1.conversacionId, conv.insertId);
        assert.deepEqual(d1.acciones, ['llegada', 'completada', 'no_presentada']);
        assert.equal(d1.deshacer, null);
        assert.equal(d1.espera, null);
        const d2 = await get(`/citas/${c2.id}`);
        assert.deepEqual(d2.acciones, ['llegada'], 'la de las 12:30 aún no ha empezado');
        assert.equal(d2.espera, 'Aún no ha empezado: se puede marcar como completada desde las 12:30');
        assert.equal((await fetch(`${base}/api/panel/citas/999999`)).status, 404);

        const r1 = await post(c1.id, { estado: 'llegada' });
        assert.equal(r1.status, 200);
        assert.deepEqual([r1.cuerpo.estado, r1.cuerpo.acciones, r1.cuerpo.deshacer.a], ['llegada', ['completada'], 'confirmada']);
        const r2 = await post(c1.id, { estado: 'no_presentada' });
        assert.deepEqual([r2.status, r2.cuerpo.error], [409, 'La cita ya tiene marcada la llegada: no se puede marcar como «No vino»']);
        assert.equal((await post(c2.id, { estado: 'no_presentada' })).status, 409);

        reloj.ahora = en('2026-10-13', '12:45');
        const r3 = await post(c2.id, { estado: 'no_presentada' });
        assert.equal(r3.status, 200);
        assert.ok(r3.cuerpo.efectos.recuperar.inscripcion);
        const tarde = await post(c1.id, { deshacer: true });
        assert.deepEqual([tarde.status, tarde.cuerpo.codigo], [409, 'DESHACER_CADUCADO']);

        const hoy = await get('/hoy');
        assert.deepEqual(hoy.citas, { total: 3, confirmadas: 1, llegadas: 1, completadas: 0, noPresentadas: 1 });
        const ag = await get('/agenda?fecha=2026-10-13');
        assert.deepEqual(ag.citas.map((x) => x.estado).sort(), ['confirmada', 'llegada', 'no_presentada']);
      });
    });
  } finally {
    await pool.end();
  }
});
