#!/usr/bin/env node
'use strict';
// Lo que se hace cada minuto. En cPanel: Cron Jobs → «* * * * *» →
//   cd ~/iemec-app && /home/USUARIO/nodevenv/iemec-app/22/bin/node servidor/cron.js >> ~/logs/iemec-cron.log 2>&1
// Nada de temporizadores dentro de la app: si el proceso web se duerme, esto sigue funcionando.
// Candado en la base: si un cron tarda más de un minuto, el siguiente no pisa su trabajo.
const config = require('./config');
const db = require('./db');
const cola = require('./cola');
const agenda = require('./agenda');
const repesca = require('./repesca/motor');
const { crearIa } = require('./integraciones/ia');
const { crearWhatsApp } = require('./integraciones/whatsapp');
const T = require('../motor/tiempo');

async function vuelta({ pool = db.pool(), ahora = new Date(), deps = null } = {}) {
  const d = deps || { pool, ia: crearIa(config.modos.ia), whatsapp: crearWhatsApp(config.modos.whatsapp) };
  const informe = { rescatados: await cola.rescatarAtascados(pool, ahora) };
  const r = await cola.conCandado(pool, 'cron-minuto', 55000, async () => ({
    retencionesCaducadas: await agenda.caducarRetenciones(pool, ahora),
    seguimientos: (await repesca.procesarSeguimientos(d, { ahora })).length,
    secuencias: (await repesca.avanzarSecuencias(d, { ahora })).length,
    cola: await cola.procesar(pool, {}, { ahora }),
  }), { ahora });
  Object.assign(informe, r.ejecutado ? r.resultado : { saltado: 'otro cron en marcha' });

  // Una vez al día, a partir de las 8:00 de Madrid: conversaciones sin próximo paso → tarea.
  const p = T.partesMadrid(ahora);
  if (p.minutos >= 8 * 60) {
    await cola.conCandado(pool, `diario-${p.fecha}`, 24 * 3600000, async () => {
      const huerfanas = await repesca.sinProximoPaso(pool, ahora);
      for (const c of huerfanas) {
        await pool.query("INSERT INTO tareas (tipo, titulo, conversacion_id, vence_en) VALUES ('atender_conversacion', 'Conversación sin próximo paso', ?, ?)", [c.id, new Date(ahora.getTime() + 2 * 3600000)]);
      }
      informe.sinProximoPaso = huerfanas.length;
    }, { ahora, dueno: `diario-${p.fecha}` });
  }
  return informe;
}

module.exports = { vuelta };

if (require.main === module) {
  vuelta()
    .then((i) => { console.log(new Date().toISOString(), JSON.stringify(i)); })
    .catch((err) => { console.error(new Date().toISOString(), '✗', err.message); process.exitCode = 1; })
    .finally(() => db.cerrar());
}
