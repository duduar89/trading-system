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
const { descifrar } = require('../servidor/cripto');
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
  // Aquí se prueban los estados: la reseña, siempre 2 horas después (la prueba del momento de pedir
  // se prueba en test/resenas.test.js).
  await pool.query("UPDATE clinica SET resenas_momentos = '2h'");
  for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (6, '10:00', '20:00')");
  await pool.query("INSERT INTO festivos (fecha, nombre, ambito) VALUES ('2026-10-05', 'Virgen del Rosario', 'local'), ('2026-10-12', 'Fiesta Nacional', 'nacional')");
  await pool.query("INSERT INTO salas (id, codigo, nombre, tipo) VALUES (1, 'cabina-facial', 'Cabina facial', 'cabina_estetica'), (2, 'consulta-1', 'Consulta 1', 'consulta_medica')");
  await pool.query("INSERT INTO profesionales (id, codigo, nombre, rol) VALUES (20, 'estetica-1', 'Estética 1', 'esteticista'), (10, 'medico-1', 'Médico 1', 'medico')");
  for (const d of [1, 2, 3, 4, 5, 6]) {
    await pool.query("INSERT INTO profesional_horarios (profesional_id, dia_semana, inicio, fin) VALUES (20, ?, '11:00', '20:00'), (10, ?, '11:00', '20:00')", [d, d]);
  }
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Medicina estética facial'), ('ginecoestetica', 'Ginecología estética y regenerativa')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, holgura_despues_min, precio_eur, rol_profesional, sala_tipo, regimen_legal, publicidad_restringida, repetir_cada_dias) VALUES
    ('limpieza-facial', 'Limpieza facial profunda', 'facial', 60, 10, 54, 'esteticista', 'cabina_estetica', 'cosmetico', FALSE, NULL),
    ('hidratacion-facial', 'Hidratación facial', 'facial', 60, 10, 70, 'esteticista', 'cabina_estetica', 'cosmetico', FALSE, 120),
    ('toxina-facial', 'Toxina botulínica facial', 'facial', 30, 10, 300, 'medico', 'consulta_medica', 'medicamento_receta', TRUE, 120),
    ('botox-expres', 'Bótox exprés', 'facial', 30, 10, 250, 'medico', 'consulta_medica', 'desconocido', FALSE, NULL),
    ('plasma-facial', 'Plasma rico en plaquetas facial', 'facial', 30, 10, 200, 'medico', 'consulta_medica', 'medicamento_receta', FALSE, NULL),
    ('laser-condilomas', 'Láser para condilomas (verrugas genitales por VPH)', 'ginecoestetica', 30, 10, 180, 'esteticista', 'cabina_estetica', 'aparatologia', FALSE, 90)`);
  for (const p of BIBLIOTECA) {
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
      [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones), JSON.stringify(p.ejemplos)]);
  }
}

// Pacientes inventados, cada uno con su teléfono.
let telefonos = 0;
async function paciente(pool, { nombre, consentimiento = false, cliente = false, baja = false }) {
  const telefono = `+3461100${3000 + ++telefonos}`;
  const [p] = await pool.query("INSERT INTO pacientes (nombre, apellidos, telefono, es_cliente, baja_comercial_en) VALUES (?, 'Ejemplo', ?, ?, ?)",
    [nombre, telefono, cliente, baja ? RESERVADA : null]);
  if (consentimiento) await pool.query("INSERT INTO consentimientos (paciente_id, tipo, estado, fuente) VALUES (?, 'whatsapp_marketing', 'otorgado', 'recepcion')", [p.insertId]);
  return { id: p.insertId, telefono };
}

const citaDe = (pool, pacienteId, tratamientoId, fecha, hora, extra = {}) => agenda.reservar(pool, { pacienteId, tratamientoId, fecha, hora, ahora: RESERVADA, ...extra });
const fila = async (pool, id) => (await pool.query('SELECT * FROM citas WHERE id = ?', [id]))[0][0];
const rechaza = (promesa, codigo) => assert.rejects(promesa, (e) => { assert.equal(e.codigo, codigo, e.message); return true; });
const alTelefono = (whatsapp, telefono) => whatsapp.enviados.filter((m) => m.telefono === telefono);
const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
// Lo que le ha llegado, tal y como lo lee (el texto va cifrado en la base).
async function textos(pool, telefono) {
  const [m] = await pool.query(
    `SELECT m.cuerpo_cifrado, m.iv, m.tag FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
      WHERE c.telefono = ? AND m.direccion = 'saliente' ORDER BY m.id`, [telefono]);
  return m.map((x) => descifrar(x.cuerpo_cifrado, x.iv, x.tag));
}
const peticion = async (pool, citaId) => (await pool.query('SELECT estado, programada_para, motivo FROM peticiones_resena WHERE cita_id = ?', [citaId]))[0][0];

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

      const d = await estados.deshacer(pool, { id: c.id, de: 'llegada', actor: 'recepcion@iemec', ahora: en('2026-10-06', '11:05') });
      assert.equal(d.estado, 'confirmada');
      f = await fila(pool, c.id);
      assert.deepEqual([f.estado, f.llegada_en, f.estado_anterior, f.estado_cambiado_en], ['confirmada', null, null, null]);
      await rechaza(agenda.deshacerEstado(pool, { id: c.id, ahora: en('2026-10-06', '11:06') }), 'NADA_QUE_DESHACER');
      await estados.marcar(pool, { id: c.id, estado: 'llegada', ahora: en('2026-10-06', '11:10') });
      await rechaza(estados.deshacer(pool, { id: c.id, de: 'llegada', ahora: en('2026-10-06', '11:40') }), 'DESHACER_CADUCADO');
      const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM eventos WHERE entidad = 'cita' AND entidad_id = ? AND tipo IN ('cita_llegada','cita_estado_deshecho')", [String(c.id)]);
      assert.equal(n.n, 3, 'llegada, deshecha y llegada otra vez');
    });

    await t.test('«Completada»: reseña 2 h después del fin, pasa a cliente, su lead a «asistio» y entra en «toca repetir»', async () => {
      const p = await paciente(pool, { nombre: 'Clara' });
      const [l] = await pool.query("INSERT INTO leads (paciente_id, telefono, nombre, origen, tratamiento_interes_id, etapa) VALUES (?, ?, 'Clara Ejemplo', 'meta_formulario', 'hidratacion-facial', 'conversando')", [p.id, p.telefono]);
      // Otra consulta suya, por otro tratamiento: esa sigue abierta.
      const [otro] = await pool.query("INSERT INTO leads (paciente_id, telefono, nombre, origen, tratamiento_interes_id, etapa) VALUES (?, ?, 'Clara Ejemplo', 'web_whatsapp', 'limpieza-facial', 'nuevo')", [p.id, p.telefono]);
      const c = await citaDe(pool, p.id, 'hidratacion-facial', '2026-10-06', '13:00', { leadId: l.insertId });
      Object.assign(clara, { ...p, citaId: c.id, leadId: l.insertId });
      await rechaza(estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-06', '12:59') }), 'FUERA_DE_HORA');
      await estados.marcar(pool, { id: c.id, estado: 'llegada', ahora: en('2026-10-06', '12:50') });
      const r = await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-06', '14:05') });
      const f = await fila(pool, c.id);
      assert.deepEqual([f.estado, madrid(f.completada_en), f.estado_anterior], ['completada', '2026-10-06 14:05', 'llegada']);
      // La reseña: acabó a las 14:00 → se le pide a las 16:00.
      const pr = await peticion(pool, c.id);
      assert.deepEqual([pr.estado, madrid(pr.programada_para)], ['programada', '2026-10-06 16:00']);
      assert.equal(madrid(r.efectos.resena.cuando), '2026-10-06 16:00');
      const [[pac]] = await pool.query('SELECT es_cliente FROM pacientes WHERE id = ?', [p.id]);
      assert.equal(pac.es_cliente, 1);
      const [[lead]] = await pool.query('SELECT etapa FROM leads WHERE id = ?', [l.insertId]);
      assert.equal(lead.etapa, 'asistio');
      const [[otraConsulta]] = await pool.query('SELECT etapa FROM leads WHERE id = ?', [otro.insertId]);
      assert.equal(otraConsulta.etapa, 'nuevo', 'la consulta por otro tratamiento no se da por atendida');
      // Toca repetir: 6-oct + 120 días = miércoles 3-feb-2027; se le avisa 12 días antes, el viernes 22-ene.
      // No tiene consentimiento, pero ya es cliente (LSSI art. 21.2): se le puede escribir.
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
      const d = await estados.deshacer(pool, { id: clara.citaId, de: 'completada', ahora: en('2026-10-06', '14:20') });
      assert.equal(d.estado, 'llegada');
      assert.deepEqual(d.anulado, { secuencia: 'toca_repetir', resena: { anuladas: 1, yaEnviada: false }, esCliente: false, leads: 1 });
      const f = await fila(pool, clara.citaId);
      assert.deepEqual([f.estado, f.completada_en, f.estado_anterior, madrid(f.estado_cambiado_en)], ['llegada', null, 'confirmada', '2026-10-06 12:50'],
        'vuelve la llegada con su hora');
      assert.equal(await peticion(pool, clara.citaId), undefined);
      const [[pac]] = await pool.query('SELECT es_cliente FROM pacientes WHERE id = ?', [clara.id]);
      assert.equal(pac.es_cliente, 0);
      const [[lead]] = await pool.query('SELECT etapa FROM leads WHERE id = ?', [clara.leadId]);
      assert.equal(lead.etapa, 'cita');
      const [[ins]] = await pool.query("SELECT estado, motivo_fin FROM inscripciones WHERE cita_id = ? AND secuencia = 'toca_repetir'", [clara.citaId]);
      assert.deepEqual({ ...ins }, { estado: 'cancelada', motivo_fin: 'se deshizo el cambio de la cita' });
      // La llegada se marcó hace más de 30 minutos: esa ya no se deshace.
      await rechaza(estados.deshacer(pool, { id: clara.citaId, de: 'llegada', ahora: en('2026-10-06', '14:21') }), 'DESHACER_CADUCADO');

      // Se vuelve a completar: todo otra vez, y la reseña sale a su hora, una sola vez.
      await estados.marcar(pool, { id: clara.citaId, estado: 'completada', ahora: en('2026-10-06', '14:30') });
      const pr = await peticion(pool, clara.citaId);
      assert.deepEqual([pr.estado, madrid(pr.programada_para)], ['programada', '2026-10-06 16:00']);
      assert.deepEqual(await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-06', '15:59') }), []);
      assert.equal((await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-06', '16:00') })).length, 1);
      assert.deepEqual(alTelefono(whatsapp, clara.telefono).map((m) => m.nombre), ['iemec_opinion_visita']);
      await rechaza(estados.deshacer(pool, { id: clara.citaId, de: 'completada', ahora: en('2026-10-06', '16:01') }), 'DESHACER_CADUCADO');
    });

    await t.test('un «Deshacer» repetido (un reintento, otra pestaña) no deshace también el cambio de antes', async () => {
      const p = await paciente(pool, { nombre: 'Paz' });
      const c = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-13', '12:00');
      await estados.marcar(pool, { id: c.id, estado: 'llegada', ahora: en('2026-10-13', '12:05') });
      await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-13', '12:30') });
      assert.equal((await estados.deshacer(pool, { id: c.id, de: 'completada', ahora: en('2026-10-13', '12:31') })).estado, 'llegada');
      await rechaza(estados.deshacer(pool, { id: c.id, de: 'completada', ahora: en('2026-10-13', '12:32') }), 'ESTADO_CAMBIADO');
      const f = await fila(pool, c.id);
      assert.deepEqual([f.estado, madrid(f.llegada_en)], ['llegada', '2026-10-13 12:05'], 'la llegada sigue con su hora');
      await rechaza(estados.deshacer(pool, { id: c.id, de: 'cancelada', ahora: en('2026-10-13', '12:33') }), 'ESTADO_DESCONOCIDO');
      await rechaza(estados.deshacer(pool, { id: c.id, de: true, ahora: en('2026-10-13', '12:33') }), 'ESTADO_DESCONOCIDO');
    });

    await t.test('dos citas completadas el mismo día: una sola petición de reseña', async () => {
      const ana = await paciente(pool, { nombre: 'Ana' });
      const c1 = await citaDe(pool, ana.id, 'limpieza-facial', '2026-10-16', '11:00');
      const c2 = await citaDe(pool, ana.id, 'hidratacion-facial', '2026-10-16', '12:10');
      const r1 = await estados.marcar(pool, { id: c1.id, estado: 'completada', ahora: en('2026-10-16', '12:05') });
      const r2 = await estados.marcar(pool, { id: c2.id, estado: 'completada', ahora: en('2026-10-16', '13:15') });
      assert.equal(madrid(r1.efectos.resena.cuando), '2026-10-16 14:00');
      assert.deepEqual([r2.efectos.resena.estado, r2.efectos.resena.motivo], ['omitida', 'ya tiene otra petición de reseña programada']);
      await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-16', '14:00') });
      await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-16', '15:10') });
      assert.deepEqual(alTelefono(whatsapp, ana.telefono).map((m) => m.nombre), ['iemec_opinion_visita'], 'le llega una, no dos');

      // Si la primera se deshace (era otra cita), la petición pasa a la segunda: sale igual una.
      const bea = await paciente(pool, { nombre: 'Bea' });
      const b1 = await citaDe(pool, bea.id, 'limpieza-facial', '2026-10-19', '11:00');
      const b2 = await citaDe(pool, bea.id, 'hidratacion-facial', '2026-10-19', '12:10');
      await estados.marcar(pool, { id: b1.id, estado: 'completada', ahora: en('2026-10-19', '12:05') });
      await estados.marcar(pool, { id: b2.id, estado: 'completada', ahora: en('2026-10-19', '12:20') });
      assert.equal((await peticion(pool, b2.id)).estado, 'omitida');
      const d = await estados.deshacer(pool, { id: b1.id, de: 'completada', ahora: en('2026-10-19', '12:30') });
      assert.deepEqual([d.anulado.resenaOtraCita.cita, d.anulado.resenaOtraCita.estado, madrid(d.anulado.resenaOtraCita.cuando)], [b2.id, 'programada', '2026-10-19 15:10']);
      assert.equal(await peticion(pool, b1.id), undefined);
      const [[pac]] = await pool.query('SELECT es_cliente FROM pacientes WHERE id = ?', [bea.id]);
      assert.equal(pac.es_cliente, 1, 'la segunda sí la completó');
      await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-19', '15:10') });
      assert.deepEqual(alTelefono(whatsapp, bea.telefono).map((m) => m.nombre), ['iemec_opinion_visita']);
    });

    await t.test('la reseña se vuelve a mirar al enviarla: una baja de después manda; una queja no (se atiende en paralelo)', async () => {
      const begona = await paciente(pool, { nombre: 'Begoña' });
      const quima = await paciente(pool, { nombre: 'Quima' });
      const cb = await citaDe(pool, begona.id, 'limpieza-facial', '2026-10-28', '13:00');
      const cq = await citaDe(pool, quima.id, 'limpieza-facial', '2026-10-28', '11:00');
      await estados.marcar(pool, { id: cq.id, estado: 'completada', ahora: en('2026-10-28', '12:05') });
      await estados.marcar(pool, { id: cb.id, estado: 'completada', ahora: en('2026-10-28', '14:05') });
      assert.equal((await peticion(pool, cb.id)).estado, 'programada');
      // Quima escribe una queja a las 13:40; Begoña, «BAJA» a las 14:30.
      await R.procesarEntrante(deps, { telefono: quima.telefono, texto: 'Quiero poner una reclamación', ahora: en('2026-10-28', '13:40') });
      await R.procesarEntrante(deps, { telefono: begona.telefono, texto: 'BAJA', ahora: en('2026-10-28', '14:30') });
      const [[queja]] = await pool.query('SELECT estado FROM conversaciones WHERE telefono = ?', [quima.telefono]);
      assert.equal(queja.estado, 'espera_persona', 'la queja la atiende una persona');
      assert.equal((await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-28', '16:00') })).length, 1);
      assert.deepEqual(alTelefono(whatsapp, begona.telefono).filter((m) => m.nombre), [], 'no, a la que se dio de baja');
      // Dejar de pedírsela a quien se queja es pedirla solo a los contentos (Google lo castiga).
      assert.deepEqual(alTelefono(whatsapp, quima.telefono).filter((m) => m.nombre).map((m) => m.nombre), ['iemec_opinion_visita'], 'sí, a la que se ha quejado');
      const [pb, pq] = [await peticion(pool, cb.id), await peticion(pool, cq.id)];
      assert.deepEqual([pb.estado, pb.motivo], ['omitida', 'se dio de baja de los mensajes']);
      assert.deepEqual([pq.estado, pq.motivo], ['enviada', null]);
      const [[sigue]] = await pool.query('SELECT estado FROM conversaciones WHERE telefono = ? ORDER BY id DESC LIMIT 1', [quima.telefono]);
      assert.equal(sigue.estado, 'espera_persona', 'y la queja sigue con su persona');
    });

    await t.test('una cita de tarde: la reseña sale al día siguiente y no le da las gracias «por venir hoy»', async () => {
      const luz = await paciente(pool, { nombre: 'Luz' });
      const c = await citaDe(pool, luz.id, 'limpieza-facial', '2026-10-21', '18:30');
      const r = await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-21', '19:35') });
      assert.equal(madrid(r.efectos.resena.cuando), '2026-10-22 10:30');
      await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-22', '10:31') });
      const [texto] = await textos(pool, luz.telefono);
      assert.match(texto, /^Hola Luz, gracias por tu visita a IEMEC del miércoles 21 de octubre\./, 'la de esa visita, con su día');
      assert.doesNotMatch(texto, /\bhoy\b/);
    });

    await t.test('si recepción la marca tarde, la reseña espera a que ya no se pueda deshacer; si es de hace días, no se pide', async () => {
      const p = await paciente(pool, { nombre: 'Elena' });
      const c = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-07', '11:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-07', '17:00') });
      assert.equal(madrid(r.efectos.resena.cuando), '2026-10-07 17:30', 'no a las 14:00, que ya pasó: cuando acaba el rato para deshacer');
      assert.deepEqual(await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-07', '17:25') }), []);
      await estados.deshacer(pool, { id: c.id, de: 'completada', ahora: en('2026-10-07', '17:25') });
      assert.deepEqual(await resenas.enviarPeticionesPendientes(deps, { ahora: en('2026-10-07', '17:31') }), []);
      assert.deepEqual(alTelefono(whatsapp, p.telefono), [], 'no le llega nada');
      // Una cita de hace días que se marca ahora: ya no se pide.
      const vieja = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-02', '12:00');
      const rv = await estados.marcar(pool, { id: vieja.id, estado: 'completada', ahora: en('2026-10-07', '17:40') });
      assert.deepEqual([rv.efectos.resena.estado, rv.efectos.resena.motivo], ['omitida', 'la cita se marcó como completada días después']);
    });

    await t.test('marcada tarde, «toca repetir» tampoco sale mientras se puede deshacer', async () => {
      const p = await paciente(pool, { nombre: 'Noelia' });
      const c = await citaDe(pool, p.id, 'hidratacion-facial', '2026-05-05', '11:00', { ahora: new Date('2026-05-01T08:00:00Z') });
      // 5-may + 120 días − 12 = 21-ago: ya pasó. El aviso sale cuando acaba el rato para deshacer.
      const r = await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-07', '17:45') });
      assert.equal(madrid(r.efectos.tocaRepetir.primerMensaje), '2026-10-07 18:15');
      await R.avanzarSecuencias(deps, { ahora: en('2026-10-07', '17:46') }); // el cron del minuto siguiente
      assert.deepEqual(alTelefono(whatsapp, p.telefono), [], 'mientras se puede deshacer, no sale');
      await estados.deshacer(pool, { id: c.id, de: 'completada', ahora: en('2026-10-07', '17:50') });
      await R.avanzarSecuencias(deps, { ahora: en('2026-10-07', '18:16') });
      assert.deepEqual(alTelefono(whatsapp, p.telefono), [], 'deshecho a tiempo: no le llega nada');
    });

    await t.test('deshacer devuelve el lead aunque viniera a otra cita antes de ser lead (y sigue siendo cliente)', async () => {
      const p = await paciente(pool, { nombre: 'Julia', cliente: true });
      await pool.query(`INSERT INTO citas (paciente_id, tratamiento_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, token)
        VALUES (?, 'limpieza-facial', '2026-03-03 10:00', '2026-03-03 11:00', '2026-03-03 10:00', '2026-03-03 11:10', '2026-03-03 10:00', '2026-03-03 11:00', 'completada', REPEAT('j', 43))`, [p.id]);
      const [l] = await pool.query("INSERT INTO leads (paciente_id, telefono, nombre, origen, tratamiento_interes_id, etapa, creado_en) VALUES (?, ?, 'Julia Ejemplo', 'meta_formulario', 'hidratacion-facial', 'conversando', '2026-09-01 10:00')", [p.id, p.telefono]);
      const c = await citaDe(pool, p.id, 'hidratacion-facial', '2026-10-09', '16:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-09', '17:05') });
      assert.equal(r.efectos.esCliente, undefined, 'ya era cliente');
      assert.deepEqual(r.efectos.leads, [{ id: l.insertId, etapa: 'conversando' }]);
      const d = await estados.deshacer(pool, { id: c.id, de: 'completada', ahora: en('2026-10-09', '17:10') });
      assert.equal(d.anulado.leads, 1);
      const [[lead]] = await pool.query('SELECT etapa FROM leads WHERE id = ?', [l.insertId]);
      assert.equal(lead.etapa, 'conversando');
      const [[pac]] = await pool.query('SELECT es_cliente FROM pacientes WHERE id = ?', [p.id]);
      assert.equal(pac.es_cliente, 1);
    });

    await t.test('si ya tiene otra cita de ese tratamiento, o se dio de baja, no entra en «toca repetir»', async () => {
      const p = await paciente(pool, { nombre: 'Irene' });
      const c = await citaDe(pool, p.id, 'hidratacion-facial', '2026-10-08', '12:00');
      await citaDe(pool, p.id, 'hidratacion-facial', '2026-10-22', '12:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-08', '13:05') });
      assert.deepEqual(r.efectos.tocaRepetir, { omitido: 'ya tiene otra cita de ese tratamiento' });
      // Berta es clienta, pero se dio de baja: no se le promete un aviso que nunca va a salir.
      const berta = await paciente(pool, { nombre: 'Berta', cliente: true, baja: true });
      const cb = await citaDe(pool, berta.id, 'hidratacion-facial', '2026-10-20', '16:00');
      const rb = await estados.marcar(pool, { id: cb.id, estado: 'completada', ahora: en('2026-10-20', '17:05') });
      assert.deepEqual(rb.efectos.tocaRepetir, { omitido: 'se dio de baja de los mensajes comerciales' });
      assert.deepEqual([rb.efectos.resena.estado, rb.efectos.resena.motivo], ['omitida', 'se dio de baja de los mensajes']);
      const [[n]] = await pool.query("SELECT COUNT(*) AS n FROM inscripciones WHERE paciente_id IN (?, ?) AND secuencia = 'toca_repetir'", [p.id, berta.id]);
      assert.equal(n.n, 0);
    });

    await t.test('«No vino»: pasada la hora; entra en la secuencia para recuperar la cita, que no le dice que canceló; deshacer la cancela', async () => {
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

      await estados.deshacer(pool, { id: c.id, de: 'no_presentada', ahora: en('2026-10-08', '16:30') });
      f = await fila(pool, c.id);
      assert.deepEqual([f.estado, f.no_presentada_en], ['confirmada', null]);
      const [[cancelada]] = await pool.query('SELECT estado FROM inscripciones WHERE id = ?', [r.efectos.recuperar.inscripcion]);
      assert.equal(cancelada.estado, 'cancelada');

      // Se vuelve a marcar y a las 48 h le escribimos para buscarle otro hueco, sin decirle que canceló
      // y sin nombrar el tratamiento.
      const r2 = await estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-08', '16:35') });
      const hechos = await R.avanzarSecuencias(deps, { ahora: en('2026-10-10', '16:40') });
      assert.ok(hechos.some((x) => x.inscripcion === r2.efectos.recuperar.inscripcion && x.envio === 'enviado'), JSON.stringify(hechos));
      const m = alTelefono(whatsapp, p.telefono);
      assert.deepEqual(m.map((x) => [x.nombre, x.variables]), [['iemec_no_vino_nuevo_hueco', ['Marta']]]);
      assert.deepEqual(await textos(pool, p.telefono), [
        'Hola Marta, te echamos de menos en tu última cita en IEMEC. ¿Te buscamos otro momento que te venga mejor? Si no quieres recibir más mensajes como este, responde BAJA.',
      ]);

      // Si ya tiene otra cita más adelante, no se le persigue.
      const p2 = await paciente(pool, { nombre: 'Nuria', consentimiento: true });
      const c2 = await citaDe(pool, p2.id, 'limpieza-facial', '2026-10-08', '18:00');
      await citaDe(pool, p2.id, 'limpieza-facial', '2026-10-15', '12:00');
      const r3 = await estados.marcar(pool, { id: c2.id, estado: 'no_presentada', ahora: en('2026-10-08', '18:15') });
      assert.deepEqual(r3.efectos, { recuperar: { omitido: 'ya tiene otra cita' } });
    });

    await t.test('«No vino» de quien no puede recibir mensajes comerciales: no se le promete ninguno, queda una tarea para llamarle', async () => {
      const rosa = await paciente(pool, { nombre: 'Rosa' }); // paciente nueva, sin consentimiento
      const c = await citaDe(pool, rosa.id, 'limpieza-facial', '2026-10-20', '12:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-20', '12:20') });
      assert.equal(r.efectos.recuperar.omitido, 'no tiene consentimiento para mensajes comerciales');
      const [[tarea]] = await pool.query('SELECT id, tipo, titulo, estado FROM tareas WHERE id = ?', [r.efectos.recuperar.tarea]);
      assert.deepEqual([tarea.tipo, tarea.estado], ['llamar', 'abierta']);
      assert.equal(tarea.titulo, 'No vino a su cita el martes 20 de octubre a las 12:00: llamarle para buscarle otro hueco (no tiene consentimiento para mensajes comerciales)');
      const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM inscripciones WHERE paciente_id = ?', [rosa.id]);
      assert.equal(n.n, 0, 'no se inscribe para que luego se cancele sin avisar');
      // Deshacer el «No vino» cancela la tarea.
      const d = await estados.deshacer(pool, { id: c.id, de: 'no_presentada', ahora: en('2026-10-20', '12:30') });
      assert.equal(d.anulado.tarea, tarea.id);
      const [[cancelada]] = await pool.query('SELECT estado FROM tareas WHERE id = ?', [tarea.id]);
      assert.equal(cancelada.estado, 'cancelada');
      // Con baja comercial, lo mismo.
      const berta = await paciente(pool, { nombre: 'Berta', cliente: true, baja: true });
      const cb = await citaDe(pool, berta.id, 'limpieza-facial', '2026-10-27', '16:00');
      const rb = await estados.marcar(pool, { id: cb.id, estado: 'no_presentada', ahora: en('2026-10-27', '16:15') });
      assert.equal(rb.efectos.recuperar.omitido, 'se dio de baja de los mensajes comerciales');
      assert.ok(rb.efectos.recuperar.tarea);
    });

    await t.test('se marcó «No vino» y al final vino: se marca su llegada o se completa, y se para lo de recuperarla', async () => {
      const sol = await paciente(pool, { nombre: 'Sol', consentimiento: true });
      const c = await citaDe(pool, sol.id, 'limpieza-facial', '2026-10-23', '12:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-23', '12:02') });
      // Llega a las 12:40: el «No vino» ya no se puede deshacer, pero se marca su llegada.
      await rechaza(estados.deshacer(pool, { id: c.id, de: 'no_presentada', ahora: en('2026-10-23', '12:40') }), 'DESHACER_CADUCADO');
      const l = await estados.marcar(pool, { id: c.id, estado: 'llegada', ahora: en('2026-10-23', '12:40') });
      assert.deepEqual(l.efectos.recuperacion, { inscripciones: [{ id: r.efectos.recuperar.inscripcion, estado: 'activa', motivo: null }] });
      const [[ins]] = await pool.query('SELECT estado, motivo_fin FROM inscripciones WHERE id = ?', [r.efectos.recuperar.inscripcion]);
      assert.deepEqual({ ...ins }, { estado: 'cancelada', motivo_fin: 'al final vino a la cita' });
      const hecha = await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-23', '13:45') });
      assert.equal(hecha.efectos.resena.estado, 'programada');
      await R.avanzarSecuencias(deps, { ahora: en('2026-10-26', '12:00') });
      assert.deepEqual(alTelefono(whatsapp, sol.telefono), [], 'no se le escribe para recuperar una cita a la que vino');

      // Tere no tiene consentimiento (tarea de llamarle); se completa directamente y luego se deshace.
      const tere = await paciente(pool, { nombre: 'Tere' });
      const ct = await citaDe(pool, tere.id, 'limpieza-facial', '2026-10-26', '12:00');
      const rt = await estados.marcar(pool, { id: ct.id, estado: 'no_presentada', ahora: en('2026-10-26', '12:02') });
      const tarea = rt.efectos.recuperar.tarea;
      const ht = await estados.marcar(pool, { id: ct.id, estado: 'completada', ahora: en('2026-10-26', '13:40') });
      assert.deepEqual(ht.efectos.recuperacion, { inscripciones: [], tarea });
      assert.equal((await pool.query('SELECT estado FROM tareas WHERE id = ?', [tarea]))[0][0].estado, 'cancelada');
      const dt = await estados.deshacer(pool, { id: ct.id, de: 'completada', ahora: en('2026-10-26', '13:45') });
      assert.equal(dt.estado, 'no_presentada');
      assert.deepEqual(dt.anulado.recuperacion, { inscripciones: 0, tarea });
      assert.equal((await pool.query('SELECT estado FROM tareas WHERE id = ?', [tarea]))[0][0].estado, 'abierta', 'vuelve la tarea de llamarle');
      await rechaza(estados.deshacer(pool, { id: ct.id, de: 'no_presentada', ahora: en('2026-10-26', '13:46') }), 'DESHACER_CADUCADO');
    });

    await t.test('lo que sale solo no nombra el tratamiento: ni un medicamento, ni lo íntimo, ni el nombre del paciente bloquea nada', async () => {
      const sara = await paciente(pool, { nombre: 'Sara', consentimiento: true });
      const c = await citaDe(pool, sara.id, 'toxina-facial', '2026-10-09', '12:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-09', '12:20') });
      // 48 h después es domingo y el lunes 12 es fiesta: el martes a las 11:00.
      assert.equal(madrid(r.efectos.recuperar.primerMensaje), '2026-10-13 11:00');
      // Uno mal clasificado en el catálogo (sin marcar como medicamento): tampoco se nombra.
      const rocio = await paciente(pool, { nombre: 'Rocío', consentimiento: true });
      const c2 = await citaDe(pool, rocio.id, 'botox-expres', '2026-10-09', '13:00');
      await estados.marcar(pool, { id: c2.id, estado: 'no_presentada', ahora: en('2026-10-09', '13:20') });
      // Milagros: su nombre no es una promesa de milagros.
      const milagros = await paciente(pool, { nombre: 'Milagros', consentimiento: true });
      const c3 = await citaDe(pool, milagros.id, 'limpieza-facial', '2026-10-09', '17:30');
      await estados.marcar(pool, { id: c3.id, estado: 'no_presentada', ahora: en('2026-10-09', '17:50') });
      // Una «cancelación» sin cita (solo con su lead): su conversación no toma el id del lead por una cita.
      const [soloLead] = await pool.query("INSERT INTO leads (telefono, nombre, origen) VALUES ('+34611009999', 'Vera Ejemplo', 'telefono')");
      await R.inscribir(pool, { secuencia: 'cancelacion', leadId: soloLead.insertId, inicio: en('2026-10-09', '10:00') });

      const hechos = await R.avanzarSecuencias(deps, { ahora: en('2026-10-13', '11:01') });
      assert.ok(!hechos.some((x) => x.bloqueado), JSON.stringify(hechos));
      const [[convLead]] = await pool.query("SELECT contexto, contexto_id FROM conversaciones WHERE telefono = '+34611009999'");
      assert.deepEqual({ ...convLead }, { contexto: 'cancelacion', contexto_id: null });
      for (const [p, nombre] of [[sara, 'Sara'], [rocio, 'Rocío'], [milagros, 'Milagros']]) {
        assert.deepEqual(alTelefono(whatsapp, p.telefono).map((m) => [m.nombre, m.variables]), [['iemec_no_vino_nuevo_hueco', [nombre]]], nombre);
        const [texto] = await textos(pool, p.telefono);
        assert.doesNotMatch(texto, /toxina|b[oó]tox|limpieza/i, nombre);
      }
      const [[conv]] = await pool.query('SELECT contexto, contexto_id, estado FROM conversaciones WHERE telefono = ?', [sara.telefono]);
      assert.deepEqual([conv.contexto, conv.contexto_id], ['cancelacion', c.id], 'si contesta, la conversación sabe de qué cita va');
      const [[convMilagros]] = await pool.query('SELECT estado FROM conversaciones WHERE telefono = ?', [milagros.telefono]);
      assert.notEqual(convMilagros.estado, 'espera_persona');
      // Y luego su reseña no se omite por una «queja» que nunca existió.
      const c4 = await citaDe(pool, milagros.id, 'limpieza-facial', '2026-10-15', '16:00');
      const r4 = await estados.marcar(pool, { id: c4.id, estado: 'completada', ahora: en('2026-10-15', '17:05') });
      assert.equal(r4.efectos.resena.estado, 'programada');
    });

    await t.test('«toca repetir» de un tratamiento íntimo: no se nombra, ni en la plantilla ni en las variables', async () => {
      const carla = await paciente(pool, { nombre: 'Carla' });
      const c = await citaDe(pool, carla.id, 'laser-condilomas', '2026-10-21', '12:00');
      const r = await estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-21', '12:35') });
      // 21-oct + 90 días = 19-ene; se le avisa 9 días antes, el domingo 10: el lunes, al abrir.
      assert.equal(madrid(r.efectos.tocaRepetir.primerMensaje), '2027-01-11 11:00');
      await R.avanzarSecuencias(deps, { ahora: en('2027-01-11', '11:31') });
      const m = alTelefono(whatsapp, carla.telefono).filter((x) => x.nombre === 'iemec_toca_repetir');
      assert.deepEqual(m.map((x) => x.variables), [['Carla']]);
      const texto = (await textos(pool, carla.telefono)).find((x) => /repetir/.test(x));
      assert.equal(texto, 'Hola Carla, ya se acerca el momento de repetir tu tratamiento en IEMEC. ¿Te buscamos hueco? Si no quieres recibir más mensajes como este, responde BAJA.');
      assert.doesNotMatch(texto, /l[aá]ser|condiloma|genital|VPH|ginecolog/i);
    });

    await t.test('cómo se nombra el tratamiento en lo que sale solo: lo íntimo no, lo restringido por su familia', async () => {
      const nombre = async (tratamiento) => {
        const [l] = await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611008888', 'Prueba', 'telefono', ?)", [tratamiento]);
        return R.nombreTratamiento(pool, { id: 0, lead_id: l.insertId, contexto: 'lead' });
      };
      assert.equal(await nombre('limpieza-facial'), 'limpieza facial profunda');
      assert.equal(await nombre('laser-condilomas'), 'tu tratamiento', 'ginecoestética: ni el tratamiento ni su familia');
      assert.equal(await nombre('toxina-facial'), 'medicina estética facial');
      assert.equal(await nombre('plasma-facial'), 'medicina estética facial', 'medicamento con receta aunque no esté marcado como restringido');
      // La clínica decide tratamiento a tratamiento.
      await pool.query("UPDATE tratamientos SET sensible = TRUE WHERE id = 'limpieza-facial'");
      await pool.query("UPDATE tratamientos SET sensible = FALSE WHERE id = 'laser-condilomas'");
      assert.equal(await nombre('limpieza-facial'), 'tu tratamiento');
      assert.equal(await nombre('laser-condilomas'), 'láser para condilomas (verrugas genitales por VPH)');
      await pool.query("UPDATE tratamientos SET sensible = NULL WHERE id IN ('limpieza-facial', 'laser-condilomas')");
    });

    await t.test('la última red del filtro legal mira el tratamiento, no el nombre, y no deja la conversación esperando a nadie', async () => {
      // Un lead de algo mal clasificado en el catálogo: el primer mensaje nombraría un medicamento.
      const [l] = await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611007777', 'Milagros Ejemplo', 'meta_formulario', 'botox-expres')");
      await R.inscribir(pool, { secuencia: 'lead', leadId: l.insertId, inicio: en('2026-10-15', '11:00') });
      // Y otro lead, llamado Milagros, de una limpieza: ese sí sale.
      const [l2] = await pool.query("INSERT INTO leads (telefono, nombre, origen, tratamiento_interes_id) VALUES ('+34611007778', 'Milagros Ejemplo', 'meta_formulario', 'limpieza-facial')");
      await R.inscribir(pool, { secuencia: 'lead', leadId: l2.insertId, inicio: en('2026-10-15', '11:00') });
      const hechos = await R.avanzarSecuencias(deps, { ahora: en('2026-10-15', '11:01') });
      assert.deepEqual(hechos.map((h) => h.bloqueado || h.envio), ['filtro legal', 'enviado']);
      assert.deepEqual(alTelefono(whatsapp, '+34611007777'), []);
      assert.deepEqual(alTelefono(whatsapp, '+34611007778').map((m) => m.variables), [['Milagros', 'limpieza facial profunda']]);
      const [[tarea]] = await pool.query("SELECT t.titulo, c.estado FROM tareas t JOIN conversaciones c ON c.id = t.conversacion_id WHERE c.telefono = '+34611007777' AND t.tipo = 'revisar_ia'");
      assert.match(tarea.titulo, /no pasa el filtro de publicidad sanitaria/);
      assert.notEqual(tarea.estado, 'espera_persona', 'no es una queja: la tarea basta');
    });

    await t.test('sin la plantilla aprobada en Meta, el «No vino» lo recupera una persona', async () => {
      await pool.query("UPDATE plantillas SET estado = 'en_revision' WHERE uso = 'no_vino_recuperar'");
      try {
        const p = await paciente(pool, { nombre: 'Olga', consentimiento: true });
        const c = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-30', '12:00');
        const r = await estados.marcar(pool, { id: c.id, estado: 'no_presentada', ahora: en('2026-10-30', '12:20') });
        const hechos = await R.avanzarSecuencias(deps, { ahora: en('2026-11-02', '12:30') });
        assert.ok(hechos.some((x) => x.inscripcion === r.efectos.recuperar.inscripcion && x.fallido === 'sin plantilla'), JSON.stringify(hechos));
        const [[tarea]] = await pool.query("SELECT tipo, titulo FROM tareas WHERE paciente_id = ? ORDER BY id DESC LIMIT 1", [p.id]);
        assert.equal(tarea.tipo, 'llamar');
        assert.match(tarea.titulo, /^Cita cancelada o «No vino» sin nueva cita: aún no hay plantilla aprobada \(«no_vino_recuperar»\)/);
        assert.deepEqual(alTelefono(whatsapp, p.telefono), []);
      } finally {
        await pool.query("UPDATE plantillas SET estado = 'aprobada' WHERE uso = 'no_vino_recuperar'");
      }
    });

    await t.test('lo que no vale no cambia nada: cancelada, retenida, desconocida; y una cita empezada ya no se cancela', async () => {
      const p = await paciente(pool, { nombre: 'Paula' });
      const c = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-14', '12:00');
      await agenda.cancelar(pool, { id: c.id, por: 'paciente', motivo: 'no puede venir', ahora: en('2026-10-10', '10:00') });
      await rechaza(estados.marcar(pool, { id: c.id, estado: 'completada', ahora: en('2026-10-14', '13:00') }), 'ESTADO_NO_VALIDO');
      await rechaza(agenda.deshacerEstado(pool, { id: c.id, ahora: en('2026-10-10', '10:05') }), 'NADA_QUE_DESHACER');
      await rechaza(estados.deshacer(pool, { id: c.id, de: 'no_presentada', ahora: en('2026-10-10', '10:05') }), 'ESTADO_CAMBIADO');
      const ret = await citaDe(pool, p.id, 'limpieza-facial', '2026-10-14', '15:00', { retener: true, ahora: en('2026-10-14', '09:00') });
      await rechaza(estados.marcar(pool, { id: ret.id, estado: 'llegada', ahora: en('2026-10-14', '09:05') }), 'ESTADO_NO_VALIDO');
      await rechaza(estados.marcar(pool, { id: 999999, estado: 'llegada' }), 'CITA_DESCONOCIDA');
      await rechaza(estados.marcar(pool, { id: c.id, estado: 'cancelada' }), 'ESTADO_DESCONOCIDO');
      assert.equal((await fila(pool, c.id)).estado, 'cancelada');
      assert.equal((await fila(pool, ret.id)).estado, 'retenida');

      // Nora no viene a las 16:00 y a las 16:40 intenta cancelar desde su enlace: ya no. Recepción
      // marca «No vino» y entra en la recuperación.
      const nora = await paciente(pool, { nombre: 'Nora', consentimiento: true });
      const cn = await citaDe(pool, nora.id, 'limpieza-facial', '2026-10-28', '16:00');
      await rechaza(agenda.cancelar(pool, { token: cn.token, por: 'paciente', motivo: 'desde la página', ahora: en('2026-10-28', '16:40') }), 'FUERA_DE_HORA');
      const rn = await estados.marcar(pool, { id: cn.id, estado: 'no_presentada', ahora: en('2026-10-28', '16:45') });
      assert.ok(rn.efectos.recuperar.inscripcion);
    });

    await t.test('llegada la fecha, «toca repetir» le escribe sin nombrar su tratamiento', async () => {
      await R.avanzarSecuencias(deps, { ahora: en('2027-01-22', '11:31') });
      const m = alTelefono(whatsapp, clara.telefono).at(-1);
      assert.equal(m.nombre, 'iemec_toca_repetir');
      assert.deepEqual(m.variables, ['Clara']);
      assert.match((await textos(pool, clara.telefono)).at(-1), /^Hola Clara, ya se acerca el momento de repetir tu tratamiento en IEMEC\./);
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
        // «Deshacer» dice qué deshace: el mismo botón dos veces (un reintento) no deshace nada más.
        assert.equal((await post(empezada, { deshacer: true })).status, 400);
        const des = await post(empezada, { deshacer: 'completada' });
        assert.equal(des.status, 200);
        assert.equal((await des.json()).estado, 'confirmada');
        const otraVez = await post(empezada, { deshacer: 'completada' });
        assert.deepEqual([otraVez.status, (await otraVez.json()).codigo], [409, 'ESTADO_CAMBIADO']);
      });
    });

    await t.test('a una hora dada: detalle con enlaces y botones, 409 claros y la cifra de «no vino» en Hoy y en la agenda', async () => {
      const [a, b, c] = [await paciente(pool, { nombre: 'Andrea' }), await paciente(pool, { nombre: 'Beatriz' }), await paciente(pool, { nombre: 'Carmen' })];
      const c1 = await citaDe(pool, a.id, 'limpieza-facial', '2026-10-13', '11:00');
      const c2 = await citaDe(pool, b.id, 'limpieza-facial', '2026-10-13', '12:30');
      await citaDe(pool, c.id, 'toxina-facial', '2026-10-13', '17:00');
      // Citas que cerró la IA este mes: solo cuenta como recuperada la que sigue en pie (ni la que no
      // vino, ni la retenida, ni la que se cambió a otra).
      const porLaIa = [];
      for (const hora of ['11:00', '12:30', '14:00', '16:00']) {
        porLaIa.push(await citaDe(pool, c.id, 'limpieza-facial', '2026-10-20', hora, { origen: 'ia_whatsapp', ahora: en('2026-10-02', '10:00') }));
      }
      for (const [i, estado] of [[1, 'no_presentada'], [2, 'retenida'], [3, 'reprogramada']]) {
        await pool.query('UPDATE citas SET estado = ? WHERE id = ?', [estado, porLaIa[i].id]);
      }
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
        assert.equal((await fetch(`${base}/api/panel/citas/abc`)).status, 404);
        assert.equal((await post('abc', { estado: 'llegada' })).status, 404);

        const r1 = await post(c1.id, { estado: 'llegada' });
        assert.equal(r1.status, 200);
        assert.deepEqual([r1.cuerpo.estado, r1.cuerpo.acciones, r1.cuerpo.deshacer.a], ['llegada', ['completada'], 'confirmada']);
        const r2 = await post(c1.id, { estado: 'no_presentada' });
        assert.deepEqual([r2.status, r2.cuerpo.error], [409, 'La cita ya tiene marcada la llegada: no se puede marcar como «No vino»']);
        assert.equal((await post(c2.id, { estado: 'no_presentada' })).status, 409);

        reloj.ahora = en('2026-10-13', '12:45');
        const r3 = await post(c2.id, { estado: 'no_presentada' });
        assert.equal(r3.status, 200);
        assert.equal(r3.cuerpo.efectos.recuperar.omitido, 'no tiene consentimiento para mensajes comerciales');
        assert.ok(r3.cuerpo.efectos.recuperar.tarea);
        assert.deepEqual(r3.cuerpo.acciones, ['llegada', 'completada'], 'si al final viene, se puede marcar');
        const tarde = await post(c1.id, { deshacer: 'llegada' });
        assert.deepEqual([tarde.status, tarde.cuerpo.codigo], [409, 'DESHACER_CADUCADO']);

        const hoy = await get('/hoy');
        assert.deepEqual(hoy.citas, { total: 3, confirmadas: 1, llegadas: 1, completadas: 0, noPresentadas: 1 });
        assert.deepEqual(hoy.recuperadoMes, { citas: 1, euros: 54 });
        const ag = await get('/agenda?fecha=2026-10-13');
        assert.deepEqual(ag.citas.map((x) => x.estado).sort(), ['confirmada', 'llegada', 'no_presentada']);
      });
    });
  } finally {
    await pool.end();
  }
});
