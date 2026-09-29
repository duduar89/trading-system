'use strict';
// Catálogo de familias y mesas iniciales (§4.3). Los valores por defecto no se
// optimizan en vivo: solo el laboratorio puede proponer otros, y por la
// gramática cerrada (rejilla + filtros).

const tendenciaSma = require('./tendencia-sma');
const momentumRotacion = require('./momentum-rotacion');
const reversionRsi = require('./reversion-rsi');
const rupturaDonchian = require('./ruptura-donchian');
const comun = require('./comun');

const FAMILIAS = Object.freeze({
  'tendencia-sma': tendenciaSma,
  'momentum-rotacion': momentumRotacion,
  'reversion-rsi': reversionRsi,
  'ruptura-donchian': rupturaDonchian,
});

const CRIPTO = Object.freeze(['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD']);

// Copia profunda sencilla: los params de una mesa se persisten y se editan; no
// deben compartir arrays con los valores por defecto congelados.
function copia(x) { return JSON.parse(JSON.stringify(x)); }

function mesa(id, nombre, estrategia, universo, params, estado = 'titular', nota = null) {
  return {
    id,
    nombre,
    familia: estrategia.familia,
    marco: estrategia.marco,
    universo: [...universo],
    params: copia(params || estrategia.parametrosPorDefecto),
    filtros: [],
    estado,
    origen: 'inicial',
    nota,
  };
}

// Tendencia 4H y Reversión cripto arrancan en incubación (2 % del capital) y no
// como titulares: con velas reales de Alpaca de 2021 a sep-2026 y costes
// incluidos pierden (Sharpe −0,51 y −0,42; tendencia pagó 4.478 $ de
// comisiones sobre 10.000 $ en 548 operaciones). Tienen que ganarse el puesto
// en papel como cualquier estrategia nueva. Ver scripts/probar-backtest.js --real.
function mesasIniciales({ hayAlpaca = false } = {}) {
  const mesas = [
    mesa('tendencia', 'Tendencia SMA', tendenciaSma, ['BTC/USD', 'ETH/USD', 'SOL/USD'], null, 'incubacion',
      'Backtest real 2021-2026 con costes: Sharpe −0,51. Empieza en prueba con el 2 %.'),
    mesa('momentum', 'Momentum cripto', momentumRotacion, CRIPTO),
    mesa('reversion', 'Reversión RSI', reversionRsi, ['BTC/USD', 'ETH/USD'], null, 'incubacion',
      'Backtest real 2021-2026 con costes: Sharpe −0,42. Empieza en prueba con el 2 %.'),
    mesa('ruptura', 'Ruptura Donchian', rupturaDonchian, ['BTC/USD', 'ETH/USD', 'SOL/USD']),
  ];
  if (hayAlpaca) {
    mesas.push(mesa('momentum-etf', 'Momentum ETF', momentumRotacion, ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD'], momentumRotacion.parametrosEtf));
    mesas.push(mesa('reversion-etf', 'Reversión ETF', reversionRsi, ['SPY', 'QQQ']));
  }
  return mesas;
}

// Velas mínimas que hay que pasar a preparar() en vivo para que la decisión
// del último índice sea la del backtest con todo el histórico. Las medias
// simples solo miran su ventana, pero el ATR y el RSI de Wilder recuerdan su
// semilla: tras 15 periodos de ATR esa memoria es (1 − 1/n)^(15n) < 2·10⁻⁷.
// Si la mesa lleva el filtro vol-max, hace falta además su año de ventana.
function velasNecesarias(mesa) {
  const e = FAMILIAS[mesa.familia];
  if (!e) throw new Error(`familia desconocida: ${mesa.familia}`);
  const p = { ...(e.parametrosPara ? e.parametrosPara(mesa.universo || []) : e.parametrosPorDefecto), ...(mesa.params || {}) };
  let n = e.calentamiento(p) + 15 * (p.atr || 14);
  if ((mesa.filtros || []).some(f => f.id === 'vol-max')) n = Math.max(n, comun.velasFiltroVol(e.marco) + 1);
  return n;
}

module.exports = { FAMILIAS, mesasIniciales, velasNecesarias };
