'use strict';
// Alta de leads, vengan de donde vengan: formularios de Meta y anuncios que abren WhatsApp
// (servidor/entrada.js), GHL o el servidor de una web (POST /api/leads, con clave) y el formulario de
// la web pública (POST /web/contacto, anónimo). Un solo camino para todos:
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
//
// El formulario de la web es distinto: nadie ha comprobado que el teléfono sea de quien lo envía (se
// puede escribir el de otra persona), así que su lead nace «sin verificar» y hasta que lo esté:
//   · no se une a nada de nadie: ni a la conversación abierta de ese teléfono, ni a su ficha de
//     paciente, ni a los datos de otro lead (su correo, su nombre o su interés no pisan nada);
//   · no le llega nada con lo que escribió quien lo envió: si pidió WhatsApp, un WhatsApp neutro de
//     confirmación («Hemos recibido una solicitud con este número. ¿Has sido tú?», secuencia
//     «confirmar_web»), sin nombre ni tratamiento; si pidió llamada o correo, una tarea para recepción
//     que dice que está sin verificar (y si el teléfono es de una paciente con otro correo, que no le
//     mande nada suyo a ese correo);
//   · su casilla comercial no cuenta (servidor/consentimiento-web.js).
// Se verifica cuando su dueño contesta «Sí, fui yo» (servidor/entrada.js) o recepción lo confirma
// (verificarSolicitudWeb); «No fui yo» lo borra (rechazarSolicitudWeb).
const E = require('../motor/entrada/leads');
const S = require('../motor/repesca/secuencias');
const { cifrar } = require('./cripto');
const { registrar } = require('./eventos');
const { tieneBaja } = require('./bajas');
const { aplicarConsentimientoWeb, consentimientoWeb } = require('./consentimiento-web');
const R = require('./repesca/motor');

const ORIGEN_TEXTO = { meta_formulario: 'formulario de Meta', meta_ctwa: 'anuncio de WhatsApp', web: 'web', ghl: 'GHL', web_whatsapp: 'WhatsApp de la web' };
const EN_CURSO = "('nuevo','contactado','conversando','cita')";
const DOS_HORAS = 2 * 3600000;
const DIA = 86400000;
// Una confirmación ya enviada a ese teléfono cuenta como «en marcha» estos días: otra solicitud no
// manda otra. Quien contestó «No fui yo» no recibe más en estos otros.
const DIAS_CONFIRMACION = 7;
const DIAS_RECHAZO = 90;
const cortar = (v, max = 160) => (v == null || v === '' ? null : String(v).slice(0, max));

// Lo que se reserva y los agrupadores; lo retirado del catálogo, no. Con su familia y subfamilia (un
// agrupador solo gana el empate con sus técnicas) y lo que dice si es íntimo o de publicidad
// restringida (eso no se le atribuye por una palabra suelta, como «láser»).
async function catalogo(q) {
  const [tratamientos] = await q.query(
    `SELECT id, nombre, alias, activo, notas, familia, subfamilia, sensible, publicidad_restringida, regimen_legal
       FROM tratamientos WHERE activo = TRUE OR notas LIKE ?`, [`${E.NOTA_AGRUPADOR}%`]);
  const [mapeo] = await q.query('SELECT clave, tratamiento_id FROM mapeo_tratamientos');
  return { tratamientos: tratamientos.filter((t) => t.activo || E.esAgrupador(t)), mapeo };
}

// «(formulario de Meta · Otoño facial)»: de dónde viene, al final del título de la tarea (lo primero,
// quién es y cómo contactarle, que el título se corta a 200 caracteres). Del formulario de la web y del
// WhatsApp de la web, ni la campaña ni la referencia: las escribe quien lo envía (texto libre que
// parecería una instrucción de la app). Están en el lead.
function deDonde(d) {
  if (d.sinVerificar) return '(formulario de la web, sin verificar)';
  const libre = d.origen === 'web_whatsapp';
  return `(${[ORIGEN_TEXTO[d.origen] || d.origen.replaceAll('_', ' '), ...(libre ? [] : [d.campana || d.codigoWeb || d.anuncio])].filter(Boolean).join(' · ')})`;
}

