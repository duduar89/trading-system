'use strict';
// Piezas comunes a las cuatro familias: textos, filtros, rejillas y el
// percentil de volatilidad que usa el filtro vol-max.

const { volatilidad, percentilMovil } = require('../mercado/indicadores');
const { asegurarFiltros, bloqueo, valorRegimen, valorNumero } = require('./filtros');
const { DIA } = require('../util/reloj');
const formato = require('../util/formato');

const MARCOS = Object.freeze({ '1Hour': 3_600_000, '4Hour': 14_400_000, '1Day': 86_400_000 });
const TEXTO_MARCO = Object.freeze({ '1Hour': '1H', '4Hour': '4H', '1Day': '1D' });

function etiqueta(simbolo) { return String(simbolo).split('/')[0]; }
function textoMarco(marco) { return TEXTO_MARCO[marco] || marco; }
function esCripto(simbolo) { return String(simbolo).includes('/'); }

// Velas por año del marco: cripto 365 días, acciones 252 sesiones (la vela
// diaria de acciones es una por sesión).
function periodosAnio(simbolos, marco) {
  const cripto = simbolos.every(esCripto);
  const porDia = marco === '1Day' ? 1 : DIA / (MARCOS[marco] || DIA);
  return (cripto ? 365 : 252) * porDia;
}

// Producto cartesiano de la rejilla. `fijos` pisa claves (y las saca de la
// rejilla): así el laboratorio prueba «atrStop + 0,5» sin tocar el resto.
function combinaciones(rejilla, base = {}, fijos = {}) {
  const claves = Object.keys(rejilla || {}).filter(k => !(k in fijos));
  let combos = [{}];
  for (const k of claves) {
    const siguiente = [];
    for (const c of combos) for (const v of rejilla[k]) siguiente.push({ ...c, [k]: v });
    combos = siguiente;
  }
  return combos.map(c => ({ ...base, ...c, ...fijos }));
}

function numeroCombinaciones(rejilla) {
  return Object.values(rejilla || {}).reduce((n, vals) => n * vals.length, 1);
}

function igual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Siguiente valor MAYOR en la lista ordenada de la rejilla (o null).
function siguienteMayor(lista, valor) {
  const ordenada = [...lista].sort((x, y) => x - y);
  for (const v of ordenada) if (v > valor) return v;
  return null;
}
function siguienteMenor(lista, valor) {
  const ordenada = [...lista].sort((x, y) => y - x);
  for (const v of ordenada) if (v < valor) return v;
  return null;
}

// Dominio cerrado del multiplicador de stop: 1 a 5 en pasos de 0,5. Es lo que
// puede proponer el laboratorio con «stop_estrecho → atrStop + 0,5».
const DOMINIO_ATR_STOP = Object.freeze([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);

// Percentil de la volatilidad 30 d del símbolo en su propia historia del
// último año (ventana móvil de 365 días). Ventana fija y no «toda la historia»
// para que en vivo, con las velas justas, salga lo mismo que en el backtest.
// Hasta tener el año completo devuelve null (el filtro deja pasar).
// Se calcula la primera vez que un filtro lo pide y se guarda en prep.
function velasPorDias(marco, dias) {
  return Math.max(2, Math.round((dias * DIA) / (MARCOS[marco] || DIA)));
}

function volPercentil(prep, simbolo, i) {
  if (!prep._volPct) prep._volPct = {};
  let serie = prep._volPct[simbolo];
  if (!serie) {
    const velas = prep.velas[simbolo];
    const vol = volatilidad(velas.map(v => v.c), velasPorDias(prep.marco, 30), periodosAnio([simbolo], prep.marco));
    serie = percentilMovil(vol, velasPorDias(prep.marco, 365));
    prep._volPct[simbolo] = serie;
  }
  const q = serie[i];
  return q === undefined ? null : q;
}

// Velas que necesita el filtro vol-max para dar valor en la última: 30 d de
// volatilidad + 365 d de ventana.
function velasFiltroVol(marco) {
  return velasPorDias(marco, 30) + velasPorDias(marco, 365);
}

// Hueco en los datos de un símbolo: más de 4 velas y más de 5 días sin
// ninguna. Con 5 días de mínimo, las noches, los fines de semana y los puentes
// de las acciones no cuentan como hueco; un símbolo que la fuente deja de dar
// durante meses (SOL en Alpaca, jul-2023 → ago-2024), sí.
function umbralHueco(marcoMs) {
  return Math.max(4 * (marcoMs || DIA), 5 * DIA);
}

// Índices j de la serie en que se reanuda tras un hueco (t[j] − t[j−1] > umbral).
function reanudaciones(serie, umbral) {
  const js = [];
  for (let j = 1; j < serie.length; j++) if (serie[j].t - serie[j - 1].t > umbral) js.push(j);
  return js;
}

// Última reanudación ≤ j (o −Infinity si no hay ninguna).
function ultimaReanudacion(js, j) {
  let lo = 0; let hi = js.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (js[m] <= j) lo = m + 1; else hi = m; }
  return lo ? js[lo - 1] : -Infinity;
}

