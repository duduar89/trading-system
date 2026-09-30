'use strict';
// Lo que recepción marca de cada cita desde el panel y lo que eso mueve en el resto de la app:
//
//   ha llegado   se anota la hora
//   completada   petición de reseña 2 h después del fin (en horario de envío y nunca mientras aún
//                se pueda deshacer); el paciente pasa a cliente y su lead a «asistio»; y si el
//                tratamiento se repite cada cierto tiempo, entra en «toca repetir» para esa fecha
//                (salvo que ya tenga otra cita de ese tratamiento)
//   no vino      entra en la secuencia para recuperar la cita (salvo que ya tenga otra cita)
//   deshacer     vuelve al estado anterior y anula lo que se había programado
//
// Todo va en la misma transacción que el cambio de estado (servidor/agenda.js → cambiarEstado), y
// lo que se movió queda en el evento de la cita: con eso se deshace.
const T = require('../motor/tiempo');
const E = require('../motor/agenda/estados');
const agenda = require('./agenda');
const resenas = require('./resenas');
const repesca = require('./repesca/motor');

// Qué secuencia empieza cada estado (y se cancela al deshacerlo).
const SECUENCIA_DE = { completada: 'toca_repetir', no_presentada: 'cancelacion' };

/**
 * Recepción marca una cita: «llegada», «completada» o «no_presentada».
 * @returns la cita con `efectos` (lo que se programó) si el cambio movió algo
 */
async function marcar(pool, { id, estado, actor = 'panel', ahora = new Date() }) {
  if (!E.ACCIONES.includes(estado)) throw new agenda.ErrorAgenda('ESTADO_DESCONOCIDO', `«${estado}» no es algo que se marque desde recepción`);
  return agenda.cambiarEstado(pool, { id, a: estado, actor, ahora, alCambiar: (con, cita) => efectosDe(con, cita, ahora) });
}

// «Deshacer»: vuelve al estado anterior y anula lo programado. Devuelve la cita con `anulado`.
async function deshacer(pool, { id, actor = 'panel', ahora = new Date() }) {
  return agenda.deshacerEstado(pool, { id, actor, ahora, alDeshacer: anular });
}

