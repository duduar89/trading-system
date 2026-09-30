'use strict';
// Lista de espera: quien quiere un hueco que hoy no hay (o uno antes que el que tiene). La apunta
// recepción desde el panel o la IA cuando no le cuadra ningún hueco («¿Quieres que te avise si se
// libera un hueco antes?» → «sí»).
//
// Cuando se libera un hueco (cita cancelada o cambiada, o una retención que caduca) que sigue libre,
// es futuro y deja tiempo para venir, el cron se lo guarda 30 minutos al primero de la lista que
// encaja (mismo tratamiento, dentro de sus fechas y su franja) y se lo ofrece por WhatsApp
// (servidor/avisos-espera.js). Si dice que sí, la cita queda confirmada (y la que tenía, si era más
// tarde, cambiada a esta); si dice que no o no contesta, el hueco vuelve a quedar libre y pasa al
// siguiente. Un hueco guardado para alguien no se puede ofrecer a otro: la agenda ya no lo da por
// libre. Aquí no se manda nada: solo la base (las reglas puras, en motor/agenda/espera.js; así la
// repesca puede usar esto sin ciclos).
const T = require('../motor/tiempo');
const { FRANJAS, leSirve, normalizarTelefono } = require('../motor/agenda/espera');
const agenda = require('./agenda');
const { registrar } = require('./eventos');

const RETENCION_MIN = 30;       // lo que se le guarda el hueco mientras contesta
const ANTELACION_MIN = 120;     // un hueco que empieza en menos de 2 horas ya no se ofrece
const RECIENTES_H = 48;         // se miran las cancelaciones y cambios de las últimas 48 horas
const MAX_SIN_CONTESTAR = 2;    // quien deja dos ofertas sin contestar sale de la lista
const GRACIA_MIN = 60;          // un «sí» que llega tarde vale si el hueco sigue libre
const { ErrorAgenda } = agenda;

const fechaSql = (v) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const esFecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));

// Desde el panel se apunta a alguien por su móvil: si no tiene ficha, se le crea con su nombre.
async function pacientePorTelefono(q, { telefono, nombre }) {
  const tel = normalizarTelefono(telefono);
  if (!tel) throw new ErrorAgenda('TELEFONO', 'Indica un móvil válido (por ejemplo, 611 22 33 44)');
  const [[p]] = await q.query('SELECT id FROM pacientes WHERE telefono = ?', [tel]);
  if (p) return p.id;
  const [pila, ...resto] = String(nombre || '').trim().split(/\s+/);
  if (!pila) throw new ErrorAgenda('NOMBRE', 'Es un paciente nuevo: indica su nombre');
  const [r] = await q.query("INSERT INTO pacientes (nombre, apellidos, telefono, origen) VALUES (?, ?, ?, 'recepcion') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
    [pila.slice(0, 80), resto.join(' ').slice(0, 120) || null, tel]);
  return r.insertId;
}

// La cita que ya tiene para ese tratamiento: la que se apuntó al darle de alta si sigue en pie, o
// la próxima confirmada. Solo le interesa un hueco antes, y al aceptarlo se le cambia.
async function citaActual(q, entrada, ahora = new Date()) {
  if (entrada.cita_actual_id) {
    const [[c]] = await q.query('SELECT id, estado, inicio, retenida_hasta, origen FROM citas WHERE id = ?', [entrada.cita_actual_id]);
    if (agenda.sigueEnPie(c, ahora)) return c;
  }
  const [[c]] = await q.query(
    `SELECT id, estado, inicio, retenida_hasta, origen FROM citas
      WHERE paciente_id = ? AND tratamiento_id = ? AND estado = 'confirmada' AND inicio > ? ORDER BY inicio LIMIT 1`,
    [entrada.paciente_id, entrada.tratamiento_id, ahora]);
  return c || null;
}

/**
 * Apunta a alguien en la lista (o pone al día su apunte si ya esperaba ese tratamiento: conserva
 * su puesto).
 * @param {object} a pacienteId, tratamientoId, desdeFecha? (por defecto, hoy), hastaFecha?, franja?
 *   ('manana' | 'tarde'), citaActualId?, origen ('panel' | 'whatsapp'), creadoPor, notas?,
 *   conversacionId?, ahora
 */