async function nuevaTarea(con, { tipo, titulo, leadId, pacienteId = null, conversacionId = null, ahora }) {
  const [r] = await con.query('INSERT INTO tareas (tipo, titulo, paciente_id, lead_id, conversacion_id, vence_en) VALUES (?, ?, ?, ?, ?, ?)',
    [tipo, titulo.slice(0, 200), pacienteId, leadId, conversacionId, new Date(ahora.getTime() + DOS_HORAS)]);
  return r.insertId;
}

// Una solicitud de la web sin verificar con el teléfono de alguien a quien ya conocemos: que quien la
// atienda compruebe que es la misma persona antes de hablarle de ello (y, si el correo no es el de su
// ficha, que no le mande nada suyo a ese correo). Va lo primero del título, que se corta a 200.
async function avisoSinVerificar(q, { telefono, email }) {
  if (!telefono) return '';
  const [[p]] = await q.query('SELECT email FROM pacientes WHERE telefono = ?', [telefono]);
  if (p) {
    return p.email && email && p.email.toLowerCase() !== email
      ? 'OJO, sin verificar: el teléfono es de una paciente con otro correo en su ficha; no le mandes nada suyo, llámala antes. '
      : 'Sin verificar: el teléfono es de una paciente, comprueba que es ella. ';
  }
  const [[l]] = await q.query(`SELECT id FROM leads WHERE telefono = ? AND sin_verificar = FALSE AND etapa IN ${EN_CURSO} LIMIT 1`, [telefono]);
  return l ? 'Sin verificar: ya había otra solicitud con este teléfono, comprueba que es la misma persona. ' : '';
}

// Lo que no se puede automatizar, a recepción, con lo necesario para encontrarlo y contactarle.
async function tareaRecepcion(con, { motivo, leadId, pacienteId, conv, d, telefono, email, tratNombre, ahora }) {
  const quien = E.limpiarNombre(d.nombre) || 'Lead sin nombre';
  const tel = E.telefonoLegible(telefono);
  const interes = tratNombre ? ` de ${tratNombre}` : '';
  const aviso = d.sinVerificar ? await avisoSinVerificar(con, { telefono, email }) : '';
  const [tipo, titulo] = {
    sin_telefono: ['otro', `${quien}: sin teléfono válido${d.telefono ? ` («${String(d.telefono).slice(0, 30)}»)` : ''}. ${email ? `Escribirle a ${email}` : 'Revisar el lead'} ${deDonde(d)}`],
    telefono_fijo: ['llamar', `${aviso}Llamar a ${quien} al ${tel}: ha dejado un teléfono fijo, sin WhatsApp ${deDonde(d)}`],
    baja_comercial: ['otro', `${quien}, ${tel}, pide información${interes}, pero tiene la baja de mensajes comerciales: contactar solo si procede ${deDonde(d)}`],
    conversacion: d.sinVerificar
      ? ['atender_conversacion', `En la web piden información${interes} con el teléfono de esta conversación (a nombre de ${quien}): comprobar que lo pidió antes de hablarle de ello ${deDonde(d)}`]
      : ['atender_conversacion', `${quien} ha pedido información${interes}: contestarle en su conversación ${deDonde(d)}`],
    // Formulario de la web: quien pide que le llamen o que le contesten por correo no entra en ninguna
    // secuencia de WhatsApp; le contesta una persona por el medio que ha elegido.
    web_llamada: ['llamar', `${aviso}Llamar a ${quien} al ${tel}: lo ha pedido en la web${interes} ${deDonde(d)}`],
    web_correo: ['otro', `${aviso}Escribir a ${quien} a ${email || 'su correo'}: pide información${interes} y quiere la respuesta por correo ${deDonde(d)}`],
  }[motivo];
  return nuevaTarea(con, { tipo, titulo, leadId, pacienteId: pacienteId || conv?.paciente_id || null, conversacionId: conv?.id || null, ahora });
}

