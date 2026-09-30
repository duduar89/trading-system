'use strict';
// Configuración: variables de entorno (.env) + valores por defecto razonados.
//
// Los LÍMITES DUROS de riesgo viven aquí y solo se cambian editando este
// fichero, o apretarlos con ajustes.json en la carpeta de datos. Ni el comité (LLM) ni el Megáfono pueden
// subirlos: como mucho los aprietan, y esa directiva caduca en el comité
// siguiente.

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

// Node solo lee el proxy (NODE_USE_ENV_PROXY, --use-env-proxy y las
// variables HTTP(S)_PROXY) AL ARRANCAR: ponerlas en el .env no hace nada, y
// copiarlas a process.env haría creer a index.js que el proxy está activo.
// Por eso se mira aquí, antes de cargar el .env, y esas claves no se copian.
const CLAVES_PROXY = new Set(['NODE_USE_ENV_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']);
const PROXY_ACTIVO = Boolean(process.env.NODE_USE_ENV_PROXY)
  || process.execArgv.includes('--use-env-proxy')
  || /(^|\s)--use-env-proxy\b/.test(process.env.NODE_OPTIONS || '');

// Carga mínima de .env (sin dependencias). No pisa variables ya definidas.
// Devuelve { ignoradas }: las claves de proxy que traía el .env (no valen ahí).
function cargarEnv(ruta = path.join(RAIZ, '.env')) {
  const ignoradas = [];
  let texto;
  try { texto = fs.readFileSync(ruta, 'utf8'); } catch (_) { return { ignoradas }; }
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || linea.trim().startsWith('#')) continue;
    if (CLAVES_PROXY.has(m[1])) { ignoradas.push(m[1]); continue; }
    let valor = m[2];
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
  }
  return { ignoradas };
}

// Número de una variable de entorno. En español se escribe «0,5»: una sola
// coma decimal se acepta. Lo que no es un número para el arranque con el
// nombre de la variable (antes caía en silencio al valor por defecto: un tope
// de 0,5 $ se convertía en 2 $). Vacío o solo espacios → valor por defecto.
function num(nombre, porDefecto) {
  const v = process.env[nombre];
  if (v === undefined || String(v).trim() === '') return porDefecto;
  const limpio = String(v).trim().replace(/^(-?\d+),(\d+)$/, '$1.$2');
  const n = Number(limpio);
  if (!Number.isFinite(n)) throw new Error(`${nombre}=${v} no es un número (escribe 0.5 o 0,5; los miles sin punto: 100000)`);
  return n;
}

// ¿El host solo escucha en esta máquina? 0.0.0.0, :: o una IP de la red abren
// el panel a todo el que comparta la wifi.
function esLoopback(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h) || /^::ffff:127\./.test(h);
}

// Argumentos de línea de órdenes del tipo --modo=sintetico --velocidad=600
// --puerto=N. El 0 vale: el sistema elige un puerto libre y el banner dice
// cuál (lo usan las pruebas que lanzan la mesa en paralelo: un puerto «libre»
// pedido antes y soltado lo puede coger otro proceso mientras la mesa arranca).
// Sin número válido, el de siempre.
function puertoDeArgs(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 8765;
}

function leerArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const a of argv) {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

// Valores de docs/investigacion/critica-sintesis, revisados el 30-sep-2026 con
// velas reales de Alpaca (BTC/ETH/SOL, 2021 → sep-2026, costes y penalización
// de papel): riesgo por operación, kill por caída y kill por pérdida del día.
// Las cifras salen de `node scripts/estudiar-limites.js` (docs/04-riesgo-y-mejora.md).
const LIMITES_DUROS = Object.freeze({
  maxPesoPorActivo: 0.10,          // ningún activo pesa más del 10 % del patrimonio. Con 15 % o 20 % momentum
                                   // no mejora (Sharpe 0,72 → 0,71 / 0,70): manda el objetivo de volatilidad
  maxExposicionBruta: 0.80,        // sin apalancamiento y con un 20 % en efectivo de colchón
  maxExposicionCripto: 0.50,       // las criptos se mueven juntas: como mucho la mitad del fondo
  // Si salta el stop, se pierde como mucho el 1 % del patrimonio (Eduardo puso el techo en 2 %).
  // Cartera de arranque anterior sin protección: 0,5 % → CAGR 4,9 %, Sharpe 0,56, caída 16,8 %;
  // 1 % → 8,5 %, 0,61, 26,7 %; 1,5 % → 10,3 %, 0,65, 29,5 %; 2 % → 10,0 %, 0,63, 30,9 %. Con el
  // ×0,5 a −10 %, 1 % da CAGR 6,5 % y caída 21,5 %, y 1,5 % ya no rinde más (6,3 %): el tope por
  // activo satura. Los huecos saltan el stop: con 2 % la peor operación costó un 3,31 % del fondo.
  riesgoPorOperacion: 0.01,
  maxPosiciones: 12,
  perdidaDiariaSoloCerrar: 0.02,   // -2 % en el día: solo se cierran posiciones hasta las 00:00 UTC
  // -7 % en el día: kill switch. Con riesgo 1 % y el ×0,5, el peor día de 5 años fue −6,39 %: el kill
  // es para cuando algo se rompe (bucle, datos malos, hueco extremo), no para un mal día de la
  // cripto, que ya lo frena el solo cerrar del −2 %. Con −3,5 % habría saltado 3 veces.
  perdidaDiariaKill: 0.07,
  caidaReducir: 0.10,              // -10 % desde el máximo: posiciones nuevas a la mitad
  // -25 % desde el máximo: kill switch, reabre un humano. Con riesgo 1 % y el ×0,5, en 5 años la
  // caída cruzó −15 % y −20 % una vez (el bajista de 2022) y −25 % ninguna (máxima 21,5 %): un
  // bajista normal lo gestiona el ×0,5; el kill queda para lo que no es normal.
  caidaKill: 0.25,
  maxOrdenesMinuto: 10,            // protege de un bucle que dispare órdenes (Alpaca admite 200/min)
  maxOrdenesMesaHora: 4,           // una mesa que se vuelve loca se congela sola
  minNocionalOrden: 10,            // por debajo de 10 $ la comisión de cripto se come la operación
  // El venue cripto de Alpaca es poco líquido: ETH llegó a tener la cotización
  // con 8 min de antigüedad (29-sep-2026). Las señales van en velas de 4 h y 1 d
  // y la orden es a mercado con control de desvío, así que 15 min basta para
  // detectar un dato caído sin vetar aperturas buenas.
  maxAntiguedadPrecioSegCripto: 900,
  maxAntiguedadPrecioSegAcciones: 120,
  desvioMaxPrecio: 0.02,           // si el precio se ha movido > 2 % desde la decisión, se vuelve a decidir
  penalizacionPapel: 0.001,        // 0,1 % por lado que se resta al medir mesas: el papel llena mejor que la realidad
});

// En estos dos, más es más prudente; en todos los demás, menos.
const MAS_ES_PRUDENTE = new Set(['minNocionalOrden', 'penalizacionPapel']);

// Límites de ajustes.json: solo valen si aprietan. Un valor que afloja, que no
// es un número o que no es un límite conocido se ignora y se avisa.
function apretarLimites(base, propuestos = {}) {
  const limites = { ...base };
  const ignorados = [];
  for (const [k, v] of Object.entries(propuestos || {})) {
    if (!(k in base) || typeof v !== 'number' || !Number.isFinite(v) || v < 0) { ignorados.push(k); continue; }
    const aprieta = MAS_ES_PRUDENTE.has(k) ? v >= base[k] : v <= base[k];
    if (aprieta) limites[k] = v; else ignorados.push(k);
  }
  return { limites: Object.freeze(limites), ignorados };
}

function crearConfig(args = leerArgs()) {
  const { ignoradas } = cargarEnv();
  const alpacaId = process.env.ALPACA_API_KEY_ID || '';
  const alpacaSecreto = process.env.ALPACA_API_SECRET_KEY || '';
  const hayAlpaca = Boolean(alpacaId && alpacaSecreto);

  // auto: con claves de Alpaca → cuenta paper de Alpaca; sin claves → bróker
  // simulado con precios reales de cripto. 'sintetico' = precios inventados y
  // reloj acelerado, para la demo y las pruebas.
  let modo = String(args.modo || process.env.MODO || 'auto');
  if (modo === 'auto') modo = hayAlpaca ? 'alpaca' : 'simulado';
  if (modo === 'alpaca' && !hayAlpaca) {
    throw new Error('MODO=alpaca necesita ALPACA_API_KEY_ID y ALPACA_API_SECRET_KEY en el .env');
  }

  const carpetaDatos = String(args.datos || process.env.CARPETA_DATOS || path.join(RAIZ, 'data'));
  let ajustes = {};
  try { ajustes = JSON.parse(fs.readFileSync(path.join(carpetaDatos, 'ajustes.json'), 'utf8')); } catch (_) { /* sin ajustes */ }
  const { limites, ignorados: limitesIgnorados } = apretarLimites(LIMITES_DUROS, ajustes.limites);

  return {
    raiz: RAIZ,
    carpetaDatos,
    modo,
    puerto: num('PUERTO', puertoDeArgs(args.puerto)),
    host: process.env.HOST || '127.0.0.1',
    tokenPanel: process.env.PANEL_TOKEN || '',
    velocidad: Number(args.velocidad) || num('VELOCIDAD', 1), // solo modo sintético
    semilla: Number(args.semilla) || num('SEMILLA', 42),
    capitalInicial: num('CAPITAL_INICIAL', 100000),
    alpaca: { claveId: alpacaId, secreto: alpacaSecreto, hay: hayAlpaca },
    llm: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      // El comité decide (Opus); los agentes solo redactan y clasifican con
      // listas cerradas: Haiku 4.5 cuesta 1/5 $ por MTok frente a 4/20 $.
      modeloComite: process.env.LLM_MODELO_COMITE || 'claude-opus-5-5',
      modeloAgentes: process.env.LLM_MODELO_AGENTES || 'claude-haiku-4-5',
      presupuestoDiaUsd: num('LLM_PRESUPUESTO_DIA_USD', 1),
    },
    limites,
    // Límites de ajustes.json que no se aplicaron porque aflojaban (el arranque lo dice).
    limitesIgnorados,
    cadencias: {
      latidoMs: num('LATIDO_SEG', 60) * 1000,
      comiteHoras: num('COMITE_HORAS', 4),
    },
    // Proxy: si está activo de verdad (se decide al arrancar Node) y qué claves
    // de proxy traía el .env sin efecto, para que el arranque lo diga.
    proxy: { activo: PROXY_ACTIVO, ignoradasEnEnv: ignoradas },
  };
}

module.exports = { crearConfig, apretarLimites, cargarEnv, leerArgs, num, esLoopback, LIMITES_DUROS, RAIZ, PROXY_ACTIVO, CLAVES_PROXY };