async function efectosDe(con, cita, ahora) {
  if (cita.estado === 'completada') return alCompletar(con, cita, ahora);
  if (cita.estado === 'no_presentada') return alNoVenir(con, cita, ahora);
  return null;
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

// ¿Tiene otra cita en pie más adelante (de ese tratamiento, si se pide)?
async function otraCitaFutura(con, cita, ahora, { mismoTratamiento = false } = {}) {
  const [[otra]] = await con.query(
    `SELECT id FROM citas WHERE paciente_id = ? AND id <> ? AND inicio > ?
        AND (estado IN ('confirmada','llegada','en_curso') OR (estado = 'retenida' AND retenida_hasta > ?))
        ${mismoTratamiento ? 'AND tratamiento_id = ?' : ''} LIMIT 1`,
    [cita.paciente_id, cita.id, ahora, ahora, ...(mismoTratamiento ? [cita.tratamiento_id] : [])]);
  return Boolean(otra);
}

async function inscribir(con, datos) {
  const id = await repesca.inscribir(con, datos);
  const [[ins]] = await con.query('SELECT siguiente_en FROM inscripciones WHERE id = ?', [id]);
  return { inscripcion: id, primerMensaje: ins.siguiente_en };
}

async function alCompletar(con, cita, ahora) {
  const ef = {};
  // Petición de reseña: 2 h después del fin y en horario de envío, pero nunca antes de que acabe el
  // rato para deshacer (si recepción la marca tarde, sale un poco después; nunca antes).
  ef.resena = await sinRomper(async () => {
    await resenas.programarPeticion(con, cita.id, { noAntesDe: new Date(ahora.getTime() + E.VENTANA_DESHACER_MIN * 60000) });
    const [[pr]] = await con.query('SELECT estado, programada_para, motivo FROM peticiones_resena WHERE cita_id = ?', [cita.id]);
    return { estado: pr.estado, cuando: pr.programada_para, motivo: pr.motivo };
  });

  // Pasa a ser cliente (si no lo era, se apunta: al deshacer vuelve a como estaba).
  const [[paciente]] = await con.query('SELECT es_cliente, telefono FROM pacientes WHERE id = ?', [cita.paciente_id]);
  if (paciente && !paciente.es_cliente) {
    await con.query('UPDATE pacientes SET es_cliente = TRUE WHERE id = ?', [cita.paciente_id]);
    ef.esCliente = true;
  }

  // Su lead vino: el de esta cita y el que aún no había pasado de «cita» (por ficha o por teléfono).
  const [leads] = await con.query(
    `SELECT id, etapa FROM leads WHERE etapa IN ('nuevo','contactado','conversando','cita')
        AND (cita_id = ? OR paciente_id = ? OR (paciente_id IS NULL AND telefono = ?))`,
    [cita.id, cita.paciente_id, paciente?.telefono || null]);
  if (leads.length) {
    await con.query("UPDATE leads SET etapa = 'asistio' WHERE id IN (?)", [leads.map((l) => l.id)]);
    ef.leads = leads.map((l) => ({ id: l.id, etapa: l.etapa }));
  }

  // Toca repetir: entra en la secuencia para esa fecha (menos el margen), salvo que ya tenga otra
  // cita de ese tratamiento.
  const [[t]] = await con.query('SELECT repetir_cada_dias FROM tratamientos WHERE id = ?', [cita.tratamiento_id]);
  const r = E.avisoRepetir(T.fechaMadrid(new Date(cita.inicio)), t?.repetir_cada_dias);
  if (r) {
    ef.tocaRepetir = await otraCitaFutura(con, cita, ahora, { mismoTratamiento: true })
      ? { omitido: 'ya tiene otra cita de ese tratamiento' }
      : await sinRomper(async () => ({
        ...(await inscribir(con, { secuencia: 'toca_repetir', pacienteId: cita.paciente_id, citaId: cita.id, inicio: T.desdeMadrid(r.aviso, E.HORA_AVISO_REPETIR) })),
        toca: r.toca,
      }));
  }
  return ef;
}

async function alNoVenir(con, cita, ahora) {
  if (await otraCitaFutura(con, cita, ahora)) return { recuperar: { omitido: 'ya tiene otra cita' } };
  const [[ya]] = await con.query("SELECT id FROM inscripciones WHERE paciente_id = ? AND secuencia = 'cancelacion' AND estado IN ('activa','pausada') LIMIT 1", [cita.paciente_id]);
  if (ya) return { recuperar: { omitido: 'ya está en la secuencia para recuperar una cita' } };
  return { recuperar: await sinRomper(() => inscribir(con, { secuencia: 'cancelacion', pacienteId: cita.paciente_id, citaId: cita.id, inicio: ahora })) };
}

// Deshacer: se anula lo que movió el cambio (lo dice su evento).
async function anular(con, cita, { deshecho, efectos: ef }) {
  const hecho = {};
  if (SECUENCIA_DE[deshecho]) {
    const [r] = await con.query(
      "UPDATE inscripciones SET estado = 'cancelada', motivo_fin = 'se deshizo el cambio de la cita' WHERE cita_id = ? AND secuencia = ? AND estado IN ('activa','pausada')",
      [cita.id, SECUENCIA_DE[deshecho]]);
    if (r.affectedRows) hecho.secuencia = SECUENCIA_DE[deshecho];
  }
  if (deshecho === 'completada') {
    hecho.resena = await resenas.anularPeticion(con, cita.id);
    // Cliente y lead vuelven a como estaban, salvo que otra cita completada los sostenga.
    const [[otra]] = await con.query("SELECT COUNT(*) AS n FROM citas WHERE paciente_id = ? AND estado = 'completada'", [cita.paciente_id]);
    if (!otra.n) {
      if (ef.esCliente) {
        await con.query('UPDATE pacientes SET es_cliente = FALSE WHERE id = ?', [cita.paciente_id]);
        hecho.esCliente = false;
      }
      for (const l of ef.leads || []) await con.query("UPDATE leads SET etapa = ? WHERE id = ? AND etapa = 'asistio'", [l.etapa, l.id]);
      if (ef.leads?.length) hecho.leads = ef.leads.length;
    }
  }
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
