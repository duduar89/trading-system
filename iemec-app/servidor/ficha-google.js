'use strict';
// La ficha de Google de verdad, desde el cron: los avisos al momento (Pub/Sub), las reseñas, los datos
// de la ficha y sus métricas. Solo con MODO_GOOGLE=real y credenciales: en simulado no hace nada
// (salvo borrar lo guardado de la API que haya pasado de plazo).
//
//   Aviso (POST /webhooks/google → «webhooks» + trabajo «webhook_google»): una reseña nueva o cambiada
//   se pide a Google y pasa a la importación de reseñas de siempre (servidor/resenas.js, de la pieza de
//   reseñas), que decide qué guarda: a una nueva le hace el análisis y el borrador de respuesta. Nada
//   se publica sin que lo apruebe una persona. Los demás avisos (Google cambia la ficha, cambia quién la
//   controla, una foto de un usuario, una ficha duplicada) son tareas para una persona: nada se deshace
//   solo.
//   Cada día, desde las 7:00 de Madrid: las reseñas tocadas en la última semana (por si se perdió un
//   aviso), las métricas de los últimos 30 días y la ficha (el place ID, quién la controla, los cambios
//   de Google y el aviso de reseñas sospechosas de Places). Una vez por semana: todas las reseñas y las
//   búsquedas con las que salió la ficha el mes pasado.
//   Esta es la única que lee las reseñas de Google y la única que cambia el place ID de la clínica (si
//   Google lo cambia, lo pone y una persona lo sabe). Lo de la pieza de reseñas que llama a Google (el
//   enlace oficial de la ficha y las respuestas aprobadas del historial: resenas.vueltaGoogle, cuando
//   exista) va también aquí, con el mismo adaptador, dentro del mismo candado y con el mismo tiempo.
//   Lo que viene de la Performance API se guarda como mucho 30 días (normas de la API: «no more than
//   30 calendar days»): las métricas de hace más de 30 días y las búsquedas de meses anteriores al
//   pasado se borran; si hacen falta, se vuelven a pedir.
const cola = require('./cola');
const resenas = require('./resenas');
const { descifrarCuerpo } = require('./entrada');
const { registrar } = require('./eventos');
const { adaptadorReal, enReal, tareaUnica, conAviso, unaVez } = require('./trabajos-externos');
const { crearGoogle, leerAvisoPubSub } = require('./integraciones/google');
const T = require('../motor/tiempo');

const TRABAJOS = { aviso: 'webhook_google', resenas: 'google_resenas', metricas: 'google_metricas', palabras: 'google_palabras', ficha: 'google_ficha' };
const DIA = 86400000;
const HORA_DESDE = 7 * 60;
const RETENCION_DIAS = 30;
const DIAS_RESENAS = 8;

const TAREAS = {
  cambiosDeGoogle: 'Google ha cambiado datos de la ficha: revisarlos en Business Profile (no se deshacen solos)',
  control: 'Ha cambiado quién controla la ficha de Google: comprobar hoy mismo que la clínica la sigue gestionando',
  sinControl: 'La clínica ha perdido el control de la ficha de Google: revisarlo en Business Profile cuanto antes',
  duplicada: 'Google avisa de una ficha duplicada de la clínica: revisarlo en Business Profile',
  foto: 'Alguien ha subido una foto o un vídeo a la ficha de Google: revisarlo (puede salir un paciente)',
  sospechosas: 'Google muestra en la ficha un aviso de reseñas sospechosas: revisarlo en Business Profile',
  placeId: 'Google ha cambiado el place ID de la ficha y la app ya usa el nuevo: cambiarlo en GOOGLE_PLACE_ID (.env), en la web y en los QR o enlaces para reseñar que lo lleven',
};

const mesAnterior = (fecha) => T.sumarMeses(T.primerDiaDelMes(fecha), -1).slice(0, 7);

// El adaptador de Google para el cron: el de deps (las pruebas) o el real de la configuración
// (MODO_GOOGLE=real). Nunca el real a partir del .env bajo `node --test`.
const MODO = { clave: 'google', variable: 'MODO_GOOGLE', crear: (env) => crearGoogle('real', { env }) };
const adaptador = (deps, env = process.env) => adaptadorReal(deps, MODO, env);
const activo = (deps, env = process.env) => enReal(deps, MODO, env);

// ── Avisos de Pub/Sub ──────────────────────────────────────────────────────────────────────

// ¿Es de nuestra ficha? (Si el adaptador no sabe cuál es la nuestra, se da por buena.)
const esNuestra = (google, aviso) => !google.ubicacion || !aviso.ficha || aviso.ficha.ubicacion === google.ubicacion;

