'use strict';
// Reseñas de Google con la base: se piden a todos (también a quien se ha quejado) con su variante del
// momento y un solo recordatorio; el enlace oficial de la ficha y su clic; la alerta clínica para
// dirección médica; respuestas sin datos personales ni de salud y con aprobación; la moderación de
// Google; el borrado a los 30 días; el historial poco a poco por la cola, y la pantalla del panel.
// Pacientes, reseñas y textos inventados.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { prepararBdDePrueba } = require('./ayuda-bd');
const S = require('../servidor/resenas');
const R = require('../motor/resenas/resenas');
const { rutasPanel } = require('../servidor/rutas/panel');
const { crearApp } = require('../servidor/index');
const { crearGoogle } = require('../servidor/integraciones/google');
const { crearWhatsApp } = require('../servidor/integraciones/whatsapp');
const { crearIa } = require('../servidor/integraciones/ia');
const { apuntarBaja } = require('../servidor/bajas');
const { descifrar } = require('../servidor/cripto');
const { BIBLIOTECA } = require('../motor/repesca/plantillas');
const T = require('../motor/tiempo');

const en = (fecha, hora) => T.desdeMadrid(fecha, hora);
const madrid = (d) => { const p = T.partesMadrid(new Date(d)); return `${p.fecha} ${p.hora}`; };
const DIA = 86400000;

async function sembrar(pool, { momentos = '2h,dia_siguiente,tres_dias' } = {}) {
  await pool.query(`INSERT INTO clinica (id, nombre, nombre_corto, telefono, google_place_id, resenas_momentos)
    VALUES (1, 'Instituto Europeo de Medicina Estética y Capilar', 'IEMEC', '+34722833285', 'ChIJiemec', ?)`, [momentos]);
  for (const d of [1, 2, 3, 4, 5]) await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (?, '11:00', '20:00')", [d]);
  await pool.query("INSERT INTO horario_clinica (dia_semana, abre, cierra) VALUES (6, '10:00', '20:00')");
  await pool.query("INSERT INTO festivos (fecha, nombre, ambito) VALUES ('2026-10-12', 'Fiesta Nacional', 'nacional')");
  await pool.query("INSERT INTO familias (codigo, nombre) VALUES ('facial', 'Facial')");
  await pool.query(`INSERT INTO tratamientos (id, nombre, familia, duracion_min, regimen_legal, alias) VALUES
    ('limpieza-facial', 'Limpieza facial', 'facial', 60, 'cosmetico', NULL),
    ('relleno-labios', 'Relleno de labios con ácido hialurónico', 'facial', 30, 'producto_sanitario', '["Aumento de labios"]')`);
  await pool.query("INSERT INTO profesionales (codigo, nombre, rol) VALUES ('medico-1', 'Dra. Maribel Perea Casado', 'medico'), ('estetica-1', 'Estética 1 (por confirmar)', 'esteticista')");
  await pool.query("INSERT INTO usuarios (email, nombre, rol) VALUES ('recepcion@ejemplo.invalid', 'Recepción', 'recepcion'), ('direccion@ejemplo.invalid', 'Dirección médica', 'direccion')");
  for (const p of BIBLIOTECA) {
    await pool.query("INSERT INTO plantillas (nombre, uso, categoria, cuerpo, botones, ejemplos, estado, calidad) VALUES (?, ?, ?, ?, ?, ?, 'aprobada', 'verde')",
      [p.nombre, p.uso, p.categoria, p.cuerpo, JSON.stringify(p.botones), JSON.stringify(p.ejemplos)]);
  }
}

let telefonos = 0;
async function paciente(pool, nombre) {
  const telefono = `+3461177${String(++telefonos).padStart(4, '0')}`;
  const [p] = await pool.query("INSERT INTO pacientes (nombre, apellidos, telefono) VALUES (?, 'Ejemplo', ?)", [nombre, telefono]);
  return { id: p.insertId, telefono, nombre };
}

// Una cita de una hora ya completada (recepción la marcó; lo de los estados se prueba aparte).
async function citaCompletada(pool, pacienteId, fecha, hora) {
  const inicio = en(fecha, hora);
  const fin = new Date(inicio.getTime() + 3600000);
  const [c] = await pool.query(
    `INSERT INTO citas (paciente_id, tratamiento_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, token)
     VALUES (?, 'limpieza-facial', ?, ?, ?, ?, ?, ?, 'completada', ?)`,
    [pacienteId, inicio, fin, inicio, new Date(fin.getTime() + 600000), inicio, fin, crypto.randomBytes(32).toString('base64url')]);
  return c.insertId;
}

const peticion = async (pool, citaId) => (await pool.query('SELECT * FROM peticiones_resena WHERE cita_id = ?', [citaId]))[0][0];
const alTelefono = (whatsapp, telefono) => whatsapp.enviados.filter((m) => m.telefono === telefono);
// Lo que le ha llegado, tal y como lo lee (el texto va cifrado en la base).
async function textos(pool, telefono) {
  const [m] = await pool.query(
    `SELECT m.cuerpo_cifrado, m.iv, m.tag FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
      WHERE c.telefono = ? AND m.direccion = 'saliente' ORDER BY m.id`, [telefono]);
  return m.map((x) => descifrar(x.cuerpo_cifrado, x.iv, x.tag));
}
const resena = async (pool, googleId) => (await pool.query('SELECT * FROM resenas WHERE google_id = ?', [googleId]))[0][0];

