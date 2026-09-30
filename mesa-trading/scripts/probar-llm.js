'use strict';
// Casos conocidos de la infraestructura de agentes (coste, forma de la
// petición, verificarCifras, caída a plantillas, gasto por día, reserva del
// salvavidas, timeout, Megáfono y post-mortem). Imprime OK/FALLO por caso y
// sale con código 1 si alguno falla. Los casos sin clave usan un fetch falso:
// no hay red ni coste.
//
//   node scripts/probar-llm.js              sin clave: todo cae a plantillas, sin coste
//   node scripts/probar-llm.js --sin-clave  igual aunque haya ANTHROPIC_API_KEY en el .env
//
// Con ANTHROPIC_API_KEY en el .env (y sin --sin-clave) hace además UNA
// llamada real mínima con el modelo de agentes e imprime lo que costó.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { cargarEnv } = require('../src/config');
const { crearLLM, costeDeUso, construirPeticion, reservaMaxima } = require('../src/agentes/llm');
const { verificarCifras } = require('../src/agentes/cifras');
const { Bus } = require('../src/agentes/bus');
const megafono = require('../src/agentes/megafono');
const postmortem = require('../src/agentes/postmortem');
const plantillas = require('../src/agentes/plantillas');

let fallos = 0;
function caso(nombre, obtenido, esperado, tol = 1e-12) {
  const ok = typeof esperado === 'number' ? Math.abs(obtenido - esperado) <= tol : obtenido === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'OK   ' : 'FALLO'}  ${nombre}: ${obtenido}${ok ? '' : ` (esperado ${esperado})`}`);
}

const UNIVERSO = [
  { simbolo: 'BTC/USD', etiqueta: 'BTC', nombre: 'Bitcoin' },
  { simbolo: 'SOL/USD', etiqueta: 'SOL', nombre: 'Solana' },
];
const MESAS = [{ id: 'tendencia', nombre: 'Tendencia SMA' }, { id: 'reversion', nombre: 'Reversión RSI' }];

// Respuesta de la API con el JSON pedido y un usage dado (fetch falso: sin red).
function fetchFalso(texto, usage) {
  const fn = async () => {
    fn.n++;
    return new Response(JSON.stringify({
      id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_details: null,
      content: [{ type: 'text', text: texto }], usage,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  fn.n = 0;
  return fn;
}
const relojMovible = t => ({ t, ahora() { return this.t; } });
const cerca = (a, b) => Math.abs(a - b) < 1e-9;

// Casos conocidos de la revisión (sep-2026), sin red ni coste.
async function casosRevision() {
  console.log('— verificarCifras: el signo cuenta');
  caso('«hoy +523,40 $» con el día en −523,40 $', verificarCifras('hoy +523,40 $', { pnlDia: -523.4 }).ok, false);
  caso('«hoy -523,40 $» con el día en −523,40 $', verificarCifras('hoy -523,40 $', { pnlDia: -523.4 }).ok, true);
  caso('«pérdida de 45,20 $» (sin signo) con pnl −45,20', verificarCifras('pérdida de 45,20 $', { pnl: -45.2 }).ok, true);

  console.log('— Post-mortem');
  const perdedora = { id: 'op-1', mesaId: 'tendencia', simbolo: 'SOL/USD', pnl: -45.2, pnlPct: -0.0113, motivoSalida: 'stop', barras: 2 };
  caso('lección de reglas sin «perdió -»', postmortem.clasificarReglas(perdedora).leccion, 'SOL tocó el stop en 2 velas y perdió 45,20 $.');
  const llmSuerte = { activo: true, pedirJSON: async () => ({ ok: true, costeUsd: 0, datos: { clasificaciones: [{ operacionId: 'op-1', categoria: 'suerte', leccion: 'SOL ganó +45,20 $ (+1,13 %) por suerte.' }] } }) };
  const [l1] = await postmortem.lote({ operaciones: [perdedora], llm: llmSuerte });
  caso('una perdedora «de suerte» del LLM cae a reglas', `${l1.fuente}/${l1.categoria}`, 'reglas/stop_estrecho');
  const pistasKill = postmortem.hipotesisDesdeLecciones(Array(6).fill({ mesaId: 'tendencia', categoria: 'señal_falsa', motivoSalida: 'kill' }));
  caso('6 lecciones de cierres por kill no dan pistas', pistasKill.length, 0);

  console.log('— Megáfono');
  const llmMotivo = { activo: true, pedirJSON: async () => ({ ok: true, costeUsd: 0, datos: {
    directivas: [{ tipo: 'sin_efecto', factor: null, horas: null, simbolo: null, mesaId: null, motivo: 'La exposición bruta ya está en el 87 %.' }],
    explicacion: 'La exposición es del 87 %.' } }) };
  const mm = await megafono.interpretar('sube el riesgo al 200 %', { llm: llmMotivo, universo: UNIVERSO, mesas: MESAS });
  caso('motivo con cifra inventada → motivo fijo', mm.directivas[0].motivo, megafono.MOTIVO_FIJO);
  caso('explicación sin la cifra inventada', /87/.test(mm.explicacion), false);
  const mr = await megafono.interpretar('pausa la mesa de reversión 6 horas', { llm: null, universo: UNIVERSO, mesas: MESAS });
  caso('la propuesta nombra la mesa por su nombre', mr.explicacion, 'He entendido: pausar la mesa Reversión RSI durante 6 h.');

  console.log('— Gasto del LLM por día (cierre diario de las 00:05)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probar-llm-'));
  const rutaCostes = path.join(dir, 'llm-costes.jsonl');
  // 1000 de entrada + 2000 de salida en opus-5-5 = 0,044 $ por llamada.
  const usage = { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const reloj = relojMovible(Date.UTC(2026, 8, 29, 4, 0));
  const pet = { uso: 'comite', proposito: 'probar', entrada: { a: 1 }, esquema: { type: 'object' } };
  const llm = crearLLM({ apiKey: 'sk-falsa', reloj, presupuestoDiaUsd: 5, rutaCostes, fetch: fetchFalso('{}', usage) });
  for (let i = 0; i < 6; i++) { await llm.pedirJSON(pet); reloj.t += 4 * 3600_000; }   // 5 el 29-sep y 1 a las 00:00 del 30
  reloj.t = Date.UTC(2026, 8, 30, 0, 5);
  caso('gastoDelDia(2026-09-29) a las 00:05 del 30', llm.gastoDelDia('2026-09-29'), 0.22);
  caso('gastoHoy() a esa hora (lo que enseñaba el informe)', llm.gastoHoy(), 0.044);
  caso('tras reiniciar, el mismo gasto del día', crearLLM({ apiKey: 'sk-falsa', reloj, rutaCostes }).gastoDelDia('2026-09-29'), 0.22);

  console.log('— Tope diario con salvavidas y timeout');
  const p = { modelo: 'claude-opus-5-5', sistema: 'a'.repeat(100), contenido: 'b'.repeat(198), esquema: {}, maxTokens: 1000 };
  const peor = costeDeUso({ iterations: [{ model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 1000 }, { model: 'claude-opus-4-8', input_tokens: 1100, output_tokens: 1000 }] }, 'claude-opus-5-5').costeUsd;
  caso('reserva con salvavidas = peor caso (rechazo + opus-4-8)', reservaMaxima(p), peor);
  const cabeUno = crearLLM({ apiKey: 'sk-falsa', reloj, presupuestoDiaUsd: 0.03, fetch: fetchFalso('{}', usage) });
  const rTope = await cabeUno.pedirJSON({ ...pet, maxTokens: 1000 });
  caso('tope 0,03 $: cabe un intento, no dos → no se llama', rTope.motivo, 'presupuesto');
  let intentos = 0;
  const colgado = async () => { intentos++; throw new Error('Request timed out'); };
  const lento = crearLLM({ apiKey: 'sk-falsa', reloj, presupuestoDiaUsd: 5, fetch: colgado });
  const rTo = await lento.pedirJSON({ ...pet, maxTokens: 1000 });
  caso('timeout: intentos enviados (1 + 1 reintento)', intentos, 2);
  caso('timeout: se apunta lo reservado, no 0 $', lento.gastoHoy() > 0 && cerca(lento.gastoHoy(), rTo.costeUsd), true);
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('— Plantillas y bus');
  caso('informe de un cierre tardío (56 h)', plantillas.informeDiario({ dia: '2026-06-04', desde: Date.UTC(2026, 5, 2, 0, 5), hasta: Date.UTC(2026, 5, 4, 8, 0), patrimonio: 100415, pnlDia: 443.67, pnlDiaPct: 0.00442, operaciones: 5, acierto: 0.4, gastoLLMUsd: 0.22 }),
    'Cierre (02-jun 00:05 → 04-jun 08:00 UTC, 56 h): 100.415 $ (+443,67 $, +0,44 %). 5 operaciones, acierto 40 %. LLM 0,22 $.');
  caso('despido sin «sigue en sombra»', /sigue en sombra/i.test(plantillas.despido({ nombre: 'Tendencia SMA', motivo: 'maxDD 27 % > 25 %' })), false);
  caso('reabrir con la caída desde el máximo histórico', plantillas.reabrir({ quien: 'Eduardo', patrimonio: 95544, pico: 109000 }),
    'Reabierto por Eduardo. El fondo sigue un 12,34 % (13.456 $) por debajo de su máximo histórico (109.000 $).');
  const bus = new Bus({ reloj: relojMovible(Date.UTC(2026, 8, 29)) });
  bus.publicar({ de: 'sistema', canal: 'sistema', tipo: 'nota', texto: 'a' });
  const tVisto = bus.desde(-Infinity).pop().t;
  bus.publicar({ de: 'sistema', canal: 'sistema', tipo: 'nota', texto: 'b' });   // mismo instante
  caso('/api/mensajes?desde=t incluye el mismo instante', bus.desde(tVisto).map(m => m.texto).join(','), 'a,b');
}

async function main() {
  const sinClave = process.argv.includes('--sin-clave');
  cargarEnv();

  console.log('— Coste con usage y la tabla (1.000 entrada, 500 salida, 2.000 lectura de caché, 1.000 escritura)');
  const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 1000 };
  // 1000·4 + 500·20 + 2000·0,20 + 1000·5 = 19.400 $ por millón → 0,0194 $
  caso('opus-5-5 (4/20/0,20/5 $ por MTok)', costeDeUso(usage, 'claude-opus-5-5').costeUsd, 0.0194);
  // 1000·1 + 500·5 + 2000·0,10 + 1000·1,25 = 4.950 → 0,00495 $
  caso('haiku-4-5 (1/5/0,10/1,25 $ por MTok)', costeDeUso(usage, 'claude-haiku-4-5').costeUsd, 0.00495);

  console.log('— Forma de la petición por modelo');
  const opus = construirPeticion({ modelo: 'claude-opus-5-5', maxTokens: 100, esfuerzo: 'low', sistema: 's', contenido: 'c', esquema: { type: 'object' } });
  caso('opus-5-5 va por beta', opus.via, 'beta');
  caso('opus-5-5 lleva la beta del salvavidas', opus.cuerpo.betas.join(','), 'server-side-fallback-2026-07-01');
  caso("opus-5-5 lleva fallbacks 'default'", opus.cuerpo.fallbacks, 'default');
  caso('opus-5-5 lleva effort', opus.cuerpo.output_config.effort, 'low');
  caso('opus-5-5 sin thinking ni temperature', 'thinking' in opus.cuerpo || 'temperature' in opus.cuerpo, false);
  const haiku = construirPeticion({ modelo: 'claude-haiku-4-5', maxTokens: 100, esfuerzo: 'low', sistema: 's', contenido: 'c', esquema: { type: 'object' } });
  caso('haiku-4-5 va por el endpoint estable', haiku.via, 'estable');
  caso('haiku-4-5 sin effort ni fallbacks', 'effort' in haiku.cuerpo.output_config || 'fallbacks' in haiku.cuerpo, false);

  console.log('— verificarCifras');
  caso('1.234,56 $ presente como 1234.56', verificarCifras('Patrimonio 1.234,56 $', { p: 1234.56 }).ok, true);
  caso('12,5 % presente como 0.125', verificarCifras('Caída del 12,5 %', { c: 0.125 }).ok, true);
  caso('1.999 $ inventado', verificarCifras('Ganamos 1.999 $', { p: 1234.56 }).noEncontradas.join(','), '1.999');

  console.log('— Sin clave: todo cae a plantillas y no cuesta nada');
  const llmSinClave = crearLLM({ apiKey: '' });
  const r = await llmSinClave.pedirJSON({ uso: 'comite', proposito: 'probar', entrada: {}, esquema: { type: 'object' } });
  caso('pedirJSON sin clave', r.motivo, 'sin_clave');
  const mega = await megafono.interpretar('pausa SOL 24 h', { llm: llmSinClave, universo: UNIVERSO, mesas: MESAS });
  caso('Megáfono por palabras clave', mega.fuente, 'palabras_clave');
  caso('Megáfono entiende «pausa SOL 24 h»', JSON.stringify(mega.directivas), JSON.stringify([{ tipo: 'pausar_activo', simbolo: 'SOL/USD', horas: 24 }]));
  const pm = await postmortem.lote({ operaciones: [{ id: 'op-1', mesaId: 'tendencia', simbolo: 'SOL/USD', pnl: -45.2, motivoSalida: 'stop', barras: 2 }], llm: llmSinClave });
  caso('post-mortem por reglas', `${pm[0].fuente}/${pm[0].categoria}`, 'reglas/stop_estrecho');
  caso('gasto del día sin clave', llmSinClave.gastoHoy(), 0);
  console.log(`       ejemplo de plantilla: «${plantillas.estadoPuesto({ etiqueta: 'SOL', marco: '4Hour' })}»`);
  console.log(`       ejemplo de lección:   «${pm[0].leccion}»`);

  await casosRevision();

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey || sinClave) {
    console.log(`— Sin llamada real (${sinClave ? '--sin-clave' : 'no hay ANTHROPIC_API_KEY en el .env'}): coste 0 $.`);
  } else {
    const modelo = process.env.LLM_MODELO_AGENTES || 'claude-opus-5-5';
    console.log(`— Llamada REAL a ${modelo}. AVISO: cuesta dinero, del orden de 0,01 $. Ctrl+C en 3 s para cancelar…`);
    await new Promise(res => setTimeout(res, 3000));
    const llm = crearLLM({ apiKey, modeloAgentes: modelo, modeloComite: modelo, presupuestoDiaUsd: 0.10 });
    const real = await llm.pedirJSON({
      uso: 'agentes',
      proposito: 'probar-llm',
      sistema: 'Respondes solo con el JSON pedido.',
      entrada: { patrimonio: 100000 },
      instrucciones: 'Devuelve { "eco": <el patrimonio de los datos> }.',
      esquema: { type: 'object', properties: { eco: { type: 'number' } }, required: ['eco'], additionalProperties: false },
      maxTokens: 1000,
    });
    if (real.ok) {
      caso('llamada real: el eco del patrimonio', real.datos.eco, 100000);
      console.log(`       modelo ${real.modelo} · tokens ${JSON.stringify(real.tokens)} · coste ${real.costeUsd.toFixed(5)} $`);
    } else {
      caso('llamada real', `${real.motivo}: ${real.detalle}`, 'ok');
    }
  }

  console.log(fallos ? `\n${fallos} caso(s) FALLAN` : '\nTodos los casos cuadran.');
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
