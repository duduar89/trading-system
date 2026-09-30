'use strict';
// Lo que entra de fuera: los webhooks de WhatsApp (mensajes y estados) y de Meta (leads de los
// formularios). La ruta (servidor/rutas/webhooks.js) comprueba la firma, guarda el cuerpo tal cual en
// «webhooks», encola un trabajo y contesta 200 al momento; el cron de cada minuto lo procesa aquí,
// antes que las secuencias (si el paciente ha contestado, su secuencia ya no le escribe).
//
//   texto, botón de plantilla, interactivo   → la repesca (procesarEntrante), que le contesta
//   audio, imagen, vídeo, documento,          → se registran («[audio]»…) y la conversación pasa a
//   ubicación, sticker, contacto…               una persona con tarea: nunca se quedan sin ver
//   referral (anuncio que abre WhatsApp)      → lead «meta_ctwa» ANTES de procesar el mensaje, para
//                                               que la repesca lo trate como lead
//   estados (enviado, entregado, leído,        → mensajes.estado y el error, por wa_id; el 131050 (ha
//   fallido)                                     dejado de recibir marketing) es una baja comercial
//   leadgen (formulario de Meta)              → se pide el lead a Meta → alta → secuencia «lead»
const cola = require('./cola');
const config = require('./config');
const R = require('./repesca/motor');
const { altaLead } = require('./leads');
const { crearMeta } = require('./integraciones/meta');
const { cifrar } = require('./cripto');
const { registrar } = require('./eventos');
const W = require('../motor/entrada/whatsapp');
const E = require('../motor/entrada/leads');
const { interpretar } = require('../motor/repesca/interpretar');

// Los avisos que solo traen estados (enviado, entregado, leído) van en su propio trabajo: son muchos
// cuando salen las secuencias y no pueden hacer esperar a lo que escribe un paciente.
const TRABAJOS = { whatsapp: 'webhook_whatsapp', estados: 'webhook_whatsapp_estados', meta: 'webhook_meta' };
const VENTANA_MS = 24 * 3600 * 1000;
const DOS_HORAS = 2 * 3600 * 1000;

async function enTransaccion(pool, fn) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const r = await fn(con);
    await con.commit();
    return r;
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
}

// ── Guardar y encolar (lo llama la ruta) ─────────────────────────────────────────────────────

// El cuerpo y su trabajo van en la misma transacción: lo que se ha contestado con un 200 ya no se
// pierde. Si Meta repite el aviso (mismo identificador), ni se guarda ni se encola otra vez.
async function guardarWebhook(pool, { proveedor, trabajo = TRABAJOS[proveedor], evento = null, idExterno = null, cuerpo, firmaOk = null }) {
  try {
    return await enTransaccion(pool, async (con) => {
      const [r] = await con.query('INSERT INTO webhooks (proveedor, evento, id_externo, cuerpo, firma_ok) VALUES (?, ?, ?, ?, ?)',
        [proveedor, evento ? String(evento).slice(0, 60) : null, idExterno, cuerpo, firmaOk]);
      await cola.encolar(con, trabajo, { webhookId: r.insertId }, { claveUnica: `webhook-${r.insertId}` });
      return { id: r.insertId, duplicado: false };
    });
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY' || !idExterno) throw err;
    const [[ya]] = await pool.query('SELECT id FROM webhooks WHERE proveedor = ? AND id_externo = ?', [proveedor, idExterno]);
    return { id: ya?.id || null, duplicado: true };
  }
}

// ── El paso del cron ───────────────────────────────────────────────────────────────────────