// El adaptador de Google (simulado) con lo que dará el real: el estado de moderación al responder y,
// si se pide, la ficha con su enlace oficial para reseñar.
function googleFalso({ resenas = [], ficha = null, estado = 'PENDING' } = {}) {
  const g = crearGoogle('simulado', { resenas });
  g.responderResena = async (googleId, texto) => { g.publicadas.push({ googleId, texto }); return { ok: true, estado }; };
  if (ficha) g.obtenerFicha = async () => ficha;
  return g;
}

test('pedir la reseña: a todos y a su hora, con el enlace y su token; una queja no la para, la baja (también por teléfono) sí', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);

    await t.test('sale a su hora, una vez, sobre esa visita y con el enlace corto de su petición', async () => {
      const laura = await paciente(pool, 'Laura');
      const c = await citaCompletada(pool, laura.id, '2026-10-06', '11:00'); // acaba a las 12:00
      const d = await S.programarPeticion(pool, c, { variante: '2h' });
      assert.deepEqual([d.pedir, d.variante, madrid(d.cuando)], [true, '2h', '2026-10-06 14:00']);
      assert.deepEqual(await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-06', '13:59') }), []);
      assert.equal((await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-06', '14:00') })).length, 1);
      const pr = await peticion(pool, c);
      const [m] = alTelefono(whatsapp, laura.telefono);
      assert.deepEqual([m.nombre, m.variables, m.botonUrl], ['iemec_opinion_visita', ['Laura', 'martes 6 de octubre'], pr.token]);
      assert.deepEqual(await textos(pool, laura.telefono), [
        'Hola Laura, gracias por tu visita a IEMEC del martes 6 de octubre. Si te apetece contar qué tal fue, tu opinión en Google nos ayuda mucho, sea cual sea. '
        + `Si no quieres recibir más mensajes como este, responde BAJA.\n\nhttps://agenda.iemec-clinic.com/r/${pr.token}`,
      ]);
      // Pedir la opinión no deja trabajo en la bandeja; su recordatorio, a los 7 días a la misma hora.
      const [[conv]] = await pool.query('SELECT estado, motivo_cierre FROM conversaciones WHERE telefono = ?', [laura.telefono]);
      assert.deepEqual({ ...conv }, { estado: 'cerrada', motivo_cierre: 'resena' });
      assert.deepEqual([pr.estado, pr.variante, pr.recordatorio_estado, madrid(pr.recordatorio_para)], ['enviada', '2h', 'programado', '2026-10-13 14:00']);
      assert.deepEqual(await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-06', '14:05') }), [], 'una sola vez');
      await S.programarPeticion(pool, c);
      const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM peticiones_resena WHERE cita_id = ?', [c]);
      assert.equal(n.n, 1, 'aunque se vuelva a marcar, no se programa otra');
    });

    await t.test('quien se ha quejado también la recibe: la queja la sigue atendiendo una persona', async () => {
      const quima = await paciente(pool, 'Quima');
      const [conv] = await pool.query("INSERT INTO conversaciones (telefono, paciente_id, estado) VALUES (?, ?, 'espera_persona')", [quima.telefono, quima.id]);
      await pool.query("INSERT INTO tareas (tipo, titulo, paciente_id, conversacion_id, vence_en) VALUES ('atender_conversacion', 'Queja: atenderla', ?, ?, ?)",
        [quima.id, conv.insertId, en('2026-10-07', '12:00')]);
      const c = await citaCompletada(pool, quima.id, '2026-10-07', '11:00');
      const d = await S.programarPeticion(pool, c, { variante: '2h' });
      assert.equal(d.pedir, true, 'excluir a quien se queja es pedir solo a los contentos');
      await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-07', '14:00') });
      assert.deepEqual(alTelefono(whatsapp, quima.telefono).map((x) => x.nombre), ['iemec_opinion_visita']);
      const [[c2]] = await pool.query('SELECT estado FROM conversaciones WHERE id = ?', [conv.insertId]);
      assert.equal(c2.estado, 'espera_persona');
      assert.equal((await peticion(pool, c)).estado, 'enviada');
      // Una conversación abierta con el asistente (p. ej., con huecos ofrecidos) tampoco se toca.
      const olga = await paciente(pool, 'Olga');
      const [co] = await pool.query("INSERT INTO conversaciones (telefono, paciente_id, estado) VALUES (?, ?, 'ia_activa')", [olga.telefono, olga.id]);
      const cOlga = await citaCompletada(pool, olga.id, '2026-10-07', '11:00');
      await S.programarPeticion(pool, cOlga, { variante: '2h' });
      await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-07', '14:01') });
      assert.equal((await pool.query('SELECT estado FROM conversaciones WHERE id = ?', [co.insertId]))[0][0].estado, 'ia_activa');
    });

    await t.test('la baja manda: la de su ficha y la de la lista de bajas por teléfono, al programarla y al enviarla', async () => {
      const tomas = await paciente(pool, 'Tomás');
      await apuntarBaja(pool, { telefono: tomas.telefono, fuente: 'whatsapp' });
      const c1 = await citaCompletada(pool, tomas.id, '2026-10-07', '12:00');
      assert.deepEqual(await S.programarPeticion(pool, c1, { variante: '2h' }), { pedir: false, motivo: R.DE_BAJA });
      const berta = await paciente(pool, 'Berta');
      const c2 = await citaCompletada(pool, berta.id, '2026-10-07', '13:00');
      await S.programarPeticion(pool, c2, { variante: '2h' });
      await apuntarBaja(pool, { telefono: berta.telefono, fuente: 'meta_131050' });
      await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-07', '16:00') });
      assert.deepEqual(alTelefono(whatsapp, berta.telefono), []);
      const pb = await peticion(pool, c2);
      assert.deepEqual([pb.estado, pb.motivo, pb.recordatorio_estado], ['omitida', R.DE_BAJA, null]);
    });

    await t.test('con una plantilla aprobada que no cumple las normas (la antigua, sin la baja) no sale: queda apuntado', async () => {
      await pool.query("UPDATE plantillas SET cuerpo = 'Hola {{1}}, gracias por tu visita a IEMEC. ¿Nos cuentas qué tal tu experiencia? Tu opinión en Google nos ayuda mucho.' WHERE uso = 'resena'");
      const pepa = await paciente(pool, 'Pepa');
      const c = await citaCompletada(pool, pepa.id, '2026-10-08', '11:00');
      await S.programarPeticion(pool, c, { variante: '2h' });
      await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-08', '14:00') });
      assert.deepEqual(alTelefono(whatsapp, pepa.telefono), []);
      const pr = await peticion(pool, c);
      assert.equal(pr.estado, 'fallida');
      assert.match(pr.motivo, /no cumple las normas de Google: Falta la baja/);
    });
  } finally {
    await pool.end();
  }
});

test('la prueba del momento de pedir: cada cita con su variante, repartidas y guardadas; la clínica puede quedarse con una', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const vistas = new Set();
    for (const nombre of ['Ana', 'Bea', 'Carla', 'Dani', 'Eva', 'Fran', 'Gema', 'Hugo', 'Inés']) {
      const p = await paciente(pool, nombre);
      const c = await citaCompletada(pool, p.id, '2026-10-06', '11:00'); // martes, acaba a las 12:00
      const d = await S.programarPeticion(pool, c);
      const pr = await peticion(pool, c);
      assert.equal(pr.variante, R.elegirVariante(c), 'la de la cita, siempre la misma');
      assert.equal(d.variante, pr.variante);
      const cuando = { '2h': '2026-10-06 14:00', dia_siguiente: '2026-10-07 11:00', tres_dias: '2026-10-09 12:00' }[pr.variante];
      assert.equal(madrid(pr.programada_para), cuando, pr.variante);
      vistas.add(pr.variante);
    }
    assert.deepEqual([...vistas].sort(), ['2h', 'dia_siguiente', 'tres_dias']);
    // La clínica se queda con «al día siguiente»: viernes a las 20:00 → sábado a las 11:00.
    await pool.query("UPDATE clinica SET resenas_momentos = 'dia_siguiente'");
    const p = await paciente(pool, 'Julia');
    const c = await citaCompletada(pool, p.id, '2026-10-09', '19:00');
    const d = await S.programarPeticion(pool, c);
    assert.deepEqual([d.variante, madrid(d.cuando)], ['dia_siguiente', '2026-10-10 11:00']);
    // Y lo que diga quien la programa manda sobre la prueba.
    const q = await paciente(pool, 'Karim');
    const cq = await citaCompletada(pool, q.id, '2026-10-06', '11:00');
    assert.equal((await S.programarPeticion(pool, cq, { variante: 'tres_dias' })).variante, 'tres_dias');
  } finally {
    await pool.end();
  }
});

