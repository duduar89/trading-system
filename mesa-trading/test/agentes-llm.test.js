'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const {
  crearLLM, costeDeUso, validarEsquema, esquemaParaApi, construirPeticion, estimarCosteMaximo, tarifaDe,
  reservaSalvavidas, reservaMaxima, timeoutPara,
} = require('../src/agentes/llm');
const { RelojSimulado, DIA, diaUTC } = require('../src/util/reloj');
const { leerJSONL } = require('../src/util/almacen');
const { mensaje, fetchFalso, carpetaTemporal, relojFijo } = require('./agentes-ayuda');

const T0 = Date.UTC(2026, 8, 29, 12, 0, 0);
const ESQUEMA = {
  type: 'object',
  properties: { modo: { type: 'string', enum: ['NORMAL', 'DEFENSIVO'] }, razon: { type: 'string', maxLength: 200 } },
  required: ['modo', 'razon'],
  additionalProperties: false,
};
const PETICION = {
  proposito: 'prueba',
  sistema: 'Eres la presidenta del comité.',
  entrada: { patrimonio: 100000, caida: -0.02 },
  instrucciones: 'Decide el modo.',
  esquema: ESQUEMA,
};
const BUENO = JSON.stringify({ modo: 'NORMAL', razon: 'Sin alertas.' });

function llmCon(respuestas, opciones = {}) {
  const fetch = fetchFalso(respuestas);
  const llm = crearLLM({ apiKey: 'sk-prueba', reloj: relojFijo(T0), presupuestoDiaUsd: 5, fetch, ...opciones });
  return { llm, fetch };
}

test('sin clave: inactivo, todo devuelve sin_clave y no hay red', async () => {
  let llamadas = 0;
  const llm = crearLLM({ apiKey: '', fetch: async () => { llamadas++; throw new Error('no debería llamar'); } });
  assert.equal(llm.activo, false);
  const r = await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'sin_clave');
  assert.equal(llamadas, 0);
  assert.equal(llm.gastoHoy(), 0);
  assert.equal(llm.estado().activo, false);
});

test('opus-5-5 (comité): cuerpo exacto con beta, fallbacks, effort medium, formato y caché', async () => {
  const { llm, fetch } = llmCon(mensaje({ texto: BUENO }));
  const r = await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  assert.equal(r.ok, true, r.detalle);
  assert.deepEqual(r.datos, { modo: 'NORMAL', razon: 'Sin alertas.' });
  const { url, cabeceras, cuerpo } = fetch.llamadas[0];
  assert.match(url, /\/v1\/messages\?beta=true$/);
  assert.equal(cabeceras['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.deepEqual(cuerpo, {
    model: 'claude-opus-5-5',
    max_tokens: 2000,
    fallbacks: 'default',
    output_config: {
      effort: 'medium',
      format: {
        type: 'json_schema',
        // maxLength no lo admite la API: se quita al enviar (y se valida en local).
        schema: {
          type: 'object',
          properties: { modo: { type: 'string', enum: ['NORMAL', 'DEFENSIVO'] }, razon: { type: 'string' } },
          required: ['modo', 'razon'],
          additionalProperties: false,
        },
      },
    },
    system: [{ type: 'text', text: 'Eres la presidenta del comité.', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'Decide el modo.\n\nDatos (JSON):\n{"patrimonio":100000,"caida":-0.02}' }],
  });
  assert.equal('thinking' in cuerpo, false);
  assert.equal('temperature' in cuerpo, false);
});

test('opus-5-5 (agentes): esfuerzo low por defecto y el explícito manda', async () => {
  const { llm, fetch } = llmCon(mensaje({ texto: BUENO }));
  await llm.pedirJSON({ ...PETICION, uso: 'agentes' });
  assert.equal(fetch.llamadas[0].cuerpo.output_config.effort, 'low');
  await llm.pedirJSON({ ...PETICION, uso: 'agentes', esfuerzo: 'high' });
  assert.equal(fetch.llamadas[1].cuerpo.output_config.effort, 'high');
  await llm.pedirJSON({ ...PETICION, uso: 'agentes', esfuerzo: 'turbo' });
  assert.equal(fetch.llamadas[2].cuerpo.output_config.effort, 'low');
});

