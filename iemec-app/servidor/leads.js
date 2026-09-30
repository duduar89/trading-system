'use strict';
// Alta de leads, vengan de donde vengan: formularios de Meta y anuncios que abren WhatsApp
// (servidor/entrada.js) y la web o GHL (POST /api/leads). Un solo camino para todos:
//   · el teléfono se guarda en formato internacional (E.164; sin prefijo, España);
//   · el tratamiento sale de lo que respondió, del mapeo de campañas y anuncios o del catálogo
//     (nombre y alias). Vale también un agrupador (Head Spa japonés, programa de acné…): no se
//     reserva, pero es lo que nombran los anuncios; la conversación le pregunta el nivel o la técnica
//     (o lo pasa a recepción). Un interés concreto no se pierde porque vuelva por el agrupador;
//   · el mismo envío otra vez (Meta o GHL reintentan) no se duplica;
//   · un lead en marcha con el mismo teléfono no se duplica ni vuelve a empezar su secuencia: se
//     apunta que ha vuelto y se guarda su interés nuevo. «En marcha» es que algo se mueve: su
//     secuencia, su conversación, un seguimiento, una tarea o su cita. Uno parado se da por perdido y
//     entra el nuevo;
//   · si ese teléfono ya tiene una conversación abierta, el lead se queda con ella: la secuencia
//     escribe ahí y, en cuanto contesta, se para;
//   · se inscribe en la secuencia «lead», que empieza en horario de envío (el paso de las 4 h cuenta
//     desde que sale la bienvenida). No se inscribe, y va a recepción con tarea, si no hay móvil
//     válido, si tiene la baja comercial (de paciente o en la lista de bajas) o si su conversación la
//     lleva una persona o va de otra cosa (un presupuesto, una cita). Si está hablando ahora con la
//     IA, se salta la bienvenida.
const E = require('../motor/entrada/leads');
const S = require('../motor/repesca/secuencias');
const { cifrar } = require('./cripto');
const { registrar } = require('./eventos');
const { tieneBaja } = require('./bajas');
const R = require('./repesca/motor');

const ORIGEN_TEXTO = { meta_formulario: 'formulario de Meta', meta_ctwa: 'anuncio de WhatsApp', web: 'web', ghl: 'GHL', web_whatsapp: 'WhatsApp de la web' };
const EN_CURSO = "('nuevo','contactado','conversando','cita')";
const DOS_HORAS = 2 * 3600000;
const cortar = (v, max = 160) => (v == null || v === '' ? null : String(v).slice(0, max));

// Lo que se reserva y los agrupadores; lo retirado del catálogo, no.
async function catalogo(q) {
  const [tratamientos] = await q.query('SELECT id, nombre, alias, activo, notas FROM tratamientos WHERE activo = TRUE OR notas LIKE ?', [`${E.NOTA_AGRUPADOR}%`]);
  const [mapeo] = await q.query('SELECT clave, tratamiento_id FROM mapeo_tratamientos');
  return { tratamientos: tratamientos.filter((t) => t.activo || E.esAgrupador(t)), mapeo };
}

// «(formulario de Meta · Otoño facial)»: de dónde viene, al final del título de la tarea (lo primero,
// quién es y cómo contactarle, que el título se corta a 200 caracteres).
function deDonde(d) {
  return `(${[ORIGEN_TEXTO[d.origen] || d.origen.replaceAll('_', ' '), d.campana || d.codigoWeb || d.anuncio].filter(Boolean).join(' · ')})`;
}

async function nuevaTarea(con, { tipo, titulo, leadId, pacienteId = null, conversacionId = null, ahora }) {
  const [r] = await con.query('INSERT INTO tareas (tipo, titulo, paciente_id, lead_id, conversacion_id, vence_en) VALUES (?, ?, ?, ?, ?, ?)',
    [tipo, titulo.slice(0, 200), pacienteId, leadId, conversacionId, new Date(ahora.getTime() + DOS_HORAS)]);
  return r.insertId;
}

