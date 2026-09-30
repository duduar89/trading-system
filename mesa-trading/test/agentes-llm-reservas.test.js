'use strict';
// El tope diario del LLM con varias instancias a la vez (revisión del
// 30-sep-2026): en el modo web conviven el crearLLM del latido, el de cada
// petición del Megáfono y el de cada proceso de la web. Las reservas en vuelo
// se comparten por disco (src/agentes/reservas-llm.js); antes vivían en la
// memoria de cada instancia y tres llamadas a la vez gastaban casi el doble
// del tope.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { crearLLM, reservaMaxima } = require('../src/agentes/llm');
const { crearReservas } = require('../src/agentes/reservas-llm');
const { leerJSONL } = require('../src/util/almacen');
const { mensaje, carpetaTemporal, relojFijo } = require('./agentes-ayuda');

const T0 = Date.UTC(2026, 8, 30, 12);
const RAIZ = path.resolve(__dirname, '..');
const PETICION = {
  proposito: 'prueba', sistema: 'Eres una prueba.', entrada: { x: 1 }, instrucciones: 'Responde.',
  esquema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
  maxTokens: 8000,
};

// Cliente que tarda y cobra lo máximo (max_tokens de salida, haiku).
function clienteLento(ms = 300) {
  const create = async (cuerpo) => {
    await new Promise(r => setTimeout(r, ms));
    return mensaje({ texto: '{"ok":true}', model: 'claude-haiku-4-5', usage: { input_tokens: 100, output_tokens: cuerpo.max_tokens } });
  };
  return { beta: { messages: { create } }, messages: { create } };
}

const instancia = (rutaCostes, presupuestoDiaUsd) => crearLLM({
  cliente: clienteLento(), modeloAgentes: 'claude-haiku-4-5', presupuestoDiaUsd, rutaCostes, reloj: relojFijo(T0),
});

function estimadoDe() {
  const contenido = `${PETICION.instrucciones}\n\nDatos (JSON):\n${JSON.stringify(PETICION.entrada)}`;
  return reservaMaxima({ modelo: 'claude-haiku-4-5', sistema: PETICION.sistema, contenido, esquema: PETICION.esquema, maxTokens: PETICION.maxTokens });
}

test('tres instancias sobre el mismo llm-costes.jsonl: a la vez no rebasan el tope', async () => {
  const carpeta = carpetaTemporal();
  const rutaCostes = path.join(carpeta, 'llm-costes.jsonl');
  const est = estimadoDe();
  const tope = est * 1.6;   // cabe una llamada, no dos
  const rs = await Promise.all([instancia(rutaCostes, tope), instancia(rutaCostes, tope), instancia(rutaCostes, tope)].map(l => l.pedirJSON(PETICION)));
  const ok = rs.filter(r => r.ok).length;
  assert.equal(ok, 1, JSON.stringify(rs.map(r => r.motivo || 'ok')));
  assert.deepEqual(rs.filter(r => !r.ok).map(r => r.motivo), ['presupuesto', 'presupuesto']);
  const gastado = leerJSONL(rutaCostes).reduce((s, c) => s + c.costeUsd, 0);
  assert.ok(gastado <= tope, `gastado ${gastado} con tope ${tope}`);
  // Las reservas quedan todas cerradas.
  assert.deepEqual(crearReservas({ rutaCostes }).abiertas(), []);
});

test('tres procesos de verdad a la vez: tampoco rebasan el tope', { timeout: 30_000 }, async () => {
  const carpeta = carpetaTemporal();
  const rutaCostes = path.join(carpeta, 'llm-costes.jsonl');
  const tope = estimadoDe() * 1.6;
  const codigo = `
    const { crearLLM } = require(${JSON.stringify(path.join(RAIZ, 'src/agentes/llm'))});
    const create = async (c) => { await new Promise(r => setTimeout(r, 500)); return { model: 'claude-haiku-4-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 100, output_tokens: c.max_tokens } }; };
    const llm = crearLLM({ cliente: { beta: { messages: { create } }, messages: { create } }, modeloAgentes: 'claude-haiku-4-5', presupuestoDiaUsd: ${tope}, rutaCostes: ${JSON.stringify(rutaCostes)} });
    llm.pedirJSON(${JSON.stringify(PETICION)}).then(r => { process.stdout.write(r.ok ? 'ok' : r.motivo); });
  `;
  const correr = () => new Promise((resolver) => {
    const h = spawn(process.execPath, ['-e', codigo], { cwd: RAIZ, env: { ...process.env, LOG_NIVEL: 'silencio' } });
    let salida = '';
    h.stdout.on('data', d => { salida += d; });
    h.on('close', () => resolver(salida));
  });
  const rs = await Promise.all([correr(), correr(), correr()]);
  assert.equal(rs.filter(r => r === 'ok').length, 1, rs.join(','));
  assert.ok(leerJSONL(rutaCostes).reduce((s, c) => s + c.costeUsd, 0) <= tope);
});

