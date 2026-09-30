'use strict';
// Lo que recepción marca de cada cita desde el panel y lo que eso mueve en el resto de la app:
//
//   ha llegado     se anota la hora
//   completada     petición de reseña 2 h después del fin (en horario de envío; una sola si ese día
//                  completa dos citas); el paciente pasa a cliente y su lead a «asistio»; y si el
//                  tratamiento se repite cada cierto tiempo, entra en «toca repetir» para esa fecha
//                  menos un margen (salvo que ya tenga otra cita de ese tratamiento después de esta o
//                  se haya dado de baja)
//   no vino        entra en la secuencia para recuperar la cita (salvo que ya tenga otra después); si
//                  no se le pueden mandar mensajes comerciales, queda una tarea para llamarle
//   al final vino  «Ha llegado» o «Completada» después de «No vino»: se para lo de recuperarla
//   deshacer       vuelve al estado anterior y anula lo que se había programado
//
// Nada de lo programado sale mientras aún se puede deshacer. Todo va en la misma transacción que
// el cambio de estado (servidor/agenda.js → cambiarEstado), y lo que se movió queda en el evento
// de la cita: con eso se deshace.
const T = require('../motor/tiempo');
const E = require('../motor/agenda/estados');
const agenda = require('./agenda');
const resenas = require('./resenas');
const repesca = require('./repesca/motor');

// Qué secuencia empieza cada estado (y se cancela al deshacerlo). La de «cancelación» elige la
// plantilla según cómo acabó la cita: a quien no vino no se le dice que canceló.
const SECUENCIA_DE = { completada: 'toca_repetir', no_presentada: 'cancelacion' };
const AL_FINAL_VINO = 'al final vino a la cita';

/**
 * Recepción marca una cita: «llegada», «completada» o «no_presentada».
 * @returns la cita con `efectos` (lo que se programó) si el cambio movió algo
 */
async function marcar(pool, { id, estado, actor = 'panel', ahora = new Date() }) {
  if (!E.ACCIONES.includes(estado)) throw new agenda.ErrorAgenda('ESTADO_DESCONOCIDO', `«${estado}» no es algo que se marque desde recepción`);
  return agenda.cambiarEstado(pool, { id, a: estado, actor, ahora, alCambiar: (con, cita) => efectosDe(con, cita, ahora) });
}

// «Deshacer» el cambio que recepción está viendo (`de`: «llegada», «completada» o «no_presentada»):
// si la cita ya no está así (un reintento, otra pestaña, otra persona), no se deshace nada. Vuelve al
// estado anterior y anula lo programado. Devuelve la cita con `anulado`.
async function deshacer(pool, { id, de, actor = 'panel', ahora = new Date() }) {
  if (!E.TRANSICIONES[de]?.deshacible) {
    throw new agenda.ErrorAgenda('ESTADO_DESCONOCIDO', 'Hay que decir qué se deshace: «Ha llegado», «Completada» o «No vino»');
  }
  return agenda.deshacerEstado(pool, { id, de, actor, ahora, alDeshacer: (con, cita, d) => anular(con, cita, d, ahora) });
}

async function efectosDe(con, cita, ahora) {
  const ef = {};
  // Se había marcado «No vino» y al final vino: se para lo de recuperarla.
  if (cita.estado_anterior === 'no_presentada') {
    const parada = await pararRecuperacion(con, cita);
    if (parada) ef.recuperacion = parada;
  }
  if (cita.estado === 'completada') Object.assign(ef, await alCompletar(con, cita, ahora));
  if (cita.estado === 'no_presentada') Object.assign(ef, await alNoVenir(con, cita, ahora));
  return Object.keys(ef).length ? ef : null;
}

// Un fallo de configuración (p. ej. la clínica sin horario de envío) no impide marcar la cita: queda
// anotado en el evento y se ve en el panel. Un error de la base, en cambio, lo deshace todo.
async function sinRomper(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.sqlState || err.errno) throw err;
    return { error: err.message };
  }
}

