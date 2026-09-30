'use strict';
// Agenda con la base: carga el día, busca huecos y reserva sin dobles. La reserva bloquea las filas
// de las salas, profesionales y aparatos candidatos (siempre en el mismo orden, para no
// interbloquearse), vuelve a calcular los huecos con lo último que hay en la base y solo entonces
// inserta. Dos reservas a la vez del mismo hueco: entra una y la otra recibe HUECO_OCUPADO.
//
// Cambiar una cita de día es reservar la nueva «reprogramando» la antigua, todo en la misma
// transacción: la antigua no cuenta como ocupada (se puede mover a un hueco que la pise), queda
// «reprogramada» apuntando a la nueva y su .ics sube de versión (sale anulado en el calendario).
const crypto = require('crypto');
const T = require('../motor/tiempo');
const { prepararDia, huecoAInstantes, tratamientoParaMotor } = require('../motor/agenda/dia');
const { buscarHuecos, proponer } = require('../motor/agenda/huecos');
const E = require('../motor/agenda/estados');
const { registrar } = require('./eventos');

class ErrorAgenda extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

// Una cita que todavía vale: confirmada o retenida a tiempo, y que no ha empezado.
function sigueEnPie(c, ahora = new Date()) {
  if (!c || !['retenida', 'confirmada'].includes(c.estado) || new Date(c.inicio) <= ahora) return false;
  return !(c.estado === 'retenida' && c.retenida_hasta && new Date(c.retenida_hasta) <= ahora);
}

// La antigua pasa a «reprogramada», apunta a la nueva y deja libre su hueco (cancelada_en dice desde
// cuándo, para la lista de espera). Dentro de la transacción de quien la llama.
async function marcarReprogramada(con, vieja, nuevaId, { ahora, actor = 'paciente', por = 'paciente' }) {
  await con.query(
    `UPDATE citas SET estado = 'reprogramada', reprograma_a_id = ?, secuencia_ics = secuencia_ics + 1, retenida_hasta = NULL,
            cancelada_en = ?, cancelada_por = ?, motivo_cancelacion = 'cambiada a otra cita' WHERE id = ?`,
    [nuevaId, ahora, por, vieja.id]);
  await registrar(con, { tipo: 'cita_reprogramada', entidad: 'cita', entidadId: vieja.id, actor, datos: { de: vieja.estado, a: nuevaId } });
}

// Con cita, se acaban sus secuencias de captación y los seguimientos de repesca.
async function terminarSecuencias(con, { pacienteId, leadId = null }) {
  await con.query(
    `UPDATE inscripciones SET estado = 'terminada', motivo_fin = 'cita' WHERE estado IN ('activa','pausada')
        AND secuencia IN ('lead','cancelacion','toca_repetir','dormido','vale_regalo')
        AND ((paciente_id IS NOT NULL AND paciente_id = ?) OR (lead_id IS NOT NULL AND lead_id = ?))`, [pacienteId, leadId || null]);
}

async function cargarTratamiento(con, id) {
  const [[fila]] = await con.query('SELECT * FROM tratamientos WHERE id = ? AND activo = TRUE', [id]);
  if (!fila) throw new ErrorAgenda('TRATAMIENTO_DESCONOCIDO', `No existe el tratamiento ${id}`);
  const [salas] = await con.query('SELECT sala_id FROM tratamiento_salas WHERE tratamiento_id = ?', [id]);
  const [profs] = await con.query('SELECT profesional_id FROM tratamiento_profesionales WHERE tratamiento_id = ?', [id]);
  return {
    fila,
    motor: tratamientoParaMotor(fila, {
      salasPermitidas: salas.map((s) => s.sala_id),
      profesionalesPermitidos: profs.map((p) => p.profesional_id),
    }),
  };
}

