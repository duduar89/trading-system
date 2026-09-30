'use strict';
// Reseñas con la base: programar la petición tras cada cita completada (con su variante del momento),
// enviarla y su único recordatorio, registrar el clic del enlace corto, leer la ficha y las reseñas de
// Google (análisis, alerta clínica, borrador y moderación de nuestras respuestas), borrar a los 30 días
// el texto y el autor, contestar el historial poco a poco y publicar solo lo que una persona aprueba.
//
// Cada minuto (cron): peticiones que tocan (enviarPeticionesPendientes), recordatorios y los trabajos
// de reseñas de la cola (vuelta). Una vez al día, por la cola: leer la ficha y las reseñas de Google,
// borrar lo que ya tiene 30 días y pasar a la bandeja el historial de ese día. Nada de temporizadores.
// En los registros solo van cifras: ni el texto de una reseña ni el nombre de quien la escribe.
const crypto = require('crypto');
const T = require('../motor/tiempo');
const R = require('../motor/resenas/resenas');
const { elegirPlantilla, variablesDe } = require('../motor/repesca/plantillas');
const { telefonoLegible } = require('../motor/entrada/leads');
const { calendarioDesdeBd, enviar, plantillasBd, textoDia } = require('./repesca/motor');
const { tieneBaja } = require('./bajas');
const { registrar } = require('./eventos');
const { crearGoogle } = require('./integraciones/google');
const cola = require('./cola');
const config = require('./config');

const HORA = 3600000;
const DIA = 24 * HORA;
// Los trabajos de reseñas en la cola.
const TRABAJOS = { google: 'resenas_google', purgar: 'resenas_purgar', historial: 'resenas_historial', publicar: 'resenas_publicar' };
// El texto y el autor que vienen de Google se guardan como mucho 30 días (normas de la API).
const DIAS_CONTENIDO = 30;
// Una reseña que llega con más días y sin respuesta es historial: se contesta poco a poco.
const DIAS_HISTORIAL = 14;
// Del historial: unas 20 al día en la bandeja, y sus respuestas salen de una en una, con 25 minutos
// entre ellas como poco y 20 al día como mucho (sin «patrones inusuales» ni respuestas repetidas).
const CUPO_HISTORIAL = 20;
const MIN_ENTRE_PUBLICACIONES = 25;

// ── Pedir la reseña ─────────────────────────────────────────────────────────────────────────

// Lo que se mira del paciente para pedirle la reseña: al programarla y otra vez justo antes de
// enviarla (entre medias puede darse de baja, dejar la reseña o recibir otra petición). Al programarla
// cuenta también la que ya está en camino: dos citas el mismo día, una petición. Una queja abierta no
// cuenta: se atiende en paralelo y la petición sale igual (si no, sería pedir solo a los contentos).
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
  return envio;
}

const PENDIENTES = `SELECT pr.*, p.nombre, p.telefono, c.fin FROM peticiones_resena pr
  JOIN pacientes p ON p.id = pr.paciente_id JOIN citas c ON c.id = pr.cita_id`;

async function enviarPeticionesPendientes(deps, { ahora = new Date() } = {}) {
  const { pool } = deps;
  const [filas] = await pool.query(`${PENDIENTES} WHERE pr.estado = 'programada' AND pr.programada_para <= ? ORDER BY pr.programada_para, pr.id LIMIT 50`, [ahora]);
  if (!filas.length) return [];
  const { plantilla, motivo: sinPlantilla } = await plantillaDe(pool, 'resena');
  const calendario = await calendarioDesdeBd(pool);
  const hechas = [];
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
      await pool.query("UPDATE peticiones_resena SET estado = 'fallida', motivo = ? WHERE id = ?", [f.telefono ? sinPlantilla : 'sin teléfono', f.id]);
      continue;
    }
    const envio = await enviarConEnlace(deps, f, plantilla, ahora);
    if (envio.estado === 'fallido') {
      await pool.query("UPDATE peticiones_resena SET estado = 'fallida', motivo = 'WhatsApp no lo aceptó' WHERE id = ?", [f.id]);
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
      await pool.query("UPDATE peticiones_resena SET recordatorio_estado = 'fallido', recordatorio_motivo = 'WhatsApp no lo aceptó' WHERE id = ?", [f.id]);
      continue;
    }
    hechos.push(f.id);
  }
  return hechos;
}

