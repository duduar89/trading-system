'use strict';
// Arranque de la mesa: node src/index.js [--modo=auto|alpaca|simulado|sintetico] [--velocidad=600] [--puerto=8765] [--datos=carpeta]
//
//   alpaca     cuenta PAPER de Alpaca (datos y bróker, con un solo limitador para los dos)
//   simulado   precios reales de cripto de Alpaca (sin claves) y bróker simulado con 100.000 $
//   sintetico  precios inventados y reloj acelerado: 5 min simulados por paso, `velocidad` veces más rápido
//
// Ctrl+C guarda el estado y sale limpio.

const path = require('path');
const { crearConfig, leerArgs } = require('./config');
const { RelojReal, RelojSimulado, inicioVela, MIN } = require('./util/reloj');
const { AlpacaDatos } = require('./mercado/alpaca-datos');
const { DatosSinteticos } = require('./mercado/sintetico');
const { MiedoCodicia } = require('./mercado/sentimiento');
const { Limitador } = require('./mercado/limitador');
const { AlpacaBroker } = require('./broker/alpaca-broker');
const { BrokerSimulado } = require('./broker/simulado');
const { crearLLM } = require('./agentes/llm');
const { Bus } = require('./agentes/bus');
const { Orquestador } = require('./orquestador');
const { crearServidor } = require('./servidor');
const log = require('./util/log').crear('mesa');

const PASO_SINTETICO = 5 * MIN;
const dormir = ms => new Promise(r => setTimeout(r, ms));

// Construye todas las piezas según el modo. Lo usan este arranque, la demo
// acelerada y las pruebas de integración.
function construir(config, { opciones = {}, llm: llmInyectado, reloj: relojInyectado } = {}) {
  const carpeta = config.carpetaDatos;
  const cache = path.join(carpeta, 'cache');
  let reloj;
  let datos;
  let broker;
  let fg;
  if (config.modo === 'sintetico') {
    // Tras un reinicio, el reloj y el ancla de precios salen del estado guardado:
    // si no, los precios se reanclarían y la cartera cambiaría de valor sola.
    const guardado = Orquestador.leerEstadoGuardado(carpeta);
    const inicio = guardado && guardado.sintetico && Number.isFinite(guardado.sintetico.inicio)
      ? guardado.sintetico.inicio
      : (Number.isFinite(config.inicio) ? config.inicio : inicioVela(Date.now(), PASO_SINTETICO));
    const semilla = guardado && guardado.sintetico && Number.isFinite(guardado.sintetico.semilla) ? guardado.sintetico.semilla : config.semilla;
    reloj = relojInyectado || new RelojSimulado(guardado && Number.isFinite(guardado.ahora) ? guardado.ahora : inicio);
    datos = new DatosSinteticos({ semilla, reloj, inicio });
    fg = new MiedoCodicia({ reloj, sintetico: datos });
    broker = new BrokerSimulado({ capitalInicial: config.capitalInicial, fuente: datos, reloj, ruta: path.join(carpeta, 'broker-simulado.json') });
  } else {
    reloj = relojInyectado || new RelojReal();
    const limitador = new Limitador();   // UNO para datos y trading: la cuota es por cuenta
    datos = new AlpacaDatos({ claveId: config.alpaca.claveId, secreto: config.alpaca.secreto, reloj, carpetaCache: cache, limitador });
    fg = new MiedoCodicia({ reloj, carpetaCache: cache });
    broker = config.modo === 'alpaca'
      ? new AlpacaBroker({ claveId: config.alpaca.claveId, secreto: config.alpaca.secreto, reloj, limitador })
      : new BrokerSimulado({ capitalInicial: config.capitalInicial, fuente: datos, reloj, ruta: path.join(carpeta, 'broker-simulado.json') });
  }
  const llm = llmInyectado || crearLLM({
    apiKey: config.llm.apiKey, modeloComite: config.llm.modeloComite, modeloAgentes: config.llm.modeloAgentes,
    presupuestoDiaUsd: config.llm.presupuestoDiaUsd, reloj, rutaCostes: path.join(carpeta, 'llm-costes.jsonl'),
  });
  const bus = new Bus({ reloj, ruta: path.join(carpeta, 'mensajes.jsonl') });
  const orquestador = new Orquestador({ config, reloj, datos, broker, llm, fg, bus, modo: config.modo, velocidad: config.velocidad, opciones });
  return { reloj, datos, broker, fg, llm, bus, orquestador };
}

