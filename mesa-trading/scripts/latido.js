'use strict';
// Un latido de la mesa (modo web en cPanel, docs/ARQUITECTURA-WEB.md W2).
//
//   node scripts/latido.js [--datos=carpeta] [--modo=…] [--inicio=2026-06-01T00:00Z (sintético, primer latido)]
//
// Lo lanza el crontab cada minuto: carga la configuración (.env), da UN paso
// con src/latido.js (cerrojo, orquestador desde disco, paso, guardar,
// instantánea) y luego copia los registros a la base de datos
// (src/bd/espejo.js), si ese módulo existe.
//
// - Cerrojo cogido (otro latido, un botón de la web, una mesa local): sale sin
//   hacer nada, con 0; el siguiente lo intentará.
// - La base de datos no es necesaria para operar: si la copia falla o el
//   módulo aún no existe, se apunta y se sale con 0.
// - Vigía: si el proceso pasa de 4 minutos se corta solo con código 1. Vale
//   lo guardado en el último paso completo (la recuperación tras un corte ya
//   está probada) y el cerrojo de un pid muerto lo toma el latido siguiente.
// - Plazo del LLM: todo el LLM del latido tiene que acabar MARGEN_VIGIA_MS
//   antes del vigía (src/latido.js recorta cada llamada para caber), para
//   que haya tiempo de guardar, publicar y copiar a la base.
// - Cerrojo viejo: si el latido sale omitido porque el cerrojo lleva cogido
//   más que el vigía y un margen, algo va mal (ningún latido ni botón dura
//   tanto): sale con 2, para que el cron avise, en vez de callar con 0.
// Sale con 1 si el latido falla (estado ilegible, excepción).

const path = require('path');
const { crearConfig, leerArgs } = require('../src/config');
const { latido, apuntarLatido } = require('../src/latido');
const { anadirJSONL } = require('../src/util/almacen');
const log = require('../src/util/log').crear('latido');

const VIGIA_MS = 4 * 60 * 1000;
const MARGEN_VIGIA_MS = 60_000;          // lo que queda tras el LLM para guardar, publicar y la base
const CERROJO_VIEJO_MS = VIGIA_MS + 60_000;
const CODIGO_CERROJO_VIEJO = 2;

function cargarEspejo() {
  return require('../src/bd/espejo');
}

// El temporizador NO se desengancha (unref): si el latido se queda colgado
// sin nada pendiente en el bucle, el proceso tiene que salir por aquí, con 1.
function vigia(ms, alVencer) {
  const t = setTimeout(alVencer, ms);
  return () => clearTimeout(t);
}

// Copia a la base (D). Nunca lanza: devuelve { ok, datos? , error? }.
async function copiarABase(config, cargar) {
  let espejo;
  try {
    espejo = cargar();
  } catch (e) {
    return { ok: false, omitido: true, error: `sin src/bd/espejo.js (${e.code || e.message})` };
  }
  try {
    if (!espejo || typeof espejo.sincronizar !== 'function') return { ok: false, omitido: true, error: 'src/bd/espejo.js sin sincronizar()' };
    return { ok: true, datos: await espejo.sincronizar(config) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Todo lo del script, con lo que se inyecta en las pruebas.
async function ejecutar({
  config, vigiaMs = VIGIA_MS, salir = codigo => process.exit(codigo), latidoFn = latido, espejo = cargarEspejo,
  escribir = texto => console.log(texto), opcionesLatido = {}, cerrojoViejoMs = CERROJO_VIEJO_MS,
} = {}) {
  const inicio = Date.now();
  let terminado = false;
  const quitarVigia = vigia(vigiaMs, () => {
    if (terminado) return;
    terminado = true;
    const resumen = `vigía: el latido pasó de ${Math.round(vigiaMs / 1000)} s y se corta; vale lo guardado en el último paso`;
    apuntarLatido(config, { t: inicio, inicio, ms: Date.now() - inicio, ok: false, resumen });
    log.error(resumen);
    salir(1);
  });
  let r;
  try {
    // El plazo del LLM: antes del vigía, con margen (y nunca negativo).
    const plazoLLM = inicio + Math.max(0, vigiaMs - Math.min(MARGEN_VIGIA_MS, vigiaMs / 4));
    r = await latidoFn(config, { plazoLLM, ...opcionesLatido });
  } catch (e) {
    r = { ok: false, motivo: 'error', ms: Date.now() - inicio, resumen: `error: ${e.message}` };
  }
  const bd = await copiarABase(config, espejo);
  if (!bd.ok && !bd.omitido) {
    log.aviso(`copia a la base de datos: ${bd.error}`);
    try {
      anadirJSONL(path.join(config.carpetaDatos, 'espejo-fallos.jsonl'), { t: Date.now(), error: String(bd.error).slice(0, 500) });
    } catch (_) { /* apuntado en el log */ }
  }
  quitarVigia();
  if (terminado) return null;   // el vigía ya salió
  terminado = true;
  const cerrojoViejo = !r.ok && r.motivo === 'ocupado' && Number.isFinite(r.cerrojoDesdeMs) && Date.now() - r.cerrojoDesdeMs > cerrojoViejoMs;
  const aviso = cerrojoViejo
    ? ` · CERROJO VIEJO: lleva ${Math.round((Date.now() - r.cerrojoDesdeMs) / 60_000)} min cogido; si no hay otra mesa en marcha, es un cerrojo huérfano`
    : '';
  if (cerrojoViejo) log.error(`latido omitido por un cerrojo viejo${aviso}`);
  escribir(`${r.ok ? 'Latido' : r.motivo === 'ocupado' ? 'Latido omitido' : 'Latido FALLIDO'} (${r.ms} ms): ${r.resumen}${aviso}${bd.ok ? '' : ` · base de datos: ${bd.error}`}`);
  const codigo = r.ok ? 0 : cerrojoViejo ? CODIGO_CERROJO_VIEJO : r.motivo === 'ocupado' ? 0 : 1;
  salir(codigo);
  return { codigo, latido: r, bd };
}

if (require.main === module) {
  let config;
  try {
    const args = leerArgs();
    config = crearConfig(args);
    // Sintético: el instante en que arranca el mercado inventado, solo en el
    // PRIMER latido de una carpeta (después manda el reloj guardado). Lo usan
    // las pruebas para que el caso sea siempre el mismo.
    if (args.inicio) {
      config.inicio = Date.parse(args.inicio);
      if (!Number.isFinite(config.inicio)) throw new Error(`--inicio=${args.inicio} no es una fecha`);
    }
  } catch (e) {
    console.error(`Latido: configuración inválida: ${e.message}`);
    process.exit(1);
  }
  ejecutar({ config }).catch(e => { console.error(`Latido FALLIDO: ${e.stack || e.message}`); process.exit(1); });
}

module.exports = { ejecutar, vigia, copiarABase, VIGIA_MS, MARGEN_VIGIA_MS, CERROJO_VIEJO_MS, CODIGO_CERROJO_VIEJO };