test('haiku-4-5: endpoint estable, sin effort, sin fallbacks ni betas', async () => {
  const { llm, fetch } = llmCon(mensaje({ texto: BUENO, model: 'claude-haiku-4-5' }), { modeloAgentes: 'claude-haiku-4-5' });
  const r = await llm.pedirJSON({ ...PETICION, uso: 'agentes', maxTokens: 800 });
  assert.equal(r.ok, true, r.detalle);
  const { url, cabeceras, cuerpo } = fetch.llamadas[0];
  assert.match(url, /\/v1\/messages$/);
  assert.equal(cabeceras['anthropic-beta'], undefined);
  assert.deepEqual(Object.keys(cuerpo).sort(), ['max_tokens', 'messages', 'model', 'output_config', 'system']);
  assert.equal(cuerpo.model, 'claude-haiku-4-5');
  assert.equal(cuerpo.max_tokens, 800);
  assert.deepEqual(Object.keys(cuerpo.output_config), ['format']);
  assert.equal(cuerpo.system[0].cache_control.type, 'ephemeral');
});

test('los cuatro modelos con salvavidas van por beta; el resto no', () => {
  for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']) {
    assert.equal(construirPeticion({ modelo: m, maxTokens: 10, esfuerzo: 'low', sistema: 's', contenido: 'c', esquema: {} }).via, 'beta', m);
  }
  for (const m of ['claude-haiku-4-5', 'claude-opus-4-8', 'claude-sonnet-4-6']) {
    const p = construirPeticion({ modelo: m, maxTokens: 10, esfuerzo: 'low', sistema: 's', contenido: 'c', esquema: {} });
    assert.equal(p.via, 'estable', m);
    assert.equal('effort' in p.cuerpo.output_config, false);
    assert.equal('fallbacks' in p.cuerpo, false);
  }
});

test('config por defecto (30-sep-2026): comité en Opus 5.5 con su forma, agentes en Haiku 4.5 sin effort ni salvavidas, tope 1 $/día', async () => {
  const { crearConfig } = require('../src/config');
  // Vacías ganan al .env (cargarEnv no pisa lo definido) y dan el valor por defecto.
  const claves = ['LLM_MODELO_COMITE', 'LLM_MODELO_AGENTES', 'LLM_PRESUPUESTO_DIA_USD'];
  const antes = Object.fromEntries(claves.map(k => [k, process.env[k]]));
  for (const k of claves) process.env[k] = '';
  let c;
  try { c = crearConfig({ modo: 'sintetico' }); } finally {
    for (const k of claves) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
  }
  assert.deepEqual({ ...c.llm, apiKey: undefined }, { apiKey: undefined, modeloComite: 'claude-opus-5-5', modeloAgentes: 'claude-haiku-4-5', presupuestoDiaUsd: 1 });
  const { llm, fetch } = llmCon([mensaje({ texto: BUENO, model: 'claude-haiku-4-5' }), mensaje({ texto: BUENO })],
    { modeloComite: c.llm.modeloComite, modeloAgentes: c.llm.modeloAgentes, presupuestoDiaUsd: c.llm.presupuestoDiaUsd });
  assert.equal((await llm.pedirJSON({ ...PETICION, uso: 'agentes' })).ok, true);
  const agentes = fetch.llamadas[0];
  assert.match(agentes.url, /\/v1\/messages$/);
  assert.equal(agentes.cabeceras['anthropic-beta'], undefined);
  assert.equal(agentes.cuerpo.model, 'claude-haiku-4-5');
  assert.deepEqual(Object.keys(agentes.cuerpo.output_config), ['format']);
  assert.equal('fallbacks' in agentes.cuerpo, false);
  assert.equal((await llm.pedirJSON({ ...PETICION, uso: 'comite' })).ok, true);
  const comite = fetch.llamadas[1];
  assert.equal(comite.cuerpo.model, 'claude-opus-5-5');
  assert.equal(comite.cuerpo.output_config.effort, 'medium');
  assert.equal(comite.cuerpo.fallbacks, 'default');
  assert.equal(llm.estado().presupuestoDiaUsd, 1);
  // Haiku 4.5 está en la tabla con su tarifa (1/5/0,10/1,25 $ por MTok), no en la de «desconocido».
  assert.equal(tarifaDe('claude-haiku-4-5').conocida, true);
  assert.deepEqual({ ...tarifaDe('claude-haiku-4-5').tarifa }, { entrada: 1, salida: 5, cacheLectura: 0.10, cacheEscritura: 1.25 });
});