async function main() {
  const args = leerArgs();
  const config = crearConfig(args);
  if (args.inicio) config.inicio = Date.parse(args.inicio);
  const sintetico = config.modo === 'sintetico';
  const piezas = construir(config, {
    opciones: {
      pausaComiteMs: 1500,              // se ve a los jefes hablar uno detrás de otro
      descansoMinPantallaMs: sintetico ? 20_000 : 0,
      respetarVelocidadGuardada: !args.velocidad,
    },
  });
  const { orquestador, reloj, llm } = piezas;
  await orquestador.iniciar();
  const servidor = crearServidor({ orquestador, raizWeb: path.join(config.raiz, 'web'), carpetaDatos: config.carpetaDatos, token: config.tokenPanel });
  await new Promise((resolver, rechazar) => {
    servidor.once('error', rechazar);
    servidor.listen(config.puerto, config.host, resolver);
  });
  const direccion = servidor.address();
  const url = `http://${config.host}:${direccion.port}/${config.tokenPanel ? `?token=${encodeURIComponent(config.tokenPanel)}` : ''}`;

  const lineas = [
    '',
    '  Mesa de agentes · solo papel',
    `  Modo: ${config.modo === 'alpaca' ? 'PAPEL ALPACA' : sintetico ? `SINTÉTICO ×${orquestador.velocidad}` : 'SIMULADO (precios reales de cripto, bróker simulado)'}`,
    `  Panel: ${url}`,
    `  Patrimonio: ${Math.round(orquestador.vivo.patrimonio).toLocaleString('es-ES')} $ · nivel ${orquestador.estado.fondo.nivel}`,
    `  LLM: ${llm.activo ? `activo (comité ${config.llm.modeloComite}, agentes ${config.llm.modeloAgentes}, tope ${config.llm.presupuestoDiaUsd} $/día)` : 'apagado: sin ANTHROPIC_API_KEY los agentes hablan con plantillas'}`,
    `  Datos: ${config.carpetaDatos}`,
  ];
  const avisos = [];
  if (!config.alpaca.hay && !sintetico) avisos.push('Sin claves de Alpaca: solo cripto, con el bróker simulado.');
  if (!sintetico && !process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
    avisos.push('Hay un proxy en el entorno: si no llegan precios, arranca con NODE_USE_ENV_PROXY=1 (el fetch de Node lo necesita).');
  }
  if (!sintetico) avisos.push('Si no hay red o no llegan precios, prueba con NODE_USE_ENV_PROXY=1 npm start.');
  avisos.push('Con el ordenador apagado no hay stops: en cripto no existen órdenes stop simples.');
  if (orquestador.estado.fondo.nivel === 'bloqueado') avisos.push('El fondo arranca BLOQUEADO: solo sale con Reabrir desde el panel.');
  console.log([...lineas, ...avisos.map(a => `  Aviso: ${a}`), '  Ctrl+C para parar (guarda el estado).', ''].join('\n'));

  let parar = false;
  let cerrando = null;
  const cerrar = async (senal) => {
    if (cerrando) return cerrando;
    parar = true;
    cerrando = (async () => {
      console.log(`\n  ${senal}: guardando el estado y cerrando…`);
      try { await orquestador.detener(); } catch (e) { log.error(`al detener: ${e.message}`); }
      await new Promise(r => servidor.close(() => r()));
      console.log('  Estado guardado. Hasta luego.');
      process.exit(0);
    })();
    return cerrando;
  };
  process.on('SIGINT', () => cerrar('Ctrl+C'));
  process.on('SIGTERM', () => cerrar('SIGTERM'));

  // Bucle: tiempo real → un paso por latido; sintético → avanza el reloj 5 min
  // y duerme (5 min / velocidad) de tiempo real.
  while (!parar) {
    const t0 = Date.now();
    if (sintetico) reloj.avanzar(PASO_SINTETICO);
    try { await orquestador.paso(); } catch (e) { log.error(`paso: ${e.message}`); }
    const objetivo = sintetico ? PASO_SINTETICO / Math.max(1, orquestador.velocidad) : config.cadencias.latidoMs;
    await dormir(Math.max(0, objetivo - (Date.now() - t0)));
  }
}

if (require.main === module) {
  main().catch(e => {
    console.error(`No se pudo arrancar la mesa: ${e.message}`);
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(String(e && (e.message + (e.cause ? e.cause.message : ''))))) {
      console.error('Sin red: si estás detrás de un proxy, prueba con NODE_USE_ENV_PROXY=1.');
    }
    process.exit(1);
  });
}

module.exports = { construir, main, PASO_SINTETICO };