// Velas que tarda la decisión en no depender de nada anterior: el
// calentamiento de la familia, 15 periodos de ATR/RSI de Wilder (su memoria
// cae por debajo de 2·10⁻⁷) y, con el filtro vol-max, su año de ventana. Es lo
// que el vivo prepara (velasNecesarias) y lo que el motor espera tras un hueco.
function velasMemoria(estrategia, params, filtros = []) {
  const p = params || {};
  let n = estrategia.calentamiento(p) + (Number.isFinite(p.atr) ? 15 * p.atr : 0);
  if ((filtros || []).some(f => f && f.id === 'vol-max')) n = Math.max(n, velasFiltroVol(estrategia.marco) + 1);
  return n;
}

// Aplica los filtros de la mesa a una apertura. Devuelve el filtro que la
// bloquea o null. Solo se calcula el percentil si hay un filtro vol-max.
function filtroQueBloquea(prep, simbolo, i, contexto) {
  const filtros = asegurarFiltros(contexto && contexto.filtros);
  if (!filtros.length) return null;
  const ctx = {
    regimen: contexto.regimen,
    fg: contexto.fg,
    volPercentil: filtros.some(f => f.id === 'vol-max') ? volPercentil(prep, simbolo, i) : null,
  };
  return bloqueo(filtros, ctx);
}

function textoBloqueo(filtro, contexto, prep, simbolo, i) {
  if (!filtro) return '';
  if (filtro.id === 'regimen-no-riskoff') return `bloqueado por filtro: régimen ${valorRegimen(contexto.regimen)}`;
  if (filtro.id === 'fg-max' || filtro.id === 'fg-min') {
    return `bloqueado por filtro ${filtro.id}: Miedo y codicia ${valorNumero(contexto.fg)} (umbral ${filtro.parametro})`;
  }
  if (filtro.id === 'vol-max') {
    const q = volPercentil(prep, simbolo, i);
    return `bloqueado por filtro vol-max: volatilidad en percentil ${Math.round(q)} (máx. ${filtro.parametro})`;
  }
  return `bloqueado por filtro ${filtro.id}`;
}

// ---------- Textos de la espera y de la señal, en llano (§4.3, 30-sep-2026) ----------
// Los dice el operador en el chat y en la tarjeta de su puesto: primera
// persona, sin siglas sueltas y con las MISMAS cifras que calculó la regla.
// `motivo` sigue siendo el técnico (va a la propuesta y a decisiones.jsonl).

// Un precio con su moneda, como las plantillas: «3.493 $».
function px(x) { return `${formato.precio(x)} $`; }

// «n días» en las diarias; «n velas de 4 horas» o «n horas» en las demás.
function tramoLlano(n, marco) {
  if (marco === '1Day') return `${n} ${n === 1 ? 'día' : 'días'}`;
  if (marco === '1Hour') return `${n} ${n === 1 ? 'hora' : 'horas'}`;
  return `${n} ${n === 1 ? 'vela' : 'velas'} de ${marco === '4Hour' ? '4 horas' : marco}`;
}

function calentandoLlano(et, faltan, marco) {
  return `Aún no decido en ${et}: me faltan ${tramoLlano(faltan, marco)} de historia para calcular mis medias.`;
}

