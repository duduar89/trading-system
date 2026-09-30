'use strict';
// La repesca con la base de datos. Aquí se juntan las piezas del motor (interpretar, decidir,
// plazos, ofertas, plantillas, secuencias) con MariaDB, WhatsApp y la IA.
//
//   procesarEntrante     llega un mensaje del paciente → se para la secuencia → se entiende → se
//                        decide → se aplica (seguimiento, oferta, persona, baja…) → se contesta.
//                        Si elige uno de los huecos propuestos, se reserva y le llega su cita con el
//                        enlace para añadirla al calendario. Si quiere cambiar su cita, se le
//                        proponen huecos y se cambia sin pasar por nadie; si quiere cancelarla, se le
//                        pregunta una vez. Y contesta a la lista de espera («Sí, guárdamelo»).
//   procesarSeguimientos (cron) seguimientos vencidos → «como quedamos» → un recordatorio → cierre
//   avanzarSecuencias    (cron) pasos de las secuencias de quien no ha contestado
//   inscribir            mete a un lead, cancelación o presupuesto en su secuencia
//   sinProximoPaso       (cada mañana) conversaciones abiertas sin próximo paso
const T = require('../../motor/tiempo');
const { crearCalendario } = require('../../motor/repesca/calendario-clinica');
const { interpretar, normalizar, detectarFranja } = require('../../motor/repesca/interpretar');
const { elegirHueco } = require('../../motor/repesca/eleccion');
const { proponer } = require('../../motor/agenda/huecos');
const { decidir } = require('../../motor/repesca/decidir');
const { calcularSeguimiento } = require('../../motor/repesca/plazos');
const { comprobarOfertaPropuesta } = require('../../motor/repesca/ofertas');
const { revisar } = require('../../motor/repesca/filtro-legal');
const { elegirPlantilla, rellenar } = require('../../motor/repesca/plantillas');
const S = require('../../motor/repesca/secuencias');
const { combinar, textoSimulado } = require('../integraciones/ia');
const { cifrar, descifrar } = require('../cripto');
const { registrar } = require('../eventos');
const agenda = require('../agenda');
const LE = require('../lista-espera');
const config = require('../config');

const VENTANA_MS = 24 * 3600 * 1000;

async function calendarioDesdeBd(q) {
  const [horario] = await q.query('SELECT dia_semana, abre, cierra FROM horario_clinica');
  const [festivos] = await q.query('SELECT fecha FROM festivos');
  return crearCalendario({ horario, festivos: festivos.map((f) => (f.fecha instanceof Date ? f.fecha.toISOString().slice(0, 10) : String(f.fecha).slice(0, 10))) });
}

async function conversacionPara(con, { telefono, pacienteId = null, leadId = null, contexto = 'general', contextoId = null, ahora = new Date() }) {
  const [[abierta]] = await con.query(
    "SELECT * FROM conversaciones WHERE telefono = ? AND estado <> 'cerrada' ORDER BY id DESC LIMIT 1 FOR UPDATE", [telefono]);
  if (abierta) return abierta;
  // Si su última conversación acabó en una cita que aún no ha llegado, se sigue en esa: así el
  // «gracias», el «confirmo» o el «necesito cambiarla» quedan junto a la reserva.
  const [[conCita]] = await con.query(
    `SELECT c.* FROM conversaciones c
      WHERE c.telefono = ? AND c.estado = 'cerrada' AND c.motivo_cierre = 'cita' AND c.paciente_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM citas ci WHERE ci.paciente_id = c.paciente_id AND ci.inicio > ? AND ci.estado IN ('confirmada','retenida'))
      ORDER BY c.id DESC LIMIT 1 FOR UPDATE`, [telefono, ahora]);
  if (conCita) {
    await con.query("UPDATE conversaciones SET estado = 'esperando_paciente' WHERE id = ?", [conCita.id]);
    return { ...conCita, estado: 'esperando_paciente' };
  }
  // Se cerró con una pregunta en el aire («¿Te busco otro momento?»): si contesta en 24 h, sigue ahí.
  const [[conPregunta]] = await con.query(
    "SELECT * FROM conversaciones WHERE telefono = ? AND estado = 'cerrada' AND pregunta_pendiente IS NOT NULL ORDER BY id DESC LIMIT 1 FOR UPDATE", [telefono]);
  if (conPregunta && preguntaPendiente(conPregunta, ahora)) {
    await con.query("UPDATE conversaciones SET estado = 'esperando_paciente' WHERE id = ?", [conPregunta.id]);
    return { ...conPregunta, estado: 'esperando_paciente' };
  }
  if (!pacienteId) {
    const [[p]] = await con.query('SELECT id FROM pacientes WHERE telefono = ?', [telefono]);
    pacienteId = p?.id || null;
  }
  if (!leadId) {
    const [[l]] = await con.query("SELECT id FROM leads WHERE telefono = ? AND etapa NOT IN ('perdido','vendido') ORDER BY id DESC LIMIT 1", [telefono]);
    leadId = l?.id || null;
  }
  const [r] = await con.query('INSERT INTO conversaciones (telefono, paciente_id, lead_id, contexto, contexto_id) VALUES (?, ?, ?, ?, ?)',
    [telefono, pacienteId, leadId, contexto, contextoId]);
  const [[nueva]] = await con.query('SELECT * FROM conversaciones WHERE id = ?', [r.insertId]);
  return nueva;
}

