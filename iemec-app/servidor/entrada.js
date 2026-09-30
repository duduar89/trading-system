'use strict';
// Lo que entra de fuera: los webhooks de WhatsApp (mensajes y estados) y de Meta (leads de los
// formularios). La ruta (servidor/rutas/webhooks.js) comprueba la firma, guarda el cuerpo tal cual en
// «webhooks», encola un trabajo y contesta 200 al momento; el cron de cada minuto lo procesa aquí,
// antes que las secuencias (si el paciente ha contestado, su secuencia ya no le escribe).
//
//   texto, botón de plantilla, interactivo   → la repesca (procesarEntrante), que le contesta
//   audio, imagen, vídeo, documento,          → se registran («[audio]»…) y la conversación pasa a
//   ubicación, sticker, contacto…               una persona con tarea: nunca se quedan sin ver (si
//                                               ha tenido un tratamiento médico hace poco, urgente)
//   referral (anuncio que abre WhatsApp)      → lead «meta_ctwa» ANTES de procesar el mensaje, para
//                                               que la repesca lo trate como lead
//   «(ref. web-…)» (botón de WhatsApp de la   → lead «web_whatsapp» con su referencia y su
//   web pública)                                tratamiento, también antes del mensaje; se entiende
//                                               como una petición de información de esa página
//   «Sí, fui yo» / «No fui yo» (la respuesta  → la solicitud queda verificada (y sigue la conversación)
//   al WhatsApp que confirma una solicitud      o se borra lo que escribió quien la envió
//   del formulario de la web)
//   estados (enviado, entregado, leído,        → mensajes.estado y el error, por wa_id; el 131050 (ha
//   fallido)                                     dejado de recibir marketing) es una baja comercial; el
//                                               aviso de un hueco que no llega pasa al siguiente de la
//                                               lista de espera
//   leadgen (formulario de Meta)              → se pide el lead a Meta → alta → secuencia «lead»; si
//                                               Meta no deja leerlo, tarea para recepción
// Los mensajes de un mismo teléfono se procesan de uno en uno y por orden, aunque haya dos cron a la
// vez. Lo que llega para otro número u otra página de la misma app de Meta se guarda, pero no se toca.
const cola = require('./cola');
const config = require('./config');
const R = require('./repesca/motor');
const LE = require('./lista-espera');
const { altaLead, verificarSolicitudWeb, rechazarSolicitudWeb } = require('./leads');
const { apuntarBaja } = require('./bajas');
const { crearMeta } = require('./integraciones/meta');
const { combinar } = require('./integraciones/ia');
const { cifrar, descifrar } = require('./cripto');
const { registrar } = require('./eventos');
const W = require('../motor/entrada/whatsapp');
const E = require('../motor/entrada/leads');
const { interpretar } = require('../motor/repesca/interpretar');
const { referenciaDeWhatsapp, sinReferencia, respuestaConfirmacion, huellaCampana } = require('../motor/entrada/web');
const { cargarReferencias, entradaDe } = require('./referencias-web');

// Los avisos que solo traen estados (enviado, entregado, leído) van en su propio trabajo: son muchos
// cuando salen las secuencias y no pueden hacer esperar a lo que escribe un paciente.
const TRABAJOS = { whatsapp: 'webhook_whatsapp', estados: 'webhook_whatsapp_estados', meta: 'webhook_meta' };
// Leer un lead de Meta puede fallar un rato (la Graph API, el token): más intentos, unas 2 h.
const INTENTOS = { webhook_meta: 8 };
const VENTANA_MS = 24 * 3600 * 1000;
const DOS_HORAS = 2 * 3600 * 1000;
const QUINCE_MIN = 15 * 60 * 1000;
const DIAS_TRATAMIENTO_RECIENTE = 14;

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

// ¿Es de la clínica? WHATSAPP_NUMERO_ID y META_PAGINA_ID (se admiten varios, separados por comas).
// Sin la variable, todo vale (en el portátil); en producción hay que ponerla.
function esDeLaClinica(id, variable) {
  const propios = String(process.env[variable] || '').split(',').map((x) => x.trim()).filter(Boolean);
  return !propios.length || (id != null && propios.includes(String(id)));
}

// La hora del mensaje es la que manda WhatsApp (si no llega o es del futuro, la del cron).
function horaDe(m, ahora) {
  return m.marca instanceof Date && !Number.isNaN(m.marca.getTime()) && m.marca < ahora ? m.marca : ahora;
}

// ── Guardar y encolar (lo llama la ruta) ─────────────────────────────────────────────────────

// El cuerpo se guarda tal cual llegó, pero cifrado como los mensajes: trae lo que escribió el
// paciente y su nombre. «aes:iv:tag:datos», en base64.
function cifrarCuerpo(texto) {
  const c = cifrar(texto);
  return `aes:${c.iv.toString('base64')}:${c.tag.toString('base64')}:${c.cifrado.toString('base64')}`;
}

function descifrarCuerpo(guardado) {
  if (!String(guardado).startsWith('aes:')) return guardado;
  const [, iv, tag, datos] = guardado.split(':');
  return descifrar(Buffer.from(datos, 'base64'), Buffer.from(iv, 'base64'), Buffer.from(tag, 'base64'));
}

