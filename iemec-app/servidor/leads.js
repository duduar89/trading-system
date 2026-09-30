'use strict';
// Alta de leads, vengan de donde vengan: formularios de Meta y anuncios que abren WhatsApp
// (servidor/entrada.js) y la web o GHL (POST /api/leads). Un solo camino para todos:
//   · el teléfono se guarda en formato internacional (E.164; sin prefijo, España);
//   · el tratamiento sale de lo que respondió, del mapeo de campañas y anuncios o del catálogo
//     (nombre y alias);
//   · un lead en marcha con el mismo teléfono (ni perdido ni vendido) no se duplica ni vuelve a
//     empezar su secuencia: queda apuntado que ha vuelto a pedir información;
//   · se inscribe en la secuencia «lead» y su primer mensaje sale en la siguiente vuelta del cron (en
//     horario de envío). Sin móvil válido o con la baja comercial, no: tarea para recepción.
const E = require('../motor/entrada/leads');
const { cifrar } = require('./cripto');
const { registrar } = require('./eventos');
const R = require('./repesca/motor');

const ORIGEN_TEXTO = { meta_formulario: 'formulario de Meta', meta_ctwa: 'anuncio de WhatsApp', web: 'web', ghl: 'GHL', web_whatsapp: 'WhatsApp de la web' };
const cortar = (v, max = 160) => (v == null || v === '' ? null : String(v).slice(0, max));

async function catalogo(q) {
  const [tratamientos] = await q.query('SELECT id, nombre, alias, activo FROM tratamientos WHERE activo = TRUE');
  const [mapeo] = await q.query('SELECT clave, tratamiento_id FROM mapeo_tratamientos');
  return { tratamientos, mapeo };
}

// Lo que no se puede automatizar, a recepción, con lo necesario para encontrarlo.
async function tareaRecepcion(con, { motivo, leadId, pacienteId, d, ahora }) {
  const de = [ORIGEN_TEXTO[d.origen] || d.origen.replaceAll('_', ' '), d.campana || d.codigoWeb || d.anuncio].filter(Boolean).join(' · ');
  const quien = `${E.limpiarNombre(d.nombre) || 'Lead sin nombre'} (${de})`;
  const [tipo, titulo] = {
    sin_telefono: ['otro', `${quien}: sin teléfono válido${d.telefono ? ` («${String(d.telefono).slice(0, 30)}»)` : ''}. Contactar por email o revisar el lead`],
    telefono_fijo: ['llamar', `${quien}: ha dejado un teléfono fijo, sin WhatsApp. Llamarle`],
    baja_comercial: ['otro', `${quien} pide información, pero tiene la baja de mensajes comerciales: contactar solo si procede`],
  }[motivo];
  const [r] = await con.query('INSERT INTO tareas (tipo, titulo, paciente_id, lead_id, vence_en) VALUES (?, ?, ?, ?, ?)',
    [tipo, titulo.slice(0, 200), pacienteId || null, leadId, new Date(ahora.getTime() + 2 * 3600000)]);
  return r.insertId;
}

