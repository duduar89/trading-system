'use strict';
// Configuración: variables de entorno (.env) + valores por defecto razonados.
//
// Los LÍMITES DUROS de riesgo viven aquí y solo se cambian editando este
// fichero o data/ajustes.json. Ni el comité (LLM) ni el Megáfono pueden
// subirlos: como mucho los aprietan, y esa directiva caduca en el comité
// siguiente.

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

// Carga mínima de .env (sin dependencias). No pisa variables ya definidas.
function cargarEnv(ruta = path.join(RAIZ, '.env')) {
  let texto;
  try { texto = fs.readFileSync(ruta, 'utf8'); } catch (_) { return; }
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || linea.trim().startsWith('#')) continue;
    let valor = m[2];
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
  }
}

function num(nombre, porDefecto) {
  const v = process.env[nombre];
  if (v === undefined || v === '') return porDefecto;
  const n = Number(v);
  return Number.isFinite(n) ? n : porDefecto;
}

// Argumentos de línea de órdenes del tipo --modo=sintetico --velocidad=600
function leerArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const a of argv) {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

// Valores elegidos en docs/investigacion/critica-sintesis (ver docs/04-riesgo.md).
const LIMITES_DUROS = Object.freeze({
  maxPesoPorActivo: 0.10,          // ningún activo pesa más del 10 % del patrimonio
  maxExposicionBruta: 0.80,        // sin apalancamiento y con un 20 % en efectivo de colchón
  maxExposicionCripto: 0.50,       // las criptos se mueven juntas: como mucho la mitad del fondo
  riesgoPorOperacion: 0.005,       // si salta el stop, se pierde como mucho el 0,5 % del patrimonio
  maxPosiciones: 12,
  perdidaDiariaSoloCerrar: 0.02,   // -2 % en el día: solo se cierran posiciones hasta las 00:00 UTC
  perdidaDiariaKill: 0.035,        // -3,5 % en el día: kill switch
  caidaReducir: 0.10,              // -10 % desde el máximo: posiciones nuevas a la mitad
  caidaKill: 0.15,                 // -15 % desde el máximo: kill switch, reabre un humano
  maxOrdenesMinuto: 10,            // protege de un bucle que dispare órdenes (Alpaca admite 200/min)
  maxOrdenesMesaHora: 4,           // una mesa que se vuelve loca se congela sola
  minNocionalOrden: 10,            // por debajo de 10 $ la comisión de cripto se come la operación
  maxAntiguedadPrecioSegCripto: 180,
  maxAntiguedadPrecioSegAcciones: 120,
  desvioMaxPrecio: 0.02,           // si el precio se ha movido > 2 % desde la decisión, se vuelve a decidir
  penalizacionPapel: 0.001,        // 0,1 % por lado que se resta al medir mesas: el papel llena mejor que la realidad
});

function crearConfig(args = leerArgs()) {
  cargarEnv();
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

  let ajustes = {};
  try { ajustes = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data', 'ajustes.json'), 'utf8')); } catch (_) { /* sin ajustes */ }

  return {
    raiz: RAIZ,
    carpetaDatos: String(args.datos || process.env.CARPETA_DATOS || path.join(RAIZ, 'data')),
    modo,
    puerto: num('PUERTO', Number(args.puerto) || 8765),
    host: process.env.HOST || '127.0.0.1',
    tokenPanel: process.env.PANEL_TOKEN || '',
    velocidad: Number(args.velocidad) || num('VELOCIDAD', 1), // solo modo sintético
    semilla: Number(args.semilla) || num('SEMILLA', 42),
    capitalInicial: num('CAPITAL_INICIAL', 100000),
    alpaca: { claveId: alpacaId, secreto: alpacaSecreto, hay: hayAlpaca },
    llm: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      modeloComite: process.env.LLM_MODELO_COMITE || 'claude-opus-5-5',
      modeloAgentes: process.env.LLM_MODELO_AGENTES || 'claude-opus-5-5',
      presupuestoDiaUsd: num('LLM_PRESUPUESTO_DIA_USD', 2),
    },
    limites: Object.freeze({ ...LIMITES_DUROS, ...(ajustes.limites || {}) }),
    cadencias: {
      latidoMs: num('LATIDO_SEG', 60) * 1000,
      comiteHoras: num('COMITE_HORAS', 4),
    },
  };
}

module.exports = { crearConfig, cargarEnv, leerArgs, LIMITES_DUROS, RAIZ };
