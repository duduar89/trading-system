'use strict';
// El latido frente a cortes (revisión del 30-sep-2026, ARQUITECTURA-WEB W2 y W3):
// - el comité con LLM cabe en el latido: 45 s por llamada, sin reintentos y
//   un plazo para todo el LLM del proceso antes del vigía;
// - si el vigía lo mata igual a mitad del comité, el comité no se vuelve a
//   convocar en bucle y la llamada cuenta contra el tope diario;
// - un cerrojo huérfano cuyo pid ha reciclado otro proceso no para la mesa, y
//   un cerrojo viejo hace salir el latido con código 2.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const { carpetaTemporal, llmApagado, INICIO } = require('./integracion-ayuda');
const { crearConfig } = require('../src/config');
const { conLaMesa, latido, FICHEROS } = require('../src/latido');
const scriptLatido = require('../scripts/latido');
const { tomarBloqueo, soltarBloqueo, arranqueDe } = require('../src/util/proceso');
const { leerJSON, leerJSONL } = require('../src/util/almacen');

const RAIZ = path.resolve(__dirname, '..');
const hayProc = fs.existsSync(`/proc/${process.pid}/stat`);

function configEn(carpeta) {
  const config = crearConfig({ modo: 'sintetico', datos: carpeta, semilla: '42' });
  config.inicio = INICIO;
  return config;
}

// Un proceso vivo que no es este (y que se mata al acabar la prueba).
function procesoVivo(t) {
  const h = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => { try { h.kill('SIGKILL'); } catch (_) { /* ya muerto */ } });
  return h.pid;
}

// Primer latido sin LLM y el comité convocado desde «la web»: queda pedido.
async function mesaConComitePedido() {
  const carpeta = carpetaTemporal();
  const config = configEn(carpeta);
  assert.equal((await latido(config, { llm: llmApagado() })).ok, true);
  const r = await conLaMesa(config, orq => orq.comando('comite'), { llm: llmApagado() });
  assert.equal(r.ok, true);
  assert.ok(leerJSON(path.join(carpeta, 'estado.json')).comite.pedido, 'queda pedido');
  return { carpeta, config };
}

// ---------- cerrojo ----------

test('cerrojo con el pid reciclado por otro proceso vivo: está muerto y se toma', { skip: !hayProc && 'sin /proc' }, async (t) => {
  const carpeta = carpetaTemporal();
  const pid = procesoVivo(t);
  const ruta = path.join(carpeta, '.proceso');
  // El que murió tenía ese pid, pero arrancó en otro momento.
  fs.writeFileSync(ruta, JSON.stringify({ pid, host: os.hostname(), desde: '2026-09-01T00:00:00Z', arranque: '1' }));
  const r = tomarBloqueo(carpeta);
  assert.equal(r.tomado, true);
  assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf8')).pid, process.pid);
  assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf8')).arranque, arranqueDe(process.pid), 'el nuevo guarda su arranque');
  soltarBloqueo(carpeta);
  // El mismo pid con SU arranque: vivo de verdad, no se toma.
  fs.writeFileSync(ruta, JSON.stringify({ pid, host: os.hostname(), desde: new Date().toISOString(), arranque: arranqueDe(pid) }));
  assert.throws(() => tomarBloqueo(carpeta), e => e.code === 'EBLOQUEO');
  // Un cerrojo antiguo sin arranque: solo el pid (como antes).
  fs.writeFileSync(ruta, JSON.stringify({ pid, host: os.hostname(), desde: new Date().toISOString() }));
  assert.throws(() => tomarBloqueo(carpeta), e => e.code === 'EBLOQUEO');
});

test('latido con el cerrojo del pid reciclado: late en vez de salir «omitido» para siempre', { skip: !hayProc && 'sin /proc' }, async (t) => {
  const carpeta = carpetaTemporal();
  const config = configEn(carpeta);
  fs.writeFileSync(path.join(carpeta, '.proceso'), JSON.stringify({ pid: procesoVivo(t), host: os.hostname(), desde: '2026-09-01T00:00:00Z', arranque: '1' }));
  const r = await latido(config, { llm: llmApagado() });
  assert.equal(r.ok, true, r.resumen);
});

