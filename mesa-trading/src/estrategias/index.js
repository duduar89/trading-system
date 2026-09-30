'use strict';
// Catálogo de familias y mesas iniciales (§4.3). Los valores por defecto no se
// optimizan en vivo: solo el laboratorio puede proponer otros, y por la
// gramática cerrada (rejilla + filtros).

const tendenciaSma = require('./tendencia-sma');
const momentumRotacion = require('./momentum-rotacion');
const reversionRsi = require('./reversion-rsi');
const rupturaDonchian = require('./ruptura-donchian');
const comun = require('./comun');
const universo = require('../mercado/universo');

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

function mesa(id, nombre, estrategia, simbolos, params, estado = 'titular', nota = null, estudio = null) {
  return {
    id,
    nombre,
    familia: estrategia.familia,
    marco: estrategia.marco,
    universo: [...simbolos],
    params: copia(params || estrategia.parametrosPorDefecto),
    filtros: [],
    estado,
    origen: 'inicial',
    nota,
    ...(estudio ? { estudio: copia(estudio) } : {}),
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
// - Las de ETF (30-sep-2026): con 10 años de velas reales de Alpaca
//   (scripts/estudiar-candidatas.js, el mismo filtro que el laboratorio)
//   suspenden el filtro los dos: Momentum ETF, Sharpe fuera de muestra 0,19,
//   69 % de ventanas en positivo y Sharpe deflactado 0,48 (2,1 %/año frente a
//   13,3 % de comprar y mantener, con como mucho el 20 % invertido frente a
//   todo); Reversión en índices (SPY, QQQ, IWM y DIA), 0,33, 56 % y 0,59
//   (0,3 %/año, como mucho el 40 % invertido, frente a 15,3 %). Reversión ETF
//   opera SPY y QQQ: su cartera no se estudió (revisión del 30-sep-2026).
//   Eduardo decidió que sigan en prueba con el 2 % para verlas en vivo
//   (ESTUDIOS_ETF).
// Todas tienen que ganarse el puesto en papel con la regla de ascenso del
// asignador; el capital que no se reparte queda en efectivo.
const NOTA_ETF_ANTERIOR = 'Sin validar con datos reales: empieza en prueba con el 2 %.';
// Notas de ETF del 30-sep-2026 que la revisión de ese día corrigió: la de
// Reversión ETF presentaba el estudio de otra cartera (SPY, QQQ, IWM y DIA)
// como el suyo, y las dos comparaban la rentabilidad de una estrategia con
// como mucho el 20 % o el 40 % invertido con la de comprar y mantener, con
// todo invertido. Un fondo que aún las tenga las cambia al arrancar
// (orquestador._migrarNotasEtf).
// La de la ampliada enseñaba cifras sin estudio guardado que no cuadraban entre
// sí (0,82 y 0,74 para la misma titular); la de ahora sale de
// scripts/estudiar-ampliada.js (revisión del 30-sep-2026).
const NOTAS_SUPERADAS = Object.freeze({
  'momentum-ampliada': Object.freeze([
    'Histórico real mar-2022 → sep-2026: añadir LTC y BCH a Momentum cripto baja su Sharpe de 0,82 a 0,58, y XRP de 0,74 a 0,56; ADA solo tiene 7 meses de datos. La titular sigue con sus 6: esta, con 10, empieza en prueba con el 2 %.',
  ]),
});
const NOTAS_ETF_SUPERADAS = Object.freeze({
  'momentum-etf': Object.freeze([
    'Suspendió el filtro con 10 años de datos reales (estudio del 30-sep-2026): fuera de muestra, Sharpe 0,19 (rentabilidad por unidad de riesgo; se pide 0,6), 69 % de ventanas en positivo (se pide 75 %) y Sharpe deflactado 0,48 (se pide 0,90). En esos 10 años ganó un 2,1 % al año; comprar y mantener, un 13,3 %. Sigue en prueba con el 2 % por decisión de Eduardo, para verla en vivo.',
  ]),
  'reversion-etf': Object.freeze([
    'Suspendió el filtro con 10 años de datos reales de SPY, QQQ, IWM y DIA (estudio del 30-sep-2026): fuera de muestra, Sharpe 0,33 (rentabilidad por unidad de riesgo; se pide 0,6), 56 % de ventanas en positivo (se pide 75 %) y Sharpe deflactado 0,59 (se pide 0,90). En esos 10 años ganó un 0,3 % al año; comprar y mantener, un 15,3 %. Sigue en prueba con el 2 % por decisión de Eduardo, para verla en vivo.',
  ]),
});
const NOTAS = Object.freeze({
  momentum: 'Backtest real 2021-2026 con costes: Sharpe 0,91 frente a 0,63 de comprar y mantener. Única titular.',
  tendencia: 'Backtest real 2021-2026 con costes: Sharpe −0,53. Empieza en prueba con el 2 %.',
  reversion: 'Backtest real 2021-2026 con costes: Sharpe −0,36. Empieza en prueba con el 2 %.',
  ruptura: 'Correlación diaria con Momentum 0,80: juntas, Sharpe 0,58 y caída 26,0 %; Momentum sola, 0,72 y 11,2 %. No diversifica: empieza en prueba con el 2 %.',
  'momentum-etf': 'Suspendió el filtro con 10 años de datos reales (estudio del 30-sep-2026): fuera de muestra, Sharpe 0,19 (rentabilidad por unidad de riesgo; se pide 0,6), 69 % de ventanas en positivo (se pide 75 %) y Sharpe deflactado 0,48 (se pide 0,90). En esos 10 años ganó un 2,1 % al año con como mucho el 20 % del dinero invertido; comprar y mantener, con todo invertido, un 13,3 %: no se comparan tal cual. Sigue en prueba con el 2 % por decisión de Eduardo, para verla en vivo.',
  'reversion-etf': 'Su cartera (SPY y QQQ) aún no se ha estudiado con datos reales. El estudio del 30-sep-2026 fue de otra más grande, Reversión en índices (SPY, QQQ, IWM y DIA), y suspendió el filtro: fuera de muestra, Sharpe 0,33 (rentabilidad por unidad de riesgo; se pide 0,6), 56 % de ventanas en positivo (se pide 75 %) y Sharpe deflactado 0,59 (se pide 0,90; sin contar las pruebas del estudio anterior, puede ser más bajo). En 10 años ganó un 0,3 % al año con como mucho el 40 % invertido; comprar y mantener, con todo invertido, un 15,3 %. Sigue en prueba con el 2 % por decisión de Eduardo, para verla en vivo.',
  // De docs/estudios/ampliada-2026-09-30.json (scripts/estudiar-ampliada.js), cada par en su tramo.
  ampliada: 'Histórico real con costes (estudio del 30-sep-2026; cada par, en el tramo en que cotizan todas): añadir LTC y BCH a Momentum cripto baja su Sharpe de 0,63 a 0,40 (dic-2021 → sep-2026) y XRP, de 0,81 a 0,65 (ene-2024 → sep-2026). ADA cotiza desde feb-2026: con 7 meses no se puede juzgar. La titular sigue con sus 6: esta, con las 10, empieza en prueba con el 2 %.',
});

// Lo más que puede tener invertido a la vez la estrategia de un estudio
// (scripts/estudiar-candidatas.js: mesa del 100 % y los límites `limites`):
// cada posición, como mucho su peso (1/top en la rotación, 1/activos en las
// demás) y el tope por activo; tantas posiciones como elige o como activos
// tiene. Con los límites duros, top 2 → 20 %; cuatro activos → 40 %. Es lo
// que hay que decir al lado de su rentabilidad frente a comprar y mantener,
// que lo tiene todo invertido.
function exposicionMaximaEstudio(familia, simbolos, limites) {
  const e = FAMILIAS[familia];
  const n0 = (simbolos || []).length;
  if (!e || !n0 || !limites) return null;
  const p = e.parametrosPara ? e.parametrosPara(simbolos) : e.parametrosPorDefecto;
  const n = familia === 'momentum-rotacion' ? Math.min(p.top || n0, n0) : n0;
  const posiciones = Math.min(n, Number.isFinite(limites.maxPosiciones) ? limites.maxPosiciones : n);
  return Math.min(1, posiciones * Math.min(1 / n, limites.maxPesoPorActivo));
}

// El estudio que respalda la nota de cada mesa de ETF, con sus cifras (las
// del informe de scripts/estudiar-candidatas.js del 30-sep-2026) y los
// umbrales del filtro, que son los del laboratorio (CRITERIOS de
// src/cuant/laboratorio.js; test/cuant-estrategias.test.js lo comprueba). La
// vista Estrategias lo enseña: «Suspendió el filtro; sigue en prueba por
// decisión de Eduardo».
//
// Revisión del 30-sep-2026 (lo que se sabe de ese estudio, cuya salida no se
// guardó en git):
// - `universo` es el ESTUDIADO. El de Reversión ETF fue el de otra cartera,
//   «Reversión en índices» (SPY, QQQ, IWM y DIA), y la mesa opera SPY y QQQ:
//   la vista lo dice («su cartera aún no se ha estudiado») y la prueba exige
//   que un estudio de otro universo lo diga. La salida siguiente de
//   scripts/estudiar-candidatas.js (que ya estudia la mesa tal cual, con las
//   claves de Alpaca) sustituye estas cifras.
// - `exposicionMaxima`: con cuánto dinero invertido, como mucho, se hizo la
//   `rentabilidadAnual` (exposicionMaximaEstudio con los límites duros): va
//   al lado de la de comprar y mantener, que lo tiene todo invertido.
// - `avisos.sharpeDeflactado`: el de la 2.ª candidata se calculó sin los
//   ensayos de la 1.ª (iban dentro de un comentario del script).
const UMBRALES_FILTRO = Object.freeze({ sharpeFueraDeMuestra: 0.6, ventanasPositivas: 0.75, sharpeDeflactado: 0.9 });
const ESTUDIOS_ETF = Object.freeze({
  'momentum-etf': Object.freeze({
    fecha: '2026-09-30', fuente: 'scripts/estudiar-candidatas.js', anos: 10, nombre: 'Momentum ETF (la de hoy + DIA)', universo: ETF_MOMENTUM, aprobada: false,
    cifras: Object.freeze({ sharpeFueraDeMuestra: 0.19, ventanasPositivas: 0.69, sharpeDeflactado: 0.48, rentabilidadAnual: 0.021, comprarYMantenerAnual: 0.133 }),
    exposicionMaxima: 0.2,
    umbrales: UMBRALES_FILTRO,
    decision: Object.freeze({ quien: 'Eduardo', que: 'sigue en prueba', peso: 0.02, porque: 'para verla en vivo' }),
  }),
  'reversion-etf': Object.freeze({
    fecha: '2026-09-30', fuente: 'scripts/estudiar-candidatas.js', anos: 10, nombre: 'Reversión en índices', universo: Object.freeze(['SPY', 'QQQ', 'IWM', 'DIA']), aprobada: false,
    cifras: Object.freeze({ sharpeFueraDeMuestra: 0.33, ventanasPositivas: 0.56, sharpeDeflactado: 0.59, rentabilidadAnual: 0.003, comprarYMantenerAnual: 0.153 }),
    exposicionMaxima: 0.4,
    avisos: Object.freeze({ sharpeDeflactado: 'sin contar las pruebas del estudio anterior: puede ser más bajo' }),
    umbrales: UMBRALES_FILTRO,
    decision: Object.freeze({ quien: 'Eduardo', que: 'sigue en prueba', peso: 0.02, porque: 'para verla en vivo' }),
  }),
});

// ¿El estudio es de otro universo que el de la mesa? (el universo puede venir
// por símbolo o por etiqueta).
function estudioDeOtraCartera(m) {
  const e = m && m.estudio;
  if (!e || !Array.isArray(e.universo)) return false;
  const a = new Set(simbolosDe({ universo: e.universo }));
  const b = simbolosDe(m);
  return a.size !== new Set(b).size || !b.every(x => a.has(x));
}

// Plazo de una mesa (vista Estrategias): cada cuánto decide de verdad, por su
// marco y su rebalanceo. Tendencia de 4 horas → «Cada 4 horas»; las diarias y
// la rotación semanal → «Cada día o semana»; la rotación mensual → «Cada mes».
const PLAZOS = Object.freeze([
  Object.freeze({ id: 'horas', nombre: 'Cada 4 horas' }),
  Object.freeze({ id: 'dia', nombre: 'Cada día o semana' }),
  Object.freeze({ id: 'mes', nombre: 'Cada mes' }),
]);

// Los símbolos de una mesa, venga su universo como 'BTC/USD' (estado) o como
// 'BTC' (instantánea).
function simbolosDe(m) {
  return (m && Array.isArray(m.universo) ? m.universo : []).map(x => {
    const a = universo.porSimbolo(x) || universo.porEtiqueta(x);
    return a ? a.simbolo : x;
  });
}

function plazoMesa(m) {
  const marco = m && m.marco;
  let id = 'dia';
  if (marco === '4Hour' || marco === '1Hour') id = 'horas';
  else if (m && m.familia === 'momentum-rotacion') {
    const e = FAMILIAS['momentum-rotacion'];
    const base = e.parametrosPara ? e.parametrosPara(simbolosDe(m)) : e.parametrosPorDefecto;
    const rebalanceo = (m.params && m.params.rebalanceo) || base.rebalanceo;
    if (rebalanceo === 'mensual') id = 'mes';
  }
  return { ...PLAZOS.find(p => p.id === id) };
}

// Tipos de activo que opera una mesa, en el orden de universo.TIPOS.
function tiposMesa(m) {
  const tiene = new Set(simbolosDe(m).map(s => universo.tipoDe(s)));
  const orden = [...universo.TIPOS.map(t => t.id), universo.TIPO_OTROS.id];
  return orden.filter(id => tiene.has(id)).map(id => ({ id, nombre: universo.nombreTipo(id) }));
}

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
    mesas.push(mesa('momentum-etf', 'Momentum ETF', momentumRotacion, ETF_MOMENTUM, momentumRotacion.parametrosEtf, 'incubacion', NOTAS['momentum-etf'], ESTUDIOS_ETF['momentum-etf']));
    mesas.push(mesa('reversion-etf', 'Reversión ETF', reversionRsi, ['SPY', 'QQQ'], null, 'incubacion', NOTAS['reversion-etf'], ESTUDIOS_ETF['reversion-etf']));
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

// Estudio y nota de una mesa de ETF para un fondo que ya existía (la migración
// del orquestador): solo si la mesa aún tiene la nota de antes del estudio, o
// una de las que corrigió la revisión del 30-sep-2026 (`revision: true`).
// → { nota, estudio, revision } o null (otra mesa, o ya actualizada, o con otra nota).
function notaEtfNueva(m) {
  if (!m || !ESTUDIOS_ETF[m.id]) return null;
  const revision = (NOTAS_ETF_SUPERADAS[m.id] || []).includes(m.nota);
  if (m.nota !== NOTA_ETF_ANTERIOR && !revision) return null;
  return { nota: NOTAS[m.id], estudio: copia(ESTUDIOS_ETF[m.id]), revision };
}

// Nota corregida de otra mesa (la ampliada) si aún tiene una superada:
// → { nota, revision: true } o null. Una nota distinta no se pisa.
function notaRevisada(m) {
  if (!m || !(NOTAS_SUPERADAS[m.id] || []).includes(m.nota)) return null;
  return { nota: m.id === MESA_AMPLIADA.id ? NOTAS.ampliada : NOTAS[m.id], revision: true };
}

module.exports = {
  FAMILIAS, mesasIniciales, mesaAmpliada, velasNecesarias, explicarMesa,
  NOTAS_INICIALES: NOTAS, MESA_AMPLIADA, ETF_MOMENTUM, CRIPTO_TITULAR: CRIPTO,
  NOTA_ETF_ANTERIOR, NOTAS_ETF_SUPERADAS, NOTAS_SUPERADAS, ESTUDIOS_ETF, UMBRALES_FILTRO, notaEtfNueva, notaRevisada, exposicionMaximaEstudio, estudioDeOtraCartera,
  PLAZOS, plazoMesa, tiposMesa,
};
