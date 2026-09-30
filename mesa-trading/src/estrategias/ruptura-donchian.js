'use strict';
// Ruptura de Donchian (1D): abrir cuando el cierre supera el máximo de las
// `entrada` velas ANTERIORES; cerrar cuando cae bajo el mínimo de las `salida`
// velas anteriores. Máximos sobre altos y mínimos sobre bajos (canal clásico
// de las tortugas). Stop fijo a atrStop × ATR(20): el canal de salida ya hace
// de trailing, así que no hay otro.

const { maximo, minimo, atr, cierres } = require('../mercado/indicadores');
const formato = require('../util/formato');
const c = require('./comun');

const familia = 'ruptura-donchian';
const marco = '1Day';
const parametrosPorDefecto = Object.freeze({ entrada: 20, salida: 10, atr: 20, atrStop: 2 });

// 4 × 2 × 2 = 16 combinaciones.
const rejilla = Object.freeze({ entrada: [20, 30, 40, 55], salida: [10, 20], atrStop: [2, 3] });

const dominio = Object.freeze({
  entrada: rejilla.entrada, salida: rejilla.salida, atr: [20], atrStop: c.DOMINIO_ATR_STOP,
});

function completar(params) { return { ...parametrosPorDefecto, ...(params || {}) }; }

function calentamiento(params) {
  const p = completar(params);
  return Math.max(p.entrada, p.salida, p.atr) + 1;
}

function preparar(velasPorSimbolo, params) {
  const p = completar(params);
  const simbolos = Object.keys(velasPorSimbolo);
  const porSimbolo = {};
  for (const s of simbolos) {
    const velas = velasPorSimbolo[s];
    porSimbolo[s] = {
      c: cierres(velas),
      maxEntrada: maximo(velas.map(v => v.h), p.entrada),
      minSalida: minimo(velas.map(v => v.l), p.salida),
      atr: atr(velas, p.atr),
    };
  }
  return { familia, marco, params: p, velas: velasPorSimbolo, simbolos, porSimbolo, peso: 1 / Math.max(1, simbolos.length) };
}

function decidir(prep, { simbolo, i, posicion = null, contexto = {}, textos = true } = {}) {
  const p = prep.params;
  const s = prep.porSimbolo[simbolo];
  const et = c.etiqueta(simbolo);
  if (!s || i < 1 || i >= s.c.length) return c.senal(posicion ? 'mantener' : 'nada', { estado: textos ? `No tengo datos de ${et} ahora mismo.` : '' });
  const cierre = s.c[i];
  const techo = s.maxEntrada[i - 1];   // máximo de las `entrada` velas previas
  const suelo = s.minSalida[i - 1];    // mínimo de las `salida` velas previas
  const a = s.atr[i];
  if (techo === null || suelo === null || a === null) {
    const faltan = calentamiento(p) - 1 - i;
    return c.senal(posicion ? 'mantener' : 'nada', { estado: textos ? c.calentandoLlano(et, faltan, marco) : '' });
  }

  if (posicion) {
    if (cierre < suelo) {
      const motivo = textos ? `cierre ${formato.precio(cierre)} < mínimo ${p.salida} previo ${formato.precio(suelo)}` : '';
      return c.senal('cerrar', { motivo, estado: textos ? `Mi regla dice vender ${et}: ha cerrado en ${c.px(cierre)}, por debajo del mínimo de los ${c.tramoLlano(p.salida, marco)} anteriores (${c.px(suelo)}).` : '' });
    }
    return c.senal('mantener', {
      peso: prep.peso,
      stop: posicion.stop ?? null,
      motivo: textos ? `cierre ${formato.precio(cierre)} ≥ mínimo ${p.salida} previo ${formato.precio(suelo)}` : '',
      estado: textos ? `Tengo ${et} desde ${c.px(posicion.entrada)}. Vendo si cierra por debajo de ${c.px(suelo)} (su mínimo de ${c.tramoLlano(p.salida, marco)}) o si cae a ${c.px(posicion.stop)} (stop).` : '',
    });
  }

  if (cierre > techo) {
    const stop = cierre - p.atrStop * a;
    const motivo = textos ? `cierre ${formato.precio(cierre)} > máximo ${p.entrada} previo ${formato.precio(techo)}` : '';
    const filtro = c.filtroQueBloquea(prep, simbolo, i, contexto);
    if (filtro) {
      return c.senal('nada', { motivo, estado: textos ? `${et} ha superado su máximo de ${c.tramoLlano(p.entrada, marco)} y mi regla daría compra, pero no compro: ${c.bloqueoLlano(filtro, contexto, prep, simbolo, i)}.` : '' });
    }
    return c.senal('abrir', {
      peso: prep.peso, stop, motivo,
      estado: textos ? `Mi regla dice comprar ${et}: ha cerrado en ${c.px(cierre)}, por encima del máximo de los ${c.tramoLlano(p.entrada, marco)} anteriores (${c.px(techo)}). Si cae a ${c.px(stop)}, vendo (stop).` : '',
    });
  }
  return c.senal('nada', {
    motivo: textos ? `cierre ${formato.precio(cierre)} ≤ máximo ${p.entrada} previo ${formato.precio(techo)}` : '',
    estado: textos ? `No tengo ${et}. Compro si cierra por encima de ${c.px(techo)}, su máximo de los últimos ${c.tramoLlano(p.entrada, marco)}.` : '',
  });
}

function trailing() { return null; }

// Vecino más lento: canal de entrada al siguiente valor mayor de la rejilla.
function vecinoMasLento(params) {
  const p = completar(params);
  const e = c.siguienteMayor(rejilla.entrada, p.entrada);
  return e === null ? null : { entrada: e };
}

function describir(params) {
  const p = completar(params);
  return `Donchian ${p.entrada}/${p.salida}, stop ${formato.numero(p.atrStop, 1)}×ATR(${p.atr})`;
}

// En lenguaje llano, con los parámetros de la mesa (§4.3, explicar).
function explicar(params, { universo = [], filtros = [], limites = null } = {}) {
  const p = completar(params);
  const quien = c.activosLlano(universo);
  return {
    queMira: `Mira ${quien} una vez al día: el precio más alto de los últimos ${p.entrada} días y el más bajo de los últimos ${p.salida}.`,
    cuandoCompra: `Compra cuando el precio cierra por encima del máximo de los ${p.entrada} días anteriores (rompe el techo): apuesta a que una subida que rompe récords sigue.`,
    cuandoVende: `Vende cuando cierra por debajo del mínimo de los ${p.salida} días anteriores, o si salta el stop (salida de emergencia) a ${c.numeroLlano(p.atrStop)} veces el movimiento típico de ${p.atr} días (ATR) por debajo de la compra.`,
    cuandoNada: 'Mientras el precio no rompa el techo, no compra; con posición, la mantiene mientras no rompa el suelo.',
    riesgo: `Muchas rupturas fallan y vuelven atrás: pierde poco muchas veces y gana mucho pocas. ${c.riesgoComun(limites)}`,
    filtros: c.explicarFiltros(filtros),
  };
}

module.exports = {
  familia,
  nombre: 'Ruptura Donchian',
  explicacion: explicar(parametrosPorDefecto),
  explicar,
  descripcion: 'Abre cuando el cierre supera el máximo de las 20 velas previas y cierra cuando cae bajo el mínimo de las 10 previas; stop a 2×ATR(20).',
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