// ignorarCitaId: la cita que se está cambiando no ocupa (el paciente puede moverla a un hueco que la pise).
async function cargarDia(con, fecha, { ahora = new Date(), antelacionMin = 60, ignorarCitaId = null } = {}) {
  const desde = T.desdeMadrid(fecha, '00:00');
  const hasta = T.desdeMadrid(T.sumarDias(fecha, 1), '00:00');
  const q = async (sql, p = []) => (await con.query(sql, p))[0];
  const [clinica] = await q('SELECT * FROM clinica WHERE id = 1');
  return prepararDia({
    fecha, ahora, antelacionMin,
    clinica: clinica || {},
    horario: await q('SELECT dia_semana, abre, cierra FROM horario_clinica'),
    festivos: (await q('SELECT fecha FROM festivos WHERE fecha = ?', [fecha])).length ? [fecha] : [],
    cierres: await q('SELECT desde, hasta FROM cierres WHERE desde < ? AND hasta > ?', [hasta, desde]),
    salas: await q('SELECT id, tipo, activa FROM salas'),
    equipos: await q('SELECT id, codigo, sala_id, movil, unidades, activo FROM equipos'),
    profesionales: await q('SELECT id, rol, activo FROM profesionales'),
    horariosProf: (await q('SELECT profesional_id, dia_semana, inicio, fin, sala_preferida_id, vigente_desde, vigente_hasta FROM profesional_horarios'))
      .map((h) => ({ ...h, vigente_desde: fechaSql(h.vigente_desde), vigente_hasta: fechaSql(h.vigente_hasta) })),
    ausencias: await q('SELECT profesional_id, desde, hasta FROM profesional_ausencias WHERE desde < ? AND hasta > ?', [hasta, desde]),
    pausas: await q('SELECT profesional_id, modo, dia_semana, ventana_inicio, ventana_fin, duracion_min FROM pausas'),
    citas: await q(`SELECT sala_id, profesional_id, equipo_id, sala_desde, sala_hasta, prof_desde, prof_hasta, estado, retenida_hasta
                      FROM citas WHERE sala_desde < ? AND sala_hasta > ? AND id <> ?`, [hasta, desde, ignorarCitaId || 0]),
  });
}