// Primero lo que ha escrito alguien y los leads; después los estados, que son rápidos y van en lotes
// más grandes.
async function procesarPendientes(deps, { ahora = new Date(), limite = 20 } = {}) {
  const whatsapp = (carga) => procesarWhatsApp(deps, carga.webhookId, { ahora });
  const a = await cola.procesar(deps.pool, {
    [TRABAJOS.whatsapp]: whatsapp,
    [TRABAJOS.meta]: (carga) => procesarMeta(deps, carga.webhookId, { ahora }),
  }, { ahora, limite });
  const b = await cola.procesar(deps.pool, { [TRABAJOS.estados]: whatsapp }, { ahora, limite: limite * 10 });
  return { hechos: a.hechos + b.hechos, reintentos: a.reintentos + b.reintentos, fallidos: a.fallidos + b.fallidos };
}

// Carga el webhook, lo procesa una vez y apunta cuándo; si falla, apunta el error y el cron lo
// reintenta (lo ya hecho no se repite: los mensajes van por wa_id y los leads por su id de Meta).
async function conWebhook(pool, id, ahora, fn) {
  const [[w]] = await pool.query('SELECT id, cuerpo, procesado_en FROM webhooks WHERE id = ?', [id]);
  if (!w || w.procesado_en) return { omitido: true };
  try {
    const r = await fn(JSON.parse(w.cuerpo));
    await pool.query('UPDATE webhooks SET procesado_en = ?, error = NULL WHERE id = ?', [ahora, id]);
    return r;
  } catch (err) {
    await pool.query('UPDATE webhooks SET error = ? WHERE id = ?', [String(err.message).slice(0, 1000), id]);
    throw err;
  }
}

// ── WhatsApp ───────────────────────────────────────────────────────────────────────────────

async function procesarWhatsApp(deps, webhookId, { ahora = new Date() } = {}) {
  return conWebhook(deps.pool, webhookId, ahora, async (cuerpo) => {
    const { mensajes, estados } = W.leerWebhook(cuerpo);
    const resumen = { estados: 0, mensajes: [] };
    for (const e of estados) resumen.estados += await aplicarEstado(deps, e, { ahora });
    for (const m of mensajes) resumen.mensajes.push(await atenderMensaje(deps, m, { ahora }));
    return resumen;
  });
}

async function atenderMensaje(deps, m, { ahora }) {
  const { pool } = deps;
  if (!m.telefono || !m.waId) {
    await registrar(pool, { tipo: 'whatsapp_sin_remitente', datos: { tipo: m.tipo } });
    return { omitido: 'sin remitente' };
  }
  const [[ya]] = await pool.query('SELECT id FROM mensajes WHERE wa_id = ?', [m.waId]);
  if (ya) return { duplicado: true };
  if (m.tipo === 'reaccion') return registrarReaccion(pool, m, { ahora });
  if (m.referral) await leadDesdeAnuncio(pool, m, { ahora });
  const nombre = await nombreParaSaludo(pool, m);

  // Una foto o un documento con una baja o algo de salud en la leyenda va por la repesca: la baja se
  // aplica al momento y lo de salud pasa a una persona con la urgencia que toque.
  const leyenda = m.leyenda ? interpretar(m.leyenda) : null;
  const aLaRepesca = m.aIa || ['baja', 'salud_personal'].includes(leyenda?.intencion);
  if (!aLaRepesca) return paraPersona(deps, m, { nombre, ahora });
  try {
    const r = await R.procesarEntrante(deps, { telefono: m.telefono, texto: m.texto, waId: m.waId, nombre, ahora });
    if (!r.duplicado) await completarMensaje(pool, m);
    return r;
  } catch (err) {
    // Si el mensaje ya quedó guardado, al reintentar se tomaría por repetido y nadie le contestaría:
    // pasa a una persona.
    const [[guardado]] = await pool.query('SELECT conversacion_id FROM mensajes WHERE wa_id = ?', [m.waId]);
    if (!guardado) throw err;
    await completarMensaje(pool, m);
    await aUnaPersona(pool, guardado.conversacion_id, { titulo: 'La respuesta automática ha fallado: contestar a mano', ahora });
    await registrar(pool, { tipo: 'repesca_error', entidad: 'conversacion', entidadId: guardado.conversacion_id, datos: { error: String(err.message).slice(0, 200) } });
    return { conversacionId: guardado.conversacion_id, error: err.message };
  }
}

