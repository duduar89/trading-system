'use strict';
// Arranque de la mesa: node src/index.js [--modo=auto|alpaca|simulado|sintetico] [--velocidad=600] [--puerto=8765] [--datos=carpeta]
// (--puerto=0: el sistema elige un puerto libre y el banner dice cuál)
//
//   alpaca     cuenta PAPER de Alpaca (datos y bróker, con un solo limitador para los dos)
//   simulado   precios reales de cripto de Alpaca (sin claves) y bróker simulado con 100.000 $
//   sintetico  precios inventados y reloj acelerado: 5 min simulados por paso, `velocidad` veces más rápido
//
// Orden del arranque, y por qué:
//   1. HOST abierto a la red (0.0.0.0, una IP de la wifi) sin PANEL_TOKEN → no
//      arranca: cualquiera en la misma red podría pausar, reabrir o lanzar el kill.
//   2. Bloqueo de la carpeta de datos (data/.proceso) ANTES de construir nada:
//      el bróker simulado ya escribe su fichero al crearse, y dos procesos sobre
//      la misma carpeta se pisarían estado, órdenes e idCliente.
//   3. listen() ANTES de orquestador.iniciar(): con el puerto ocupado se para
//      aquí, sin haber resuelto órdenes, guardado estado ni publicado nada.
//      Mientras arranca, la API responde 503 y los estáticos ya se sirven.
//
// Ctrl+C guarda el estado y sale limpio. Si el latido en curso no acaba en
// 10 s (red colgada), sale sin esperarlo: vale lo guardado en el último
// latido. Un segundo Ctrl+C sale en el acto. En Windows, cerrar la ventana
// (SIGHUP) y Ctrl+Pausa (SIGBREAK) también guardan.

const os = require('os');
const path = require('path');
const { crearConfig, leerArgs, esLoopback, PROXY_ACTIVO } = require('./config');
const { RelojReal, RelojSimulado, inicioVela, MIN } = require('./util/reloj');
const { tomarBloqueo, soltarBloqueo } = require('./util/proceso');
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
const TOPE_CIERRE_MS = 10_000;
const TOPE_CIERRE_VENTANA_MS = 3_000;   // Windows mata el proceso unos 10 s después de cerrar la ventana
const dormir = ms => new Promise(r => setTimeout(r, ms));
const CLAVES_PROXY_ENTORNO = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'];
const CONSEJO_PROXY = 'arranca con npm run start-proxy (Node 22.21 o posterior)';

// Construye todas las piezas según el modo. Lo usan este arranque, la demo
// acelerada y las pruebas de integración.
// `llmOpciones` va tal cual a crearLLM (el modo latido pone ahí los topes de
// tiempo: limiteLlamadaMs, reintentos, plazo).
function construir(config, { opciones = {}, llm: llmInyectado, reloj: relojInyectado, llmOpciones = {} } = {}) {
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
    ...llmOpciones,
  });
  const bus = new Bus({ reloj, ruta: path.join(carpeta, 'mensajes.jsonl') });
  const orquestador = new Orquestador({ config, reloj, datos, broker, llm, fg, bus, modo: config.modo, velocidad: config.velocidad, opciones });
  return { reloj, datos, broker, fg, llm, bus, orquestador };
}

const cifra = v => Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2 });

function duracion(seg) {
  if (seg < 90) return `${Math.round(seg)} s`;
  if (seg < 90 * 60) return `${Math.round(seg / 60)} min`;
  return `${cifra(Math.round(seg / 360) / 10)} h`;
}

function esComodin(host) {
  const h = String(host || '').trim().replace(/^\[|\]$/g, '');
  return h === '0.0.0.0' || h === '::' || h === '';
}

// Lo que manda de verdad: con Ajustes guardados, esos valores pisan el .env al
// iniciar (orquestador._aplicarAjustes). El banner enseña los que se aplican.
function lineaLLM(config, llm) {
  if (!llm || !llm.activo) return 'apagado: sin ANTHROPIC_API_KEY los agentes hablan con plantillas';
  const s = llm.estado();
  return `activo (comité ${s.modeloComite}, agentes ${s.modeloAgentes}, tope ${cifra(s.presupuestoDiaUsd)} $/día)`;
}