test('gastoTotal: todo lo apuntado en llm-costes.jsonl (no solo los últimos días) más lo de la sesión', async () => {
  const dir = carpetaTemporal();
  const rutaCostes = path.join(dir, 'llm-costes.jsonl');
  // Uno de hace 400 días, fuera del historial de 8 días de gastoEntre, cuenta igual.
  fs.writeFileSync(rutaCostes, `${JSON.stringify({ t: T0 - 400 * DIA, costeUsd: 0.5 })}\n${JSON.stringify({ t: T0 - DIA, costeUsd: 0.25 })}\n`);
  const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const llm = crearLLM({ apiKey: 'sk-prueba', reloj: relojFijo(T0), presupuestoDiaUsd: 5, fetch: fetchFalso(mensaje({ texto: BUENO, usage })), rutaCostes });
  assert.ok(Math.abs(llm.gastoTotal() - 0.75) < 1e-12);
  await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  // opus-5-5: 1000·4 + 500·20 = 14.000 $/MTok → 0,014 $.
  assert.ok(Math.abs(llm.gastoTotal() - 0.764) < 1e-12);
  assert.equal(crearLLM({ apiKey: '' }).gastoTotal(), 0);
});

test('coste con usage y la tabla: casos calculados a mano', () => {
  const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 1000 };
  // opus-5-5: 1000·4 + 500·20 + 2000·0,20 + 1000·5 = 4000 + 10000 + 400 + 5000 = 19.400 $/MTok → 0,0194 $
  assert.ok(Math.abs(costeDeUso(usage, 'claude-opus-5-5').costeUsd - 0.0194) < 1e-12);
  // haiku-4-5: 1000·1 + 500·5 + 2000·0,10 + 1000·1,25 = 1000 + 2500 + 200 + 1250 = 4.950 → 0,00495 $
  assert.ok(Math.abs(costeDeUso(usage, 'claude-haiku-4-5').costeUsd - 0.00495) < 1e-12);
  // sonnet-5-5: 1000·2 + 500·10 + 2000·0,2 + 1000·2,5 = 2000 + 5000 + 400 + 2500 = 9.900 → 0,0099 $
  assert.ok(Math.abs(costeDeUso(usage, 'claude-sonnet-5-5').costeUsd - 0.0099) < 1e-12);
  // opus-5: 5000 + 12500 + 1000 + 6250 = 24.750 → 0,02475 $ · fable-5-1: 10000 + 25000 + 500 + 12500 = 48.000 → 0,048 $
  assert.ok(Math.abs(costeDeUso(usage, 'claude-opus-5').costeUsd - 0.02475) < 1e-12);
  assert.ok(Math.abs(costeDeUso(usage, 'claude-fable-5-1').costeUsd - 0.048) < 1e-12);
  // Con salvavidas se suman los tramos, cada uno a su tarifa:
  // opus-5-5 rechaza tras leer 1000 (1000·4 = 4000) + opus-4-8 responde (1000·5 + 500·25 = 17.500) → 21.500 → 0,0215 $
  const conTramos = {
    input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
    iterations: [
      { type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ],
  };
  const c = costeDeUso(conTramos, 'claude-opus-5-5');
  assert.ok(Math.abs(c.costeUsd - 0.0215) < 1e-12);
  assert.deepEqual(c.tokens, { entrada: 2000, salida: 500, cacheLectura: 0, cacheEscritura: 0 });
  // Modelo desconocido: a la tarifa más cara (fable-5-1) para no quedarse corto.
  assert.equal(tarifaDe('claude-nuevo-9').conocida, false);
  assert.equal(tarifaDe('claude-opus-5-5-20260901').tarifa.entrada, 4);
});