async function alta(con, d, trat, { inscribir, ahora }) {
  const telefono = E.normalizarTelefono(d.telefono);
  const email = E.normalizarEmail(d.email);
  const nombre = E.limpiarNombre(d.nombre);
  const tratamientoId = trat?.id || null;

  // El mismo lead otra vez (Meta repite los avisos si no le contestamos a tiempo).
  if (d.idExterno) {
    const [[ya]] = await con.query('SELECT id FROM leads WHERE origen = ? AND id_externo = ? FOR UPDATE', [d.origen, d.idExterno]);
    if (ya) return { leadId: ya.id, nuevo: false, inscrito: false, motivo: 'repetido', telefono, tratamientoId };
  }
  // Ya está en marcha con ese teléfono (o, sin teléfono, con ese email): se completa lo que falte y
  // se apunta que ha vuelto, pero ni se duplica ni se le vuelve a empezar la secuencia.
  const [[enMarcha]] = telefono
    ? await con.query("SELECT id FROM leads WHERE telefono = ? AND etapa NOT IN ('perdido','vendido') ORDER BY id DESC LIMIT 1 FOR UPDATE", [telefono])
    : email ? await con.query("SELECT id FROM leads WHERE email = ? AND etapa NOT IN ('perdido','vendido') ORDER BY id DESC LIMIT 1 FOR UPDATE", [email]) : [[null]];
  if (enMarcha) {
    await con.query('UPDATE leads SET nombre = COALESCE(nombre, ?), email = COALESCE(email, ?), tratamiento_interes_id = COALESCE(tratamiento_interes_id, ?), ctwa_clid = COALESCE(ctwa_clid, ?) WHERE id = ?',
      [nombre, email, tratamientoId, cortar(d.ctwaClid, 255), enMarcha.id]);
    await registrar(con, { tipo: 'lead_repetido', entidad: 'lead', entidadId: enMarcha.id, datos: { origen: d.origen, campana: d.campana || null, anuncio: d.anuncio || null, codigoWeb: d.codigoWeb || null } });
    return { leadId: enMarcha.id, nuevo: false, inscrito: false, motivo: 'en_marcha', telefono, tratamientoId };
  }

  const [[paciente]] = telefono ? await con.query('SELECT id, baja_comercial_en FROM pacientes WHERE telefono = ?', [telefono]) : [[null]];
  // Lo que escribió en el formulario va cifrado, como los mensajes: puede hablar de su salud.
  const resp = d.respuestas?.length ? cifrar(JSON.stringify(d.respuestas)) : { cifrado: null, iv: null, tag: null };
  const [r] = await con.query(
    `INSERT INTO leads (paciente_id, telefono, nombre, email, origen, campana, conjunto, anuncio, anuncio_id, ctwa_clid, codigo_web, utm,
                        tratamiento_interes_id, respuestas_cifradas, respuestas_iv, respuestas_tag, id_externo, ghl_contact_id, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [paciente?.id || null, telefono, nombre, email, d.origen, cortar(d.campana), cortar(d.conjunto), cortar(d.anuncio), cortar(d.anuncioId, 60),
      cortar(d.ctwaClid, 255), cortar(d.codigoWeb, 40), d.utm ? JSON.stringify(d.utm) : null, tratamientoId, resp.cifrado, resp.iv, resp.tag,
      cortar(d.idExterno, 120), d.origen === 'ghl' ? cortar(d.idExterno, 60) : null, ahora]);
  const leadId = r.insertId;

  // Quien escribe por WhatsApp (anuncio) ya está hablando con la IA: ni secuencia ni tarea.
  let motivo = null;
  let tareaId = null;
  let inscrito = false;
  if (inscribir) {
    if (!telefono) motivo = 'sin_telefono';
    else if (E.esFijoEspanol(telefono)) motivo = 'telefono_fijo';
    else if (paciente?.baja_comercial_en) motivo = 'baja_comercial';
    if (motivo) tareaId = await tareaRecepcion(con, { motivo, leadId, pacienteId: paciente?.id, d, ahora });
    else {
      await R.inscribir(con, { secuencia: 'lead', leadId, inicio: ahora });
      inscrito = true;
    }
  }
  await registrar(con, { tipo: 'lead_alta', entidad: 'lead', entidadId: leadId, datos: { origen: d.origen, tratamiento: tratamientoId, via: trat?.via || null, inscrito, motivo } });
  return { leadId, nuevo: true, inscrito, motivo, tareaId, telefono, tratamientoId };
}

/**
 * Da de alta un lead (o reconoce el que ya había).
 * @param {object} d { origen, telefono (tal cual llega), nombre, email, campana, conjunto, anuncio, anuncioId,
 *                     ctwaClid, codigoWeb, utm, idExterno, respuestas: [{ pregunta, valor }],
 *                     tratamiento: { id, respuesta, claves, textos } (ver motor/entrada/leads.js) }
 * @param {object} o { inscribir: false para quien ya está escribiendo por WhatsApp, ahora }
 * @returns {{ leadId, nuevo, inscrito, motivo, tareaId, telefono, tratamientoId }}
 */
async function altaLead(pool, d, { inscribir = true, ahora = new Date() } = {}) {
  const trat = E.resolverTratamiento({ ...(await catalogo(pool)), ...(d.tratamiento || {}) });
  // Dos altas del mismo teléfono a la vez: una espera a la otra o choca; si choca, se repite una vez
  // y entonces ya ve el lead de la otra.
  for (let intento = 1; ; intento++) {
    const con = await pool.getConnection();
    try {
      await con.beginTransaction();
      const r = await alta(con, d, trat, { inscribir, ahora });
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