// ¿Se mueve algo en este lead? Su secuencia, su conversación, un seguimiento, una tarea o su cita. Uno
// de la web sin verificar al que acabamos de mandar el WhatsApp de confirmación, también.
async function sigueEnMarcha(q, lead, ahora) {
  const [[r]] = await q.query(
    `SELECT EXISTS (SELECT 1 FROM inscripciones WHERE lead_id = ? AND estado = 'activa') AS secuencia,
            EXISTS (SELECT 1 FROM conversaciones WHERE lead_id = ? AND estado <> 'cerrada')
         OR EXISTS (SELECT 1 FROM seguimientos WHERE lead_id = ? AND estado = 'pendiente')
         OR EXISTS (SELECT 1 FROM citas WHERE id = ? AND inicio > ? AND estado IN ('confirmada','retenida')) AS actividad,
            EXISTS (SELECT 1 FROM tareas WHERE estado = 'abierta' AND (lead_id = ? OR conversacion_id IN (SELECT id FROM conversaciones WHERE lead_id = ?))) AS tarea,
            EXISTS (SELECT 1 FROM inscripciones WHERE lead_id = ? AND secuencia = 'confirmar_web' AND inicio > ?) AS confirmacion`,
    [lead.id, lead.id, lead.id, lead.cita_id, ahora, lead.id, lead.id, lead.id, new Date(ahora.getTime() - DIAS_CONFIRMACION * DIA)]);
  const n = (v) => Boolean(Number(v));
  const confirmacion = Boolean(lead.sin_verificar) && n(r.confirmacion);
  return { enMarcha: n(r.secuencia) || n(r.actividad) || n(r.tarea) || confirmacion, secuencia: n(r.secuencia), tarea: n(r.tarea), confirmacion };
}