async function guardarMensaje(con, m) {
  const c = cifrar(m.texto);
  const [r] = await con.query(
    `INSERT INTO mensajes (conversacion_id, direccion, autor, usuario_id, tipo, cuerpo_cifrado, iv, tag, plantilla_id, wa_id, estado, intencion, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.conversacionId, m.direccion, m.autor, m.usuarioId || null, m.tipo || 'texto', c.cifrado, c.iv, c.tag,
      m.plantillaId || null, m.waId || null, m.estado || (m.direccion === 'entrante' ? 'recibido' : 'pendiente'), m.intencion || null, m.creadoEn || new Date()]);
  return r.insertId;
}

async function historial(q, conversacionId, n = 10) {
  const [filas] = await q.query('SELECT autor, cuerpo_cifrado, iv, tag, creado_en FROM mensajes WHERE conversacion_id = ? ORDER BY id DESC LIMIT ?', [conversacionId, n]);
  return filas.reverse().map((f) => ({ autor: f.autor, texto: descifrar(f.cuerpo_cifrado, f.iv, f.tag), en: f.creado_en }));
}

// Todo lo que la política necesita saber de este paciente y esta conversación.
async function cargarContexto(q, conv, ahora) {
  const p = T.partesMadrid(ahora);
  const calendario = await calendarioDesdeBd(q);
  const [[paciente]] = conv.paciente_id ? await q.query('SELECT * FROM pacientes WHERE id = ?', [conv.paciente_id]) : [[null]];
  let tratamiento = null;
  let importe = null;
  if (conv.contexto === 'presupuesto' && conv.contexto_id) {
    const [[pres]] = await q.query('SELECT * FROM presupuestos WHERE id = ?', [conv.contexto_id]);
    importe = pres ? Number(pres.importe_eur) : null;
    const [[linea]] = await q.query('SELECT tratamiento_id FROM presupuesto_lineas WHERE presupuesto_id = ? AND tratamiento_id IS NOT NULL ORDER BY importe_eur DESC LIMIT 1', [conv.contexto_id]);
    if (linea) [[tratamiento]] = await q.query('SELECT * FROM tratamientos WHERE id = ?', [linea.tratamiento_id]);
  }
  if (!tratamiento && conv.lead_id) {
    const [[lead]] = await q.query('SELECT tratamiento_interes_id FROM leads WHERE id = ?', [conv.lead_id]);
    if (lead?.tratamiento_interes_id) [[tratamiento]] = await q.query('SELECT * FROM tratamientos WHERE id = ?', [lead.tratamiento_interes_id]);
  }
  if (!tratamiento && conv.paciente_id) {
    const [[c]] = await q.query('SELECT tratamiento_id FROM citas WHERE paciente_id = ? ORDER BY inicio DESC LIMIT 1', [conv.paciente_id]);
    if (c) [[tratamiento]] = await q.query('SELECT * FROM tratamientos WHERE id = ?', [c.tratamiento_id]);
  }
  if (tratamiento && importe == null && tratamiento.precio_eur != null) importe = Number(tratamiento.precio_eur);
  const [ofertasFilas] = await q.query('SELECT * FROM ofertas WHERE activa = TRUE');
  const ofertas = ofertasFilas.map((o) => ({
    id: o.id, tipo: o.tipo, nombre: o.nombre, textoPaciente: o.texto_paciente,
    familias: parseJson(o.familias), tratamientos: parseJson(o.tratamientos),
    importeMin: o.importe_min == null ? null : Number(o.importe_min), importeMax: o.importe_max == null ? null : Number(o.importe_max),
    maxPorPaciente: o.max_por_paciente, requiereAprobacion: Boolean(o.requiere_aprobacion),
    permitidaProductoSanitario: Boolean(o.permitida_producto_sanitario), prioridad: o.prioridad,
    vigenteDesde: fechaSql(o.vigente_desde), vigenteHasta: fechaSql(o.vigente_hasta), activa: true,
  }));
  const [hechasFilas] = conv.paciente_id
    ? await q.query('SELECT oferta_id, estado, creado_en FROM ofertas_hechas WHERE paciente_id = ?', [conv.paciente_id])
    : await q.query('SELECT oferta_id, estado, creado_en FROM ofertas_hechas WHERE conversacion_id = ?', [conv.id]);
  const hechas = hechasFilas.map((h) => ({ ofertaId: h.oferta_id, fecha: T.fechaMadrid(new Date(h.creado_en)), estado: h.estado }));
  let respuestas = [];
  if (tratamiento) [respuestas] = await q.query('SELECT * FROM respuestas_aprobadas WHERE aprobada = TRUE AND tratamiento_id = ?', [tratamiento.id]);
  return {
    calendario, paciente, tratamiento, importe, ofertas, hechas, respuestas,
    ctx: {
      hoy: p.fecha, ahoraMin: p.minutos, calendario,
      tratamiento: tratamiento ? { id: tratamiento.id, familia: tratamiento.familia, regimen_legal: tratamiento.regimen_legal } : { id: null, familia: null, regimen_legal: 'desconocido' },
      importe, ofertas, hechas,
      ofertasRechazadas: hechas.filter((h) => h.estado === 'rechazada').length,
      yaPreguntoCuando: Boolean(conv.ya_pregunto_cuando),
      tieneRespuestaAprobada: respuestas.length > 0,
      reservable: tratamiento ? Boolean(tratamiento.reservable_ia) : false,
      horaHabitual: paciente?.hora_habitual_respuesta ? String(paciente.hora_habitual_respuesta).slice(0, 5) : null,
    },
  };
}

function parseJson(v) {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
}
function fechaSql(v) {
  if (!v) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

async function vencimientoTarea(q, ahora, urgente) {
  if (urgente) return new Date(ahora.getTime() + 15 * 60000);
  return new Date(ahora.getTime() + 2 * 3600000);
}

// Aplica la decisión dentro de la transacción. Devuelve lo que hace falta para redactar.
async function aplicarDecision(con, conv, decision, { ahora, texto, datos }) {
  const pacienteId = conv.paciente_id;
  const salida = { seguimientoId: null, oferta: null, huecosPedidos: null };
  // Una respuesta nueva sustituye a los seguimientos pendientes de esta conversación.
  await con.query("UPDATE seguimientos SET estado = 'cancelado', resultado = 'sustituido por una respuesta nueva' WHERE conversacion_id = ? AND estado = 'pendiente'", [conv.id]);
  const cambios = { proximo_paso: decision.proximoPaso, proximo_paso_en: null };

  for (const a of decision.acciones) {
    switch (a.tipo) {
      case 'baja':
        if (conv.lead_id) await con.query("UPDATE leads SET etapa = 'perdido', motivo_perdida = 'baja' WHERE id = ? AND etapa NOT IN ('cita','asistio','vendido')", [conv.lead_id]);
        if (pacienteId) {
          await con.query("INSERT INTO consentimientos (paciente_id, tipo, estado, fuente, prueba) VALUES (?, 'whatsapp_marketing', 'revocado', 'whatsapp', ?)", [pacienteId, texto.slice(0, 500)]);
          await con.query('UPDATE pacientes SET baja_comercial_en = ? WHERE id = ?', [ahora, pacienteId]);
          // Fuera también de la lista de espera (y el hueco que se le guardaba, libre para otro).
          await LE.quitarPorBaja(con, pacienteId, ahora);
        }
        // Ojo con los nulos: «paciente_id <=> NULL» casaría con todos los contactos sin ficha.
        await con.query("UPDATE inscripciones SET estado = 'cancelada', motivo_fin = 'baja' WHERE estado IN ('activa','pausada') AND ((paciente_id IS NOT NULL AND paciente_id = ?) OR (lead_id IS NOT NULL AND lead_id = ?))", [pacienteId, conv.lead_id]);
        await con.query("UPDATE seguimientos SET estado = 'cancelado', resultado = 'baja' WHERE estado = 'pendiente' AND ((paciente_id IS NOT NULL AND paciente_id = ?) OR conversacion_id = ?)", [pacienteId, conv.id]);
        Object.assign(cambios, { estado: 'cerrada', motivo_cierre: 'baja' });
        break;
      case 'pasar_a_persona':
        await con.query('INSERT INTO tareas (tipo, titulo, paciente_id, conversacion_id, urgente, vence_en) VALUES (?, ?, ?, ?, ?, ?)',
          ['atender_conversacion', a.motivo, pacienteId, conv.id, Boolean(a.urgente), await vencimientoTarea(con, ahora, a.urgente)]);
        Object.assign(cambios, { estado: 'espera_persona', urgente: Boolean(a.urgente) });
        break;
      case 'tarea_llamar':
        await con.query('INSERT INTO tareas (tipo, titulo, paciente_id, conversacion_id, vence_en) VALUES (?, ?, ?, ?, ?)',
          ['llamar', a.motivo, pacienteId, conv.id, await vencimientoTarea(con, ahora, false)]);
        break;
      case 'programar_seguimiento': {
        const cuando = T.desdeMadrid(a.fecha, a.hora);
        const f = cifrar(texto);
        const [r] = await con.query(
          `INSERT INTO seguimientos (paciente_id, lead_id, conversacion_id, contexto, contexto_id, motivo, plazo_tipo, frase_cifrada, frase_iv, frase_tag, programado_para, creado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ia')`,
          [pacienteId, conv.lead_id, conv.id, conv.contexto, conv.contexto_id, a.motivo, a.plazo, f.cifrado, f.iv, f.tag, cuando]);
        salida.seguimientoId = r.insertId;
        cambios.proximo_paso_en = cuando;
        break;
      }
      case 'ofrecer': {
        const check = comprobarOfertaPropuesta(a.ofertaId, { tratamiento: datos.ctx.tratamiento, ofertas: datos.ctx.ofertas, hechas: datos.ctx.hechas, importe: datos.ctx.importe, hoy: datos.ctx.hoy });
        if (!check.ok) throw new Error(`Oferta no permitida: ${check.motivo}`);
        await con.query('INSERT INTO ofertas_hechas (oferta_id, paciente_id, lead_id, conversacion_id, presupuesto_id, estado) VALUES (?, ?, ?, ?, ?, ?)',
          [a.ofertaId, pacienteId, conv.lead_id, conv.id, conv.contexto === 'presupuesto' ? conv.contexto_id : null, a.requiereAprobacion ? 'pendiente_aprobacion' : 'propuesta']);
        if (a.requiereAprobacion) {
          await con.query("INSERT INTO tareas (tipo, titulo, paciente_id, conversacion_id, vence_en) VALUES ('aprobar_oferta', ?, ?, ?, ?)",
            [`Aprobar oferta: ${check.oferta.nombre}`, pacienteId, conv.id, await vencimientoTarea(con, ahora, false)]);
        }
        salida.oferta = check.oferta;
        break;
      }
      case 'cerrar':
        if (conv.lead_id) await con.query("UPDATE leads SET etapa = 'perdido', motivo_perdida = ? WHERE id = ? AND etapa NOT IN ('cita','asistio','vendido')", [a.motivo, conv.lead_id]);
        await con.query("UPDATE seguimientos SET estado = 'cancelado', resultado = ? WHERE estado = 'pendiente' AND conversacion_id = ?", [`cerrada: ${a.motivo}`, conv.id]);
        await con.query("UPDATE ofertas_hechas SET estado = 'rechazada' WHERE conversacion_id = ? AND estado = 'propuesta'", [conv.id]);
        Object.assign(cambios, { estado: 'cerrada', motivo_cierre: a.motivo });
        break;
      case 'preguntar_cuando':
        cambios.ya_pregunto_cuando = true;
        break;
      case 'proponer_huecos':
        salida.huecosPedidos = a;
        break;
      case 'cita_reservada': {
        // Lo que se le ofreció en esta conversación queda aceptado; si venía de un presupuesto, también.
        await con.query("UPDATE ofertas_hechas SET estado = 'aceptada' WHERE conversacion_id = ? AND estado = 'propuesta'", [conv.id]);
        if (conv.contexto === 'presupuesto' && conv.contexto_id) {
          await con.query("UPDATE presupuestos SET estado = 'aceptado', aceptado_en = ? WHERE id = ? AND estado = 'entregado'", [ahora, conv.contexto_id]);
        }
        const [[ci]] = await con.query('SELECT inicio FROM citas WHERE id = ?', [a.citaId]);
        Object.assign(cambios, { estado: 'cerrada', motivo_cierre: 'cita', proximo_paso_en: ci?.inicio || null, huecos_ofrecidos: null, huecos_ofrecidos_en: null, reprograma_cita_id: null, pregunta_pendiente: null });
        break;
      }
      default:
        break;
    }
  }
  if (!cambios.estado) cambios.estado = decision.proximoPaso === 'persona' ? 'espera_persona' : 'esperando_paciente';
  await con.query('UPDATE conversaciones SET ? WHERE id = ?', [cambios, conv.id]);
  await registrar(con, { tipo: 'repesca_decision', entidad: 'conversacion', entidadId: conv.id, actor: 'ia', datos: { intencion: decision.intencion, acciones: decision.acciones.map((x) => ({ ...x, frase: undefined })), proximo: decision.proximoPaso } });
  return salida;
}

async function huecosParaProponer(pool, pedido, tratamiento, ahora) {
  // Los tratamientos que necesitan valoración previa (reservable_ia = 0) los agenda una persona.
  if (!pedido || !tratamiento || !tratamiento.reservable_ia) return [];
  const lista = await agenda.proximosHuecos(pool, { tratamientoId: tratamiento.id, desdeFecha: pedido.desdeFecha, dias: 10, n: 3, preferencia: pedido.franja, ahora });
  return lista.map((h) => ({ fecha: h.fecha, hora: h.hora, texto: `${textoDia(h.fecha)} a las ${h.hora}` }));
}

// Lo que se le ofrece queda guardado en la conversación: si contesta «el martes a las 11», se sabe
// de qué huecos hablaba.
async function guardarHuecos(q, conversacionId, huecos, tratamientoId, ahora) {
  await q.query('UPDATE conversaciones SET huecos_ofrecidos = ?, huecos_tratamiento_id = ?, huecos_ofrecidos_en = ? WHERE id = ?',
    [JSON.stringify(huecos.map((h) => ({ fecha: h.fecha, hora: h.hora }))), tratamientoId, ahora, conversacionId]);
}

// Los huecos que se le ofrecieron, en el mismo orden (para que «la primera» sea la primera que
// leyó). Si ya han pasado todos, no hay propuesta en marcha.
function huecosOfrecidos(conv, ahora) {
  const lista = parseJson(conv.huecos_ofrecidos);
  if (!Array.isArray(lista) || !lista.some((h) => T.desdeMadrid(h.fecha, h.hora) > ahora)) return [];
  return lista;
}

// «el martes 6 de octubre a las 11:00 o a las 17:30, o el miércoles 7 de octubre a las 12:00»
function textoHuecos(huecos) {
  const porDia = new Map();
  for (const h of huecos) (porDia.get(h.fecha) || porDia.set(h.fecha, []).get(h.fecha)).push(h.hora);
  const alas = (horas) => (horas.length > 2
    ? `a las ${horas.slice(0, -1).join(', a las ')} o a las ${horas.at(-1)}`
    : `a las ${horas.join(' o a las ')}`);
  const partes = [...porDia.entries()].map(([f, horas]) => `${textoDia(f)} ${alas(horas)}`);
  return partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')}, o ${partes.at(-1)}`;
}

function textoDia(fecha) {
  const { DIAS, MESES } = require('../../motor/repesca/plazos');
  return `el ${DIAS[T.diaSemana(fecha)]} ${Number(fecha.slice(8, 10))} de ${MESES[Number(fecha.slice(5, 7))]}`;
}

/**
 * Llega un mensaje del paciente por WhatsApp.
 * deps: { pool, ia, whatsapp }
 */
