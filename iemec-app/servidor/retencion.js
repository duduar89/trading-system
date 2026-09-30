'use strict';
// Cuánto se guarda lo que llega pidiendo información (la web, su WhatsApp) y cómo se borra. La
// política de privacidad (web/contenido/legal/privacidad.md, §3) promete que la solicitud que no acaba
// en cita se borra a los 12 meses del último contacto y que la prueba del consentimiento comercial se
// guarda, bloqueada, hasta 3 años (LSSI, art. 45). Una vez al día (servidor/cron.js):
//   · la solicitud de la web sin verificar que nadie confirma en una semana caduca («sin_confirmar»);
//     la caducada o la que su dueño rechazó («No fui yo») se borra al mes: no es de nadie;
//   · el lead de la web o del WhatsApp de la web sin cita ni actividad en 12 meses
//     (RETENCION_LEADS_MESES) se borra con sus tareas, seguimientos y secuencias; sus conversaciones y
//     mensajes también, si ese teléfono no es de un paciente y no ha hablado con nosotros en ese tiempo;
//     y de sus eventos se quita el tratamiento y la campaña;
//   · de sus solicitudes de la web solo queda la prueba de un consentimiento comercial verificado, 3 años
//     desde el envío y con lo justo (teléfono, fecha, casillas, versión y huella): sin lo que pidió.
//     Un rechazo («No fui yo») se guarda 90 días (para no volver a escribirle) y se borra.
// suprimirTelefono(): lo mismo, en el momento, para quien pide que se borren sus datos
// (scripts/suprimir-telefono.js).
const config = require('./config');
const { cifrar } = require('./cripto');
const { registrar } = require('./eventos');

const DIA = 86400000;
const DIAS_SIN_CONFIRMAR = 7;
const DIAS_NO_ES_DE_NADIE = 30;
const DIAS_RECHAZO = 90;
const ANOS_PRUEBA = 3;
const ORIGENES = "('web','web_whatsapp')";

const mesesAtras = (ahora, meses) => {
  const d = new Date(ahora);
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d;
};