// ¿Tiene otra cita después de esta (de ese tratamiento, si se pide), en pie o ya hecha? Así, si
// recepción marca tarde una cita vieja, tampoco se le escribe por algo que ya está resuelto.
async function otraCitaDespues(con, cita, ahora, { mismoTratamiento = false } = {}) {
  const [[otra]] = await con.query(
    `SELECT id FROM citas WHERE paciente_id = ? AND id <> ? AND inicio > ?
        AND (estado IN ('confirmada','llegada','en_curso','completada') OR (estado = 'retenida' AND retenida_hasta > ?))
        ${mismoTratamiento ? 'AND tratamiento_id = ?' : ''} LIMIT 1`,
    [cita.paciente_id, cita.id, cita.inicio, ahora, ...(mismoTratamiento ? [cita.tratamiento_id] : [])]);
  return Boolean(otra);
}

// ¿Por qué no se le pueden mandar mensajes comerciales? Lo mismo que mira la secuencia antes de cada
// paso (permisoComercial): baja, o ni consentimiento ni ser cliente. Los límites de la semana y del
// mes y el silencio pactado solo retrasan el mensaje: esos no cuentan. Así el panel no promete un
// mensaje que nunca va a salir.
async function porQueNoEscribirle(con, pacienteId, ahora) {
  const p = await repesca.permisoComercial(con, { paciente_id: pacienteId }, ahora);
  if (p.ok) return null;
  if (/baja/.test(p.motivo)) return 'se dio de baja de los mensajes comerciales';
  if (/consentimiento/.test(p.motivo)) return 'no tiene consentimiento para mensajes comerciales';
  return null;
}

// Lo que se programa al marcar no sale mientras aún se puede deshacer.
const trasElRato = (ahora) => new Date(ahora.getTime() + E.VENTANA_DESHACER_MIN * 60000);

async function inscribir(con, datos) {
  const id = await repesca.inscribir(con, datos);
  const [[ins]] = await con.query('SELECT siguiente_en FROM inscripciones WHERE id = ?', [id]);
  return { inscripcion: id, primerMensaje: ins.siguiente_en };
}

// Petición de reseña de la cita: 2 h después del fin, en horario de envío y nunca antes de noAntesDe.
// Si tenía una omitida de antes, se vuelve a decidir.
async function programarResena(con, cita, noAntesDe) {
  return sinRomper(async () => {
    await con.query("DELETE FROM peticiones_resena WHERE cita_id = ? AND estado = 'omitida'", [cita.id]);
    await resenas.programarPeticion(con, cita.id, { noAntesDe });
    const [[pr]] = await con.query('SELECT estado, programada_para, motivo FROM peticiones_resena WHERE cita_id = ?', [cita.id]);
    return { estado: pr.estado, cuando: pr.programada_para, motivo: pr.motivo };
  });
}