// Las columnas DATE llegan como Date a medianoche UTC: se devuelven como 'AAAA-MM-DD'.
function fechaSql(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

async function huecos(pool, { fecha, tratamientoId, ahora = new Date(), antelacionMin = 60, ignorarCitaId = null }) {
  const con = await pool.getConnection();
  try {
    const t = await cargarTratamiento(con, tratamientoId);
    const dia = await cargarDia(con, fecha, { ahora, antelacionMin, ignorarCitaId });
    return buscarHuecos(dia, t.motor).map((h) => ({ ...h, hora: T.hhmm(h.inicio), fecha }));
  } finally {
    con.release();
  }
}

// Huecos de los próximos días (para proponer al paciente).
// Huecos para proponer al paciente: repartidos en varios días (como mucho `porDia` en cada uno,
// uno de mañana y otro de tarde si se puede), para que tenga dónde elegir.
// estricta: solo en su franja (sin rellenar con otras horas los días que no la tienen).
async function proximosHuecos(pool, { tratamientoId, desdeFecha, dias = 14, n = 3, porDia = 2, preferencia = null, estricta = false, ahora = new Date(), ignorarCitaId = null }) {
  const salida = [];
  for (let i = 0; i < dias && salida.length < n; i++) {
    const fecha = T.sumarDias(desdeFecha, i);
    const lista = await huecos(pool, { fecha, tratamientoId, ahora, ignorarCitaId });
    const cuantos = Math.min(porDia, n - salida.length);
    for (const h of proponer(lista, { n: cuantos, preferencia, estricta, separacionMin: 180 })) salida.push(h);
  }
  return salida;
}

async function bloquearRecursos(con, t) {
  let sqlSalas = 'SELECT id FROM salas ORDER BY id FOR UPDATE';
  let paramSalas = [];
  if (t.salasPermitidas.length) { sqlSalas = 'SELECT id FROM salas WHERE id IN (?) ORDER BY id FOR UPDATE'; paramSalas = [t.salasPermitidas]; }
  else if (t.salaTipo) { sqlSalas = 'SELECT id FROM salas WHERE tipo = ? ORDER BY id FOR UPDATE'; paramSalas = [t.salaTipo]; }
  const [salas] = await con.query(sqlSalas, paramSalas);
  if (t.rol || t.profesionalesPermitidos.length) {
    await con.query(
      t.profesionalesPermitidos.length ? 'SELECT id FROM profesionales WHERE id IN (?) ORDER BY id FOR UPDATE' : 'SELECT id FROM profesionales WHERE rol = ? ORDER BY id FOR UPDATE',
      [t.profesionalesPermitidos.length ? t.profesionalesPermitidos : t.rol]);
  }
  if (t.equipoCodigo) await con.query('SELECT id FROM equipos WHERE codigo = ? ORDER BY id FOR UPDATE', [t.equipoCodigo]);
  return salas.length;
}

/**
 * Reserva (o retiene) una cita.
 * @param {object} p pacienteId, tratamientoId, fecha 'AAAA-MM-DD', hora 'HH:MM', profesionalId?, salaId?,
 *   origen, retener (deja la cita «retenida» unos minutos hasta que el paciente confirme; retenerMin
 *   cambia los minutos de la clínica), actor, leadId?, conversacionId? (la conversación de WhatsApp de
 *   la que sale), reprograma? (id de la cita que esta sustituye: queda «reprogramada»; si ya no está
 *   en pie, se reserva igual sin tocarla)
 */
async function reservar(pool, p) {
  const ahora = p.ahora || new Date();
  const con = await pool.getConnection();
  try {
    await con.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await con.beginTransaction();
    const t = await cargarTratamiento(con, p.tratamientoId);
    await bloquearRecursos(con, t.motor);
    let vieja = null;
    if (p.reprograma) {
      const [[c]] = await con.query('SELECT * FROM citas WHERE id = ? FOR UPDATE', [p.reprograma]);
      if (sigueEnPie(c, ahora)) vieja = c;
    }
    const dia = await cargarDia(con, p.fecha, { ahora, antelacionMin: p.antelacionMin ?? 0, ignorarCitaId: vieja?.id });
    const minuto = T.minutosDe(p.hora);
    const candidatos = buscarHuecos(dia, t.motor, { desde: minuto, hasta: minuto + 1 })
      .filter((h) => h.inicio === minuto);
    let hueco = candidatos[0];
    if (hueco && (p.profesionalId || p.salaId)) {
      // Se pidió un profesional o sala concretos: hay que buscar una combinación que los respete.
      const conFiltro = buscarHuecos({
        ...dia,
        profesionales: p.profesionalId ? dia.profesionales.filter((x) => x.id === p.profesionalId) : dia.profesionales,
        salas: p.salaId ? dia.salas.filter((x) => x.id === p.salaId) : dia.salas,
      }, t.motor, { desde: minuto, hasta: minuto + 1 }).filter((h) => h.inicio === minuto);
      hueco = conFiltro[0];
    }
    if (!hueco) throw new ErrorAgenda('HUECO_OCUPADO', `El ${p.fecha} a las ${p.hora} ya no está libre para ${t.fila.nombre}`);

    const inst = huecoAInstantes(p.fecha, hueco, t.motor);
    const [[clinica]] = await con.query('SELECT retencion_hueco_min FROM clinica WHERE id = 1');
    const retenidaHasta = p.retener ? new Date(ahora.getTime() + (p.retenerMin || clinica?.retencion_hueco_min || 15) * 60000) : null;
    const token = crypto.randomBytes(32).toString('base64url');
    // La cita cambiada conserva de dónde vino y si era primera visita (una reserva de recepción que
    // el paciente mueve por WhatsApp no es una cita nueva recuperada por la IA).
    const [r] = await con.query(
      `INSERT INTO citas (paciente_id, tratamiento_id, profesional_id, sala_id, equipo_id, inicio, fin,
         sala_desde, sala_hasta, prof_desde, prof_hasta, estado, retenida_hasta, origen, conversacion_id, primera_visita,
         token, creada_por, confirmada_en, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.pacienteId, t.fila.id, hueco.profesionalId, hueco.salaId, hueco.equipoId, inst.inicio, inst.fin,
        inst.sala_desde, inst.sala_hasta, inst.prof_desde, inst.prof_hasta,
        p.retener ? 'retenida' : 'confirmada', retenidaHasta, vieja ? vieja.origen : p.origen || 'recepcion', p.conversacionId || null,
        vieja ? Boolean(vieja.primera_visita) : Boolean(p.primeraVisita),
        token, p.actor || 'sistema', p.retener ? null : ahora, ahora]);
    if (vieja) await marcarReprogramada(con, vieja, r.insertId, { ahora, actor: p.actor || 'paciente' });
    if (p.leadId) await con.query("UPDATE leads SET etapa = 'cita', cita_id = ? WHERE id = ?", [r.insertId, p.leadId]);
    // Un hueco que solo se le guarda (la lista de espera) aún no es una cita: sus secuencias siguen
    // hasta que diga que sí (confirmarRetenida).
    if (!p.retener) await terminarSecuencias(con, { pacienteId: p.pacienteId, leadId: p.leadId });
    await registrar(con, { tipo: p.retener ? 'cita_retenida' : 'cita_reservada', entidad: 'cita', entidadId: r.insertId, actor: p.actor, datos: { fecha: p.fecha, hora: p.hora, tratamiento: t.fila.id, profesional: hueco.profesionalId, sala: hueco.salaId, reprograma: vieja?.id } });
    await con.commit();
    return { id: r.insertId, token, estado: p.retener ? 'retenida' : 'confirmada', retenidaHasta, reprograma: vieja ? vieja.id : null, ...inst, profesionalId: hueco.profesionalId, salaId: hueco.salaId, equipoId: hueco.equipoId };
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
}

/**
 * Cambia el estado de una cita según la tabla de transiciones (motor/agenda/estados.js): bloquea la
 * fila, comprueba que el cambio vale (también por la hora), guarda cuándo pasó y lo anota en eventos.
 * @param {object} p id o token, a (estado nuevo), de? (restringe los estados de partida de la tabla),
 *   actor, motivo, por, ahora, alCambiar? (con, cita) → lo que ese cambio mueve en el resto de la app,
 *   en la misma transacción; lo que devuelve queda en el evento (servidor/estados-cita.js)
 */
async function cambiarEstado(pool, { id, token, de = null, a, actor = 'sistema', motivo = null, por = null, ahora = new Date(), alCambiar = null }) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const [[cita]] = await con.query(`SELECT * FROM citas WHERE ${id ? 'id = ?' : 'token = ?'} FOR UPDATE`, [id || token]);
    if (!cita) throw new ErrorAgenda('CITA_DESCONOCIDA', 'No existe esa cita');
    const vale = E.comprobarCambio(cita, a, ahora, { de });
    if (!vale.ok) throw new ErrorAgenda(vale.codigo, vale.mensaje);
    const regla = E.TRANSICIONES[a];
    const cambios = { estado: a };
    if (regla.columna) cambios[regla.columna] = ahora;
    if (a === 'confirmada') cambios.retenida_hasta = null;
    if (a === 'cancelada') Object.assign(cambios, { motivo_cancelacion: motivo, cancelada_por: por, secuencia_ics: cita.secuencia_ics + 1 });
    // Lo que se puede deshacer guarda de dónde venía y cuándo cambió.
    if (regla.deshacible) Object.assign(cambios, { estado_anterior: cita.estado, estado_cambiado_en: ahora });
    await con.query('UPDATE citas SET ? WHERE id = ?', [cambios, cita.id]);
    const nueva = { ...cita, ...cambios };
    const efectos = alCambiar ? await alCambiar(con, nueva) : null;
    await registrar(con, { tipo: `cita_${a}`, entidad: 'cita', entidadId: cita.id, actor, datos: { de: cita.estado, motivo, ...(efectos ? { efectos } : {}) } });
    await con.commit();
    return efectos ? { ...nueva, efectos } : nueva;
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
}

// El último cambio a `estado` que se anotó de esta cita (de dónde venía y qué movió).
async function ultimoCambio(con, citaId, estado) {
  const [[ev]] = await con.query("SELECT datos FROM eventos WHERE entidad = 'cita' AND entidad_id = ? AND tipo = ? ORDER BY id DESC LIMIT 1", [String(citaId), `cita_${estado}`]);
  const datos = typeof ev?.datos === 'string' ? JSON.parse(ev.datos) : ev?.datos;
  return datos || {};
}

/**
 * «Deshacer»: la cita vuelve al estado anterior si su último cambio se puede deshacer y aún no ha
 * pasado el rato (motor/agenda/estados.js). Si el estado al que vuelve también se marcó hace poco
 * (la llegada antes de «Completada»), se podrá deshacer a su vez.
 * @param {object} p id, de? (el estado que ve quien deshace: si la cita ya no está así, por un
 *   reintento, otra pestaña u otra persona, no se deshace nada), actor, ahora,
 *   alDeshacer? (con, cita, { deshecho, efectos }) → anula lo que movió ese cambio (los efectos se
 *   leen del evento que lo anotó)
 */
async function deshacerEstado(pool, { id, de = null, actor = 'sistema', ahora = new Date(), alDeshacer = null }) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const [[cita]] = await con.query('SELECT * FROM citas WHERE id = ? FOR UPDATE', [id]);
    if (!cita) throw new ErrorAgenda('CITA_DESCONOCIDA', 'No existe esa cita');
    if (de && cita.estado !== de) {
      throw new ErrorAgenda('ESTADO_CAMBIADO', `La cita ya no está como «${E.ETIQUETA[de] || de}» (ahora: «${E.ETIQUETA[cita.estado] || cita.estado}»): no se ha deshecho nada`);
    }
    const vale = E.comprobarDeshacer(cita, ahora);
    if (!vale.ok) throw new ErrorAgenda(vale.codigo, vale.mensaje);
    const deshecho = await ultimoCambio(con, cita.id, cita.estado);
    const previa = E.TRANSICIONES[vale.a]?.deshacible ? await ultimoCambio(con, cita.id, vale.a) : {};
    const cambios = {
      estado: vale.a, [E.TRANSICIONES[cita.estado].columna]: null,
      estado_anterior: previa.de || null, estado_cambiado_en: previa.de ? cita[E.TRANSICIONES[vale.a].columna] : null,
    };
    await con.query('UPDATE citas SET ? WHERE id = ?', [cambios, cita.id]);
    const nueva = { ...cita, ...cambios };
    const anulado = alDeshacer ? await alDeshacer(con, nueva, { deshecho: cita.estado, efectos: deshecho.efectos || {} }) : null;
    await registrar(con, { tipo: 'cita_estado_deshecho', entidad: 'cita', entidadId: cita.id, actor, datos: { de: cita.estado, a: vale.a, ...(anulado ? { anulado } : {}) } });
    await con.commit();
    return anulado ? { ...nueva, anulado } : nueva;
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
}

const confirmar = (pool, o) => cambiarEstado(pool, { ...o, a: 'confirmada' });
const cancelar = (pool, o) => cambiarEstado(pool, { ...o, a: 'cancelada' });

/**
 * Dice que sí al hueco que se le guardaba: la cita retenida queda confirmada y, si sustituye a otra
 * (acepta un hueco antes de la lista de espera), la que tenía queda «reprogramada» apuntando a ella,
 * todo en la misma transacción. Con cita, se acaban sus secuencias (al retenerla, aún no).
 * @param {object} p id (la retenida), reprograma? (la que sustituye), actor, ahora
 */
async function confirmarRetenida(pool, { id, reprograma = null, actor = 'paciente', ahora = new Date() }) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const [[cita]] = await con.query('SELECT * FROM citas WHERE id = ? FOR UPDATE', [id]);
    if (!cita) throw new ErrorAgenda('CITA_DESCONOCIDA', 'No existe esa cita');
    if (!sigueEnPie(cita, ahora)) {
      throw cita.estado === 'retenida'
        ? new ErrorAgenda('RETENCION_CADUCADA', 'El hueco se ha liberado: hay que elegir otro')
        : new ErrorAgenda('ESTADO_NO_VALIDO', `La cita está ${cita.estado}`);
    }
    await con.query("UPDATE citas SET estado = 'confirmada', confirmada_en = ?, retenida_hasta = NULL WHERE id = ?", [ahora, cita.id]);
    await registrar(con, { tipo: 'cita_confirmada', entidad: 'cita', entidadId: cita.id, actor, datos: { de: cita.estado } });
    let reprogramada = null;
    if (reprograma && reprograma !== cita.id) {
      const [[vieja]] = await con.query('SELECT * FROM citas WHERE id = ? FOR UPDATE', [reprograma]);
      if (sigueEnPie(vieja, ahora)) {
        await marcarReprogramada(con, vieja, cita.id, { ahora, actor });
        reprogramada = vieja.id;
      }
    }
    await terminarSecuencias(con, { pacienteId: cita.paciente_id });
    await con.commit();
    return { ...cita, estado: 'confirmada', confirmada_en: ahora, retenida_hasta: null, reprograma: reprogramada };
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
}

// Libera las retenciones caducadas (lo llama el cron cada minuto).
async function caducarRetenciones(pool, ahora = new Date()) {
  const [r] = await pool.query(
    "UPDATE citas SET estado = 'cancelada', cancelada_por = 'sistema', motivo_cancelacion = 'retención caducada', cancelada_en = ? WHERE estado = 'retenida' AND retenida_hasta <= ?",
    [ahora, ahora]);
  return r.affectedRows;
}

module.exports = {
  huecos, proximosHuecos, reservar, cambiarEstado, deshacerEstado, ultimoCambio, confirmar, cancelar, confirmarRetenida,
  caducarRetenciones, cargarDia, sigueEnPie, ErrorAgenda,
};