test('un solo recordatorio, a los 7-9 días y solo si no abrió el enlace', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool);
    const [laura, marta, rosa, luz] = [await paciente(pool, 'Laura'), await paciente(pool, 'Marta'), await paciente(pool, 'Rosa'), await paciente(pool, 'Luz')];
    const citas = {};
    for (const p of [laura, marta, rosa, luz]) {
      citas[p.nombre] = await citaCompletada(pool, p.id, '2026-10-06', '11:00');
      await S.programarPeticion(pool, citas[p.nombre], { variante: '2h' });
    }
    assert.equal((await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-06', '14:00') })).length, 4);
    // Marta abre el enlace; Rosa pide la baja.
    const token = (await peticion(pool, citas.Marta)).token;
    await S.abrirEnlace(pool, token, 'ChIJiemec', en('2026-10-08', '09:30'));
    await apuntarBaja(pool, { telefono: rosa.telefono, fuente: 'whatsapp' });

    assert.deepEqual(await S.enviarRecordatorios(deps, { ahora: en('2026-10-13', '13:59') }), []);
    const hechos = await S.enviarRecordatorios(deps, { ahora: en('2026-10-13', '14:00') });
    assert.equal(hechos.length, 2, 'Laura y Luz');
    for (const p of [laura, luz]) {
      const pr = await peticion(pool, citas[p.nombre]);
      assert.deepEqual([pr.recordatorio_estado, madrid(pr.recordatorio_enviado_en)], ['enviado', '2026-10-13 14:00']);
      assert.deepEqual(alTelefono(whatsapp, p.telefono).map((m) => [m.nombre, m.variables, m.botonUrl]), [
        ['iemec_opinion_visita', [p.nombre, 'martes 6 de octubre'], pr.token],
        ['iemec_opinion_recordatorio', [p.nombre, 'martes 6 de octubre'], pr.token],
      ], 'el mismo enlace: el clic cuenta en la misma petición');
    }
    const [pm, pr] = [await peticion(pool, citas.Marta), await peticion(pool, citas.Rosa)];
    assert.deepEqual([pm.recordatorio_estado, pm.recordatorio_motivo], ['omitido', 'ya abrió el enlace']);
    assert.deepEqual([pr.recordatorio_estado, pr.recordatorio_motivo], ['omitido', R.DE_BAJA]);
    assert.equal(alTelefono(whatsapp, marta.telefono).length, 1);
    assert.deepEqual(await S.enviarRecordatorios(deps, { ahora: en('2026-10-14', '12:00') }), [], 'solo uno');
    const [recordatorio] = (await textos(pool, laura.telefono)).slice(1);
    assert.match(recordatorio, /^Hola Laura, hace unos días te preguntamos por tu visita a IEMEC del martes 6 de octubre\..*único recordatorio.*responde BAJA\./s);

    // Sin la plantilla del recordatorio aprobada, no sale (y no se repite la petición).
    await pool.query("UPDATE plantillas SET estado = 'pausada' WHERE uso = 'resena_recordatorio'");
    const eva = await paciente(pool, 'Eva');
    const ce = await citaCompletada(pool, eva.id, '2026-10-07', '11:00');
    await S.programarPeticion(pool, ce, { variante: '2h' });
    await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-07', '14:00') });
    await S.enviarRecordatorios(deps, { ahora: en('2026-10-14', '14:00') });
    const pe = await peticion(pool, ce);
    assert.deepEqual([pe.recordatorio_estado, pe.recordatorio_motivo], ['omitido', 'sin plantilla aprobada']);
    assert.equal(alTelefono(whatsapp, eva.telefono).length, 1);
    // Si el cron no pasó a tiempo (más allá del día 9), ya no se manda.
    await pool.query("UPDATE plantillas SET estado = 'aprobada' WHERE uso = 'resena_recordatorio'");
    const ines = await paciente(pool, 'Inés');
    const ci = await citaCompletada(pool, ines.id, '2026-10-08', '11:00');
    await S.programarPeticion(pool, ci, { variante: '2h' });
    await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-08', '14:00') });
    await S.enviarRecordatorios(deps, { ahora: en('2026-10-18', '12:00') });
    assert.match((await peticion(pool, ci)).recordatorio_motivo, /plazo/);
  } finally {
    await pool.end();
  }
});