async function apuntar(q, a) {
  const ahora = a.ahora || new Date();
  const hoy = T.fechaMadrid(ahora);
  const [[trat]] = await q.query('SELECT id FROM tratamientos WHERE id = ? AND activo = TRUE', [a.tratamientoId || '']);
  if (!trat) throw new ErrorAgenda('TRATAMIENTO_DESCONOCIDO', 'Ese tratamiento no existe');
  const [[pac]] = await q.query('SELECT id FROM pacientes WHERE id = ?', [a.pacienteId || 0]);
  if (!pac) throw new ErrorAgenda('PACIENTE_DESCONOCIDO', 'No existe ese paciente');
  if ((a.desdeFecha && !esFecha(a.desdeFecha)) || (a.hastaFecha && !esFecha(a.hastaFecha))) throw new ErrorAgenda('FECHAS', 'Las fechas van como AAAA-MM-DD');
  const desde = a.desdeFecha && a.desdeFecha > hoy ? a.desdeFecha : hoy;
  const hasta = a.hastaFecha || null;
  if (hasta && hasta < desde) throw new ErrorAgenda('FECHAS', 'La fecha «hasta» ya ha pasado o es anterior a «desde»');
  const franja = FRANJAS.includes(a.franja) ? a.franja : null;
  let citaActualId = null;
  if (a.citaActualId) {
    const [[c]] = await q.query('SELECT id FROM citas WHERE id = ? AND paciente_id = ?', [a.citaActualId, pac.id]);
    if (!c) throw new ErrorAgenda('CITA_DESCONOCIDA', 'Esa cita no es de este paciente');
    citaActualId = c.id;
  }
  const [[ya]] = await q.query(
    "SELECT id FROM lista_espera WHERE paciente_id = ? AND tratamiento_id = ? AND estado IN ('esperando','ofrecido') ORDER BY id LIMIT 1",
    [pac.id, trat.id]);
  if (ya) {
    await q.query('UPDATE lista_espera SET desde_fecha = ?, hasta_fecha = ?, franjas = ?, cita_actual_id = COALESCE(?, cita_actual_id), notas = COALESCE(?, notas) WHERE id = ?',
      [desde, hasta, franja, citaActualId, a.notas || null, ya.id]);
    await registrar(q, { tipo: 'lista_espera_cambio', entidad: 'lista_espera', entidadId: ya.id, actor: a.creadoPor, datos: { desde, hasta, franja } });
    return { id: ya.id, nueva: false };
  }
  const [r] = await q.query(
    `INSERT INTO lista_espera (paciente_id, tratamiento_id, cita_actual_id, desde_fecha, hasta_fecha, franjas, origen, creado_por, notas, conversacion_id, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [pac.id, trat.id, citaActualId, desde, hasta, franja, a.origen === 'whatsapp' ? 'whatsapp' : 'panel', a.creadoPor || null,
      a.notas ? String(a.notas).slice(0, 255) : null, a.conversacionId || null, ahora]);
  await registrar(q, { tipo: 'lista_espera_alta', entidad: 'lista_espera', entidadId: r.insertId, actor: a.creadoPor, datos: { tratamiento: trat.id, desde, hasta, franja, origen: a.origen } });
  return { id: r.insertId, nueva: true };
}

// Anula las ofertas en curso que cumplan «donde» y libera sus huecos (el cron los ofrece al siguiente).
async function anularOfertas(q, donde, params, { ahora, motivo }) {
  await q.query(
    `UPDATE citas c JOIN lista_espera_ofertas o ON o.cita_id = c.id JOIN lista_espera le ON le.id = o.lista_espera_id
        SET c.estado = 'cancelada', c.cancelada_en = ?, c.cancelada_por = 'sistema', c.motivo_cancelacion = ?, c.retenida_hasta = NULL
      WHERE ${donde} AND o.estado = 'ofrecida' AND c.estado = 'retenida'`, [ahora, `lista de espera: ${motivo}`, ...params]);
  await q.query(`UPDATE lista_espera_ofertas o JOIN lista_espera le ON le.id = o.lista_espera_id SET o.estado = 'anulada', o.respondida_en = ?
                  WHERE ${donde} AND o.estado = 'ofrecida'`, [ahora, ...params]);
}

// Sale de la lista (desde el panel o porque lo pide). Si se le estaba guardando un hueco, queda libre.
async function quitar(q, id, { motivo = null, actor = 'panel', ahora = new Date() } = {}) {
  await anularOfertas(q, 'le.id = ?', [id], { ahora, motivo: 'sale de la lista' });
  const [r] = await q.query("UPDATE lista_espera SET estado = 'cancelado', cerrado_en = ? WHERE id = ? AND estado IN ('esperando','ofrecido')", [ahora, id]);
  if (r.affectedRows) await registrar(q, { tipo: 'lista_espera_baja', entidad: 'lista_espera', entidadId: id, actor, datos: { motivo } });
  return r.affectedRows === 1;
}

// «No me escribáis más»: fuera de la lista en el acto (dentro de la transacción de la baja).
async function quitarPorBaja(con, pacienteId, ahora) {
  await anularOfertas(con, 'le.paciente_id = ?', [pacienteId], { ahora, motivo: 'baja' });
  await con.query("UPDATE lista_espera SET estado = 'cancelado', cerrado_en = ? WHERE paciente_id = ? AND estado IN ('esperando','ofrecido')", [ahora, pacienteId]);
}

// Una conversación que solo esperaba esto se cierra (si contesta, se abre otra o se reabre).
async function cerrarConversacion(q, conversacionId, motivo) {
  if (!conversacionId) return;
  await q.query(
    `UPDATE conversaciones c SET c.estado = 'cerrada', c.motivo_cierre = ?, c.proximo_paso = 'cerrada', c.proximo_paso_en = NULL
      WHERE c.id = ? AND c.estado IN ('ia_activa','esperando_paciente')
        AND NOT EXISTS (SELECT 1 FROM seguimientos s WHERE s.conversacion_id = c.id AND s.estado = 'pendiente')
        AND NOT EXISTS (SELECT 1 FROM tareas t WHERE t.conversacion_id = c.id AND t.estado = 'abierta')`, [motivo, conversacionId]);
}

// Huecos liberados hace poco (cita cancelada o cambiada, o retención caducada) que alguien de la
// lista espera: futuros, con tiempo para venir, sin una oferta en curso y sin otra cita igual ya
// puesta encima. Varias citas del mismo hueco (la cancelada y las ofertas que se rechazaron
// después) cuentan como uno. Que siga libre de verdad lo comprueba la agenda al guardarlo.
async function huecosLiberados(q, ahora = new Date()) {
  const [filas] = await q.query(
    `SELECT c.id, c.paciente_id, c.tratamiento_id, c.inicio FROM citas c
      WHERE c.estado IN ('cancelada','reprogramada') AND c.cancelada_en >= ? AND c.inicio > ?
        AND EXISTS (SELECT 1 FROM lista_espera le WHERE le.tratamiento_id = c.tratamiento_id AND le.estado = 'esperando')
        AND NOT EXISTS (SELECT 1 FROM lista_espera_ofertas o WHERE o.tratamiento_id = c.tratamiento_id AND o.inicio = c.inicio AND o.estado = 'ofrecida')
        AND NOT EXISTS (SELECT 1 FROM citas v WHERE v.tratamiento_id = c.tratamiento_id AND v.inicio = c.inicio
                          AND (v.estado IN ('confirmada','llegada','en_curso','completada','no_presentada') OR (v.estado = 'retenida' AND v.retenida_hasta > ?)))
      ORDER BY c.inicio, c.id`,
    [new Date(ahora.getTime() - RECIENTES_H * 3600000), new Date(ahora.getTime() + ANTELACION_MIN * 60000), ahora]);
  const porHueco = new Map();
  for (const f of filas) {
    const inicio = new Date(f.inicio);
    const clave = `${f.tratamiento_id}|${inicio.toISOString()}`;
    if (!porHueco.has(clave)) {
      porHueco.set(clave, { tratamientoId: f.tratamiento_id, inicio, fecha: T.fechaMadrid(inicio), hora: T.hhmm(T.minutosMadrid(inicio)), liberadaPor: f.id, pacientes: [] });
    }
    porHueco.get(clave).pacientes.push(f.paciente_id);
  }
  return [...porHueco.values()];
}

// El primero de la lista al que le encaja el hueco: mismo tratamiento, dentro de sus fechas y su
// franja, sin haberlo tenido ya (si dijo que no o no contestó, pasa al siguiente), con teléfono y
// sin una persona llevando su conversación. Quien lo acaba de dejar libre no cuenta.
async function candidato(q, hueco, ahora = new Date()) {
  const [filas] = await q.query(
    `SELECT le.*, p.nombre, p.telefono FROM lista_espera le JOIN pacientes p ON p.id = le.paciente_id
      WHERE le.estado = 'esperando' AND le.tratamiento_id = ? AND le.desde_fecha <= ? AND (le.hasta_fecha IS NULL OR le.hasta_fecha >= ?)
        AND p.telefono IS NOT NULL AND le.paciente_id NOT IN (?)
        AND NOT EXISTS (SELECT 1 FROM lista_espera_ofertas o WHERE o.lista_espera_id = le.id AND o.tratamiento_id = ? AND o.inicio = ?)
        AND NOT EXISTS (SELECT 1 FROM conversaciones cv WHERE cv.telefono = p.telefono AND cv.estado IN ('persona','espera_persona'))
      ORDER BY le.creado_en, le.id`,
    [hueco.tratamientoId, hueco.fecha, hueco.fecha, hueco.pacientes.length ? hueco.pacientes : [0], hueco.tratamientoId, hueco.inicio]);
  const minutos = T.minutosDe(hueco.hora);
  for (const le of filas) {
    // Su franja; y si ya tiene cita, solo si el hueco es antes (motor/agenda/espera.js).
    const actual = await citaActual(q, le, ahora);
    if (leSirve({ inicio: hueco.inicio, minutos }, le, actual)) return { ...le, citaActual: actual };
  }
  return null;
}

// Le guarda el hueco (cita retenida 30 minutos) y apunta la oferta. null si ya no está libre.
async function guardarHueco(q, { entrada, hueco, ahora = new Date() }) {
  let cita;
  try {
    cita = await agenda.reservar(q, {
      pacienteId: entrada.paciente_id, tratamientoId: hueco.tratamientoId, fecha: hueco.fecha, hora: hueco.hora,
      retener: true, retenerMin: RETENCION_MIN, origen: entrada.citaActual?.origen || 'ia_whatsapp', actor: 'lista_espera', ahora,
    });
  } catch (err) {
    if (err.codigo === 'HUECO_OCUPADO') return null;
    throw err;
  }
  const caducaEn = new Date(ahora.getTime() + RETENCION_MIN * 60000);
  let r;
  try {
    [r] = await q.query(
      `INSERT INTO lista_espera_ofertas (lista_espera_id, cita_id, liberada_por_cita_id, tratamiento_id, inicio, ofrecida_en, caduca_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [entrada.id, cita.id, hueco.liberadaPor || null, hueco.tratamientoId, cita.inicio, ahora, caducaEn]);
  } catch (err) {
    // Ya lo tuvo (no debería pasar: el candidato lo descarta): el hueco se suelta.
    await q.query("UPDATE citas SET estado = 'cancelada', cancelada_en = ?, cancelada_por = 'sistema', motivo_cancelacion = 'lista de espera: repetida' WHERE id = ?", [ahora, cita.id]);
    if (err.code === 'ER_DUP_ENTRY') return null;
    throw err;
  }
  await q.query("UPDATE lista_espera SET estado = 'ofrecido' WHERE id = ?", [entrada.id]);
  await registrar(q, { tipo: 'lista_espera_oferta', entidad: 'lista_espera', entidadId: entrada.id, datos: { oferta: r.insertId, cita: cita.id, fecha: hueco.fecha, hora: hueco.hora, liberadaPor: hueco.liberadaPor } });
  return { id: r.insertId, citaId: cita.id, caducaEn };
}