// Borra un lead y lo que cuelga de él; su prueba de consentimiento comercial (si la hay y está en plazo)
// se queda, sin lo que pidió. Sus conversaciones, si ese teléfono no es de un paciente y no ha hablado
// con nosotros desde «desde» (con desde = null, todas las suyas: lo ha pedido él).
async function borrarLead(con, lead, { ahora, desde = null }) {
  const limitePrueba = new Date(ahora.getTime() - ANOS_PRUEBA * 365 * DIA);
  await con.query(
    `UPDATE solicitudes_web SET lead_id = NULL, datos_cifrados = NULL, datos_iv = NULL, datos_tag = NULL, pagina = NULL, ref = NULL, tratamiento_id = NULL, interes = NULL
      WHERE lead_id = ? AND consentimiento_comercial = TRUE AND verificada_en IS NOT NULL AND rechazada_en IS NULL AND enviado_en > ?`, [lead.id, limitePrueba]);
  // El rechazo («No fui yo») se queda sus 90 días (ya no lleva nada de lo pedido): así no se le vuelve a escribir.
  await con.query('UPDATE solicitudes_web SET lead_id = NULL WHERE lead_id = ? AND rechazada_en IS NOT NULL', [lead.id]);
  const [sol] = await con.query('DELETE FROM solicitudes_web WHERE lead_id = ?', [lead.id]);
  await con.query('DELETE FROM seguimientos WHERE lead_id = ?', [lead.id]);
  await con.query('UPDATE ofertas_hechas SET lead_id = NULL WHERE lead_id = ?', [lead.id]);
  await con.query('UPDATE bajas_comerciales SET lead_id = NULL WHERE lead_id = ?', [lead.id]);
  await con.query(
    "UPDATE eventos SET datos = JSON_REMOVE(datos, '$.tratamiento', '$.tratamientoAnterior', '$.campana', '$.anuncio', '$.codigoWeb') WHERE entidad = 'lead' AND entidad_id = ? AND datos IS NOT NULL",
    [String(lead.id)]);
  let conversaciones = 0;
  if (lead.telefono) {
    const [[paciente]] = await con.query('SELECT id FROM pacientes WHERE telefono = ?', [lead.telefono]);
    if (!paciente) {
      // Las suyas o las de nadie (la de la confirmación de la web); las de otro lead de ese teléfono (de
      // Meta, de GHL) siguen su propio camino.
      const [convs] = await con.query(
        `SELECT id FROM conversaciones WHERE telefono = ? AND paciente_id IS NULL AND (lead_id IS NULL OR lead_id = ?)
            AND (? IS NULL OR (COALESCE(ultimo_entrante_en, creado_en) < ? AND COALESCE(ultimo_saliente_en, creado_en) < ?))`,
        [lead.telefono, lead.id, desde, desde, desde]);
      const ids = convs.map((c) => c.id);
      if (ids.length) {
        await con.query('DELETE FROM tareas WHERE conversacion_id IN (?)', [ids]);
        await con.query('DELETE FROM seguimientos WHERE conversacion_id IN (?)', [ids]);
        await con.query("DELETE FROM eventos WHERE entidad = 'conversacion' AND entidad_id IN (?)", [ids.map(String)]);
        const [r] = await con.query('DELETE FROM conversaciones WHERE id IN (?)', [ids]);
        conversaciones = r.affectedRows;
      }
    }
  }
  await con.query('DELETE FROM leads WHERE id = ?', [lead.id]);
  return { solicitudes: sol.affectedRows, conversaciones };
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

/**
 * La tarea diaria. → { caducadas, borrados, conversaciones, solicitudes, pruebas } (lo que ha hecho)
 */
async function purgarCadaDia(pool, ahora = new Date(), { meses = config.retencion.leadsMeses } = {}) {
  const informe = { caducadas: 0, borrados: 0, conversaciones: 0, solicitudes: 0, pruebas: 0 };
  // 1. Solicitudes de la web que nadie ha confirmado en una semana (sin tarea abierta: si recepción
  //    tiene que llamar, espera a que lo haga).
  const [cad] = await pool.query(
    `UPDATE leads l SET l.etapa = 'perdido', l.motivo_perdida = 'sin_confirmar'
      WHERE l.sin_verificar = TRUE AND l.etapa IN ('nuevo','contactado') AND l.creado_en < ?
        AND NOT EXISTS (SELECT 1 FROM tareas t WHERE t.lead_id = l.id AND t.estado = 'abierta')`, [new Date(ahora.getTime() - DIAS_SIN_CONFIRMAR * DIA)]);
  informe.caducadas = cad.affectedRows;
  await pool.query(
    `UPDATE inscripciones SET estado = 'cancelada', motivo_fin = 'sin confirmar' WHERE estado IN ('activa','pausada')
        AND lead_id IN (SELECT id FROM leads WHERE sin_verificar = TRUE AND etapa = 'perdido')`);

  // 2. Lo que no es de nadie (caducado o rechazado hace un mes) y los leads sin actividad en el plazo.
  const deNadie = new Date(ahora.getTime() - DIAS_NO_ES_DE_NADIE * DIA);
  const limite = mesesAtras(ahora, meses);
  const [sinDueno] = await pool.query(
    `SELECT id, telefono FROM leads WHERE sin_verificar = TRUE AND motivo_perdida IN ('sin_confirmar','no_lo_pidio') AND creado_en < ? ORDER BY id LIMIT 500`, [deNadie]);
  const [parados] = await pool.query(
    `SELECT l.id, l.telefono FROM leads l
      WHERE l.origen IN ${ORIGENES} AND l.sin_verificar = FALSE AND l.cita_id IS NULL AND l.etapa NOT IN ('cita','asistio','vendido') AND l.creado_en < ?
        AND NOT EXISTS (SELECT 1 FROM conversaciones c WHERE c.telefono = l.telefono
                         AND (c.ultimo_entrante_en >= ? OR c.ultimo_saliente_en >= ? OR c.estado <> 'cerrada'))
        AND NOT EXISTS (SELECT 1 FROM seguimientos s WHERE s.lead_id = l.id AND s.estado = 'pendiente')
        AND NOT EXISTS (SELECT 1 FROM tareas t WHERE t.lead_id = l.id AND t.estado = 'abierta')
      ORDER BY l.id LIMIT 500`, [limite, limite, limite]);
  for (const [lista, desde] of [[sinDueno, deNadie], [parados, limite]]) {
    for (const lead of lista) {
      const r = await enTransaccion(pool, (con) => borrarLead(con, lead, { ahora, desde }));
      informe.borrados++;
      informe.conversaciones += r.conversaciones;
      informe.solicitudes += r.solicitudes;
    }
  }

  // 3. Las pruebas que ya han cumplido su plazo, y los rechazos pasados los 90 días.
  const [pruebas] = await pool.query(
    'DELETE FROM solicitudes_web WHERE (lead_id IS NULL AND enviado_en < ?) OR (rechazada_en IS NOT NULL AND rechazada_en < ?)',
    [new Date(ahora.getTime() - ANOS_PRUEBA * 365 * DIA), new Date(ahora.getTime() - DIAS_RECHAZO * DIA)]);
  informe.pruebas = pruebas.affectedRows;
  if (informe.borrados || informe.pruebas) await registrar(pool, { tipo: 'retencion_leads', actor: 'cron', datos: informe });
  return informe;
}

/**
 * Quien pide que se borren sus datos (RGPD, art. 17): todo lo que llegó de él pidiendo información
 * (leads de cualquier origen, sus conversaciones y mensajes, sus solicitudes de la web salvo la prueba
 * del consentimiento comercial, que se queda bloqueada) y a la lista de bajas, para no volver a
 * escribirle. Si es paciente, no se toca: su ficha sigue los plazos de la historia clínica y la
 * supresión la lleva la clínica.
 * @returns {Promise<{ paciente: boolean, leads: number, conversaciones: number, solicitudes: number }>}
 */
async function suprimirTelefono(pool, telefono, { ahora = new Date(), ensayo = false } = {}) {
  const [[paciente]] = await pool.query('SELECT id FROM pacientes WHERE telefono = ?', [telefono]);
  if (paciente) return { paciente: true, leads: 0, conversaciones: 0, solicitudes: 0 };
  const [leads] = await pool.query('SELECT id, telefono FROM leads WHERE telefono = ?', [telefono]);
  const [[convs]] = await pool.query('SELECT COUNT(*) AS n FROM conversaciones WHERE telefono = ?', [telefono]);
  if (ensayo) return { paciente: false, leads: leads.length, conversaciones: Number(convs.n), solicitudes: 0, ensayo: true };
  const informe = { paciente: false, leads: 0, conversaciones: 0, solicitudes: 0 };
  await enTransaccion(pool, async (con) => {
    for (const lead of leads) {
      const r = await borrarLead(con, lead, { ahora, desde: null });
      informe.leads++;
      informe.conversaciones += r.conversaciones;
      informe.solicitudes += r.solicitudes;
    }
    // Las conversaciones de ese teléfono que no eran de ningún lead.
    const [resto] = await con.query('SELECT id FROM conversaciones WHERE telefono = ?', [telefono]);
    if (resto.length) {
      const ids = resto.map((c) => c.id);
      await con.query('DELETE FROM tareas WHERE conversacion_id IN (?)', [ids]);
      await con.query('DELETE FROM seguimientos WHERE conversacion_id IN (?)', [ids]);
      await con.query("DELETE FROM eventos WHERE entidad = 'conversacion' AND entidad_id IN (?)", [ids.map(String)]);
      const [r] = await con.query('DELETE FROM conversaciones WHERE id IN (?)', [ids]);
      informe.conversaciones += r.affectedRows;
    }
    // Sus solicitudes sin lead (si las hay) que no sean la prueba de un consentimiento comercial.
    const [sol] = await con.query(
      'DELETE FROM solicitudes_web WHERE telefono = ? AND NOT (consentimiento_comercial = TRUE AND verificada_en IS NOT NULL AND rechazada_en IS NULL)', [telefono]);
    informe.solicitudes += sol.affectedRows;
    await con.query('UPDATE solicitudes_web SET datos_cifrados = NULL, datos_iv = NULL, datos_tag = NULL, lead_id = NULL WHERE telefono = ?', [telefono]);
    await con.query("INSERT IGNORE INTO bajas_comerciales (telefono, fuente, creado_en) VALUES (?, 'supresion', ?)", [telefono, ahora]);
    await registrar(con, { tipo: 'supresion_datos', actor: 'script', datos: { leads: informe.leads, conversaciones: informe.conversaciones } });
  });
  return informe;
}

// Paso de la migración 017 (servidor/migraciones.js): las solicitudes guardadas con la 015 llevaban la
// página, la referencia, el tratamiento y el interés en claro; pasan a lo cifrado. Si no queda ninguna,
// no hace nada.
async function cifrarSolicitudesAntiguas(con, { log = () => {} } = {}) {
  const [filas] = await con.query(
    `SELECT id, pagina, ref, tratamiento_id, interes, preferencia FROM solicitudes_web
      WHERE datos_cifrados IS NULL AND rechazada_en IS NULL AND (pagina IS NOT NULL OR ref IS NOT NULL OR tratamiento_id IS NOT NULL OR interes IS NOT NULL)`);
  for (const f of filas) {
    const c = cifrar(JSON.stringify({ pagina: f.pagina, ref: f.ref, tratamiento: f.tratamiento_id, interes: f.interes, preferencia: f.preferencia }));
    await con.query('UPDATE solicitudes_web SET datos_cifrados = ?, datos_iv = ?, datos_tag = ?, pagina = NULL, ref = NULL, tratamiento_id = NULL, interes = NULL WHERE id = ?',
      [c.cifrado, c.iv, c.tag, f.id]);
  }
  if (filas.length) log(`  ${filas.length} solicitudes de la web cifradas`);
  return filas.length;
}

module.exports = { purgarCadaDia, suprimirTelefono, cifrarSolicitudesAntiguas, borrarLead };