test('el enlace corto lleva al enlace oficial de la ficha (newReviewUri) si se ha leído, y el clic queda registrado', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  try {
    await sembrar(pool);
    const p = await paciente(pool, 'Laura');
    const c = await citaCompletada(pool, p.id, '2026-10-06', '11:00');
    await S.programarPeticion(pool, c, { variante: '2h' });
    const { token } = await peticion(pool, c);
    // Sin la ficha leída: el formato writereview con el place_id de la clínica (la reserva).
    assert.equal(await S.abrirEnlace(pool, 'noexiste00000000000000', null), 'https://search.google.com/local/writereview?placeid=ChIJiemec');
    assert.deepEqual(await S.actualizarFicha(pool, crearGoogle('simulado')), { leida: false }, 'si el adaptador aún no tiene obtenerFicha');

    const oficial = 'https://g.page/r/CEjemploResena/review';
    assert.deepEqual(await S.actualizarFicha(pool, googleFalso({ ficha: { placeId: 'ChIJotro0000000', newReviewUri: oficial } }), { ahora: en('2026-10-06', '08:00') }),
      { leida: true, enlace: true });
    const [[cl]] = await pool.query('SELECT google_enlace_resena, google_place_id, google_ficha_leida_en FROM clinica');
    assert.deepEqual([cl.google_enlace_resena, cl.google_place_id, madrid(cl.google_ficha_leida_en)], [oficial, 'ChIJiemec', '2026-10-06 08:00'], 'el place_id que ya había no se toca');
    assert.equal(await S.abrirEnlace(pool, token, 'ChIJiemec', en('2026-10-06', '15:00')), oficial);
    await S.abrirEnlace(pool, token, 'ChIJiemec', en('2026-10-07', '10:00'));
    assert.equal(madrid((await peticion(pool, c)).pulsada_en), '2026-10-06 15:00', 'cuenta el primer clic');
    // Un enlace que no es de Google no se guarda (el de antes sigue).
    await S.actualizarFicha(pool, googleFalso({ ficha: { placeId: 'ChIJiemec', newReviewUri: 'https://ejemplo.invalid/opina' } }));
    assert.equal((await pool.query('SELECT google_enlace_resena AS e FROM clinica'))[0][0].e, oficial);

    // Y por la ruta pública /r/:token, tal como lo abre el paciente.
    const s = crearApp({ pool }).listen(0);
    await new Promise((r) => s.once('listening', r));
    try {
      const r = await fetch(`http://127.0.0.1:${s.address().port}/r/${token}`, { redirect: 'manual' });
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), oficial);
    } finally {
      s.close();
    }
  } finally {
    await pool.end();
  }
});