test('una reserva huérfana (proceso muerto a mitad) cuenta contra el tope y se apunta una sola vez', async () => {
  const carpeta = carpetaTemporal();
  const rutaCostes = path.join(carpeta, 'llm-costes.jsonl');
  const est = estimadoDe();
  // Un latido reservó y murió: su reserva ya venció.
  fs.writeFileSync(path.join(carpeta, 'llm-reservas.jsonl'), `${JSON.stringify({ id: 'muerto-1', t: T0, costeUsd: est, intentos: 1, vence: Date.now() - 1000, proposito: 'comite', modelo: 'claude-opus-5-5', pid: 999999 })}\n`);
  const llm = instancia(rutaCostes, est * 1.6);
  assert.ok(Math.abs(llm.gastoHoy() - est) < 1e-12, 'saldada al crear la instancia');
  const r = await llm.pedirJSON(PETICION);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'presupuesto', 'lo del muerto ya ocupa el tope');
  const huerfanas = leerJSONL(rutaCostes).filter(c => c.huerfana);
  assert.equal(huerfanas.length, 1);
  assert.equal(huerfanas[0].proposito, 'comite');
  instancia(rutaCostes, 5);
  assert.equal(leerJSONL(rutaCostes).filter(c => c.huerfana).length, 1, 'no se salda dos veces');
});

test('una reserva abierta que no ha vencido (otro proceso llamando) cuenta como en vuelo', async () => {
  const carpeta = carpetaTemporal();
  const rutaCostes = path.join(carpeta, 'llm-costes.jsonl');
  const est = estimadoDe();
  fs.writeFileSync(path.join(carpeta, 'llm-reservas.jsonl'), `${JSON.stringify({ id: 'vivo-1', t: T0, costeUsd: est, intentos: 1, vence: Date.now() + 60_000, proposito: 'noticias', pid: 1 })}\n`);
  const r = await instancia(rutaCostes, est * 1.6).pedirJSON(PETICION);
  assert.equal(r.motivo, 'presupuesto');
  assert.match(r.detalle, /en vuelo/);
  assert.equal(leerJSONL(rutaCostes).length, 0, 'no se apunta nada: sigue en vuelo');
});

test('crearLLM: limiteLlamadaMs, reintentos y plazo llegan a la petición', async () => {
  const llamadas = [];
  const create = async (cuerpo, opciones) => { llamadas.push(opciones); return mensaje({ texto: '{"ok":true}' }); };
  const cliente = { beta: { messages: { create } }, messages: { create } };
  const base = { cliente, reloj: relojFijo(T0), presupuestoDiaUsd: 50 };
  await crearLLM(base).pedirJSON({ ...PETICION, maxTokens: 4000, uso: 'comite' });
  assert.deepEqual(llamadas.pop(), { timeout: 160_000, maxRetries: 1 }, 'fuera del latido, como siempre');
  await crearLLM({ ...base, limiteLlamadaMs: 45_000, reintentos: 0 }).pedirJSON({ ...PETICION, maxTokens: 4000, uso: 'comite' });
  assert.deepEqual(llamadas.pop(), { timeout: 45_000, maxRetries: 0 });
  await crearLLM({ ...base, limiteLlamadaMs: 45_000, reintentos: 0, plazo: () => Date.now() + 30_000 }).pedirJSON({ ...PETICION, uso: 'comite' });
  assert.ok(llamadas.pop().timeout <= 30_000, 'recortado al plazo');
  const r = await crearLLM({ ...base, plazo: () => Date.now() + 5_000 }).pedirJSON({ ...PETICION, uso: 'comite' });
  assert.equal(r.ok, false);
  assert.match(r.detalle, /Sin tiempo/);
  assert.equal(llamadas.length, 0);
});