async function procesarEntrante(deps, { telefono, texto, waId = null, ahora = new Date(), nombre = null }) {
  const { pool, ia } = deps;
  const con = await pool.getConnection();
  let conv;
  let mensajeId;
  try {
    await con.beginTransaction();
    conv = await conversacionPara(con, { telefono, ahora });
    if (waId) {
      const [[ya]] = await con.query('SELECT id FROM mensajes WHERE wa_id = ?', [waId]);
      if (ya) { await con.commit(); return { duplicado: true }; }
    }
    const reglasPrevias = interpretar(texto);
    mensajeId = await guardarMensaje(con, { conversacionId: conv.id, direccion: 'entrante', autor: 'paciente', texto, waId, intencion: reglasPrevias.intencion, creadoEn: ahora });
    await con.query('UPDATE conversaciones SET ultimo_entrante_en = ?, ventana_hasta = ? WHERE id = ?', [ahora, new Date(ahora.getTime() + VENTANA_MS), conv.id]);
    if (conv.lead_id) await con.query("UPDATE leads SET etapa = 'conversando' WHERE id = ? AND etapa IN ('nuevo','contactado')", [conv.lead_id]);
    // Lo que dice el paciente manda: se pausan sus secuencias.
    await con.query("UPDATE inscripciones SET estado = 'pausada', motivo_fin = 'el paciente contestó' WHERE estado = 'activa' AND ((paciente_id IS NOT NULL AND paciente_id = ?) OR (lead_id IS NOT NULL AND lead_id = ?))",
      [conv.paciente_id, conv.lead_id]);
    await con.commit();
  } catch (err) {
    await con.rollback().catch(() => {});
    con.release();
    throw err;
  }
  con.release();

  // Una persona lleva la conversación: la IA no contesta (la bajas y la salud, sí se registran).
  if (['persona', 'espera_persona'].includes(conv.estado)) {
    const r = interpretar(texto);
    if (r.intencion === 'baja' || r.urgente) {
      // Se aplica igual: una baja o una urgencia no esperan a nadie.
    } else {
      return { conversacionId: conv.id, atiende: 'persona' };
    }
  }

  const datos = await cargarContexto(pool, conv, ahora);
  const hist = await historial(pool, conv.id);
  const reglas = interpretar(texto);
  const primerMensajeIa = !hist.some((m) => m.autor === 'ia');
  const hola = primerMensajeIa ? 'Soy el asistente virtual de IEMEC. ' : '';
  const nombrePila = nombre || datos.paciente?.nombre || (await nombreDelLead(pool, conv)) || null;

  if (!['baja', 'salud_personal', 'queja'].includes(reglas.intencion)) {
    const r = await sinRepesca(deps, conv, { texto, ahora, datos, hist, reglas, nombre: nombrePila, hola, mensajeId });
    if (r) return r;
  }

  let desdeIa;
  try {
    desdeIa = ia.modo === 'real' ? await ia.interpretar({ texto, historial: hist, contexto: { tipo: conv.contexto, tratamiento: datos.tratamiento?.nombre } }) : null;
  } catch { desdeIa = null; }
  const interp = ia.modo === 'real' ? combinar(reglas, desdeIa) : reglas;
  const decision = decidir(interp, { ...datos.ctx, frase: texto });

  const con2 = await pool.getConnection();
  let aplicado;
  try {
    await con2.beginTransaction();
    const [[fresca]] = await con2.query('SELECT * FROM conversaciones WHERE id = ? FOR UPDATE', [conv.id]);
    aplicado = await aplicarDecision(con2, fresca, decision, { ahora, texto, datos });
    await con2.commit();
  } catch (err) {
    await con2.rollback().catch(() => {});
    throw err;
  } finally {
    con2.release();
  }

  const huecos = await huecosParaProponer(pool, aplicado.huecosPedidos, datos.tratamiento, ahora);
  if (huecos.length) await guardarHuecos(pool, conv.id, huecos, datos.tratamiento.id, ahora);
  else if (aplicado.huecosPedidos && !aplicado.huecosPedidos.opcional) {
    // Quería cita y la IA no puede ofrecer huecos: que no se quede esperando a nadie.
    await pool.query("INSERT INTO tareas (tipo, titulo, paciente_id, conversacion_id, vence_en) VALUES ('atender_conversacion', ?, ?, ?, ?)",
      ['Quiere cita: proponerle huecos a mano', conv.paciente_id, conv.id, new Date(ahora.getTime() + 2 * 3600000)]);
  }
  const datosRedaccion = {
    nombre: nombrePila, huecos, huecosTexto: textoHuecos(huecos), primerMensajeIa,
    ofertaTexto: aplicado.oferta?.textoPaciente || null,
    respuestaAprobada: datos.respuestas[0]?.respuesta || null,
    fecha: decision.acciones.find((x) => x.tipo === 'programar_seguimiento')?.texto || null,
  };
  let respuesta;
  try { respuesta = ia.modo === 'real' ? await ia.redactar({ decision, datos: datosRedaccion, historial: hist }) : null; } catch { respuesta = null; }
  if (!respuesta || !revisar(respuesta, { tipo: 'conversacion' }).ok) respuesta = textoSimulado(decision, datosRedaccion);

  const envio = await enviar(deps, conv, { texto: respuesta, autor: 'ia', ahora });
  return { conversacionId: conv.id, interpretacion: interp, decision, respuesta, huecos, envio, seguimientoId: aplicado.seguimientoId };
}

// Lo que se resuelve sin la repesca: la oferta de la lista de espera, lo que le preguntamos, su cita
// pendiente (cambiarla, cancelarla) y elegir hueco. null si no es nada de eso: sigue la repesca.
async function sinRepesca(deps, conv, { texto, ahora, datos, hist, reglas, nombre, hola, mensajeId }) {
  const { pool } = deps;
  const t = normalizar(texto);
  const marcar = (intencion) => pool.query('UPDATE mensajes SET intencion = ? WHERE id = ?', [intencion, mensajeId]);
  const ofrecidos = huecosOfrecidos(conv, ahora);
  const comun = { texto, ahora, datos, hist, reglas, nombre, hola };
  // Lo que le preguntamos se contesta una vez: después, la pregunta ya no está en el aire.
  const pregunta = preguntaPendiente(conv, ahora);
  if (conv.pregunta_pendiente) await pool.query('UPDATE conversaciones SET pregunta_pendiente = NULL WHERE id = ?', [conv.id]);

  // 1. Se le está guardando un hueco de la lista de espera: «Sí, guárdamelo» o «No me viene bien».
  const oferta = conv.paciente_id ? await LE.ofertaParaResponder(pool, conv.paciente_id, ahora) : null;
  if (oferta) {
    const r = await atenderOfertaEspera(deps, conv, oferta, comun);
    if (r) { await marcar('lista_espera'); return r; }
  }
  // 2. Contesta a algo que le preguntamos: «¿Cancelo tu cita?», «¿Te busco otro momento?», «¿Te aviso…?».
  if (pregunta) {
    const r = await atenderPregunta(deps, conv, pregunta, { ...comun, ofrecidos });
    if (r) { await marcar(pregunta.tipo === 'avisar_hueco' ? 'lista_espera' : 'cita'); return r; }
  }
  // 3. Tiene una cita pendiente y escribe sobre ella («gracias», «confirmo», «necesito cambiarla», «cancélala»).
  if (!ofrecidos.length && conv.paciente_id) {
    const r = await atenderSobreCita(deps, conv, comun);
    if (r) { await marcar('cita'); return r; }
  }
  // 4. Está cambiando su cita y dice que al final la deja, o que mejor la cancela.
  const reprograma = ofrecidos.length && conv.reprograma_cita_id ? await citaEnPie(pool, conv.reprograma_cita_id, ahora) : null;
  if (reprograma && (MANTENER.test(t) || (CANCELAR.test(t) && !CAMBIO.test(t) && !NO_CANCELAR.test(t)))) {
    await marcar('cita');
    return MANTENER.test(t) ? dejarComoEsta(deps, conv, reprograma, comun) : preguntarCancelar(deps, conv, reprograma, comun);
  }
  // 5. «¿No hay nada antes?»: se le ofrece la lista de espera.
  if (ofrecidos.length && !reprograma && conv.huecos_tratamiento_id && ANTES.test(t)) {
    await marcar('lista_espera');
    return avisarSiHayAntes(deps, conv, ofrecidos, comun);
  }
  // 6. ¿Está eligiendo uno de los huecos propuestos (o pidiendo un día y una hora concretos)?
  const tratamiento = conv.huecos_tratamiento_id ? { id: conv.huecos_tratamiento_id, reservable_ia: 1 } : datos.tratamiento;
  if (tratamiento?.reservable_ia && PUEDE_ELEGIR.has(reglas.intencion) && (ofrecidos.length || ['reservar', 'preferencia_horario'].includes(reglas.intencion))) {
    const e = elegirHueco(texto, ofrecidos, { hoy: T.fechaMadrid(ahora) });
    // «el 15 de noviembre» sin hora puede ser «escríbeme entonces»: eso lo lleva la repesca normal
    // (salvo si está cambiando su cita: entonces es el día que quiere).
    if (e && !(reglas.intencion === 'aplazar' && e.tipo === 'pide' && !e.hora && !reprograma)) {
      await marcar('eleccion_hueco');
      return atenderEleccion(deps, conv, e, { ahora, texto, datos, nombre, hola, tratamientoId: tratamiento.id, ofrecidos, reprograma });
    }
  }
  // 7. Cambiando su cita y no se entiende lo que dice: a una persona, como antes.
  if (reprograma) {
    await marcar('cita');
    return cambioAPersona(deps, conv, reprograma, { ...comun, porque: 'no_entendido' });
  }
  return null;
}

// ── El paciente elige hueco: se reserva y le llega su cita ──────────────────────────────────

// Intenciones con las que puede estar eligiendo. Con las demás (precio, «me lo pienso», salud…)
// sigue la repesca normal aunque nombre un día.
const PUEDE_ELEGIR = new Set(['reservar', 'acepta', 'aplazar', 'preferencia_horario', 'pregunta', 'otro']);

async function nombreDelLead(q, conv) {
  if (!conv.lead_id) return null;
  const [[l]] = await q.query('SELECT nombre FROM leads WHERE id = ?', [conv.lead_id]);
  return l?.nombre ? l.nombre.trim().split(/\s+/)[0] : null;
}

// Un lead que reserva pasa a tener ficha de paciente (la cita la necesita).
async function asegurarPaciente(q, conv, { nombre }) {
  if (conv.paciente_id) return conv.paciente_id;
  const [[lead]] = conv.lead_id ? await q.query('SELECT nombre, email, origen FROM leads WHERE id = ?', [conv.lead_id]) : [[null]];
  const [pila, ...resto] = String(lead?.nombre || nombre || 'Paciente').trim().split(/\s+/);
  const [r] = await q.query(
    'INSERT INTO pacientes (nombre, apellidos, telefono, email, origen) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)',
    [pila.slice(0, 80), resto.join(' ').slice(0, 120) || null, conv.telefono, lead?.email || null, lead?.origen || 'whatsapp']);
  await q.query('UPDATE conversaciones SET paciente_id = ? WHERE id = ?', [r.insertId, conv.id]);
  if (conv.lead_id) await q.query('UPDATE leads SET paciente_id = ? WHERE id = ? AND paciente_id IS NULL', [r.insertId, conv.lead_id]);
  conv.paciente_id = r.insertId;
  return r.insertId;
}

const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const ventanaDe = (hora) => ({ desde: T.minutosDe(hora) - 60, hasta: T.minutosDe(hora) + 61 });

async function datosCita(q, citaId) {
  const [[c]] = await q.query(
    `SELECT c.id, c.inicio, c.token, c.estado, c.retenida_hasta, c.origen, c.tratamiento_id, t.nombre AS tratamiento, t.reservable_ia,
            cl.direccion, cl.municipio, cl.nombre_corto
       FROM citas c JOIN tratamientos t ON t.id = c.tratamiento_id LEFT JOIN clinica cl ON cl.id = 1 WHERE c.id = ?`, [citaId]);
  if (!c) return null;
  const inicio = new Date(c.inicio);
  return { ...c, fecha: T.fechaMadrid(inicio), hora: T.hhmm(T.minutosMadrid(inicio)), url: `${config.urlPublica}/c/${c.token}`,
    donde: [c.direccion, c.municipio].filter(Boolean).join(', '), marca: c.nombre_corto || 'IEMEC' };
}

// La cita, si todavía vale (confirmada o retenida a tiempo, y sin empezar).
async function citaEnPie(q, citaId, ahora) {
  const c = citaId ? await datosCita(q, citaId) : null;
  return agenda.sigueEnPie(c, ahora) ? c : null;
}

// antes: la cita que esta sustituye (se le dice que queda anulada).
function textoCitaReservada(c, { nombre, hola = '', antes = null }) {
  return `${hola}¡Hecho${nombre ? `, ${nombre}` : ''}! ${antes ? 'Te he cambiado la cita: te' : 'Te'} esperamos ${textoDia(c.fecha)} a las ${c.hora} en ${c.marca}`
    + `${c.donde ? ` (${c.donde})` : ''} para: ${c.tratamiento}.`
    + `${antes ? ` La del ${textoDia(antes.fecha).slice(3)} a las ${antes.hora} queda anulada.` : ''}\n\n`
    + `Aquí tienes tu cita para añadirla a tu calendario, y cambiarla o cancelarla si lo necesitas: ${c.url}`;
}

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