test('reseñas de Google: análisis y alerta clínica, respuestas sin datos personales y con aprobación, y la moderación de Google', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const ahora = en('2026-10-08', '10:00');
  const lista = [
    { googleId: 'g1', autor: 'Laura G.', nota: 5, texto: 'Trato encantador y resultados naturales. La Dra. Perea, un amor.', publicadaEn: '2026-10-06T15:00:00Z', actualizadaEn: '2026-10-06T15:00:00Z' },
    { googleId: 'g2', autor: 'Pedro', nota: 1, texto: 'Fatal, no contestan al teléfono', publicadaEn: '2026-10-07T09:00:00Z', actualizadaEn: '2026-10-07T09:00:00Z' },
    { googleId: 'g3', autor: 'Carmen', nota: 1, texto: 'Se me infectó la zona y acabé en urgencias', publicadaEn: '2026-10-07T18:00:00Z', actualizadaEn: '2026-10-07T18:00:00Z' },
    // Del historial: una ya contestada que habla de una complicación (solo se marca) y otra sin contestar (tarea, sin prisa).
    { googleId: 'g4', autor: 'Marta', nota: 5, texto: 'Ninguna complicación, perfecto', publicadaEn: '2025-01-10T10:00:00Z', respuesta: '¡Gracias, Marta!', respondidaEn: '2025-01-11T10:00:00Z' },
    { googleId: 'g5', autor: 'Luis', nota: 4, texto: 'Muy profesionales', publicadaEn: '2025-02-10T10:00:00Z' },
    { googleId: 'g6', autor: 'Irene', nota: 2, texto: 'Tuve una complicación y tardaron en llamarme', publicadaEn: '2025-03-10T10:00:00Z' },
  ];
  const google = googleFalso({ resenas: lista });
  try {
    await sembrar(pool);

    await t.test('entran con su análisis y su borrador; las del historial, sin borrador; nada se publica sin aprobación', async () => {
      assert.deepEqual(await S.importarResenas(pool, google, { ahora }), { leidas: 6, nuevas: 6, editadas: 0, alertas: 2, rechazadas: 0 });
      assert.deepEqual(await S.importarResenas(pool, google, { ahora }), { leidas: 6, nuevas: 0, editadas: 0, alertas: 0, rechazadas: 0 });
      const [filas] = await pool.query('SELECT google_id, estado, historial, prioridad, alerta_clinica, borrador_respuesta, con_texto FROM resenas ORDER BY google_id');
      assert.deepEqual(filas.map((f) => [f.google_id, f.estado, f.historial, f.alerta_clinica, Boolean(f.borrador_respuesta)]), [
        ['g1', 'borrador', 0, 0, true], ['g2', 'borrador', 0, 0, true], ['g3', 'borrador', 0, 1, true],
        ['g4', 'publicada', 0, 1, false], ['g5', 'historial', 1, 0, false], ['g6', 'historial', 1, 1, false],
      ]);
      assert.equal(filas[1].prioridad, 'alta');
      assert.equal(google.publicadas.length, 0);
      // El borrador: sin tratamiento, sin nombrar a la doctora aunque la nombre la reseña, en neutro.
      const g1 = filas[0].borrador_respuesta;
      assert.match(g1, /Laura/);
      assert.doesNotMatch(g1, /Perea|doctora|Dra|visita|paciente|tratamiento/i);
      assert.match(filas[1].borrador_respuesta, /722 83 32 85.*en privado/);
    });

    await t.test('alerta clínica: tarea urgente para dirección médica, sin nada de la reseña en el título', async () => {
      const [tareas] = await pool.query('SELECT t.tipo, t.titulo, t.urgente, t.responsable_id, t.vence_en, r.google_id FROM tareas t JOIN resenas r ON r.alerta_tarea_id = t.id ORDER BY r.google_id');
      const [[direccion]] = await pool.query("SELECT id FROM usuarios WHERE rol = 'direccion'");
      assert.deepEqual(tareas.map((x) => [x.google_id, x.tipo, x.urgente, x.responsable_id]), [['g3', 'otro', 1, direccion.id], ['g6', 'otro', 0, direccion.id]]);
      assert.match(tareas[0].titulo, /^Para dirección médica: .*\(1 ★\)/);
      assert.equal(madrid(tareas[0].vence_en), '2026-10-08 11:00', 'en una hora');
      for (const x of tareas) assert.doesNotMatch(x.titulo, /infect|urgencias|Carmen|Irene|llamarme/i);
      // Su borrador no cuenta nada en público: que llame, y lo lleva dirección médica.
      const g3 = await resena(pool, 'g3');
      assert.equal(g3.prioridad, 'alta');
      assert.match(g3.borrador_respuesta, /en privado/);
      assert.doesNotMatch(g3.borrador_respuesta, /infec|urgencia/i);
      const [[ev]] = await pool.query("SELECT COUNT(*) AS n FROM eventos WHERE tipo = 'resena_alerta_clinica'");
      assert.equal(ev.n, 2);
    });

    await t.test('respuestas: sin datos personales ni de salud, con el teléfono en las negativas, sin repetir, y con aprobación', async () => {
      const g1 = await resena(pool, 'g1');
      const g2 = await resena(pool, 'g2');
      const aprobar = (r, texto) => S.aprobarYPublicar(pool, google, { resenaId: r.id, texto, aprobadaPor: 'recepcion@iemec', ahora });
      await assert.rejects(aprobar(g2, 'Sentimos lo del relleno'), /datos de salud/);
      await assert.rejects(aprobar(g1, '¡Gracias, Laura! La Dra. Perea está encantada de leerte.'), /equipo/);
      await assert.rejects(aprobar(g1, '¡Gracias, Laura! Maribel te manda un abrazo.'), /equipo \(«maribel»\)/);
      await assert.rejects(aprobar(g1, '¡Gracias, Laura! Te esperamos el martes 13 de octubre en tu próxima cita.'), /fecha.*paciente/);
      await assert.rejects(aprobar(g1, '¡Gracias, Laura! Nos alegra que el aumento de labios haya quedado natural.'), /tratamiento/);
      await assert.rejects(aprobar(g1, '¡Gracias, Laura! Te regalamos un 10 % de descuento: iemec-clinic.com/promo'), /enlaces.*promociones/);
      await assert.rejects(aprobar(g2, 'Hola Pedro, lo sentimos mucho. Escríbenos cuando quieras.'), /teléfono de la clínica \(722 83 32 85\)/);
      await assert.rejects(aprobar(g2, 'Hola Pedro, lo sentimos mucho. Llámame al 600 11 22 33.'), /Solo puede llevar el teléfono de la clínica/);
      assert.equal(google.publicadas.length, 0, 'nada de eso ha salido');

      const hecho = await aprobar(g1, null); // el borrador tal cual
      assert.deepEqual([hecho.estado, hecho.avisos], ['publicada', []]);
      assert.deepEqual(google.publicadas, [{ googleId: 'g1', texto: g1.borrador_respuesta }]);
      const f1 = await resena(pool, 'g1');
      assert.deepEqual([f1.estado, f1.aprobada_por, madrid(f1.primera_respuesta_en), f1.respuesta_estado], ['publicada', 'recepcion@iemec', '2026-10-08 10:00', 'pendiente']);
      await assert.rejects(aprobar(f1, null), /ya tiene su respuesta publicada/);
      // Otra igual (con otro nombre) sería repetida: Google la rechaza (REPETITIVE).
      await assert.rejects(aprobar(g2, g1.borrador_respuesta.replace('Laura', 'Pedro')), /repetidas/);
      assert.equal((await aprobar(g2, 'Hola Pedro, sentimos que no haya ido bien. Llámanos al 722 83 32 85 y lo hablamos en privado.')).estado, 'publicada');
      const [[ev]] = await pool.query("SELECT COUNT(*) AS n FROM eventos WHERE tipo = 'resena_respondida'");
      assert.equal(ev.n, 2);
    });

    await t.test('moderación: la respuesta que Google rechaza vuelve a la bandeja con otro borrador y cuenta como rechazada', async () => {
      const antes = await resena(pool, 'g1');
      Object.assign(lista[0], { respuesta: antes.respuesta, respondidaEn: '2026-10-08T08:00:00Z', estadoRespuesta: 'REJECTED', motivoRechazo: 'REPETITIVE' });
      const tarde = new Date(ahora.getTime() + 3600000);
      assert.equal((await S.importarResenas(pool, google, { ahora: tarde })).rechazadas, 1);
      let g1 = await resena(pool, 'g1');
      assert.deepEqual([g1.estado, g1.respuesta_estado, g1.respuesta_motivo_rechazo, g1.respuestas_rechazadas], ['borrador', 'rechazada', 'REPETITIVE', 1]);
      assert.notEqual(R.huella(g1.borrador_respuesta), R.huella(antes.respuesta), 'otro borrador, distinto del rechazado');
      assert.equal((await S.importarResenas(pool, google, { ahora: tarde })).rechazadas, 0, 'el mismo rechazo no se cuenta dos veces');
      assert.equal((await resena(pool, 'g1')).estado, 'borrador', 'una respuesta rechazada no cuenta como contestada desde la ficha');
      // Se aprueba la nueva y Google la acepta.
      await S.aprobarYPublicar(pool, google, { resenaId: g1.id, aprobadaPor: 'recepcion@iemec', ahora: tarde });
      Object.assign(lista[0], { respuesta: g1.borrador_respuesta, estadoRespuesta: 'APPROVED', motivoRechazo: null });
      await S.importarResenas(pool, google, { ahora: new Date(tarde.getTime() + 3600000) });
      g1 = await resena(pool, 'g1');
      assert.deepEqual([g1.estado, g1.respuesta_estado, g1.respuestas_rechazadas, madrid(g1.primera_respuesta_en)], ['publicada', 'aprobada', 1, '2026-10-08 10:00']);
      // Alguien contesta desde la ficha de Google: cuenta como contestada.
      Object.assign(lista[4], { respuesta: '¡Gracias, Luis!', respondidaEn: '2026-10-08T09:00:00Z' });
      await S.importarResenas(pool, google, { ahora: tarde });
      const g5 = await resena(pool, 'g5');
      assert.deepEqual([g5.estado, g5.respuesta, madrid(g5.primera_respuesta_en)], ['publicada', '¡Gracias, Luis!', '2026-10-08 11:00']);
    });

    await t.test('la pantalla «Reseñas»: KPI, las alertas lo primero, el historial y la ficha', async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.ahora = new Date(ahora.getTime() + 3 * 3600000); next(); });
      app.use('/api/panel', rutasPanel({ pool, deps: { pool, google } }));
      const s = app.listen(0);
      await new Promise((r) => s.once('listening', r));
      try {
        const base = `http://127.0.0.1:${s.address().port}/api/panel/resenas`;
        const d = await (await fetch(base)).json();
        assert.equal(d.metricas.total, 6);
        assert.deepEqual([d.metricas.resenas14, d.metricas.nota90], [3, 2.33]);
        assert.equal(d.metricas.tasaRespuesta, 67, 'contestadas g1 y g2 de las 3 de los últimos 90 días');
        assert.deepEqual(d.metricas.temasMes.map((x) => x.tema).sort(), ['atencion_recepcion', 'resultados', 'trato']);
        assert.equal(d.resenas[0].alerta && d.resenas[0].alertaAbierta, true, 'la alerta clínica abierta, lo primero');
        assert.deepEqual(d.historial, { pendientes: 1, enBandeja: 0, enCola: 0, publicadasHoy: 0, cupo: 20 });
        assert.deepEqual(d.ficha, { enlaceOficial: false, placeId: true, leidaEn: null });
        assert.deepEqual(d.momentos.map((m) => m.variante), ['2h', 'dia_siguiente', 'tres_dias']);
        assert.ok(Array.isArray(d.publicaciones));
        // Publicar desde el panel: con un error, lo dice; bien, publicada.
        const g3 = await resena(pool, 'g3');
        const mal = await fetch(`${base}/${g3.id}/publicar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: 'Sentimos lo de la infección' }) });
        assert.equal(mal.status, 400);
        assert.match((await mal.json()).error, /salud/);
        const bien = await fetch(`${base}/${g3.id}/publicar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        assert.deepEqual(await bien.json(), { ok: true, estado: 'publicada', avisos: [] });
      } finally {
        s.close();
      }
    });
  } finally {
    await pool.end();
  }
});

