'use strict';
// Reseñas con la base: programar la petición tras cada cita completada (con su variante del momento),
// enviarla y su único recordatorio, registrar el clic del enlace corto, importar las reseñas de Google
// (análisis, alerta clínica, borrador y moderación de nuestras respuestas), borrar a los 29 días el
// texto y el autor, contestar el historial poco a poco y publicar solo lo que una persona aprueba.
//
// Cada minuto, en la vuelta del cron (vuelta): los recordatorios que tocan, el borrado de lo que ya
// tiene 29 días y, una vez al día por la cola, el historial del día. Nada de eso llama a Google.
// Lo que llama a Google va aparte (vueltaGoogle), solo con el adaptador real y con las llamadas lentas
// a Google del cron (servidor/ficha-google.js, con su candado y su tiempo): leer una vez al día el
// enlace oficial de la ficha y publicar a su hora las respuestas aprobadas del historial. Esta pieza no
// crea adaptadores: usa el que le dan. Nada de temporizadores.
// En los registros solo van cifras: ni el texto de una reseña ni el nombre de quien la escribe.
const crypto = require('crypto');
const T = require('../motor/tiempo');
const R = require('../motor/resenas/resenas');
const { elegirPlantilla, variablesDe } = require('../motor/repesca/plantillas');
const { normalizar } = require('../motor/repesca/interpretar');
const { telefonoLegible } = require('../motor/entrada/leads');
const { calendarioDesdeBd, enviar, plantillasBd, textoDia } = require('./repesca/motor');
const { nombreCorto } = require('./lista-espera');
const { tieneBaja } = require('./bajas');
const { registrar } = require('./eventos');
const cola = require('./cola');

const HORA = 3600000;
const DIA = 24 * HORA;
// Los trabajos de reseñas en la cola: el historial del día (solo la base) y los que llaman a Google.
const TRABAJOS = { historial: 'resenas_historial', ficha: 'resenas_ficha', publicar: 'resenas_publicar' };
// Una reseña que llega con más días y sin respuesta es historial: se contesta poco a poco.
const DIAS_HISTORIAL = 14;
// Del historial: unas 20 al día en la bandeja, y sus respuestas salen de una en una, con 25 minutos
// entre ellas como poco y 20 al día como mucho (sin «patrones inusuales» ni respuestas repetidas).
const CUPO_HISTORIAL = 20;
const MIN_ENTRE_PUBLICACIONES = 25;
// Una respuesta del historial aprobada que un día después de su hora no ha salido (Google no estaba
// conectado, o no la aceptó) vuelve a la bandeja con su texto.
const HORAS_ATASCADA = 24;
// Las respuestas recientes que se miran para no repetir ninguna.
const RECIENTES = 60;
// Quién contesta una reseña con alerta clínica: dirección médica (ni marketing, ni recepción, ni
// administración). Sin rol, nadie.
const ROLES_ALERTA = ['direccion', 'medico'];
const puedeContestar = (resena, rol) => !resena.alerta_clinica || ROLES_ALERTA.includes(rol);
// ¿De qué paciente es? Los que se le pidieron en los 14 días de antes de escribirla.
const DIAS_CANDIDATOS = 14;

// Nuestra respuesta, si se ve en Google: la publicada y la de una reseña que su autor cambió después
// (vuelve a la bandeja, pero la de antes sigue en Google hasta que salga otra). La que Google rechazó
// no se ve.
const RESPUESTA_PUBLICA = `(estado = 'publicada' OR (estado IN ('nueva','borrador') AND respuesta IS NOT NULL
  AND COALESCE(respuesta_estado, '') <> 'rechazada'))`;

// ── Pedir la reseña ─────────────────────────────────────────────────────────────────────────

// Lo que se mira del paciente para pedirle la reseña: al programarla y otra vez justo antes de
// enviarla (entre medias puede darse de baja, dejar la reseña o recibir otra petición). Al programarla
// cuenta también la que ya está en camino: dos citas el mismo día, una petición. Una queja abierta no
// cuenta: se atiende en paralelo y la petición sale igual (si no, sería pedir solo a los contentos).
// «Ya dejó su reseña» es la que recepción ha dicho que es suya (asociarPaciente).
async function situacionDe(q, cita, { alEnviar = false } = {}) {
  const [[paciente]] = await q.query('SELECT * FROM pacientes WHERE id = ?', [cita.paciente_id]);
  const [[ultima]] = await q.query("SELECT MAX(enviada_en) AS en FROM peticiones_resena WHERE paciente_id = ? AND cita_id <> ? AND estado = 'enviada'", [cita.paciente_id, cita.id]);
  const [[enCamino]] = alEnviar ? [[{ n: 0 }]]
    : await q.query("SELECT COUNT(*) AS n FROM peticiones_resena WHERE paciente_id = ? AND cita_id <> ? AND estado = 'programada'", [cita.paciente_id, cita.id]);
  const [[resenada]] = await q.query('SELECT COUNT(*) AS n FROM resenas WHERE paciente_id = ?', [cita.paciente_id]);
  return {
    cita, paciente, ultimaPeticion: ultima?.en || null, otraEnCamino: enCamino.n > 0, yaResenoEnGoogle: resenada.n > 0,
    // La lista de bajas por teléfono también manda (escribió «BAJA» o Meta avisó con el 131050).
    bajaComercial: await tieneBaja(q, paciente?.telefono),
  };
}

// Qué momentos de la prueba están en marcha (la clínica puede quedarse con uno).
async function momentosActivos(q) {
  const [[c]] = await q.query('SELECT resenas_momentos FROM clinica WHERE id = 1');
  const v = c?.resenas_momentos;
  const lista = (v instanceof Set || Array.isArray(v) ? [...v] : String(v ?? '').split(',')).map((x) => x.trim()).filter((x) => R.VARIANTES.includes(x));
  return lista.length ? lista : R.VARIANTES;
}

// `pool` puede ser también la conexión de una transacción (al completar la cita desde el panel).
// noAntesDe: la petición no sale antes (mientras recepción aún puede deshacer «Completada»).
// variante: la del momento de pedir; si no se dice, la que le toca a la cita en la prueba.
async function programarPeticion(pool, citaId, { noAntesDe = null, variante = null } = {}) {
  const [[cita]] = await pool.query('SELECT * FROM citas WHERE id = ?', [citaId]);
  if (!cita) throw new Error('No existe la cita');
  const calendario = await calendarioDesdeBd(pool);
  const v = R.VARIANTES.includes(variante) ? variante : R.elegirVariante(cita.id, await momentosActivos(pool));
  const d = R.pedirResena({ ...(await situacionDe(pool, cita)), noAntesDe, variante: v }, calendario);
  const token = crypto.randomBytes(16).toString('base64url').slice(0, 22);
  await pool.query(
    'INSERT INTO peticiones_resena (cita_id, paciente_id, token, programada_para, variante, estado, motivo) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id',
    [cita.id, cita.paciente_id, token, d.pedir ? d.cuando : new Date(cita.fin), d.pedir ? d.variante : null, d.pedir ? 'programada' : 'omitida', d.pedir ? null : d.motivo]);
  return d;
}