// El cuerpo y su trabajo van en la misma transacción: lo que se ha contestado con un 200 ya no se
// pierde. Si Meta repite el aviso (mismo identificador), ni se guarda ni se encola otra vez. El
// trabajo lleva los teléfonos de sus mensajes: los de un mismo teléfono van por orden.
async function guardarWebhook(pool, { proveedor, trabajo = TRABAJOS[proveedor], evento = null, idExterno = null, cuerpo, firmaOk = null, telefonos = [], ahora = new Date() }) {
  try {
    return await enTransaccion(pool, async (con) => {
      const [r] = await con.query('INSERT INTO webhooks (proveedor, evento, id_externo, cuerpo, firma_ok) VALUES (?, ?, ?, ?, ?)',
        [proveedor, evento ? String(evento).slice(0, 60) : null, idExterno, cifrarCuerpo(cuerpo), firmaOk]);
      const carga = telefonos.length ? { webhookId: r.insertId, telefonos } : { webhookId: r.insertId };
      await cola.encolar(con, trabajo, carga, { claveUnica: `webhook-${r.insertId}`, ejecutarEn: ahora, maxIntentos: INTENTOS[trabajo] || 5 });
      return { id: r.insertId, duplicado: false };
    });
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY' || !idExterno) throw err;
    const [[ya]] = await pool.query('SELECT id FROM webhooks WHERE proveedor = ? AND id_externo = ?', [proveedor, idExterno]);
    return { id: ya?.id || null, duplicado: true };
  }
}

// ── El paso del cron ───────────────────────────────────────────────────────────────────────

// ¿Hay un aviso anterior de alguno de sus teléfonos sin terminar (lo tiene otro cron, o espera un
// reintento)? Entonces este espera: un paciente que escribe dos mensajes seguidos recibe las
// respuestas en orden, aunque la IA tarde y el cron siguiente entre a la vez.
async function esperaAOtro(pool, trabajo) {
  const telefonos = (Array.isArray(trabajo.carga?.telefonos) ? trabajo.carga.telefonos : []).filter((t) => typeof t === 'string');
  if (!telefonos.length) return false;
  const [[otro]] = await pool.query(
    `SELECT id FROM cola WHERE tipo = ? AND id < ? AND estado IN ('pendiente','en_curso')
        AND (${telefonos.map(() => "JSON_CONTAINS(carga, JSON_QUOTE(?), '$.telefonos')").join(' OR ')}) LIMIT 1`,
    [TRABAJOS.whatsapp, trabajo.id, ...telefonos]);
  return Boolean(otro);
}

// Primero lo que ha escrito alguien y los leads; después los estados, que son rápidos y van en lotes
// más grandes. Con tiempo tasado (el candado del cron dura 55 s y la IA puede tardar): lo que no da
// tiempo a empezar queda para el cron siguiente, sin gastar intento.
async function procesarPendientes(deps, { ahora = new Date(), limite = 20, presupuestoMs = 40000 } = {}) {
  const cortarEn = Date.now() + presupuestoMs;
  const whatsapp = async (carga, { trabajo = null } = {}) => {
    if (trabajo && await esperaAOtro(deps.pool, trabajo)) return cola.aplazar({ minutos: 1 });
    return procesarWhatsApp(deps, carga.webhookId, { ahora, trabajo });
  };
  const a = await cola.procesar(deps.pool, {
    [TRABAJOS.whatsapp]: whatsapp,
    [TRABAJOS.meta]: (carga, { trabajo = null } = {}) => procesarMeta(deps, carga.webhookId, { ahora, trabajo }),
  }, { ahora, limite, cortarEn });
  const b = await cola.procesar(deps.pool, { [TRABAJOS.estados]: whatsapp }, { ahora, limite: limite * 10, cortarEn });
  return { hechos: a.hechos + b.hechos, reintentos: a.reintentos + b.reintentos, fallidos: a.fallidos + b.fallidos, aplazados: a.aplazados + b.aplazados };
}

// Carga el webhook, lo procesa una vez y apunta cuándo; si falla, apunta el error y el cron lo
// reintenta (lo ya hecho no se repite: los mensajes van por wa_id y los leads por su id de Meta).
async function conWebhook(pool, id, ahora, fn) {
  const [[w]] = await pool.query('SELECT id, cuerpo, procesado_en FROM webhooks WHERE id = ?', [id]);
  if (!w || w.procesado_en) return { omitido: true };
  try {
    const r = await fn(JSON.parse(descifrarCuerpo(w.cuerpo)));
    await pool.query('UPDATE webhooks SET procesado_en = ?, error = NULL WHERE id = ?', [ahora, id]);
    return r;
  } catch (err) {
    await pool.query('UPDATE webhooks SET error = ? WHERE id = ?', [String(err.message).slice(0, 1000), id]);
    throw err;
  }
}

// Lo que llegó para otro número u otra página: se queda guardado y marcado, sin procesar, y se apunta
// para poder verlo (quizá la variable está mal puesta).
async function marcarAjeno(pool, webhookId, { proveedor, ids, todo }) {
  if (todo) await pool.query("UPDATE webhooks SET evento = 'ajeno' WHERE id = ?", [webhookId]);
  await registrar(pool, { tipo: 'webhook_ajeno', entidad: 'webhook', entidadId: webhookId, actor: 'meta', datos: { proveedor, ids: [...new Set(ids.map(String))].slice(0, 10) } });
}

// ── WhatsApp ───────────────────────────────────────────────────────────────────────────────