test('la llamada devuelve coste y tokens, suma al gasto y se apunta en llm-costes.jsonl', async () => {
  const dir = carpetaTemporal();
  const rutaCostes = path.join(dir, 'llm-costes.jsonl');
  const { llm } = llmCon(mensaje({ texto: BUENO }), { rutaCostes });
  const r = await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  assert.ok(Math.abs(r.costeUsd - 0.0194) < 1e-12);
  assert.equal(r.modelo, 'claude-opus-5-5');
  assert.deepEqual(r.tokens, { entrada: 1000, salida: 500, cacheLectura: 2000, cacheEscritura: 1000 });
  assert.ok(Math.abs(llm.gastoHoy() - 0.0194) < 1e-12);
  const filas = leerJSONL(rutaCostes);
  assert.equal(filas.length, 1);
  const fila = filas[0];
  assert.deepEqual(Object.keys(fila).sort(),
    ['cacheEscritura', 'cacheLectura', 'costeUsd', 'entrada', 'modelo', 'motivo', 'ms', 'ok', 'proposito', 'salida', 't'].sort());
  assert.equal(fila.t, T0);
  assert.equal(fila.proposito, 'prueba');
  assert.equal(fila.ok, true);
  assert.equal(llm.estado().llamadasHoy, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tope diario: corta ANTES de llamar si el máximo estimado no cabe', async () => {
  // Máximo de salida: 2000 tokens · 20 $/MTok = 0,04 $ > 0,01 $ de tope.
  const { llm, fetch } = llmCon(mensaje({ texto: BUENO }), { presupuestoDiaUsd: 0.01 });
  const r = await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'presupuesto');
  assert.equal(fetch.llamadas.length, 0);
});

