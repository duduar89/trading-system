'use strict';
// La casilla comercial del formulario de la web («Quiero recibir comunicaciones comerciales…»). Cuenta
// solo si la solicitud está verificada (quien tiene ese teléfono contestó «Sí, fui yo» al WhatsApp de
// confirmación, o recepción lo confirmó llamándole), no la rechazó («No fui yo») y la versión de los
// textos es una de las que publicó la web: si no, cualquiera podría apuntar a otro a la publicidad de
// la clínica. Sin ella, a un lead solo se le escribe para contestar a lo que pidió (motor de la
// repesca: permisoComercial).
//
// Cuando esa persona tiene ficha de paciente (ya la tenía, o la tiene al reservar), el consentimiento
// pasa a la tabla consentimientos, que es lo que mira la repesca para los pacientes: WhatsApp y correo,
// otorgado, fuente «web», con la prueba (la solicitud, su fecha, la versión de los textos y su huella)
// y la fecha del envío. Una baja posterior manda (la lista de bajas y la ficha se miran antes).

// Lo que dijo en su última solicitud verificada: si marcó la casilla (con una versión de los textos que
// la web publicó), sí. Manda la última: es lo más reciente que ha dicho (y una solicitud anterior de
// otra persona con su teléfono no le apunta a la publicidad aunque él confirme la suya).
async function consentimientoWeb(q, telefono) {
  if (!telefono) return { otorgado: false, solicitud: null };
  const [[s]] = await q.query(
    `SELECT id, enviado_en, version_textos, version_conocida, huella_envio, consentimiento_comercial FROM solicitudes_web
      WHERE telefono = ? AND verificada_en IS NOT NULL AND rechazada_en IS NULL
      ORDER BY enviado_en DESC, id DESC LIMIT 1`, [telefono]);
  const otorgado = Boolean(s?.consentimiento_comercial) && Boolean(s?.version_conocida);
  return { otorgado, solicitud: otorgado ? s : null };
}

const pruebaDe = (s) => `Formulario de la web: solicitud n.º ${s.id}, ${new Date(s.enviado_en).toISOString()}, versión de los textos ${s.version_textos}, huella ${String(s.huella_envio).slice(0, 16)}`;

/**
 * Lleva a su ficha el consentimiento comercial que dio en la web (si lo dio y no se dio de baja después).
 * @returns {Promise<{ aplicado: boolean, trasLaBaja: boolean }>} trasLaBaja: lo marcó después de darse de
 *   baja: la baja sigue (la quita dirección, si procede) y lo dice una tarea.
 */
async function aplicarConsentimientoWeb(q, { pacienteId, telefono }) {
  if (!pacienteId || !telefono) return { aplicado: false, trasLaBaja: false };
  const { solicitud: s } = await consentimientoWeb(q, telefono);
  if (!s) return { aplicado: false, trasLaBaja: false };
  const enviado = new Date(s.enviado_en);
  // Una baja posterior (de la lista o de su ficha) manda: ese consentimiento ya no vale.
  const [[lista]] = await q.query('SELECT MAX(creado_en) AS en FROM bajas_comerciales WHERE telefono = ?', [telefono]);
  const [[ficha]] = await q.query('SELECT baja_comercial_en AS en FROM pacientes WHERE id = ?', [pacienteId]);
  const bajas = [lista?.en, ficha?.en].filter(Boolean).map((d) => new Date(d));
  const baja = bajas.length ? new Date(Math.max(...bajas.map((d) => d.getTime()))) : null;
  if (baja && baja >= enviado) return { aplicado: false, trasLaBaja: false };
  const prueba = pruebaDe(s);
  let aplicado = false;
  for (const tipo of ['whatsapp_marketing', 'email_marketing']) {
    const [[ya]] = await q.query("SELECT id FROM consentimientos WHERE paciente_id = ? AND tipo = ? AND fuente = 'web' AND prueba = ? LIMIT 1", [pacienteId, tipo, prueba]);
    if (ya) continue;
    await q.query("INSERT INTO consentimientos (paciente_id, tipo, estado, fuente, prueba, registrado_en, registrado_por) VALUES (?, ?, 'otorgado', 'web', ?, ?, 'formulario de la web')",
      [pacienteId, tipo, prueba, enviado]);
    aplicado = true;
  }
  return { aplicado, trasLaBaja: Boolean(baja) };
}

module.exports = { consentimientoWeb, aplicarConsentimientoWeb };