// No se le pudo avisar (sin plantilla, WhatsApp caído): el hueco se suelta y él sigue esperando.
async function anularOferta(q, ofertaId, { ahora = new Date(), motivo }) {
  const [[o]] = await q.query('SELECT lista_espera_id FROM lista_espera_ofertas WHERE id = ?', [ofertaId]);
  await anularOfertas(q, 'o.id = ?', [ofertaId], { ahora, motivo });
  if (o) await q.query("UPDATE lista_espera SET estado = 'esperando' WHERE id = ? AND estado = 'ofrecido'", [o.lista_espera_id]);
}

// La oferta a la que puede estar contestando: la que está en curso o una que acaba de caducar (si
// contesta tarde y el hueco sigue libre, se le da igual).
async function ofertaParaResponder(q, pacienteId, ahora = new Date()) {
  const [[o]] = await q.query(
    `SELECT o.* FROM lista_espera_ofertas o JOIN lista_espera le ON le.id = o.lista_espera_id
      WHERE le.paciente_id = ? AND le.estado <> 'cancelado' AND o.inicio > ?
        AND (o.estado = 'ofrecida' OR (o.estado = 'caducada' AND o.caduca_en > ?))
      ORDER BY o.id DESC LIMIT 1`,
    [pacienteId, ahora, new Date(ahora.getTime() - GRACIA_MIN * 60000)]);
  if (!o) return null;
  const inicio = new Date(o.inicio);
  return { ...o, fecha: T.fechaMadrid(inicio), hora: T.hhmm(T.minutosMadrid(inicio)) };
}

