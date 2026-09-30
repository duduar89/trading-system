'use strict';
// Registro de hechos. Se escribe dentro de la misma transacción que el cambio que describe.
async function registrar(con, { tipo, entidad = null, entidadId = null, actor = 'sistema', datos = null }) {
  await con.query(
    'INSERT INTO eventos (tipo, entidad, entidad_id, actor, datos) VALUES (?, ?, ?, ?, ?)',
    [tipo, entidad, entidadId == null ? null : String(entidadId), String(actor || 'sistema').slice(0, 80), datos == null ? null : JSON.stringify(datos)]);
}

module.exports = { registrar };