async function procesarWhatsApp(deps, webhookId, { ahora = new Date(), trabajo = null } = {}) {
  try {
    return await conWebhook(deps.pool, webhookId, ahora, async (cuerpo) => {
      const datos = W.leerWebhook(cuerpo);
      const propio = (x) => esDeLaClinica(x.numeroId, 'WHATSAPP_NUMERO_ID');
      const ajenos = [...datos.mensajes, ...datos.estados].filter((x) => !propio(x));
      if (ajenos.length) {
        const todo = ajenos.length === datos.mensajes.length + datos.estados.length;
        await marcarAjeno(deps.pool, webhookId, { proveedor: 'whatsapp', ids: ajenos.map((x) => x.numeroId), todo });
      }
      const resumen = { estados: 0, mensajes: [], ajenos: ajenos.length };
      for (const e of datos.estados.filter(propio)) resumen.estados += await aplicarEstado(deps, e, { ahora });
      for (const m of datos.mensajes.filter(propio)) resumen.mensajes.push(await atenderMensaje(deps, m, { ahora }));
      return resumen;
    });
  } catch (err) {
    // El último intento: que alguien lo sepa (puede ser un paciente esperando respuesta).
    if (trabajo && trabajo.intentos >= trabajo.max_intentos) {
      await deps.pool.query("INSERT INTO tareas (tipo, titulo, vence_en) VALUES ('otro', ?, ?)",
        [`Un aviso de WhatsApp (nº ${webhookId}) no se ha podido procesar: revisar el error y la bandeja`.slice(0, 200), new Date(ahora.getTime() + DOS_HORAS)]);
    }
    throw err;
  }
}

// Lo que dice una leyenda, como si fuera un texto: reglas y, con la IA en real, también la IA (las
// reglas mandan en bajas y salud). Una complicación no siempre la cogen las reglas.
async function entender(deps, texto) {
  const reglas = interpretar(texto);
  if (deps.ia?.modo !== 'real' || ['baja', 'salud_personal'].includes(reglas.intencion)) return reglas;
  try {
    return combinar(reglas, await deps.ia.interpretar({ texto, historial: [], contexto: {} }));
  } catch {
    return reglas;
  }
}