async function alCompletar(con, cita, ahora) {
  const ef = {};
  // Petición de reseña: 2 h después del fin y en horario de envío, pero nunca antes de que acabe el
  // rato para deshacer (si recepción la marca tarde, sale un poco después; nunca antes).
  ef.resena = await programarResena(con, cita, trasElRato(ahora));

  // Pasa a ser cliente (si no lo era, se apunta: al deshacer vuelve a como estaba).
  const [[paciente]] = await con.query('SELECT es_cliente, telefono FROM pacientes WHERE id = ?', [cita.paciente_id]);
  if (paciente && !paciente.es_cliente) {
    await con.query('UPDATE pacientes SET es_cliente = TRUE WHERE id = ?', [cita.paciente_id]);
    ef.esCliente = true;
  }

  // Su lead vino: el de esta cita y los suyos (por ficha o por teléfono) que preguntaban por este
  // tratamiento o por ninguno en concreto. Si preguntó por otro, esa consulta sigue abierta.
  const [leads] = await con.query(
    `SELECT id, etapa FROM leads WHERE etapa IN ('nuevo','contactado','conversando','cita')
        AND (cita_id = ? OR ((paciente_id = ? OR (paciente_id IS NULL AND telefono = ?))
             AND (tratamiento_interes_id IS NULL OR tratamiento_interes_id = ?)))`,
    [cita.id, cita.paciente_id, paciente?.telefono || null, cita.tratamiento_id]);
  if (leads.length) {
    await con.query("UPDATE leads SET etapa = 'asistio' WHERE id IN (?)", [leads.map((l) => l.id)]);
    ef.leads = leads.map((l) => ({ id: l.id, etapa: l.etapa }));
  }

  // Toca repetir: entra en la secuencia para esa fecha (menos el margen), salvo que ya tenga otra
  // cita de ese tratamiento o se haya dado de baja. Si la fecha ya pasó (se marcó tarde), el aviso
  // sale al acabar el rato.
  const [[t]] = await con.query('SELECT repetir_cada_dias FROM tratamientos WHERE id = ?', [cita.tratamiento_id]);
  const r = E.avisoRepetir(T.fechaMadrid(new Date(cita.inicio)), t?.repetir_cada_dias);
  if (r) {
    const inicio = new Date(Math.max(T.desdeMadrid(r.aviso, E.HORA_AVISO_REPETIR).getTime(), trasElRato(ahora).getTime()));
    if (await otraCitaDespues(con, cita, ahora, { mismoTratamiento: true })) {
      ef.tocaRepetir = { omitido: 'ya tiene otra cita de ese tratamiento' };
    } else {
      const motivo = await porQueNoEscribirle(con, cita.paciente_id, ahora);
      ef.tocaRepetir = motivo ? { omitido: motivo } : await sinRomper(async () => ({
        ...(await inscribir(con, { secuencia: 'toca_repetir', pacienteId: cita.paciente_id, citaId: cita.id, inicio })),
        toca: r.toca,
      }));
    }
  }
  return ef;
}

async function alNoVenir(con, cita, ahora) {
  if (await otraCitaDespues(con, cita, ahora)) return { recuperar: { omitido: 'ya tiene otra cita' } };
  const [[ya]] = await con.query("SELECT id FROM inscripciones WHERE paciente_id = ? AND secuencia = ? AND estado IN ('activa','pausada') LIMIT 1",
    [cita.paciente_id, SECUENCIA_DE.no_presentada]);
  if (ya) return { recuperar: { omitido: 'ya está en la secuencia para recuperar una cita' } };
  const [[paciente]] = await con.query('SELECT telefono FROM pacientes WHERE id = ?', [cita.paciente_id]);
  if (!paciente?.telefono) return { recuperar: { omitido: 'no tiene teléfono' } };
  const motivo = await porQueNoEscribirle(con, cita.paciente_id, ahora);
  if (!motivo) {
    return { recuperar: await sinRomper(() => inscribir(con, { secuencia: SECUENCIA_DE.no_presentada, pacienteId: cita.paciente_id, citaId: cita.id, inicio: ahora })) };
  }
  // Sin permiso para mensajes comerciales no se le escribe: la recupera una persona, llamándole.
  const p = T.partesMadrid(new Date(cita.inicio));
  const [tarea] = await con.query("INSERT INTO tareas (tipo, titulo, paciente_id, vence_en) VALUES ('llamar', ?, ?, ?)",
    [`No vino a su cita ${repesca.textoDia(p.fecha)} a las ${p.hora}: llamarle para buscarle otro hueco (${motivo})`, cita.paciente_id, new Date(ahora.getTime() + 2 * 3600000)]);
  return { recuperar: { omitido: motivo, tarea: tarea.insertId } };
}