test('a los 30 días se borran el texto y el autor; se quedan el id, las estrellas, las fechas, los estados y nuestras respuestas', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const t0 = en('2026-10-08', '10:00');
  const lista = [
    { googleId: 'g1', autor: 'Laura G.', nota: 5, texto: 'Trato encantador', publicadaEn: '2026-10-07T15:00:00Z', actualizadaEn: '2026-10-07T15:00:00Z' },
    { googleId: 'g2', autor: 'Marta', nota: 4, texto: 'Bien, aunque esperé un poco', publicadaEn: '2026-10-07T16:00:00Z', actualizadaEn: '2026-10-07T16:00:00Z' },
  ];
  const google = googleFalso({ resenas: lista });
  try {
    await sembrar(pool);
    await S.importarResenas(pool, google, { ahora: t0 });
    const g1 = await resena(pool, 'g1');
    await S.aprobarYPublicar(pool, google, { resenaId: g1.id, aprobadaPor: 'recepcion@iemec', ahora: new Date(t0.getTime() + 3600000) });
    assert.match((await resena(pool, 'g2')).borrador_respuesta, /Marta/);

    assert.deepEqual(await S.purgarContenido(pool, { ahora: new Date(t0.getTime() + 29 * DIA) }), { borradas: 0 });
    const t30 = new Date(t0.getTime() + 30 * DIA + 60000);
    assert.deepEqual(await S.purgarContenido(pool, { ahora: t30 }), { borradas: 2 });
    const [a, b] = [await resena(pool, 'g1'), await resena(pool, 'g2')];
    for (const r of [a, b]) {
      assert.deepEqual([r.texto, r.autor, r.temas], [null, null, null]);
      assert.equal(madrid(r.contenido_borrado_en), madrid(t30));
      assert.equal(r.con_texto, 1, 'se sabe que tenía texto');
    }
    // Se quedan el id, las estrellas, las fechas, los estados y nuestra respuesta (con su saludo).
    assert.deepEqual([a.google_id, a.nota, a.estado, a.respuesta, madrid(a.publicada_en), madrid(a.primera_respuesta_en)],
      ['g1', 5, 'publicada', g1.borrador_respuesta, '2026-10-07 17:00', '2026-10-08 11:00']);
    // El borrador que aún no se ha aprobado llevaba su nombre: ahora, otro sin nada de la reseña.
    assert.equal(b.estado, 'borrador');
    assert.doesNotMatch(b.borrador_respuesta, /Marta|espera/i);
    assert.deepEqual(await S.purgarContenido(pool, { ahora: new Date(t30.getTime() + DIA) }), { borradas: 0 });

    // Volver a leerlas de Google no vuelve a guardar lo borrado…
    await S.importarResenas(pool, google, { ahora: new Date(t30.getTime() + DIA) });
    assert.deepEqual([(await resena(pool, 'g1')).texto, (await resena(pool, 'g2')).autor], [null, null]);
    // …salvo que la persona haya editado su reseña: contenido nuevo, con sus 30 días.
    Object.assign(lista[1], { texto: 'Lo he pensado mejor: muy contenta', nota: 5, actualizadaEn: new Date(t30.getTime() + 2 * DIA).toISOString() });
    const t32 = new Date(t30.getTime() + 2 * DIA + 3600000);
    assert.equal((await S.importarResenas(pool, google, { ahora: t32 })).editadas, 1);
    const g2 = await resena(pool, 'g2');
    assert.deepEqual([g2.texto, g2.autor, g2.nota, g2.contenido_borrado_en, madrid(g2.contenido_leido_en)], ['Lo he pensado mejor: muy contenta', 'Marta', 5, null, madrid(t32)]);
    assert.match(g2.borrador_respuesta, /Marta/);
  } finally {
    await pool.end();
  }
});