function hayProxyEnEntorno(entorno) {
  return CLAVES_PROXY_ENTORNO.some(k => Boolean(entorno[k]));
}

// Avisos del banner. `entorno` es el entorno del sistema (el .env ya no mete
// en process.env las claves de proxy: config.js las aparta).
function avisosDeArranque({ config, llm, orquestador, entorno = process.env }) {
  const sintetico = config.modo === 'sintetico';
  const avisos = [];
  if (!sintetico && !(config.alpaca && config.alpaca.hay)) avisos.push('Sin claves de Alpaca: solo cripto, con el bróker simulado.');
  const proxy = config.proxy || { activo: PROXY_ACTIVO, ignoradasEnEnv: [] };
  if (!sintetico && !proxy.activo && hayProxyEnEntorno(entorno)) {
    avisos.push(`Hay un proxy en el entorno y Node no lo usa: si no llegan precios, ${CONSEJO_PROXY}.`);
  }
  if (config.limitesIgnorados && config.limitesIgnorados.length) {
    avisos.push(`ajustes.json intenta aflojar ${config.limitesIgnorados.join(', ')}: no se aplica. Ahí solo se pueden apretar los límites; para aflojarlos hay que editar src/config.js.`);
  }
  if (!sintetico && proxy.ignoradasEnEnv && proxy.ignoradasEnEnv.length) {
    avisos.push(`El .env trae ${proxy.ignoradasEnEnv.join(', ')}, que ahí no valen: Node lee el proxy al arrancar. Ponlas en las variables del sistema y ${CONSEJO_PROXY}.`);
  }
  if (llm && llm.activo) {
    const s = llm.estado();
    const difiere = [];
    if (s.presupuestoDiaUsd !== config.llm.presupuestoDiaUsd) difiere.push(`tope ${cifra(config.llm.presupuestoDiaUsd)} $/día`);
    if (s.modeloComite !== config.llm.modeloComite) difiere.push(`comité ${config.llm.modeloComite}`);
    if (s.modeloAgentes !== config.llm.modeloAgentes) difiere.push(`agentes ${config.llm.modeloAgentes}`);
    if (difiere.length) avisos.push(`El LLM usa lo guardado desde Ajustes, no el .env (que dice ${difiere.join(', ')}). Se cambia desde Ajustes en el panel.`);
    if (sintetico) {
      const velocidad = Math.max(1, Number(orquestador && orquestador.velocidad) || 1);
      const horas = (config.cadencias && config.cadencias.comiteHoras) || 4;
      avisos.push(`La demo tiene ANTHROPIC_API_KEY: los agentes llaman a la IA y gastan dinero real (tope ${cifra(s.presupuestoDiaUsd)} $/día). A ×${cifra(velocidad)} hay un comité cada ${duracion(horas * 3600 / velocidad)} reales.`);
    }
  }
  avisos.push('Con el ordenador apagado no hay stops: en cripto no existen órdenes stop simples.');
  if (orquestador && orquestador.estado && orquestador.estado.fondo.nivel === 'bloqueado') avisos.push('El fondo arranca BLOQUEADO: solo sale con Reabrir desde el panel.');
  return avisos;
}

// Consejo cuando el arranque falla por red, o null si el error no es de red.
function consejoSinRed(e, { proxyActivo = PROXY_ACTIVO, entorno = process.env } = {}) {
  const texto = String(e && (e.message + (e.cause ? ` ${e.cause.message || e.cause.code || ''}` : '')));
  if (!/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|sin respuesta/i.test(texto)) return null;
  if (proxyActivo) return 'El proxy o la red no responden (Node ya usa el proxy): comprueba la conexión y vuelve a arrancar.';
  if (hayProxyEnEntorno(entorno)) return `Hay un proxy en el entorno y Node no lo usa: ${CONSEJO_PROXY}.`;
  return 'Sin red: comprueba la conexión a internet y vuelve a arrancar.';
}