// Lo que no se puede automatizar, a recepción, con lo necesario para encontrarlo y contactarle.
function tareaRecepcion(con, { motivo, leadId, pacienteId, conv, d, telefono, email, tratNombre, ahora }) {
  const quien = E.limpiarNombre(d.nombre) || 'Lead sin nombre';
  const tel = E.telefonoLegible(telefono);
  const interes = tratNombre ? ` de ${tratNombre}` : '';
  const [tipo, titulo] = {
    sin_telefono: ['otro', `${quien}: sin teléfono válido${d.telefono ? ` («${String(d.telefono).slice(0, 30)}»)` : ''}. ${email ? `Escribirle a ${email}` : 'Revisar el lead'} ${deDonde(d)}`],
    telefono_fijo: ['llamar', `Llamar a ${quien} al ${tel}: ha dejado un teléfono fijo, sin WhatsApp ${deDonde(d)}`],
    baja_comercial: ['otro', `${quien}, ${tel}, pide información${interes}, pero tiene la baja de mensajes comerciales: contactar solo si procede ${deDonde(d)}`],
    conversacion: ['atender_conversacion', `${quien} ha pedido información${interes}: contestarle en su conversación ${deDonde(d)}`],
  }[motivo];
  return nuevaTarea(con, { tipo, titulo, leadId, pacienteId: pacienteId || conv?.paciente_id || null, conversacionId: conv?.id || null, ahora });
}

// ¿Se mueve algo en este lead? Su secuencia, su conversación, un seguimiento, una tarea o su cita.
async function sigueEnMarcha(q, lead, ahora) {
  const [[r]] = await q.query(
    `SELECT EXISTS (SELECT 1 FROM inscripciones WHERE lead_id = ? AND estado = 'activa') AS secuencia,
            EXISTS (SELECT 1 FROM conversaciones WHERE lead_id = ? AND estado <> 'cerrada')
         OR EXISTS (SELECT 1 FROM seguimientos WHERE lead_id = ? AND estado = 'pendiente')
         OR EXISTS (SELECT 1 FROM citas WHERE id = ? AND inicio > ? AND estado IN ('confirmada','retenida')) AS actividad,
            EXISTS (SELECT 1 FROM tareas WHERE estado = 'abierta' AND (lead_id = ? OR conversacion_id IN (SELECT id FROM conversaciones WHERE lead_id = ?))) AS tarea`,
    [lead.id, lead.id, lead.id, lead.cita_id, ahora, lead.id, lead.id]);
  const n = (v) => Boolean(Number(v));
  return { enMarcha: n(r.secuencia) || n(r.actividad) || n(r.tarea), secuencia: n(r.secuencia), tarea: n(r.tarea) };
}

// Ya está en marcha: se completa lo que falte, se guarda su interés nuevo y se apunta que ha vuelto.
// Si su secuencia no está en marcha (le atiende una persona o la IA, o espera un seguimiento) y nadie
// tiene ya una tarea suya, tarea para que alguien le conteste.
async function yaEnMarcha(con, previo, marcha, { d, nombre, email, tratamientoId, tratNombre, telefono, ahora }) {
  let nuevoInteres = tratamientoId && tratamientoId !== previo.tratamiento_interes_id ? tratamientoId : null;
  // Ya había elegido el nivel o la técnica («el Detox») y vuelve por el agrupador (otro anuncio del
  // Head Spa): se queda lo concreto.
  if (nuevoInteres && previo.tratamiento_interes_id && await R.esOpcionDe(con, previo.tratamiento_interes_id, nuevoInteres)) nuevoInteres = null;
  await con.query(
    `UPDATE leads SET nombre = COALESCE(nombre, ?), email = COALESCE(email, ?), tratamiento_interes_id = COALESCE(?, tratamiento_interes_id),
                      ctwa_clid = COALESCE(ctwa_clid, ?) WHERE id = ?`, [nombre, email, nuevoInteres, cortar(d.ctwaClid, 255), previo.id]);
  let tareaId = null;
  if (!marcha.secuencia && !marcha.tarea && d.origen !== 'meta_ctwa') {
    const [[conv]] = await con.query("SELECT id, paciente_id FROM conversaciones WHERE lead_id = ? AND estado <> 'cerrada' ORDER BY id DESC LIMIT 1", [previo.id]);
    const interes = tratNombre ? ` de ${tratNombre}` : '';
    const contacto = telefono ? `, ${E.telefonoLegible(telefono)},` : email ? `, ${email},` : '';
    tareaId = await nuevaTarea(con, {
      tipo: conv ? 'atender_conversacion' : telefono ? 'llamar' : 'otro', leadId: previo.id, pacienteId: conv?.paciente_id || previo.paciente_id,
      conversacionId: conv?.id || null, ahora,
      titulo: `${previo.nombre || nombre || 'Lead sin nombre'}${contacto} ha vuelto a pedir información${interes}: ${conv ? 'contestarle en su conversación' : 'contactarle'} ${deDonde(d)}`,
    });
  }
  await registrar(con, { tipo: 'lead_repetido', entidad: 'lead', entidadId: previo.id, datos: {
    origen: d.origen, campana: d.campana || null, anuncio: d.anuncio || null, codigoWeb: d.codigoWeb || null,
    tratamiento: tratamientoId, tratamientoAnterior: nuevoInteres ? previo.tratamiento_interes_id : undefined, tarea: tareaId,
  } });
  return { leadId: previo.id, nuevo: false, inscrito: false, motivo: 'en_marcha', tareaId, telefono, tratamientoId: nuevoInteres || previo.tratamiento_interes_id };
}