// reprograma: la cita que está cambiando (queda «reprogramada» y su .ics, anulado).
async function reservarElegido(deps, conv, { fecha, hora, tratamientoId }, { ahora, nombre, datos, frase, hola, reprograma = null }) {
  const { pool } = deps;
  const pacienteId = await asegurarPaciente(pool, conv, { nombre });
  const [[pac]] = await pool.query('SELECT nombre, es_cliente FROM pacientes WHERE id = ?', [pacienteId]);
  let cita;
  try {
    cita = await agenda.reservar(pool, {
      pacienteId, tratamientoId, fecha, hora, origen: 'ia_whatsapp', actor: 'ia', leadId: conv.lead_id,
      conversacionId: conv.id, primeraVisita: !pac?.es_cliente, antelacionMin: 60, reprograma: reprograma?.id || null, ahora,
    });
  } catch (err) {
    if (err.codigo === 'HUECO_OCUPADO') return { ocupado: true };
    throw err;
  }
  const decision = { intencion: 'eleccion_hueco', acciones: [{ tipo: 'cita_reservada', citaId: cita.id, reprograma: cita.reprograma }], proximoPaso: 'cita' };
  await enTransaccion(pool, async (con) => {
    const [[fresca]] = await con.query('SELECT * FROM conversaciones WHERE id = ? FOR UPDATE', [conv.id]);
    await aplicarDecision(con, fresca, decision, { ahora, texto: frase, datos });
  });
  const respuesta = textoCitaReservada(await datosCita(pool, cita.id), { nombre: nombre || pac?.nombre, hola, antes: cita.reprograma ? reprograma : null });
  const envio = await enviar(deps, conv, { texto: respuesta, autor: 'ia', ahora });
  if (envio.estado === 'enviado') await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id = ?', [ahora, cita.id]);
  return { conversacionId: conv.id, eleccion: 'reservada', cita, decision, respuesta, envio };
}

// Le ofrece unos huecos y queda esperando su respuesta (con un seguimiento por si no contesta).
// Sin huecos para lo que pide, se le pregunta si quiere que le avisemos cuando se libere uno (lista
// de espera; si dice que no, una persona le propone alternativas). Si estaba cambiando su cita y no
// hay huecos, se lo pasa a una persona. pedido: { desde, franja } de lo que pidió, para la lista.
async function ofrecerYEsperar(deps, conv, { huecos, texto, ahora, datos, frase, tratamientoId, nombre, hola, reprograma = null, pedido = {} }) {
  const { pool } = deps;
  if (!huecos.length && reprograma) return cambioAPersona(deps, conv, reprograma, { ahora, nombre, hola, porque: 'sin_huecos' });
  const decision = decidir({ intencion: 'preferencia_horario' }, { ...datos.ctx, frase });
  decision.intencion = 'eleccion_hueco';
  const respuesta = huecos.length ? texto : `${hola}Ahora mismo no me queda ningún hueco libre para eso${nombre ? `, ${nombre}` : ''}. ¿Quieres que te avise si se libera uno?`;
  await enTransaccion(pool, async (con) => {
    const [[fresca]] = await con.query('SELECT * FROM conversaciones WHERE id = ? FOR UPDATE', [conv.id]);
    await aplicarDecision(con, fresca, decision, { ahora, texto: frase, datos });
    if (huecos.length) {
      await guardarHuecos(con, conv.id, huecos, tratamientoId, ahora);
    } else {
      await con.query('UPDATE conversaciones SET huecos_ofrecidos = NULL, huecos_ofrecidos_en = NULL WHERE id = ?', [conv.id]);
      await ponerPregunta(con, conv.id, { tipo: 'avisar_hueco', tratamientoId, desde: pedido.desde || T.fechaMadrid(ahora), hasta: null, franja: pedido.franja || null }, ahora);
    }
  });
  const envio = await enviar(deps, conv, { texto: respuesta, autor: 'ia', ahora });
  return { conversacionId: conv.id, eleccion: huecos.length ? 'propuesta' : 'sin_huecos', decision, respuesta, huecos, envio };
}

// Los próximos huecos para proponer. Si está cambiando su cita, la suya no cuenta como ocupada (se
// puede mover a un hueco que la pise), pero su misma hora no se le ofrece.
async function proximos(pool, { tratamientoId, desdeFecha, dias = 21, n = 3, preferencia = null, ahora, reprograma = null }) {
  const lista = await agenda.proximosHuecos(pool, { tratamientoId, desdeFecha, dias, n: n + (reprograma ? 1 : 0), preferencia, ahora, ignorarCitaId: reprograma?.id });
  return lista.map((h) => ({ fecha: h.fecha, hora: h.hora }))
    .filter((h) => !(reprograma && h.fecha === reprograma.fecha && h.hora === reprograma.hora))
    .slice(0, n);
}

function evitando(lista, evitar) {
  if (!evitar) return lista;
  return lista.filter((h) => !((evitar.fecha && h.fecha === evitar.fecha)
    || (evitar.diaSemana && T.diaSemana(h.fecha) === evitar.diaSemana)
    || (evitar.diaMes && Number(h.fecha.slice(8, 10)) === evitar.diaMes)));
}

// reprograma: la cita que está cambiando (sus huecos se buscan como si la suya no estuviera y, al
// elegir, la antigua queda «reprogramada»).
async function atenderEleccion(deps, conv, e, { ahora, texto, datos, nombre, hola, tratamientoId, ofrecidos, reprograma = null }) {
  const { pool } = deps;
  const hoy = T.fechaMadrid(ahora);
  const n = nombre ? `, ${nombre}` : '';
  const comun = { ahora, datos, frase: texto, tratamientoId, nombre, hola, reprograma };
  const siguientes = (desdeFecha, preferencia, cuantos = 3) => proximos(pool, { tratamientoId, desdeFecha, n: cuantos, preferencia, ahora, reprograma });
  const guardo = reprograma ? '¿Te cambio la cita a ese hueco?' : '¿Te lo reservo?';

  if (e.tipo === 'elegido') {
    const r = await reservarElegido(deps, conv, { ...e.hueco, tratamientoId }, comun);
    if (!r.ocupado) return r;
    const otros = (await siguientes(e.hueco.fecha, null, 6)).filter((h) => !(h.fecha === e.hueco.fecha && h.hora === e.hueco.hora)).slice(0, 3);
    return ofrecerYEsperar(deps, conv, { ...comun, huecos: otros, pedido: { desde: e.hueco.fecha },
      texto: `${hola}Vaya${n}, ese hueco ya no está libre. Te puedo ofrecer ${textoHuecos(otros)}. ¿Cuál te viene mejor?` });
  }

  if (e.tipo === 'dudoso') {
    const t = e.candidatos.length === 1
      ? `${hola}Perfecto${n}. ¿Te ${reprograma ? 'cambio la cita a' : 'reservo'} ${textoHuecos(e.candidatos)}?`
      : `${hola}¡Genial${n}! ¿Cuál prefieres: ${textoHuecos(e.candidatos)}?`;
    return ofrecerYEsperar(deps, conv, { ...comun, huecos: e.candidatos, texto: t });
  }

  if (e.tipo === 'pide') {
    const preferencia = e.hora ? ventanaDe(e.hora) : e.franja;
    const pedido = { desde: e.fecha || (reprograma ? T.sumarDias(hoy, 1) : hoy), franja: e.franja };
    if (e.fecha) {
      const delDia = (await agenda.huecos(pool, { fecha: e.fecha, tratamientoId, ahora, ignorarCitaId: reprograma?.id }))
        .filter((h) => !(reprograma && e.fecha === reprograma.fecha && h.hora === reprograma.hora));
      const exacto = e.hora && delDia.find((h) => h.hora === e.hora);
      if (exacto) {
        return ofrecerYEsperar(deps, conv, { ...comun, huecos: [{ fecha: e.fecha, hora: e.hora }],
          texto: `${hola}${mayuscula(textoDia(e.fecha))} a las ${e.hora} lo tengo libre${n}. ${guardo}` });
      }
      const esteDia = proponer(delDia, { n: 3, preferencia, separacionMin: 60 }).map((h) => ({ fecha: e.fecha, hora: h.hora }));
      if (esteDia.length) {
        const t = e.hora
          ? `${hola}A las ${e.hora} ya no me queda hueco${n}, pero ${textoHuecos(esteDia)} sí. ¿Te viene bien?`
          : `${hola}${mayuscula(textoHuecos(esteDia))} tengo hueco${n}. ¿Cuál te viene mejor?`;
        return ofrecerYEsperar(deps, conv, { ...comun, huecos: esteDia, texto: t });
      }
      const despues = await siguientes(T.sumarDias(e.fecha, 1), preferencia);
      return ofrecerYEsperar(deps, conv, { ...comun, huecos: despues, pedido,
        texto: `${hola}Ese día lo tengo completo${n}. Te puedo ofrecer ${textoHuecos(despues)}. ¿Cuál te viene mejor?` });
    }
    // Cambiando su cita, desde mañana: la de hoy ya no le da tiempo a moverla.
    const lista = await siguientes(pedido.desde, preferencia);
    return ofrecerYEsperar(deps, conv, { ...comun, huecos: lista, pedido, texto: `${hola}Te puedo ofrecer ${textoHuecos(lista)}. ¿Cuál te viene mejor?` });
  }

  // «Ninguno me viene bien»: otros, a partir del último día ofrecido.
  const ultimo = ofrecidos.length ? ofrecidos.map((h) => h.fecha).sort().at(-1) : hoy;
  const otros = evitando(await siguientes(T.sumarDias(ultimo, 1), e.franja, 8), e.evitar).slice(0, 3);
  return ofrecerYEsperar(deps, conv, { ...comun, huecos: otros, pedido: { desde: T.sumarDias(ultimo, 1), franja: e.franja },
    texto: `${hola}Sin problema${n}. Te propongo otros: ${textoHuecos(otros)}. Si tampoco te encajan, dime qué día u horario te viene mejor.` });
}

// ── Tiene una cita pendiente y escribe sobre ella ───────────────────────────────────────────
const AGRADECE = /^((muchas|mil) )?gracias\b|^(genial|perfecto|estupendo|fenomenal|vale|ok|okey|de acuerdo|nos vemos|hasta (el|luego|pronto|entonces|manana)|un saludo|besos?)\b/;
const CONFIRMA = /^(si,? )?(confirmo|confirmado|confirmada|(alli|ahi) estare|(alli|ahi) estaremos|cuenta conmigo|si,? (alli|ahi) estare)\b/;
// Cambiarla (se le proponen huecos) o cancelarla (se le pregunta antes). «No puedo ir» es cambiarla:
// se le ofrecen otros y se le recuerda que también puede cancelarla.
const CAMBIO = new RegExp('\\b(cambiar(la|mela)?|cambia(la|mela|s|is)?|cambiarias|mover(la|mela)?|mueve(la|mela|s)?|moveis|aplazar(la|mela)?|aplaza(la|mela|s)?'
  + '|retrasar(la|mela)?|retrasa(la|mela|s)?|adelantar(la|mela)?|adelanta(la|mela|s)?|reprogramar(la)?|pasarla|pasarmela|pasamela|me la pasas|me la puedes pasar)\\b'
  + '|no (voy a poder|podre|puedo) (ir|venir|acudir)|me ha surgido');