// Se deshizo «Completada»: la petición que aún no ha salido se borra (si se vuelve a completar, se
// programa otra). La que ya salió no se puede recoger: se dice.
async function anularPeticion(q, citaId) {
  const [r] = await q.query("DELETE FROM peticiones_resena WHERE cita_id = ? AND estado <> 'enviada'", [citaId]);
  const [[enviada]] = await q.query("SELECT COUNT(*) AS n FROM peticiones_resena WHERE cita_id = ? AND estado = 'enviada'", [citaId]);
  return { anuladas: r.affectedRows, yaEnviada: enviada.n > 0 };
}

// La última cita completada del paciente cuya petición se omitió porque ya iba otra (o null): si
// aquella se anula, le toca a esta.
async function omitidaPorOtraEnCamino(q, pacienteId) {
  const [[c]] = await q.query(
    `SELECT c.* FROM peticiones_resena pr JOIN citas c ON c.id = pr.cita_id
      WHERE pr.paciente_id = ? AND pr.estado = 'omitida' AND pr.motivo = ? AND c.estado = 'completada'
      ORDER BY c.fin DESC, c.id DESC LIMIT 1`, [pacienteId, R.OTRA_EN_CAMINO]);
  return c || null;
}

// La plantilla aprobada de un uso, si cumple las normas de Google (alguien la puede haber cambiado):
// { plantilla } o { motivo } para dejarlo apuntado.
async function plantillaDe(q, uso) {
  const plantilla = elegirPlantilla(uso, await plantillasBd(q));
  if (!plantilla) return { motivo: 'sin plantilla aprobada' };
  const [equipo] = await q.query('SELECT nombre FROM profesionales');
  const r = R.revisarPeticion(plantilla.cuerpo, { profesionales: equipo.map((x) => x.nombre) });
  if (!r.ok) return { motivo: `la plantilla aprobada no cumple las normas de Google: ${r.errores.join(' ')}`.slice(0, 160) };
  return { plantilla };
}

// Las variables de la plantilla: su nombre y el día de la visita («martes 6 de octubre»), tantas como
// pida la plantilla aprobada (una antigua puede llevar solo el nombre).
function variablesPeticion(plantilla, { nombre, fin }) {
  const cuantas = Math.max(1, ...variablesDe(plantilla.cuerpo));
  return [nombre || 'hola', textoDia(T.fechaMadrid(new Date(fin))).slice(3)].slice(0, cuantas);
}

// Envía la plantilla con el enlace corto (el botón lleva el token) en su conversación abierta, que
// sigue como estaba (una queja con su persona, unos huecos ofrecidos…), o en una nueva que se cierra
// al enviarla: pedir la opinión no deja trabajo en la bandeja (si contesta, se abre otra).
async function enviarConEnlace(deps, f, plantilla, ahora) {
  const { pool } = deps;
  const [[abierta]] = await pool.query("SELECT * FROM conversaciones WHERE telefono = ? AND estado <> 'cerrada' ORDER BY id DESC LIMIT 1", [f.telefono]);
  let conv = abierta;
  if (!conv) {
    const [r] = await pool.query("INSERT INTO conversaciones (telefono, paciente_id, contexto, contexto_id, estado) VALUES (?, ?, 'cita', ?, 'esperando_paciente')", [f.telefono, f.paciente_id, f.cita_id]);
    [[conv]] = await pool.query('SELECT * FROM conversaciones WHERE id = ?', [r.insertId]);
  }
  const envio = await enviar(deps, conv, { plantilla, variables: variablesPeticion(plantilla, f), botonUrl: f.token, ahora });
  if (!abierta) {
    await pool.query("UPDATE conversaciones SET estado = 'cerrada', motivo_cierre = 'resena', proximo_paso = 'cerrada' WHERE id = ? AND estado = 'esperando_paciente'", [conv.id]);
  }
  // Lo último que ha leído es esta petición: lo que se le preguntó antes en otra conversación («¿Te
  // busco otro momento?») ya no está en el aire. Si no, su «sí» a esta contestaría a aquella (enviar
  // solo lo borra en la conversación en la que escribe).
  if (envio.estado !== 'fallido') {
    await pool.query('UPDATE conversaciones SET pregunta_pendiente = NULL WHERE telefono = ? AND id <> ? AND pregunta_pendiente IS NOT NULL', [f.telefono, conv.id]);
  }
  return envio;
}

const PENDIENTES = `SELECT pr.*, p.nombre, p.telefono, c.fin FROM peticiones_resena pr
  JOIN pacientes p ON p.id = pr.paciente_id JOIN citas c ON c.id = pr.cita_id`;

// enviada_en (y recordatorio_enviado_en) es cuándo salió de verdad: lo que no llega a salir queda
// 'fallida' sin fecha de envío y con su motivo, y no cuenta en las cifras.
async function enviarPeticionesPendientes(deps, { ahora = new Date() } = {}) {
  const { pool } = deps;
  const [filas] = await pool.query(`${PENDIENTES} WHERE pr.estado = 'programada' AND pr.programada_para <= ? ORDER BY pr.programada_para, pr.id LIMIT 50`, [ahora]);
  if (!filas.length) return [];
  const { plantilla, motivo: sinPlantilla } = await plantillaDe(pool, 'resena');
  const calendario = await calendarioDesdeBd(pool);
  const hechas = [];
  const fallida = (id, motivo) => pool.query("UPDATE peticiones_resena SET estado = 'fallida', enviada_en = NULL, motivo = ? WHERE id = ?", [motivo, id]);
  for (const f of filas) {
    // Justo antes de enviarla se vuelve a mirar: una baja, una reseña o una petición que ha salido
    // después de programar esta mandan. Si no toca, queda omitida con su motivo.
    const [[cita]] = await pool.query('SELECT * FROM citas WHERE id = ?', [f.cita_id]);
    const motivo = R.motivoParaNoPedir(await situacionDe(pool, cita, { alEnviar: true }), { referencia: ahora });
    if (motivo) {
      await pool.query("UPDATE peticiones_resena SET estado = 'omitida', motivo = ? WHERE id = ? AND estado = 'programada'", [motivo, f.id]);
      continue;
    }
    const [upd] = await pool.query("UPDATE peticiones_resena SET estado = 'enviada', enviada_en = ? WHERE id = ? AND estado = 'programada'", [ahora, f.id]);
    if (!upd.affectedRows) continue; // otro cron la cogió
    if (!plantilla || !f.telefono) {
      await fallida(f.id, f.telefono ? sinPlantilla : 'sin teléfono');
      continue;
    }
    const envio = await enviarConEnlace(deps, f, plantilla, ahora);
    if (envio.estado === 'fallido') {
      await fallida(f.id, 'WhatsApp no lo aceptó');
      continue;
    }
    // Un solo recordatorio, a los 7-9 días, si no abre el enlace (se vuelve a mirar al enviarlo).
    const recordatorio = R.momentoRecordatorio(ahora, calendario);
    await pool.query('UPDATE peticiones_resena SET recordatorio_para = ?, recordatorio_estado = ?, recordatorio_motivo = ? WHERE id = ?',
      [recordatorio, recordatorio ? 'programado' : 'omitido', recordatorio ? null : 'la clínica cierra del día 7 al 9', f.id]);
    hechas.push(f.id);
  }
  return hechas;
}