// Dice que sí: la cita retenida queda confirmada (y la que tenía más tarde, cambiada a esta). Si se
// le pasó la media hora pero el hueco sigue libre, se le reserva igual; si no, sigue en la lista.
async function aceptar(q, oferta, { ahora = new Date() } = {}) {
  const [[le]] = await q.query('SELECT * FROM lista_espera WHERE id = ?', [oferta.lista_espera_id]);
  const actual = await citaActual(q, le, ahora);
  const reprograma = actual && new Date(actual.inicio) > new Date(oferta.inicio) && actual.origen !== 'treatwell' ? actual.id : null;
  let cita = null;
  if (oferta.estado === 'ofrecida' && oferta.cita_id) {
    try {
      cita = await agenda.confirmar(q, { id: oferta.cita_id, actor: 'paciente', reprograma, ahora });
    } catch (err) {
      if (!['RETENCION_CADUCADA', 'ESTADO_NO_VALIDO'].includes(err.codigo)) throw err;
    }
  }
  if (!cita) {
    try {
      cita = await agenda.reservar(q, {
        pacienteId: le.paciente_id, tratamientoId: oferta.tratamiento_id, fecha: oferta.fecha, hora: oferta.hora,
        origen: 'ia_whatsapp', actor: 'paciente', reprograma, ahora,
      });
    } catch (err) {
      if (err.codigo !== 'HUECO_OCUPADO') throw err;
      await q.query("UPDATE lista_espera_ofertas SET estado = 'caducada', respondida_en = ? WHERE id = ? AND estado = 'ofrecida'", [ahora, oferta.id]);
      await q.query("UPDATE lista_espera SET estado = 'esperando' WHERE id = ? AND estado = 'ofrecido'", [le.id]);
      return { ocupado: true };
    }
  }
  await q.query("UPDATE lista_espera_ofertas SET estado = 'aceptada', cita_id = ?, respondida_en = ? WHERE id = ?", [cita.id, ahora, oferta.id]);
  await q.query("UPDATE lista_espera SET estado = 'aceptado', cerrado_en = ? WHERE id = ?", [ahora, le.id]);
  await registrar(q, { tipo: 'lista_espera_aceptada', entidad: 'lista_espera', entidadId: le.id, actor: 'paciente', datos: { oferta: oferta.id, cita: cita.id, reprograma: cita.reprograma || null } });
  return { citaId: cita.id, reprograma: cita.reprograma || null };
}