async function atenderMensaje(deps, m, { ahora }) {
  const { pool } = deps;
  if (!m.telefono || !m.waId) {
    await registrar(pool, { tipo: 'whatsapp_sin_remitente', datos: { tipo: m.tipo } });
    return { omitido: 'sin remitente' };
  }
  const [[ya]] = await pool.query('SELECT id FROM mensajes WHERE wa_id = ?', [m.waId]);
  if (ya) return { duplicado: true };
  const recibidoEn = horaDe(m, ahora);
  if (m.tipo === 'reaccion') return registrarReaccion(pool, m, { recibidoEn });
  let comoEntender = null;
  if (m.referral) await leadDesdeAnuncio(pool, m, { ahora });
  else if (m.tipo === 'texto' && referenciaDeWhatsapp(m.texto)) comoEntender = await leadDesdeWeb(deps, m, { ahora });
  // ¿Contesta a la confirmación de una solicitud del formulario de la web («¿Has sido tú?»)?
  if (!comoEntender && m.aIa) {
    const c = await atenderConfirmacion(deps, m, { ahora, recibidoEn });
    if (c?.hecho) return c.hecho;
    if (c?.verificada) comoEntender = { intencion: 'informacion' };
  }
  const nombre = await nombreParaSaludo(pool, m);

  // Una foto o un documento con una baja o algo de salud en la leyenda va también por la repesca: la
  // baja se aplica al momento y lo de salud pasa a una persona con la urgencia que toque. Lo que ha
  // mandado lo ve siempre una persona.
  const leyenda = m.leyenda ? await entender(deps, m.leyenda) : null;
  const aLaRepesca = m.aIa || ['baja', 'salud_personal'].includes(leyenda?.intencion);
  if (!aLaRepesca) return paraPersona(deps, m, { nombre, ahora, recibidoEn });
  try {
    const r = await R.procesarEntrante(deps, { telefono: m.telefono, texto: m.texto, waId: m.waId, nombre, ahora, recibidoEn, entender: comoEntender });
    if (!r.duplicado) {
      await completarMensaje(pool, m);
      if (!m.aIa && r.conversacionId) {
        const urgente = ['audio', 'imagen', 'video'].includes(m.tipo) && await tratamientoMedicoReciente(pool, { paciente_id: null, telefono: m.telefono }, ahora);
        await tareaDelAdjunto(pool, r.conversacionId, m, { ahora, urgente });
      }
    }
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

// La conversación pasa a una persona con su tarea (una por conversación: si ya hay una abierta, esa;
// si esta es urgente, la abierta pasa a urgente).
async function aUnaPersona(q, conversacionId, { titulo, ahora, urgente = false }) {
  await q.query("UPDATE conversaciones SET estado = IF(estado = 'persona', 'persona', 'espera_persona'), proximo_paso = 'persona', urgente = urgente OR ? WHERE id = ?", [urgente, conversacionId]);
  return tareaDeConversacion(q, conversacionId, { titulo, ahora, urgente });
}

async function tareaDeConversacion(q, conversacionId, { titulo, ahora, urgente = false, tipo = 'atender_conversacion' }) {
  const vence = new Date(ahora.getTime() + (urgente ? QUINCE_MIN : DOS_HORAS));
  const [[abierta]] = await q.query("SELECT id FROM tareas WHERE conversacion_id = ? AND estado = 'abierta' LIMIT 1", [conversacionId]);
  if (abierta) {
    if (urgente) await q.query('UPDATE tareas SET urgente = TRUE, vence_en = LEAST(vence_en, ?) WHERE id = ?', [vence, abierta.id]);
    return abierta.id;
  }
  const [[c]] = await q.query('SELECT paciente_id, lead_id FROM conversaciones WHERE id = ?', [conversacionId]);
  const [r] = await q.query('INSERT INTO tareas (tipo, titulo, paciente_id, lead_id, conversacion_id, urgente, vence_en) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [tipo, titulo.slice(0, 200), c?.paciente_id || null, c?.lead_id || null, conversacionId, urgente, vence]);
  return r.insertId;
}

// Lo que mandó con una leyenda que fue por la repesca (una baja, algo de salud) también lo ve una
// persona, sin reabrir la conversación: si era una baja, queda cerrada.
async function tareaDelAdjunto(pool, conversacionId, m, { ahora, urgente = false }) {
  if (urgente) await pool.query("UPDATE conversaciones SET urgente = TRUE WHERE id = ? AND estado <> 'cerrada'", [conversacionId]);
  return tareaDeConversacion(pool, conversacionId, { titulo: m.tarea, ahora, urgente });
}

// El nombre del perfil de WhatsApp solo se usa para saludar a quien aún no conocemos: si tiene ficha
// o es un lead con nombre, manda ese.
async function nombreParaSaludo(pool, m) {
  if (!m.perfil) return null;
  const [[p]] = await pool.query('SELECT id FROM pacientes WHERE telefono = ?', [m.telefono]);
  if (p) return null;
  const [[l]] = await pool.query("SELECT id FROM leads WHERE telefono = ? AND etapa NOT IN ('perdido','vendido') AND nombre IS NOT NULL AND sin_verificar = FALSE LIMIT 1", [m.telefono]);
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
  await enlazarConversacion(pool, m.telefono, leadId, { ahora });
  return leadId;
}

// Botón de WhatsApp de la web pública: el primer mensaje trae «(ref. web-…)» y, si llegó por una
// campaña, su huella («· c-…»). Lead «web_whatsapp» con la referencia (codigo_web) y el tratamiento
// que le corresponde (semillas/iemec/referencias-web.json; en lo íntimo, la referencia es la de su
// especialidad y el texto del mensaje no nombra nada) y la conversación enlazada a él, como con los
// anuncios. Quien ya estaba en marcha no se duplica. Una referencia que no está en el archivo (una
// página que ya no existe) da igual el lead, sin tratamiento.
// Devuelve cómo se entiende ese mensaje: es una petición de información de lo que eligió en la web
// (su texto, «Hola, vengo de la web y me interesa: …», no lo dicen las reglas), sin la referencia y
// sin volver a sacar del texto lo que le interesa (la referencia es exacta). Las tarjetas regalo las
// lleva una persona (comprarla o canjearla no es una cita).
async function leadDesdeWeb(deps, m, { ahora }) {
  const { ref, campana } = referenciaDeWhatsapp(m.texto);
  const { referencias } = (deps.referenciasWeb || cargarReferencias)();
  const destino = entradaDe(referencias, ref);
  const { leadId } = await altaLead(deps.pool, {
    origen: 'web_whatsapp', telefono: m.telefono, nombre: m.perfil, codigoWeb: ref, utm: campana ? { clave_campana: campana } : null,
    campana: campana ? await campanaDeClave(deps.pool, campana) : null,
    tratamiento: { id: destino?.catalogo || null, claves: [ref], textos: [] },
  }, { inscribir: false, ahora });
  await enlazarConversacion(deps.pool, m.telefono, leadId, { ahora });
  return { texto: sinReferencia(m.texto), intencion: 'informacion', interesFijado: true, persona: tarjetaRegalo(ref, destino), leadId };
}

// De qué campaña es la huella del WhatsApp de la web («c-1x2y3z»): se busca entre las que ya conocemos
// (las de los formularios de la web y de Meta, y las claves del mapeo de campañas). Si no está, el lead
// se queda con la huella (utm.clave_campana) y el panel la enseña.
async function campanaDeClave(q, clave) {
  const [filas] = await q.query('SELECT DISTINCT campana AS nombre FROM leads WHERE campana IS NOT NULL UNION SELECT clave FROM mapeo_tratamientos');
  return filas.find((f) => huellaCampana(f.nombre) === clave)?.nombre || null;
}

// «Quiere comprar una tarjeta regalo de 45 €…»: lo que pide un botón de /tarjetas-regalo/.
function tarjetaRegalo(ref, destino) {
  if (!/^web-tarjeta-/.test(ref || '')) return null;
  if (destino?.canje || ref === 'web-tarjeta-canje') return 'Quiere canjear una tarjeta regalo (desde la web): pedirle el código y darle cita';
  if (destino?.importe) return `Quiere comprar una tarjeta regalo de ${destino.importe} € (desde la web): contarle cómo y gestionarlo`;
  return 'Quiere una tarjeta regalo (desde la web): contarle las opciones y gestionarlo';
}

// ── La respuesta a «¿Has sido tú?» (confirmación de una solicitud del formulario de la web) ──────

// El formulario de la web es anónimo: quien pide WhatsApp recibe primero uno neutro, «Hemos recibido
// una solicitud con este número. ¿Has sido tú?» (servidor/repesca/motor.js, secuencia confirmar_web).
// Lo que contesta, durante una semana y mientras no le escribamos otra cosa:
//   · «Sí, fui yo» (o «sí», «soy yo»…): su solicitud queda verificada y sigue la conversación, que le
//     cuenta lo que pidió (una petición de información de lo que eligió);
//   · «No fui yo»: se borra lo que escribió quien la envió, se le piden disculpas y no se le vuelve a
//     escribir por ella;
//   · otra cosa: se le explica una vez por qué le escribimos; una baja, algo de salud o una queja van
//     por la repesca, como siempre.
// → null (no es eso), { verificada: true } (sigue la repesca) o { hecho } (ya está contestado).
async function atenderConfirmacion(deps, m, { ahora, recibidoEn }) {
  const { pool } = deps;
  const p = await R.confirmacionPendiente(pool, m.telefono, ahora);
  if (!p) return null;
  const reglas = interpretar(m.texto);
  if (['baja', 'salud_personal', 'queja'].includes(reglas.intencion) || reglas.urgente) return null;
  const respuesta = respuestaConfirmacion(m.texto);
  if (respuesta === 'si') {
    const conv = p.conversacion.estado === 'cerrada' ? null : p.conversacion;
    await verificarSolicitudWeb(pool, { telefono: m.telefono, leadIds: p.leads, conversacionId: conv?.id || null, ahora, por: 'whatsapp' });
    return { verificada: true };
  }
  if (respuesta === 'no') {
    await rechazarSolicitudWeb(pool, { telefono: m.telefono, leadIds: p.leads, ahora });
    const texto = 'Perdona las molestias. Alguien dejó este número en nuestra web: no volveremos a escribirte por esa solicitud.';
    return { hecho: await contestarAConfirmacion(deps, m, p, { texto, ahora, recibidoEn, cerrar: true }) };
  }
  if (p.aclarada) return null;
  const texto = 'Te escribimos porque en la web de IEMEC nos han pedido información con este número de teléfono. Si fuiste tú, responde «Sí, fui yo» y te atendemos por aquí; si no, «No fui yo» y no volveremos a escribirte por ella.';
  return { hecho: await contestarAConfirmacion(deps, m, p, { texto, ahora, recibidoEn, cerrar: false }) };
}

// Guarda lo que ha escrito en la conversación de la confirmación y le contesta (sin la IA). Si ha dicho
// que no fue él, la conversación se cierra (si solo era de eso); si no, la pregunta sigue en pie una vez.
async function contestarAConfirmacion(deps, m, p, { texto, ahora, recibidoEn, cerrar }) {
  const { pool } = deps;
  const conv = await enTransaccion(pool, async (con) => {
    const [[c]] = await con.query('SELECT * FROM conversaciones WHERE id = ? FOR UPDATE', [p.conversacion.id]);
    const cf = cifrar(m.texto);
    await con.query(
      `INSERT INTO mensajes (conversacion_id, direccion, autor, tipo, cuerpo_cifrado, iv, tag, wa_id, estado, creado_en)
       VALUES (?, 'entrante', 'paciente', ?, ?, ?, ?, ?, 'recibido', ?)`, [c.id, ['boton', 'interactivo'].includes(m.tipo) ? m.tipo : 'texto', cf.cifrado, cf.iv, cf.tag, m.waId, recibidoEn]);
    await con.query("UPDATE conversaciones SET ultimo_entrante_en = ?, ventana_hasta = ?, estado = IF(estado = 'cerrada', 'esperando_paciente', estado), nombre_whatsapp = COALESCE(?, nombre_whatsapp) WHERE id = ?",
      [recibidoEn, new Date(recibidoEn.getTime() + VENTANA_MS), E.limpiarNombre(m.perfil), c.id]);
    return c;
  });
  const envio = await R.enviar(deps, conv, { texto, autor: 'ia', ahora });
  if (cerrar) {
    const soloEso = conv.contexto === 'general' && !conv.lead_id;
    if (soloEso) await pool.query("UPDATE conversaciones SET estado = 'cerrada', motivo_cierre = 'no_lo_pidio', proximo_paso = 'cerrada' WHERE id = ?", [conv.id]);
    await pool.query("UPDATE seguimientos SET estado = 'cancelado', resultado = 'no pidió la solicitud' WHERE conversacion_id = ? AND estado = 'pendiente' AND motivo = 'cierre_sin_respuesta'", [conv.id]);
  } else {
    await R.ponerPregunta(pool, conv.id, { tipo: 'confirmar_web', leads: p.leads, aclarada: true }, ahora);
  }
  await registrar(pool, { tipo: 'repesca_decision', entidad: 'conversacion', entidadId: conv.id, actor: 'ia', datos: { intencion: cerrar ? 'no_lo_pidio' : 'confirmar_solicitud_web', acciones: [], proximo: cerrar ? 'cerrada' : 'espera_respuesta' } });
  return { conversacionId: conv.id, confirmacion: cerrar ? 'no' : 'aclarada', respuesta: texto, envio };
}

// La conversación de ese teléfono queda con el lead (contexto «lead»): una abierta sin lead (o con
// uno ya cerrado) pasa a ser la de este. El orden del SET importa: contexto_id mira el contexto de
// antes.
async function enlazarConversacion(pool, telefono, leadId, { ahora }) {
  await enTransaccion(pool, async (con) => {
    const conv = await R.conversacionPara(con, { telefono, leadId, contexto: 'lead', contextoId: leadId, ahora });
    await con.query(
      `UPDATE conversaciones SET lead_id = ?, contexto_id = IF(contexto = 'general', ?, contexto_id), contexto = IF(contexto = 'general', 'lead', contexto)
        WHERE id = ? AND (lead_id IS NULL OR lead_id IN (SELECT id FROM leads WHERE etapa IN ('perdido','vendido')))`, [leadId, leadId, conv.id]);
  });
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

// ¿Ha tenido un tratamiento médico (lo hace un médico, o es un medicamento, un producto sanitario o
// cirugía) en los últimos días? Una foto o un audio suyos pueden ser una complicación.
async function tratamientoMedicoReciente(q, conv, ahora) {
  const [[r]] = await q.query(
    `SELECT EXISTS (SELECT 1 FROM citas c JOIN tratamientos t ON t.id = c.tratamiento_id
                     WHERE c.paciente_id IN (SELECT id FROM pacientes WHERE id = ? OR telefono = ?)
                       AND c.inicio BETWEEN ? AND ? AND c.estado IN ('confirmada','llegada','en_curso','completada')
                       AND (t.rol_profesional IN ('medico','cirujano','enfermeria') OR t.regimen_legal IN ('medicamento_receta','producto_sanitario','cirugia'))) AS si`,
    [conv.paciente_id, conv.telefono, new Date(ahora.getTime() - DIAS_TRATAMIENTO_RECIENTE * 86400000), ahora]);
  return Boolean(Number(r.si));
}

// Audio, imagen, vídeo, documento, ubicación, sticker…: se registra, se para su secuencia y pasa a
// una persona con tarea (urgente si es un audio, una foto o un vídeo de alguien con un tratamiento
// médico reciente). Si nadie la llevaba y es algo que espera respuesta (un audio, una foto), se le
// dice que lo ve una persona del equipo y qué hacer si es urgente.
async function paraPersona(deps, m, { nombre, ahora, recibidoEn = ahora }) {
  const { pool } = deps;
  const r = await enTransaccion(pool, async (con) => {
    const conv = await R.conversacionPara(con, { telefono: m.telefono, ahora });
    const c = cifrar(m.texto);
    try {
      await con.query(
        `INSERT INTO mensajes (conversacion_id, direccion, autor, tipo, cuerpo_cifrado, iv, tag, wa_id, estado, creado_en)
         VALUES (?, 'entrante', 'paciente', ?, ?, ?, ?, ?, 'recibido', ?)`, [conv.id, m.tipo, c.cifrado, c.iv, c.tag, m.waId, recibidoEn]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return { duplicado: true };
      throw err;
    }
    await con.query('UPDATE conversaciones SET ultimo_entrante_en = ?, ventana_hasta = ?, nombre_whatsapp = COALESCE(?, nombre_whatsapp) WHERE id = ?',
      [recibidoEn, new Date(recibidoEn.getTime() + VENTANA_MS), E.limpiarNombre(m.perfil), conv.id]);
    await con.query("UPDATE leads SET etapa = 'conversando' WHERE (id = ? OR telefono = ?) AND etapa IN ('nuevo','contactado') AND sin_verificar = FALSE", [conv.lead_id, m.telefono]);
    await con.query(
      `UPDATE inscripciones SET estado = 'pausada', motivo_fin = 'el paciente contestó' WHERE estado = 'activa'
          AND ((paciente_id IS NOT NULL AND paciente_id = ?) OR (lead_id IS NOT NULL AND lead_id = ?) OR lead_id IN (SELECT id FROM leads WHERE telefono = ?))`,
      [conv.paciente_id, conv.lead_id, m.telefono]);
    const urgente = ['audio', 'imagen', 'video'].includes(m.tipo) && await tratamientoMedicoReciente(con, conv, ahora);
    const tareaId = await aUnaPersona(con, conv.id, { titulo: urgente ? `${m.tarea} (tratamiento médico reciente: puede ser una complicación)` : m.tarea, ahora, urgente });
    await registrar(con, { tipo: 'mensaje_para_persona', entidad: 'conversacion', entidadId: conv.id, datos: { tipo: m.tipo, urgente } });
    return { conv, tareaId, urgente, yaLaLlevaba: ['persona', 'espera_persona'].includes(conv.estado) };
  });
  if (r.duplicado) return r;
  let respuesta = null;
  let envio = null;
  if (!r.yaLaLlevaba) {
    const hist = await R.historial(pool, r.conv.id);
    const [[clinica]] = await pool.query('SELECT telefono FROM clinica WHERE id = 1');
    respuesta = W.respuestaAutomatica(m.tipo, { nombre: nombre || (await nombreDeConversacion(pool, r.conv)), primerMensajeIa: !hist.some((x) => x.autor === 'ia'), telefonoClinica: clinica?.telefono });
    if (respuesta) envio = await R.enviar(deps, r.conv, { texto: respuesta, autor: 'ia', ahora });
  }
  return { conversacionId: r.conv.id, atiende: 'persona', tipo: m.tipo, tareaId: r.tareaId, urgente: r.urgente, respuesta, envio };
}

// Una reacción (👍 a un mensaje nuestro) queda en la conversación de ese mensaje, sin más.
async function registrarReaccion(pool, m, { recibidoEn }) {
  const [[deMensaje]] = m.reaccion?.a ? await pool.query('SELECT conversacion_id FROM mensajes WHERE wa_id = ?', [m.reaccion.a]) : [[null]];
  const [[ultima]] = deMensaje ? [[null]] : await pool.query('SELECT id FROM conversaciones WHERE telefono = ? ORDER BY id DESC LIMIT 1', [m.telefono]);
  const conversacionId = deMensaje?.conversacion_id || ultima?.id;
  if (!conversacionId) return { omitido: 'reacción sin conversación' };
  const c = cifrar(m.texto);
  try {
    await pool.query(
      `INSERT INTO mensajes (conversacion_id, direccion, autor, tipo, cuerpo_cifrado, iv, tag, wa_id, estado, creado_en)
       VALUES (?, 'entrante', 'paciente', 'reaccion', ?, ?, ?, ?, 'recibido', ?)`, [conversacionId, c.cifrado, c.iv, c.tag, m.waId, recibidoEn]);
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
// contestado, o no tiene el enlace de su cita. Una baja ya confirmada no hace falta repetirla. Si era
// el aviso de un hueco de la lista de espera, no se le guarda un hueco que no sabe que tiene: pasa al
// siguiente y recepción le llama (esa tarea basta).
async function trasUnFallo(pool, e, ahora) {
  const [[m]] = await pool.query(
    `SELECT m.id, m.tipo, c.id AS conversacion_id, c.telefono, c.paciente_id, c.lead_id, c.motivo_cierre
       FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id WHERE m.wa_id = ?`, [e.waId]);
  if (!m) return;
  await registrar(pool, { tipo: 'whatsapp_no_entregado', entidad: 'conversacion', entidadId: m.conversacion_id, actor: 'meta', datos: { mensaje: m.id, codigo: e.error?.codigo || null } });
  const oferta = await LE.ofertaNoEntregada(pool, { mensajeId: m.id, ahora });
  if (e.error?.codigo === '131050') return bajaDeMarketing(pool, m, e, ahora);
  if (!oferta && m.tipo !== 'plantilla' && m.motivo_cierre !== 'baja') {
    await aUnaPersona(pool, m.conversacion_id, { titulo: `No le ha llegado nuestro mensaje (${e.error?.texto || 'error de WhatsApp'}): revisarlo`, ahora });
  }
}

// 131050: el paciente ha pulsado en WhatsApp que no quiere mensajes de marketing de la clínica. Es
// una baja comercial: se apunta con su prueba (en su ficha y en la lista de bajas, sea o no paciente)
// y se cancelan sus secuencias. Si era un lead en marcha, tarea para que una persona decida si le
// llama.
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
    await apuntarBaja(con, { telefono: m.telefono, fuente: 'meta_131050', conversacionId: m.conversacion_id, leadId: m.lead_id, pacienteId: m.paciente_id, ahora });
    const [c] = await con.query(
      `UPDATE inscripciones SET estado = 'cancelada', motivo_fin = ? WHERE estado IN ('activa','pausada')
          AND ((paciente_id IS NOT NULL AND paciente_id = ?) OR (lead_id IS NOT NULL AND lead_id = ?) OR lead_id IN (SELECT id FROM leads WHERE telefono = ?))`,
      ['ha dejado de recibir marketing en WhatsApp (Meta 131050)', m.paciente_id, m.lead_id, m.telefono]);
    let tarea = false;
    if (m.lead_id) {
      const [[l]] = await con.query("SELECT id FROM leads WHERE id = ? AND etapa IN ('nuevo','contactado','conversando')", [m.lead_id]);
      const [[abierta]] = await con.query("SELECT id FROM tareas WHERE lead_id = ? AND estado = 'abierta' LIMIT 1", [m.lead_id]);
      if (l && !abierta) {
        await con.query("INSERT INTO tareas (tipo, titulo, paciente_id, lead_id, conversacion_id, vence_en) VALUES ('llamar', ?, ?, ?, ?, ?)",
          [`Ha bloqueado los mensajes de marketing en WhatsApp (${E.telefonoLegible(m.telefono)}): llamarle solo si procede`, m.paciente_id, m.lead_id, m.conversacion_id, new Date(ahora.getTime() + DOS_HORAS)]);
        tarea = true;
      }
    }
    await registrar(con, { tipo: 'baja_marketing_whatsapp', entidad: 'conversacion', entidadId: m.conversacion_id, actor: 'meta', datos: { inscripcionesCanceladas: c.affectedRows, tarea } });
  });
}

// ── Leads de los formularios de Meta ───────────────────────────────────────────────────────

// El adaptador se crea al necesitarlo: si Meta no está configurado, fallan solo estos trabajos (y el
// lead va a recepción, porque reintentar no lo arregla).
function adaptadorMeta(deps) {
  if (!deps.meta) {
    try {
      deps.meta = crearMeta(config.modos.meta);
    } catch (err) {
      err.permanente = true;
      throw err;
    }
  }
  return deps.meta;
}

async function altaDesdeMeta(deps, x, { ahora }) {
  const l = await adaptadorMeta(deps).obtenerLead(x.leadgenId);
  const f = E.datosFormulario(l.field_data);
  const formularioId = l.form_id || x.formularioId;
  const utm = Object.fromEntries(Object.entries({
    plataforma: l.platform, formulario_id: formularioId, campana_id: l.campaign_id, conjunto_id: l.adset_id || x.conjuntoId, organico: l.is_organic,
  }).filter(([, v]) => v != null && v !== ''));
  return altaLead(deps.pool, {
    origen: 'meta_formulario', idExterno: x.leadgenId, telefono: f.telefono, nombre: f.nombre, email: f.email,
    campana: l.campaign_name, conjunto: l.adset_name, anuncio: l.ad_name, anuncioId: l.ad_id || x.anuncioId,
    utm: Object.keys(utm).length ? utm : null, respuestas: f.respuestas,
    tratamiento: {
      respuesta: f.tratamiento,
      claves: [l.ad_id || x.anuncioId, l.ad_name, l.adset_id || x.conjuntoId, l.adset_name, l.campaign_id, l.campaign_name, formularioId],
      textos: [l.ad_name, l.adset_name, l.campaign_name],
    },
  }, { ahora });
}

// Un lead que Meta no deja leer (token caducado, sin acceso a clientes potenciales, MODO_META en
// simulado…) no se pierde: tarea para que recepción lo descargue en Meta Business Suite y le llame.
async function leadSinLeer(deps, x, err, { ahora }) {
  const porque = deps.meta?.modo === 'simulado' ? 'MODO_META está en «simulado»' : String(err.message).slice(0, 80);
  const donde = [x.formularioId && `formulario ${x.formularioId}`, x.anuncioId && `anuncio ${x.anuncioId}`].filter(Boolean).join(', ');
  const titulo = `Lead de Meta sin leer (${porque}): descargarlo en Meta Business Suite → Clientes potenciales y contactarle. Lead ${x.leadgenId}${donde ? `, ${donde}` : ''}`;
  return enTransaccion(deps.pool, async (con) => {
    const [r] = await con.query("INSERT INTO tareas (tipo, titulo, vence_en) VALUES ('otro', ?, ?)", [titulo.slice(0, 200), new Date(ahora.getTime() + DOS_HORAS)]);
    await registrar(con, { tipo: 'lead_meta_sin_leer', entidad: 'leadgen', entidadId: x.leadgenId, actor: 'meta', datos: {
      formulario: x.formularioId, anuncio: x.anuncioId, pagina: x.paginaId, error: String(err.message).slice(0, 300), tarea: r.insertId,
    } });
    return { leadgenId: x.leadgenId, tareaId: r.insertId, sinLeer: true };
  });
}

// Cada lead del aviso va por su lado: si uno falla, los demás entran igual. Lo que falla se reintenta
// (lo que ya entró no se vuelve a pedir); si Meta dice que no se puede leer, o es el último intento,
// va a recepción.
async function procesarMeta(deps, webhookId, { ahora = new Date(), trabajo = null } = {}) {
  const ultimo = !trabajo || trabajo.intentos >= trabajo.max_intentos;
  return conWebhook(deps.pool, webhookId, ahora, async (cuerpo) => {
    const leads = E.leerWebhookLeads(cuerpo);
    const ajenos = leads.filter((x) => !esDeLaClinica(x.paginaId, 'META_PAGINA_ID'));
    if (ajenos.length) await marcarAjeno(deps.pool, webhookId, { proveedor: 'meta', ids: ajenos.map((x) => x.paginaId), todo: ajenos.length === leads.length });
    const altas = [];
    const fallos = [];
    for (const x of leads.filter((y) => !ajenos.includes(y))) {
      const [[ya]] = await deps.pool.query("SELECT id FROM leads WHERE origen = 'meta_formulario' AND id_externo = ?", [x.leadgenId]);
      if (ya) { altas.push({ leadId: ya.id, nuevo: false, motivo: 'repetido' }); continue; }
      const [[aRecepcion]] = await deps.pool.query("SELECT id FROM eventos WHERE tipo = 'lead_meta_sin_leer' AND entidad = 'leadgen' AND entidad_id = ?", [x.leadgenId]);
      if (aRecepcion) { altas.push({ leadgenId: x.leadgenId, sinLeer: true }); continue; }
      try {
        altas.push(await altaDesdeMeta(deps, x, { ahora }));
      } catch (err) {
        if (err.permanente || ultimo) altas.push(await leadSinLeer(deps, x, err, { ahora }));
        else fallos.push(`${x.leadgenId}: ${err.message}`);
      }
    }
    if (fallos.length) throw new Error(fallos.join(' · '));
    return altas;
  });
}

// ── Limpieza ───────────────────────────────────────────────────────────────────────────────

// Los cuerpos de los webhooks (lo que escribió el paciente, su nombre, su teléfono) no hacen falta una
// vez procesados: a los 30 días se vacían (lo guardado ya está en mensajes y leads). Se quedan el
// proveedor y el identificador, que sirven para no procesar dos veces lo mismo.
async function purgarWebhooks(pool, ahora = new Date()) {
  const [r] = await pool.query("UPDATE webhooks SET cuerpo = '' WHERE recibido_en < ? AND cuerpo <> ''", [new Date(ahora.getTime() - 30 * 86400000)]);
  return r.affectedRows;
}

module.exports = {
  TRABAJOS, guardarWebhook, descifrarCuerpo, procesarPendientes, procesarWhatsApp, procesarMeta, atenderMensaje, aplicarEstado, purgarWebhooks,
};
