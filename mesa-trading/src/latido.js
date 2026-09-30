'use strict';
// Motor por latido (docs/ARQUITECTURA-WEB.md W2): la mesa en el cPanel no
// vive en un proceso continuo. El cron lanza scripts/latido.js cada minuto y
// cada latido es un proceso nuevo que toma el cerrojo de la carpeta de datos,
// reconstruye el orquestador desde disco, da UN paso, guarda, publica la
// instantánea y sale. Los botones de la web hacen lo mismo con su comando.
//
//   conLaMesa(config, fn, { espera, motivo })  → { ok: true, resultado } | { ok: false, motivo: 'ocupado'|'error', detalle }
//   latido(config)                             → { ok, ms, resumen }
//   publicarInstantanea(config, orquestador)   → escribe data/instantanea.json
//
// Reglas:
// - El cerrojo es el mismo data/.proceso del modo local (src/util/proceso.js,
//   flag 'wx'): nunca actúan a la vez un latido, un botón y una mesa local.
//   Dentro de un mismo proceso (la web atiende dos peticiones a la vez) lo
//   guarda además un registro en memoria, porque tomarBloqueo deja volver a
//   entrar al mismo pid.
// - El cerrojo se suelta SIEMPRE (finally). Si fn lanza, no se guarda: vale
//   el estado.json del último paso completo (como tras un corte).
// - En sintético cada latido avanza 5 min de reloj simulado; un comando no
//   mueve el reloj.
// - El laboratorio corre fuera (scripts/laboratorio.js) y deja su resultado
//   en data/laboratorio-resultado.json; el latido siguiente lo incorpora al
//   estado bajo el cerrojo y, ya guardado, borra el fichero.
// - Date.now() aquí es solo infraestructura (cuánto tarda un latido, cuándo se
//   publicó la instantánea); la lógica usa el reloj de la mesa.

const fs = require('fs');
const path = require('path');
const { construir, PASO_SINTETICO } = require('./index');
const { tomarBloqueo, soltarBloqueo } = require('./util/proceso');
const { escribirJSON, anadirJSONL, leerJSON } = require('./util/almacen');
const laboratorio = require('./agentes/departamentos/laboratorio');
const { MIN } = require('./util/reloj');
const log = require('./util/log').crear('latido');

const REINTENTO_MS = 250;
// El LLM en el modo latido (W2: «el comité cabe en un latido, tope de 45 s
// para la llamada»). Sin reintentos: cada intento cortado se cobra y no hay
// tiempo para dos. Además, todo el LLM del proceso tiene un plazo: por
// defecto PLAZO_LLM_MS desde que se toma el cerrojo; scripts/latido.js lo
// ajusta a su vigía. Así noticias, comité y auditor juntos nunca pasan del
// vigía, que mataría el proceso sin guardar ni apuntar lo gastado.
const LLM_LATIDO = Object.freeze({ limiteLlamadaMs: 45_000, reintentos: 0 });
const PLAZO_LLM_MS = 150_000;
const SALA_TRAS_COMITE_MS = 5 * MIN;
const MAX_RESUMEN = 255;
const FICHEROS = {
  instantanea: 'instantanea.json',
  latidos: 'latidos.jsonl',
  laboratorio: 'laboratorio-resultado.json',
};

// Carpetas con un conLaMesa en marcha en ESTE proceso.
const enUso = new Set();

const dormir = ms => new Promise(r => setTimeout(r, ms));
const ruta = (config, nombre) => path.join(config.carpetaDatos, FICHEROS[nombre]);

// Opciones del orquestador en el modo latido (ver el constructor de Orquestador).
function opcionesLatido(config) {
  return {
    latido: true,
    laboratorioFuera: true,
    comiteEnSegundoPlano: false,    // el comité cabe en el latido (LLM_LATIDO: tope de 45 s y plazo del proceso)
    pausaComiteMs: 0,               // sin pausas de pantalla...
    salaTrasComiteMs: SALA_TRAS_COMITE_MS,   // ...los jefes se ven en la sala 5 min tras la reunión
    descansoMinPantallaMs: 0,
    guardarCadaPasos: 1,
    intervaloEstadoMs: 0,
    latidoMs: (config.cadencias && config.cadencias.latidoMs) || 60_000,
  };
}

function intentarTomar(carpeta) {
  if (enUso.has(carpeta)) return { ok: false, detalle: 'La mesa está ocupada por otra orden de este mismo proceso.' };
  try {
    tomarBloqueo(carpeta);
  } catch (e) {
    if (e.code === 'EBLOQUEO') {
      const desdeMs = e.dueno && e.dueno.desde ? Date.parse(e.dueno.desde) : NaN;
      return { ok: false, detalle: e.message, ...(Number.isFinite(desdeMs) ? { desdeMs } : {}) };
    }
    throw e;
  }
  enUso.add(carpeta);
  return { ok: true };
}

function soltar(carpeta) {
  enUso.delete(carpeta);
  soltarBloqueo(carpeta);
}

