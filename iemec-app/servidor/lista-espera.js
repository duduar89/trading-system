'use strict';
// Lista de espera: quien quiere un hueco que hoy no hay (o uno antes que la cita que tiene). La
// apunta recepción desde el panel o la IA cuando no le cuadra ningún hueco («¿Quieres que te avise si
// se libera un hueco antes?» → «sí»).
//
// Cuando se libera un hueco (cita cancelada o cambiada, o una retención que caduca) que sigue libre,
// es futuro y deja tiempo para venir, el cron se lo guarda 30 minutos al primero de la lista que
// encaja (mismo tratamiento, dentro de sus fechas y su franja) y se lo ofrece por WhatsApp
// (servidor/avisos-espera.js). Si dice que sí, la cita queda confirmada (y si se apuntó para adelantar
// su cita, esa se cambia a esta); si dice que no o no contesta, el hueco vuelve a quedar libre y pasa
// al siguiente. Un hueco guardado para alguien no se puede ofrecer a otro: la agenda ya no lo da por
// libre. Aquí no se manda nada: solo la base (las reglas puras, en motor/agenda/espera.js; así la
// repesca puede usar esto sin ciclos).
const T = require('../motor/tiempo');
const { FRANJAS, leSirve, normalizarTelefono, esFijoEspanol } = require('../motor/agenda/espera');
const { normalizar } = require('../motor/repesca/interpretar');
const { DIAS, MESES } = require('../motor/repesca/plazos');
const agenda = require('./agenda');
const { registrar } = require('./eventos');

const RETENCION_MIN = 30;       // lo que se le guarda el hueco mientras contesta
const ANTELACION_MIN = 120;     // un hueco que empieza en menos de 2 horas ya no se ofrece
const RECIENTES_H = 48;         // se miran las cancelaciones y cambios de las últimas 48 horas
const MAX_SIN_CONTESTAR = 2;    // quien deja dos ofertas sin contestar sale de la lista
const GRACIA_MIN = 60;          // un «sí» que llega tarde vale si el hueco sigue libre
const MARGEN_MIN = 2;           // lo que caduca espera un par de minutos antes de pasar al siguiente
const { ErrorAgenda } = agenda;

const fechaSql = (v) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const esFecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
const nombreCorto = (x) => [x.nombre, x.apellidos ? `${x.apellidos[0]}.` : ''].join(' ').trim();
// «el miércoles 21 de octubre a las 12:00» (para las tareas de recepción).
function cuando(inicio) {
  const d = new Date(inicio);
  const f = T.fechaMadrid(d);
  return `${DIAS[T.diaSemana(f)]} ${Number(f.slice(8, 10))} de ${MESES[Number(f.slice(5, 7))]} a las ${T.hhmm(T.minutosMadrid(d))}`;
}

// ¿Es la misma persona? El nombre que teclea recepción contra el de la ficha (sin tildes ni mayúsculas;
// basta el de pila).
function mismoNombre(tecleado, ficha) {
  const pila = (s) => normalizar(s).split(/\s+/)[0] || '';
  return !tecleado || !pila(tecleado) || pila(tecleado) === pila(ficha.nombre);
}

// Desde el panel se apunta a alguien por su móvil: si no tiene ficha, se le crea con su nombre. Un fijo
// no vale (los avisos van por WhatsApp) y, si el móvil es de otra persona que la que se ha tecleado, se
// pide confirmación antes: el aviso, con su tratamiento, le llegaría a ella.
async function pacientePorTelefono(q, { telefono, nombre, confirmado = false }) {
  const tel = normalizarTelefono(telefono);
  if (!tel) throw new ErrorAgenda('TELEFONO', 'Indica un móvil válido (por ejemplo, 611 22 33 44)');
  if (esFijoEspanol(tel)) throw new ErrorAgenda('FIJO', 'Ese teléfono es un fijo y los avisos de la lista de espera van por WhatsApp: indica su móvil');
  const [[p]] = await q.query('SELECT id, nombre, apellidos FROM pacientes WHERE telefono = ?', [tel]);
  if (p) {
    if (!confirmado && !mismoNombre(nombre, p)) {
      const err = new ErrorAgenda('OTRO_PACIENTE', `Ese móvil es de ${nombreCorto(p)}: si es a quien quieres apuntar, confírmalo; si no, revisa el número`);
      err.paciente = nombreCorto(p);
      throw err;
    }
    return p.id;
  }
  const [pila, ...resto] = String(nombre || '').trim().split(/\s+/);
  if (!pila) throw new ErrorAgenda('NOMBRE', 'Es un paciente nuevo: indica su nombre');
  const [r] = await q.query("INSERT INTO pacientes (nombre, apellidos, telefono, origen) VALUES (?, ?, ?, 'recepcion') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
    [pila.slice(0, 80), resto.join(' ').slice(0, 120) || null, tel]);
  return r.insertId;
}

