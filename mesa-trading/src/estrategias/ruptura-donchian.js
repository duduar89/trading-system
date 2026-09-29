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
  const tm = c.textoMarco(marco);
  if (!s || i < 1 || i >= s.c.length) return c.senal(posicion ? 'mantener' : 'nada', { estado: textos ? `Sin datos de ${et}` : '' });
  const cierre = s.c[i];
  const techo = s.maxEntrada[i - 1];   // máximo de las `entrada` velas previas
  const suelo = s.minSalida[i - 1];    // mínimo de las `salida` velas previas
  const a = s.atr[i];
  if (techo === null || suelo === null || a === null) {
    const faltan = calentamiento(p) - 1 - i;
    return c.senal(posicion ? 'mantener' : 'nada', { estado: textos ? `Calentando indicadores de ${et} (faltan ${faltan} velas ${tm})` : '' });
  }

  if (posicion) {
    if (cierre < suelo) {
      const motivo = textos ? `cierre ${formato.precio(cierre)} < mínimo ${p.salida} previo ${formato.precio(suelo)}` : '';
      return c.senal('cerrar', { motivo, estado: textos ? `Cierro ${et}: ${motivo} (${tm})` : '' });
    }
    return c.senal('mantener', {
      peso: prep.peso,
      stop: posicion.stop ?? null,
      motivo: textos ? `cierre ${formato.precio(cierre)} ≥ mínimo ${p.salida} previo ${formato.precio(suelo)}` : '',
      estado: textos ? `Largo en ${et} desde ${formato.precio(posicion.entrada)}; sale bajo ${formato.precio(suelo)} o en el stop ${formato.precio(posicion.stop)} (${tm})` : '',
    });
  }

  if (cierre > techo) {
    const stop = cierre - p.atrStop * a;
    const motivo = textos ? `cierre ${formato.precio(cierre)} > máximo ${p.entrada} previo ${formato.precio(techo)}` : '';
    const filtro = c.filtroQueBloquea(prep, simbolo, i, contexto);
    if (filtro) {
      return c.senal('nada', { motivo, estado: textos ? `Ruptura en ${et} ${c.textoBloqueo(filtro, contexto, prep, simbolo, i)}` : '' });
    }
    return c.senal('abrir', {
      peso: prep.peso, stop, motivo,
      estado: textos ? `Abro ${et}: ${motivo}; stop ${formato.precio(stop)} (${tm})` : '',
    });
  }
  return c.senal('nada', {
    motivo: textos ? `cierre ${formato.precio(cierre)} ≤ máximo ${p.entrada} previo ${formato.precio(techo)}` : '',
    estado: textos ? `Sin posición en ${et}. Esperando cierre > máximo ${p.entrada} (${formato.precio(techo)}) (${tm})` : '',
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

module.exports = {
  familia,
  nombre: 'Ruptura Donchian',
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