const CANCELAR = /\b(cancelar(la|lo|mela)?|cancela(la|lo|mela)?|cancelo|cancelad(la)?|anular(la|lo|mela)?|anula(la|lo|mela)?|anulo|anulad(la)?)\b/;
// «No quiero cancelarla» no es cancelarla.
const NO_CANCELAR = /\bno (la |lo )?(quiero |hace falta |hay que )?(cancelar|anular)/;
const OTRO_MOMENTO = /\b(otro (dia|momento|hueco)|otra (fecha|hora)|buscame|busca(me)? (otro|hueco))\b/;
const MANTENER = /\b(la dejo|la dejamos|dejala|dejarla|mejor (la )?dej(o|amos)|como (esta|estaba)|al final (si )?(puedo|podre|voy)|no hace falta|la mantengo|mantenla|mantenerla|no (la )?(quiero|necesito) (cambiar|mover)(la)?)\b/;
// Respuestas cortas a una pregunta nuestra. «Sí» no es «si me la cambias…» ni «si puedes…».
const SI = new RegExp('^(si|sii+)\\b(?!\\s+(me|te|se|le|les|lo|la|los|las|nos|os|no|puedes|puede|podeis|pudiera|pudieras|hay|es|fuera|quieres|tienes|teneis|necesito|al final)\\b)'
  + '|^si,? me (gustaria|encantaria|va bien|viene bien|vendria bien|parece bien|apetece)\\b'
  + '|^(vale|ok|okey|okay|claro|venga|dale|de acuerdo|perfecto|genial|por favor|porfa|adelante|confirmo|hazlo|eso es|me parece bien)\\b');
const NO = /^(no|nop|nope|mejor no|para nada|imposible|paso)\b(?!\s+se\b)/;
// «¿No hay nada antes?» (y no «antes de las 12», que es una hora; «muy tarde» suele ser la hora del día).
const ANTES = /\b(nada|algo|ningun hueco|hueco|huecos|cita|libre) (mas )?antes\b(?! de (las|la|comer|trabajar))|\b(lo|la) (necesito|quiero|querria|necesitaria|preferiria) antes\b(?! de)|\bmas (pronto|cerca)\b|\bantes no (hay|teneis|tienes)\b|\bdemasiado lejos\b|\bno puedo esperar/;

async function citaProxima(q, pacienteId, ahora) {
  // El hueco que se le está guardando de la lista de espera no es «su cita» (eso lo contesta la oferta).
  const [[c]] = await q.query(
    `SELECT id FROM citas c WHERE paciente_id = ? AND inicio > ? AND inicio < ? AND estado IN ('confirmada','retenida')
        AND NOT EXISTS (SELECT 1 FROM lista_espera_ofertas o WHERE o.cita_id = c.id AND o.estado = 'ofrecida')
      ORDER BY inicio LIMIT 1`,
    [pacienteId, ahora, new Date(ahora.getTime() + 60 * 86400000)]);
  return c ? c.id : null;
}

async function atenderSobreCita(deps, conv, { texto, ahora, datos, nombre, hola = '', hist }) {
  const { pool } = deps;
  const t = normalizar(texto);
  const cambiar = CAMBIO.test(t);
  const cancela = !cambiar && CANCELAR.test(t) && !NO_CANCELAR.test(t);
  const confirma = !cambiar && !cancela && CONFIRMA.test(t);
  const agradece = !cambiar && !cancela && !confirma && t.length <= 60 && !t.includes('?') && AGRADECE.test(t);
  if (!cambiar && !cancela && !confirma && !agradece) return null;
  const citaId = await citaProxima(pool, conv.paciente_id, ahora);
  if (!citaId) return null;
  const c = await datosCita(pool, citaId);
  const n = nombre ? `, ${nombre}` : '';

  if (cambiar) return { ...(await atenderCambio(deps, conv, c, { texto, ahora, datos, nombre, hola })), sobreCita: 'cambiar' };
  if (cancela) return preguntarCancelar(deps, conv, c, { ahora, nombre, hola });

  if (confirma) await registrar(pool, { tipo: 'cita_confirmada_paciente', entidad: 'cita', entidadId: citaId, actor: 'paciente', datos: { por: 'whatsapp' } });
  // Un «gracias» al «gracias» no hace falta: si ya le contestamos hace poco, no se repite.
  const ultimo = [...hist].reverse().find((m) => m.autor !== 'paciente');
  const reciente = ultimo && /^(¡A ti|¡Perfecto)/.test(ultimo.texto) && ahora - new Date(ultimo.en) < 30 * 60000;
  await pool.query("UPDATE conversaciones SET estado = 'cerrada', motivo_cierre = 'cita', proximo_paso = 'cita', proximo_paso_en = ? WHERE id = ?", [c.inicio, conv.id]);
  if (reciente) return { conversacionId: conv.id, sobreCita: confirma ? 'confirma' : 'agradece', respuesta: null };
  const respuesta = confirma
    ? `¡Perfecto${n}! Queda confirmada: te esperamos ${textoDia(c.fecha)} a las ${c.hora}.`
    : `¡A ti${n}! Nos vemos ${textoDia(c.fecha)} a las ${c.hora}.`;
  const envio = await enviar(deps, conv, { texto: respuesta, autor: 'ia', ahora });
  return { conversacionId: conv.id, sobreCita: confirma ? 'confirma' : 'agradece', respuesta, envio };
}

// ── Cambiar o cancelar la cita, y la lista de espera ─────────────────────────────────────────

// Lo que le preguntamos («¿Cancelo tu cita?», «¿Te busco otro momento?», «¿Te aviso si se libera
// un hueco?») queda 24 h en la conversación para entender su «sí» o su «no».
function preguntaPendiente(conv, ahora = new Date()) {
  const p = parseJson(conv?.pregunta_pendiente);
  if (!p?.tipo || !p.en || ahora - new Date(p.en) > VENTANA_MS) return null;
  return p;
}

async function ponerPregunta(q, conversacionId, pregunta, ahora) {
  await q.query('UPDATE conversaciones SET pregunta_pendiente = ? WHERE id = ?', [JSON.stringify({ ...pregunta, en: ahora.toISOString() }), conversacionId]);
}

// Lo que se decide sin la repesca también queda en el registro («Qué ha decidido la IA»).
async function anotar(q, conv, intencion, acciones, proximo) {
  await registrar(q, { tipo: 'repesca_decision', entidad: 'conversacion', entidadId: conv.id, actor: 'ia', datos: { intencion, acciones, proximo } });
}

async function contestar(deps, conv, respuesta, ahora, extra = {}) {
  const envio = await enviar(deps, conv, { texto: respuesta, autor: 'ia', ahora });
  return { conversacionId: conv.id, ...extra, respuesta, envio };
}

// Quiere cambiar su cita: se le proponen huecos del mismo tratamiento desde mañana (en su franja, o
// el día que pida) sin pasar por nadie. Al elegir, la nueva se reserva y la antigua queda
// «reprogramada». Lo que necesita valoración, o viene de Treatwell, lo cambia una persona.
async function atenderCambio(deps, conv, c, { texto, ahora, datos, nombre, hola = '' }) {
  const { pool } = deps;
  if (!c.reservable_ia || c.origen === 'treatwell') return cambioAPersona(deps, conv, c, { ahora, nombre, hola, texto, porque: 'no_reservable' });
  await pool.query('UPDATE conversaciones SET reprograma_cita_id = ? WHERE id = ?', [c.id, conv.id]);
  const hoy = T.fechaMadrid(ahora);
  const manana = T.sumarDias(hoy, 1);
  const e = elegirHueco(texto, [], { hoy });
  const comun = { ahora, texto, datos, nombre, hola, tratamientoId: c.tratamiento_id, ofrecidos: [], reprograma: c };
  if (e?.tipo === 'pide' && (e.fecha || e.hora)) return atenderEleccion(deps, conv, e, comun);
  const n = nombre ? `, ${nombre}` : '';
  const huecos = evitando(await proximos(pool, { tratamientoId: c.tratamiento_id, desdeFecha: manana, n: e?.evitar ? 8 : 3, preferencia: e?.franja || null, ahora, reprograma: c }), e?.evitar).slice(0, 3);
  return ofrecerYEsperar(deps, conv, { ...comun, frase: texto, huecos, pedido: { desde: manana, franja: e?.franja },
    texto: `${hola}Sin problema${n}. Te cambio la cita del ${textoDia(c.fecha).slice(3)} a las ${c.hora}: te puedo ofrecer ${textoHuecos(huecos)}. ¿Cuál te viene mejor? Si prefieres cancelarla, dímelo.` });
}

// Cambiar la cita con una persona: lo que la IA no puede mover (valoración, Treatwell), cuando no hay
// huecos o cuando no se entiende lo que dice. Mientras, su cita sigue en pie.
async function cambioAPersona(deps, conv, c, { ahora, nombre, hola = '', texto = '', porque }) {
  const { pool } = deps;
  const n = nombre ? `, ${nombre}` : '';
  const cuando = `${textoDia(c.fecha).slice(3)} a las ${c.hora}`;
  const motivo = {
    no_reservable: `Quiere cambiar o cancelar su cita del ${cuando}`,
    sin_huecos: `Quiere cambiar su cita del ${cuando} y no hay huecos para lo que pide`,
    no_entendido: `Quiere cambiar su cita del ${cuando}: no se entiende su respuesta`,
  }[porque];
  const decision = { intencion: 'cita', acciones: [{ tipo: 'pasar_a_persona', motivo }], proximoPaso: 'persona' };
  await enTransaccion(pool, async (con) => {
    const [[fresca]] = await con.query('SELECT * FROM conversaciones WHERE id = ? FOR UPDATE', [conv.id]);
    await aplicarDecision(con, fresca, decision, { ahora, texto, datos: null });
    await con.query('UPDATE conversaciones SET reprograma_cita_id = NULL, huecos_ofrecidos = NULL, huecos_ofrecidos_en = NULL WHERE id = ?', [conv.id]);
  });
  const sigue = `mientras, tu cita ${textoDia(c.fecha)} a las ${c.hora} sigue en pie`;
  const respuesta = {
    no_reservable: `${hola}Sin problema${n}. Una persona del equipo te ayuda ahora mismo a buscar otro momento. Si prefieres cancelarla, puedes hacerlo desde aquí: ${c.url}`,
    sin_huecos: `${hola}Ahora mismo no veo huecos para eso${n}. Una persona del equipo te ayuda por aquí a buscar otro momento; ${sigue}.`,
    no_entendido: `${hola}Perdona${n}, no te he entendido bien. Una persona del equipo te ayuda ahora mismo a buscar otro momento; ${sigue}.`,
  }[porque];
  return contestar(deps, conv, respuesta, ahora, { sobreCita: 'cambiar', eleccion: 'persona', decision });
}

// «Mejor la dejo como está»: se olvida el cambio.
async function dejarComoEsta(deps, conv, c, { ahora, nombre, hola = '' }) {
  const { pool } = deps;
  await pool.query("UPDATE seguimientos SET estado = 'cancelado', resultado = 'mantiene su cita' WHERE conversacion_id = ? AND estado = 'pendiente'", [conv.id]);
  await pool.query(`UPDATE conversaciones SET estado = 'cerrada', motivo_cierre = 'cita', proximo_paso = 'cita', proximo_paso_en = ?,
                      reprograma_cita_id = NULL, huecos_ofrecidos = NULL, huecos_ofrecidos_en = NULL WHERE id = ?`, [c.inicio, conv.id]);
  await anotar(pool, conv, 'cita', [{ tipo: 'mantener_cita', citaId: c.id }], 'cita');
  return contestar(deps, conv, `${hola}Perfecto${nombre ? `, ${nombre}` : ''}, la dejamos como está: te esperamos ${textoDia(c.fecha)} a las ${c.hora}.`, ahora, { sobreCita: 'mantiene' });
}

