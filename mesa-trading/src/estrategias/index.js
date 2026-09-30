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
// «Momentum cripto ampliada» (30-sep-2026): las 6 de la titular + las 4 nuevas.
const CRIPTO_AMPLIADA = Object.freeze([...CRIPTO, 'XRP/USD', 'LTC/USD', 'BCH/USD', 'ADA/USD']);
// Momentum ETF con DIA (30-sep-2026).
const ETF_MOMENTUM = Object.freeze(['SPY', 'QQQ', 'IWM', 'TLT', 'GLD', 'DIA']);

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
  ampliada: 'Histórico real mar-2022 → sep-2026: añadir LTC y BCH a Momentum cripto baja su Sharpe de 0,82 a 0,58, y XRP de 0,74 a 0,56; ADA solo tiene 7 meses de datos. La titular sigue con sus 6: esta, con 10, empieza en prueba con el 2 %.',
});

// La mesa ampliada solo tiene sentido con sus 10 criptos: con las 6 de
// siempre (modo sintético, que no tiene las nuevas) sería un duplicado de
// Momentum cripto. Por eso solo se crea si están todas.
const MESA_AMPLIADA = Object.freeze({ id: 'momentum-ampliada', nombre: 'Momentum cripto ampliada', universo: CRIPTO_AMPLIADA });

function mesaAmpliada() {
  return mesa(MESA_AMPLIADA.id, MESA_AMPLIADA.nombre, momentumRotacion, MESA_AMPLIADA.universo, null, 'incubacion', NOTAS.ampliada);
}

// `disponibles` (opcional): los símbolos que la fuente de datos tiene. La
// ampliada solo entra si están sus 10; sin la lista no se sabe y no entra.
function mesasIniciales({ hayAlpaca = false, disponibles = null } = {}) {
  const hay = disponibles ? new Set(disponibles) : null;
  const mesas = [
    mesa('tendencia', 'Tendencia SMA', tendenciaSma, ['BTC/USD', 'ETH/USD', 'SOL/USD'], null, 'incubacion', NOTAS.tendencia),
    mesa('momentum', 'Momentum cripto', momentumRotacion, CRIPTO, null, 'titular', NOTAS.momentum),
    mesa('reversion', 'Reversión RSI', reversionRsi, ['BTC/USD', 'ETH/USD'], null, 'incubacion', NOTAS.reversion),
    mesa('ruptura', 'Ruptura Donchian', rupturaDonchian, ['BTC/USD', 'ETH/USD', 'SOL/USD'], null, 'incubacion', NOTAS.ruptura),
  ];
  if (hay && MESA_AMPLIADA.universo.every(s => hay.has(s))) mesas.push(mesaAmpliada());
  if (hayAlpaca) {
    mesas.push(mesa('momentum-etf', 'Momentum ETF', momentumRotacion, ETF_MOMENTUM, momentumRotacion.parametrosEtf, 'incubacion', NOTAS.etf));
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

// Explicación en lenguaje llano de una mesa con SUS parámetros y filtros
// (§4.3, explicar): { queMira, cuandoCompra, cuandoVende, cuandoNada, riesgo, filtros }.
function explicarMesa(m, { limites = null } = {}) {
  const e = FAMILIAS[m && m.familia];
  if (!e || typeof e.explicar !== 'function') return null;
  const base = e.parametrosPara ? e.parametrosPara(m.universo || []) : e.parametrosPorDefecto;
  return e.explicar({ ...base, ...(m.params || {}) }, { universo: m.universo || [], filtros: m.filtros || [], limites });
}

module.exports = {
  FAMILIAS, mesasIniciales, mesaAmpliada, velasNecesarias, explicarMesa,
  NOTAS_INICIALES: NOTAS, MESA_AMPLIADA, ETF_MOMENTUM, CRIPTO_TITULAR: CRIPTO,
};