test('scripts/latido.js: omitido por un cerrojo más viejo que el vigía → código 2; uno reciente → 0', async (t) => {
  const carpeta = carpetaTemporal();
  const config = configEn(carpeta);
  const pid = procesoVivo(t);
  const cerrojo = desde => fs.writeFileSync(path.join(carpeta, '.proceso'), JSON.stringify({
    pid, host: os.hostname(), desde: new Date(desde).toISOString(), ...(arranqueDe(pid) ? { arranque: arranqueDe(pid) } : {}),
  }));
  const textos = [];
  const correr = () => new Promise(resolver => {
    scriptLatido.ejecutar({ config, salir: resolver, espejo: () => ({ sincronizar: async () => ({}) }), escribir: x => textos.push(x), latidoFn: (c, o) => latido(c, { ...o, llm: llmApagado() }) });
  });
  cerrojo(Date.now() - 10_000);
  assert.equal(await correr(), 0, 'un botón o un latido en marcha: se omite sin más');
  cerrojo(Date.now() - 30 * 60_000);
  assert.equal(await correr(), scriptLatido.CODIGO_CERROJO_VIEJO);
  assert.match(textos[1], /CERROJO VIEJO: lleva 30 min/);
  const l = leerJSONL(path.join(carpeta, FICHEROS.latidos));
  assert.ok(l.every(x => x.ok === false), 'los omitidos se apuntan como no buenos');
});

// ---------- el LLM cabe en el latido ----------

// Cliente falso de la API: apunta cada llamada (cuerpo y opciones) y responde
// con `responder(cuerpo, opciones)`.
function clienteFalso(responder) {
  const llamadas = [];
  const create = async (cuerpo, opciones) => { llamadas.push({ cuerpo, opciones }); return responder(cuerpo, opciones); };
  return { llamadas, beta: { messages: { create } }, messages: { create } };
}

test('latido: el comité llama con 45 s como mucho y sin reintentos, y guarda antes que ya no está pedido', async () => {
  const { carpeta, config } = await mesaConComitePedido();
  let visto = null;
  const cliente = clienteFalso(async (cuerpo, opciones) => {
    if (cuerpo.max_tokens === 4000) visto = leerJSON(path.join(carpeta, 'estado.json'));   // el comité (4000 tokens)
    throw new Anthropic.APIConnectionTimeoutError({ message: `sin respuesta en ${opciones.timeout} ms` });
  });
  const r = await latido(config, { clienteLLM: cliente, plazoLLM: Date.now() + 180_000 });
  assert.equal(r.ok, true, r.resumen);
  const comite = cliente.llamadas.filter(l => l.cuerpo.max_tokens === 4000);
  assert.equal(comite.length, 1, 'una sola llamada del comité');
  for (const l of cliente.llamadas) {
    assert.ok(l.opciones.timeout <= 45_000, `timeout ${l.opciones.timeout}`);
    assert.equal(l.opciones.maxRetries, 0);
  }
  // Durante la llamada, en disco: ni pedido ni próxima cita vencida, y «en curso».
  assert.equal(visto.comite.pedido, null);
  assert.ok(visto.comite.enCurso, 'en curso desde antes de llamar');
  const e = leerJSON(path.join(carpeta, 'estado.json'));
  assert.equal(e.comite.enCurso, undefined, 'acabado, ya no está en curso');
  assert.equal(e.comite.celebrados, 1, 'con el LLM caído, se celebra con plantillas');
  // La llamada cortada se apunta como gastada (estimada) y su reserva se cierra.
  const costes = leerJSONL(path.join(carpeta, 'llm-costes.jsonl'));
  assert.ok(costes.some(c => c.estimado && c.costeUsd > 0));
  assert.deepEqual(abiertas(carpeta), []);
});

test('latido: sin tiempo antes del plazo, el LLM no se llama (plantillas) y el latido acaba', async () => {
  const { carpeta, config } = await mesaConComitePedido();
  const cliente = clienteFalso(async () => { throw new Error('no debería llamar'); });
  const r = await latido(config, { clienteLLM: cliente, plazoLLM: Date.now() + 5_000 });
  assert.equal(r.ok, true, r.resumen);
  assert.equal(cliente.llamadas.length, 0);
  assert.equal(leerJSON(path.join(carpeta, 'estado.json')).comite.celebrados, 1);
});

