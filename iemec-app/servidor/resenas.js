'use strict';
// Reseñas con la base: programar la petición tras cada cita completada, enviarla, registrar el
// clic del enlace corto, importar reseñas de Google con su análisis y borrador, y publicar solo
// lo que una persona ha aprobado.
const crypto = require('crypto');
const R = require('../motor/resenas/resenas');
const { elegirPlantilla } = require('../motor/repesca/plantillas');
const { calendarioDesdeBd, enviar } = require('./repesca/motor');
const { registrar } = require('./eventos');

// Lo que se mira del paciente para pedirle la reseña: al programarla y otra vez justo antes de
// enviarla (entre medias puede darse de baja, quejarse, dejar la reseña o recibir otra petición).
// Al programarla cuenta también la que ya está en camino: dos citas el mismo día, una petición.
async function situacionDe(q, cita, { alEnviar = false } = {}) {
  const [[paciente]] = await q.query('SELECT * FROM pacientes WHERE id = ?', [cita.paciente_id]);
  const [[ultima]] = await q.query("SELECT MAX(enviada_en) AS en FROM peticiones_resena WHERE paciente_id = ? AND cita_id <> ? AND estado = 'enviada'", [cita.paciente_id, cita.id]);
  const [[enCamino]] = alEnviar ? [[{ n: 0 }]]
    : await q.query("SELECT COUNT(*) AS n FROM peticiones_resena WHERE paciente_id = ? AND cita_id <> ? AND estado = 'programada'", [cita.paciente_id, cita.id]);
  const [[resenada]] = await q.query('SELECT COUNT(*) AS n FROM resenas WHERE paciente_id = ?', [cita.paciente_id]);
  const [[queja]] = await q.query("SELECT COUNT(*) AS n FROM conversaciones WHERE paciente_id = ? AND estado IN ('espera_persona','persona')", [cita.paciente_id]);
  return {
    cita, paciente, ultimaPeticion: ultima?.en || null, otraEnCamino: enCamino.n > 0,
    yaResenoEnGoogle: resenada.n > 0, conversacionAbiertaConQueja: queja.n > 0,
  };
}