// URL(s) del panel. Con un host abierto (0.0.0.0) esa dirección no se puede
// abrir en el navegador: se dan la local y las de la red de esta máquina.
function urlsDelPanel({ host, puerto, token }) {
  const sufijo = token ? `?token=${encodeURIComponent(token)}` : '';
  const url = h => `http://${String(h).includes(':') ? `[${h}]` : h}:${puerto}/${sufijo}`;
  if (!esComodin(host)) return [url(String(host).replace(/^\[|\]$/g, ''))];
  const red = [];
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) if (i && !i.internal && (i.family === 'IPv4' || i.family === 4)) red.push(i.address);
  }
  return [url('127.0.0.1'), ...red.map(url)];
}

function escuchar(servidor, puerto, host) {
  return new Promise((resolver, rechazar) => {
    const alFallar = (e) => {
      servidor.off('listening', alEscuchar);
      if (e.code === 'EADDRINUSE') rechazar(new Error(`El puerto ${puerto} ya está en uso en ${host}: ¿hay otra mesa (u otro programa) abierta? Ciérrala o arranca con --puerto=…`));
      else if (e.code === 'EACCES') rechazar(new Error(`Sin permiso para escuchar en ${host}:${puerto}: usa un puerto por encima de 1024 (--puerto=…).`));
      else if (e.code === 'EADDRNOTAVAIL') rechazar(new Error(`HOST=${host} no es una dirección de esta máquina.`));
      else rechazar(e);
    };
    const alEscuchar = () => { servidor.off('error', alFallar); resolver(); };
    servidor.once('error', alFallar);
    servidor.once('listening', alEscuchar);
    servidor.listen(puerto, host);
  });
}