// El enlace corto /r/:token registra el clic y lleva a escribir la reseña en Google: al enlace oficial
// de la ficha si se ha leído (newReviewUri); si no, al de reserva con el place_id.
async function abrirEnlace(pool, token, placeId = null, ahora = new Date()) {
  const [[f]] = await pool.query('SELECT id FROM peticiones_resena WHERE token = ?', [token]);
  if (f) await pool.query('UPDATE peticiones_resena SET pulsada_en = COALESCE(pulsada_en, ?) WHERE id = ?', [ahora, f.id]);
  const [[cl]] = await pool.query('SELECT google_place_id, google_enlace_resena FROM clinica WHERE id = 1');
  return R.enlaceParaResenar({ enlaceFicha: cl?.google_enlace_resena, placeId: placeId || cl?.google_place_id });
}

// ── Google: la ficha y las reseñas ──────────────────────────────────────────────────────────

// El enlace oficial para reseñar (newReviewUri) y el place_id, del método obtenerFicha() del
// adaptador (si lo tiene). Solo se guarda un enlace de Google; el place_id solo se pone si faltaba.
async function actualizarFicha(pool, google, { ahora = new Date() } = {}) {
  if (typeof google?.obtenerFicha !== 'function') return { leida: false };
  const ficha = (await google.obtenerFicha()) || {};
  const enlace = R.esEnlaceDeGoogle(ficha.newReviewUri) ? String(ficha.newReviewUri).slice(0, 500) : null;
  const placeId = typeof ficha.placeId === 'string' && /^[\w-]{10,120}$/.test(ficha.placeId) ? ficha.placeId : null;
  await pool.query(
    'UPDATE clinica SET google_enlace_resena = COALESCE(?, google_enlace_resena), google_place_id = COALESCE(google_place_id, ?), google_ficha_leida_en = ? WHERE id = 1',
    [enlace, placeId, ahora]);
  return { leida: true, enlace: Boolean(enlace) };
}