// La cita enlazada al apuntarle, siguiendo sus cambios de día (si la movió, la nueva). Tal cual esté.
async function citaEnlazada(q, entrada) {
  let id = entrada.cita_actual_id;
  for (let i = 0; id && i < 5; i++) {
    const [[c]] = await q.query('SELECT id, estado, inicio, retenida_hasta, origen, reprograma_a_id FROM citas WHERE id = ?', [id]);
    if (!c || c.estado !== 'reprogramada' || !c.reprograma_a_id) return c || null;
    id = c.reprograma_a_id;
  }
  return null;
}

// La cita que quiere adelantar, si sigue en pie. Solo la que se enlazó al apuntarle: tener otra cita
// del mismo tratamiento no dice nada (puede estar esperando otra sesión), así que no se deduce.
async function citaActual(q, entrada, ahora = new Date()) {
  const c = await citaEnlazada(q, entrada);
  return agenda.sigueEnPie(c, ahora) ? c : null;
}

/**
 * Apunta a alguien en la lista (o pone al día su apunte si ya esperaba ese tratamiento: conserva
 * su puesto).
 * @param {object} a pacienteId, tratamientoId, desdeFecha? (por defecto, hoy), hastaFecha?, franja?
 *   ('manana' | 'tarde'), citaActualId? o adelantar? (la cita que quiere adelantar: la indicada, o con
 *   adelantar, la próxima que tiene de ese tratamiento), origen ('panel' | 'whatsapp'), creadoPor,
 *   notas?, conversacionId?, ahora
 */
async function apuntar(q, a) {
  const ahora = a.ahora || new Date();
  const hoy = T.fechaMadrid(ahora);
  const [[trat]] = await q.query('SELECT id FROM tratamientos WHERE id = ? AND activo = TRUE', [a.tratamientoId || '']);
  if (!trat) throw new ErrorAgenda('TRATAMIENTO_DESCONOCIDO', 'Ese tratamiento no existe');
  const [[pac]] = await q.query('SELECT id, telefono FROM pacientes WHERE id = ?', [a.pacienteId || 0]);
  if (!pac) throw new ErrorAgenda('PACIENTE_DESCONOCIDO', 'No existe ese paciente');
  if (esFijoEspanol(pac.telefono)) throw new ErrorAgenda('FIJO', 'Su teléfono es un fijo y los avisos de la lista de espera van por WhatsApp: pon su móvil en la ficha');
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
  } else if (a.adelantar) {
    const [[c]] = await q.query(
      "SELECT id FROM citas WHERE paciente_id = ? AND tratamiento_id = ? AND estado = 'confirmada' AND inicio > ? ORDER BY inicio LIMIT 1",
      [pac.id, trat.id, ahora]);
    if (!c) throw new ErrorAgenda('SIN_CITA', 'No tiene ninguna cita de ese tratamiento que adelantar');
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
  await registrar(q, { tipo: 'lista_espera_alta', entidad: 'lista_espera', entidadId: r.insertId, actor: a.creadoPor, datos: { tratamiento: trat.id, desde, hasta, franja, origen: a.origen, adelanta: citaActualId } });
  return { id: r.insertId, nueva: true };
}