async function main() {
  const args = leerArgs();
  const config = crearConfig(args);
  if (args.inicio) config.inicio = Date.parse(args.inicio);
  const sintetico = config.modo === 'sintetico';

  if (!esLoopback(config.host) && !config.tokenPanel) {
    throw new Error(`HOST=${config.host} abre el panel a toda la red y no hay PANEL_TOKEN: cualquiera en la misma wifi podría ver la cartera, pausar, reabrir tras un kill, lanzar el kill o subir el gasto del LLM. Pon un PANEL_TOKEN largo en el .env o quita HOST.`);
  }

  tomarBloqueo(config.carpetaDatos);
  let servidor = null;
  let piezas;
  try {
    piezas = construir(config, {
      opciones: {
        pausaComiteMs: 1500,              // se ve a los jefes hablar uno detrás de otro
        descansoMinPantallaMs: sintetico ? 20_000 : 0,
        respetarVelocidadGuardada: !args.velocidad,
      },
    });
    servidor = crearServidor({ orquestador: piezas.orquestador, raizWeb: path.join(config.raiz, 'web'), carpetaDatos: config.carpetaDatos, token: config.tokenPanel, host: config.host });
    await escuchar(servidor, config.puerto, config.host);
    await piezas.orquestador.iniciar();
  } catch (e) {
    if (servidor && servidor.listening) await new Promise(r => servidor.close(() => r()));
    soltarBloqueo(config.carpetaDatos);
    throw e;
  }
  servidor.on('error', e => log.error(`servidor: ${e.message}`));
  const { orquestador, reloj, llm } = piezas;
  const [url, ...otras] = urlsDelPanel({ host: config.host, puerto: servidor.address().port, token: config.tokenPanel });

  const lineas = [
    '',
    '  Mesa de agentes · solo papel',
    `  Modo: ${config.modo === 'alpaca' ? 'PAPEL ALPACA' : sintetico ? `SINTÉTICO ×${orquestador.velocidad}` : 'SIMULADO (precios reales de cripto, bróker simulado)'}`,
    `  Panel: ${url}`,
    ...otras.map(u => `         ${u}`),
    `  Patrimonio: ${Math.round(orquestador.vivo.patrimonio).toLocaleString('es-ES')} $ · nivel ${orquestador.estado.fondo.nivel}`,
    `  LLM: ${lineaLLM(config, llm)}`,
    `  Datos: ${config.carpetaDatos}`,
  ];
  const avisos = avisosDeArranque({ config, llm, orquestador });

  let parar = false;
  let cerrando = null;
  // Salida sin esperar al latido en curso. Con un latido a medias NO se guarda:
  // vale el estado.json del último latido completo (es la recuperación de un
  // corte, ya probada); guardar a mitad podría dejar las cadencias adelantadas
  // sin haberlas hecho. Sin latido en marcha, se guarda lo que haya.
  const salirYa = (codigo) => {
    if (orquestador.iniciado && !orquestador._ocupado) {
      try { orquestador.guardar(); } catch (e) { log.error(`al guardar: ${e.message}`); }
    }
    soltarBloqueo(config.carpetaDatos);
    process.exit(codigo);
  };
  const cerrar = (senal, topeMs) => {
    if (cerrando) {
      console.log(`\n  Salgo ya (${senal} otra vez): vale lo guardado en el último latido.`);
      salirYa(130);
      return cerrando;
    }
    parar = true;
    cerrando = (async () => {
      console.log(`\n  ${senal}: guardando el estado y cerrando… (otro Ctrl+C sale ya)`);
      servidor.close();   // no se aceptan más comandos mientras se espera
      let temporizador;
      const r = await Promise.race([
        orquestador.detener().then(() => 'ok', e => e || new Error('error desconocido')),
        new Promise(res => { temporizador = setTimeout(res, topeMs, 'tope'); }),
      ]);
      clearTimeout(temporizador);
      if (r === 'ok') {
        console.log('  Estado guardado. Hasta luego.');
        process.exit(0);
      }
      if (r === 'tope') {
        console.log(orquestador._ocupado
          ? `  El latido en curso no acaba en ${topeMs / 1000} s (¿la red no responde?): salgo sin esperarlo; vale lo guardado en el último latido.`
          : `  Quedan tareas de fondo sin acabar tras ${topeMs / 1000} s (laboratorio, comité o backtests): guardo el estado y salgo; lo que quedó a medias se retoma al arrancar.`);
        salirYa(0);
        return;
      }
      log.error(`al detener: ${r.message}`);
      console.log(`  No se pudo guardar el estado al cerrar (${r.message}): vale el del último latido.`);
      soltarBloqueo(config.carpetaDatos);
      process.exit(1);
    })();
    return cerrando;
  };
  process.on('SIGINT', () => cerrar('Ctrl+C', TOPE_CIERRE_MS));
  process.on('SIGTERM', () => cerrar('SIGTERM', TOPE_CIERRE_MS));
  process.on('SIGBREAK', () => cerrar('Ctrl+Pausa', TOPE_CIERRE_MS));
  // SIGHUP solo en Windows (cerrar la ventana de la consola). En Linux y Mac,
  // manejarlo anularía el nohup de quien arranca la mesa en segundo plano.
  if (process.platform === 'win32') process.on('SIGHUP', () => cerrar('Ventana cerrada', TOPE_CIERRE_VENTANA_MS));

  // El banner, DESPUÉS de los manejadores: dice «Ctrl+C para parar (guarda el
  // estado)», y un Ctrl+C que llegara entre el banner y process.on('SIGINT')
  // mataría el proceso sin guardar ni soltar el bloqueo (quien lanza la mesa
  // desde un script manda la señal en cuanto lee la línea).
  console.log([...lineas, ...avisos.map(a => `  Aviso: ${a}`), '  Ctrl+C para parar (guarda el estado).', ''].join('\n'));

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
    const consejo = consejoSinRed(e);
    if (consejo) console.error(consejo);
    process.exit(1);
  });
}

module.exports = { construir, main, PASO_SINTETICO, lineaLLM, avisosDeArranque, consejoSinRed, urlsDelPanel };