// Toma el cerrojo (con espera máxima `espera` ms, reintentando cada 250 ms),
// construye las piezas y el orquestador desde disco, ejecuta fn(orquestador,
// piezas), espera sus tareas de fondo, guarda, publica la instantánea y suelta
// el cerrojo. `llm` y `reloj` se pueden inyectar (pruebas); `clienteLLM` es el
// cliente de la API que usa el crearLLM del latido (pruebas); `plazoLLM`, el
// instante (Date.now()) en que tiene que haber acabado todo el LLM.
// «ocupado» trae `desdeMs`: desde cuándo tiene el cerrojo su dueño.
async function conLaMesa(config, fn, { espera = 0, motivo, llm, reloj, clienteLLM, plazoLLM } = {}) {
  const carpeta = path.resolve(config.carpetaDatos);
  const t0 = Date.now();
  for (;;) {
    let toma;
    try {
      toma = intentarTomar(carpeta);
    } catch (e) {
      return { ok: false, motivo: 'error', detalle: `No se pudo tomar el cerrojo de ${carpeta}: ${e.message}` };
    }
    if (toma.ok) break;
    const queda = espera - (Date.now() - t0);
    if (queda <= 0) return { ok: false, motivo: 'ocupado', detalle: toma.detalle, ...(toma.desdeMs ? { desdeMs: toma.desdeMs } : {}) };
    await dormir(Math.min(REINTENTO_MS, queda));
  }
  let orq = null;
  let completo = false;
  try {
    const hasta = Number.isFinite(plazoLLM) ? plazoLLM : Date.now() + PLAZO_LLM_MS;
    const llmOpciones = { ...LLM_LATIDO, plazo: () => hasta, ...(clienteLLM ? { cliente: clienteLLM } : {}) };
    const piezas = construir({ ...config, carpetaDatos: carpeta }, { opciones: opcionesLatido(config), llm, reloj, llmOpciones });
    orq = piezas.orquestador;
    await orq.iniciar();
    await orq.esperarTareas();
    const resultado = await fn(orq, piezas);
    await orq.esperarTareas();
    orq.guardar();
    completo = true;
    try {
      publicarInstantanea({ ...config, carpetaDatos: carpeta }, orq);
    } catch (e) {
      // El estado ya está guardado: sin instantánea la web enseña la anterior
      // y el latido siguiente la vuelve a escribir.
      log.error(`instantánea sin publicar: ${e.message}`);
    }
    return { ok: true, resultado };
  } catch (e) {
    log.error(`${motivo || 'conLaMesa'}: ${e.message}`);
    return { ok: false, motivo: 'error', detalle: e.message };
  } finally {
    if (orq) {
      try { await orq.cerrar({ guardar: false }); } catch (e) { log.error(`al cerrar: ${e.message}`); }
    }
    soltar(carpeta);
    if (!completo && orq) log.aviso('vale el estado guardado en el último paso completo');
  }
}

// data/instantanea.json (escritura atómica) con la marca de publicación.
function publicarInstantanea(config, orquestador) {
  escribirJSON(ruta(config, 'instantanea'), { ...orquestador.instantanea(), publicada: Date.now() });
}

// El resultado del laboratorio fuera de banda, si lo hay: se incorpora al
// estado (una sola vez por id). Devuelve { id, hipotesis } o null.
function incorporarLaboratorio(config, orquestador) {
  const r = leerJSON(ruta(config, 'laboratorio'), null);
  if (!r || !r.id) return null;
  const n = laboratorio.incorporarResultado(orquestador, r);
  return { id: r.id, hipotesis: n };
}

// Tras guardar el estado con el resultado dentro, el fichero sobra. Solo se
// borra si sigue siendo el mismo resultado.
function borrarResultadoLaboratorio(config, id) {
  const r = ruta(config, 'laboratorio');
  const actual = leerJSON(r, null);
  if (actual && actual.id === id) {
    try { fs.unlinkSync(r); } catch (e) { if (e.code !== 'ENOENT') log.aviso(`no se pudo borrar ${r}: ${e.message}`); }
  }
}

function apuntarLatido(config, registro) {
  try {
    anadirJSONL(ruta(config, 'latidos'), registro);
  } catch (e) {
    log.error(`latido sin apuntar: ${e.message}`);
  }
}

function resumenDe(orq, lab) {
  const e = orq.estado;
  const partes = [
    new Date(orq.reloj.ahora()).toISOString().slice(0, 16).replace('T', ' '),
    `nivel ${e.fondo.nivel}`,
    `patrimonio ${Math.round(orq.vivo.patrimonio)} $`,
    `${(orq.vivo.posicionesBroker || []).length} posiciones`,
  ];
  if (lab && lab.hipotesis) partes.push(`laboratorio: ${lab.hipotesis} hipótesis incorporadas`);
  return partes.join(' · ');
}

// Un latido: laboratorio pendiente → (sintético: +5 min) → paso(). Se apunta
// en data/latidos.jsonl, que D copia a mesa_latidos.
async function latido(config, { llm, reloj, clienteLLM, plazoLLM } = {}) {
  const inicio = Date.now();
  const r = await conLaMesa(config, async orq => {
    const lab = incorporarLaboratorio(config, orq);
    if (orq.modo === 'sintetico') orq.reloj.avanzar(PASO_SINTETICO);
    const hecho = await orq.paso();
    return { lab, hecho, resumen: resumenDe(orq, lab) };
  }, { espera: 0, motivo: 'latido', llm, reloj, clienteLLM, plazoLLM });
  if (r.ok && r.resultado.lab) borrarResultadoLaboratorio(config, r.resultado.lab.id);
  const ms = Date.now() - inicio;
  const resumen = String(r.ok ? r.resultado.resumen : `${r.motivo}: ${r.detalle || ''}`).slice(0, MAX_RESUMEN);
  apuntarLatido(config, { t: inicio, inicio, ms, ok: r.ok, resumen });
  return { ok: r.ok, ms, resumen, ...(r.ok ? {} : { motivo: r.motivo }), ...(r.desdeMs ? { cerrojoDesdeMs: r.desdeMs } : {}) };
}

module.exports = {
  conLaMesa, latido, publicarInstantanea, opcionesLatido, incorporarLaboratorio, borrarResultadoLaboratorio, apuntarLatido,
  FICHEROS, SALA_TRAS_COMITE_MS, LLM_LATIDO, PLAZO_LLM_MS,
};
