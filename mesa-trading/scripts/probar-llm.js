'use strict';
// Casos conocidos de la infraestructura de agentes (coste, forma de la
// petición, verificarCifras, caída a plantillas). Imprime OK/FALLO por caso y
// sale con código 1 si alguno falla.
//
//   node scripts/probar-llm.js              sin clave: todo cae a plantillas, sin coste
//   node scripts/probar-llm.js --sin-clave  igual aunque haya ANTHROPIC_API_KEY en el .env
//
// Con ANTHROPIC_API_KEY en el .env (y sin --sin-clave) hace además UNA
// llamada real mínima con el modelo de agentes e imprime lo que costó.

const { cargarEnv } = require('../src/config');
const { crearLLM, costeDeUso, construirPeticion } = require('../src/agentes/llm');
const { verificarCifras } = require('../src/agentes/cifras');
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
const MESAS = [{ id: 'tendencia', nombre: 'Tendencia SMA' }];

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