// Ya está en marcha: se completa lo que falte, se guarda su interés nuevo y se apunta que ha vuelto.
// Si su secuencia no está en marcha (le atiende una persona o la IA, o espera un seguimiento) y nadie
// tiene ya una tarea suya, tarea para que alguien le conteste.
// Si vuelve por el formulario de la web (sin verificar), no se toca nada del lead (lo podría haber
// enviado otra persona con su teléfono): lo nuevo va en su solicitud (cifrado), en el evento y en la
// tarea. Si pide llamada o correo, su tarea sale siempre y su WhatsApp automático se para: ha pedido
// otra cosa.
async function yaEnMarcha(con, previo, marcha, { d, nombre, email, tratamientoId, tratNombre, telefono, ahora, sinAcciones = false }) {
  let nuevoInteres = tratamientoId && tratamientoId !== previo.tratamiento_interes_id ? tratamientoId : null;
  // Ya había elegido el nivel o la técnica («el Detox») y vuelve por el agrupador (otro anuncio del
  // Head Spa): se queda lo concreto.
  if (nuevoInteres && previo.tratamiento_interes_id && await R.esOpcionDe(con, previo.tratamiento_interes_id, nuevoInteres)) nuevoInteres = null;
  if (!d.sinVerificar) {
    await con.query(
      `UPDATE leads SET nombre = COALESCE(nombre, ?), email = COALESCE(email, ?), tratamiento_interes_id = COALESCE(?, tratamiento_interes_id),
                        ctwa_clid = COALESCE(ctwa_clid, ?) WHERE id = ?`, [nombre, email, nuevoInteres, cortar(d.ctwaClid, 255), previo.id]);
  }
  const [[conv]] = await con.query("SELECT id, paciente_id FROM conversaciones WHERE lead_id = ? AND estado <> 'cerrada' ORDER BY id DESC LIMIT 1", [previo.id]);
  let tareaId = null;
  let pausadas = 0;
  if (d.sinVerificar && d.tareaWeb && !sinAcciones) {
    tareaId = await tareaRecepcion(con, {
      motivo: d.tareaWeb === 'web_llamada' && !telefono ? 'sin_telefono' : d.tareaWeb, leadId: previo.id, pacienteId: previo.paciente_id, conv, d, telefono, email, tratNombre, ahora,
    });
    const [p] = await con.query(
      "UPDATE inscripciones SET estado = 'pausada', motivo_fin = ? WHERE lead_id = ? AND estado = 'activa' AND secuencia IN ('lead','confirmar_web')",
      [`pide ${d.tareaWeb === 'web_llamada' ? 'que le llamen' : 'la respuesta por correo'} en la web`, previo.id]);
    pausadas = p.affectedRows;
  } else if (!marcha.secuencia && !marcha.tarea && !marcha.confirmacion && d.origen !== 'meta_ctwa' && !sinAcciones) {
    const interes = tratNombre ? ` de ${tratNombre}` : '';
    const contacto = telefono ? `, ${E.telefonoLegible(telefono)},` : email ? `, ${email},` : '';
    const quien = previo.nombre || nombre || 'Lead sin nombre';
    tareaId = await nuevaTarea(con, {
      tipo: conv ? 'atender_conversacion' : telefono ? 'llamar' : 'otro', leadId: previo.id, pacienteId: conv?.paciente_id || previo.paciente_id,
      conversacionId: conv?.id || null, ahora,
      // Sin verificar: lo primero, que compruebe que es la misma persona (el interés, al final: el título se corta).
      titulo: d.sinVerificar
        ? `Otra solicitud de la web con el teléfono de ${quien}${telefono ? ` (${E.telefonoLegible(telefono)})` : ''}, sin verificar: comprobar que es la misma persona antes de ${conv ? 'contestarle en su conversación' : 'contactarle'} (pide información${interes})`
        : `${quien}${contacto} ha vuelto a pedir información${interes}: ${conv ? 'contestarle en su conversación' : 'contactarle'} ${deDonde(d)}`,
    });
  }
  await registrar(con, { tipo: 'lead_repetido', entidad: 'lead', entidadId: previo.id, datos: {
    origen: d.origen, campana: d.campana || null, anuncio: d.anuncio || null, codigoWeb: d.codigoWeb || null,
    tratamiento: tratamientoId, tratamientoAnterior: nuevoInteres && !d.sinVerificar ? previo.tratamiento_interes_id : undefined, tarea: tareaId,
    sinVerificar: d.sinVerificar || undefined, pausadas: pausadas || undefined,
  } });
  return {
    leadId: previo.id, nuevo: false, inscrito: false, motivo: 'en_marcha', tareaId, telefono,
    tratamientoId: d.sinVerificar ? previo.tratamiento_interes_id : nuevoInteres || previo.tratamiento_interes_id,
  };
}

// ¿Ese teléfono dijo «No fui yo» a una confirmación hace poco? Entonces no se le manda otra.
async function rechazoReciente(q, telefono, ahora) {
  const [[r]] = await q.query('SELECT 1 AS si FROM solicitudes_web WHERE telefono = ? AND rechazada_en > ? LIMIT 1', [telefono, new Date(ahora.getTime() - DIAS_RECHAZO * DIA)]);
  return Boolean(r);
}

