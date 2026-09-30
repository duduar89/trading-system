'use strict';
// El Megáfono en modo web (ARQUITECTURA-WEB W3): la interpretación con el LLM
// tarda (hasta decenas de segundos) y NO se hace con el cerrojo de la mesa
// cogido, o el latido de ese minuto se saltaría. Se interpreta fuera, con lo
// que hay en disco, y luego se toma el cerrojo solo para guardar la propuesta:
// orq.comando('megafono', { texto }, { interpretacion }) (la interpretación
// va aparte de los datos: el cuerpo de una petición nunca la alcanza).
//
// Lo que hace falta para interpretar sale del disco, sin tocarlo:
// - mesas y directivas, del estado guardado (data/estado.json, escritura atómica);
// - el universo, el de la mesa según sus claves, recortado a los activos que
//   cotizan en la instantánea (lo mismo que hace el orquestador con datos.disponible);
// - el LLM con el presupuesto y los modelos de Ajustes (estado.ajustes), que
//   apunta su coste en llm-costes.jsonl como siempre;
// - el reloj de la mesa: el real, o en sintético el guardado en el estado.
//
// Los números no los decide el LLM: megafono.interpretar valida cada directiva
// contra la lista cerrada y el orquestador vuelve a pasarla por las reglas al
// aplicarla.

const path = require('path');
const megafono = require('../agentes/megafono');
const { crearLLM } = require('../agentes/llm');
const universoMod = require('../mercado/universo');
const { RelojReal, RelojSimulado } = require('../util/reloj');
const { leerJSON } = require('../util/almacen');

function contextoDesdeDisco(config, instantanea) {
  const estado = leerJSON(path.join(config.carpetaDatos, 'estado.json'), null) || {};
  const hayAlpaca = Boolean(config.alpaca && config.alpaca.hay);
  const cotizan = new Set(((instantanea && instantanea.cotizaciones) || []).map(c => c.simbolo));
  let universo = universoMod.disponibles({ hayAlpaca });
  if (cotizan.size) universo = universo.filter(a => cotizan.has(a.simbolo));
  const sintetico = config.modo === 'sintetico';
  const reloj = sintetico && Number.isFinite(estado.ahora) ? new RelojSimulado(estado.ahora) : new RelojReal();
  return {
    estado,
    universo,
    mesas: Array.isArray(estado.mesas) ? estado.mesas : ((instantanea && instantanea.mesas) || []),
    directivas: estado.directivas || megafono.directivasVacias(),
    reloj,
  };
}

function llmDesdeConfig(config, estado, reloj) {
  const llm = crearLLM({
    apiKey: config.llm.apiKey, modeloComite: config.llm.modeloComite, modeloAgentes: config.llm.modeloAgentes,
    presupuestoDiaUsd: config.llm.presupuestoDiaUsd, reloj, rutaCostes: path.join(config.carpetaDatos, 'llm-costes.jsonl'),
  });
  const a = (estado && estado.ajustes) || {};
  try {
    if (a.presupuestoDiaUsd !== undefined && llm.fijarPresupuesto) llm.fijarPresupuesto(a.presupuestoDiaUsd);
    if ((a.modeloComite || a.modeloAgentes) && llm.fijarModelos) llm.fijarModelos({ modeloComite: a.modeloComite, modeloAgentes: a.modeloAgentes });
  } catch (_) { /* ajustes no aplicables: los del .env */ }
  return llm;
}

// → { directivas, explicacion, fuente, costeUsd? } (lo mismo que megafono.interpretar).
async function interpretarFuera({ config, texto, instantanea, llm = null }) {
  const ctx = contextoDesdeDisco(config, instantanea);
  const modelo = llm || llmDesdeConfig(config, ctx.estado, ctx.reloj);
  return megafono.interpretar(texto, {
    llm: modelo, universo: ctx.universo, mesas: ctx.mesas, directivas: ctx.directivas, ahora: ctx.reloj.ahora(),
    horasPorDefecto: config.cadencias && config.cadencias.comiteHoras,
  });
}

module.exports = { interpretarFuera, contextoDesdeDisco };
