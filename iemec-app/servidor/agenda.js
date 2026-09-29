'use strict';
// Agenda con la base: carga el día, busca huecos y reserva sin dobles. La reserva bloquea las filas
// de las salas, profesionales y aparatos candidatos (siempre en el mismo orden, para no
// interbloquearse), vuelve a calcular los huecos con lo último que hay en la base y solo entonces
// inserta. Dos reservas a la vez del mismo hueco: entra una y la otra recibe HUECO_OCUPADO.
const crypto = require('crypto');
const T = require('../motor/tiempo');
const { prepararDia, huecoAInstantes, tratamientoParaMotor } = require('../motor/agenda/dia');
const { buscarHuecos, proponer } = require('../motor/agenda/huecos');
const { registrar } = require('./eventos');

class ErrorAgenda extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
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

async function cargarDia(con, fecha, { ahora = new Date(), antelacionMin = 60 } = {}) {
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
                      FROM citas WHERE sala_desde < ? AND sala_hasta > ?`, [hasta, desde]),
  });
}

// Las columnas DATE llegan como Date a medianoche UTC: se devuelven como 'AAAA-MM-DD'.
function fechaSql(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

async function huecos(pool, { fecha, tratamientoId, ahora = new Date(), antelacionMin = 60 }) {
  const con = await pool.getConnection();
  try {
    const t = await cargarTratamiento(con, tratamientoId);
    const dia = await cargarDia(con, fecha, { ahora, antelacionMin });
    return buscarHuecos(dia, t.motor).map((h) => ({ ...h, hora: T.hhmm(h.inicio), fecha }));
  } finally {
    con.release();
  }
}

// Huecos de los próximos días (para proponer al paciente).
async function proximosHuecos(pool, { tratamientoId, desdeFecha, dias = 14, n = 3, preferencia = null, ahora = new Date() }) {
  const salida = [];
  for (let i = 0; i < dias && salida.length < n; i++) {
    const fecha = T.sumarDias(desdeFecha, i);
    const lista = await huecos(pool, { fecha, tratamientoId, ahora });
    for (const h of proponer(lista, { n: n - salida.length, preferencia })) salida.push(h);
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
 *   origen, retener (deja la cita «retenida» unos minutos hasta que el paciente confirme), actor
 */
async function reservar(pool, p) {
  const ahora = p.ahora || new Date();
  const con = await pool.getConnection();
  try {
    await con.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await con.beginTransaction();
    const t = await cargarTratamiento(con, p.tratamientoId);
    await bloquearRecursos(con, t.motor);
    const dia = await cargarDia(con, p.fecha, { ahora, antelacionMin: p.antelacionMin ?? 0 });
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
    const retenidaHasta = p.retener ? new Date(ahora.getTime() + (clinica?.retencion_hueco_min || 15) * 60000) : null;
    const token = crypto.randomBytes(32).toString('base64url');
    const [r] = await con.query(
      `INSERT INTO citas (paciente_id, tratamiento_id, profesional_id, sala_id, equipo_id, inicio, fin,
         sala_desde, sala_hasta, prof_desde, prof_hasta, estado, retenida_hasta, origen, primera_visita,
         token, creada_por, confirmada_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.pacienteId, t.fila.id, hueco.profesionalId, hueco.salaId, hueco.equipoId, inst.inicio, inst.fin,
        inst.sala_desde, inst.sala_hasta, inst.prof_desde, inst.prof_hasta,
        p.retener ? 'retenida' : 'confirmada', retenidaHasta, p.origen || 'recepcion', Boolean(p.primeraVisita),
        token, p.actor || 'sistema', p.retener ? null : ahora]);
    await registrar(con, { tipo: p.retener ? 'cita_retenida' : 'cita_reservada', entidad: 'cita', entidadId: r.insertId, actor: p.actor, datos: { fecha: p.fecha, hora: p.hora, tratamiento: t.fila.id, profesional: hueco.profesionalId, sala: hueco.salaId } });
    await con.commit();
    return { id: r.insertId, token, estado: p.retener ? 'retenida' : 'confirmada', retenidaHasta, ...inst, profesionalId: hueco.profesionalId, salaId: hueco.salaId, equipoId: hueco.equipoId };
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
}

async function cambiarEstado(pool, { id, token, de, a, actor = 'sistema', motivo = null, por = null, ahora = new Date() }) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const [[cita]] = await con.query(`SELECT * FROM citas WHERE ${id ? 'id = ?' : 'token = ?'} FOR UPDATE`, [id || token]);
    if (!cita) throw new ErrorAgenda('CITA_DESCONOCIDA', 'No existe esa cita');
    if (!de.includes(cita.estado)) throw new ErrorAgenda('ESTADO_NO_VALIDO', `La cita está ${cita.estado}`);
    if (cita.estado === 'retenida' && a === 'confirmada' && cita.retenida_hasta && new Date(cita.retenida_hasta) <= ahora) {
      throw new ErrorAgenda('RETENCION_CADUCADA', 'El hueco se ha liberado: hay que elegir otro');
    }
    const cambios = { estado: a };
    if (a === 'confirmada') { cambios.confirmada_en = ahora; cambios.retenida_hasta = null; }
    if (a === 'cancelada') { cambios.cancelada_en = ahora; cambios.motivo_cancelacion = motivo; cambios.cancelada_por = por; cambios.secuencia_ics = cita.secuencia_ics + 1; }
    await con.query('UPDATE citas SET ? WHERE id = ?', [cambios, cita.id]);
    await registrar(con, { tipo: `cita_${a}`, entidad: 'cita', entidadId: cita.id, actor, datos: { de: cita.estado, motivo } });
    await con.commit();
    return { ...cita, ...cambios };
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
}

const confirmar = (pool, o) => cambiarEstado(pool, { ...o, de: ['retenida', 'confirmada'], a: 'confirmada' });
const cancelar = (pool, o) => cambiarEstado(pool, { ...o, de: ['retenida', 'confirmada'], a: 'cancelada' });

// Libera las retenciones caducadas (lo llama el cron cada minuto).
async function caducarRetenciones(pool, ahora = new Date()) {
  const [r] = await pool.query(
    "UPDATE citas SET estado = 'cancelada', cancelada_por = 'sistema', motivo_cancelacion = 'retención caducada', cancelada_en = ? WHERE estado = 'retenida' AND retenida_hasta <= ?",
    [ahora, ahora]);
  return r.affectedRows;
}

module.exports = { huecos, proximosHuecos, reservar, confirmar, cancelar, caducarRetenciones, cargarDia, ErrorAgenda };