// Se marcó «No vino» y al final vino (llegó tarde o se marcó antes de tiempo): se cancelan la
// secuencia para recuperarla y la tarea de llamarle. Lo que se paró queda en el evento: si se
// deshace, vuelve (reanudarRecuperacion).
async function pararRecuperacion(con, cita) {
  const [ins] = await con.query("SELECT id, estado, motivo_fin FROM inscripciones WHERE cita_id = ? AND secuencia = ? AND estado IN ('activa','pausada')",
    [cita.id, SECUENCIA_DE.no_presentada]);
  if (ins.length) await con.query("UPDATE inscripciones SET estado = 'cancelada', motivo_fin = ? WHERE id IN (?)", [AL_FINAL_VINO, ins.map((i) => i.id)]);
  const tarea = (await agenda.ultimoCambio(con, cita.id, 'no_presentada')).efectos?.recuperar?.tarea;
  let cancelada = null;
  if (tarea) {
    const [r] = await con.query("UPDATE tareas SET estado = 'cancelada', resultado = ? WHERE id = ? AND estado = 'abierta'", [AL_FINAL_VINO, tarea]);
    if (r.affectedRows) cancelada = tarea;
  }
  if (!ins.length && !cancelada) return null;
  return { inscripciones: ins.map((i) => ({ id: i.id, estado: i.estado, motivo: i.motivo_fin })), ...(cancelada ? { tarea: cancelada } : {}) };
}

async function reanudarRecuperacion(con, parada) {
  let inscripciones = 0;
  for (const i of parada.inscripciones || []) {
    const [r] = await con.query("UPDATE inscripciones SET estado = ?, motivo_fin = ? WHERE id = ? AND estado = 'cancelada' AND motivo_fin = ?",
      [i.estado, i.motivo, i.id, AL_FINAL_VINO]);
    inscripciones += r.affectedRows;
  }
  const hecho = { inscripciones };
  if (parada.tarea) {
    const [r] = await con.query("UPDATE tareas SET estado = 'abierta', resultado = NULL WHERE id = ? AND estado = 'cancelada' AND resultado = ?", [parada.tarea, AL_FINAL_VINO]);
    if (r.affectedRows) hecho.tarea = parada.tarea;
  }
  return hecho;
}

// Deshacer: se anula lo que movió el cambio (lo dice su evento).
async function anular(con, cita, { deshecho, efectos: ef }, ahora) {
  const hecho = {};
  if (SECUENCIA_DE[deshecho]) {
    const [r] = await con.query(
      "UPDATE inscripciones SET estado = 'cancelada', motivo_fin = 'se deshizo el cambio de la cita' WHERE cita_id = ? AND secuencia = ? AND estado IN ('activa','pausada')",
      [cita.id, SECUENCIA_DE[deshecho]]);
    if (r.affectedRows) hecho.secuencia = SECUENCIA_DE[deshecho];
  }
  if (deshecho === 'no_presentada' && ef.recuperar?.tarea) {
    const [r] = await con.query("UPDATE tareas SET estado = 'cancelada', resultado = 'se deshizo el «No vino»' WHERE id = ? AND estado = 'abierta'", [ef.recuperar.tarea]);
    if (r.affectedRows) hecho.tarea = ef.recuperar.tarea;
  }
  if (deshecho === 'completada') {
    const [[antes]] = await con.query('SELECT estado FROM peticiones_resena WHERE cita_id = ?', [cita.id]);
    hecho.resena = await resenas.anularPeticion(con, cita.id);
    // Si por la de esta se omitió la petición de otra cita suya (dos el mismo día), ahora sale la de
    // aquella; tampoco mientras aquella se pueda deshacer.
    const otra = antes?.estado === 'programada' ? await resenas.omitidaPorOtraEnCamino(con, cita.paciente_id) : null;
    if (otra) {
      const noAntesDe = new Date(Math.max(ahora.getTime(), otra.completada_en ? trasElRato(new Date(otra.completada_en)).getTime() : 0));
      hecho.resenaOtraCita = { cita: otra.id, ...(await programarResena(con, otra, noAntesDe)) };
    }
    // Deja de ser cliente si no tiene otra cita completada.
    const [[otraCompletada]] = await con.query("SELECT COUNT(*) AS n FROM citas WHERE paciente_id = ? AND estado = 'completada'", [cita.paciente_id]);
    if (ef.esCliente && !otraCompletada.n) {
      await con.query('UPDATE pacientes SET es_cliente = FALSE WHERE id = ?', [cita.paciente_id]);
      hecho.esCliente = false;
    }
    // Cada lead vuelve a su etapa, salvo que haya venido a otra cita desde que entró ese lead.
    let leads = 0;
    for (const l of ef.leads || []) {
      const [r] = await con.query(
        `UPDATE leads l SET l.etapa = ? WHERE l.id = ? AND l.etapa = 'asistio'
            AND NOT EXISTS (SELECT 1 FROM citas c WHERE c.paciente_id = ? AND c.estado = 'completada' AND c.inicio >= l.creado_en)`,
        [l.etapa, l.id, cita.paciente_id]);
      leads += r.affectedRows;
    }
    if (leads) hecho.leads = leads;
  }
  // Se había parado la recuperación porque al final vino: vuelve a como estaba.
  if (ef.recuperacion) hecho.recuperacion = await reanudarRecuperacion(con, ef.recuperacion);
  return hecho;
}