// `pool` puede ser también la conexión de una transacción (al completar la cita desde el panel).
// noAntesDe: la petición no sale antes (mientras recepción aún puede deshacer «Completada»).
async function programarPeticion(pool, citaId, { noAntesDe = null } = {}) {
  const [[cita]] = await pool.query('SELECT * FROM citas WHERE id = ?', [citaId]);
  if (!cita) throw new Error('No existe la cita');
  const calendario = await calendarioDesdeBd(pool);
  const d = R.pedirResena({ ...(await situacionDe(pool, cita)), noAntesDe }, calendario);
  const token = crypto.randomBytes(16).toString('base64url').slice(0, 22);
  await pool.query(
    'INSERT INTO peticiones_resena (cita_id, paciente_id, token, programada_para, estado, motivo) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id',
    [cita.id, cita.paciente_id, token, d.pedir ? d.cuando : new Date(cita.fin), d.pedir ? 'programada' : 'omitida', d.pedir ? null : d.motivo]);
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

async function enviarPeticionesPendientes(deps, { ahora = new Date() } = {}) {
  const { pool } = deps;
  const [filas] = await pool.query(
    `SELECT pr.*, p.nombre, p.telefono FROM peticiones_resena pr JOIN pacientes p ON p.id = pr.paciente_id
      WHERE pr.estado = 'programada' AND pr.programada_para <= ? ORDER BY pr.programada_para, pr.id`, [ahora]);
  const [plantillas] = await pool.query("SELECT * FROM plantillas WHERE estado = 'aprobada'");
  const p = elegirPlantilla('resena', plantillas.map((x) => ({ ...x, reservaDeId: x.reserva_de_id })));
  const hechas = [];
  for (const f of filas) {
    // Justo antes de enviarla se vuelve a mirar: una baja, una queja, una reseña o una petición que
    // ha salido después de programar esta mandan. Si no toca, queda omitida con su motivo.
    const [[cita]] = await pool.query('SELECT * FROM citas WHERE id = ?', [f.cita_id]);
    const motivo = R.motivoParaNoPedir(await situacionDe(pool, cita, { alEnviar: true }), { referencia: ahora });
    if (motivo) {
      await pool.query("UPDATE peticiones_resena SET estado = 'omitida', motivo = ? WHERE id = ? AND estado = 'programada'", [motivo, f.id]);
      continue;
    }
    const [upd] = await pool.query("UPDATE peticiones_resena SET estado = 'enviada', enviada_en = ? WHERE id = ? AND estado = 'programada'", [ahora, f.id]);
    if (!upd.affectedRows) continue; // otro cron la cogió
    if (!p || !f.telefono) { await pool.query("UPDATE peticiones_resena SET estado = 'fallida', motivo = ? WHERE id = ?", [p ? 'sin teléfono' : 'sin plantilla aprobada', f.id]); continue; }
    const [[conv0]] = await pool.query("SELECT * FROM conversaciones WHERE telefono = ? AND estado <> 'cerrada' ORDER BY id DESC LIMIT 1", [f.telefono]);
    let conv = conv0;
    if (!conv) {
      const [r] = await pool.query("INSERT INTO conversaciones (telefono, paciente_id, contexto, estado) VALUES (?, ?, 'cita', 'esperando_paciente')", [f.telefono, f.paciente_id]);
      [[conv]] = await pool.query('SELECT * FROM conversaciones WHERE id = ?', [r.insertId]);
    }
    await enviar(deps, conv, { plantilla: p, variables: [f.nombre], ahora });
    hechas.push(f.id);
  }
  return hechas;
}

// El enlace corto /r/:token registra el clic y lleva a escribir la reseña en Google.
async function abrirEnlace(pool, token, placeId, ahora = new Date()) {
  const [[f]] = await pool.query('SELECT id FROM peticiones_resena WHERE token = ?', [token]);
  if (f) await pool.query('UPDATE peticiones_resena SET pulsada_en = COALESCE(pulsada_en, ?) WHERE id = ?', [ahora, f.id]);
  return R.enlaceResena(placeId);
}

async function importarResenas(pool, google) {
  const lista = await google.listarResenas();
  let nuevas = 0;
  let indice = 0;
  for (const r of lista) {
    const [[existe]] = await pool.query('SELECT id FROM resenas WHERE google_id = ?', [r.googleId]);
    if (existe) {
      await pool.query('UPDATE resenas SET texto = ?, nota = ? WHERE id = ?', [r.texto, r.nota, existe.id]);
      continue;
    }
    const a = R.analizar(r);
    const b = R.borradorRespuesta(r, { indice: indice++ });
    await pool.query(
      `INSERT INTO resenas (google_id, autor, nota, texto, publicada_en, temas, sentimiento, prioridad, borrador_respuesta, respuesta, estado, respondida_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.googleId, r.autor, r.nota, r.texto, new Date(r.publicadaEn), JSON.stringify(a.temas), a.sentimiento, a.prioridad,
        r.respuesta ? null : b.texto, r.respuesta || null, r.respuesta ? 'publicada' : 'borrador', r.respondidaEn ? new Date(r.respondidaEn) : null]);
    nuevas++;
  }
  return { leidas: lista.length, nuevas };
}

async function aprobarYPublicar(pool, google, { resenaId, texto = null, aprobadaPor, ahora = new Date() }) {
  const [[r]] = await pool.query('SELECT * FROM resenas WHERE id = ?', [resenaId]);
  if (!r) throw new Error('No existe la reseña');
  const final = texto || r.borrador_respuesta;
  if (!final) throw new Error('No hay texto para responder');
  if (/b[oó]tox|toxina|relleno|injerto|tratamiento de/i.test(final)) throw new Error('La respuesta nombra un tratamiento: una reseña es pública y no puede llevar datos de salud');
  await google.responderResena(r.google_id, final);
  await pool.query("UPDATE resenas SET respuesta = ?, estado = 'publicada', aprobada_por = ?, respondida_en = ? WHERE id = ?", [final, aprobadaPor, ahora, resenaId]);
  await registrar(pool, { tipo: 'resena_respondida', entidad: 'resena', entidadId: resenaId, actor: aprobadaPor });
}

module.exports = { programarPeticion, anularPeticion, omitidaPorOtraEnCamino, enviarPeticionesPendientes, abrirEnlace, importarResenas, aprobarYPublicar };