test('tope diario: el gasto acumulado cuenta, sobrevive a un reinicio y se reinicia al cambiar el día UTC', async () => {
  const dir = carpetaTemporal();
  const rutaCostes = path.join(dir, 'llm-costes.jsonl');
  const reloj = relojFijo(T0);
  const fetch = fetchFalso(mensaje({ texto: BUENO }));
  const base = { apiKey: 'sk-prueba', reloj, presupuestoDiaUsd: 0.08, fetch, rutaCostes };
  const llm = crearLLM(base);
  const p = { ...PETICION, uso: 'comite', maxTokens: 1000 };
  // Cada llamada reserva 0,0508 $ (0,0204 de un intento de opus-5-5 + 0,0305
  // del salvavidas en opus-4-8/opus-5) y cuesta 0,0194 $.
  assert.equal((await llm.pedirJSON(p)).ok, true);   // 0      + 0,0508 ≤ 0,08
  assert.equal((await llm.pedirJSON(p)).ok, true);   // 0,0194 + 0,0508 ≤ 0,08
  const tercera = await llm.pedirJSON(p);            // 0,0388 + 0,0508 > 0,08
  assert.equal(tercera.motivo, 'presupuesto');
  assert.equal(fetch.llamadas.length, 2);
  // Reinicio: el gasto del día sale del fichero.
  const otro = crearLLM(base);
  assert.ok(Math.abs(otro.gastoHoy() - 0.0388) < 1e-12);
  assert.equal((await otro.pedirJSON(p)).motivo, 'presupuesto');
  // Día siguiente (UTC): presupuesto nuevo.
  reloj.avanzar(DIA);
  assert.equal(otro.gastoHoy(), 0);
  assert.equal((await otro.pedirJSON(p)).ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('con reloj simulado el día del presupuesto es el real (el dinero es real)', async () => {
  const dir = carpetaTemporal();
  const rutaCostes = path.join(dir, 'llm-costes.jsonl');
  const reloj = new RelojSimulado(Date.UTC(2020, 0, 1));
  const llm = crearLLM({ apiKey: 'sk-prueba', reloj, presupuestoDiaUsd: 5, fetch: fetchFalso(mensaje({ texto: BUENO })), rutaCostes });
  await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  reloj.avanzar(10 * DIA);   // la demo acelera días; el gasto no se reinicia
  assert.ok(llm.gastoHoy() > 0.019);
  assert.equal(diaUTC(leerJSONL(rutaCostes)[0].t), diaUTC(Date.now()));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refusal: motivo rechazo, sin leer el contenido, y el coste cuenta', async () => {
  const { llm } = llmCon(mensaje({ stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } }));
  const r = await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'rechazo');
  assert.match(r.detalle, /cyber/);
  assert.ok(llm.gastoHoy() > 0);
});

test('max_tokens: motivo error aunque el texto parezca JSON', async () => {
  const { llm } = llmCon(mensaje({ stop_reason: 'max_tokens', texto: '{"modo":"NORM' }));
  const r = await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  assert.equal(r.motivo, 'error');
  assert.match(r.detalle, /max_tokens/);
});

test('JSON que no valida el esquema: motivo esquema', async () => {
  for (const texto of [
    JSON.stringify({ modo: 'ATAQUE', razon: 'x' }),               // fuera del enum
    JSON.stringify({ modo: 'NORMAL' }),                             // falta required
    JSON.stringify({ modo: 'NORMAL', razon: 'x', extra: 1 }),       // additionalProperties
    JSON.stringify({ modo: 'NORMAL', razon: 'x'.repeat(201) }),     // maxLength (solo en local)
    'esto no es JSON',
  ]) {
    const { llm } = llmCon(mensaje({ texto }));
    const r = await llm.pedirJSON({ ...PETICION, uso: 'comite' });
    assert.equal(r.ok, false, texto);
    assert.equal(r.motivo, 'esquema', texto);
  }
});

test('401: desactiva el LLM, lo dice y las siguientes no hacen red', async () => {
  const { llm, fetch } = llmCon({ status: 401, cuerpo: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
  assert.equal(llm.activo, true);
  const r = await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'error');
  assert.match(r.detalle, /401/);
  assert.equal(llm.activo, false);
  assert.match(llm.estado().ultimoError, /401/);
  const r2 = await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  assert.equal(r2.motivo, 'sin_clave');
  assert.equal(fetch.llamadas.length, 1);
});

test('429 y fallo de conexión: error sin desactivar', async () => {
  const { llm } = llmCon({ status: 429, cuerpo: { type: 'error', error: { type: 'rate_limit_error', message: 'lento' } } });
  const r = await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  assert.equal(r.motivo, 'error');
  assert.match(r.detalle, /429/);
  assert.equal(llm.activo, true);

  const cliente = { beta: { messages: { create: async () => { throw new Anthropic.APIConnectionError({ message: 'sin red' }); } } } };
  const llm2 = crearLLM({ cliente, reloj: relojFijo(T0) });
  const r2 = await llm2.pedirJSON({ ...PETICION, uso: 'comite' });
  assert.equal(r2.motivo, 'error');
  assert.match(r2.detalle, /conexión/);
  assert.equal(llm2.activo, true);
});

test('primer bloque de texto aunque antes vengan thinking y fallback', async () => {
  const content = [
    { type: 'thinking', thinking: '', signature: 's' },
    { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } },
    { type: 'text', text: BUENO },
  ];
  const { llm } = llmCon(mensaje({ content, model: 'claude-opus-4-8' }));
  const r = await llm.pedirJSON({ ...PETICION, uso: 'comite' });
  assert.equal(r.ok, true, r.detalle);
  assert.equal(r.modelo, 'claude-opus-4-8');
});

test('estimación del máximo: caracteres/3 de entrada + maxTokens de salida', () => {
  // 300 caracteres → 100 tokens · 4 $ + 1000 · 20 $ = 400 + 20.000 = 20.400 $/MTok → 0,0204 $
  const e = estimarCosteMaximo({ modelo: 'claude-opus-5-5', sistema: 'a'.repeat(100), contenido: 'b'.repeat(198), esquema: {}, maxTokens: 1000 });
  assert.ok(Math.abs(e - 0.0204) < 1e-12);   // '{}' = 2 caracteres: 100 + 198 + 2 = 300
});

test('validador mínimo: tipos, required, enum, additionalProperties, items, anyOf', () => {
  const esq = {
    type: 'object',
    properties: {
      n: { type: 'integer' },
      x: { type: 'number', minimum: 0, maximum: 1 },
      l: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
      o: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: ['n', 'l'],
    additionalProperties: false,
  };
  assert.deepEqual(validarEsquema({ n: 3, x: 0.5, l: ['a'], o: null }, esq), []);
  assert.equal(validarEsquema({ n: 3.5, l: [] }, esq).length, 1);
  assert.equal(validarEsquema({ n: 3, l: ['c'] }, esq).length, 1);
  assert.equal(validarEsquema({ n: 3, l: [], x: 2 }, esq).length, 1);
  assert.equal(validarEsquema({ n: 3, l: [], o: 5 }, esq).length, 1);
  assert.equal(validarEsquema({ l: [] }, esq).length, 1);
  assert.equal(validarEsquema({ n: 1, l: [], z: 1 }, esq).length, 1);
  assert.equal(validarEsquema([], esq).length, 1);
  assert.equal(validarEsquema({ n: NaN, l: [] }, esq).length, 1);
});

test('esquema para la API: quita rangos y longitudes y exige additionalProperties false', () => {
  const api = esquemaParaApi({
    type: 'object',
    properties: { a: { type: 'number', minimum: 0 }, b: { type: 'object', properties: { c: { type: 'string', maxLength: 3 } } } },
    required: ['a'],
  });
  assert.deepEqual(api, {
    type: 'object',
    properties: { a: { type: 'number' }, b: { type: 'object', properties: { c: { type: 'string' } }, additionalProperties: false } },
    required: ['a'],
    additionalProperties: false,
  });
});

test('fijarModelos, fijarPresupuesto y forma de estado()', async () => {
  const { llm, fetch } = llmCon(mensaje({ texto: BUENO, model: 'claude-haiku-4-5' }));
  assert.deepEqual(Object.keys(llm.estado()).sort(),
    ['activo', 'gastoHoyUsd', 'llamadasHoy', 'modeloAgentes', 'modeloComite', 'presupuestoDiaUsd', 'ultimoError'].sort());
  llm.fijarModelos({ modeloAgentes: 'claude-haiku-4-5' });
  assert.equal(llm.estado().modeloAgentes, 'claude-haiku-4-5');
  assert.equal(llm.estado().modeloComite, 'claude-opus-5-5');
  await llm.pedirJSON({ ...PETICION, uso: 'agentes' });
  assert.equal(fetch.llamadas[0].cuerpo.model, 'claude-haiku-4-5');
  assert.equal(llm.fijarPresupuesto(1.5), 1.5);
  assert.equal(llm.estado().presupuestoDiaUsd, 1.5);
  assert.throws(() => llm.fijarPresupuesto(-1), RangeError);
  assert.throws(() => llm.fijarPresupuesto('mucho'), RangeError);
});

test('entrada no serializable: error sin lanzar y sin red', async () => {
  const { llm, fetch } = llmCon(mensaje({ texto: BUENO }));
  const ciclo = {}; ciclo.yo = ciclo;
  const r = await llm.pedirJSON({ ...PETICION, entrada: ciclo });
  assert.equal(r.motivo, 'error');
  assert.equal(fetch.llamadas.length, 0);
});

test('gasto de un día concreto: el cierre de las 00:05 ve el del día que cierra, también tras reiniciar', async () => {
  const dir = carpetaTemporal();
  const rutaCostes = path.join(dir, 'llm-costes.jsonl');
  // opus-5-5: 1000 de entrada (0,004 $) + 2000 de salida (0,04 $) = 0,044 $ por llamada.
  const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const reloj = relojFijo(Date.UTC(2026, 8, 29, 4, 0));
  const llm = crearLLM({ apiKey: 'sk-prueba', reloj, presupuestoDiaUsd: 5, fetch: fetchFalso(mensaje({ texto: BUENO, usage })), rutaCostes });
  // Caso de la revisión: 5 comités el 29-sep (04:00 … 20:00) y 1 a las 00:00 del 30.
  for (let i = 0; i < 6; i++) { assert.equal((await llm.pedirJSON({ ...PETICION, uso: 'comite' })).ok, true); reloj.avanzar(4 * 3600_000); }
  reloj.t = Date.UTC(2026, 8, 30, 0, 5);   // el cierre diario
  assert.ok(Math.abs(llm.gastoDelDia('2026-09-29') - 0.22) < 1e-12);
  assert.ok(Math.abs(llm.gastoHoy() - 0.044) < 1e-12);   // lo que hoy enseñaría el informe
  assert.ok(Math.abs(llm.gastoDelDia('2026-09-30') - llm.gastoHoy()) < 1e-12);
  assert.equal(llm.gastoDelDia('2026-09-28'), 0);
  // Un tramo de más de un día (cierre tardío) suma lo que cae dentro: desde < t ≤ hasta.
  assert.ok(Math.abs(llm.gastoEntre(Date.UTC(2026, 8, 29, 0, 5), Date.UTC(2026, 8, 30, 0, 5)) - 0.264) < 1e-12);
  assert.ok(Math.abs(llm.gastoEntre(Date.UTC(2026, 8, 29, 4, 0), Date.UTC(2026, 8, 29, 8, 0)) - 0.044) < 1e-12);
  // Tras un reinicio sobre el mismo registro, las mismas cifras.
  const otro = crearLLM({ apiKey: 'sk-prueba', reloj, presupuestoDiaUsd: 5, fetch: fetchFalso(mensaje({ texto: BUENO })), rutaCostes });
  assert.ok(Math.abs(otro.gastoDelDia('2026-09-29') - 0.22) < 1e-12);
  assert.ok(Math.abs(otro.gastoHoy() - 0.044) < 1e-12);
  // Sin clave también existe (el cierre diario no tiene que comprobarlo).
  assert.equal(crearLLM({ apiKey: '' }).gastoDelDia('2026-09-29'), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('con salvavidas se reserva también el intento del modelo de reserva: el tope no se pasa', async () => {
  // Peor caso: opus-5-5 rechaza tras generar maxTokens y el salvavidas responde
  // en opus-4-8 con la entrada + la parcial como contexto y maxTokens de salida.
  const p = { modelo: 'claude-opus-5-5', sistema: 'a'.repeat(100), contenido: 'b'.repeat(198), esquema: {}, maxTokens: 1000 };
  // 100 tokens de entrada: 0,0204 $ el primer intento; el segundo (100 + 1000)·5 + 1000·25 = 30.500 → 0,0305 $.
  assert.ok(Math.abs(reservaSalvavidas(p) - 0.0305) < 1e-12);
  assert.ok(Math.abs(reservaMaxima(p) - 0.0509) < 1e-12);
  const peor = costeDeUso({ iterations: [
    { model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 1000 },
    { model: 'claude-opus-4-8', input_tokens: 1100, output_tokens: 1000 },
  ] }, 'claude-opus-5-5').costeUsd;
  assert.ok(peor <= reservaMaxima(p) + 1e-12);
  // Sin salvavidas (haiku) no se reserva nada más.
  assert.equal(reservaSalvavidas({ ...p, modelo: 'claude-haiku-4-5' }), 0);

  // Caso de la revisión: con un tope en el que cabe un intento pero no dos, ya no se llama.
  const conTramos = mensaje({ texto: BUENO, usage: { input_tokens: 1000, output_tokens: 1000, iterations: [
    { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 0 },
    { model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 1000 },
  ] } });
  const { llm, fetch } = llmCon(conTramos, { presupuestoDiaUsd: 0.03 });
  const r = await llm.pedirJSON({ ...PETICION, uso: 'comite', maxTokens: 1000 });   // un intento: 0,0204 ≤ 0,03; con salvavidas 0,0508
  assert.equal(r.motivo, 'presupuesto');
  assert.equal(fetch.llamadas.length, 0);
  assert.ok(llm.gastoHoy() <= 0.03);
  // Con haiku (sin salvavidas) la misma llamada sí cabe.
  const h = llmCon(mensaje({ texto: BUENO, model: 'claude-haiku-4-5' }), { presupuestoDiaUsd: 0.03, modeloComite: 'claude-haiku-4-5' });
  assert.equal((await h.llm.pedirJSON({ ...PETICION, uso: 'comite', maxTokens: 1000 })).ok, true);
});

test('timeout por petición según maxTokens y un solo reintento', async () => {
  assert.equal(timeoutPara(1500), 60000);     // el Megáfono sigue siendo interactivo
  assert.equal(timeoutPara(4000), 160000);    // comité
  assert.equal(timeoutPara(7000), 280000);    // post-mortem de 40 operaciones
  assert.equal(timeoutPara(100000), 600000);
  const vistos = [];
  const cliente = { beta: { messages: { create: async (cuerpo, opciones) => { vistos.push(opciones); return mensaje({ texto: BUENO }); } } } };
  const llm = crearLLM({ cliente, reloj: relojFijo(T0) });
  await llm.pedirJSON({ ...PETICION, uso: 'comite', maxTokens: 4000 });
  assert.deepEqual(vistos[0], { timeout: 160000, maxRetries: 1 });
  // Con el SDK real, las opciones por petición mandan sobre las del cliente (60 s, 2 reintentos).
  const { llm: real, fetch } = llmCon(mensaje({ texto: BUENO }));
  await real.pedirJSON({ ...PETICION, uso: 'agentes', maxTokens: 7000 });
  assert.equal(fetch.llamadas[0].cabeceras['x-stainless-timeout'], '280');
});

test('una llamada cortada por timeout se apunta con lo reservado (puede estar cobrada), no a 0 $', async () => {
  const dir = carpetaTemporal();
  const rutaCostes = path.join(dir, 'llm-costes.jsonl');
  // El fetch «se cuelga»: el SDK lo ve como timeout, reintenta una vez y lanza APIConnectionTimeoutError.
  let intentos = 0;
  const fetch = async () => { intentos++; throw new Error('Request timed out'); };
  const llm = crearLLM({ apiKey: 'sk-prueba', reloj: relojFijo(T0), presupuestoDiaUsd: 5, fetch, rutaCostes });
  const r = await llm.pedirJSON({ ...PETICION, uso: 'comite', maxTokens: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'error');
  assert.equal(intentos, 2);   // 1 + un reintento
  const reservado = reservaMaxima({ modelo: 'claude-opus-5-5', sistema: PETICION.sistema, contenido: fetchContenido(), esquema: ESQUEMA, maxTokens: 1000 });
  assert.ok(Math.abs(r.costeUsd - 2 * reservado) < 1e-12);
  assert.ok(Math.abs(llm.gastoHoy() - 2 * reservado) < 1e-12);
  const [fila] = leerJSONL(rutaCostes);
  assert.equal(fila.estimado, true);
  assert.ok(Math.abs(fila.costeUsd - 2 * reservado) < 1e-12);
  // Sobrevive al reinicio (el arranque suma costeUsd del registro).
  assert.ok(Math.abs(crearLLM({ apiKey: 'sk-prueba', reloj: relojFijo(T0), rutaCostes }).gastoHoy() - 2 * reservado) < 1e-12);

  // Con un cliente inyectado que lanza el error tipado del SDK, igual.
  const cliente = { beta: { messages: { create: async () => { throw new Anthropic.APIConnectionTimeoutError(); } } } };
  const llm2 = crearLLM({ cliente, reloj: relojFijo(T0) });
  const r2 = await llm2.pedirJSON({ ...PETICION, uso: 'comite', maxTokens: 1000 });
  assert.ok(r2.costeUsd > 0);
  assert.ok(Math.abs(llm2.gastoHoy() - r2.costeUsd) < 1e-12);
  // Un error que no llega a generar (sin conexión) sigue en 0.
  const sinRed = { beta: { messages: { create: async () => { throw new Anthropic.APIConnectionError({ message: 'sin red' }); } } } };
  const llm3 = crearLLM({ cliente: sinRed, reloj: relojFijo(T0) });
  assert.equal((await llm3.pedirJSON({ ...PETICION, uso: 'comite' })).costeUsd, 0);
  assert.equal(llm3.gastoHoy(), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

function fetchContenido() {
  return `${PETICION.instrucciones}\n\nDatos (JSON):\n${JSON.stringify(PETICION.entrada)}`;
}
