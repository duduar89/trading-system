'use strict';
// Tendencia SMA (4H): largo cuando la media rápida pasa por encima de la lenta
// con el cierre sobre la media filtro; fuera cuando la rápida cae bajo la
// lenta. Stop inicial a atrStop × ATR(14) y trailing desde el máximo.
//
// Se abre cuando la condición completa (rápida > lenta Y cierre > filtro) PASA
// a cumplirse en esta vela, no mientras se cumple: después de un stop no se
// vuelve a entrar en la misma tendencia hasta que la señal se reinicie.
//
// `iAnterior` (opcional) es la última vela que se decidió. En vivo, con el
// ordenador apagado o dormido, las velas de en medio no se deciden: si la
// condición falló en alguna de ellas y ahora se cumple, el cruce ocurrió
// mientras tanto y se entra ahora (tarde, al cierre de i). Sin iAnterior es la
// vela anterior, como en el backtest.

const { sma, atr, cierres } = require('../mercado/indicadores');
const formato = require('../util/formato');
const c = require('./comun');

const familia = 'tendencia-sma';
const marco = '4Hour';
const parametrosPorDefecto = Object.freeze({ rapida: 7, lenta: 25, filtro: 200, atr: 14, atrStop: 2.5 });

// 4 × 3 × 2 = 24 combinaciones (≤ 30).
const rejilla = Object.freeze({ rapida: [5, 7, 10, 14], lenta: [25, 40, 60], atrStop: [2.5, 3.5] });

// Valores que el laboratorio puede fijar (gramática cerrada).
const dominio = Object.freeze({
  rapida: rejilla.rapida, lenta: rejilla.lenta, filtro: [200], atr: [14], atrStop: c.DOMINIO_ATR_STOP,
});

function completar(params) { return { ...parametrosPorDefecto, ...(params || {}) }; }

function calentamiento(params) {
  const p = completar(params);
  return Math.max(p.rapida, p.lenta, p.filtro, p.atr) + 1;
}

function preparar(velasPorSimbolo, params) {
  const p = completar(params);
  const simbolos = Object.keys(velasPorSimbolo);
  const porSimbolo = {};
  for (const s of simbolos) {
    const velas = velasPorSimbolo[s];
    const cc = cierres(velas);
    porSimbolo[s] = { c: cc, rapida: sma(cc, p.rapida), lenta: sma(cc, p.lenta), filtro: sma(cc, p.filtro), atr: atr(velas, p.atr) };
  }
  return { familia, marco, params: p, velas: velasPorSimbolo, simbolos, porSimbolo, peso: 1 / Math.max(1, simbolos.length) };
}

function condicion(s, i) {
  if (i < 0) return false;
  const r = s.rapida[i]; const l = s.lenta[i]; const f = s.filtro[i];
  return r !== null && l !== null && f !== null && r > l && s.c[i] > f;
}

// ¿La condición dejó de cumplirse en alguna vela de [desde, hasta]? (la señal se reinició)
function huboReinicio(s, desde, hasta) {
  for (let k = Math.max(desde, -1); k <= hasta; k++) if (!condicion(s, k)) return true;
  return false;
}

function decidir(prep, { simbolo, i, iAnterior, posicion = null, contexto = {}, textos = true } = {}) {
  const p = prep.params;
  const s = prep.porSimbolo[simbolo];
  const et = c.etiqueta(simbolo);
  if (!s || i < 0 || i >= s.c.length) return c.senal(posicion ? 'mantener' : 'nada', { estado: textos ? `No tengo datos de ${et} ahora mismo.` : '' });
  const r = s.rapida[i]; const l = s.lenta[i]; const f = s.filtro[i]; const a = s.atr[i]; const cierre = s.c[i];
  if (r === null || l === null || f === null || a === null) {
    const faltan = calentamiento(p) - 1 - i;
    return c.senal(posicion ? 'mantener' : 'nada', { estado: textos ? c.calentandoLlano(et, faltan, marco) : '' });
  }
  // En llano: «su media de 7 velas de 4 horas (3.493 $)».
  const media = (n, v) => `su media de ${c.tramoLlano(n, marco)}${v === undefined ? '' : ` (${c.px(v)})`}`;
  const txtMedias = textos ? `SMA${p.rapida} ${formato.precio(r)} ${r > l ? '>' : r < l ? '<' : '='} SMA${p.lenta} ${formato.precio(l)}` : '';

  if (posicion) {
    if (r < l) {
      return c.senal('cerrar', { motivo: txtMedias, estado: textos ? `Mi regla dice vender ${et}: ${media(p.rapida, r)} ha caído por debajo de la de ${p.lenta} (${c.px(l)}); la subida se ha acabado.` : '' });
    }
    return c.senal('mantener', {
      peso: prep.peso,
      stop: posicion.stop ?? null,
      motivo: txtMedias,
      estado: textos ? `Tengo ${et} desde ${c.px(posicion.entrada)}. Vendo si ${media(p.rapida)} cae por debajo de la de ${p.lenta}, o si cae a ${c.px(posicion.stop)} (stop).` : '',
    });
  }

  const desde = Number.isInteger(iAnterior) && iAnterior < i ? iAnterior : i - 1;
  if (condicion(s, i) && huboReinicio(s, desde, i - 1)) {
    const stop = cierre - p.atrStop * a;
    const motivo = textos ? `${txtMedias}; cierre ${formato.precio(cierre)} > SMA${p.filtro} ${formato.precio(f)}` : '';
    const filtro = c.filtroQueBloquea(prep, simbolo, i, contexto);
    if (filtro) {
      return c.senal('nada', { motivo, estado: textos ? `Mi regla daría compra en ${et}, pero no compro: ${c.bloqueoLlano(filtro, contexto, prep, simbolo, i)}.` : '' });
    }
    return c.senal('abrir', {
      peso: prep.peso, stop, motivo,
      estado: textos ? `Mi regla dice comprar ${et}: ${media(p.rapida, r)} ha cruzado por encima de la de ${p.lenta} (${c.px(l)}) y el precio sigue sobre su media de ${p.filtro} (${c.px(f)}). Si cae a ${c.px(stop)}, vendo (stop).` : '',
    });
  }
  return c.senal('nada', {
    motivo: textos ? `${txtMedias}; cierre ${formato.precio(cierre)} ${cierre > f ? '>' : '≤'} SMA${p.filtro} ${formato.precio(f)}` : '',
    estado: textos ? `No tengo ${et}. Compro cuando ${media(p.rapida)} cruce por encima de la de ${p.lenta} con el precio sobre su media de ${p.filtro}.` : '',
  });
}