// procesarEntrante lo guarda como texto: se le pone su tipo (botón, interactivo, imagen…), y la
// conversación se queda con el nombre de su perfil de WhatsApp.
async function completarMensaje(pool, m) {
  if (m.tipo !== 'texto') await pool.query('UPDATE mensajes SET tipo = ? WHERE wa_id = ?', [m.tipo, m.waId]);
  const perfil = E.limpiarNombre(m.perfil);
  if (perfil) await pool.query('UPDATE conversaciones c JOIN mensajes m ON m.conversacion_id = c.id SET c.nombre_whatsapp = ? WHERE m.wa_id = ?', [perfil, m.waId]);
}

async function aUnaPersona(q, conversacionId, { titulo, ahora }) {
  await q.query("UPDATE conversaciones SET estado = IF(estado = 'persona', 'persona', 'espera_persona'), proximo_paso = 'persona' WHERE id = ?", [conversacionId]);
  const [[abierta]] = await q.query("SELECT id FROM tareas WHERE conversacion_id = ? AND estado = 'abierta' LIMIT 1", [conversacionId]);
  if (abierta) return abierta.id;
  const [[c]] = await q.query('SELECT paciente_id, lead_id FROM conversaciones WHERE id = ?', [conversacionId]);
  const [r] = await q.query("INSERT INTO tareas (tipo, titulo, paciente_id, lead_id, conversacion_id, vence_en) VALUES ('atender_conversacion', ?, ?, ?, ?, ?)",
    [titulo.slice(0, 200), c?.paciente_id || null, c?.lead_id || null, conversacionId, new Date(ahora.getTime() + DOS_HORAS)]);
  return r.insertId;
}

// El nombre del perfil de WhatsApp solo se usa para saludar a quien aún no conocemos: si tiene ficha
// o es un lead con nombre, manda ese.
async function nombreParaSaludo(pool, m) {
  if (!m.perfil) return null;
  const [[p]] = await pool.query('SELECT id FROM pacientes WHERE telefono = ?', [m.telefono]);
  if (p) return null;
  const [[l]] = await pool.query("SELECT id FROM leads WHERE telefono = ? AND etapa NOT IN ('perdido','vendido') AND nombre IS NOT NULL LIMIT 1", [m.telefono]);
  if (l) return null;
  return E.nombrePila(m.perfil);
}

// Clic en un anuncio que abre WhatsApp: lead «meta_ctwa» con su ctwa_clid y el anuncio, y la
// conversación queda enlazada a él (contexto «lead»). Quien ya estaba en marcha no se duplica.
async function leadDesdeAnuncio(pool, m, { ahora }) {
  const ref = m.referral;
  const utm = Object.fromEntries(Object.entries({ tipo_fuente: ref.fuenteTipo, url_fuente: ref.fuenteUrl }).filter(([, v]) => v));
  const { leadId } = await altaLead(pool, {
    origen: 'meta_ctwa', telefono: m.telefono, nombre: m.perfil, anuncio: ref.titular, anuncioId: ref.fuenteId, ctwaClid: ref.ctwaClid,
    utm: Object.keys(utm).length ? utm : null,
    tratamiento: { claves: [ref.fuenteId, ref.titular], textos: [ref.titular, m.texto] },
  }, { inscribir: false, ahora });
  await enTransaccion(pool, async (con) => {
    const conv = await R.conversacionPara(con, { telefono: m.telefono, leadId, contexto: 'lead', contextoId: leadId, ahora });
    // Una conversación abierta sin lead (o con uno ya cerrado) pasa a ser la de este lead. El orden
    // del SET importa: contexto_id mira el contexto de antes.
    await con.query(
      `UPDATE conversaciones SET lead_id = ?, contexto_id = IF(contexto = 'general', ?, contexto_id), contexto = IF(contexto = 'general', 'lead', contexto)
        WHERE id = ? AND (lead_id IS NULL OR lead_id IN (SELECT id FROM leads WHERE etapa IN ('perdido','vendido')))`, [leadId, leadId, conv.id]);
  });
  return leadId;
}

