'use strict';
// Reseñas de Google con la base: se piden a todos (también a quien se ha quejado) con su variante del
// momento y un solo recordatorio; el enlace oficial de la ficha y su clic; la alerta clínica para
// dirección médica; respuestas sin datos personales ni de salud, variadas y con aprobación; la
// moderación de Google; lo que su autor cambia o Google retira; el borrado a los 29 días; el historial
// poco a poco por la cola (sin atascarse); las cifras de lo que salió de verdad; de qué paciente es, y
// la pantalla del panel. Pacientes, reseñas y textos inventados.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { prepararBdDePrueba } = require('./ayuda-bd');
const S = require('../servidor/resenas');
const M = require('../servidor/repesca/motor');
const R = require('../motor/resenas/resenas');
const { rutasPanel } = require('../servidor/rutas/panel');
const { crearApp } = require('../servidor/index');
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

// El enlace de «Tu cita»: hasta la migración 009 la cita guarda su token (`token`); desde la 010
// (privacidad de la cita) guarda su huella (`token_hash`). Estas pruebas valen con las dos.
async function tokenDeCita(pool) {
  const [[c]] = await pool.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'citas' AND COLUMN_NAME = 'token_hash'");
  return Number(c.n) ? ['token_hash', crypto.createHash('sha256').update(crypto.randomUUID()).digest()] : ['token', crypto.randomBytes(32).toString('base64url')];
}