// Lo que se hace con una solicitud nueva del formulario de la web (sin verificar).
async function accionesSinVerificar(con, { leadId, d, telefono, email, tratNombre, confirmar, ahora }) {
  if (d.tareaWeb) {
    const motivo = d.tareaWeb === 'web_llamada' && !telefono ? 'sin_telefono' : d.tareaWeb;
    return { motivo, tareaId: await tareaRecepcion(con, { motivo, leadId, pacienteId: null, conv: null, d, telefono, email, tratNombre, ahora }) };
  }
  if (!confirmar || !telefono) return { motivo: telefono ? null : 'sin_telefono', tareaId: null };
  if (E.esFijoEspanol(telefono)) {
    return { motivo: 'telefono_fijo', tareaId: await tareaRecepcion(con, { motivo: 'telefono_fijo', leadId, conv: null, d, telefono, email, tratNombre, ahora }) };
  }
  // Ese teléfono ya está hablando con nosotros: se lo pregunta una persona en su conversación (sin
  // unir la solicitud a ella).
  const [[abierta]] = await con.query("SELECT id, paciente_id FROM conversaciones WHERE telefono = ? AND estado <> 'cerrada' ORDER BY id DESC LIMIT 1", [telefono]);
  if (abierta) {
    return { motivo: 'conversacion', tareaId: await tareaRecepcion(con, { motivo: 'conversacion', leadId, pacienteId: abierta.paciente_id, conv: abierta, d, telefono, email, tratNombre, ahora }) };
  }
  if (await rechazoReciente(con, telefono, ahora)) return { motivo: 'rechazada', tareaId: null };
  // El WhatsApp de confirmación sale cuando se puede escribir (no de noche ni en festivo). Es de
  // utilidad (contesta a una solicitud), no comercial: sale también a quien tiene la baja.
  const inicio = S.ajustarAHorario(ahora, await R.calendarioDesdeBd(con));
  await R.inscribir(con, { secuencia: 'confirmar_web', leadId, inicio });
  return { motivo: null, tareaId: null, confirmacion: true };
}

