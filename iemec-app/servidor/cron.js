#!/usr/bin/env node
'use strict';
// Lo que se hace cada minuto. En cPanel: Cron Jobs → «* * * * *» →
//   . ~/nodevenv/iemec-app/22/bin/activate && cd ~/iemec-app && node servidor/cron.js >> ~/logs/iemec-cron.log 2>&1
// Nada de temporizadores dentro de la app: si el proceso web se duerme, esto sigue funcionando.
// Candado en la base: si un cron tarda más de un minuto, el siguiente no pisa su trabajo.
const config = require('./config');
const db = require('./db');
const cola = require('./cola');
const entrada = require('./entrada');
const agenda = require('./agenda');
const repesca = require('./repesca/motor');
const resenas = require('./resenas');
const avisos = require('./avisos-cita');
const espera = require('./avisos-espera');
const { crearIa } = require('./integraciones/ia');
const { crearWhatsApp } = require('./integraciones/whatsapp');
const T = require('../motor/tiempo');

async function vuelta({ pool = db.pool(), ahora = new Date(), deps = null } = {}) {
  const d = deps || { pool, ia: crearIa(config.modos.ia), whatsapp: crearWhatsApp(config.modos.whatsapp) };
  const informe = { rescatados: await cola.rescatarAtascados(pool, ahora) };
  const r = await cola.conCandado(pool, 'cron-minuto', 55000, async () => ({
    // Lo que ha llegado (WhatsApp, leads de Meta) va lo primero: si el paciente ha contestado, su
    // secuencia ya no le escribe, y un «sí» que llegó a tiempo cuenta antes de que caduque lo que se
    // le guardaba.
    entrada: await entrada.procesarPendientes(d, { ahora }),
    retencionesCaducadas: await agenda.caducarRetenciones(pool, ahora),
    // Los huecos que se acaban de liberar, al primero de la lista de espera que encaja. Va después de
    // leer lo que ha llegado (la entrada de WhatsApp, cuando esté): un «sí» que llegó a tiempo cuenta
    // antes de que caduque lo que se le guardaba. Aun así, lo que caduca espera un par de minutos
    // antes de pasar al siguiente.
    listaEspera: await espera.vuelta(d, { ahora }),
    seguimientos: (await repesca.procesarSeguimientos(d, { ahora })).length,
    secuencias: (await repesca.avanzarSecuencias(d, { ahora })).length,
    avisosCita: (await avisos.enviarPendientes(d, { ahora })).length,
    peticionesResena: (await resenas.enviarPeticionesPendientes(d, { ahora })).length,
    // Reseñas, solo con la base y WhatsApp: borrar lo de Google que ya tiene 29 días (en cada vuelta),
    // los recordatorios y el historial del día. Lo que llama a Google (el enlace de la ficha y publicar
    // el historial) va con las llamadas lentas a Google: resenas.vueltaGoogle, con el adaptador real.
    resenas: await resenas.vuelta(d, { ahora }),
    cola: await cola.procesar(pool, {}, { ahora }),
  }), { ahora });
  Object.assign(informe, r.ejecutado ? r.resultado : { saltado: 'otro cron en marcha' });

  // Una vez al día, a partir de las 8:00 de Madrid: conversaciones sin próximo paso → tarea.
  const p = T.partesMadrid(ahora);
  if (p.minutos >= 8 * 60) {
    await cola.unaVez(pool, `diario-${p.fecha}`, new Date(ahora.getTime() + 2 * 86400000), async () => {
      // Primero se cierran las que solo esperaban a una cita que ya pasó; lo que quede sin próximo
      // paso es trabajo de verdad.
      informe.conversacionesDeCitasPasadas = await avisos.cerrarConversacionesDeCitasPasadas(pool, ahora);
      const huerfanas = await repesca.sinProximoPaso(pool, ahora);
      for (const c of huerfanas) {
        await pool.query("INSERT INTO tareas (tipo, titulo, conversacion_id, vence_en) VALUES ('atender_conversacion', 'Conversación sin próximo paso', ?, ?)", [c.id, new Date(ahora.getTime() + 2 * 3600000)]);
      }
      informe.sinProximoPaso = huerfanas.length;
      // Los cuerpos de los webhooks, vacíos a los 30 días (lo que hacía falta ya está en su sitio).
      informe.webhooksVaciados = await entrada.purgarWebhooks(pool, ahora);
      await pool.query("DELETE FROM candados WHERE nombre LIKE 'diario-%' AND hasta < ?", [ahora]);
    });
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