// Una cita de una hora (sin sala: lo de la agenda se prueba aparte).
async function insertarCita(pool, pacienteId, inicio, estado) {
  const fin = new Date(inicio.getTime() + 3600000);
  const [columna, token] = await tokenDeCita(pool);
  const [c] = await pool.query(
    `INSERT INTO citas (paciente_id, tratamiento_id, inicio, fin, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, ${columna})
     VALUES (?, 'limpieza-facial', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [pacienteId, inicio, fin, inicio, new Date(fin.getTime() + 600000), inicio, fin, estado, token]);
  return c.insertId;
}

// Una cita ya completada (recepción la marcó; lo de los estados se prueba aparte).
const citaCompletada = (pool, pacienteId, fecha, hora) => insertarCita(pool, pacienteId, en(fecha, hora), 'completada');

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

// Un adaptador de Google falso con la interfaz del de servidor/integraciones/google.js (listarResenas
// y responderResena) y lo que da el real: el estado de moderación al responder, sus errores (fallo) y,
// si se pide, la ficha con su enlace oficial para reseñar (obtenerFicha). modo 'real' para lo que solo
// se hace con el adaptador real (vueltaGoogle). No sale nada a internet.
function googleFalso({ resenas = [], ficha = null, estado = 'PENDING', modo = 'simulado', capacidades = undefined } = {}) {
  const publicadas = [];
  return {
    modo,
    publicadas,
    llamadas: 0,
    fallo: null,
    ...(capacidades ? { capacidades } : {}),
    async listarResenas() { return resenas; },
    async responderResena(googleId, texto) {
      this.llamadas++;
      if (this.fallo) throw this.fallo;
      publicadas.push({ googleId, texto });
      return { ok: true, estado };
    },
    ...(ficha ? { async obtenerFicha() { return ficha; } } : {}),
  };
}
// Un error de Google como los del adaptador real (servidor/integraciones/llamadas.js): estado HTTP y si
// tiene arreglo reintentando.
const errorGoogle = (mensaje, { estado = 500, permanente = false } = {}) => Object.assign(new Error(mensaje), { estado, permanente });
const vueltas = async (fn, desde, minutos, veces) => { for (let i = 0; i < veces; i++) await fn(new Date(desde.getTime() + i * minutos * 60000)); };

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
    const reserva = 'https://search.google.com/local/writereview?placeid=ChIJiemec';
    assert.equal(await S.abrirEnlace(pool, 'noexiste00000000000000', null), reserva);
    assert.deepEqual(await S.actualizarFicha(pool, null), { leida: false }, 'sin ficha (el adaptador aún no la da)');

    // La ficha de Business Profile (lo que da obtenerFicha): su newReviewUri se guarda con su fecha. (Con
    // la hora de ahora: la ruta pública de abajo mira el reloj.)
    const oficial = 'https://g.page/r/CEjemploResena/review';
    const leida = new Date();
    const tras = (dias) => new Date(leida.getTime() + dias * DIA);
    assert.deepEqual(await S.actualizarFicha(pool, { origen: 'perfil', placeId: 'ChIJotro0000000', newReviewUri: oficial }, { ahora: leida }), { leida: true, enlace: true });
    const [[cl]] = await pool.query('SELECT google_enlace_resena, google_place_id, google_ficha_leida_en FROM clinica');
    assert.deepEqual([cl.google_enlace_resena, cl.google_place_id], [oficial, 'ChIJiemec'], 'el place_id que ya había no se toca');
    assert.equal(await S.abrirEnlace(pool, token, 'ChIJiemec', tras(0.1)), oficial);
    assert.equal(await S.abrirEnlace(pool, token, 'ChIJiemec', tras(31)), reserva, 'pasados 30 días ya no vale');
    assert.equal(madrid((await peticion(pool, c)).pulsada_en), madrid(tras(0.1)), 'cuenta el primer clic');
    // Y a los 29 días se borra, con el resto de lo que viene de Google.
    await S.purgarContenido(pool, { ahora: tras(28.9) });
    assert.equal((await pool.query('SELECT google_enlace_resena AS e FROM clinica'))[0][0].e, oficial);
    await S.purgarContenido(pool, { ahora: tras(29) });
    assert.equal((await pool.query('SELECT google_enlace_resena AS e FROM clinica'))[0][0].e, null);

    // El de Places (writeAReviewUri) no se guarda: de Places solo se puede guardar el place_id.
    assert.deepEqual(await S.actualizarFicha(pool, { origen: 'places', placeId: 'ChIJiemec0000', newReviewUri: 'https://www.google.com/maps/place//data=!4m3!3m2' }, { ahora: leida }),
      { leida: true, enlace: false });
    assert.equal((await pool.query('SELECT google_enlace_resena AS e FROM clinica'))[0][0].e, null);
    // Uno que no es de Google tampoco; y una ficha sin enlace quita el de antes.
    await S.actualizarFicha(pool, { placeId: 'ChIJiemec', newReviewUri: oficial }, { ahora: leida });
    await S.actualizarFicha(pool, { placeId: 'ChIJiemec', newReviewUri: 'https://google.abc.io/opina' }, { ahora: leida });
    assert.equal((await pool.query('SELECT google_enlace_resena AS e FROM clinica'))[0][0].e, null);
    await S.actualizarFicha(pool, { placeId: 'ChIJiemec', newReviewUri: oficial }, { ahora: leida });

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
    { googleId: 'g4', autor: 'Marta', nota: 5, texto: 'Tuve una complicación, pero me la resolvieron enseguida', publicadaEn: '2025-01-10T10:00:00Z', respuesta: '¡Gracias, Marta!', respondidaEn: '2025-01-11T10:00:00Z' },
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
      await assert.rejects(aprobar(g1, '¡Gracias, Laura! Maribel te manda un abrazo.'), /equipo \(«Maribel»\)/);
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
      // La sesión, como la pondría el panel: el rol de quien aprueba (cabecera de la prueba; vacía, sin rol).
      app.use((req, _res, next) => {
        const rol = req.get('x-rol');
        req.ahora = new Date(ahora.getTime() + 3 * 3600000);
        req.usuario = { email: 'prueba@ejemplo.invalid', rol: rol === undefined ? 'direccion' : rol || null };
        next();
      });
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
        // La alerta clínica la contesta dirección médica (dirección o médico): ni marketing, ni
        // administración, ni nadie sin rol (falla cerrado). La pantalla lo sabe y no enseña el botón.
        const comoRol = async (rol) => (await (await fetch(base, { headers: { 'x-rol': rol } })).json()).resenas.find((x) => x.id === g3.id).puedeContestar;
        assert.deepEqual([await comoRol('direccion'), await comoRol('medico'), await comoRol('marketing'), await comoRol('admin'), await comoRol('')], [true, true, false, false, false]);
        assert.equal(d.resenas.find((x) => x.id !== g3.id && !x.alerta).puedeContestar, true, 'las demás, cualquiera');
        for (const rol of ['marketing', 'admin', 'recepcion', '']) {
          const no = await fetch(`${base}/${g3.id}/publicar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-rol': rol }, body: JSON.stringify({}) });
          assert.equal(no.status, 400, rol);
          assert.match((await no.json()).error, /alerta clínica: la contesta dirección médica/, rol);
        }
        await assert.rejects(S.aprobarYPublicar(pool, google, { resenaId: g3.id, aprobadaPor: 'x', ahora }), /alerta clínica/, 'sin rol, tampoco llamándolo directamente');
        const bien = await fetch(`${base}/${g3.id}/publicar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-rol': 'medico' }, body: JSON.stringify({}) });
        assert.deepEqual(await bien.json(), { ok: true, estado: 'publicada', avisos: [] });
      } finally {
        s.close();
      }
    });
  } finally {
    await pool.end();
  }
});

test('a los 29 días se borran el texto y el autor; se quedan el id, las estrellas, las fechas, los estados y nuestras respuestas', async (t) => {
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

    assert.deepEqual(await S.purgarContenido(pool, { ahora: new Date(t0.getTime() + 29 * DIA - 60000) }), { borradas: 0 });
    const t29 = new Date(t0.getTime() + 29 * DIA);
    assert.deepEqual(await S.purgarContenido(pool, { ahora: t29 }), { borradas: 2 });
    const [a, b] = [await resena(pool, 'g1'), await resena(pool, 'g2')];
    for (const r of [a, b]) {
      assert.deepEqual([r.texto, r.autor, r.temas], [null, null, null]);
      assert.equal(madrid(r.contenido_borrado_en), madrid(t29));
      assert.equal(r.con_texto, 1, 'se sabe que tenía texto');
    }
    // Se quedan el id, las estrellas, las fechas, los estados y nuestra respuesta (con su saludo).
    assert.deepEqual([a.google_id, a.nota, a.estado, a.respuesta, madrid(a.publicada_en), madrid(a.primera_respuesta_en)],
      ['g1', 5, 'publicada', g1.borrador_respuesta, '2026-10-07 17:00', '2026-10-08 11:00']);
    // El borrador que aún no se ha aprobado llevaba su nombre: ahora, otro sin nada de la reseña.
    assert.equal(b.estado, 'borrador');
    assert.doesNotMatch(b.borrador_respuesta, /Marta|espera/i);
    assert.deepEqual(await S.purgarContenido(pool, { ahora: new Date(t29.getTime() + DIA) }), { borradas: 0 });

    // Volver a leerlas de Google no vuelve a guardar lo borrado…
    await S.importarResenas(pool, google, { ahora: new Date(t29.getTime() + DIA) });
    assert.deepEqual([(await resena(pool, 'g1')).texto, (await resena(pool, 'g2')).autor], [null, null]);
    // …salvo que la persona haya editado su reseña: contenido nuevo, con sus días.
    Object.assign(lista[1], { texto: 'Lo he pensado mejor: muy contenta', nota: 5, actualizadaEn: new Date(t29.getTime() + 2 * DIA).toISOString() });
    const t31 = new Date(t29.getTime() + 2 * DIA + 3600000);
    assert.equal((await S.importarResenas(pool, google, { ahora: t31 })).editadas, 1);
    const g2 = await resena(pool, 'g2');
    assert.deepEqual([g2.texto, g2.autor, g2.nota, g2.contenido_borrado_en, madrid(g2.contenido_leido_en)], ['Lo he pensado mejor: muy contenta', 'Marta', 5, null, madrid(t31)]);
    assert.match(g2.borrador_respuesta, /Marta/);
  } finally {
    await pool.end();
  }
});

test('el borrado va en cada vuelta del cron: lo leído a cualquier hora (un reintento, un aviso de Pub/Sub) nunca pasa de 30 días', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const deps = { pool, whatsapp: crearWhatsApp('simulado') };
  try {
    await sembrar(pool);
    // Google falla a las 8:00, la cola lo reintenta y la reseña se lee a las 8:01; otra llega por un
    // aviso a las 14:00.
    const leer = (googleId, ahora) => S.importarResenas(pool, googleFalso({ resenas: [{ googleId, autor: 'Laura G.', nota: 5, texto: 'Trato encantador', publicadaEn: '2026-08-31T10:00:00Z' }] }), { ahora });
    await leer('p1', en('2026-09-01', '08:01'));
    await leer('p2', en('2026-09-01', '14:00'));
    const guardado = async (id) => Boolean((await resena(pool, id)).texto);
    // El día 29, a la vuelta de cada minuto: sigue hasta que cumple 29 días, y ni un minuto más.
    await S.vuelta(deps, { ahora: en('2026-09-30', '08:00') });
    assert.deepEqual([await guardado('p1'), await guardado('p2')], [true, true]);
    await S.vuelta(deps, { ahora: en('2026-09-30', '08:01') });
    assert.deepEqual([await guardado('p1'), await guardado('p2')], [false, true]);
    await S.vuelta(deps, { ahora: en('2026-09-30', '14:00') });
    assert.deepEqual([await guardado('p1'), await guardado('p2')], [false, false]);
    for (const id of ['p1', 'p2']) {
      const r = await resena(pool, id);
      assert.ok(new Date(r.contenido_borrado_en) - new Date(r.contenido_leido_en) < 30 * DIA, id);
    }
    // Aunque el cron se pare casi un día, tampoco pasa de 30.
    await leer('p3', en('2026-09-02', '12:00'));
    await S.vuelta(deps, { ahora: en('2026-10-02', '11:00') });
    const p3 = await resena(pool, 'p3');
    assert.equal(p3.texto, null);
    assert.ok(new Date(p3.contenido_borrado_en) - new Date(p3.contenido_leido_en) < 30 * DIA);
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

    // La vuelta de cada minuto no llama a Google, y con el adaptador simulado no se publica nada.
    await S.vuelta(deps, { ahora: en('2026-10-06', '10:30') });
    assert.equal(await S.vueltaGoogle(deps, { ahora: en('2026-10-06', '10:30') }), null);
    assert.equal(google.llamadas, 0);
    // Con el real, la cola las publica cuando les toca (en la vuelta de Google, con su tiempo tasado).
    google.modo = 'real';
    await S.vueltaGoogle(deps, { ahora: en('2026-10-06', '10:29') });
    assert.equal(google.publicadas.length, 0);
    await S.vueltaGoogle(deps, { ahora: en('2026-10-06', '10:30') });
    assert.equal(google.publicadas.length, 1);
    await S.vueltaGoogle(deps, { ahora: en('2026-10-06', '10:54') });
    assert.equal(google.publicadas.length, 1);
    await S.vueltaGoogle(deps, { ahora: en('2026-10-06', '10:55') });
    assert.equal(google.publicadas.length, 2);
    assert.deepEqual(await S.vueltaGoogle(deps, { ahora: en('2026-10-06', '19:00'), cortarEn: Date.now() }), { hechos: 0, reintentos: 0, fallidos: 0, aplazados: 5 },
      'sin tiempo, no empieza ninguna (quedan para la siguiente)');
    for (let i = 0; i < 4; i++) await S.vueltaGoogle(deps, { ahora: en('2026-10-06', '19:00') });
    assert.equal(google.publicadas.length, 20, 'las del martes');
    assert.equal(new Set(google.publicadas.map((p) => R.huella(p.texto))).size, 20);
    await S.vueltaGoogle(deps, { ahora: en('2026-10-07', '10:30') });
    assert.equal(google.publicadas.length, 21);
    const [[pub]] = await pool.query("SELECT COUNT(*) AS n FROM resenas WHERE historial AND estado = 'publicada' AND primera_respuesta_en IS NOT NULL");
    assert.equal(pub.n, 21);
  } finally {
    await pool.end();
  }
});

test('cada minuto, solo la base: el historial del día por la cola, una vez al día desde las 8:00; lo de Google, aparte y solo con el adaptador real', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const oficial = 'https://g.page/r/CEjemploResena/review';
  // Un adaptador que falla si alguien le pide las reseñas: la vuelta de cada minuto no le llama nunca
  // (las reseñas las trae la sincronización de la ficha de Google, con su candado).
  const google = googleFalso({ ficha: { origen: 'perfil', placeId: 'ChIJiemec', newReviewUri: oficial } });
  google.listarResenas = async () => { throw new Error('la vuelta de cada minuto no llama a Google'); };
  const deps = { pool, whatsapp: crearWhatsApp('simulado'), google };
  const trabajos = async () => (await pool.query("SELECT tipo, estado FROM cola WHERE tipo LIKE 'resenas\\_%' ORDER BY id"))[0].map((x) => `${x.tipo}:${x.estado}`);
  try {
    await sembrar(pool);
    await S.vuelta(deps, { ahora: en('2026-10-06', '07:59') });
    assert.deepEqual(await trabajos(), []);
    const r = await S.vuelta(deps, { ahora: en('2026-10-06', '08:00') });
    assert.deepEqual(r, { recordatorios: 0, borradas: 0, trabajos: { hechos: 1, reintentos: 0, fallidos: 0, aplazados: 0 } });
    assert.deepEqual(await trabajos(), ['resenas_historial:hecho']);
    await S.vuelta(deps, { ahora: en('2026-10-06', '12:00') });
    assert.equal((await trabajos()).length, 1, 'una vez al día');
    assert.equal(google.llamadas, 0);

    // Lo de Google: con el adaptador simulado, nada (ni se lee la ficha ni se publica).
    assert.equal(await S.vueltaGoogle(deps, { ahora: en('2026-10-06', '12:00') }), null);
    assert.equal(await S.vueltaGoogle({ pool }, { ahora: en('2026-10-06', '12:00') }), null, 'ni sin adaptador');
    // Con el real: el enlace de la ficha, una vez al día desde las 8:00.
    google.modo = 'real';
    assert.deepEqual(await S.vueltaGoogle(deps, { ahora: en('2026-10-06', '12:00') }), { hechos: 1, reintentos: 0, fallidos: 0, aplazados: 0 });
    assert.equal((await pool.query('SELECT google_enlace_resena AS e FROM clinica'))[0][0].e, oficial);
    await S.vueltaGoogle(deps, { ahora: en('2026-10-06', '12:01') });
    assert.deepEqual(await trabajos(), ['resenas_historial:hecho', 'resenas_ficha:hecho']);
    // Solo con Places (sin Business Profile): ni la ficha (su enlace no se puede guardar) ni publicar.
    const soloPlaces = { ...google, capacidades: { perfil: false, ficha: false, places: true } };
    assert.deepEqual(await S.vueltaGoogle({ pool, google: soloPlaces }, { ahora: en('2026-10-07', '12:00') }), { sinPerfil: true });
    assert.deepEqual(await trabajos(), ['resenas_historial:hecho', 'resenas_ficha:hecho']);
  } finally {
    await pool.end();
  }
});

test('el historial de días seguidos sale variado: los 20 borradores de cada día se aprueban sin una sola «repetida»', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  // Lo más habitual en la ficha: 5 estrellas que hablan del trato.
  const NOMBRES = ['Ana', 'Luis', 'Marta', 'Pablo', 'Irene', 'Diego', 'Nuria', 'Sergio', 'Alba', 'Rosa'];
  const viejas = Array.from({ length: 60 }, (_, i) => ({
    googleId: `v${i + 1}`, autor: `${NOMBRES[i % 10]} ${String.fromCharCode(65 + (i % 26))}.`, nota: 5,
    texto: ['Trato exquisito', 'Un trato muy cercano', 'Muy amables todos'][i % 3], publicadaEn: new Date(Date.UTC(2025, i % 12, 1 + (i % 27), 10)).toISOString(),
  }));
  const google = googleFalso({ resenas: viejas, modo: 'real' });
  const deps = { pool, whatsapp: crearWhatsApp('simulado'), google };
  try {
    await sembrar(pool);
    await S.importarResenas(pool, google, { ahora: en('2026-10-05', '09:00') });
    const repetidas = [];
    for (const dia of ['2026-10-06', '2026-10-07', '2026-10-08']) {
      assert.deepEqual(await S.liberarHistorial(pool, { ahora: en(dia, '09:00') }), { liberadas: 20 }, dia);
      const [bandeja] = await pool.query("SELECT id FROM resenas WHERE historial AND estado = 'borrador' ORDER BY id");
      for (const r of bandeja) {
        try {
          await S.aprobarYPublicar(pool, google, { resenaId: r.id, aprobadaPor: 'recepcion@iemec', ahora: en(dia, '09:30') });
        } catch (err) {
          repetidas.push(`${dia}: ${err.message}`);
        }
      }
      await vueltas((ahora) => S.vueltaGoogle(deps, { ahora }), en(dia, '10:30'), 25, 20);
    }
    assert.deepEqual(repetidas, [], 'ninguna rechazada por repetida');
    assert.equal(google.publicadas.length, 60);
    assert.equal(new Set(google.publicadas.map((p) => R.huella(p.texto))).size, 60, 'las 60, distintas');
  } finally {
    await pool.end();
  }
});

test('las cifras solo cuentan las peticiones que salieron: las fallidas, aparte y con su motivo', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool, { momentos: '2h' });
    // Es lo que pasa al desplegar si Meta aún no ha aprobado la plantilla nueva: la antigua, sin la baja.
    await pool.query("UPDATE plantillas SET cuerpo = 'Hola {{1}}, gracias por tu visita a IEMEC. ¿Nos cuentas qué tal tu experiencia? Tu opinión en Google nos ayuda mucho.' WHERE uso = 'resena'");
    for (const nombre of ['Ana', 'Bea', 'Carla', 'Dani']) await S.programarPeticion(pool, await citaCompletada(pool, (await paciente(pool, nombre)).id, '2026-10-06', '11:00'));
    await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-06', '14:00') });
    assert.equal(whatsapp.enviados.length, 0);
    const [filas] = await pool.query('SELECT estado, enviada_en FROM peticiones_resena');
    assert.deepEqual(filas.map((f) => [f.estado, f.enviada_en]), Array(4).fill(['fallida', null]), 'sin fecha de envío: no salieron');
    let d = await S.datosPanel(pool, { ahora: en('2026-10-07', '10:00') });
    assert.deepEqual([d.metricas.peticiones.enviadas, d.metricas.peticiones.porCada100], [0, null]);
    assert.deepEqual(d.metricas.variantes.map((v) => v.enviadas), [0, 0, 0], 'la prueba del momento, sin envíos que no llegaron');
    assert.equal(d.peticionesFallidas.n, 4);
    assert.match(d.peticionesFallidas.motivo, /no cumple las normas de Google/);

    // Con la plantilla buena salen; si WhatsApp no acepta el recordatorio, no cuenta como recordatorio.
    await pool.query('UPDATE plantillas SET cuerpo = ? WHERE uso = ?', [BIBLIOTECA.find((p) => p.uso === 'resena').cuerpo, 'resena']);
    const eva = await paciente(pool, 'Eva');
    const ce = await citaCompletada(pool, eva.id, '2026-10-07', '11:00');
    await S.programarPeticion(pool, ce);
    await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-07', '14:00') });
    const enviarPlantilla = whatsapp.enviarPlantilla;
    whatsapp.enviarPlantilla = async () => { throw new Error('131026: mensaje no entregable'); };
    await S.enviarRecordatorios(deps, { ahora: en('2026-10-14', '14:00') });
    whatsapp.enviarPlantilla = enviarPlantilla;
    const pe = await peticion(pool, ce);
    assert.deepEqual([pe.estado, pe.recordatorio_estado, pe.recordatorio_enviado_en, pe.recordatorio_motivo], ['enviada', 'fallido', null, 'WhatsApp no lo aceptó']);
    await S.abrirEnlace(pool, pe.token, null, en('2026-10-14', '18:00'));
    d = await S.datosPanel(pool, { ahora: en('2026-10-15', '10:00') });
    assert.deepEqual([d.metricas.peticiones.enviadas, d.metricas.peticiones.abiertas, d.metricas.peticiones.recordatorios, d.metricas.peticiones.abiertasTrasRecordatorio], [1, 1, 0, 0]);
    // Y si WhatsApp no acepta la petición, tampoco es un envío.
    const fran = await paciente(pool, 'Fran');
    const cf = await citaCompletada(pool, fran.id, '2026-10-08', '11:00');
    await S.programarPeticion(pool, cf);
    whatsapp.enviarPlantilla = async () => { throw new Error('131026: mensaje no entregable'); };
    await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-08', '14:00') });
    whatsapp.enviarPlantilla = enviarPlantilla;
    assert.deepEqual([(await peticion(pool, cf)).estado, (await peticion(pool, cf)).enviada_en], ['fallida', null]);
    d = await S.datosPanel(pool, { ahora: en('2026-10-15', '10:00') });
    assert.deepEqual([d.metricas.peticiones.enviadas, d.peticionesFallidas.n, d.peticionesFallidas.motivo], [1, 5, 'WhatsApp no lo aceptó']);
  } finally {
    await pool.end();
  }
});

test('una respuesta del historial aprobada nunca se queda atascada: Google falla → se reintenta → vuelve a la bandeja', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const google = googleFalso({
    modo: 'real',
    resenas: ['Luis', 'Marta', 'Pablo', 'Irene'].map((autor, i) => ({ googleId: `h${i + 1}`, autor, nota: 5, texto: 'Muy profesionales', publicadaEn: `2025-0${i + 2}-10T10:00:00Z` })),
  });
  const deps = { pool, whatsapp: crearWhatsApp('simulado'), google };
  const ahora = en('2026-10-06', '09:00');
  const cola = async (id) => (await pool.query("SELECT estado, intentos FROM cola WHERE tipo = 'resenas_publicar' AND JSON_VALUE(carga, '$.resenaId') = ? ORDER BY id DESC LIMIT 1", [id]))[0][0];
  try {
    await sembrar(pool);
    await S.importarResenas(pool, google, { ahora });
    await S.liberarHistorial(pool, { ahora });
    const [[h1], [h2]] = [await pool.query("SELECT * FROM resenas WHERE google_id = 'h1'"), await pool.query("SELECT * FROM resenas WHERE google_id = 'h2'")].map((x) => x[0]);
    await S.aprobarYPublicar(pool, google, { resenaId: h1.id, aprobadaPor: 'recepcion@iemec', ahora });

    // El token de refresco caduca: la cola lo reintenta (1, 2, 4 y 8 minutos) y en el último intento
    // vuelve a la bandeja con su texto y el motivo, para aprobarla otra vez.
    google.fallo = errorGoogle('Google: el token de refresco ha caducado');
    await vueltas((m) => S.vueltaGoogle(deps, { ahora: m }), en('2026-10-06', '10:30'), 5, 12);
    assert.deepEqual({ ...(await cola(h1.id)) }, { estado: 'fallido', intentos: 5 });
    let r = await resena(pool, 'h1');
    assert.deepEqual([r.estado, r.respuesta, r.publicar_en], ['borrador', null, null]);
    assert.equal(r.borrador_respuesta, h1.borrador_respuesta, 'con el texto que se aprobó');
    assert.match(r.error_publicar, /token de refresco ha caducado/);
    let d = await S.datosPanel(pool, { ahora: en('2026-10-06', '12:00') });
    assert.deepEqual(d.resenas.filter((x) => x.id === h1.id).map((x) => [x.estado, x.historial, x.errorPublicar !== null]), [['borrador', true, true]], 'en la bandeja, con el motivo');
    // Google vuelve: se aprueba otra vez y sale.
    google.fallo = null;
    assert.equal((await S.aprobarYPublicar(pool, google, { resenaId: h1.id, aprobadaPor: 'recepcion@iemec', ahora: en('2026-10-06', '12:00') })).estado, 'aprobada');
    await vueltas((m) => S.vueltaGoogle(deps, { ahora: m }), en('2026-10-06', '12:00'), 30, 2);
    assert.deepEqual([(await resena(pool, 'h1')).estado, google.publicadas.length], ['publicada', 1]);

    // Un error sin arreglo (p. ej., la respuesta no cabe) no espera a los reintentos. Mientras, la
    // pantalla deja volver a aprobarla (con otro texto): la aprobada con error se puede reintentar.
    await S.aprobarYPublicar(pool, google, { resenaId: h2.id, aprobadaPor: 'recepcion@iemec', ahora: en('2026-10-06', '13:00') });
    const [[h2a]] = await pool.query('SELECT publicar_en FROM resenas WHERE id = ?', [h2.id]);
    google.fallo = errorGoogle('Google 503 Service Unavailable');
    await S.vueltaGoogle(deps, { ahora: new Date(h2a.publicar_en) });
    d = await S.datosPanel(pool, { ahora: new Date(h2a.publicar_en) });
    assert.deepEqual(d.resenas.filter((x) => x.id === h2.id).map((x) => [x.estado, x.reintentar]), [['aprobada', true]]);
    google.fallo = errorGoogle('La respuesta ocupa 5000 bytes y Google admite 4096', { estado: 400, permanente: true });
    await S.vueltaGoogle(deps, { ahora: new Date(new Date(h2a.publicar_en).getTime() + 60000) });
    assert.deepEqual([(await resena(pool, 'h2')).estado, (await cola(h2.id)).estado], ['borrador', 'hecho'], 'a la bandeja ya, sin reintentos');
    assert.match((await resena(pool, 'h2')).error_publicar, /4096/);

    // Sin Google real conectado no se publica nada: la aprobada que un día después no ha salido vuelve
    // a la bandeja con la tarea del historial del día.
    google.fallo = null;
    const [[h3]] = await pool.query("SELECT id FROM resenas WHERE google_id = 'h3'");
    await S.aprobarYPublicar(pool, google, { resenaId: h3.id, aprobadaPor: 'recepcion@iemec', ahora: en('2026-10-06', '14:00') });
    google.modo = 'simulado';
    await vueltas((m) => S.vueltaGoogle(deps, { ahora: m }), en('2026-10-06', '14:00'), 60, 6);
    await S.vuelta(deps, { ahora: en('2026-10-07', '08:00') });
    assert.equal((await resena(pool, 'h3')).estado, 'aprobada', 'aún no ha pasado un día');
    await S.vuelta(deps, { ahora: en('2026-10-08', '08:00') });
    r = await resena(pool, 'h3');
    assert.deepEqual([r.estado, r.respuesta], ['borrador', null]);
    assert.match(r.error_publicar, /No salió a su hora/);
  } finally {
    await pool.end();
  }
});

test('si la persona cambia su reseña después de contestarla, vuelve a la bandeja; la respuesta nueva sustituye a la de antes', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const lista = [
    { googleId: 'e1', autor: 'Laura G.', nota: 5, texto: 'Genial, trato encantador', publicadaEn: '2026-10-06T10:00:00Z', actualizadaEn: '2026-10-06T10:00:00Z' },
    { googleId: 'e2', autor: 'Pedro', nota: 5, texto: 'Muy profesionales', publicadaEn: '2026-10-06T11:00:00Z', actualizadaEn: '2026-10-06T11:00:00Z' },
  ];
  const google = googleFalso({ resenas: lista });
  try {
    await sembrar(pool);
    await S.importarResenas(pool, google, { ahora: en('2026-10-06', '14:00') });
    for (const id of ['e1', 'e2']) await S.aprobarYPublicar(pool, google, { resenaId: (await resena(pool, id)).id, aprobadaPor: 'recepcion@iemec', ahora: en('2026-10-06', '14:05') });
    const antes = await resena(pool, 'e1');
    // Tres días después la cambia a 1 estrella y cuenta una complicación.
    Object.assign(lista[0], { nota: 1, texto: 'Se me infectó la zona y acabé en urgencias', actualizadaEn: '2026-10-09T09:00:00Z', respuesta: antes.respuesta, respondidaEn: '2026-10-06T12:05:00Z', estadoRespuesta: 'APPROVED' });
    // Y Pedro solo corrige una letra: sigue como estaba.
    Object.assign(lista[1], { texto: 'Muy profesionales.', actualizadaEn: '2026-10-09T09:30:00Z', respuesta: (await resena(pool, 'e2')).respuesta, estadoRespuesta: 'APPROVED' });
    assert.deepEqual(await S.importarResenas(pool, google, { ahora: en('2026-10-09', '13:00') }), { leidas: 2, nuevas: 0, editadas: 2, alertas: 1, rechazadas: 0 });
    let e1 = await resena(pool, 'e1');
    assert.deepEqual([e1.estado, e1.nota, e1.alerta_clinica, e1.historial, e1.respuesta], ['borrador', 1, 1, 0, antes.respuesta], 'a la bandeja; la de antes sigue en Google');
    assert.match(e1.borrador_respuesta, /en privado/, 'con un borrador nuevo: que llame');
    assert.equal((await resena(pool, 'e2')).estado, 'publicada');
    // Leerla otra vez no la da por contestada con la respuesta de antes.
    await S.importarResenas(pool, google, { ahora: en('2026-10-09', '13:30') });
    assert.equal((await resena(pool, 'e1')).estado, 'borrador');
    // En el panel: con alerta, arriba, y con la respuesta de antes a la vista; sigue contando como contestada.
    const d = await S.datosPanel(pool, { ahora: en('2026-10-09', '14:00'), rol: 'medico' });
    const tarjeta = d.resenas[0];
    assert.deepEqual([tarjeta.id, tarjeta.alertaAbierta, tarjeta.estado, tarjeta.respuestaPublica, tarjeta.respuesta, tarjeta.puedeContestar], [e1.id, true, 'borrador', true, antes.respuesta, true]);
    assert.deepEqual([d.metricas.tasaRespuesta, d.metricas.porResponder], [100, 1]);
    // Dirección médica aprueba otra: sustituye a la de antes (la API la cambia) y la primera respuesta no se mueve.
    await assert.rejects(S.aprobarYPublicar(pool, google, { resenaId: e1.id, aprobadaPor: 'marketing@iemec', rol: 'marketing', ahora: en('2026-10-09', '14:00') }), /alerta clínica/);
    await S.aprobarYPublicar(pool, google, { resenaId: e1.id, aprobadaPor: 'direccion@iemec', rol: 'direccion', ahora: en('2026-10-09', '14:10') });
    e1 = await resena(pool, 'e1');
    assert.deepEqual([e1.estado, e1.respuesta, madrid(e1.primera_respuesta_en), madrid(e1.respondida_en)], ['publicada', e1.borrador_respuesta, '2026-10-06 14:05', '2026-10-09 14:10']);
    assert.deepEqual(google.publicadas.map((p) => p.googleId), ['e1', 'e2', 'e1']);
    // Si alguien cambia nuestra respuesta desde la ficha, se guarda la que se ve en Google.
    Object.assign(lista[0], { respuesta: 'Hola Laura, llámanos al 722 83 32 85 y lo vemos en privado.', respondidaEn: '2026-10-09T15:00:00Z' });
    await S.importarResenas(pool, google, { ahora: en('2026-10-09', '18:00') });
    e1 = await resena(pool, 'e1');
    assert.deepEqual([e1.estado, e1.respuesta, madrid(e1.respondida_en)], ['publicada', 'Hola Laura, llámanos al 722 83 32 85 y lo vemos en privado.', '2026-10-09 17:00']);
  } finally {
    await pool.end();
  }
});

test('una reseña que Google da con milisegundos no es «editada» al volver a leerla: su texto se borra a los 29 días y no vuelve', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const deps = { pool, whatsapp: crearWhatsApp('simulado') };
  // Como las da el adaptador real: createTime y updateTime en RFC 3339 con fracción (toISOString la
  // conserva). La columna actualizada_en no tiene fracción.
  const lista = [
    { googleId: 'ms1', autor: 'Laura G.', nota: 5, texto: 'Trato encantador', publicadaEn: '2026-10-07T15:00:00.387Z', actualizadaEn: '2026-10-07T15:00:00.387Z' },
    { googleId: 'ms2', autor: 'Marta', nota: 4, texto: 'Muy profesionales', publicadaEn: '2026-10-07T16:20:31.999Z', actualizadaEn: '2026-10-07T16:25:07.614Z' },
  ];
  const google = googleFalso({ resenas: lista });
  const t0 = en('2026-10-08', '08:00');
  try {
    await sembrar(pool);
    assert.deepEqual(await S.importarResenas(pool, google, { ahora: t0 }), { leidas: 2, nuevas: 2, editadas: 0, alertas: 0, rechazadas: 0 });
    const antes = await resena(pool, 'ms1');
    assert.equal(new Date(antes.actualizada_en).toISOString(), '2026-10-07T15:00:00.000Z', 'guardada al segundo');
    // Cada día, la lectura de las reseñas de la ficha y las vueltas del cron (con su borrado).
    for (let dia = 1; dia <= 35; dia++) {
      const ahora = new Date(t0.getTime() + dia * DIA);
      assert.equal((await S.importarResenas(pool, google, { ahora })).editadas, 0, `día ${dia}: sin cambios en Google no es una edición`);
      await S.vuelta(deps, { ahora });
      const g = await resena(pool, 'ms1');
      if (dia < 29) {
        assert.deepEqual([g.texto, g.autor, g.borrador_respuesta, madrid(g.contenido_leido_en)], [antes.texto, antes.autor, antes.borrador_respuesta, madrid(t0)], `día ${dia}`);
      } else {
        assert.deepEqual([g.texto, g.autor, Boolean(g.contenido_borrado_en)], [null, null, true], `día ${dia}: borrado, y leerla otra vez no lo devuelve`);
      }
    }
    // Una edición de verdad (otro updateTime, también con milisegundos) sí es contenido nuevo, una vez.
    Object.assign(lista[1], { texto: 'Muy profesionales, repetiré', actualizadaEn: '2026-11-13T09:30:00.120Z' });
    const ahora = en('2026-11-13', '11:00');
    assert.equal((await S.importarResenas(pool, google, { ahora })).editadas, 1);
    assert.equal((await S.importarResenas(pool, google, { ahora: new Date(ahora.getTime() + DIA) })).editadas, 0);
    const m = await resena(pool, 'ms2');
    assert.deepEqual([m.texto, m.autor, madrid(m.contenido_leido_en)], ['Muy profesionales, repetiré', 'Marta', madrid(ahora)]);
  } finally {
    await pool.end();
  }
});

test('una respuesta del historial aprobada no sale si la reseña cambia antes: vuelve a la bandeja, y si es una alerta clínica la contesta dirección médica', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const lista = [
    { googleId: 'c1', autor: 'Laura G.', nota: 5, texto: 'Todo genial', publicadaEn: '2025-05-10T10:00:00Z', actualizadaEn: '2025-05-10T10:00:00.250Z' },
    { googleId: 'c2', autor: 'Pedro', nota: 5, texto: 'Muy profesionales', publicadaEn: '2025-05-11T10:00:00Z', actualizadaEn: '2025-05-11T10:00:00.750Z' },
  ];
  const google = googleFalso({ resenas: lista, modo: 'real' });
  const deps = { pool, whatsapp: crearWhatsApp('simulado'), google };
  const ahora = en('2026-10-06', '09:00');
  try {
    await sembrar(pool);
    await S.importarResenas(pool, google, { ahora });
    assert.deepEqual(await S.liberarHistorial(pool, { ahora }), { liberadas: 2 });
    for (const id of ['c1', 'c2']) {
      const r = await resena(pool, id);
      assert.equal((await S.aprobarYPublicar(pool, google, { resenaId: r.id, aprobadaPor: 'marketing@iemec', rol: 'marketing', ahora })).estado, 'aprobada');
    }
    // Antes de que salgan, Laura la cambia (1 estrella y una complicación) y Pedro solo le pone un punto:
    // lo aprobado era para lo que decían antes.
    Object.assign(lista[0], { nota: 1, texto: 'Se me infectó la zona y acabé en urgencias', actualizadaEn: '2026-10-06T07:30:00.900Z' });
    Object.assign(lista[1], { texto: 'Muy profesionales.', actualizadaEn: '2026-10-06T07:31:00.100Z' });
    assert.deepEqual(await S.importarResenas(pool, google, { ahora: en('2026-10-06', '10:00') }), { leidas: 2, nuevas: 0, editadas: 2, alertas: 1, rechazadas: 0 });
    const [c1, c2] = [await resena(pool, 'c1'), await resena(pool, 'c2')];
    for (const r of [c1, c2]) assert.deepEqual([r.estado, r.respuesta, r.publicar_en, r.historial], ['borrador', null, null, 0], r.google_id);
    assert.deepEqual([c1.alerta_clinica, c1.nota], [1, 1]);
    assert.match(c1.borrador_respuesta, /en privado/);
    assert.doesNotMatch(c1.borrador_respuesta, /infec|urgencia/i);
    // La cola no publica nada cuando les tocaba…
    await vueltas((m) => S.vueltaGoogle(deps, { ahora: m }), en('2026-10-06', '10:30'), 25, 3);
    assert.deepEqual(google.publicadas, []);
    // …marketing ya no puede contestar la de la alerta; dirección médica, sí (y sale ya: es contenido nuevo).
    await assert.rejects(S.aprobarYPublicar(pool, google, { resenaId: c1.id, aprobadaPor: 'marketing@iemec', rol: 'marketing', ahora: en('2026-10-06', '12:00') }), /alerta clínica/);
    assert.equal((await S.aprobarYPublicar(pool, google, { resenaId: c1.id, aprobadaPor: 'direccion@iemec', rol: 'direccion', ahora: en('2026-10-06', '12:00') })).estado, 'publicada');
    assert.deepEqual(google.publicadas.map((p) => [p.googleId, /en privado/.test(p.texto)]), [['c1', true]]);
    const [[tarea]] = await pool.query('SELECT urgente FROM tareas WHERE id = ?', [c1.alerta_tarea_id]);
    assert.equal(tarea.urgente, 1);
  } finally {
    await pool.end();
  }
});

test('si Google no da la ficha (la API sin activar o caída), lo demás sigue: las respuestas del historial salen y el enlace es el de reserva', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const google = googleFalso({ modo: 'real', resenas: [{ googleId: 'h1', autor: 'Luis', nota: 5, texto: 'Muy profesionales', publicadaEn: '2025-03-10T10:00:00Z' }] });
  google.obtenerFicha = async () => { throw errorGoogle('Google 403 PERMISSION_DENIED: la API de la ficha no está activada', { estado: 403, permanente: true }); };
  const deps = { pool, whatsapp: crearWhatsApp('simulado'), google };
  const trabajos = async () => (await pool.query("SELECT tipo, estado FROM cola WHERE tipo LIKE 'resenas\\_%' ORDER BY id"))[0].map((x) => `${x.tipo}:${x.estado}`);
  const ahora = en('2026-10-06', '09:00');
  try {
    await sembrar(pool);
    await S.importarResenas(pool, google, { ahora });
    await S.liberarHistorial(pool, { ahora });
    const h1 = await resena(pool, 'h1');
    assert.equal((await S.aprobarYPublicar(pool, google, { resenaId: h1.id, aprobadaPor: 'recepcion@iemec', ahora })).estado, 'aprobada');
    // A las 10:30 la ficha falla (se reintentará) y la respuesta sale igual.
    assert.deepEqual(await S.vueltaGoogle(deps, { ahora: en('2026-10-06', '10:30') }), { hechos: 1, reintentos: 1, fallidos: 0, aplazados: 0 });
    assert.deepEqual(google.publicadas.map((p) => p.googleId), ['h1']);
    assert.deepEqual(await trabajos(), ['resenas_publicar:hecho', 'resenas_ficha:pendiente']);
    // Aunque falle todo el día, el enlace para reseñar es el de reserva, con el place_id de la clínica.
    await vueltas((m) => S.vueltaGoogle(deps, { ahora: m }), en('2026-10-06', '10:31'), 15, 8);
    assert.deepEqual(await trabajos(), ['resenas_publicar:hecho', 'resenas_ficha:fallido']);
    assert.equal(await S.abrirEnlace(pool, 'sin-peticion-000000000', null, en('2026-10-06', '13:00')), 'https://search.google.com/local/writereview?placeid=ChIJiemec');
  } finally {
    await pool.end();
  }
});

test('contestar a la petición no cae en una pregunta de otra conversación («¿Te busco otro momento?»)', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool, { momentos: '2h' });
    const elena = await paciente(pool, 'Elena');
    const hecha = await citaCompletada(pool, elena.id, '2026-10-06', '11:00');
    // Su cita del día 19, que cancela por WhatsApp a las 9:00: se le pregunta si quiere otro momento.
    await insertarCita(pool, elena.id, en('2026-10-19', '12:00'), 'confirmada');
    const r1 = await M.procesarEntrante(deps, { telefono: elena.telefono, texto: 'Hola, quiero cancelar la cita', ahora: en('2026-10-06', '08:55') });
    const r2 = await M.procesarEntrante(deps, { telefono: elena.telefono, texto: 'Sí, cancélala', ahora: en('2026-10-06', '09:00') });
    assert.match(r2.respuesta, /¿Quieres que te busque otro momento más adelante\?$/);
    const [[antes]] = await pool.query('SELECT estado, pregunta_pendiente IS NOT NULL AS pregunta FROM conversaciones WHERE id = ?', [r1.conversacionId]);
    assert.deepEqual({ ...antes }, { estado: 'cerrada', pregunta: 1 });
    // A las 14:10 le llega la petición de reseña (en una conversación nueva, que se cierra).
    await S.programarPeticion(pool, hecha);
    assert.equal((await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-06', '14:10') })).length, 1);
    const [[pregunta]] = await pool.query('SELECT pregunta_pendiente FROM conversaciones WHERE id = ?', [r1.conversacionId]);
    assert.equal(pregunta.pregunta_pendiente, null, 'lo último que ha leído es la petición: la pregunta de antes ya no está en el aire');
    // Contesta «Sí, claro» a la petición: no es un «sí» a buscarle otro momento. La conversación de la
    // cancelación no se reabre ni le ofrece huecos (antes le ofrecía huecos o apuntarla a la lista de
    // espera); lo que diga va a otra.
    const r3 = await M.procesarEntrante(deps, { telefono: elena.telefono, texto: 'Sí, claro', ahora: en('2026-10-06', '14:20') });
    assert.notEqual(r3.conversacionId, r1.conversacionId);
    const [[cancelacion]] = await pool.query('SELECT estado, motivo_cierre, pregunta_pendiente FROM conversaciones WHERE id = ?', [r1.conversacionId]);
    assert.deepEqual({ ...cancelacion }, { estado: 'cerrada', motivo_cierre: 'cancelada', pregunta_pendiente: null });
    assert.equal(r3.eleccion, undefined);
    assert.equal(r3.listaEspera, undefined);
    assert.doesNotMatch(r3.respuesta || '', /te puedo ofrecer|te avise si se libera/i);
  } finally {
    await pool.end();
  }
});

test('de qué paciente es: recepción la asocia a uno de los que se le pidió y ya no se le vuelve a pedir', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const whatsapp = crearWhatsApp('simulado');
  const deps = { pool, ia: crearIa('simulado'), whatsapp };
  try {
    await sembrar(pool, { momentos: '2h' });
    const laura = await paciente(pool, 'Laura');
    const otraLaura = await paciente(pool, 'Laura');
    const marta = await paciente(pool, 'Marta');
    const citas = [await citaCompletada(pool, laura.id, '2026-10-06', '11:00'), await citaCompletada(pool, otraLaura.id, '2026-10-06', '11:00'), await citaCompletada(pool, marta.id, '2026-10-06', '11:00')];
    for (const c of citas) await S.programarPeticion(pool, c);
    await S.enviarPeticionesPendientes(deps, { ahora: en('2026-10-06', '14:00') });
    await S.abrirEnlace(pool, (await peticion(pool, citas[0])).token, null, en('2026-10-06', '15:00'));
    // Llega la reseña de «Laura G.» el día 7.
    const google = googleFalso({ resenas: [{ googleId: 'r1', autor: 'Laura G.', nota: 5, texto: 'Trato encantador', publicadaEn: '2026-10-07T10:00:00Z' }] });
    await S.importarResenas(pool, google, { ahora: en('2026-10-07', '13:00') });
    const d = await S.datosPanel(pool, { ahora: en('2026-10-07', '13:00') });
    const r1 = d.resenas.find((x) => x.autor === 'Laura G.');
    assert.deepEqual(r1.candidatos.map((c) => [c.id, c.nombre, c.cita, c.abrioEnlace]), [[laura.id, 'Laura E.', '2026-10-06', true], [otraLaura.id, 'Laura E.', '2026-10-06', false]],
      'las Lauras a las que se les pidió (primero la que abrió el enlace); Marta, no');
    await assert.rejects(S.asociarPaciente(pool, { resenaId: r1.id, pacienteId: marta.id }), /no es uno de los que pudieron escribirla/);
    // Recepción sabe que es la segunda Laura (la reconoce por el texto, la llamó…).
    assert.deepEqual(await S.asociarPaciente(pool, { resenaId: r1.id, pacienteId: otraLaura.id, por: 'recepcion@iemec' }), { ok: true });
    assert.equal((await peticion(pool, citas[1])).resena_id, r1.id);
    await assert.rejects(S.asociarPaciente(pool, { resenaId: r1.id, pacienteId: laura.id }), /ya está asociada/);
    const tras = await S.datosPanel(pool, { ahora: en('2026-10-07', '13:00') });
    assert.deepEqual(tras.resenas.filter((x) => x.id === r1.id).map((x) => [x.dePaciente, x.candidatos.length]), [[true, 0]]);
    // Ya dejó su reseña: ni recordatorio, ni otra petición aunque pasen los 120 días.
    await S.enviarRecordatorios(deps, { ahora: en('2026-10-13', '14:00') });
    const recordatorio = async (c) => { const p = await peticion(pool, c); return [p.recordatorio_estado, p.recordatorio_motivo]; };
    assert.deepEqual(await recordatorio(citas[1]), ['omitido', 'ya dejó una reseña']);
    assert.deepEqual(await recordatorio(citas[0]), ['omitido', 'ya abrió el enlace']);
    assert.deepEqual(await recordatorio(citas[2]), ['enviado', null], 'a Marta, sí');
    const nueva = await citaCompletada(pool, otraLaura.id, '2027-03-02', '11:00');
    assert.deepEqual(await S.programarPeticion(pool, nueva), { pedir: false, motivo: 'ya dejó una reseña' });
  } finally {
    await pool.end();
  }
});

test('lo que Google ya no da (la borró su autor o la retiró Google) sale de la bandeja y de las cifras, y vuelve si reaparece', async (t) => {
  const pool = await prepararBdDePrueba(t);
  if (!pool) return;
  const lista = [
    { googleId: 'x1', autor: 'Ana', nota: 5, texto: 'Genial', publicadaEn: '2026-10-05T10:00:00Z' },
    { googleId: 'x2', autor: 'Falso', nota: 1, texto: 'Horrible', publicadaEn: '2026-10-05T11:00:00Z' },
    { googleId: 'x3', autor: 'Luis', nota: 4, texto: 'Muy bien', publicadaEn: '2025-03-05T11:00:00Z' },
  ];
  const google = googleFalso({ resenas: lista, modo: 'real' });
  const ahora = en('2026-10-06', '10:00');
  try {
    await sembrar(pool);
    await S.importarResenas(pool, google, { ahora });
    // La lectura diaria (solo lo tocado últimamente) no retira nada; la completa sí.
    const x2 = lista.splice(1, 1)[0];
    assert.equal((await S.importarResenas(pool, google, { ahora })).retiradas, undefined);
    assert.equal((await S.importarResenas(pool, google, { ahora, completa: true })).retiradas, 1);
    let d = await S.datosPanel(pool, { ahora });
    assert.deepEqual([d.metricas.total, d.metricas.notaTotal, d.resenas.map((x) => x.autor).sort()], [2, 4.5, ['Ana']]);
    await assert.rejects(S.aprobarYPublicar(pool, google, { resenaId: (await resena(pool, 'x2')).id, aprobadaPor: 'x', ahora }), /Google ya no muestra esta reseña/);
    // Una lectura completa vacía es un fallo, no 533 reseñas borradas.
    assert.equal((await S.importarResenas(pool, googleFalso(), { ahora, completa: true })).retiradas, 0);
    // Vuelve a aparecer (el filtro de spam la había quitado): vuelve como estaba.
    lista.push(x2);
    await S.importarResenas(pool, google, { ahora, completa: true });
    d = await S.datosPanel(pool, { ahora });
    assert.equal(d.metricas.total, 3);
    assert.equal((await resena(pool, 'x2')).estado, 'borrador');
    // Al contestarla, Google dice que no existe (404): se marca retirada y sale de la bandeja.
    google.fallo = errorGoogle('Google 404 NOT_FOUND', { estado: 404, permanente: true });
    await assert.rejects(S.aprobarYPublicar(pool, google, { resenaId: (await resena(pool, 'x1')).id, aprobadaPor: 'x', ahora }), /Google ya no muestra esta reseña/);
    assert.ok((await resena(pool, 'x1')).retirada_en);
    // Y la del historial que ya estaba aprobada: la cola no la reintenta, vuelve a la bandeja retirada.
    google.fallo = null;
    await S.liberarHistorial(pool, { ahora });
    const x3 = await resena(pool, 'x3');
    await S.aprobarYPublicar(pool, google, { resenaId: x3.id, aprobadaPor: 'x', ahora });
    google.fallo = errorGoogle('Google 404 NOT_FOUND', { estado: 404, permanente: true });
    await S.vueltaGoogle({ pool, google }, { ahora: en('2026-10-06', '11:00') });
    const r3 = await resena(pool, 'x3');
    assert.deepEqual([r3.estado, Boolean(r3.retirada_en)], ['borrador', true]);
    assert.equal((await pool.query("SELECT estado FROM cola WHERE tipo = 'resenas_publicar'"))[0][0].estado, 'hecho');
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