async function atenderAviso(deps, aviso, { ahora, webhookId }) {
  const { pool, google } = deps;
  if (aviso.ficha && !esNuestra(google, aviso)) {
    await pool.query("UPDATE webhooks SET evento = 'ajeno' WHERE id = ?", [webhookId]);
    await registrar(pool, { tipo: 'webhook_ajeno', entidad: 'webhook', entidadId: webhookId, actor: 'google', datos: { proveedor: 'google', ubicacion: aviso.ficha.ubicacion } });
    return { ajeno: true };
  }
  switch (aviso.tipo) {
    case 'NEW_REVIEW':
    case 'UPDATED_REVIEW': {
      if (!aviso.resena) return { sinResena: true };
      let r;
      try {
        r = await google.obtenerResena(aviso.resena.id);
      } catch (err) {
        if (err.estado === 404) return { borrada: true }; // la quitaron antes de que llegáramos
        throw err;
      }
      if (!r) return { sinNota: true };
      // La importación de siempre, con esta reseña sola (el adaptador, con su lista de una) y la hora
      // del cron.
      return { tipo: aviso.tipo, ...(await resenas.importarResenas(pool, { ...google, listarResenas: async () => [r] }, { ahora })) };
    }
    case 'GOOGLE_UPDATE': return { tareaId: await tareaUnica(pool, { titulo: TAREAS.cambiosDeGoogle, ahora }) };
    case 'VOICE_OF_MERCHANT_UPDATED': return { tareaId: await tareaUnica(pool, { titulo: TAREAS.control, urgente: true, ahora }) };
    case 'DUPLICATE_LOCATION': return { tareaId: await tareaUnica(pool, { titulo: TAREAS.duplicada, ahora }) };
    case 'NEW_CUSTOMER_MEDIA': return { tareaId: await tareaUnica(pool, { titulo: TAREAS.foto, ahora }) };
    default: return { ignorado: aviso.tipo || 'sin tipo' }; // p. ej., los de preguntas y respuestas (cerradas)
  }
}

// Carga el aviso guardado, lo atiende una vez y apunta cuándo; si falla, apunta el error y la cola lo
// reintenta (una reseña ya importada no se duplica).
async function procesarAviso(deps, webhookId, { ahora = new Date() } = {}) {
  const { pool } = deps;
  const [[w]] = await pool.query('SELECT id, cuerpo, procesado_en FROM webhooks WHERE id = ?', [webhookId]);
  if (!w || w.procesado_en) return { omitido: true };
  try {
    let cuerpo = {};
    try { cuerpo = w.cuerpo ? JSON.parse(descifrarCuerpo(w.cuerpo)) : {}; } catch { cuerpo = {}; } // vaciado a los 30 días
    const r = await atenderAviso(deps, leerAvisoPubSub(cuerpo), { ahora, webhookId });
    await pool.query('UPDATE webhooks SET procesado_en = ?, error = NULL WHERE id = ?', [ahora, webhookId]);
    return r;
  } catch (err) {
    await pool.query('UPDATE webhooks SET error = ? WHERE id = ?', [String(err.message).slice(0, 1000), webhookId]);
    throw err;
  }
}

// ── Reseñas, métricas, búsquedas y ficha ───────────────────────────────────────────────────

// Las reseñas tocadas desde «desde» (o todas), por la importación de siempre, con la hora del cron.
// Sin «desde» es la lista completa de la ficha (completa: lo que ya no viene lo quitó Google o quien
// la escribió).
async function sincronizarResenas(deps, { desde = null, ahora = new Date() } = {}) {
  const { google } = deps;
  return resenas.importarResenas(deps.pool, { ...google, listarResenas: () => google.listarResenas({ desde }) }, { ahora, completa: !desde });
}

// Las métricas diarias de los últimos 30 días (las de los últimos días cambian: se vuelven a pedir).
async function guardarMetricas(deps, { ahora = new Date() } = {}) {
  const hoy = T.fechaMadrid(ahora);
  const filas = await deps.google.metricasDiarias({ desde: T.sumarDias(hoy, -RETENCION_DIAS), hasta: T.sumarDias(hoy, -1) });
  const validas = filas.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.fecha) && f.metrica && Number.isFinite(f.valor) && f.valor >= 0);
  for (let i = 0; i < validas.length; i += 500) {
    await deps.pool.query('INSERT INTO metricas_gbp (fecha, metrica, valor) VALUES ? ON DUPLICATE KEY UPDATE valor = VALUES(valor)',
      [validas.slice(i, i + 500).map((f) => [f.fecha, String(f.metrica).slice(0, 60), Math.round(f.valor)])]);
  }
  return { filas: validas.length };
}