// Dice que no: el hueco queda libre (el cron se lo ofrece al siguiente) y él sigue en la lista.
async function rechazar(q, oferta, { ahora = new Date() } = {}) {
  if (oferta.estado !== 'ofrecida') return false;
  if (oferta.cita_id) {
    try {
      await agenda.cancelar(q, { id: oferta.cita_id, por: 'paciente', motivo: 'lista de espera: no le viene bien', actor: 'paciente', ahora });
    } catch (err) {
      if (err.codigo !== 'ESTADO_NO_VALIDO') throw err;
    }
  }
  await q.query("UPDATE lista_espera_ofertas SET estado = 'rechazada', respondida_en = ? WHERE id = ? AND estado = 'ofrecida'", [ahora, oferta.id]);
  await q.query("UPDATE lista_espera SET estado = 'esperando' WHERE id = ? AND estado = 'ofrecido'", [oferta.lista_espera_id]);
  await registrar(q, { tipo: 'lista_espera_rechazada', entidad: 'lista_espera', entidadId: oferta.lista_espera_id, actor: 'paciente', datos: { oferta: oferta.id } });
  return true;
}

// Ofertas sin respuesta a la media hora: el hueco se libera y pasa al siguiente. Quien deja dos sin
// contestar sale de la lista (para no tener huecos guardados que nadie usa); y los apuntes cuya
// fecha «hasta» ya pasó, también.
async function caducarOfertas(q, { ahora = new Date() } = {}) {
  const [vencidas] = await q.query("SELECT id, cita_id, lista_espera_id, conversacion_id FROM lista_espera_ofertas WHERE estado = 'ofrecida' AND caduca_en <= ?", [ahora]);
  let caducadas = 0;
  for (const o of vencidas) {
    const [r] = await q.query("UPDATE lista_espera_ofertas SET estado = 'caducada' WHERE id = ? AND estado = 'ofrecida'", [o.id]);
    if (r.affectedRows !== 1) continue; // contestó justo a la vez
    caducadas++;
    if (o.cita_id) {
      await q.query(`UPDATE citas SET estado = 'cancelada', cancelada_en = ?, cancelada_por = 'sistema', motivo_cancelacion = 'lista de espera: sin respuesta', retenida_hasta = NULL
                      WHERE id = ? AND estado = 'retenida'`, [ahora, o.cita_id]);
    }
    const [[n]] = await q.query("SELECT COUNT(*) AS n FROM lista_espera_ofertas WHERE lista_espera_id = ? AND estado = 'caducada'", [o.lista_espera_id]);
    const fuera = Number(n.n) >= MAX_SIN_CONTESTAR;
    await q.query("UPDATE lista_espera SET estado = ?, cerrado_en = ? WHERE id = ? AND estado = 'ofrecido'", [fuera ? 'caducado' : 'esperando', fuera ? ahora : null, o.lista_espera_id]);
    await cerrarConversacion(q, o.conversacion_id, 'lista_espera');
    await registrar(q, { tipo: 'lista_espera_sin_respuesta', entidad: 'lista_espera', entidadId: o.lista_espera_id, datos: { oferta: o.id, sale: fuera } });
  }
  const [viejos] = await q.query("UPDATE lista_espera SET estado = 'caducado', cerrado_en = ? WHERE estado = 'esperando' AND hasta_fecha < ?", [ahora, T.fechaMadrid(ahora)]);
  return { caducadas, fueraDePlazo: viejos.affectedRows };
}