async function alta(con, d, { trat, tratNombre }, { inscribir, confirmar, sinAcciones, ahora }) {
  const telefono = E.normalizarTelefono(d.telefono);
  const email = E.normalizarEmail(d.email);
  const nombre = E.limpiarNombre(d.nombre);
  const tratamientoId = trat?.id || null;
  const sinVerificar = Boolean(d.sinVerificar);

  // El mismo envío otra vez (Meta o GHL lo repiten si no les contestamos a tiempo).
  if (d.idExterno) {
    const [[ya]] = await con.query('SELECT id, tratamiento_interes_id FROM leads WHERE origen = ? AND id_externo = ? FOR UPDATE', [d.origen, d.idExterno]);
    if (ya) {
      await registrar(con, { tipo: 'lead_repetido', entidad: 'lead', entidadId: ya.id, datos: { origen: d.origen, idExterno: d.idExterno, repetido: true } });
      return { leadId: ya.id, nuevo: false, inscrito: false, motivo: 'repetido', telefono, tratamientoId: ya.tratamiento_interes_id };
    }
  }
  // ¿Ya hay uno en curso con ese teléfono (o, sin teléfono, con ese email)? Una solicitud de la web sin
  // verificar no cuenta como el lead de nadie (la pudo enviar otro con su teléfono).
  const verificados = sinVerificar ? '' : ' AND sin_verificar = FALSE';
  const [[previo]] = telefono
    ? await con.query(`SELECT * FROM leads WHERE telefono = ? AND etapa IN ${EN_CURSO}${verificados} ORDER BY id DESC LIMIT 1 FOR UPDATE`, [telefono])
    : email ? await con.query(`SELECT * FROM leads WHERE telefono IS NULL AND email = ? AND etapa IN ${EN_CURSO}${verificados} ORDER BY id DESC LIMIT 1 FOR UPDATE`, [email]) : [[null]];
  if (previo) {
    const marcha = await sigueEnMarcha(con, previo, ahora);
    if (marcha.enMarcha) return yaEnMarcha(con, previo, marcha, { d, nombre, email, tratamientoId, tratNombre, telefono, ahora, sinAcciones });
    // Parado (la secuencia acabó sin respuesta, se cerró su conversación…): se da por perdido y entra
    // el nuevo. Uno que ya tuvo su cita no se pierde: se queda como está.
    if (previo.etapa !== 'cita') await con.query("UPDATE leads SET etapa = 'perdido', motivo_perdida = 'sin_actividad' WHERE id = ?", [previo.id]);
  }

  // Su ficha de paciente, solo si el teléfono es suyo de verdad (sin verificar, al verificarlo).
  const [[paciente]] = telefono && !sinVerificar ? await con.query('SELECT id FROM pacientes WHERE telefono = ?', [telefono]) : [[null]];
  // Lo que escribió en el formulario va cifrado, como los mensajes: puede hablar de su salud.
  const resp = d.respuestas?.length ? cifrar(JSON.stringify(d.respuestas)) : { cifrado: null, iv: null, tag: null };
  const [r] = await con.query(
    `INSERT INTO leads (paciente_id, telefono, nombre, email, origen, campana, conjunto, anuncio, anuncio_id, ctwa_clid, codigo_web, utm,
                        tratamiento_interes_id, respuestas_cifradas, respuestas_iv, respuestas_tag, id_externo, ghl_contact_id, ghl_opportunity_id, sin_verificar, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [paciente?.id || null, telefono, nombre, email, d.origen, cortar(d.campana), cortar(d.conjunto), cortar(d.anuncio), cortar(d.anuncioId, 60),
      cortar(d.ctwaClid, 255), cortar(d.codigoWeb, 40), d.utm ? JSON.stringify(d.utm) : null, tratamientoId, resp.cifrado, resp.iv, resp.tag,
      cortar(d.idExterno, 120), cortar(d.idContacto, 60), cortar(d.idOportunidad, 60), sinVerificar, ahora]);
  const leadId = r.insertId;

  if (sinVerificar) {
    const hecho = sinAcciones ? { motivo: 'tope', tareaId: null } : await accionesSinVerificar(con, { leadId, d, telefono, email, tratNombre, confirmar, ahora });
    await registrar(con, { tipo: 'lead_alta', entidad: 'lead', entidadId: leadId, datos: {
      origen: d.origen, tratamiento: tratamientoId, via: trat?.via || null, inscrito: false, motivo: hecho.motivo, sinVerificar: true, confirmacion: Boolean(hecho.confirmacion),
    } });
    return { leadId, nuevo: true, inscrito: false, confirmacion: Boolean(hecho.confirmacion), motivo: hecho.motivo, tareaId: hecho.tareaId, telefono, tratamientoId };
  }

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
  } else if (d.tareaWeb) {
    motivo = d.tareaWeb === 'web_llamada' && !telefono ? 'sin_telefono' : d.tareaWeb;
    tareaId = await tareaRecepcion(con, { motivo, leadId, pacienteId: paciente?.id, conv, d, telefono, email, tratNombre, ahora });
  }
  await registrar(con, { tipo: 'lead_alta', entidad: 'lead', entidadId: leadId, datos: { origen: d.origen, tratamiento: tratamientoId, via: trat?.via || null, inscrito, motivo, conversacion: conv?.id || null } });
  return { leadId, nuevo: true, inscrito, motivo, tareaId, telefono, tratamientoId };
}

// La prueba de los consentimientos de un envío del formulario de la web (RGPD, art. 7.1): cada
// casilla por separado, con la fecha, la versión de los textos (y si es una de las publicadas) y la
// preferencia. Lo que pidió (la página, la referencia, el tratamiento, el interés, lo que escribió)
// va cifrado: puede revelar un dato de salud. Sin clave ajena: la prueba del consentimiento comercial se
// conserva, bloqueada, aunque se borre el lead (LSSI art. 45; la purga: servidor/retencion.js). Un
// reintento del mismo envío no se duplica (huella única).
async function guardarSolicitudWeb(con, { leadId, tratamientoId }, s, ahora) {
  const pedido = {
    pagina: s.pagina, ref: s.ref, tratamiento: tratamientoId || null, interes: s.interes, preferencia: s.preferencia,
    nombre: s.nombre || null, email: s.email || null, mensaje: s.mensaje || null,
  };
  const c = cifrar(JSON.stringify(pedido));
  await con.query(
    `INSERT IGNORE INTO solicitudes_web (lead_id, telefono, datos_cifrados, datos_iv, datos_tag, preferencia, consentimiento_datos,
                                          consentimiento_comercial, version_textos, version_conocida, huella_envio, enviado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [leadId, s.telefono || null, c.cifrado, c.iv, c.tag, s.preferencia, Boolean(s.datos), Boolean(s.comercial), cortar(s.version, 20),
      Boolean(s.versionConocida), s.huella, ahora]);
}

/**
 * Da de alta un lead (o reconoce el que ya había).
 * @param {object} d { origen, telefono (tal cual llega), nombre, email, campana, conjunto, anuncio, anuncioId,
 *                     ctwaClid, codigoWeb, utm, idExterno (el envío), idContacto, idOportunidad (GHL),
 *                     respuestas: [{ pregunta, valor }],
 *                     tratamiento: { id, respuesta, claves, textos } (ver motor/entrada/leads.js),
 *                     sinVerificar: true si viene del formulario anónimo de la web,
 *                     tareaWeb: 'web_llamada' | 'web_correo' (sin secuencia: le contesta una persona) }
 * @param {object} o { inscribir: false para quien ya está escribiendo por WhatsApp (o viene de la web),
 *                     confirmar: el formulario de la web pide WhatsApp (se le manda el de confirmación),
 *                     sinAcciones: pasado el tope del formulario, se guarda sin tareas ni mensajes,
 *                     ahora, solicitud: la prueba del formulario de la web }
 * @returns {{ leadId, nuevo, inscrito, confirmacion, motivo, tareaId, telefono, tratamientoId }}
 */
async function altaLead(pool, d, { inscribir = true, confirmar = false, sinAcciones = false, ahora = new Date(), solicitud = null } = {}) {
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
      const r = await alta(con, d, { trat, tratNombre }, { inscribir, confirmar, sinAcciones, ahora });
      if (solicitud) await guardarSolicitudWeb(con, r, solicitud, ahora);
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

// ── Verificar o rechazar una solicitud de la web ─────────────────────────────────────────────

// Las solicitudes de la web sin verificar de ese teléfono (o esas en concreto).
async function leadsSinVerificar(q, { telefono, leadIds = null }) {
  const [filas] = await q.query(
    `SELECT * FROM leads WHERE telefono = ? AND sin_verificar = TRUE AND etapa IN ('nuevo','contactado','conversando')${leadIds?.length ? ' AND id IN (?)' : ''} ORDER BY id`,
    leadIds?.length ? [telefono, leadIds] : [telefono]);
  return filas;
}

/**
 * Quien tiene ese teléfono confirma que pidió la información (contesta «Sí, fui yo» al WhatsApp de
 * confirmación, o recepción se lo pregunta llamándole). Sus solicitudes quedan verificadas: el lead se
 * une a su ficha (si la tiene) y a su conversación abierta, su casilla comercial cuenta (y pasa a su
 * ficha) y, si la marcó después de darse de baja, una tarea lo dice (la baja la quita dirección).
 * @returns {Promise<{ leads: number[], consentimiento: boolean }>}
 */
async function verificarSolicitudWeb(pool, { telefono, leadIds = null, conversacionId = null, ahora = new Date(), por = 'whatsapp' }) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const leads = await leadsSinVerificar(con, { telefono, leadIds });
    const ids = leads.map((l) => l.id);
    // Sus solicitudes, también las que llegaron después a un lead ya verificado (otra vez por la web).
    const todos = [...new Set([...ids, ...(leadIds || [])])];
    const [sol] = todos.length
      ? await con.query('UPDATE solicitudes_web SET verificada_en = ? WHERE lead_id IN (?) AND telefono = ? AND verificada_en IS NULL AND rechazada_en IS NULL', [ahora, todos, telefono])
      : [{ affectedRows: 0 }];
    if (!ids.length && !sol.affectedRows) { await con.commit(); return { leads: [], solicitudes: 0, consentimiento: false }; }
    const [[paciente]] = await con.query('SELECT id FROM pacientes WHERE telefono = ?', [telefono]);
    if (ids.length) await con.query('UPDATE leads SET sin_verificar = FALSE, verificado_en = ?, paciente_id = COALESCE(paciente_id, ?) WHERE id IN (?)', [ahora, paciente?.id || null, ids]);
    // Su conversación abierta (la del WhatsApp de confirmación, si no tenía otra) pasa a ser la del
    // lead más reciente, como con cualquier lead.
    const leadId = ids.at(-1) || todos.at(-1);
    if (conversacionId && ids.length) {
      await con.query(
        `UPDATE conversaciones SET lead_id = ?, contexto_id = IF(contexto = 'general', ?, contexto_id), contexto = IF(contexto = 'general', 'lead', contexto)
          WHERE id = ? AND estado <> 'cerrada' AND (lead_id IS NULL OR lead_id IN (SELECT id FROM leads WHERE etapa IN ('perdido','vendido')))`, [leadId, leadId, conversacionId]);
    }
    let consentimiento = (await consentimientoWeb(con, telefono)).otorgado;
    let trasLaBaja = false;
    if (paciente) ({ aplicado: consentimiento, trasLaBaja } = await aplicarConsentimientoWeb(con, { pacienteId: paciente.id, telefono }));
    else if (consentimiento && await tieneBaja(con, telefono)) trasLaBaja = true;
    if (trasLaBaja) {
      await nuevaTarea(con, {
        tipo: 'otro', leadId, pacienteId: paciente?.id || null, conversacionId, ahora,
        titulo: `${E.telefonoLegible(telefono)} ha marcado en la web que quiere comunicaciones comerciales después de darse de baja: si procede, quitarle de la lista de bajas (la prueba está en su solicitud)`,
      });
    }
    await registrar(con, { tipo: 'lead_verificado', entidad: 'lead', entidadId: leadId, actor: por, datos: { leads: ids, solicitudes: sol.affectedRows, consentimiento, trasLaBaja: trasLaBaja || undefined } });
    await con.commit();
    return { leads: ids, solicitudes: sol.affectedRows, consentimiento };
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
}

/**
 * Quien tiene ese teléfono dice que no la pidió («No fui yo»): lo que escribió otro con su número se
 * borra (nombre, correo, lo que pedía), sus tareas y su secuencia se cancelan y no se le manda otra
 * confirmación en 90 días. Queda la fila de cada solicitud, sin nada de lo pedido, con la fecha del
 * rechazo.
 */
async function rechazarSolicitudWeb(pool, { telefono, leadIds = null, ahora = new Date() }) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const leads = await leadsSinVerificar(con, { telefono, leadIds });
    const ids = leads.map((l) => l.id);
    if (ids.length) {
      await con.query(
        `UPDATE leads SET etapa = 'perdido', motivo_perdida = 'no_lo_pidio', nombre = NULL, email = NULL, campana = NULL, utm = NULL, codigo_web = NULL,
                          tratamiento_interes_id = NULL, respuestas_cifradas = NULL, respuestas_iv = NULL, respuestas_tag = NULL WHERE id IN (?)`, [ids]);
      await con.query("UPDATE inscripciones SET estado = 'cancelada', motivo_fin = 'no lo pidió' WHERE lead_id IN (?) AND estado IN ('activa','pausada')", [ids]);
      await con.query("UPDATE tareas SET estado = 'cancelada', resultado = 'no lo pidió quien tiene ese teléfono', hecha_en = ? WHERE lead_id IN (?) AND estado = 'abierta'", [ahora, ids]);
      await con.query(`UPDATE solicitudes_web SET rechazada_en = ?, datos_cifrados = NULL, datos_iv = NULL, datos_tag = NULL,
                               pagina = NULL, ref = NULL, tratamiento_id = NULL, interes = NULL WHERE lead_id IN (?)`, [ahora, ids]);
      await registrar(con, { tipo: 'solicitud_web_rechazada', entidad: 'lead', entidadId: ids.at(-1), actor: 'whatsapp', datos: { leads: ids } });
    }
    await con.commit();
    return { leads: ids };
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
}

module.exports = { altaLead, verificarSolicitudWeb, rechazarSolicitudWeb, leadsSinVerificar, DIAS_CONFIRMACION };