test('el historial se contesta poco a poco: 20 al día en la bandeja, variadas, y sus respuestas salen por la cola', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const TEXTOS = ['Trato exquisito', 'Muy profesionales', 'Instalaciones preciosas', 'Resultados muy naturales', '', 'Bien, aunque esperé un poco', 'No me contestaban al teléfono', 'Genial todo'];
  const NOMBRES = ['Ana', 'Luis', 'Marta', 'Pablo', 'Irene', 'Diego', 'Nuria', 'Sergio', 'Alba'];
  const viejas = Array.from({ length: 45 }, (_, i) => ({
    googleId: `h${i + 1}`, autor: `${NOMBRES[i % 9]} ${String.fromCharCode(65 + (i % 26))}.`, nota: [5, 5, 4, 5, 3, 5, 2, 5, 1][i % 9],
    texto: TEXTOS[i % 8] || null, publicadaEn: new Date(Date.UTC(2025, i % 12, 1 + (i % 27), 10)).toISOString(),
  }));
  const google = googleFalso({ resenas: viejas });
  const deps = { pool, whatsapp, google };
  const ahora = en('2026-10-06', '09:00'); // martes
  try {
    await sembrar(pool);
    assert.equal((await S.importarResenas(pool, google, { ahora })).nuevas, 45);
    const [[h]] = await pool.query("SELECT COUNT(*) AS n, SUM(borrador_respuesta IS NULL) AS sin FROM resenas WHERE estado = 'historial'");
    assert.deepEqual([Number(h.n), Number(h.sin)], [45, 45], 'todas al historial, sin borrador todavía');

    assert.deepEqual(await S.liberarHistorial(pool, { ahora }), { liberadas: 20 });
    assert.deepEqual(await S.liberarHistorial(pool, { ahora }), { liberadas: 0 }, 'la bandeja ya tiene sus 20');
    const [bandeja] = await pool.query("SELECT id, nota, borrador_respuesta FROM resenas WHERE historial AND estado = 'borrador' ORDER BY id");
    assert.equal(bandeja.length, 20);
    assert.equal(new Set(bandeja.map((r) => R.huella(r.borrador_respuesta))).size, 20, 'ninguna igual');
    assert.equal(bandeja.filter((r) => r.nota <= 2).length, 10, 'las de 1 y 2 estrellas, primero');

    // Recepción las aprueba todas de golpe: salen de una en una, cada 25 minutos, desde las 10:30.
    const horas = [];
    for (const r of bandeja) {
      const hecho = await S.aprobarYPublicar(pool, google, { resenaId: r.id, aprobadaPor: 'recepcion@iemec', ahora });
      assert.equal(hecho.estado, 'aprobada');
      horas.push(madrid(hecho.publicarEn));
    }
    assert.deepEqual([horas[0], horas[1], horas.at(-1)], ['2026-10-06 10:30', '2026-10-06 10:55', '2026-10-06 18:25']);
    assert.equal(google.publicadas.length, 0, 'nada sale al aprobar');
    // Veinte al día como mucho: la siguiente aprobada, el miércoles.
    assert.deepEqual(await S.liberarHistorial(pool, { ahora }), { liberadas: 20 });
    const [[otra]] = await pool.query("SELECT id FROM resenas WHERE historial AND estado = 'borrador' ORDER BY id LIMIT 1");
    assert.equal(madrid((await S.aprobarYPublicar(pool, google, { resenaId: otra.id, aprobadaPor: 'recepcion@iemec', ahora })).publicarEn), '2026-10-07 10:30');

    // La cola las publica cuando les toca.
    await S.vuelta(deps, { ahora: en('2026-10-06', '10:29') });
    assert.equal(google.publicadas.length, 0);
    await S.vuelta(deps, { ahora: en('2026-10-06', '10:30') });
    assert.equal(google.publicadas.length, 1);
    await S.vuelta(deps, { ahora: en('2026-10-06', '10:54') });
    assert.equal(google.publicadas.length, 1);
    await S.vuelta(deps, { ahora: en('2026-10-06', '10:55') });
    assert.equal(google.publicadas.length, 2);
    for (let i = 0; i < 3; i++) await S.vuelta(deps, { ahora: en('2026-10-06', '19:00') });
    assert.equal(google.publicadas.length, 20, 'las del martes');
    assert.equal(new Set(google.publicadas.map((p) => R.huella(p.texto))).size, 20);
    await S.vuelta(deps, { ahora: en('2026-10-07', '10:30') });
    assert.equal(google.publicadas.length, 21);
    const [[pub]] = await pool.query("SELECT COUNT(*) AS n FROM resenas WHERE historial AND estado = 'publicada' AND primera_respuesta_en IS NOT NULL");
    assert.equal(pub.n, 21);
  } finally {
    await pool.end();
  }
});