// El recordatorio, igual para todos: solo si no ha abierto el enlace y con lo mismo que la petición.
async function enviarRecordatorios(deps, { ahora = new Date() } = {}) {
  const { pool } = deps;
  const [filas] = await pool.query(`${PENDIENTES} WHERE pr.recordatorio_estado = 'programado' AND pr.recordatorio_para <= ? ORDER BY pr.recordatorio_para, pr.id LIMIT 50`, [ahora]);
  if (!filas.length) return [];
  const { plantilla, motivo: sinPlantilla } = await plantillaDe(pool, 'resena_recordatorio');
  const hechos = [];
  for (const f of filas) {
    const [[cita]] = await pool.query('SELECT * FROM citas WHERE id = ?', [f.cita_id]);
    const motivo = R.motivoParaNoRecordar({ ...(await situacionDe(pool, cita, { alEnviar: true })), peticion: f }, { ahora })
      || (!f.telefono ? 'sin teléfono' : null) || (!plantilla ? sinPlantilla : null);
    if (motivo) {
      await pool.query("UPDATE peticiones_resena SET recordatorio_estado = 'omitido', recordatorio_motivo = ? WHERE id = ? AND recordatorio_estado = 'programado'", [motivo, f.id]);
      continue;
    }
    const [upd] = await pool.query("UPDATE peticiones_resena SET recordatorio_estado = 'enviado', recordatorio_enviado_en = ? WHERE id = ? AND recordatorio_estado = 'programado'", [ahora, f.id]);
    if (!upd.affectedRows) continue;
    const envio = await enviarConEnlace(deps, f, plantilla, ahora);
    if (envio.estado === 'fallido') {
      await pool.query("UPDATE peticiones_resena SET recordatorio_estado = 'fallido', recordatorio_enviado_en = NULL, recordatorio_motivo = 'WhatsApp no lo aceptó' WHERE id = ?", [f.id]);
      continue;
    }
    hechos.push(f.id);
  }
  return hechos;
}

// El enlace oficial guardado vale mientras sea de hace menos de 30 días: es contenido de Business
// Profile (además, se borra a los 29 con el resto: purgarContenido).
function enlaceVigente(cl, ahora) {
  const leida = cl?.google_ficha_leida_en ? new Date(cl.google_ficha_leida_en).getTime() : NaN;
  return cl?.google_enlace_resena && leida > new Date(ahora).getTime() - R.DIAS_CONTENIDO * DIA ? cl.google_enlace_resena : null;
}

// El enlace corto /r/:token registra el clic y lleva a escribir la reseña en Google: al enlace oficial
// de la ficha si se ha leído hace menos de 30 días (newReviewUri); si no, al de reserva con el place_id.
async function abrirEnlace(pool, token, placeId = null, ahora = new Date()) {
  const [[f]] = await pool.query('SELECT id FROM peticiones_resena WHERE token = ?', [token]);
  if (f) await pool.query('UPDATE peticiones_resena SET pulsada_en = COALESCE(pulsada_en, ?) WHERE id = ?', [ahora, f.id]);
  const [[cl]] = await pool.query('SELECT google_place_id, google_enlace_resena, google_ficha_leida_en FROM clinica WHERE id = 1');
  return R.enlaceParaResenar({ enlaceFicha: enlaceVigente(cl, ahora), placeId: placeId || cl?.google_place_id });
}

// ── Google: la ficha y las reseñas ──────────────────────────────────────────────────────────

/**
 * El enlace oficial para reseñar (newReviewUri) y el place_id, de la ficha que da obtenerFicha() del
 * adaptador. El enlace solo si viene de Business Profile: el de Places (writeAReviewUri) no se puede
 * guardar (en el EEE, de Places solo se guarda el place_id); entonces vale el de reserva con el
 * place_id. Se guarda con su fecha y deja de valer a los 30 días; una ficha sin enlace quita el de
 * antes. El place_id solo se pone si faltaba (si cambia, lo actualiza la revisión de la ficha).
 */
async function actualizarFicha(pool, ficha, { ahora = new Date() } = {}) {
  if (!ficha || typeof ficha !== 'object') return { leida: false };
  const enlace = ficha.origen !== 'places' && R.esEnlaceDeGoogle(ficha.newReviewUri) ? String(ficha.newReviewUri).slice(0, 500) : null;
  const placeId = typeof ficha.placeId === 'string' && /^[\w-]{10,120}$/.test(ficha.placeId) ? ficha.placeId : null;
  await pool.query('UPDATE clinica SET google_enlace_resena = ?, google_place_id = COALESCE(google_place_id, ?), google_ficha_leida_en = ? WHERE id = 1',
    [enlace, placeId, ahora]);
  return { leida: true, enlace: Boolean(enlace) };
}

/**
 * Las respuestas recientes, para no repetir ninguna (Google rechaza las repetidas: REPETITIVE): las 60
 * últimas nuestras que se ven o van a salir (publicadas, aprobadas del historial y las de reseñas que
 * se han vuelto a abrir), por fecha, y los borradores que esperan en la bandeja. La misma ventana al
 * redactar y al revisar antes de publicar: un borrador que se propone siempre se puede aprobar.
 */
async function respuestasRecientes(q, { excluir = 0 } = {}) {
  const [nuestras] = await q.query(
    `SELECT respuesta AS t FROM resenas
      WHERE id <> ? AND respuesta IS NOT NULL AND (estado = 'aprobada' OR ${RESPUESTA_PUBLICA})
      ORDER BY COALESCE(respondida_en, publicar_en) DESC, id DESC LIMIT ?`, [excluir, RECIENTES]);
  const [borradores] = await q.query(
    `SELECT borrador_respuesta AS t FROM resenas
      WHERE id <> ? AND borrador_respuesta IS NOT NULL AND estado IN ('nueva','borrador') AND retirada_en IS NULL
      ORDER BY id DESC LIMIT ?`, [excluir, RECIENTES]);
  return [...nuestras, ...borradores].map((x) => x.t).filter(Boolean);
}

// Para redactar: el teléfono de la ficha, las respuestas recientes y un índice que va rotando las
// frases.
async function contextoRedaccion(q) {
  const [[cl]] = await q.query('SELECT telefono, whatsapp FROM clinica WHERE id = 1');
  const [[n]] = await q.query('SELECT COUNT(*) AS n FROM resenas');
  return { telefono: telefonoLegible(cl?.telefono || cl?.whatsapp) || R.TELEFONO, recientes: await respuestasRecientes(q), indice: Number(n.n) };
}

function redactar(resena, ctx) {
  const b = R.borradorRespuesta(resena, { indice: ctx.indice++, telefono: ctx.telefono, recientes: ctx.recientes });
  ctx.recientes.unshift(b.texto);
  return b.texto;
}

// Alerta clínica: tarea para dirección médica (urgente si la reseña es reciente). El título no lleva
// nada de la reseña: se lee en el panel mientras dure su texto.
async function tareaAlerta(q, resena, { urgente, ahora }) {
  const [[dir]] = await q.query("SELECT id FROM usuarios WHERE activo AND rol IN ('direccion','medico') ORDER BY rol = 'direccion' DESC, id LIMIT 1");
  const titulo = `Para dirección médica: una reseña de Google (${resena.nota} ★) habla de una posible complicación o reclamación. Revisarla en «Reseñas» antes de contestar`;
  const [t] = await q.query("INSERT INTO tareas (tipo, titulo, responsable_id, urgente, vence_en) VALUES ('otro', ?, ?, ?, ?)",
    [titulo.slice(0, 200), dir?.id || null, urgente, new Date(ahora.getTime() + (urgente ? 1 : 72) * HORA)]);
  await q.query('UPDATE resenas SET alerta_clinica = TRUE, alerta_tarea_id = ? WHERE id = ?', [t.insertId, resena.id]);
  await registrar(q, { tipo: 'resena_alerta_clinica', entidad: 'resena', entidadId: resena.id, datos: { tarea: t.insertId, urgente } });
  return t.insertId;
}

