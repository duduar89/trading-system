'use strict';
// Informes de lectura para las vistas del panel (src/servidor.js en local y
// src/web/servidor-web.js con sesión). Una sola entrada para los dos
// servidores: así la vista ve lo mismo en el portátil y en la web.
//
//   GET /api/noticias?desde=&limite=&simbolo=&graves=1
//   GET /api/historial?desde=&limite=&puntos=
//   GET /api/estrategias
//   GET /api/laboratorio
//
// Sin `simbolo`, `graves` ni `puntos`, noticias e historial responden
// exactamente lo de siempre (registros.consultar, §7). Nunca lanza: un
// registro roto o que no existe da una lista vacía.

const lectores = require('./lectores');
const { estrategias } = require('./estrategias');
const { laboratorio } = require('./laboratorio');

const FUENTES = Object.freeze(['noticias', 'historial', 'decisiones', 'estrategias', 'laboratorio']);

// `instantanea`: función que devuelve la instantánea (§7) o null; solo se
// llama para estrategias y laboratorio.
function consultar(fuente, { carpeta, params, instantanea } = {}) {
  try {
    if (fuente === 'noticias') return lectores.noticias(carpeta, params);
    if (fuente === 'historial') return lectores.historial(carpeta, params);
    if (fuente === 'decisiones') return lectores.decisiones(carpeta, params);
    const inst = typeof instantanea === 'function' ? instantanea() : instantanea;
    if (fuente === 'estrategias') return estrategias({ instantanea: inst, carpeta });
    if (fuente === 'laboratorio') return laboratorio({ instantanea: inst, carpeta });
  } catch (e) {
    const error = `No se pudo preparar el informe: ${e.message}`;
    if (fuente === 'estrategias') return { t: null, resumen: null, mesas: [], error };
    if (fuente === 'laboratorio') return { t: null, ensayosTotales: null, resumen: null, puertas: [], hipotesis: [], contratadas: [], error };
    return [];
  }
  return null;
}

module.exports = { consultar, FUENTES };