// «Cancela mi cita»: se le pregunta una vez antes de hacerlo (y se le ofrece cambiarla).
async function preguntarCancelar(deps, conv, c, { ahora, nombre, hola = '' }) {
  const { pool } = deps;
  await pool.query("UPDATE seguimientos SET estado = 'cancelado', resultado = 'quiere cancelar su cita' WHERE conversacion_id = ? AND estado = 'pendiente'", [conv.id]);
  await pool.query(`UPDATE conversaciones SET estado = 'esperando_paciente', proximo_paso = 'cita', proximo_paso_en = ?,
                      reprograma_cita_id = NULL, huecos_ofrecidos = NULL, huecos_ofrecidos_en = NULL WHERE id = ?`, [c.inicio, conv.id]);
  await ponerPregunta(pool, conv.id, { tipo: 'cancelar_cita', citaId: c.id }, ahora);
  await anotar(pool, conv, 'cita', [{ tipo: 'preguntar_si_cancela', citaId: c.id }], 'espera_respuesta');
  return contestar(deps, conv, `${hola}¿Cancelo tu cita del ${textoDia(c.fecha).slice(3)} a las ${c.hora}${nombre ? `, ${nombre}` : ''}? Si lo prefieres, te la cambio a otro día.`,
    ahora, { sobreCita: 'cancelar' });
}

// «Sí, cancélala»: se cancela (su hueco queda para la lista de espera) y se le ofrece buscar otro
// momento. La conversación se cierra con la pregunta en el aire: si contesta en 24 h, se reabre.
async function cancelarPorWhatsapp(deps, conv, c, { ahora, nombre, hola = '' }) {
  const { pool } = deps;
  try {
    await agenda.cancelar(pool, { id: c.id, por: 'paciente', motivo: 'cancelada por WhatsApp', actor: 'paciente', ahora });
  } catch (err) {
    if (err.codigo !== 'ESTADO_NO_VALIDO') throw err;
  }
  await pool.query("UPDATE seguimientos SET estado = 'cancelado', resultado = 'canceló su cita' WHERE conversacion_id = ? AND estado = 'pendiente'", [conv.id]);
  await pool.query(`UPDATE conversaciones SET estado = 'cerrada', motivo_cierre = 'cancelada', proximo_paso = 'cerrada', proximo_paso_en = NULL,
                      reprograma_cita_id = NULL, huecos_ofrecidos = NULL, huecos_ofrecidos_en = NULL WHERE id = ?`, [conv.id]);
  await ponerPregunta(pool, conv.id, { tipo: 'buscar_otro', tratamientoId: c.tratamiento_id }, ahora);
  await anotar(pool, conv, 'cita', [{ tipo: 'cancelar_cita', citaId: c.id }], 'cerrada');
  return contestar(deps, conv, `${hola}Hecho${nombre ? `, ${nombre}` : ''}: tu cita del ${textoDia(c.fecha).slice(3)} a las ${c.hora} queda cancelada. ¿Quieres que te busque otro momento más adelante?`,
    ahora, { sobreCita: 'cancelada' });
}

// Contesta a una pregunta nuestra. null si su respuesta no va con ella (sigue lo demás).
async function atenderPregunta(deps, conv, pregunta, { texto, ahora, datos, reglas, nombre, hola, ofrecidos }) {
  const { pool } = deps;
  const t = normalizar(texto);
  const hoy = T.fechaMadrid(ahora);
  const n = nombre ? `, ${nombre}` : '';
  const si = SI.test(t);
  const no = NO.test(t);

  if (pregunta.tipo === 'cancelar_cita') {
    const c = await citaEnPie(pool, pregunta.citaId, ahora);
    if (!c) return null;
    // «Mejor cámbiala» → huecos; «(No,) cancélala» → se cancela; «no», «no quiero cancelarla» o «la
    // mantengo» → sigue en pie; un «sí» → se cancela.
    if (CAMBIO.test(t) || OTRO_MOMENTO.test(t)) return { ...(await atenderCambio(deps, conv, c, { texto, ahora, datos, nombre, hola })), sobreCita: 'cambiar' };
    if (CANCELAR.test(t) && !NO_CANCELAR.test(t)) return cancelarPorWhatsapp(deps, conv, c, { ahora, nombre, hola });
    if (no || MANTENER.test(t) || NO_CANCELAR.test(t)) return dejarComoEsta(deps, conv, c, { ahora, nombre, hola });
    if (si) return cancelarPorWhatsapp(deps, conv, c, { ahora, nombre, hola });
    return null;
  }

  if (pregunta.tipo === 'buscar_otro') {
    if (no) {
      await pool.query("UPDATE conversaciones SET estado = 'cerrada', motivo_cierre = 'cancelada', proximo_paso = 'cerrada' WHERE id = ?", [conv.id]);
      await anotar(pool, conv, 'cita', [{ tipo: 'cerrar', motivo: 'no quiere otra cita por ahora' }], 'cerrada');
      return contestar(deps, conv, `${hola}De acuerdo${n}. Cuando quieras, escríbenos por aquí y te buscamos hueco.`, ahora, { sobreCita: 'sin_otra' });
    }
    const e = elegirHueco(texto, [], { hoy });
    const pide = e?.tipo === 'pide' && (e.fecha || e.hora);
    // «Sí, pero el mes que viene»: eso lo lleva la repesca (le escribe entonces, con su fecha).
    if (!pide && (reglas.plazo || (!si && !e))) return null;
    const [[trat]] = await pool.query('SELECT id, nombre, reservable_ia FROM tratamientos WHERE id = ? AND activo = TRUE', [pregunta.tratamientoId]);
    if (!trat) return null;
    if (!trat.reservable_ia) {
      const decision = { intencion: 'cita', acciones: [{ tipo: 'pasar_a_persona', motivo: `Canceló y quiere otra cita de ${enMinuscula(trat.nombre)}: proponerle huecos` }], proximoPaso: 'persona' };
      await enTransaccion(pool, async (con) => {
        const [[fresca]] = await con.query('SELECT * FROM conversaciones WHERE id = ? FOR UPDATE', [conv.id]);
        await aplicarDecision(con, fresca, decision, { ahora, texto, datos: null });
      });
      return contestar(deps, conv, `${hola}¡Genial${n}! Una persona del equipo te propone huecos por aquí enseguida.`, ahora, { sobreCita: 'otra', decision });
    }
    if (pide) return atenderEleccion(deps, conv, e, { ahora, texto, datos, nombre, hola, tratamientoId: trat.id, ofrecidos: [] });
    const desde = T.sumarDias(hoy, 1);
    const franja = e?.franja || detectarFranja(t);
    const huecos = evitando(await proximos(pool, { tratamientoId: trat.id, desdeFecha: desde, n: e?.evitar ? 8 : 3, preferencia: franja, ahora }), e?.evitar).slice(0, 3);
    return ofrecerYEsperar(deps, conv, { huecos, ahora, datos, frase: texto, tratamientoId: trat.id, nombre, hola, pedido: { desde, franja },
      texto: `${hola}¡Genial${n}! Te puedo ofrecer ${textoHuecos(huecos)}. ¿Cuál te viene mejor?` });
  }

  if (pregunta.tipo === 'avisar_hueco') {
    // Si con la respuesta elige uno de los huecos que tenía propuestos (o pide otros), eso manda.
    if (ofrecidos.length) {
      const e = elegirHueco(texto, ofrecidos, { hoy });
      if (e && ['elegido', 'pide', 'otros'].includes(e.tipo)) return null;
    }
    if (si) return apuntarEnEspera(deps, conv, pregunta, { ahora, nombre, hola, ofrecidos });
    if (!no) return null;
    if (ofrecidos.length) return contestar(deps, conv, `${hola}De acuerdo${n}. Si alguno de los que te propuse te encaja, dime cuál y te lo reservo.`, ahora, { listaEspera: 'no' });
    // Ni huecos ni lista de espera: una persona le propone alternativas.
    const decision = { intencion: 'lista_espera', acciones: [{ tipo: 'pasar_a_persona', motivo: 'Quiere cita y no hay huecos para lo que pide: proponerle alternativas' }], proximoPaso: 'persona' };
    await enTransaccion(pool, async (con) => {
      const [[fresca]] = await con.query('SELECT * FROM conversaciones WHERE id = ? FOR UPDATE', [conv.id]);
      await aplicarDecision(con, fresca, decision, { ahora, texto, datos: null });
    });
    return contestar(deps, conv, `${hola}De acuerdo${n}. Una persona del equipo te propone alternativas por aquí enseguida.`, ahora, { listaEspera: 'no', decision });
  }
  return null;
}

// «Sí, avísame»: a la lista de espera. Si aún tiene huecos propuestos, puede seguir eligiendo uno; si
// no, la conversación se cierra: le escribiremos cuando se libere un hueco.
async function apuntarEnEspera(deps, conv, pregunta, { ahora, nombre, hola = '', ofrecidos }) {
  const { pool } = deps;
  const n = nombre ? `, ${nombre}` : '';
  const pacienteId = await asegurarPaciente(pool, conv, { nombre });
  try {
    await LE.apuntar(pool, {
      pacienteId, tratamientoId: pregunta.tratamientoId, desdeFecha: pregunta.desde, hastaFecha: pregunta.hasta, franja: pregunta.franja,
      origen: 'whatsapp', creadoPor: 'ia', conversacionId: conv.id, ahora,
    });
  } catch (err) {
    if (!err.codigo) throw err;
    return null; // p. ej. el tratamiento ya no está activo: sigue la repesca normal
  }
  if (pregunta.hasta && ofrecidos.length) {
    await anotar(pool, conv, 'lista_espera', [{ tipo: 'apuntar_lista_espera', hasta: pregunta.hasta }], 'espera_respuesta');
    return contestar(deps, conv, `${hola}¡Apuntado${n}! Si se libera un hueco antes del ${textoDia(T.sumarDias(pregunta.hasta, 1)).slice(3)}, te lo guardo y te aviso por aquí. `
      + 'Si mientras quieres asegurarte uno de los que te propuse, dime cuál.', ahora, { listaEspera: 'apuntado' });
  }
  const [[trat]] = await pool.query('SELECT nombre FROM tratamientos WHERE id = ?', [pregunta.tratamientoId]);
  await pool.query("UPDATE seguimientos SET estado = 'cancelado', resultado = 'en la lista de espera' WHERE conversacion_id = ? AND estado = 'pendiente'", [conv.id]);
  await pool.query(`UPDATE conversaciones SET estado = 'cerrada', motivo_cierre = 'lista_espera', proximo_paso = 'cerrada', proximo_paso_en = NULL,
                      huecos_ofrecidos = NULL, huecos_ofrecidos_en = NULL WHERE id = ?`, [conv.id]);
  await anotar(pool, conv, 'lista_espera', [{ tipo: 'apuntar_lista_espera' }], 'cerrada');
  return contestar(deps, conv, `${hola}¡Apuntado${n}! En cuanto se libere un hueco para ${enMinuscula(trat?.nombre || 'tu tratamiento')}, te lo guardo y te aviso por aquí.`,
    ahora, { listaEspera: 'apuntado' });
}