// Por qué un filtro de la mesa no deja comprar, con su cifra.
function bloqueoLlano(filtro, contexto, prep, simbolo, i) {
  if (!filtro) return '';
  if (filtro.id === 'regimen-no-riskoff') return `esta mesa no compra con el mercado en modo miedo (Macro dice ${valorRegimen(contexto.regimen)})`;
  if (filtro.id === 'fg-max') return `el índice de miedo y codicia está en ${valorNumero(contexto.fg)} de 100 y esta mesa no compra por encima de ${filtro.parametro}`;
  if (filtro.id === 'fg-min') return `el índice de miedo y codicia está en ${valorNumero(contexto.fg)} de 100 y esta mesa no compra por debajo de ${filtro.parametro}`;
  if (filtro.id === 'vol-max') {
    const q = volPercentil(prep, simbolo, i);
    return `se mueve más de lo normal (su volatilidad está en el percentil ${Math.round(q)} de su último año; esta mesa no compra por encima del ${filtro.parametro})`;
  }
  return `lo impide el filtro ${filtro.id} de esta mesa`;
}

function senal(accion, { peso = 0, stop = null, objetivoPrecio = null, motivo = '', estado = '' } = {}) {
  return { accion, peso, stop, objetivoPrecio, motivo, estado };
}

// Índices por t para alinear varias series del mismo marco.
function indicesPorT(velas) {
  const m = new Map();
  for (let i = 0; i < velas.length; i++) m.set(velas[i].t, i);
  return m;
}

// ---------- Explicaciones en lenguaje llano (explicar de cada familia) ----------
// Para quien no sabe de bolsa: sin jerga, o con la jerga explicada entre
// paréntesis. Las cifras salen de los parámetros de la mesa, nunca de un LLM.

const numeroLlano = x => String(x).replace('.', ',');

function listaLlana(etiquetas) {
  const l = etiquetas.filter(Boolean);
  if (l.length <= 1) return l.join('');
  return `${l.slice(0, -1).join(', ')} y ${l[l.length - 1]}`;
}

// «qué vigila»: los activos de la mesa o, sin universo, una frase genérica.
function activosLlano(universo, porDefecto = 'cada activo de la mesa') {
  const u = (universo || []).map(etiqueta);
  return u.length ? listaLlana(u) : porDefecto;
}

// Lo que añaden los filtros de la mesa (gramática cerrada de filtros.js).
function explicarFiltros(filtros) {
  const frases = [];
  for (const f of filtros || []) {
    const p = f.parametro ?? (f.parametros && (f.parametros.umbral ?? f.parametros.percentil));
    if (f.id === 'regimen-no-riskoff') frases.push('no compra nada cuando Macro dice que el mercado está en modo miedo (RISK-OFF)');
    else if (f.id === 'fg-max') frases.push(`no compra si el índice de miedo y codicia (0 = pánico, 100 = euforia) pasa de ${p}`);
    else if (f.id === 'fg-min') frases.push(`no compra si el índice de miedo y codicia (0 = pánico, 100 = euforia) baja de ${p}`);
    else if (f.id === 'vol-max') frases.push(`no compra si el activo se mueve más de lo normal (volatilidad de 30 días por encima de su percentil ${p} histórico)`);
  }
  return frases.length ? `Además, ${listaLlana(frases)}.` : null;
}

// Riesgo común a todas: el stop no existe en el bróker (cripto) y el tamaño lo
// fija el código con el límite de riesgo por operación.
function riesgoComun(limites) {
  const r = limites && Number.isFinite(limites.riesgoPorOperacion) ? limites.riesgoPorOperacion : null;
  const tope = r !== null ? ` Cada compra se dimensiona para perder como mucho el ${numeroLlano(Math.round(r * 1000) / 10)} % del fondo si salta el stop.` : '';
  return `El stop lo vigila la mesa en cada latido, no el bróker: con la mesa parada no hay stop.${tope}`;
}

module.exports = {
  numeroLlano, listaLlana, activosLlano, explicarFiltros, riesgoComun,
  MARCOS, etiqueta, textoMarco, esCripto, periodosAnio, combinaciones, numeroCombinaciones,
  igual, siguienteMayor, siguienteMenor, DOMINIO_ATR_STOP, volPercentil, velasFiltroVol, velasPorDias,
  filtroQueBloquea, textoBloqueo, senal, px, tramoLlano, calentandoLlano, bloqueoLlano, indicesPorT, umbralHueco, reanudaciones, ultimaReanudacion, velasMemoria,
};