// Para redactar: el teléfono de la ficha, las respuestas recientes (para no repetir ninguna) y un
// índice que va rotando las frases.
async function contextoRedaccion(q) {
  const [[cl]] = await q.query('SELECT telefono, whatsapp FROM clinica WHERE id = 1');
  const [ultimas] = await q.query(
    'SELECT COALESCE(respuesta, borrador_respuesta) AS t FROM resenas WHERE respuesta IS NOT NULL OR borrador_respuesta IS NOT NULL ORDER BY id DESC LIMIT 60');
  const [[n]] = await q.query('SELECT COUNT(*) AS n FROM resenas');
  return { telefono: telefonoLegible(cl?.telefono || cl?.whatsapp) || R.TELEFONO, recientes: ultimas.map((x) => x.t).filter(Boolean), indice: Number(n.n) };
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

async function actualizarExistente(pool, ex, r, ctx, ahora, salida) {
  // La persona ha editado su reseña (su updateTime es posterior): es contenido nuevo, con sus 30 días.
  const editada = r.actualizadaEn && ex.actualizada_en && r.actualizadaEn > new Date(ex.actualizada_en);
  if (editada) {
    const a = R.analizar(r);
    const sinContestar = ['nueva', 'borrador'].includes(ex.estado);
    await pool.query(
      `UPDATE resenas SET autor = ?, nota = ?, texto = ?, con_texto = ?, actualizada_en = ?, contenido_leido_en = ?, contenido_borrado_en = NULL,
              temas = ?, sentimiento = ?, prioridad = ?, alerta_clinica = alerta_clinica OR ?, borrador_respuesta = IF(?, ?, borrador_respuesta) WHERE id = ?`,
      [r.autor, r.nota, r.texto, Boolean(r.texto), r.actualizadaEn, ahora, JSON.stringify(a.temas), a.sentimiento, a.prioridad, a.alertaClinica,
        sinContestar, sinContestar ? redactar(r, ctx) : null, ex.id]);
    salida.editadas++;
    if (a.alertaClinica && !ex.alerta_clinica) {
      await tareaAlerta(pool, { id: ex.id, nota: r.nota }, { urgente: true, ahora });
      salida.alertas++;
    }
  } else if (r.actualizadaEn && !ex.actualizada_en) {
    await pool.query('UPDATE resenas SET actualizada_en = ? WHERE id = ?', [r.actualizadaEn, ex.id]);
  }
  // Alguien la ha contestado desde la ficha de Google: queda publicada (y no sale la de la cola). Una
  // respuesta que Google ha rechazado no cuenta: no se ve.
  if (r.respuesta && r.estadoRespuesta !== 'rechazada' && ex.estado !== 'publicada') {
    await pool.query(
      `UPDATE resenas SET respuesta = ?, estado = 'publicada', respondida_en = COALESCE(?, ?), primera_respuesta_en = COALESCE(primera_respuesta_en, ?, ?)
        WHERE id = ?`, [r.respuesta, r.respondidaEn, ahora, r.respondidaEn, ahora, ex.id]);
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

/**
 * Lee las reseñas de Google: las nuevas entran con su análisis y su borrador (las del historial,
 * sin borrador: salen a la bandeja poco a poco); de las que ya estaban, lo editado y la moderación de
 * nuestra respuesta. El texto y el autor que ya se borraron no se vuelven a guardar (salvo que la
 * persona haya editado su reseña: eso es contenido nuevo).
 */
async function importarResenas(pool, google, { ahora = new Date() } = {}) {
  const lista = (await google.listarResenas()) || [];
  const salida = { leidas: lista.length, nuevas: 0, editadas: 0, alertas: 0, rechazadas: 0 };
  if (!lista.length) return salida;
  const ctx = await contextoRedaccion(pool);
  for (const bruta of lista) {
    const r = R.normalizarResena(bruta);
    if (!r) continue;
    const [[ex]] = await pool.query('SELECT * FROM resenas WHERE google_id = ?', [r.googleId]);
    if (ex) await actualizarExistente(pool, ex, r, ctx, ahora, salida);
    else await insertarNueva(pool, r, ctx, ahora, salida);
  }
  return salida;
}

// A los 30 días de leerlos se borran el texto y el autor (y lo que sale de ellos: los temas y el
// borrador con su nombre). Se quedan el id, las estrellas, las fechas, los estados y nuestras
// respuestas.
async function purgarContenido(pool, { ahora = new Date() } = {}) {
  const [filas] = await pool.query(
    `SELECT id, nota, estado, borrador_respuesta FROM resenas
      WHERE contenido_borrado_en IS NULL AND contenido_leido_en IS NOT NULL AND contenido_leido_en <= ?`,
    [new Date(ahora.getTime() - DIAS_CONTENIDO * DIA)]);
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

// Cada día, hasta 20 del historial en la bandeja con su borrador (primero las alertas, las de 1-2
// estrellas y las que tienen texto; las más recientes antes).
async function liberarHistorial(pool, { ahora = new Date(), cupo = CUPO_HISTORIAL } = {}) {
  const [[b]] = await pool.query("SELECT COUNT(*) AS n FROM resenas WHERE historial AND estado = 'borrador'");
  const n = Math.max(0, cupo - Number(b.n));
  if (!n) return { liberadas: 0 };
  const [filas] = await pool.query(
    `SELECT id, nota, autor, texto FROM resenas WHERE estado = 'historial'
      ORDER BY alerta_clinica DESC, nota <= 2 DESC, con_texto DESC, publicada_en DESC, id LIMIT ?`, [n]);
  if (!filas.length) return { liberadas: 0 };
  const ctx = await contextoRedaccion(pool);
  for (const r of filas) {
    await pool.query("UPDATE resenas SET estado = 'borrador', borrador_respuesta = ?, liberada_en = ? WHERE id = ? AND estado = 'historial'",
      [redactar(r, ctx), ahora, r.id]);
  }
  return { liberadas: filas.length };
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
// respuestas recientes (ninguna igual).
async function contextoRespuesta(q, resena) {
  const [trats] = await q.query('SELECT nombre, alias FROM tratamientos');
  const [equipo] = await q.query('SELECT nombre FROM profesionales');
  const [[cl]] = await q.query('SELECT telefono, whatsapp FROM clinica WHERE id = 1');
  const [recientes] = await q.query(
    "SELECT respuesta FROM resenas WHERE id <> ? AND respuesta IS NOT NULL AND estado IN ('aprobada','publicada') ORDER BY COALESCE(respondida_en, publicar_en) DESC LIMIT 60",
    [resena.id]);
  const alias = (v) => { try { return (typeof v === 'string' ? JSON.parse(v) : v) || []; } catch { return []; } };
  return {
    tratamientos: trats.flatMap((t) => [t.nombre, ...alias(t.alias)]),
    profesionales: equipo.map((x) => x.nombre),
    telefono: cl?.telefono || cl?.whatsapp || R.TELEFONO,
    recientes: recientes.map((x) => x.respuesta),
  };
}

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

// Quién contesta una reseña con alerta clínica: dirección médica (no marketing ni recepción).
const ROLES_ALERTA = ['direccion', 'medico', 'admin'];

/**
 * Una persona aprueba la respuesta (la del borrador o la que ha escrito). Se revisa antes: sin datos
 * de salud, ni del equipo, ni fechas, sin confirmar que es paciente, sin promociones ni enlaces y sin
 * repetir otra. Las reseñas recientes se contestan ya; las del historial salen por la cola, poco a
 * poco. rol: el de quien aprueba (el panel lo pasa siempre); una alerta clínica solo la contesta
 * dirección médica.
 * @returns {{ estado: 'publicada'|'aprobada', publicarEn?, avisos }}
 */
async function aprobarYPublicar(pool, google, { resenaId, texto = null, aprobadaPor, rol = null, ahora = new Date() }) {
  const [[r]] = await pool.query('SELECT * FROM resenas WHERE id = ?', [resenaId]);
  if (!r) throw new Error('No existe la reseña');
  if (r.estado === 'publicada') throw new Error('Esta reseña ya tiene su respuesta publicada');
  if (r.alerta_clinica && rol && !ROLES_ALERTA.includes(rol)) {
    throw new Error('Esta reseña tiene una alerta clínica: la contesta dirección médica');
  }
  const final = String(texto ?? r.borrador_respuesta ?? '').trim();
  if (!final) throw new Error('No hay texto para responder');
  const revision = R.revisarRespuesta(final, { ...(await contextoRespuesta(pool, r)), resena: { nota: r.nota, autor: r.autor, texto: r.texto } });
  if (!revision.ok) throw new Error(revision.errores.join(' '));
  if (r.historial) {
    const cuando = await siguienteHuecoHistorial(pool, ahora);
    await pool.query("UPDATE resenas SET respuesta = ?, estado = 'aprobada', aprobada_por = ?, publicar_en = ?, error_publicar = NULL WHERE id = ?",
      [final, aprobadaPor, cuando, r.id]);
    await cola.encolar(pool, TRABAJOS.publicar, { resenaId: r.id }, { ejecutarEn: cuando });
    await registrar(pool, { tipo: 'resena_aprobada', entidad: 'resena', entidadId: r.id, actor: aprobadaPor, datos: { publicarEn: cuando } });
    return { estado: 'aprobada', publicarEn: cuando, avisos: revision.avisos };
  }
  await publicar(pool, google, r, final, { aprobadaPor, ahora });
  return { estado: 'publicada', avisos: revision.avisos };
}

// El trabajo de la cola que publica una respuesta aprobada del historial cuando le toca.
async function publicarAprobada(pool, google, resenaId, { ahora = new Date() } = {}) {
  const [[r]] = await pool.query('SELECT * FROM resenas WHERE id = ?', [resenaId]);
  if (!r || r.estado !== 'aprobada' || !r.respuesta) return { omitida: true };
  if (r.publicar_en && new Date(r.publicar_en) > ahora) return cola.aplazar({ minutos: Math.ceil((new Date(r.publicar_en) - ahora) / 60000) });
  if (!google) throw new Error('Google no está disponible');
  try {
    await publicar(pool, google, r, r.respuesta, { ahora });
  } catch (err) {
    await pool.query('UPDATE resenas SET error_publicar = ? WHERE id = ?', [String(err.message).slice(0, 255), r.id]);
    throw err;
  }
  return { publicada: r.id };
}

// ── Cada minuto ─────────────────────────────────────────────────────────────────────────────

// El adaptador de Google para la cola (en el cron no viene en deps). Si no se puede crear (el modo
// real sin acceso todavía), no se hace lo de Google: se reintenta otro día.
function adaptadorGoogle() {
  try {
    return crearGoogle(config.modos.google);
  } catch {
    return null;
  }
}

// La tarea diaria, desde las 8:00 de Madrid: una vez por día (clave única en la cola).
async function encolarDiarias(pool, fecha, ahora) {
  const claves = [TRABAJOS.google, TRABAJOS.purgar, TRABAJOS.historial].map((tipo) => [tipo, `${tipo}-${fecha}`]);
  const [ya] = await pool.query('SELECT clave_unica FROM cola WHERE clave_unica IN (?)', [claves.map(([, c]) => c)]);
  const hechas = new Set(ya.map((x) => x.clave_unica));
  for (const [tipo, clave] of claves) if (!hechas.has(clave)) await cola.encolar(pool, tipo, {}, { ejecutarEn: ahora, claveUnica: clave });
}

/**
 * Lo de reseñas de cada minuto (lo llama el cron, después de las peticiones): los recordatorios que
 * tocan y los trabajos de la cola (la tarea diaria y las respuestas del historial).
 * deps: { pool, whatsapp, google? }
 */
async function vuelta(deps, { ahora = new Date() } = {}) {
  const { pool } = deps;
  const p = T.partesMadrid(ahora);
  if (p.minutos >= 8 * 60) await encolarDiarias(pool, p.fecha, ahora);
  let g;
  const google = () => (g !== undefined ? g : (g = deps.google !== undefined ? deps.google : adaptadorGoogle()));
  const recordatorios = (await enviarRecordatorios(deps, { ahora })).length;
  const trabajos = await cola.procesar(pool, {
    [TRABAJOS.google]: async () => {
      if (!google()) return null;
      const ficha = await actualizarFicha(pool, google(), { ahora });
      return { ficha, resenas: await importarResenas(pool, google(), { ahora }) };
    },
    [TRABAJOS.purgar]: () => purgarContenido(pool, { ahora }),
    [TRABAJOS.historial]: () => liberarHistorial(pool, { ahora }),
    [TRABAJOS.publicar]: (carga) => publicarAprobada(pool, google(), Number(carga.resenaId), { ahora }),
  }, { ahora, limite: 10 });
  return { recordatorios, trabajos };
}

// ── El panel ────────────────────────────────────────────────────────────────────────────────

function aPanel(x) {
  return {
    id: x.id, autor: x.autor, nota: x.nota, texto: x.texto, publicada: x.publicada_en, sentimiento: x.sentimiento, prioridad: x.prioridad,
    temas: typeof x.temas === 'string' ? JSON.parse(x.temas) : x.temas || [], borrador: x.borrador_respuesta, respuesta: x.respuesta, estado: x.estado,
    historial: Boolean(x.historial), alerta: Boolean(x.alerta_clinica), alertaAbierta: x.tarea_estado === 'abierta',
    publicarEn: x.publicar_en, errorPublicar: x.error_publicar, moderacion: x.respuesta_estado, motivoRechazo: x.respuesta_motivo_rechazo,
    rechazos: Number(x.respuestas_rechazadas || 0), conTexto: Boolean(x.con_texto), contenidoBorrado: Boolean(x.contenido_borrado_en),
  };
}

// Lo que enseña la pantalla «Reseñas»: los KPI, las reseñas que piden algo (alertas, por contestar,
// en cola) y las contestadas de los últimos 60 días, el historial y la ficha.
async function datosPanel(pool, { ahora = new Date() } = {}) {
  const [todas] = await pool.query(
    `SELECT nota, estado, historial, con_texto, temas, publicada_en, primera_respuesta_en, respuesta_estado, respuestas_rechazadas FROM resenas`);
  const [peticiones] = await pool.query(
    'SELECT enviada_en, pulsada_en, variante, recordatorio_enviado_en FROM peticiones_resena WHERE enviada_en > ?', [new Date(ahora.getTime() - 90 * DIA)]);
  const [lista] = await pool.query(
    `SELECT r.*, t.estado AS tarea_estado FROM resenas r LEFT JOIN tareas t ON t.id = r.alerta_tarea_id
      WHERE r.estado IN ('nueva','borrador','aprobada') OR (r.alerta_clinica AND t.estado = 'abierta')
         OR (r.estado = 'publicada' AND COALESCE(r.respondida_en, r.publicada_en) >= ?)
      ORDER BY (r.alerta_clinica AND t.estado = 'abierta') DESC, FIELD(r.estado, 'nueva', 'borrador', 'aprobada', 'publicada', 'historial', 'ignorada'),
               r.historial, r.publicada_en DESC, r.id DESC
      LIMIT 200`, [new Date(ahora.getTime() - 60 * DIA)]);
  const hoy = T.fechaMadrid(ahora);
  const [[h]] = await pool.query(
    `SELECT SUM(estado = 'historial') AS pendientes, SUM(historial AND estado = 'borrador') AS en_bandeja,
            SUM(historial AND estado = 'aprobada') AS en_cola,
            SUM(historial AND estado = 'publicada' AND publicar_en >= ? AND publicar_en < ?) AS publicadas_hoy
       FROM resenas`, [T.desdeMadrid(hoy, '00:00'), T.desdeMadrid(T.sumarDias(hoy, 1), '00:00')]);
  const [[cl]] = await pool.query('SELECT google_enlace_resena, google_place_id, google_ficha_leida_en FROM clinica WHERE id = 1');
  return {
    metricas: R.metricas({ resenas: todas, peticiones, ahora }),
    resenas: lista.map(aPanel),
    historial: {
      pendientes: Number(h?.pendientes || 0), enBandeja: Number(h?.en_bandeja || 0), enCola: Number(h?.en_cola || 0),
      publicadasHoy: Number(h?.publicadas_hoy || 0), cupo: CUPO_HISTORIAL,
    },
    ficha: { enlaceOficial: Boolean(cl?.google_enlace_resena), placeId: Boolean(cl?.google_place_id), leidaEn: cl?.google_ficha_leida_en || null },
    momentos: (await momentosActivos(pool)).map((v) => ({ variante: v, nombre: R.NOMBRE_VARIANTE[v] })),
  };
}

module.exports = {
  TRABAJOS, CUPO_HISTORIAL, DIAS_CONTENIDO, DIAS_HISTORIAL,
  programarPeticion, anularPeticion, omitidaPorOtraEnCamino, enviarPeticionesPendientes, enviarRecordatorios, abrirEnlace,
  actualizarFicha, importarResenas, purgarContenido, liberarHistorial, siguienteHuecoHistorial,
  aprobarYPublicar, publicarAprobada, vuelta, datosPanel,
};
