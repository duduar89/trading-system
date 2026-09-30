'use strict';
// La lista de bajas comerciales, por teléfono: quien ha pedido no recibir mensajes comerciales, sea o
// no paciente. Escriben en ella todas las vías de baja (lo escribe por WhatsApp; Meta avisa con el
// 131050 de que ha bloqueado el marketing de la clínica) y la miran el alta de leads y el permiso de
// las secuencias. Si vuelve a pedir información, no se le inscribe en nada: lo atiende recepción.

async function apuntarBaja(q, { telefono, fuente, conversacionId = null, leadId = null, pacienteId = null, ahora = new Date() }) {
  if (!telefono) return;
  await q.query('INSERT IGNORE INTO bajas_comerciales (telefono, fuente, conversacion_id, lead_id, paciente_id, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
    [telefono, String(fuente).slice(0, 40), conversacionId, leadId, pacienteId, ahora]);
}

// ¿Tiene la baja comercial ese teléfono? Por la lista o por su ficha de paciente.
async function tieneBaja(q, telefono) {
  if (!telefono) return false;
  const [[b]] = await q.query(
    `SELECT EXISTS (SELECT 1 FROM bajas_comerciales WHERE telefono = ?)
         OR EXISTS (SELECT 1 FROM pacientes WHERE telefono = ? AND baja_comercial_en IS NOT NULL) AS baja`, [telefono, telefono]);
  return Boolean(Number(b.baja));
}

module.exports = { apuntarBaja, tieneBaja };