/**
 * Lo que el panel enseña al abrir una cita: quién, qué, con quién, dónde, cuándo, en qué estado,
 * sus enlaces («Tu cita» y su conversación) y qué botones tocan ahora según el estado y la hora.
 */
async function detalle(q, id, { ahora = new Date() } = {}) {
  const [[c]] = await q.query(
    `SELECT c.*, t.nombre AS tratamiento, p.nombre AS paciente_nombre, p.apellidos AS paciente_apellidos, p.telefono,
            pr.nombre AS profesional, s.nombre AS sala
       FROM citas c JOIN tratamientos t ON t.id = c.tratamiento_id JOIN pacientes p ON p.id = c.paciente_id
       LEFT JOIN profesionales pr ON pr.id = c.profesional_id LEFT JOIN salas s ON s.id = c.sala_id
      WHERE c.id = ?`, [id]);
  if (!c) return null;
  // Su conversación: la de la que salió la cita o, si no, la última suya.
  const [[conv]] = await q.query(
    `SELECT id FROM conversaciones WHERE id = ? OR paciente_id = ? OR telefono = ?
      ORDER BY id = ? DESC, actualizado_en DESC, id DESC LIMIT 1`,
    [c.conversacion_id || 0, c.paciente_id, c.telefono || '', c.conversacion_id || 0]);
  const inicio = T.partesMadrid(new Date(c.inicio));
  const d = E.comprobarDeshacer(c, ahora);
  // Si antes de la hora algún botón aún no toca, se dice desde cuándo (el primero).
  const espera = ahora < new Date(c.inicio)
    ? E.ACCIONES.map((a) => E.comprobarCambio(c, a, ahora)).find((v) => v.codigo === 'FUERA_DE_HORA')?.mensaje || null
    : null;
  return {
    id: c.id, estado: c.estado, etiqueta: E.ETIQUETA[c.estado] || c.estado,
    paciente: [c.paciente_nombre, c.paciente_apellidos].filter(Boolean).join(' '), pacienteId: c.paciente_id,
    tratamiento: c.tratamiento, profesional: c.profesional, sala: c.sala,
    fecha: inicio.fecha, inicio: inicio.hora, fin: T.partesMadrid(new Date(c.fin)).hora,
    origen: c.origen, primeraVisita: Boolean(c.primera_visita),
    llegadaEn: c.llegada_en, completadaEn: c.completada_en, noPresentadaEn: c.no_presentada_en,
    enlaceCita: `/c/${c.token}`, conversacionId: conv?.id || null,
    acciones: E.accionesPosibles(c, ahora), espera,
    deshacer: d.ok ? { de: E.ETIQUETA[c.estado], a: d.a, etiqueta: E.ETIQUETA[d.a] || d.a, hasta: d.hasta } : null,
  };
}

module.exports = { marcar, deshacer, detalle };