test('scripts/latido.js: el plazo del LLM queda antes del vigía', async () => {
  const carpeta = carpetaTemporal();
  const config = configEn(carpeta);
  let plazo = null;
  const t0 = Date.now();
  const codigo = await new Promise(resolver => {
    scriptLatido.ejecutar({
      config, salir: resolver, escribir: () => {}, espejo: () => ({ sincronizar: async () => ({}) }),
      latidoFn: async (c, o) => { plazo = o.plazoLLM; return { ok: true, ms: 1, resumen: 'x' }; },
    });
  });
  assert.equal(codigo, 0);
  assert.ok(plazo - t0 <= scriptLatido.VIGIA_MS - scriptLatido.MARGEN_VIGIA_MS + 50, `plazo a ${plazo - t0} ms`);
  assert.ok(plazo - t0 >= scriptLatido.VIGIA_MS - scriptLatido.MARGEN_VIGIA_MS - 1000);
});

function abiertas(carpeta) {
  const m = new Map();
  for (const r of leerJSONL(path.join(carpeta, 'llm-reservas.jsonl'))) { if (r.cierra) m.delete(r.id); else m.set(r.id, r); }
  return [...m.values()];
}

test('el vigía mata el latido a mitad del comité: no se reconvoca en bucle y la llamada cuenta contra el tope', { timeout: 60_000 }, async () => {
  const { carpeta, config } = await mesaConComitePedido();
  // Otro proceso: el latido de verdad, con un cliente que no responde nunca y
  // un vigía de 8 s (el plazo del LLM, largo a propósito: el caso es el corte).
  const codigo = `
    const { crearConfig } = require(${JSON.stringify(path.join(RAIZ, 'src/config'))});
    const s = require(${JSON.stringify(path.join(RAIZ, 'scripts/latido'))});
    const config = crearConfig({ modo: 'sintetico', datos: ${JSON.stringify(carpeta)}, semilla: '42' });
    const nunca = () => new Promise(() => { setInterval(() => {}, 1000); });
    const cliente = { beta: { messages: { create: nunca } }, messages: { create: nunca } };
    s.ejecutar({ config, vigiaMs: 8000, espejo: () => ({ sincronizar: async () => ({}) }), opcionesLatido: { clienteLLM: cliente, plazoLLM: Date.now() + 600000 } });
  `;
  const hijo = spawn(process.execPath, ['-e', codigo], { cwd: RAIZ, env: { ...process.env, LOG_NIVEL: 'silencio' }, stdio: 'ignore' });
  const salida = await new Promise(r => hijo.on('close', c => r(c)));
  assert.equal(salida, 1, 'lo cortó el vigía');
  const e = leerJSON(path.join(carpeta, 'estado.json'));
  assert.equal(e.comite.pedido, null, 'guardado antes de llamar: ya no está pedido');
  assert.ok(e.comite.enCurso, 'y consta en curso');
  assert.equal(e.comite.celebrados || 0, 0);
  const vivas = abiertas(carpeta);
  assert.ok(vivas.length >= 1, 'la llamada en vuelo quedó reservada en disco');
  const reservado = vivas.reduce((s, r) => s + r.costeUsd * r.intentos, 0);
  // Pasa el tiempo: la reserva vence (nadie puede seguir esperándola).
  const ruta = path.join(carpeta, 'llm-reservas.jsonl');
  fs.writeFileSync(ruta, leerJSONL(ruta).map(r => JSON.stringify(r.cierra ? r : { ...r, vence: Date.now() - 1 }) + '\n').join(''));
  // El latido siguiente (con un cliente sin red, que no cobra): salda la
  // huérfana, no repite el comité y lo dice.
  const sinRed = clienteFalso(async () => { throw new Error('sin red en la prueba'); });
  const r = await latido(config, { clienteLLM: sinRed });
  assert.equal(r.ok, true, r.resumen);
  const e2 = leerJSON(path.join(carpeta, 'estado.json'));
  assert.equal(e2.comite.celebrados || 0, 0, 'no se reconvoca');
  assert.equal(e2.comite.enCurso, undefined);
  assert.ok(leerJSONL(path.join(carpeta, 'mensajes.jsonl')).some(m => /se cortó a mitad/.test(m.texto)));
  const huerfanas = leerJSONL(path.join(carpeta, 'llm-costes.jsonl')).filter(c => c.huerfana);
  assert.equal(huerfanas.length, vivas.length);
  assert.ok(Math.abs(huerfanas.reduce((s, c) => s + c.costeUsd, 0) - reservado) < 1e-9, 'cuenta lo reservado');
  assert.deepEqual(abiertas(carpeta), []);
  // Y un tercer latido no la vuelve a apuntar.
  await latido(config, { clienteLLM: sinRed });
  assert.equal(leerJSONL(path.join(carpeta, 'llm-costes.jsonl')).filter(c => c.huerfana).length, vivas.length);
});