test('la tarea diaria va por la cola, una vez al día desde las 8:00: ficha y reseñas de Google, borrado a los 30 días e historial', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const google = googleFalso({
    ficha: { placeId: 'ChIJiemec', newReviewUri: 'https://g.page/r/CEjemploResena/review' },
    resenas: [{ googleId: 'g1', autor: 'Laura G.', nota: 5, texto: 'Trato encantador', publicadaEn: '2026-10-05T15:00:00Z' }],
  });
  const deps = { pool, whatsapp: crearWhatsApp('simulado'), google };
  const trabajos = async () => (await pool.query("SELECT tipo, estado FROM cola WHERE tipo LIKE 'resenas\\_%' ORDER BY id"))[0].map((x) => `${x.tipo}:${x.estado}`);
  try {
    await sembrar(pool);
    await S.vuelta(deps, { ahora: en('2026-10-06', '07:59') });
    assert.deepEqual(await trabajos(), []);
    const r = await S.vuelta(deps, { ahora: en('2026-10-06', '08:00') });
    assert.deepEqual(r.trabajos, { hechos: 3, reintentos: 0, fallidos: 0, aplazados: 0 });
    assert.deepEqual(await trabajos(), ['resenas_google:hecho', 'resenas_purgar:hecho', 'resenas_historial:hecho']);
    assert.equal((await pool.query('SELECT google_enlace_resena AS e FROM clinica'))[0][0].e, 'https://g.page/r/CEjemploResena/review');
    assert.equal((await resena(pool, 'g1')).estado, 'borrador');
    await S.vuelta(deps, { ahora: en('2026-10-06', '12:00') });
    assert.equal((await trabajos()).length, 3, 'una vez al día');

    // Un día que Google falla: lo suyo se reintenta; el borrado y el historial salen igual.
    google.listarResenas = async () => { throw new Error('Google no responde'); };
    const r2 = await S.vuelta(deps, { ahora: en('2026-10-07', '08:00') });
    assert.deepEqual(r2.trabajos, { hechos: 2, reintentos: 1, fallidos: 0, aplazados: 0 });
    const [[fallo]] = await pool.query("SELECT estado, ultimo_error FROM cola WHERE clave_unica = 'resenas_google-2026-10-07'");
    assert.deepEqual({ ...fallo }, { estado: 'pendiente', ultimo_error: 'Google no responde' });
    // Y a los 30 días de leerla, el texto y el autor se borran solos.
    await S.vuelta(deps, { ahora: en('2026-11-05', '08:00') });
    const g1 = await resena(pool, 'g1');
    assert.deepEqual([g1.texto, g1.autor, g1.nota], [null, null, 5]);
  } finally {
    await pool.end();
  }
});

test('las publicaciones del panel: solo lo que se reserva, con las filas tal como salen de la base', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
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