// Las búsquedas del mes: la lista se sustituye entera. Dos que la base ve iguales (con y sin tilde) se
// suman.
async function guardarPalabras(deps, { mes }) {
  if (!/^\d{4}-\d{2}$/.test(String(mes))) throw new Error(`Mes no válido: ${mes}`);
  const filas = await deps.google.palabrasDelMes(mes);
  const con = await deps.pool.getConnection();
  try {
    await con.beginTransaction();
    await con.query('DELETE FROM busquedas_gbp WHERE mes = ?', [mes]);
    for (let i = 0; i < filas.length; i += 500) {
      await con.query(
        `INSERT INTO busquedas_gbp (mes, palabra, impresiones, umbral) VALUES ?
         ON DUPLICATE KEY UPDATE impresiones = IF(impresiones IS NULL AND VALUES(impresiones) IS NULL, NULL, COALESCE(impresiones, 0) + COALESCE(VALUES(impresiones), 0)),
                                 umbral = COALESCE(umbral, VALUES(umbral))`,
        [filas.slice(i, i + 500).map((f) => [mes, f.palabra, f.impresiones, f.umbral])]);
    }
    await con.commit();
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
  return { mes, palabras: filas.length };
}

// La ficha: el place ID al día (Google lo puede cambiar), quién la controla, los cambios que propone
// Google y, con Places, el aviso de reseñas sospechosas. Lo que hay que mirar, a una persona. El place
// ID es de la ficha y se puede guardar (también el de Places); si cambia, la app usa el nuevo (el
// enlace para reseñar, reconocer a la clínica en la malla) y una persona cambia lo que la app no ve.
async function revisarFicha(deps, { ahora = new Date() } = {}) {
  const { pool, google } = deps;
  const f = await google.obtenerFicha({ refrescar: true });
  const r = { placeId: f.placeId || null, tareas: [] };
  const [[cl]] = await pool.query('SELECT google_place_id FROM clinica WHERE id = 1');
  if (cl && f.placeId && f.placeId !== cl.google_place_id) {
    await pool.query('UPDATE clinica SET google_place_id = ? WHERE id = 1', [f.placeId]);
    await registrar(pool, { tipo: 'google_place_id', entidad: 'clinica', entidadId: 1, actor: 'google', datos: { antes: cl.google_place_id, ahora: f.placeId } });
    r.placeIdCambiado = true;
    // Si no había ninguno, solo se completa; si cambia, que lo sepa una persona.
    if (cl.google_place_id) r.tareas.push(await tareaUnica(pool, { titulo: TAREAS.placeId, ahora }));
  }
  if (f.conVoz === false) r.tareas.push(await tareaUnica(pool, { titulo: TAREAS.sinControl, urgente: true, ahora }));
  if (f.googleHaCambiado === true) r.tareas.push(await tareaUnica(pool, { titulo: TAREAS.cambiosDeGoogle, ahora }));
  if (google.capacidades?.places) {
    const p = await google.fichaPlaces();
    if (p.avisoConsumidor) r.tareas.push(await tareaUnica(pool, { titulo: TAREAS.sospechosas, ahora }));
  }
  return r;
}

// ── Publicaciones (posts) ──────────────────────────────────────────────────────────────────

/**
 * Publica en la ficha una publicación de publicaciones_gbp que aprueba una persona (quien pulsa en el
 * panel). Solo novedades: las ofertas y los eventos se hacen a mano, revisados.
 */
async function publicarNovedad(pool, google, { publicacionId, aprobadaPor, ahora = new Date() }) {
  const [[p]] = await pool.query('SELECT * FROM publicaciones_gbp WHERE id = ?', [publicacionId]);
  if (!p) throw new Error('No existe la publicación');
  if (['publicada', 'descartada'].includes(p.estado)) throw new Error(`La publicación está ${p.estado}`);
  if (p.tipo !== 'novedad') throw new Error('Por la API solo se publican novedades; las ofertas y los eventos, a mano en la ficha');
  const r = await google.publicarNovedad({ texto: p.texto, botonUrl: p.boton_url || null, aprobadaPor });
  await pool.query("UPDATE publicaciones_gbp SET estado = 'publicada', google_id = ? WHERE id = ?", [r.googleId ? String(r.googleId).slice(0, 160) : null, p.id]);
  await registrar(pool, { tipo: 'publicacion_gbp_publicada', entidad: 'publicacion_gbp', entidadId: p.id, actor: aprobadaPor, datos: { estado: r.estado, en: ahora.toISOString() } });
  return r;
}

// ── El cron ────────────────────────────────────────────────────────────────────────────────

// Lo guardado de la Performance API que ha pasado de plazo, una vez al día y en cualquier modo.
async function purgar(pool, ahora = new Date()) {
  const hoy = T.fechaMadrid(ahora);
  const [a] = await pool.query('DELETE FROM metricas_gbp WHERE fecha < ?', [T.sumarDias(hoy, -RETENCION_DIAS)]);
  const [b] = await pool.query('DELETE FROM busquedas_gbp WHERE mes < ?', [mesAnterior(hoy)]);
  return a.affectedRows + b.affectedRows;
}

async function purgarCadaDia(pool, ahora = new Date()) {
  const fecha = T.fechaMadrid(ahora);
  const r = await unaVez(pool, `google-purga-${fecha}`, new Date(ahora.getTime() + 2 * DIA), async () => {
    await pool.query("DELETE FROM candados WHERE (nombre LIKE 'google-%' OR nombre LIKE 'posiciones-%') AND hasta < ?", [ahora]);
    return purgar(pool, ahora);
  });
  return r.ejecutado ? r.resultado : 0;
}

// Lo de cada día (desde las 7:00 de Madrid) y lo de cada semana (el primer día de la semana que pase el
// cron), por la cola: si Google falla, se reintenta sin repetir lo hecho.
async function programar(pool, google, { ahora = new Date() } = {}) {
  const p = T.partesMadrid(ahora);
  if (p.minutos < HORA_DESDE) return [];
  const encolados = [];
  const encolar = async (tipo, carga, clave) => {
    await cola.encolar(pool, tipo, carga, { claveUnica: clave, ejecutarEn: ahora, maxIntentos: 6 });
    encolados.push(tipo);
  };
  const { ficha, places } = google.capacidades || {};
  await unaVez(pool, `google-dia-${p.fecha}`, new Date(ahora.getTime() + 2 * DIA), async () => {
    if (ficha) {
      await encolar(TRABAJOS.resenas, { desde: new Date(ahora.getTime() - DIAS_RESENAS * DIA).toISOString() }, `google-resenas-${p.fecha}`);
      await encolar(TRABAJOS.metricas, {}, `google-metricas-${p.fecha}`);
    }
    if (ficha || places) await encolar(TRABAJOS.ficha, {}, `google-ficha-${p.fecha}`);
  });
  if (ficha) {
    const lunes = T.sumarDias(p.fecha, 1 - p.diaSemana);
    await unaVez(pool, `google-semana-${lunes}`, new Date(ahora.getTime() + 8 * DIA), async () => {
      await encolar(TRABAJOS.resenas, { desde: null }, `google-resenas-todas-${lunes}`);
      await encolar(TRABAJOS.palabras, { mes: mesAnterior(p.fecha) }, `google-palabras-${lunes}`);
    });
  }
  return encolados;
}

/**
 * Una vuelta del cron (dentro de su candado): programa lo del día y de la semana y hace lo que haya en
 * la cola, con tiempo tasado; después, lo de la pieza de reseñas que llama a Google (si lo tiene), con
 * el mismo adaptador y el tiempo que quede. null si Google no está en real.
 */
async function vuelta(deps, { ahora = new Date(), env = process.env, presupuestoMs = 20000 } = {}) {
  const google = adaptador(deps, env); // queda en deps.google
  if (!google) return null;
  const { pool } = deps;
  const programados = await programar(pool, google, { ahora });
  const cortarEn = Date.now() + presupuestoMs;
  // El título de la tarea para una persona, entero: «no se han podido traer las reseñas».
  const aviso = (titulo, fn) => conAviso(pool, ahora, `Google: ${titulo}`, fn);
  const r = await cola.procesar(pool, {
    [TRABAJOS.aviso]: aviso('no se ha podido atender un aviso de la ficha', (c) => procesarAviso(deps, c.webhookId, { ahora })),
    [TRABAJOS.resenas]: aviso('no se han podido traer las reseñas', (c) => sincronizarResenas(deps, { desde: c.desde || null, ahora })),
    [TRABAJOS.metricas]: aviso('no se han podido traer las métricas', () => guardarMetricas(deps, { ahora })),
    [TRABAJOS.palabras]: aviso('no se han podido traer las búsquedas del mes', (c) => guardarPalabras(deps, { mes: c.mes })),
    [TRABAJOS.ficha]: aviso('no se ha podido revisar la ficha', () => revisarFicha(deps, { ahora })),
  }, { ahora, limite: 10, cortarEn });
  const informe = programados.length ? { programados, ...r } : r;
  if (typeof resenas.vueltaGoogle === 'function') {
    try {
      const x = await resenas.vueltaGoogle(deps, { ahora, cortarEn });
      if (x) informe.resenas = x;
    } catch (err) {
      informe.resenas = { error: String(err.message).slice(0, 300) };
    }
  }
  return informe;
}

module.exports = {
  TRABAJOS, TAREAS, RETENCION_DIAS, activo, adaptador, vuelta, programar, procesarAviso, sincronizarResenas, guardarMetricas,
  guardarPalabras, revisarFicha, publicarNovedad, purgar, purgarCadaDia,
};