// La IA le acaba de dar cita (la eligió él) de un tratamiento que esperaba: si su espera acababa antes
// de esa cita («avísame si hay algo antes»), su apunte pasa a ser «adelantar esa cita»; si no, ya
// tiene lo que esperaba y sale de la lista.
async function trasReservar(q, { pacienteId, tratamientoId, citaId, fecha, ahora = new Date() }) {
  await q.query(
    `UPDATE lista_espera SET cita_actual_id = ? WHERE paciente_id = ? AND tratamiento_id = ? AND estado = 'esperando'
        AND cita_actual_id IS NULL AND hasta_fecha IS NOT NULL AND hasta_fecha < ?`, [citaId, pacienteId, tratamientoId, fecha]);
  await q.query(
    `UPDATE lista_espera SET estado = 'aceptado', cerrado_en = ? WHERE paciente_id = ? AND tratamiento_id = ? AND estado = 'esperando'
        AND cita_actual_id IS NULL`, [ahora, pacienteId, tratamientoId]);
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

// La tarea que se abrió para recepción con esta oferta ya no hace falta.
async function cerrarTarea(q, oferta, ahora) {
  if (oferta?.tarea_id) await q.query("UPDATE tareas SET estado = 'hecha', hecha_en = ? WHERE id = ? AND estado = 'abierta'", [ahora, oferta.tarea_id]);
}

// Sale de la lista (desde el panel o porque lo pide). Si se le estaba guardando un hueco, queda libre.
async function quitar(q, id, { motivo = null, actor = 'panel', ahora = new Date() } = {}) {
  await anularOfertas(q, 'le.id = ?', [id], { ahora, motivo: 'sale de la lista' });
  const [r] = await q.query("UPDATE lista_espera SET estado = 'cancelado', cerrado_en = ? WHERE id = ? AND estado IN ('esperando','ofrecido')", [ahora, id]);
  if (r.affectedRows) await registrar(q, { tipo: 'lista_espera_baja', entidad: 'lista_espera', entidadId: id, actor, datos: { motivo } });
  return r.affectedRows === 1;
}

// Lo que sigue esperando de un paciente (para «sácame de la lista de espera»).
async function activasDe(q, pacienteId) {
  const [filas] = await q.query("SELECT id FROM lista_espera WHERE paciente_id = ? AND estado IN ('esperando','ofrecido')", [pacienteId]);
  return filas.map((f) => f.id);
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

// ¿Se le puede escribir un texto libre? La ventana de 24 h es de su teléfono, sea cual sea la conversación.
async function ventanaAbierta(q, telefono, ahora = new Date()) {
  const [[v]] = await q.query('SELECT COUNT(*) AS n FROM conversaciones WHERE telefono = ? AND ventana_hasta > ?', [telefono, ahora]);
  return Number(v.n) > 0;
}

// Huecos liberados hace poco (cita cancelada o cambiada, o retención caducada) que alguien de la
// lista espera: futuros, con tiempo para venir, sin una oferta en curso (ni una que acaba de caducar:
// un «sí» que llegó al límite se lee antes de pasárselo al siguiente) y sin que se haya vuelto a ocupar
// lo que dejó libre (su sala o su profesional a esa hora; con dos cabinas, la otra puede seguir
// ocupada). Varias citas del mismo hueco (la cancelada y las ofertas que se rechazaron después)
// cuentan como uno. Que siga libre de verdad lo comprueba la agenda al guardarlo.
async function huecosLiberados(q, ahora = new Date()) {
  const [filas] = await q.query(
    `SELECT c.id, c.paciente_id, c.tratamiento_id, c.inicio, c.creada_por FROM citas c
      WHERE c.estado IN ('cancelada','reprogramada') AND c.cancelada_en >= ? AND c.inicio > ?
        AND EXISTS (SELECT 1 FROM lista_espera le WHERE le.tratamiento_id = c.tratamiento_id AND le.estado = 'esperando')
        AND NOT EXISTS (SELECT 1 FROM lista_espera_ofertas o WHERE o.tratamiento_id = c.tratamiento_id AND o.inicio = c.inicio
                          AND (o.estado = 'ofrecida' OR (o.estado = 'caducada' AND o.caduca_en > ?)))
        AND NOT EXISTS (SELECT 1 FROM citas v WHERE v.id <> c.id
                          AND (v.estado IN ('confirmada','llegada','en_curso','completada','no_presentada') OR (v.estado = 'retenida' AND v.retenida_hasta > ?))
                          AND ((v.sala_id = c.sala_id AND v.sala_desde < c.sala_hasta AND v.sala_hasta > c.sala_desde)
                            OR (v.profesional_id = c.profesional_id AND v.prof_desde < c.prof_hasta AND v.prof_hasta > c.prof_desde)))
      ORDER BY c.inicio, c.id`,
    [new Date(ahora.getTime() - RECIENTES_H * 3600000), new Date(ahora.getTime() + ANTELACION_MIN * 60000),
      new Date(ahora.getTime() - MARGEN_MIN * 60000), ahora]);
  const porHueco = new Map();
  for (const f of filas) {
    const inicio = new Date(f.inicio);
    const clave = `${f.tratamiento_id}|${inicio.toISOString()}`;
    if (!porHueco.has(clave)) {
      porHueco.set(clave, { tratamientoId: f.tratamiento_id, inicio, fecha: T.fechaMadrid(inicio), hora: T.hhmm(T.minutosMadrid(inicio)), liberadaPor: f.id, pacientes: [] });
    }
    // Quien lo dejó libre no lo quiere; a quien se le ofreció ya lo descarta su oferta.
    if (f.creada_por !== 'lista_espera') porHueco.get(clave).pacientes.push(f.paciente_id);
  }
  return [...porHueco.values()];
}

// El primero de la lista al que le encaja el hueco: mismo tratamiento, dentro de sus fechas y su
// franja, sin haberlo tenido ya (si dijo que no o no contestó, pasa al siguiente), con móvil y sin
// una persona llevando su conversación. Quien lo acaba de dejar libre no cuenta.
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
    if (esFijoEspanol(le.telefono)) continue; // un fijo no tiene WhatsApp
    // Su franja; y si quiere adelantar su cita, solo si el hueco es antes (motor/agenda/espera.js).
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
      `INSERT INTO lista_espera_ofertas (lista_espera_id, cita_id, liberada_por_cita_id, cambia_cita_id, tratamiento_id, inicio, ofrecida_en, caduca_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [entrada.id, cita.id, hueco.liberadaPor || null, entrada.citaActual?.id || null, hueco.tratamientoId, cita.inicio, ahora, caducaEn]);
  } catch (err) {
    // Ya lo tuvo (no debería pasar: el candidato lo descarta): el hueco se suelta.
    await q.query("UPDATE citas SET estado = 'cancelada', cancelada_en = ?, cancelada_por = 'sistema', motivo_cancelacion = 'lista de espera: repetida' WHERE id = ?", [ahora, cita.id]);
    if (err.code === 'ER_DUP_ENTRY') return null;
    throw err;
  }
  await q.query("UPDATE lista_espera SET estado = 'ofrecido' WHERE id = ?", [entrada.id]);
  await registrar(q, { tipo: 'lista_espera_oferta', entidad: 'lista_espera', entidadId: entrada.id, datos: { oferta: r.insertId, cita: cita.id, fecha: hueco.fecha, hora: hueco.hora, liberadaPor: hueco.liberadaPor, cambia: entrada.citaActual?.id || null } });
  return { id: r.insertId, citaId: cita.id, caducaEn };
}

// El aviso no ha podido salir (WhatsApp no responde): como si no se le hubiera ofrecido. El hueco se
// suelta, la oferta se borra y conserva su turno (el cron lo vuelve a intentar con él).
async function soltarOferta(q, guardado, { ahora = new Date() } = {}) {
  await q.query(`UPDATE citas SET estado = 'cancelada', cancelada_en = ?, cancelada_por = 'sistema', motivo_cancelacion = 'lista de espera: el aviso no salió', retenida_hasta = NULL
                  WHERE id = ? AND estado = 'retenida'`, [ahora, guardado.citaId]);
  const [[o]] = await q.query('SELECT lista_espera_id FROM lista_espera_ofertas WHERE id = ?', [guardado.id]);
  await q.query('DELETE FROM lista_espera_ofertas WHERE id = ?', [guardado.id]);
  if (o) await q.query("UPDATE lista_espera SET estado = 'esperando' WHERE id = ? AND estado = 'ofrecido'", [o.lista_espera_id]);
}

// No es para él: el hueco se suelta y pasa al siguiente; él sigue esperando.
async function anularOferta(q, ofertaId, { ahora = new Date(), motivo }) {
  const [[o]] = await q.query('SELECT lista_espera_id, tarea_id FROM lista_espera_ofertas WHERE id = ?', [ofertaId]);
  await anularOfertas(q, 'o.id = ?', [ofertaId], { ahora, motivo });
  if (o) await q.query("UPDATE lista_espera SET estado = 'esperando' WHERE id = ? AND estado = 'ofrecido'", [o.lista_espera_id]);
  await cerrarTarea(q, o, ahora);
}

// Meta avisa de que el aviso de un hueco no le ha llegado (no tiene WhatsApp, número mal…). No se le
// puede avisar de este: pasa al siguiente y recepción le llama. Lo llama la entrada de estados de
// WhatsApp (el «fallido» llega después, no al mandarlo). Devuelve la oferta anulada o null.
async function ofertaNoEntregada(q, { mensajeId, ahora = new Date() }) {
  const [[o]] = await q.query(
    `SELECT o.*, le.paciente_id FROM lista_espera_ofertas o JOIN lista_espera le ON le.id = o.lista_espera_id
      WHERE o.mensaje_id = ? AND o.estado = 'ofrecida'`, [mensajeId]);
  if (!o) return null;
  await anularOferta(q, o.id, { ahora, motivo: 'no le llegó el aviso' });
  await q.query("INSERT INTO tareas (tipo, titulo, paciente_id, conversacion_id, vence_en) VALUES ('llamar', ?, ?, ?, ?)",
    [`Lista de espera: no le ha llegado por WhatsApp el aviso del hueco del ${cuando(o.inicio)}. Llamarle (el hueco ha pasado al siguiente)`,
      o.paciente_id, o.conversacion_id, new Date(ahora.getTime() + 2 * 3600000)]);
  await registrar(q, { tipo: 'lista_espera_no_entregada', entidad: 'lista_espera', entidadId: o.lista_espera_id, datos: { oferta: o.id, mensaje: mensajeId } });
  return o.id;
}

// Le guarda el hueco un poco más (mientras contesta a lo que le preguntamos, o mientras lo resuelve
// recepción).
async function prorrogar(q, oferta, hasta) {
  await q.query("UPDATE lista_espera_ofertas SET caduca_en = GREATEST(caduca_en, ?) WHERE id = ? AND estado = 'ofrecida'", [hasta, oferta.id]);
  if (oferta.cita_id) await q.query("UPDATE citas SET retenida_hasta = GREATEST(retenida_hasta, ?) WHERE id = ? AND estado = 'retenida'", [hasta, oferta.cita_id]);
}

const conFechaYHora = (o) => {
  if (!o) return null;
  const inicio = new Date(o.inicio);
  return { ...o, fecha: T.fechaMadrid(inicio), hora: T.hhmm(T.minutosMadrid(inicio)) };
};

// La oferta a la que puede estar contestando: la que está en curso o una que acaba de caducar (si
// contesta tarde y el hueco sigue libre, se le da igual).
async function ofertaParaResponder(q, pacienteId, ahora = new Date()) {
  const [[o]] = await q.query(
    `SELECT o.* FROM lista_espera_ofertas o JOIN lista_espera le ON le.id = o.lista_espera_id
      WHERE le.paciente_id = ? AND le.estado <> 'cancelado' AND o.inicio > ?
        AND (o.estado = 'ofrecida' OR (o.estado = 'caducada' AND o.caduca_en > ?))
      ORDER BY o.id DESC LIMIT 1`,
    [pacienteId, ahora, new Date(ahora.getTime() - GRACIA_MIN * 60000)]);
  return conFechaYHora(o);
}

async function ofertaPorId(q, id) {
  const [[o]] = await q.query('SELECT * FROM lista_espera_ofertas WHERE id = ?', [id]);
  return conFechaYHora(o);
}

// Dice que sí: la cita retenida queda confirmada (y si se apuntó para adelantar su cita, esa queda
// cambiada a esta). Si se le pasó la media hora pero el hueco sigue libre, se le reserva igual; si no,
// sigue (o vuelve) a la lista: lo quería.
async function aceptar(q, oferta, { ahora = new Date(), actor = 'paciente' } = {}) {
  const [[le]] = await q.query('SELECT * FROM lista_espera WHERE id = ?', [oferta.lista_espera_id]);
  const reprograma = oferta.cambia_cita_id || null;
  let cita = null;
  if (oferta.estado === 'ofrecida' && oferta.cita_id) {
    try {
      cita = await agenda.confirmarRetenida(q, { id: oferta.cita_id, reprograma, actor, ahora });
    } catch (err) {
      if (!['RETENCION_CADUCADA', 'ESTADO_NO_VALIDO'].includes(err.codigo)) throw err;
    }
  }
  if (!cita) {
    try {
      cita = await agenda.reservar(q, {
        pacienteId: le.paciente_id, tratamientoId: oferta.tratamiento_id, fecha: oferta.fecha, hora: oferta.hora,
        origen: 'ia_whatsapp', actor, reprograma, ahora,
      });
    } catch (err) {
      if (err.codigo !== 'HUECO_OCUPADO') throw err;
      // Contestó (aunque tarde): no cuenta como «sin contestar».
      await q.query("UPDATE lista_espera_ofertas SET estado = 'caducada', respondida_en = COALESCE(respondida_en, ?) WHERE id = ? AND estado IN ('ofrecida','caducada')", [ahora, oferta.id]);
      await q.query("UPDATE lista_espera SET estado = 'esperando', cerrado_en = NULL WHERE id = ? AND estado IN ('ofrecido','caducado')", [le.id]);
      await cerrarTarea(q, oferta, ahora);
      return { ocupado: true };
    }
  }
  await q.query("UPDATE lista_espera_ofertas SET estado = 'aceptada', cita_id = ?, respondida_en = ? WHERE id = ?", [cita.id, ahora, oferta.id]);
  await q.query("UPDATE lista_espera SET estado = 'aceptado', cerrado_en = ? WHERE id = ?", [ahora, le.id]);
  await cerrarTarea(q, oferta, ahora);
  await registrar(q, { tipo: 'lista_espera_aceptada', entidad: 'lista_espera', entidadId: le.id, actor, datos: { oferta: oferta.id, cita: cita.id, reprograma: cita.reprograma || null } });
  return { citaId: cita.id, reprograma: cita.reprograma || null };
}

// Dice que no: el hueco queda libre (el cron se lo ofrece al siguiente) y él sigue en la lista. Si
// ya había caducado, no hay nada que soltar, pero contestó: no cuenta como «sin contestar».
async function rechazar(q, oferta, { ahora = new Date(), actor = 'paciente' } = {}) {
  if (oferta.estado === 'caducada') await q.query('UPDATE lista_espera_ofertas SET respondida_en = COALESCE(respondida_en, ?) WHERE id = ?', [ahora, oferta.id]);
  if (oferta.estado !== 'ofrecida') return false;
  if (oferta.cita_id) {
    try {
      await agenda.cancelar(q, { id: oferta.cita_id, por: 'paciente', motivo: 'lista de espera: no le viene bien', actor, ahora });
    } catch (err) {
      if (err.codigo !== 'ESTADO_NO_VALIDO') throw err;
    }
  }
  await q.query("UPDATE lista_espera_ofertas SET estado = 'rechazada', respondida_en = ? WHERE id = ? AND estado = 'ofrecida'", [ahora, oferta.id]);
  await q.query("UPDATE lista_espera SET estado = 'esperando' WHERE id = ? AND estado = 'ofrecido'", [oferta.lista_espera_id]);
  await cerrarTarea(q, oferta, ahora);
  await registrar(q, { tipo: 'lista_espera_rechazada', entidad: 'lista_espera', entidadId: oferta.lista_espera_id, actor, datos: { oferta: oferta.id } });
  return true;
}

// Ofertas en curso cuya conversación ha pasado a una persona (contestó con algo que lleva una persona,
// o la ha tomado recepción): la IA ya no lee su «sí». Recepción tiene una tarea urgente para aceptarla
// o rechazarla desde el panel y, si él ha escrito después del aviso, se le guarda media hora más (una
// vez). Lo llama el cron cada minuto.
async function ofertasConPersona(q, { ahora = new Date() } = {}) {
  const [filas] = await q.query(
    `SELECT o.*, le.paciente_id, cv.ultimo_entrante_en FROM lista_espera_ofertas o
       JOIN lista_espera le ON le.id = o.lista_espera_id JOIN conversaciones cv ON cv.id = o.conversacion_id
      WHERE o.estado = 'ofrecida' AND o.tarea_id IS NULL AND o.caduca_en > ? AND cv.estado IN ('persona','espera_persona')`, [ahora]);
  for (const o of filas) {
    let hasta = new Date(o.caduca_en);
    if (o.ultimo_entrante_en && new Date(o.ultimo_entrante_en) > new Date(o.ofrecida_en)) {
      hasta = new Date(Math.max(hasta.getTime(), ahora.getTime() + RETENCION_MIN * 60000));
      await prorrogar(q, o, hasta);
    }
    const [r] = await q.query("INSERT INTO tareas (tipo, titulo, paciente_id, conversacion_id, urgente, vence_en) VALUES ('atender_conversacion', ?, ?, ?, TRUE, ?)",
      [`Lista de espera: tiene guardado el hueco del ${cuando(o.inicio)} hasta las ${T.hhmm(T.minutosMadrid(hasta))}. Si lo quiere, acéptalo en «Lista de espera»; si no, recházalo`,
        o.paciente_id, o.conversacion_id, hasta]);
    await q.query('UPDATE lista_espera_ofertas SET tarea_id = ? WHERE id = ?', [r.insertId, o.id]);
  }
  return filas.length;
}

// Ofertas sin respuesta a la media hora: el hueco se libera y pasa al siguiente. Quien deja dos sin
// contestar sale de la lista (para no tener huecos guardados que nadie usa); si escribió después del
// aviso (aunque no lo entendiéramos, o lo llevara una persona), no cuenta como sin contestar. Y los
// apuntes cuya fecha «hasta» ya pasó, o cuya cita a adelantar ya ha llegado, también salen.
async function caducarOfertas(q, { ahora = new Date() } = {}) {
  const [vencidas] = await q.query(
    `SELECT o.id, o.cita_id, o.lista_espera_id, o.conversacion_id, o.ofrecida_en, o.tarea_id, cv.ultimo_entrante_en
       FROM lista_espera_ofertas o LEFT JOIN conversaciones cv ON cv.id = o.conversacion_id
      WHERE o.estado = 'ofrecida' AND o.caduca_en <= ?`, [ahora]);
  let caducadas = 0;
  for (const o of vencidas) {
    const escribio = o.ultimo_entrante_en && new Date(o.ultimo_entrante_en) > new Date(o.ofrecida_en) ? o.ultimo_entrante_en : null;
    const [r] = await q.query("UPDATE lista_espera_ofertas SET estado = 'caducada', respondida_en = ? WHERE id = ? AND estado = 'ofrecida'", [escribio, o.id]);
    if (r.affectedRows !== 1) continue; // contestó justo a la vez
    caducadas++;
    if (o.cita_id) {
      await q.query(`UPDATE citas SET estado = 'cancelada', cancelada_en = ?, cancelada_por = 'sistema', motivo_cancelacion = 'lista de espera: sin respuesta', retenida_hasta = NULL
                      WHERE id = ? AND estado = 'retenida'`, [ahora, o.cita_id]);
    }
    const [[n]] = await q.query("SELECT COUNT(*) AS n FROM lista_espera_ofertas WHERE lista_espera_id = ? AND estado = 'caducada' AND respondida_en IS NULL", [o.lista_espera_id]);
    const fuera = Number(n.n) >= MAX_SIN_CONTESTAR;
    await q.query("UPDATE lista_espera SET estado = ?, cerrado_en = ? WHERE id = ? AND estado = 'ofrecido'", [fuera ? 'caducado' : 'esperando', fuera ? ahora : null, o.lista_espera_id]);
    await cerrarTarea(q, o, ahora);
    await cerrarConversacion(q, o.conversacion_id, 'lista_espera');
    await registrar(q, { tipo: 'lista_espera_sin_respuesta', entidad: 'lista_espera', entidadId: o.lista_espera_id, datos: { oferta: o.id, sale: fuera, escribio: Boolean(escribio) } });
  }
  const [viejos] = await q.query("UPDATE lista_espera SET estado = 'caducado', cerrado_en = ? WHERE estado = 'esperando' AND hasta_fecha < ?", [ahora, T.fechaMadrid(ahora)]);
  let pasadas = 0;
  const [enlazadas] = await q.query("SELECT id, cita_actual_id FROM lista_espera WHERE estado = 'esperando' AND cita_actual_id IS NOT NULL");
  for (const e of enlazadas) {
    const c = await citaEnlazada(q, e);
    if (c && !['cancelada', 'reprogramada'].includes(c.estado) && new Date(c.inicio) <= ahora) {
      await q.query("UPDATE lista_espera SET estado = 'caducado', cerrado_en = ? WHERE id = ? AND estado = 'esperando'", [ahora, e.id]);
      pasadas++;
    }
  }
  return { caducadas, fueraDePlazo: viejos.affectedRows + pasadas };
}

// Para el panel: quién espera (con la cita que quiere adelantar, si la hay), las ofertas en curso y
// las últimas.
async function listar(q, { ahora = new Date() } = {}) {
  const [entradas] = await q.query(
    `SELECT le.*, p.nombre, p.apellidos, p.telefono, t.nombre AS tratamiento
       FROM lista_espera le JOIN pacientes p ON p.id = le.paciente_id JOIN tratamientos t ON t.id = le.tratamiento_id
      WHERE le.estado IN ('esperando','ofrecido') ORDER BY le.creado_en, le.id`);
  const [ofertas] = await q.query(
    `SELECT o.*, p.nombre, p.apellidos, t.nombre AS tratamiento, cv.estado AS conversacion_estado, ca.inicio AS cambia_inicio
       FROM lista_espera_ofertas o JOIN lista_espera le ON le.id = o.lista_espera_id JOIN pacientes p ON p.id = le.paciente_id
       JOIN tratamientos t ON t.id = o.tratamiento_id LEFT JOIN conversaciones cv ON cv.id = o.conversacion_id
       LEFT JOIN citas ca ON ca.id = o.cambia_cita_id
      WHERE o.estado = 'ofrecida' OR o.ofrecida_en >= ? ORDER BY o.estado = 'ofrecida' DESC, o.id DESC LIMIT 60`,
    [new Date(ahora.getTime() - 14 * 86400000)]);
  const [[recuperados]] = await q.query("SELECT COUNT(*) AS n FROM lista_espera_ofertas WHERE estado = 'aceptada' AND respondida_en >= ?", [new Date(ahora.getTime() - 30 * 86400000)]);
  const lista = [];
  for (const e of entradas) {
    const actual = await citaActual(q, e, ahora);
    lista.push({
      id: e.id, pacienteId: e.paciente_id, paciente: nombreCorto(e), telefonoFinal: String(e.telefono || '').slice(-3),
      tratamientoId: e.tratamiento_id, tratamiento: e.tratamiento, desde: fechaSql(e.desde_fecha), hasta: fechaSql(e.hasta_fecha),
      franja: e.franjas || null, estado: e.estado, origen: e.origen, creadoPor: e.creado_por, notas: e.notas, creado: e.creado_en,
      citaActual: actual ? actual.inicio : null,
    });
  }
  return {
    entradas: lista,
    ofertas: ofertas.map((o) => ({
      id: o.id, entradaId: o.lista_espera_id, paciente: nombreCorto(o), tratamiento: o.tratamiento, inicio: o.inicio,
      estado: o.estado, ofrecida: o.ofrecida_en, caduca: o.caduca_en, respondida: o.respondida_en,
      cambia: o.cambia_inicio || null, conPersona: ['persona', 'espera_persona'].includes(o.conversacion_estado),
    })),
    cifras: {
      esperando: lista.length,
      enCurso: ofertas.filter((o) => o.estado === 'ofrecida').length,
      recuperados30d: Number(recuperados.n),
    },
  };
}

module.exports = {
  RETENCION_MIN, ANTELACION_MIN, pacientePorTelefono, citaActual, apuntar, trasReservar, quitar, activasDe, quitarPorBaja,
  cerrarConversacion, ventanaAbierta, huecosLiberados, candidato, guardarHueco, soltarOferta, anularOferta, ofertaNoEntregada,
  prorrogar, ofertaParaResponder, ofertaPorId, aceptar, rechazar, ofertasConPersona, caducarOfertas, listar, nombreCorto,
};