async function nombreDeConversacion(pool, conv) {
  if (conv.paciente_id) {
    const [[p]] = await pool.query('SELECT nombre FROM pacientes WHERE id = ?', [conv.paciente_id]);
    if (p?.nombre) return p.nombre;
  }
  if (conv.lead_id) {
    const [[l]] = await pool.query('SELECT nombre FROM leads WHERE id = ?', [conv.lead_id]);
    if (l?.nombre) return E.nombrePila(l.nombre);
  }
  return E.nombrePila(conv.nombre_whatsapp);
}

// Audio, imagen, vídeo, documento, ubicación, sticker…: se registra, se para su secuencia y pasa a
// una persona con tarea. Si nadie la llevaba y es algo que espera respuesta (un audio, una foto),
// se le dice que lo ve una persona del equipo.
async function paraPersona(deps, m, { nombre, ahora }) {
  const { pool } = deps;
  const r = await enTransaccion(pool, async (con) => {
    const conv = await R.conversacionPara(con, { telefono: m.telefono, ahora });
    const c = cifrar(m.texto);
    try {
      await con.query(
        `INSERT INTO mensajes (conversacion_id, direccion, autor, tipo, cuerpo_cifrado, iv, tag, wa_id, estado, creado_en)
         VALUES (?, 'entrante', 'paciente', ?, ?, ?, ?, ?, 'recibido', ?)`, [conv.id, m.tipo, c.cifrado, c.iv, c.tag, m.waId, ahora]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return { duplicado: true };
      throw err;
    }
    await con.query('UPDATE conversaciones SET ultimo_entrante_en = ?, ventana_hasta = ?, nombre_whatsapp = COALESCE(?, nombre_whatsapp) WHERE id = ?',
      [ahora, new Date(ahora.getTime() + VENTANA_MS), E.limpiarNombre(m.perfil), conv.id]);
    if (conv.lead_id) await con.query("UPDATE leads SET etapa = 'conversando' WHERE id = ? AND etapa IN ('nuevo','contactado')", [conv.lead_id]);
    await con.query("UPDATE inscripciones SET estado = 'pausada', motivo_fin = 'el paciente contestó' WHERE estado = 'activa' AND ((paciente_id IS NOT NULL AND paciente_id = ?) OR (lead_id IS NOT NULL AND lead_id = ?))",
      [conv.paciente_id, conv.lead_id]);
    const tareaId = await aUnaPersona(con, conv.id, { titulo: m.tarea, ahora });
    await registrar(con, { tipo: 'mensaje_para_persona', entidad: 'conversacion', entidadId: conv.id, datos: { tipo: m.tipo } });
    return { conv, tareaId, yaLaLlevaba: ['persona', 'espera_persona'].includes(conv.estado) };
  });
  if (r.duplicado) return r;
  let respuesta = null;
  let envio = null;
  if (!r.yaLaLlevaba) {
    const hist = await R.historial(pool, r.conv.id);
    respuesta = W.respuestaAutomatica(m.tipo, { nombre: nombre || (await nombreDeConversacion(pool, r.conv)), primerMensajeIa: !hist.some((x) => x.autor === 'ia') });
    if (respuesta) envio = await R.enviar(deps, r.conv, { texto: respuesta, autor: 'ia', ahora });
  }
  return { conversacionId: r.conv.id, atiende: 'persona', tipo: m.tipo, tareaId: r.tareaId, respuesta, envio };
}

// Una reacción (👍 a un mensaje nuestro) queda en la conversación de ese mensaje, sin más.
async function registrarReaccion(pool, m, { ahora }) {
  const [[deMensaje]] = m.reaccion?.a ? await pool.query('SELECT conversacion_id FROM mensajes WHERE wa_id = ?', [m.reaccion.a]) : [[null]];
  const [[ultima]] = deMensaje ? [[null]] : await pool.query('SELECT id FROM conversaciones WHERE telefono = ? ORDER BY id DESC LIMIT 1', [m.telefono]);
  const conversacionId = deMensaje?.conversacion_id || ultima?.id;
  if (!conversacionId) return { omitido: 'reacción sin conversación' };
  const c = cifrar(m.texto);
  try {
    await pool.query(
      `INSERT INTO mensajes (conversacion_id, direccion, autor, tipo, cuerpo_cifrado, iv, tag, wa_id, estado, creado_en)
       VALUES (?, 'entrante', 'paciente', 'reaccion', ?, ?, ?, ?, 'recibido', ?)`, [conversacionId, c.cifrado, c.iv, c.tag, m.waId, ahora]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return { duplicado: true };
    throw err;
  }
  return { conversacionId, reaccion: m.reaccion.emoji };
}

// ── Estados de lo que enviamos ─────────────────────────────────────────────────────────────

// Los estados pueden llegar desordenados: nunca se baja de «leído» a «entregado».
const ORDEN = "'pendiente','enviado','fallido','entregado','leido'";

async function aplicarEstado(deps, e, { ahora }) {
  const { pool } = deps;
  const [r] = await pool.query(
    `UPDATE mensajes SET estado = ?, error_codigo = ?, error_texto = ?
      WHERE wa_id = ? AND direccion = 'saliente' AND FIELD(estado, ${ORDEN}) < FIELD(?, ${ORDEN})`,
    [e.estado, e.error?.codigo || null, e.error?.texto || null, e.waId, e.estado]);
  if (e.estado === 'fallido' && r.affectedRows) await trasUnFallo(pool, e, ahora);
  return r.affectedRows;
}

// Lo que no llega queda a la vista en la bandeja. Si era una respuesta escrita (de la IA o del
// equipo, no una plantilla), además pasa a una persona con tarea: el paciente cree que no le hemos
// contestado, o no tiene el enlace de su cita. Una baja ya confirmada no hace falta repetirla.
async function trasUnFallo(pool, e, ahora) {
  const [[m]] = await pool.query(
    `SELECT m.id, m.tipo, c.id AS conversacion_id, c.paciente_id, c.lead_id, c.motivo_cierre
       FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id WHERE m.wa_id = ?`, [e.waId]);
  if (!m) return;
  await registrar(pool, { tipo: 'whatsapp_no_entregado', entidad: 'conversacion', entidadId: m.conversacion_id, actor: 'meta', datos: { mensaje: m.id, codigo: e.error?.codigo || null } });
  if (e.error?.codigo === '131050') return bajaDeMarketing(pool, m, e, ahora);
  if (m.tipo !== 'plantilla' && m.motivo_cierre !== 'baja') {
    await aUnaPersona(pool, m.conversacion_id, { titulo: `No le ha llegado nuestro mensaje (${e.error?.texto || 'error de WhatsApp'}): revisarlo`, ahora });
  }
}

// 131050: el paciente ha pulsado en WhatsApp que no quiere mensajes de marketing de la clínica. Es
// una baja comercial: se apunta con su prueba y se cancelan sus secuencias. Si era un lead en marcha,
// tarea para que una persona decida si le llama.
async function bajaDeMarketing(pool, m, e, ahora) {
  await enTransaccion(pool, async (con) => {
    if (m.paciente_id) {
      const [[ultimo]] = await con.query("SELECT estado FROM consentimientos WHERE paciente_id = ? AND tipo = 'whatsapp_marketing' ORDER BY registrado_en DESC, id DESC LIMIT 1", [m.paciente_id]);
      if (ultimo?.estado !== 'revocado') {
        await con.query("INSERT INTO consentimientos (paciente_id, tipo, estado, fuente, prueba, registrado_por) VALUES (?, 'whatsapp_marketing', 'revocado', 'whatsapp', ?, 'meta')",
          [m.paciente_id, `Meta ${e.error.codigo}: ${e.error.texto}`.slice(0, 500)]);
      }
      await con.query('UPDATE pacientes SET baja_comercial_en = COALESCE(baja_comercial_en, ?) WHERE id = ?', [ahora, m.paciente_id]);
    }
    const [c] = await con.query(
      "UPDATE inscripciones SET estado = 'cancelada', motivo_fin = ? WHERE estado IN ('activa','pausada') AND ((paciente_id IS NOT NULL AND paciente_id = ?) OR (lead_id IS NOT NULL AND lead_id = ?))",
      ['ha dejado de recibir marketing en WhatsApp (Meta 131050)', m.paciente_id, m.lead_id]);
    let tarea = false;
    if (m.lead_id) {
      const [[l]] = await con.query("SELECT id FROM leads WHERE id = ? AND etapa IN ('nuevo','contactado','conversando')", [m.lead_id]);
      const [[abierta]] = await con.query("SELECT id FROM tareas WHERE lead_id = ? AND estado = 'abierta' LIMIT 1", [m.lead_id]);
      if (l && !abierta) {
        await con.query("INSERT INTO tareas (tipo, titulo, paciente_id, lead_id, conversacion_id, vence_en) VALUES ('llamar', ?, ?, ?, ?, ?)",
          ['Ha bloqueado los mensajes de marketing en WhatsApp: llamarle solo si procede', m.paciente_id, m.lead_id, m.conversacion_id, new Date(ahora.getTime() + DOS_HORAS)]);
        tarea = true;
      }
    }
    await registrar(con, { tipo: 'baja_marketing_whatsapp', entidad: 'conversacion', entidadId: m.conversacion_id, actor: 'meta', datos: { inscripcionesCanceladas: c.affectedRows, tarea } });
  });
}

// ── Leads de los formularios de Meta ───────────────────────────────────────────────────────

async function procesarMeta(deps, webhookId, { ahora = new Date() } = {}) {
  return conWebhook(deps.pool, webhookId, ahora, async (cuerpo) => {
    const altas = [];
    for (const x of E.leerWebhookLeads(cuerpo)) {
      // Al reintentar, lo que ya entró no se vuelve a pedir a Meta.
      const [[ya]] = await deps.pool.query("SELECT id FROM leads WHERE origen = 'meta_formulario' AND id_externo = ?", [x.leadgenId]);
      if (ya) { altas.push({ leadId: ya.id, nuevo: false, motivo: 'repetido' }); continue; }
      // El adaptador se crea al necesitarlo: si Meta no está configurado, fallan solo estos trabajos.
      if (!deps.meta) deps.meta = crearMeta(config.modos.meta);
      const l = await deps.meta.obtenerLead(x.leadgenId);
      const f = E.datosFormulario(l.field_data);
      const formularioId = l.form_id || x.formularioId;
      const utm = Object.fromEntries(Object.entries({
        plataforma: l.platform, formulario_id: formularioId, campana_id: l.campaign_id, conjunto_id: l.adset_id || x.conjuntoId, organico: l.is_organic,
      }).filter(([, v]) => v != null && v !== ''));
      altas.push(await altaLead(deps.pool, {
        origen: 'meta_formulario', idExterno: x.leadgenId, telefono: f.telefono, nombre: f.nombre, email: f.email,
        campana: l.campaign_name, conjunto: l.adset_name, anuncio: l.ad_name, anuncioId: l.ad_id || x.anuncioId,
        utm: Object.keys(utm).length ? utm : null, respuestas: f.respuestas,
        tratamiento: {
          respuesta: f.tratamiento,
          claves: [l.ad_id || x.anuncioId, l.ad_name, l.adset_id || x.conjuntoId, l.adset_name, l.campaign_id, l.campaign_name, formularioId],
          textos: [l.ad_name, l.adset_name, l.campaign_name],
        },
      }, { ahora }));
    }
    return altas;
  });
}

module.exports = { TRABAJOS, guardarWebhook, procesarPendientes, procesarWhatsApp, procesarMeta, atenderMensaje, aplicarEstado };