async function insertarNueva(pool, r, ctx, ahora, salida) {
  const a = R.analizar(r);
  const antigua = r.publicadaEn < new Date(ahora.getTime() - DIAS_HISTORIAL * DIA);
  // Contestada es con una respuesta que se ve (la que Google ha rechazado, no).
  const contestada = Boolean(r.respuesta) && r.estadoRespuesta !== 'rechazada';
  const historial = antigua && !contestada;
  const estado = contestada ? 'publicada' : historial ? 'historial' : 'borrador';
  if (r.respuesta && !contestada) ctx.recientes.unshift(r.respuesta); // el borrador, distinto del rechazado
  const [ins] = await pool.query(
    `INSERT INTO resenas (google_id, autor, nota, texto, con_texto, publicada_en, actualizada_en, contenido_leido_en, temas, sentimiento, prioridad,
                          historial, alerta_clinica, borrador_respuesta, respuesta, estado, respondida_en, primera_respuesta_en, respuesta_estado,
                          respuesta_motivo_rechazo, respuesta_revisada_en, respuestas_rechazadas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.googleId, r.autor, r.nota, r.texto, Boolean(r.texto), r.publicadaEn, r.actualizadaEn, ahora, JSON.stringify(a.temas), a.sentimiento, a.prioridad,
      historial, a.alertaClinica, estado === 'borrador' ? redactar(r, ctx) : null, r.respuesta, estado, r.respuesta ? r.respondidaEn : null,
      r.respuesta ? r.respondidaEn : null, r.estadoRespuesta, r.motivoRechazo, r.estadoRespuesta ? ahora : null, r.estadoRespuesta === 'rechazada' ? 1 : 0]);
  salida.nuevas++;
  // Una alerta de una reseña antigua y ya contestada no crea tarea: queda marcada. La de una antigua
  // sin contestar, sí (antes de contestarla la ve dirección médica), pero sin urgencia.
  if (a.alertaClinica && !(antigua && contestada)) {
    await tareaAlerta(pool, { id: ins.insertId, nota: r.nota }, { urgente: !antigua, ahora });
    salida.alertas++;
  }
}

const mismoTexto = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim() === String(b ?? '').replace(/\s+/g, ' ').trim();

async function actualizarExistente(pool, ex, r, ctx, ahora, salida) {
  // Estaba retirada y Google la vuelve a dar: vuelve como estaba.
  if (ex.retirada_en) await pool.query('UPDATE resenas SET retirada_en = NULL WHERE id = ?', [ex.id]);
  // La persona ha editado su reseña (su updateTime es posterior): es contenido nuevo, y su plazo para
  // borrarlo vuelve a empezar.
  const editada = r.actualizadaEn && ex.actualizada_en && r.actualizadaEn > new Date(ex.actualizada_en);
  let estado = ex.estado;
  let reabierta = false;
  if (editada) {
    const a = R.analizar(r);
    const alertaNueva = a.alertaClinica && !ex.alerta_clinica;
    await pool.query(
      `UPDATE resenas SET autor = ?, nota = ?, texto = ?, con_texto = ?, actualizada_en = ?, contenido_leido_en = ?, contenido_borrado_en = NULL,
              temas = ?, sentimiento = ?, prioridad = ?, alerta_clinica = alerta_clinica OR ? WHERE id = ?`,
      [r.autor, r.nota, r.texto, Boolean(r.texto), r.actualizadaEn, ahora, JSON.stringify(a.temas), a.sentimiento, a.prioridad, a.alertaClinica, ex.id]);
    salida.editadas++;
    // Sin contestar: un borrador nuevo con lo que dice ahora (y si era del historial, ya no lo es: es
    // contenido nuevo). Ya contestada (o aprobada en la cola) y ha cambiado la nota, el tono o aparece
    // una alerta: vuelve a la bandeja con un borrador nuevo; nuestra respuesta de antes sigue en Google
    // hasta que se apruebe la nueva, que la sustituye. Si no cambia nada de eso, se queda como está.
    const cambia = r.nota !== Number(ex.nota) || a.sentimiento !== ex.sentimiento || alertaNueva;
    reabierta = ['publicada', 'aprobada'].includes(ex.estado) && cambia;
    if (['nueva', 'borrador', 'historial'].includes(ex.estado) || reabierta) {
      const noSalio = ex.estado === 'aprobada' ? ', respuesta = NULL, publicar_en = NULL' : '';
      await pool.query(`UPDATE resenas SET estado = 'borrador', historial = FALSE, borrador_respuesta = ?, error_publicar = NULL${noSalio} WHERE id = ?`,
        [redactar(r, ctx), ex.id]);
      estado = 'borrador';
    }
    if (reabierta) await registrar(pool, { tipo: 'resena_reabierta', entidad: 'resena', entidadId: ex.id, datos: { antes: ex.estado, nota: r.nota } });
    if (alertaNueva) {
      await tareaAlerta(pool, { id: ex.id, nota: r.nota }, { urgente: true, ahora });
      salida.alertas++;
    }
  } else if (r.actualizadaEn && !ex.actualizada_en) {
    await pool.query('UPDATE resenas SET actualizada_en = ? WHERE id = ?', [r.actualizadaEn, ex.id]);
  }
  // Lo que Google tiene como nuestra respuesta, si no la ha rechazado y no es la que ya conocíamos:
  //  · la reseña estaba sin contestar (o esperaba otra respuesta desde antes de esta lectura): alguien
  //    la ha contestado desde la ficha → publicada (y no sale la de la cola);
  //  · estaba publicada, o se acaba de reabrir: se guarda la de Google, que es la que se ve.
  if (r.respuesta && r.estadoRespuesta !== 'rechazada' && !mismoTexto(r.respuesta, ex.respuesta)) {
    if (estado !== 'publicada' && !reabierta) {
      await pool.query(
        `UPDATE resenas SET respuesta = ?, estado = 'publicada', respondida_en = COALESCE(?, ?), primera_respuesta_en = COALESCE(primera_respuesta_en, ?, ?),
                publicar_en = NULL, error_publicar = NULL WHERE id = ?`, [r.respuesta, r.respondidaEn, ahora, r.respondidaEn, ahora, ex.id]);
    } else {
      await pool.query('UPDATE resenas SET respuesta = ?, respondida_en = COALESCE(?, respondida_en) WHERE id = ?', [r.respuesta, r.respondidaEn, ex.id]);
    }
  }
  // La moderación de nuestra respuesta (reviewReplyState y policyViolation), si el adaptador la da.
  if (r.estadoRespuesta && (r.estadoRespuesta !== ex.respuesta_estado || r.motivoRechazo !== ex.respuesta_motivo_rechazo)) {
    const rechazoNuevo = r.estadoRespuesta === 'rechazada' && ex.respuesta_estado !== 'rechazada';
    await pool.query('UPDATE resenas SET respuesta_estado = ?, respuesta_motivo_rechazo = ?, respuesta_revisada_en = ?, respuestas_rechazadas = respuestas_rechazadas + ? WHERE id = ?',
      [r.estadoRespuesta, r.motivoRechazo, ahora, rechazoNuevo ? 1 : 0, ex.id]);
    if (rechazoNuevo) {
      // Google no la publica: vuelve a la bandeja con otro borrador, distinto del rechazado.
      ctx.recientes.unshift(ex.respuesta);
      const texto = redactar({ nota: r.nota, autor: ex.contenido_borrado_en ? null : r.autor, texto: ex.contenido_borrado_en ? null : r.texto }, ctx);
      await pool.query("UPDATE resenas SET estado = 'borrador', borrador_respuesta = ? WHERE id = ? AND estado = 'publicada'", [texto, ex.id]);
      await registrar(pool, { tipo: 'resena_respuesta_rechazada', entidad: 'resena', entidadId: ex.id, datos: { motivo: r.motivoRechazo } });
      salida.rechazadas++;
    }
  }
}

// Lo que Google ya no da en una lectura completa (la borró quien la escribió o la retiró Google, p. ej.
// su filtro de spam) sale de la bandeja y de las cifras; si vuelve a aparecer, vuelve como estaba. Una
// lectura completa que llega vacía no retira nada (sería más un fallo que 533 reseñas borradas).
async function marcarRetiradas(pool, vistas, ahora) {
  if (!vistas.length) return 0;
  const [r] = await pool.query('UPDATE resenas SET retirada_en = ? WHERE retirada_en IS NULL AND google_id NOT IN (?)', [ahora, vistas]);
  return r.affectedRows;
}

/**
 * Lee las reseñas de Google: las nuevas entran con su análisis y su borrador (las del historial, sin
 * borrador: salen a la bandeja poco a poco); de las que ya estaban, lo editado (y si ya estaba
 * contestada y cambia, vuelve a la bandeja), la respuesta que tiene Google y su moderación. El texto y
 * el autor que ya se borraron no se vuelven a guardar (salvo que la persona haya editado su reseña: eso
 * es contenido nuevo).
 * @param {object} o { ahora: la hora de la lectura (con ella se cuentan los 14 días del historial y
 *                   los 29 del texto: quien la llama desde el cron pasa la suya), completa: la lista
 *                   son TODAS las reseñas de la ficha (la lectura semanal, sin «desde»): lo que no
 *                   viene se marca como retirado }
 * @returns {{ leidas, nuevas, editadas, alertas, rechazadas, retiradas? }}
 */
async function importarResenas(pool, google, { ahora = new Date(), completa = false } = {}) {
  const lista = (await google.listarResenas()) || [];
  const salida = { leidas: lista.length, nuevas: 0, editadas: 0, alertas: 0, rechazadas: 0 };
  const vistas = [];
  if (lista.length) {
    const ctx = await contextoRedaccion(pool);
    for (const bruta of lista) {
      const r = R.normalizarResena(bruta);
      if (!r) continue;
      vistas.push(r.googleId);
      const [[ex]] = await pool.query('SELECT * FROM resenas WHERE google_id = ?', [r.googleId]);
      if (ex) await actualizarExistente(pool, ex, r, ctx, ahora, salida);
      else await insertarNueva(pool, r, ctx, ahora, salida);
    }
  }
  if (completa) salida.retiradas = await marcarRetiradas(pool, vistas, ahora);
  return salida;
}

const marcarRetirada = (q, id, ahora) => q.query('UPDATE resenas SET retirada_en = COALESCE(retirada_en, ?) WHERE id = ?', [ahora, id]);

// A los 29 días de leerlos (un día de margen sobre los 30 de las normas de Google) se borran el texto
// y el autor, y lo que sale de ellos: los temas y el borrador con su nombre. Se quedan el id, las
// estrellas, las fechas, los estados y nuestras respuestas. También el enlace oficial de la ficha. Va
// en cada vuelta del cron: una consulta por el índice resena_contenido cuando no hay nada que borrar.
async function purgarContenido(pool, { ahora = new Date() } = {}) {
  const limite = new Date(ahora.getTime() - R.DIAS_TEXTO * DIA);
  const [filas] = await pool.query(
    `SELECT id, nota, estado, borrador_respuesta FROM resenas
      WHERE contenido_borrado_en IS NULL AND contenido_leido_en IS NOT NULL AND contenido_leido_en <= ?`, [limite]);
  await pool.query('UPDATE clinica SET google_enlace_resena = NULL WHERE id = 1 AND google_enlace_resena IS NOT NULL AND (google_ficha_leida_en IS NULL OR google_ficha_leida_en <= ?)', [limite]);
  const ctx = filas.length ? await contextoRedaccion(pool) : null;
  for (const r of filas) {
    // El borrador que aún no se ha aprobado llevaba su nombre: otro, sin nada de la reseña.
    const borrador = r.borrador_respuesta && ['nueva', 'borrador'].includes(r.estado) ? redactar({ nota: r.nota }, ctx) : null;
    await pool.query(
      `UPDATE resenas SET texto = NULL, autor = NULL, temas = NULL, sentimiento = ?, borrador_respuesta = ?, contenido_borrado_en = ?
        WHERE id = ? AND contenido_borrado_en IS NULL`, [R.sentimientoPorNota(r.nota), borrador, ahora, r.id]);
  }
  return { borradas: filas.length };
}

// ── El historial, poco a poco ───────────────────────────────────────────────────────────────

// Una respuesta del historial aprobada que no ha podido salir vuelve a la bandeja, con su texto como
// borrador y el motivo a la vista, para aprobarla otra vez (nunca se queda aprobada para siempre).
async function volverABandeja(q, id, motivo) {
  await q.query(
    `UPDATE resenas SET estado = 'borrador', borrador_respuesta = respuesta, respuesta = NULL, publicar_en = NULL, error_publicar = ?
      WHERE id = ? AND estado = 'aprobada'`, [String(motivo).slice(0, 255), id]);
}

// Las aprobadas que un día después de su hora no han salido (Google no estaba conectado, o la cola no
// las pudo publicar): a la bandeja.
async function devolverAtascadas(pool, { ahora = new Date() } = {}) {
  const [r] = await pool.query(
    `UPDATE resenas SET estado = 'borrador', borrador_respuesta = respuesta, respuesta = NULL, publicar_en = NULL,
            error_publicar = COALESCE(error_publicar, 'No salió a su hora: Google no estaba disponible')
      WHERE estado = 'aprobada' AND publicar_en < ?`, [new Date(ahora.getTime() - HORAS_ATASCADA * HORA)]);
  return r.affectedRows;
}

// Cada día, hasta 20 del historial en la bandeja con su borrador (primero las alertas, las de 1-2
// estrellas y las que tienen texto; las más recientes antes).
async function liberarHistorial(pool, { ahora = new Date(), cupo = CUPO_HISTORIAL } = {}) {
  const [[b]] = await pool.query("SELECT COUNT(*) AS n FROM resenas WHERE historial AND estado = 'borrador' AND retirada_en IS NULL");
  const n = Math.max(0, cupo - Number(b.n));
  if (!n) return { liberadas: 0 };
  const [filas] = await pool.query(
    `SELECT id, nota, autor, texto FROM resenas WHERE estado = 'historial' AND retirada_en IS NULL
      ORDER BY alerta_clinica DESC, nota <= 2 DESC, con_texto DESC, publicada_en DESC, id LIMIT ?`, [n]);
  if (!filas.length) return { liberadas: 0 };
  const ctx = await contextoRedaccion(pool);
  for (const r of filas) {
    await pool.query("UPDATE resenas SET estado = 'borrador', borrador_respuesta = ?, liberada_en = ? WHERE id = ? AND estado = 'historial'",
      [redactar(r, ctx), ahora, r.id]);
  }
  return { liberadas: filas.length };
}

// Lo del historial de cada día: las atascadas, a la bandeja; y las del día.
async function historialDelDia(pool, { ahora = new Date() } = {}) {
  const devueltas = await devolverAtascadas(pool, { ahora });
  return { ...(await liberarHistorial(pool, { ahora })), devueltas };
}

// Cuándo sale la siguiente respuesta aprobada del historial: 25 minutos después de la anterior, en
// horario de envío y como mucho 20 al día.
async function siguienteHuecoHistorial(q, ahora) {
  const calendario = await calendarioDesdeBd(q);
  const [[u]] = await q.query("SELECT MAX(publicar_en) AS en FROM resenas WHERE historial AND estado IN ('aprobada','publicada') AND publicar_en IS NOT NULL");
  let cuando = new Date(Math.max(ahora.getTime(), u?.en ? new Date(u.en).getTime() + MIN_ENTRE_PUBLICACIONES * 60000 : 0));
  for (let i = 0; i < 60; i++) {
    cuando = R.enHorarioDeEnvio(cuando, calendario);
    const fecha = T.fechaMadrid(cuando);
    const [[n]] = await q.query("SELECT COUNT(*) AS n FROM resenas WHERE historial AND estado IN ('aprobada','publicada') AND publicar_en >= ? AND publicar_en < ?",
      [T.desdeMadrid(fecha, '00:00'), T.desdeMadrid(T.sumarDias(fecha, 1), '00:00')]);
    if (Number(n.n) < CUPO_HISTORIAL) return cuando;
    cuando = T.desdeMadrid(T.sumarDias(fecha, 1), '00:00');
  }
  return cuando;
}

// ── Responder ───────────────────────────────────────────────────────────────────────────────

// Lo que hace falta para revisar una respuesta: el catálogo, el equipo, el teléfono de la ficha y las
// respuestas recientes (la misma ventana que al redactar).
async function contextoRespuesta(q, resena) {
  const [trats] = await q.query('SELECT nombre, alias FROM tratamientos');
  const [equipo] = await q.query('SELECT nombre FROM profesionales');
  const [[cl]] = await q.query('SELECT telefono, whatsapp FROM clinica WHERE id = 1');
  const alias = (v) => { try { return (typeof v === 'string' ? JSON.parse(v) : v) || []; } catch { return []; } };
  return {
    tratamientos: trats.flatMap((t) => [t.nombre, ...alias(t.alias)]),
    profesionales: equipo.map((x) => x.nombre),
    telefono: cl?.telefono || cl?.whatsapp || R.TELEFONO,
    recientes: await respuestasRecientes(q, { excluir: resena.id }),
  };
}

const RETIRADA = 'Google ya no muestra esta reseña (la ha borrado quien la escribió o la ha retirado Google): sale de la bandeja';
const noExiste = (err) => err?.estado === 404;

// Publica (o sustituye: la API crea o cambia nuestra respuesta) y lo deja apuntado.
async function publicar(pool, google, r, texto, { aprobadaPor = null, ahora = new Date() } = {}) {
  const hecho = await google.responderResena(r.google_id, texto);
  const estado = R.estadoModeracion(hecho?.estado ?? hecho?.reviewReplyState ?? hecho?.reviewReply?.reviewReplyState);
  await pool.query(
    `UPDATE resenas SET respuesta = ?, estado = 'publicada', aprobada_por = COALESCE(?, aprobada_por), respondida_en = ?,
            primera_respuesta_en = COALESCE(primera_respuesta_en, ?), respuesta_estado = ?, respuesta_motivo_rechazo = NULL,
            respuesta_revisada_en = ?, error_publicar = NULL WHERE id = ?`,
    [texto, aprobadaPor, ahora, ahora, estado, estado ? ahora : null, r.id]);
  await registrar(pool, { tipo: 'resena_respondida', entidad: 'resena', entidadId: r.id, actor: aprobadaPor || 'sistema' });
}

/**
 * Una persona aprueba la respuesta (la del borrador o la que ha escrito). Se revisa antes: sin datos
 * de salud, ni del equipo, ni fechas, sin confirmar que es paciente, sin promociones ni enlaces y sin
 * repetir otra. Las reseñas recientes (y las que su autor cambió después de contestarlas: la nueva
 * sustituye a la de antes) se contestan ya; las del historial salen por la cola, poco a poco. Una
 * aprobada que no ha salido se puede volver a aprobar (con otro texto, si hace falta).
 * rol: el de quien aprueba (el panel lo pasa siempre); una alerta clínica solo la contesta dirección
 * médica, y sin rol no se contesta.
 * @returns {{ estado: 'publicada'|'aprobada', publicarEn?, avisos }}
 */
async function aprobarYPublicar(pool, google, { resenaId, texto = null, aprobadaPor, rol = null, ahora = new Date() }) {
  const [[r]] = await pool.query('SELECT * FROM resenas WHERE id = ?', [resenaId]);
  if (!r) throw new Error('No existe la reseña');
  if (r.retirada_en) throw new Error(RETIRADA);
  if (r.estado === 'publicada') throw new Error('Esta reseña ya tiene su respuesta publicada');
  if (r.estado === 'ignorada') throw new Error('Esta reseña se ha dejado sin contestar');
  if (!puedeContestar(r, rol)) throw new Error('Esta reseña tiene una alerta clínica: la contesta dirección médica');
  const final = String(texto ?? (r.estado === 'aprobada' ? r.respuesta : r.borrador_respuesta) ?? '').trim();
  if (!final) throw new Error('No hay texto para responder');
  const revision = R.revisarRespuesta(final, { ...(await contextoRespuesta(pool, r)), resena: { nota: r.nota, autor: r.autor, texto: r.texto } });
  if (!revision.ok) throw new Error(revision.errores.join(' '));
  if (r.historial) {
    // Vuelta a aprobar: deja libre su turno de antes y coge el siguiente.
    if (r.estado === 'aprobada') await pool.query("UPDATE resenas SET estado = 'borrador', publicar_en = NULL WHERE id = ? AND estado = 'aprobada'", [r.id]);
    const cuando = await siguienteHuecoHistorial(pool, ahora);
    await pool.query("UPDATE resenas SET respuesta = ?, estado = 'aprobada', aprobada_por = ?, publicar_en = ?, error_publicar = NULL WHERE id = ?",
      [final, aprobadaPor, cuando, r.id]);
    await cola.encolar(pool, TRABAJOS.publicar, { resenaId: r.id }, { ejecutarEn: cuando });
    await registrar(pool, { tipo: 'resena_aprobada', entidad: 'resena', entidadId: r.id, actor: aprobadaPor, datos: { publicarEn: cuando } });
    return { estado: 'aprobada', publicarEn: cuando, avisos: revision.avisos };
  }
  try {
    await publicar(pool, google, r, final, { aprobadaPor, ahora });
  } catch (err) {
    if (!noExiste(err)) throw err;
    await marcarRetirada(pool, r.id, ahora);
    throw new Error(RETIRADA, { cause: err });
  }
  return { estado: 'publicada', avisos: revision.avisos };
}

// El trabajo de la cola que publica una respuesta aprobada del historial cuando le toca. Si Google no
// la acepta, la cola lo reintenta y en el último intento vuelve a la bandeja; si el error no tiene
// arreglo (una respuesta que no cabe, sin permiso), vuelve ya, sin reintentos. Si Google dice que la
// reseña ya no existe, se marca retirada.
async function publicarAprobada(pool, google, resenaId, { ahora = new Date(), trabajo = null } = {}) {
  const [[r]] = await pool.query('SELECT * FROM resenas WHERE id = ?', [resenaId]);
  if (!r || r.estado !== 'aprobada' || !r.respuesta) return { omitida: true };
  if (r.retirada_en) {
    await volverABandeja(pool, r.id, RETIRADA);
    return { omitida: true };
  }
  if (r.publicar_en && new Date(r.publicar_en) > ahora) return cola.aplazar({ minutos: Math.ceil((new Date(r.publicar_en) - ahora) / 60000) });
  try {
    await publicar(pool, google, r, r.respuesta, { ahora });
  } catch (err) {
    if (noExiste(err)) {
      await marcarRetirada(pool, r.id, ahora);
      await volverABandeja(pool, r.id, RETIRADA);
      return { retirada: r.id };
    }
    const ultimo = Boolean(trabajo && trabajo.intentos >= trabajo.max_intentos);
    if (!ultimo && !err.permanente) {
      await pool.query('UPDATE resenas SET error_publicar = ? WHERE id = ?', [String(err.message).slice(0, 255), r.id]);
      throw err;
    }
    await volverABandeja(pool, r.id, `No se ha podido publicar: ${err.message}`);
    if (!ultimo) return { devuelta: r.id };
    throw err;
  }
  return { publicada: r.id };
}

// ── ¿De qué paciente es? ────────────────────────────────────────────────────────────────────
// Google no dice quién escribe cada reseña. Si su nombre de pila coincide con el de un paciente al que
// se le pidió la opinión en los 14 días de antes, recepción puede decir que es suya: así la exclusión
// «ya dejó su reseña» funciona (ni recordatorio, ni otra petición). Nunca se asocia sola.

async function peticionesParaCandidatos(q, desde, hasta) {
  const [filas] = await q.query(
    `SELECT pr.paciente_id, pr.enviada_en, pr.pulsada_en, p.nombre, p.apellidos, c.inicio
       FROM peticiones_resena pr JOIN pacientes p ON p.id = pr.paciente_id JOIN citas c ON c.id = pr.cita_id
      WHERE pr.estado = 'enviada' AND pr.enviada_en >= ? AND pr.enviada_en <= ?
      ORDER BY pr.enviada_en DESC LIMIT 2000`, [desde, hasta]);
  return filas;
}

// Los pacientes que pueden haberla escrito (mientras se guarde su autor): el mismo nombre de pila y
// una petición en los 14 días de antes; primero los que abrieron el enlace.
function candidatosDe(resena, peticiones) {
  const nombre = normalizar(R.primerNombre(resena.autor));
  if (!nombre || resena.paciente_id) return [];
  const hasta = new Date(resena.publicada_en).getTime();
  const vistos = new Map();
  for (const p of peticiones) {
    const t = new Date(p.enviada_en).getTime();
    if (t > hasta || t < hasta - DIAS_CANDIDATOS * DIA || vistos.has(p.paciente_id)) continue;
    if (normalizar(String(p.nombre || '').trim().split(/\s+/)[0]) !== nombre) continue;
    vistos.set(p.paciente_id, { id: p.paciente_id, nombre: nombreCorto(p), cita: T.fechaMadrid(new Date(p.inicio)), abrioEnlace: Boolean(p.pulsada_en) });
  }
  return [...vistos.values()].sort((a, b) => Number(b.abrioEnlace) - Number(a.abrioEnlace)).slice(0, 3);
}

/**
 * Recepción dice de qué paciente es una reseña (uno de sus candidatos): ya no se le vuelve a pedir, y
 * su petición queda enlazada con la reseña.
 */
async function asociarPaciente(pool, { resenaId, pacienteId, por = null }) {
  const [[r]] = await pool.query('SELECT id, autor, publicada_en, paciente_id FROM resenas WHERE id = ?', [resenaId]);
  if (!r) throw new Error('No existe la reseña');
  if (r.paciente_id) throw new Error('Esta reseña ya está asociada a un paciente');
  const hasta = new Date(r.publicada_en);
  const candidatos = candidatosDe(r, await peticionesParaCandidatos(pool, new Date(hasta.getTime() - DIAS_CANDIDATOS * DIA), hasta));
  if (!candidatos.some((c) => c.id === Number(pacienteId))) throw new Error('Ese paciente no es uno de los que pudieron escribirla');
  await pool.query('UPDATE resenas SET paciente_id = ? WHERE id = ? AND paciente_id IS NULL', [Number(pacienteId), r.id]);
  await pool.query("UPDATE peticiones_resena SET resena_id = ? WHERE paciente_id = ? AND estado = 'enviada' AND resena_id IS NULL AND enviada_en <= ? ORDER BY enviada_en DESC LIMIT 1",
    [r.id, Number(pacienteId), hasta]);
  await registrar(pool, { tipo: 'resena_paciente', entidad: 'resena', entidadId: r.id, actor: por, datos: { paciente: Number(pacienteId) } });
  return { ok: true };
}

// ── Cada minuto ─────────────────────────────────────────────────────────────────────────────

// Un trabajo del día, desde las 8:00 de Madrid: una vez por día (clave única en la cola).
async function encolarDelDia(pool, tipo, fecha, ahora) {
  await cola.encolar(pool, tipo, {}, { ejecutarEn: ahora, claveUnica: `${tipo}-${fecha}` });
}

/**
 * Lo de reseñas de cada minuto (lo llama el cron, después de las peticiones), solo con la base y
 * WhatsApp: el borrado de lo que ya tiene 29 días (en cada vuelta: así nunca pasa de 30), los
 * recordatorios que tocan y, una vez al día por la cola, el historial del día. deps: { pool, whatsapp }
 */
async function vuelta(deps, { ahora = new Date() } = {}) {
  const { pool } = deps;
  const { borradas } = await purgarContenido(pool, { ahora });
  const p = T.partesMadrid(ahora);
  if (p.minutos >= 8 * 60) await encolarDelDia(pool, TRABAJOS.historial, p.fecha, ahora);
  const recordatorios = (await enviarRecordatorios(deps, { ahora })).length;
  const trabajos = await cola.procesar(pool, { [TRABAJOS.historial]: () => historialDelDia(pool, { ahora }) }, { ahora, limite: 5 });
  return { recordatorios, borradas, trabajos };
}

/**
 * Lo de reseñas que llama a Google, solo con el adaptador real (deps.google, modo 'real'; en simulado
 * no se publica nada): una vez al día, el enlace oficial de la ficha (obtenerFicha), y las respuestas
 * aprobadas del historial cuando les toca. Va con las llamadas lentas a Google del cron (su candado y
 * su tiempo: cortarEn), no en la vuelta de cada minuto. Sin acceso a Business Profile (solo Places),
 * las respuestas esperan (y al día, a la bandeja). null si no hay adaptador real.
 */
async function vueltaGoogle(deps, { ahora = new Date(), cortarEn = null } = {}) {
  const { pool, google } = deps;
  if (google?.modo !== 'real') return null;
  const conPerfil = google.capacidades?.ficha !== false;
  if (!conPerfil) return { sinPerfil: true };
  const p = T.partesMadrid(ahora);
  if (p.minutos >= 8 * 60 && typeof google.obtenerFicha === 'function') await encolarDelDia(pool, TRABAJOS.ficha, p.fecha, ahora);
  return cola.procesar(pool, {
    [TRABAJOS.ficha]: async () => actualizarFicha(pool, await google.obtenerFicha(), { ahora }),
    [TRABAJOS.publicar]: (carga, { trabajo } = {}) => publicarAprobada(pool, google, Number(carga.resenaId), { ahora, trabajo }),
  }, { ahora, limite: 5, cortarEn });
}

// ── El panel ────────────────────────────────────────────────────────────────────────────────

function aPanel(x, { rol, ahora, candidatos = [] }) {
  const publica = x.estado === 'publicada' || (['nueva', 'borrador'].includes(x.estado) && Boolean(x.respuesta) && x.respuesta_estado !== 'rechazada');
  return {
    id: x.id, autor: x.autor, nota: x.nota, texto: x.texto, publicada: x.publicada_en, sentimiento: x.sentimiento, prioridad: x.prioridad,
    temas: typeof x.temas === 'string' ? JSON.parse(x.temas) : x.temas || [], borrador: x.borrador_respuesta, estado: x.estado,
    // La respuesta que se ve en Google (o la aprobada que va a salir); la rechazada, no.
    respuesta: publica || x.estado === 'aprobada' ? x.respuesta : null, respuestaPublica: publica,
    historial: Boolean(x.historial), alerta: Boolean(x.alerta_clinica), alertaAbierta: x.tarea_estado === 'abierta',
    puedeContestar: puedeContestar(x, rol),
    publicarEn: x.publicar_en, errorPublicar: x.error_publicar, moderacion: x.respuesta_estado, motivoRechazo: x.respuesta_motivo_rechazo,
    // Aprobada que no sale: se puede volver a aprobar.
    reintentar: x.estado === 'aprobada' && Boolean(x.error_publicar || (x.publicar_en && new Date(x.publicar_en).getTime() < ahora.getTime() - HORA)),
    rechazos: Number(x.respuestas_rechazadas || 0), conTexto: Boolean(x.con_texto), contenidoBorrado: Boolean(x.contenido_borrado_en),
    dePaciente: Boolean(x.paciente_id), candidatos,
  };
}

// Lo que enseña la pantalla «Reseñas»: los KPI, las reseñas que piden algo (alertas, por contestar,
// en cola) y las contestadas de los últimos 60 días, el historial y la ficha. rol: el de quien mira
// (una alerta clínica solo la contesta dirección médica).
async function datosPanel(pool, { ahora = new Date(), rol = null } = {}) {
  const [todas] = await pool.query(
    `SELECT nota, estado, historial, con_texto, temas, publicada_en, primera_respuesta_en, respuesta_estado, respuestas_rechazadas,
            ${RESPUESTA_PUBLICA} AS respondida
       FROM resenas WHERE retirada_en IS NULL`);
  const hace90 = new Date(ahora.getTime() - 90 * DIA);
  // Solo lo que salió de verdad (una petición que no llegó a salir no es un envío).
  const [peticiones] = await pool.query(
    `SELECT estado, enviada_en, pulsada_en, variante, recordatorio_estado, recordatorio_enviado_en FROM peticiones_resena
      WHERE estado = 'enviada' AND enviada_en > ?`, [hace90]);
  // Y lo que no salió, con el último motivo: si la plantilla aprobada no cumple, no sale ninguna.
  const [[fallidas]] = await pool.query("SELECT COUNT(*) AS n FROM peticiones_resena WHERE estado = 'fallida' AND programada_para > ?", [hace90]);
  const [[ultimaFallida]] = await pool.query(
    "SELECT motivo FROM peticiones_resena WHERE estado = 'fallida' AND programada_para > ? ORDER BY programada_para DESC, id DESC LIMIT 1", [hace90]);
  const [lista] = await pool.query(
    `SELECT r.*, t.estado AS tarea_estado FROM resenas r LEFT JOIN tareas t ON t.id = r.alerta_tarea_id
      WHERE r.retirada_en IS NULL AND (r.estado IN ('nueva','borrador','aprobada') OR (r.alerta_clinica AND t.estado = 'abierta')
         OR (r.estado = 'publicada' AND COALESCE(r.respondida_en, r.publicada_en) >= ?))
      ORDER BY (r.alerta_clinica AND t.estado = 'abierta') DESC, FIELD(r.estado, 'nueva', 'borrador', 'aprobada', 'publicada', 'historial', 'ignorada'),
               r.historial, r.publicada_en DESC, r.id DESC
      LIMIT 200`, [new Date(ahora.getTime() - 60 * DIA)]);
  // Para decir de qué paciente es: las que aún tienen su autor, con las peticiones de esos días.
  const conAutor = lista.filter((x) => x.autor && !x.paciente_id);
  const desde = conAutor.length ? new Date(Math.min(...conAutor.map((x) => new Date(x.publicada_en).getTime())) - DIAS_CANDIDATOS * DIA) : null;
  const pedidas = desde ? await peticionesParaCandidatos(pool, desde, ahora) : [];
  const hoy = T.fechaMadrid(ahora);
  const [[h]] = await pool.query(
    `SELECT SUM(estado = 'historial') AS pendientes, SUM(historial AND estado = 'borrador') AS en_bandeja,
            SUM(historial AND estado = 'aprobada') AS en_cola,
            SUM(historial AND estado = 'publicada' AND publicar_en >= ? AND publicar_en < ?) AS publicadas_hoy
       FROM resenas WHERE retirada_en IS NULL`, [T.desdeMadrid(hoy, '00:00'), T.desdeMadrid(T.sumarDias(hoy, 1), '00:00')]);
  const [[cl]] = await pool.query('SELECT google_enlace_resena, google_place_id, google_ficha_leida_en FROM clinica WHERE id = 1');
  return {
    metricas: R.metricas({ resenas: todas, peticiones, ahora }),
    peticionesFallidas: { n: Number(fallidas?.n || 0), motivo: ultimaFallida?.motivo || null },
    resenas: lista.map((x) => aPanel(x, { rol, ahora, candidatos: x.autor && !x.paciente_id ? candidatosDe(x, pedidas) : [] })),
    historial: {
      pendientes: Number(h?.pendientes || 0), enBandeja: Number(h?.en_bandeja || 0), enCola: Number(h?.en_cola || 0),
      publicadasHoy: Number(h?.publicadas_hoy || 0), cupo: CUPO_HISTORIAL,
    },
    ficha: { enlaceOficial: Boolean(enlaceVigente(cl, ahora)), placeId: Boolean(cl?.google_place_id), leidaEn: cl?.google_ficha_leida_en || null },
    momentos: (await momentosActivos(pool)).map((v) => ({ variante: v, nombre: R.NOMBRE_VARIANTE[v] })),
  };
}

module.exports = {
  TRABAJOS, CUPO_HISTORIAL, DIAS_HISTORIAL, ROLES_ALERTA,
  programarPeticion, anularPeticion, omitidaPorOtraEnCamino, enviarPeticionesPendientes, enviarRecordatorios, abrirEnlace,
  actualizarFicha, importarResenas, purgarContenido, liberarHistorial, devolverAtascadas, siguienteHuecoHistorial,
  aprobarYPublicar, publicarAprobada, asociarPaciente, vuelta, vueltaGoogle, datosPanel,
};
