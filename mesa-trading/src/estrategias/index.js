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

// Qué arranca de titular y qué en incubación (2 % del capital) es decisión de
// Eduardo (30-sep-2026, delegada en el director), con velas reales de Alpaca
// de 2021 a sep-2026, costes incluidos y riesgo por operación del 1 %:
// - Momentum cripto, única titular: Sharpe 0,91 como mesa del 25 % frente a
//   0,63 de comprar y mantener (scripts/probar-backtest.js --real).
// - Tendencia 4H y Reversión cripto pierden (Sharpe −0,53 y −0,36; tendencia
//   pagó 4.423 $ de comisiones sobre 10.000 $ en 539 operaciones).
// - Ruptura gana sola (0,65), pero en la cartera del fondo su correlación
//   diaria con Momentum es 0,80: Momentum sola (40 %) da Sharpe 0,72 y caída
//   11,2 %; con Ruptura (40 + 40), 0,58 y 26,0 % (scripts/estudiar-limites.js).
//   No diversifica y añade caída.
// - Las de ETF no se pueden validar sin claves (Stooq pide JavaScript y Yahoo
//   da 429): empiezan en prueba como cualquier estrategia sin datos.
// Todas tienen que ganarse el puesto en papel con la regla de ascenso del
// asignador; el capital que no se reparte queda en efectivo.
const NOTAS = Object.freeze({
  momentum: 'Backtest real 2021-2026 con costes: Sharpe 0,91 frente a 0,63 de comprar y mantener. Única titular.',
  tendencia: 'Backtest real 2021-2026 con costes: Sharpe −0,53. Empieza en prueba con el 2 %.',
  reversion: 'Backtest real 2021-2026 con costes: Sharpe −0,36. Empieza en prueba con el 2 %.',
  ruptura: 'Correlación diaria con Momentum 0,80: juntas, Sharpe 0,58 y caída 26,0 %; Momentum sola, 0,72 y 11,2 %. No diversifica: empieza en prueba con el 2 %.',
  etf: 'Sin validar con datos reales: empieza en prueba con el 2 %.',
});

function mesasIniciales({ hayAlpaca = false } = {}) {
  const mesas = [
    mesa('tendencia', 'Tendencia SMA', tendenciaSma, ['BTC/USD', 'ETH/USD', 'SOL/USD'], null, 'incubacion', NOTAS.tendencia),
    mesa('momentum', 'Momentum cripto', momentumRotacion, CRIPTO, null, 'titular', NOTAS.momentum),
    mesa('reversion', 'Reversión RSI', reversionRsi, ['BTC/USD', 'ETH/USD'], null, 'incubacion', NOTAS.reversion),
    mesa('ruptura', 'Ruptura Donchian', rupturaDonchian, ['BTC/USD', 'ETH/USD', 'SOL/USD'], null, 'incubacion', NOTAS.ruptura),
  ];
  if (hayAlpaca) {
    mesas.push(mesa('momentum-etf', 'Momentum ETF', momentumRotacion, ['SPY', 'QQQ', 'IWM', 'TLT', 'GLD'], momentumRotacion.parametrosEtf, 'incubacion', NOTAS.etf));
    mesas.push(mesa('reversion-etf', 'Reversión ETF', reversionRsi, ['SPY', 'QQQ'], null, 'incubacion', NOTAS.etf));
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
  return comun.velasMemoria(e, p, mesa.filtros || []);
}

module.exports = { FAMILIAS, mesasIniciales, velasNecesarias, NOTAS_INICIALES: NOTAS };