// «¿No hay nada antes?»: se mira de verdad; si no hay, se le ofrece la lista de espera para antes del
// primer hueco propuesto (los propuestos siguen ahí).
async function avisarSiHayAntes(deps, conv, ofrecidos, { texto, ahora, datos, nombre, hola }) {
  const { pool } = deps;
  const n = nombre ? `, ${nombre}` : '';
  const tratamientoId = conv.huecos_tratamiento_id;
  const primero = ofrecidos.map((h) => h.fecha).sort()[0];
  const desde = T.sumarDias(T.fechaMadrid(ahora), 1);
  const hasta = T.sumarDias(primero, -1);
  const franja = detectarFranja(normalizar(texto));
  if (hasta < desde) {
    return contestar(deps, conv, `${hola}Lo primero que tengo libre es ${textoDia(primero)}${n}. ¿Cuál de los que te propuse te viene mejor?`, ahora, { listaEspera: 'nada_antes' });
  }
  const antes = (await proximos(pool, { tratamientoId, desdeFecha: desde, dias: T.diasEntre(desde, hasta) + 1, preferencia: franja, ahora })).filter((h) => h.fecha <= hasta);
  if (antes.length) {
    return ofrecerYEsperar(deps, conv, { huecos: antes, ahora, datos, frase: texto, tratamientoId, nombre, hola,
      texto: `${hola}Sí${n}: antes te puedo ofrecer ${textoHuecos(antes)}. ¿Te viene bien alguno?` });
  }
  await ponerPregunta(pool, conv.id, { tipo: 'avisar_hueco', tratamientoId, desde, hasta, franja }, ahora);
  return contestar(deps, conv, `${hola}Antes del ${textoDia(primero).slice(3)} no me queda nada libre${n}. ¿Quieres que te avise si se libera un hueco antes? `
    + 'Mientras, los que te propuse siguen disponibles.', ahora, { listaEspera: 'pregunta' });
}

// Se le está guardando un hueco de la lista de espera. «Sí, guárdamelo» → cita confirmada; «No me
// viene bien» → el hueco pasa al siguiente y él sigue en la lista; si pide otro día u hora, se suelta
// este y se mira el que pide. Lo que no va con la oferta sigue su curso.
const SALIR = /\b(sacame|quitame|borrame) de la lista|\bno me avises|\bya no (me interesa|lo necesito|hace falta)/;

async function atenderOfertaEspera(deps, conv, oferta, { texto, ahora, datos, nombre, hola }) {
  const { pool } = deps;
  const t = normalizar(texto);
  const n = nombre ? `, ${nombre}` : '';
  const e = elegirHueco(texto, [{ fecha: oferta.fecha, hora: oferta.hora }], { hoy: T.fechaMadrid(ahora) });
  if (SALIR.test(t)) {
    await LE.quitar(pool, oferta.lista_espera_id, { motivo: 'lo pidió por WhatsApp', actor: 'paciente', ahora });
    await LE.cerrarConversacion(pool, conv.id, 'lista_espera');
    return contestar(deps, conv, `${hola}De acuerdo${n}, te saco de la lista de espera. Si más adelante quieres cita, escríbenos por aquí.`, ahora, { listaEspera: 'fuera' });
  }
  if (e?.tipo === 'elegido') return aceptarOferta(deps, conv, oferta, { texto, ahora, datos, nombre, hola });
  if (e?.tipo === 'otros' || NO.test(t)) {
    await LE.rechazar(pool, oferta, { ahora });
    await LE.cerrarConversacion(pool, conv.id, 'lista_espera');
    return contestar(deps, conv, `${hola}Sin problema${n}. Sigues en la lista de espera: si se libera otro hueco, te aviso.`, ahora, { listaEspera: 'rechazada' });
  }
  if (e?.tipo === 'pide' && (e.fecha || e.hora)) {
    await LE.rechazar(pool, oferta, { ahora });
    return atenderEleccion(deps, conv, e, { ahora, texto, datos, nombre, hola, tratamientoId: oferta.tratamiento_id, ofrecidos: [] });
  }
  return null;
}

async function aceptarOferta(deps, conv, oferta, { texto, ahora, datos, nombre, hola }) {
  const { pool } = deps;
  const r = await LE.aceptar(pool, oferta, { ahora });
  if (r.ocupado) {
    await LE.cerrarConversacion(pool, conv.id, 'lista_espera');
    return contestar(deps, conv, `${hola}Vaya${nombre ? `, ${nombre}` : ''}, ese hueco ya se ha ocupado. Sigues en la lista de espera: si se libera otro, te aviso.`,
      ahora, { listaEspera: 'ocupado' });
  }
  const decision = { intencion: 'lista_espera', acciones: [{ tipo: 'cita_reservada', citaId: r.citaId, reprograma: r.reprograma }], proximoPaso: 'cita' };
  await enTransaccion(pool, async (con) => {
    const [[fresca]] = await con.query('SELECT * FROM conversaciones WHERE id = ? FOR UPDATE', [conv.id]);
    await aplicarDecision(con, fresca, decision, { ahora, texto, datos });
  });
  const antes = r.reprograma ? await datosCita(pool, r.reprograma) : null;
  const respuesta = textoCitaReservada(await datosCita(pool, r.citaId), { nombre, hola, antes });
  const envio = await enviar(deps, conv, { texto: respuesta, autor: 'ia', ahora });
  // La confirmación ya le ha llegado aquí: el aviso de confirmación no se repite.
  if (envio.estado === 'enviado') await pool.query('UPDATE citas SET aviso_confirmacion_en = ? WHERE id = ?', [ahora, r.citaId]);
  return { conversacionId: conv.id, listaEspera: 'aceptada', citaId: r.citaId, reprograma: r.reprograma, decision, respuesta, envio };
}

// Envía un texto libre (solo con la ventana de 24 h abierta) o una plantilla.
async function enviar(deps, conv, { texto = null, plantilla = null, variables = [], botonUrl = null, autor = 'sistema', ahora = new Date() }) {
  const { pool, whatsapp } = deps;
  let r;
  let estado = 'enviado';
  let error = null;
  try {
    r = plantilla
      ? await whatsapp.enviarPlantilla({ telefono: conv.telefono, nombre: plantilla.nombre, idioma: plantilla.idioma || 'es', variables, botonUrl })
      : await whatsapp.enviarTexto({ telefono: conv.telefono, texto });
  } catch (err) {
    estado = 'fallido';
    error = err.message;
  }
  // En la conversación queda el texto tal y como lo lee el paciente (con el enlace del botón).
  const cuerpo = plantilla ? `${rellenar(plantilla, variables)}${botonUrl ? `\n\n${enlaceDelBoton(plantilla, botonUrl)}` : ''}` : texto;
  const id = await guardarMensaje(pool, { conversacionId: conv.id, direccion: 'saliente', autor, tipo: plantilla ? 'plantilla' : 'texto', texto: cuerpo, waId: r?.waId, estado, plantillaId: plantilla?.id, creadoEn: ahora });
  await pool.query('UPDATE conversaciones SET ultimo_saliente_en = ? WHERE id = ?', [ahora, conv.id]);
  if (conv.lead_id && estado === 'enviado') {
    await pool.query("UPDATE leads SET etapa = 'contactado', primer_contacto_en = COALESCE(primer_contacto_en, ?) WHERE id = ? AND etapa = 'nuevo'", [ahora, conv.lead_id]);
  }
  if (error) await pool.query('UPDATE mensajes SET error_texto = ? WHERE id = ?', [error.slice(0, 255), id]);
  return { mensajeId: id, estado, waId: r?.waId || null };
}

function enlaceDelBoton(plantilla, valor) {
  const boton = (parseJson(plantilla.botones) || []).find((b) => b.tipo === 'url');
  return boton?.url ? boton.url.replace('{{1}}', valor) : `${config.urlPublica}/c/${valor}`;
}