async function alta(con, d, { trat, tratNombre }, { inscribir, ahora }) {
  const telefono = E.normalizarTelefono(d.telefono);
  const email = E.normalizarEmail(d.email);
  const nombre = E.limpiarNombre(d.nombre);
  const tratamientoId = trat?.id || null;

  // El mismo envío otra vez (Meta o GHL lo repiten si no les contestamos a tiempo).
  if (d.idExterno) {
    const [[ya]] = await con.query('SELECT id, tratamiento_interes_id FROM leads WHERE origen = ? AND id_externo = ? FOR UPDATE', [d.origen, d.idExterno]);
    if (ya) {
      await registrar(con, { tipo: 'lead_repetido', entidad: 'lead', entidadId: ya.id, datos: { origen: d.origen, idExterno: d.idExterno, repetido: true } });
      return { leadId: ya.id, nuevo: false, inscrito: false, motivo: 'repetido', telefono, tratamientoId: ya.tratamiento_interes_id };
    }
  }
  // ¿Ya hay uno en curso con ese teléfono (o, sin teléfono, con ese email)?
  const [[previo]] = telefono
    ? await con.query(`SELECT * FROM leads WHERE telefono = ? AND etapa IN ${EN_CURSO} ORDER BY id DESC LIMIT 1 FOR UPDATE`, [telefono])
    : email ? await con.query(`SELECT * FROM leads WHERE telefono IS NULL AND email = ? AND etapa IN ${EN_CURSO} ORDER BY id DESC LIMIT 1 FOR UPDATE`, [email]) : [[null]];
  if (previo) {
    const marcha = await sigueEnMarcha(con, previo, ahora);
    if (marcha.enMarcha) return yaEnMarcha(con, previo, marcha, { d, nombre, email, tratamientoId, tratNombre, telefono, ahora });
    // Parado (la secuencia acabó sin respuesta, se cerró su conversación…): se da por perdido y entra
    // el nuevo. Uno que ya tuvo su cita no se pierde: se queda como está.
    if (previo.etapa !== 'cita') await con.query("UPDATE leads SET etapa = 'perdido', motivo_perdida = 'sin_actividad' WHERE id = ?", [previo.id]);
  }

  const [[paciente]] = telefono ? await con.query('SELECT id FROM pacientes WHERE telefono = ?', [telefono]) : [[null]];
  // Lo que escribió en el formulario va cifrado, como los mensajes: puede hablar de su salud.
  const resp = d.respuestas?.length ? cifrar(JSON.stringify(d.respuestas)) : { cifrado: null, iv: null, tag: null };
  const [r] = await con.query(
    `INSERT INTO leads (paciente_id, telefono, nombre, email, origen, campana, conjunto, anuncio, anuncio_id, ctwa_clid, codigo_web, utm,
                        tratamiento_interes_id, respuestas_cifradas, respuestas_iv, respuestas_tag, id_externo, ghl_contact_id, ghl_opportunity_id, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [paciente?.id || null, telefono, nombre, email, d.origen, cortar(d.campana), cortar(d.conjunto), cortar(d.anuncio), cortar(d.anuncioId, 60),
      cortar(d.ctwaClid, 255), cortar(d.codigoWeb, 40), d.utm ? JSON.stringify(d.utm) : null, tratamientoId, resp.cifrado, resp.iv, resp.tag,
      cortar(d.idExterno, 120), cortar(d.idContacto, 60), cortar(d.idOportunidad, 60), ahora]);
  const leadId = r.insertId;

  // Su conversación abierta (si la tiene) pasa a ser la de este lead: la secuencia escribe ahí y su
  // respuesta la para. El orden del SET importa: contexto_id mira el contexto de antes.
  const [[conv]] = telefono ? await con.query("SELECT * FROM conversaciones WHERE telefono = ? AND estado <> 'cerrada' ORDER BY id DESC LIMIT 1 FOR UPDATE", [telefono]) : [[null]];
  if (conv) {
    await con.query(
      `UPDATE conversaciones SET lead_id = ?, contexto_id = IF(contexto = 'general', ?, contexto_id), contexto = IF(contexto = 'general', 'lead', contexto)
        WHERE id = ? AND (lead_id IS NULL OR lead_id IN (SELECT id FROM leads WHERE etapa IN ('perdido','vendido')))`, [leadId, leadId, conv.id]);
  }

  // Quien escribe por WhatsApp (anuncio) ya está hablando con la IA: ni secuencia ni tarea.
  let motivo = null;
  let tareaId = null;
  let inscrito = false;
  if (inscribir) {
    const conPersona = conv && ['persona', 'espera_persona'].includes(conv.estado);
    const deOtraCosa = conv && !['general', 'lead'].includes(conv.contexto);
    if (!telefono) motivo = 'sin_telefono';
    else if (E.esFijoEspanol(telefono)) motivo = 'telefono_fijo';
    else if (await tieneBaja(con, telefono)) motivo = 'baja_comercial';
    else if (conPersona || deOtraCosa) motivo = 'conversacion';
    if (motivo) tareaId = await tareaRecepcion(con, { motivo, leadId, pacienteId: paciente?.id, conv, d, telefono, email, tratNombre, ahora });
    else {
      // La secuencia empieza cuando se puede escribir (no de noche ni en festivo). Si está hablando
      // ahora con la IA (ventana de 24 h abierta), sin bienvenida: si deja de contestar, el paso de
      // las 4 h.
      const inicio = S.ajustarAHorario(ahora, await R.calendarioDesdeBd(con));
      const hablando = conv && conv.ventana_hasta && new Date(conv.ventana_hasta) > ahora;
      await R.inscribir(con, { secuencia: 'lead', leadId, inicio, desdePaso: hablando ? 1 : 0 });
      inscrito = true;
    }
  }
  await registrar(con, { tipo: 'lead_alta', entidad: 'lead', entidadId: leadId, datos: { origen: d.origen, tratamiento: tratamientoId, via: trat?.via || null, inscrito, motivo, conversacion: conv?.id || null } });
  return { leadId, nuevo: true, inscrito, motivo, tareaId, telefono, tratamientoId };
}

/**
 * Da de alta un lead (o reconoce el que ya había).
 * @param {object} d { origen, telefono (tal cual llega), nombre, email, campana, conjunto, anuncio, anuncioId,
 *                     ctwaClid, codigoWeb, utm, idExterno (el envío), idContacto, idOportunidad (GHL),
 *                     respuestas: [{ pregunta, valor }],
 *                     tratamiento: { id, respuesta, claves, textos } (ver motor/entrada/leads.js) }
 * @param {object} o { inscribir: false para quien ya está escribiendo por WhatsApp, ahora }
 * @returns {{ leadId, nuevo, inscrito, motivo, tareaId, telefono, tratamientoId }}
 */
async function altaLead(pool, d, { inscribir = true, ahora = new Date() } = {}) {
  const cat = await catalogo(pool);
  const trat = E.resolverTratamiento({ ...cat, ...(d.tratamiento || {}) });
  const nombreTrat = trat ? cat.tratamientos.find((t) => t.id === trat.id)?.nombre : null;
  const tratNombre = nombreTrat ? R.enMinuscula(nombreTrat) : null;
  // Dos altas del mismo teléfono a la vez: una espera a la otra o choca; si choca, se repite una vez
  // y entonces ya ve el lead de la otra.
  for (let intento = 1; ; intento++) {
    const con = await pool.getConnection();
    try {
      await con.beginTransaction();
      const r = await alta(con, d, { trat, tratNombre }, { inscribir, ahora });
      await con.commit();
      return r;
    } catch (err) {
      await con.rollback().catch(() => {});
      if (intento < 2 && ['ER_LOCK_DEADLOCK', 'ER_DUP_ENTRY'].includes(err.code)) continue;
      throw err;
    } finally {
      con.release();
    }
  }
}

module.exports = { altaLead };
