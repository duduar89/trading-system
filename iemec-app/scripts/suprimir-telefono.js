#!/usr/bin/env node
'use strict';
// Atiende una petición de supresión (RGPD, art. 17) de alguien que pidió información y no es paciente:
// borra sus leads, sus conversaciones y mensajes y sus solicitudes de la web (menos la prueba de un
// consentimiento comercial, que se queda bloqueada con lo justo) y le pone en la lista de bajas, para no
// volver a escribirle. Si es paciente no toca nada: su ficha sigue los plazos de la historia clínica.
//   node scripts/suprimir-telefono.js 611000000            → dice qué borraría (no borra nada)
//   node scripts/suprimir-telefono.js 611000000 --confirmar → lo borra
const db = require('../servidor/db');
const { suprimirTelefono } = require('../servidor/retencion');
const { normalizarTelefono } = require('../motor/entrada/leads');

async function main() {
  const [dado] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const telefono = normalizarTelefono(dado);
  if (!telefono) throw new Error('Uso: node scripts/suprimir-telefono.js <teléfono> [--confirmar]');
  const confirmar = process.argv.includes('--confirmar');
  const r = await suprimirTelefono(db.pool(), telefono, { ensayo: !confirmar });
  if (r.paciente) {
    console.log(`${telefono} es de un paciente: no se ha borrado nada. Su supresión la lleva la clínica (historia clínica, Ley 41/2002).`);
    return;
  }
  if (!confirmar) {
    console.log(`${telefono}: se borrarían ${r.leads} leads y ${r.conversaciones} conversaciones (con sus mensajes), y sus solicitudes de la web salvo la prueba de un consentimiento comercial. Para hacerlo: --confirmar`);
    return;
  }
  console.log(`✓ ${telefono}: ${r.leads} leads, ${r.conversaciones} conversaciones y ${r.solicitudes} solicitudes borrados; queda en la lista de bajas.`);
}

main()
  .catch((err) => { console.error(`✗ ${err.message}`); process.exitCode = 1; })
  .finally(() => db.cerrar());