// Stop de chandelier: máximo de cierres desde la entrada − atrStop × ATR.
// Solo sube; null si no mejora el stop actual.
function trailing(prep, { simbolo, i, posicion, params } = {}) {
  if (!posicion) return null;
  const s = prep.porSimbolo[simbolo];
  if (!s || i < 0 || i >= s.c.length) return null;
  const a = s.atr[i];
  if (a === null) return null;
  const k = completar(params || prep.params).atrStop;
  const maxP = posicion.maxPrecio ?? s.c[i];
  const nuevo = maxP - k * a;
  if (posicion.stop === null || posicion.stop === undefined || nuevo > posicion.stop) return nuevo;
  return null;
}

// Vecino más lento: las dos medias al siguiente valor mayor de la rejilla.
function vecinoMasLento(params) {
  const p = completar(params);
  const r = c.siguienteMayor(rejilla.rapida, p.rapida);
  const l = c.siguienteMayor(rejilla.lenta, p.lenta);
  if (r === null && l === null) return null;
  const nr = r ?? p.rapida;
  const nl = l ?? p.lenta;
  if (nr >= nl) return null;
  return { rapida: nr, lenta: nl };
}

function describir(params) {
  const p = completar(params);
  return `SMA ${p.rapida}-${p.lenta} con filtro ${p.filtro}, stop ${formato.numero(p.atrStop, 1)}×ATR(${p.atr}) con trailing`;
}

// En lenguaje llano, con los parámetros de la mesa (§4.3, explicar).
function explicar(params, { universo = [], filtros = [], limites = null } = {}) {
  const p = completar(params);
  const quien = c.activosLlano(universo);
  return {
    queMira: `Mira ${quien} en velas de 4 horas y compara dos medias del precio: la de las últimas ${p.rapida} velas (rápida) y la de las últimas ${p.lenta} (lenta). Una media es el precio promedio de ese tramo: suaviza los vaivenes.`,
    cuandoCompra: `Compra cuando la media rápida pasa por encima de la lenta (el precio empieza a subir con fuerza) y además el precio está por encima de su media de ${p.filtro} velas (la tendencia de fondo también es alcista).`,
    cuandoVende: `Vende cuando la media rápida vuelve a caer por debajo de la lenta, o si salta el stop (precio de salida de emergencia) a ${c.numeroLlano(p.atrStop)} veces el movimiento típico de ${p.atr} velas (ATR) por debajo; ese stop sube con el precio y nunca baja.`,
    cuandoNada: 'Sin cruce hacia arriba, o con el precio por debajo de la media larga, no hace nada y espera en efectivo.',
    riesgo: `Opera a menudo y paga comisión en cada compra y venta; en mercados de lado da muchas señales falsas. ${c.riesgoComun(limites)}`,
    filtros: c.explicarFiltros(filtros),
  };
}

module.exports = {
  familia,
  nombre: 'Tendencia SMA',
  explicacion: explicar(parametrosPorDefecto),
  explicar,
  descripcion: 'Largo cuando la SMA rápida cruza por encima de la lenta con el precio sobre la SMA filtro; sale cuando la rápida cae bajo la lenta o salta el stop (ATR con trailing).',
  marco,
  parametrosPorDefecto,
  rejilla,
  dominio,
  calentamiento,
  preparar,
  decidir,
  trailing,
  vecinoMasLento,
  describir,
};