// «Valoración HIFU» → «valoración HIFU» (para ponerlo en mitad de una frase sin romper las siglas).
function enMinuscula(nombre) {
  const t = String(nombre || '');
  return /^[A-ZÁÉÍÓÚÑ]{2,}\b/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

async function plantillasBd(q) {
  const [filas] = await q.query("SELECT * FROM plantillas WHERE estado IN ('aprobada','pausada')");
  return filas.map((p) => ({ ...p, reservaDeId: p.reserva_de_id, cuerpo: p.cuerpo }));
}

// Seguimientos vencidos: «como quedamos». Si la ventana de 24 h está abierta, texto libre; si no,
// plantilla aprobada. Después, como mucho un recordatorio; si tampoco contesta, se cierra.
async function procesarSeguimientos(deps, { ahora = new Date(), limite = 20 } = {}) {
  const { pool } = deps;
  const con = await pool.getConnection();
  let vencidos;
  try {
    await con.beginTransaction();
    [vencidos] = await con.query(
      "SELECT * FROM seguimientos WHERE estado = 'pendiente' AND programado_para <= ? ORDER BY programado_para LIMIT ? FOR UPDATE SKIP LOCKED", [ahora, limite]);
    if (vencidos.length) await con.query("UPDATE seguimientos SET estado = 'enviado', intentos = intentos + 1 WHERE id IN (?)", [vencidos.map((s) => s.id)]);
    await con.commit();
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
  const calendario = await calendarioDesdeBd(pool);
  const plantillas = await plantillasBd(pool);
  const resultados = [];
  for (const s of vencidos) {
    const [[conv]] = await pool.query('SELECT * FROM conversaciones WHERE id = ?', [s.conversacion_id]);
    if (!conv || conv.estado === 'cerrada') { resultados.push({ id: s.id, omitido: 'conversación cerrada' }); continue; }
    const [[paciente]] = conv.paciente_id ? await pool.query('SELECT nombre, baja_comercial_en FROM pacientes WHERE id = ?', [conv.paciente_id]) : [[null]];
    if (paciente?.baja_comercial_en) { resultados.push({ id: s.id, omitido: 'baja' }); continue; }

    if (s.motivo === 'cierre_sin_respuesta') {
      const sinRespuesta = !conv.ultimo_entrante_en || new Date(conv.ultimo_entrante_en) < new Date(s.creado_en);
      if (sinRespuesta) {
        await pool.query("UPDATE conversaciones SET estado = 'cerrada', motivo_cierre = 'sin_respuesta', proximo_paso = 'cerrada' WHERE id = ?", [conv.id]);
        await pool.query("UPDATE seguimientos SET estado = 'cumplido', resultado = 'cerrada sin respuesta' WHERE id = ?", [s.id]);
      }
      resultados.push({ id: s.id, cierre: sinRespuesta });
      continue;
    }

    const tratamiento = await nombreTratamiento(pool, conv);
    const nombre = paciente?.nombre || 'hola';
    const ventanaAbierta = conv.ventana_hasta && new Date(conv.ventana_hasta) > ahora;
    let envio;
    if (ventanaAbierta) {
      envio = await enviar(deps, conv, { texto: `Hola ${nombre}, como quedamos, te escribo para buscarte hueco para ${tratamiento}. ¿Te viene bien esta semana o la que viene?`, autor: 'ia', ahora });
    } else {
      const p = elegirPlantilla(s.motivo === 'recordatorio' ? 'como_quedamos' : 'como_quedamos', plantillas);
      if (!p) {
        await pool.query("INSERT INTO tareas (tipo, titulo, paciente_id, conversacion_id, vence_en) VALUES ('atender_conversacion', ?, ?, ?, ?)",
          ['No hay plantilla «como quedamos» aprobada: escribir a mano', conv.paciente_id, conv.id, new Date(ahora.getTime() + 3600000)]);
        await pool.query("UPDATE seguimientos SET estado = 'fallido', resultado = 'sin plantilla aprobada' WHERE id = ?", [s.id]);
        resultados.push({ id: s.id, fallido: 'sin plantilla' });
        continue;
      }
      envio = await enviar(deps, conv, { plantilla: p, variables: [nombre, tratamiento], autor: 'sistema', ahora });
    }
    // Siguiente: un recordatorio a los 4 días; si ya lo era, cierre a los 4 días si no contesta.
    const hoy = T.fechaMadrid(ahora);
    const siguiente = calcularSeguimiento({ tipo: 'dias', n: 4 }, { hoy, ahoraMin: T.minutosMadrid(ahora), calendario });
    const motivo = s.motivo === 'recordatorio' ? 'cierre_sin_respuesta' : 'recordatorio';
    await pool.query(
      'INSERT INTO seguimientos (paciente_id, lead_id, conversacion_id, contexto, contexto_id, motivo, plazo_tipo, programado_para, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [s.paciente_id, s.lead_id, s.conversacion_id, s.contexto, s.contexto_id, motivo, 'dias', T.desdeMadrid(siguiente.fecha, siguiente.hora), 'sistema']);
    await pool.query("UPDATE conversaciones SET proximo_paso = 'espera_respuesta', proximo_paso_en = ? WHERE id = ?", [T.desdeMadrid(siguiente.fecha, siguiente.hora), conv.id]);
    await registrar(pool, { tipo: 'seguimiento_enviado', entidad: 'seguimiento', entidadId: s.id, datos: { ventanaAbierta: Boolean(ventanaAbierta), siguiente: motivo } });
    resultados.push({ id: s.id, envio, siguiente: { motivo, fecha: siguiente.fecha } });
  }
  return resultados;
}

async function nombreTratamiento(q, conv) {
  const datos = await cargarContexto(q, conv, new Date());
  return datos.tratamiento ? enMinuscula(datos.tratamiento.nombre) : 'tu tratamiento';
}

// Mete a alguien en una secuencia (lead nuevo, cancelación, presupuesto, toca repetir…).
async function inscribir(q, { secuencia, pacienteId = null, leadId = null, citaId = null, presupuestoId = null, inicio = new Date(), grupoControl = false }) {
  if (!S.SECUENCIAS[secuencia]) throw new Error(`Secuencia desconocida: ${secuencia}`);
  const calendario = await calendarioDesdeBd(q);
  const primero = S.momentoDelPaso({ secuencia, inicio }, 0, calendario);
  const [r] = await q.query(
    'INSERT INTO inscripciones (secuencia, paciente_id, lead_id, cita_id, presupuesto_id, inicio, siguiente_en, grupo_control) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [secuencia, pacienteId, leadId, citaId, presupuestoId, inicio, primero?.cuando || null, grupoControl]);
  return r.insertId;
}

// Pasos de secuencia vencidos (cron).
async function avanzarSecuencias(deps, { ahora = new Date(), limite = 20 } = {}) {
  const { pool } = deps;
  const con = await pool.getConnection();
  let filas;
  try {
    await con.beginTransaction();
    [filas] = await con.query("SELECT * FROM inscripciones WHERE estado = 'activa' AND siguiente_en <= ? ORDER BY siguiente_en LIMIT ? FOR UPDATE SKIP LOCKED", [ahora, limite]);
    if (filas.length) await con.query('UPDATE inscripciones SET siguiente_en = NULL WHERE id IN (?)', [filas.map((f) => f.id)]);
    await con.commit();
  } catch (err) {
    await con.rollback().catch(() => {});
    throw err;
  } finally {
    con.release();
  }
  const calendario = await calendarioDesdeBd(pool);
  const plantillas = await plantillasBd(pool);
  const resultados = [];
  for (const ins of filas) {
    const { paso } = S.momentoDelPaso(ins, ins.paso_actual, calendario) || {};
    const siguiente = S.momentoDelPaso(ins, ins.paso_actual + 1, calendario);
    const avanzar = async (extra = {}) => {
      await pool.query('UPDATE inscripciones SET paso_actual = paso_actual + 1, siguiente_en = ?, estado = ?, motivo_fin = ? WHERE id = ?',
        [siguiente?.cuando || null, siguiente ? 'activa' : 'terminada', siguiente ? null : 'secuencia completa', ins.id]);
      resultados.push({ inscripcion: ins.id, paso: ins.paso_actual, ...extra });
    };
    if (!paso) { await avanzar({ omitido: 'sin paso' }); continue; }
    const telefono = await telefonoDe(pool, ins);
    if (!telefono) { await avanzar({ omitido: 'sin teléfono' }); continue; }
    if (ins.grupo_control) { await avanzar({ omitido: 'grupo de control' }); continue; }

    if (paso.accion === 'tarea') {
      if (paso.soloSiImporteDesde && ins.presupuesto_id) {
        const [[pr]] = await pool.query('SELECT importe_eur FROM presupuestos WHERE id = ?', [ins.presupuesto_id]);
        if (!pr || Number(pr.importe_eur) < paso.soloSiImporteDesde) { await avanzar({ omitido: 'importe bajo' }); continue; }
      }
      await pool.query('INSERT INTO tareas (tipo, titulo, paciente_id, vence_en) VALUES (?, ?, ?, ?)', [paso.tarea, paso.motivo, ins.paciente_id, new Date(ahora.getTime() + 2 * 3600000)]);
      await avanzar({ tarea: paso.tarea });
      continue;
    }
    const p = elegirPlantilla(paso.uso, plantillas);
    const comercial = p?.categoria === 'marketing';
    if (comercial) {
      const permiso = await permisoComercial(pool, ins, ahora);
      if (!permiso.ok) {
        // No se pierde el paso: se reintenta mañana (salvo baja o sin consentimiento, que termina).
        if (/baja|consentimiento/.test(permiso.motivo)) {
          await pool.query("UPDATE inscripciones SET estado = 'cancelada', motivo_fin = ? WHERE id = ?", [permiso.motivo, ins.id]);
        } else {
          await pool.query('UPDATE inscripciones SET siguiente_en = ? WHERE id = ?', [S.ajustarAHorario(new Date(ahora.getTime() + 86400000), calendario), ins.id]);
        }
        resultados.push({ inscripcion: ins.id, bloqueado: permiso.motivo });
        continue;
      }
    }
    if (!p) {
      await pool.query("INSERT INTO tareas (tipo, titulo, paciente_id, vence_en) VALUES ('otro', ?, ?, ?)", [`Falta plantilla aprobada para «${paso.uso}»`, ins.paciente_id, new Date(ahora.getTime() + 3600000)]);
      await avanzar({ fallido: 'sin plantilla' });
      continue;
    }
    const con3 = await pool.getConnection();
    let conv;
    try {
      await con3.beginTransaction();
      conv = await conversacionPara(con3, { telefono, pacienteId: ins.paciente_id, leadId: ins.lead_id, contexto: contextoDe(ins.secuencia), contextoId: ins.presupuesto_id || ins.cita_id || ins.lead_id });
      await con3.commit();
    } finally {
      con3.release();
    }
    const nombre = await nombreDe(pool, ins);
    const variables = [nombre, await nombreTratamiento(pool, conv)].slice(0, (p.cuerpo.match(/\{\{\d+\}\}/g) || []).length);
    const envio = await enviar(deps, conv, { plantilla: p, variables, ahora });
    await avanzar({ envio: envio.estado, plantilla: p.nombre });
  }
  return resultados;
}

function contextoDe(secuencia) {
  return { lead: 'lead', cancelacion: 'cancelacion', presupuesto: 'presupuesto', toca_repetir: 'toca_repetir', dormido: 'dormido', vale_regalo: 'vale_regalo' }[secuencia] || 'general';
}

async function telefonoDe(q, ins) {
  if (ins.paciente_id) { const [[p]] = await q.query('SELECT telefono FROM pacientes WHERE id = ?', [ins.paciente_id]); if (p?.telefono) return p.telefono; }
  if (ins.lead_id) { const [[l]] = await q.query('SELECT telefono FROM leads WHERE id = ?', [ins.lead_id]); return l?.telefono || null; }
  return null;
}

async function nombreDe(q, ins) {
  if (ins.paciente_id) { const [[p]] = await q.query('SELECT nombre FROM pacientes WHERE id = ?', [ins.paciente_id]); if (p) return p.nombre; }
  if (ins.lead_id) { const [[l]] = await q.query('SELECT nombre FROM leads WHERE id = ?', [ins.lead_id]); if (l?.nombre) return l.nombre.split(' ')[0]; }
  return 'hola';
}

async function permisoComercial(q, ins, ahora) {
  const pid = ins.paciente_id;
  let baja = false;
  let consentimiento = false;
  let cliente = false;
  let seguimientoHasta = null;
  let enviados = [];
  if (pid) {
    const [[p]] = await q.query('SELECT baja_comercial_en, es_cliente FROM pacientes WHERE id = ?', [pid]);
    baja = Boolean(p?.baja_comercial_en);
    cliente = Boolean(p?.es_cliente);
    const [[c]] = await q.query("SELECT estado FROM consentimientos WHERE paciente_id = ? AND tipo = 'whatsapp_marketing' ORDER BY registrado_en DESC, id DESC LIMIT 1", [pid]);
    consentimiento = c?.estado === 'otorgado';
    const [[s]] = await q.query("SELECT MAX(programado_para) AS hasta FROM seguimientos WHERE paciente_id = ? AND estado = 'pendiente' AND creado_por IN ('ia','persona')", [pid]);
    seguimientoHasta = s?.hasta || null;
    const [m] = await q.query(
      `SELECT m.creado_en FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id JOIN plantillas p ON p.id = m.plantilla_id
       WHERE c.paciente_id = ? AND m.direccion = 'saliente' AND p.categoria = 'marketing' AND m.creado_en > ?`, [pid, new Date(ahora.getTime() - 30 * 86400000)]);
    enviados = m.map((x) => x.creado_en);
  } else if (ins.lead_id) {
    // Un lead que deja sus datos pidiendo información da su consentimiento para que le contestemos.
    consentimiento = true;
  }
  return S.puedeEnviarComercial({ ahora, enviados, seguimientoPendienteHasta: seguimientoHasta, baja, consentimientoMarketing: consentimiento, esClienteConServicioSimilar: cliente });
}

// Conversaciones abiertas sin próximo paso (la lista de cada mañana: el objetivo es que esté vacía).
async function sinProximoPaso(q, ahora = new Date()) {
  const [filas] = await q.query(
    `SELECT c.id, c.telefono, c.estado, c.proximo_paso, c.ultimo_saliente_en, c.ultimo_entrante_en
       FROM conversaciones c
      WHERE c.estado <> 'cerrada'
        AND NOT EXISTS (SELECT 1 FROM seguimientos s WHERE s.conversacion_id = c.id AND s.estado = 'pendiente')
        AND NOT EXISTS (SELECT 1 FROM tareas t WHERE t.conversacion_id = c.id AND t.estado = 'abierta')
        AND NOT EXISTS (SELECT 1 FROM citas ci WHERE ci.paciente_id = c.paciente_id AND ci.inicio > ? AND ci.estado IN ('confirmada','retenida'))`, [ahora]);
  return filas;
}

module.exports = {
  textoHuecos, textoDia, procesarEntrante, procesarSeguimientos, avanzarSecuencias, inscribir, sinProximoPaso, enviar, historial,
  calendarioDesdeBd, cargarContexto, conversacionPara, datosCita, plantillasBd, enMinuscula,
};