// Para el panel: quién espera (con su cita actual, si la tiene), las ofertas en curso y las últimas.
async function listar(q, { ahora = new Date() } = {}) {
  const [entradas] = await q.query(
    `SELECT le.*, p.nombre, p.apellidos, p.telefono, t.nombre AS tratamiento
       FROM lista_espera le JOIN pacientes p ON p.id = le.paciente_id JOIN tratamientos t ON t.id = le.tratamiento_id
      WHERE le.estado IN ('esperando','ofrecido') ORDER BY le.creado_en, le.id`);
  const [ofertas] = await q.query(
    `SELECT o.*, p.nombre, p.apellidos, t.nombre AS tratamiento FROM lista_espera_ofertas o
       JOIN lista_espera le ON le.id = o.lista_espera_id JOIN pacientes p ON p.id = le.paciente_id JOIN tratamientos t ON t.id = o.tratamiento_id
      WHERE o.estado = 'ofrecida' OR o.ofrecida_en >= ? ORDER BY o.estado = 'ofrecida' DESC, o.id DESC LIMIT 60`,
    [new Date(ahora.getTime() - 14 * 86400000)]);
  const [[recuperados]] = await q.query("SELECT COUNT(*) AS n FROM lista_espera_ofertas WHERE estado = 'aceptada' AND respondida_en >= ?", [new Date(ahora.getTime() - 30 * 86400000)]);
  const nombre = (x) => [x.nombre, x.apellidos ? `${x.apellidos[0]}.` : ''].join(' ').trim();
  const lista = [];
  for (const e of entradas) {
    const actual = await citaActual(q, e, ahora);
    lista.push({
      id: e.id, pacienteId: e.paciente_id, paciente: nombre(e), telefonoFinal: String(e.telefono || '').slice(-3),
      tratamientoId: e.tratamiento_id, tratamiento: e.tratamiento, desde: fechaSql(e.desde_fecha), hasta: fechaSql(e.hasta_fecha),
      franja: e.franjas || null, estado: e.estado, origen: e.origen, creadoPor: e.creado_por, notas: e.notas, creado: e.creado_en,
      citaActual: actual ? actual.inicio : null,
    });
  }
  return {
    entradas: lista,
    ofertas: ofertas.map((o) => ({
      id: o.id, entradaId: o.lista_espera_id, paciente: nombre(o), tratamiento: o.tratamiento, inicio: o.inicio,
      estado: o.estado, ofrecida: o.ofrecida_en, caduca: o.caduca_en, respondida: o.respondida_en,
    })),
    cifras: {
      esperando: lista.length,
      enCurso: ofertas.filter((o) => o.estado === 'ofrecida').length,
      recuperados30d: Number(recuperados.n),
    },
  };
}

module.exports = {
  RETENCION_MIN, ANTELACION_MIN, pacientePorTelefono, citaActual, apuntar, quitar, quitarPorBaja,
  cerrarConversacion, huecosLiberados, candidato, guardarHueco, anularOferta, ofertaParaResponder, aceptar, rechazar,
  caducarOfertas, listar,
};
