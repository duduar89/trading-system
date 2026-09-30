'use strict';
// Rotación por momentum (1D). En cada rebalanceo se ordenan los activos de la
// mesa por su puntuación de momentum y se mantienen los `top` primeros, cada
// uno con peso 1/top; el resto se vende. Solo entra un activo cuya
// rentabilidad (media de los lookbacks) sea > 0: si ninguno sube, liquidez.
// Entre rebalanceos: 'mantener' con posición, 'nada' sin ella. Un stop de
// catástrofe a 3 × ATR(14) protege entre rebalanceos; sin trailing.
//
// Dos perfiles por parámetros:
//   cripto: lookback 28 ajustado por volatilidad (rent. 28 d / vol. 28 d),
//           rebalanceo semanal: decide al cierre de la vela del domingo, que
//           termina el lunes 00:00 UTC, y se ejecuta el lunes.
//   etf:    media de las rentabilidades a 63, 126 y 252 sesiones, rebalanceo
//           mensual: decide al cierre de la primera sesión de cada mes (no hace
//           falta calendario de festivos para saber que empezó el mes).
//
// `iAnterior` (opcional) es la última vela que se decidió: si el rebalanceo
// cayó en una vela que no se decidió (ordenador apagado el lunes), se hace en
// la primera que se decida después. Sin iAnterior es la vela anterior.
//
// Tras un hueco en los datos de un símbolo (comun.umbralHueco) su puntuación
// queda vacía mientras sus indicadores miren algo de antes (comun.velasMemoria,
// las mismas velas que el motor lo deja sin decidir): si no, la rentabilidad de
// 28 velas mezcla precios de antes y después (SOL en Alpaca, +650 % falsos) y
// el símbolo ocupa un puesto del top que nadie puede comprar.

const { rentabilidad, volatilidad, atr, cierres } = require('../mercado/indicadores');
const formato = require('../util/formato');
const c = require('./comun');

const familia = 'momentum-rotacion';
const marco = '1Day';

const parametrosPorDefecto = Object.freeze({
  perfil: 'cripto', lookbacks: Object.freeze([28]), ajustarVol: true, top: 2, rebalanceo: 'semanal', soloPositivos: true, atr: 14, atrStop: 3,
});
const parametrosEtf = Object.freeze({
  perfil: 'etf', lookbacks: Object.freeze([63, 126, 252]), ajustarVol: false, top: 2, rebalanceo: 'mensual', soloPositivos: true, atr: 14, atrStop: 3,
});

// cripto 5 × 3 = 15 combinaciones; etf 4 × 3 = 12.
const rejilla = Object.freeze({ lookbacks: [[14], [21], [28], [42], [56]], top: [1, 2, 3] });
const rejillaEtf = Object.freeze({ lookbacks: [[21, 63, 126], [63, 126, 252], [126, 252], [252]], top: [1, 2, 3] });

const dominio = Object.freeze({
  perfil: ['cripto', 'etf'],
  lookbacks: [...rejilla.lookbacks, ...rejillaEtf.lookbacks],
  ajustarVol: [true, false],
  top: [1, 2, 3],
  rebalanceo: ['semanal', 'mensual'],
  soloPositivos: [true, false],
  atr: [14],
  atrStop: c.DOMINIO_ATR_STOP,
});

function parametrosPara(simbolos) {
  return (simbolos || []).length && simbolos.every(c.esCripto) ? parametrosPorDefecto : parametrosEtf;
}
function rejillaPara(simbolos) {
  return (simbolos || []).length && simbolos.every(c.esCripto) ? rejilla : rejillaEtf;
}

function completar(params) {
  const base = params && params.perfil === 'etf' ? parametrosEtf : parametrosPorDefecto;
  return { ...base, ...(params || {}) };
}

function calentamiento(params) {
  const p = completar(params);
  return Math.max(Math.max(...p.lookbacks) + 1, p.atr);
}

function preparar(velasPorSimbolo, params) {
  const p = completar(params);
  const simbolos = Object.keys(velasPorSimbolo);
  const porSimbolo = {};
  for (const s of simbolos) {
    const velas = velasPorSimbolo[s];
    const cc = cierres(velas);
    const pa = c.periodosAnio([s], marco);
    const huecos = c.reanudaciones(velas, c.umbralHueco(c.MARCOS[marco]));
    const ventana = c.velasMemoria({ calentamiento, marco }, p);
    const rents = p.lookbacks.map(L => rentabilidad(cc, L));
    const vols = p.ajustarVol ? p.lookbacks.map(L => volatilidad(cc, Math.max(2, L), pa)) : null;
    const n = cc.length;
    const puntuacion = new Array(n).fill(null);
    const rentMedia = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (huecos.length && i - c.ultimaReanudacion(huecos, i) < ventana) continue;
      let sp = 0; let sr = 0; let ok = true;
      for (let k = 0; k < p.lookbacks.length; k++) {
        const r = rents[k][i];
        if (r === null) { ok = false; break; }
        sr += r;
        if (vols) {
          const v = vols[k][i];
          if (v === null || v <= 0) { ok = false; break; }
          sp += r / v;
        } else sp += r;
      }
      if (ok) { puntuacion[i] = sp / p.lookbacks.length; rentMedia[i] = sr / p.lookbacks.length; }
    }
    porSimbolo[s] = { c: cc, t: velas.map(v => v.t), puntuacion, rentMedia, atr: atr(velas, p.atr), indice: c.indicesPorT(velas) };
  }
  const marcoMs = c.MARCOS[marco];
  return { familia, marco, marcoMs, params: p, velas: velasPorSimbolo, simbolos, porSimbolo, peso: 1 / p.top, _ranking: new Map() };
}

// ¿Hay rebalanceo en alguna vela de (iAnterior, i]? Semanal: una vela que
// termina el lunes 00:00 UTC. Mensual: cambio de mes entre iAnterior e i.
function esRebalanceo(prep, s, i, iAnterior = i - 1) {
  const desde = Number.isInteger(iAnterior) && iAnterior < i ? iAnterior : i - 1;
  if (prep.params.rebalanceo === 'semanal') {
    for (let k = Math.max(desde + 1, 0); k <= i; k++) {
      const siguiente = new Date(s.t[k] + prep.marcoMs);
      if (siguiente.getUTCDay() === 1 && siguiente.getUTCHours() === 0 && siguiente.getUTCMinutes() === 0) return true;
    }
    return false;
  }
  if (desde < 0) return false;
  const a = new Date(s.t[desde]);
  const b = new Date(s.t[i]);
  return a.getUTCMonth() !== b.getUTCMonth() || a.getUTCFullYear() !== b.getUTCFullYear();
}

// Clasificación de todos los símbolos de la mesa en el instante t (solo los
// que tienen vela en t y puntuación). Se guarda por t: la piden todos los
// símbolos de la misma vela.
function ranking(prep, t) {
  let r = prep._ranking.get(t);
  if (r) return r;
  const p = prep.params;
  const filas = [];
  for (const sim of prep.simbolos) {
    const s = prep.porSimbolo[sim];
    const i = s.indice.get(t);
    if (i === undefined || s.puntuacion[i] === null) continue;
    filas.push({ simbolo: sim, puntuacion: s.puntuacion[i], rent: s.rentMedia[i] });
  }
  filas.sort((a, b) => b.puntuacion - a.puntuacion || (a.simbolo < b.simbolo ? -1 : 1));
  const elegidos = new Set();
  for (const f of filas) {
    if (elegidos.size >= p.top) break;
    if (p.soloPositivos && !(f.rent > 0)) continue;
    elegidos.add(f.simbolo);
  }
  r = { filas, elegidos };
  prep._ranking.set(t, r);
  return r;
}

function textoPuesto(r, simbolo) {
  const k = r.filas.findIndex(f => f.simbolo === simbolo);
  return k < 0 ? 'sin puntuación' : `puesto ${k + 1} de ${r.filas.length}`;
}

function textoPerfil(p) {
  const lb = p.lookbacks.join('/');
  return p.ajustarVol ? `momentum ${lb} d ajustado por vol.` : `momentum ${lb} sesiones`;
}

// Lo mismo en llano, para el chat y la tarjeta del puesto (§4.3).
function puestoLlano(r, simbolo) {
  const k = r.filas.findIndex(f => f.simbolo === simbolo);
  return k < 0 ? null : `el ${k + 1}.º de ${r.filas.length}`;
}
function perfilLlano(p) {
  const dias = c.listaLlana(p.lookbacks.map(String));
  const unidad = p.ajustarVol ? 'días' : 'sesiones';
  return `lo que ha subido en ${dias} ${unidad}${p.ajustarVol ? ', descontando lo que se mueve' : ''}`;
}

function decidir(prep, { simbolo, i, iAnterior, posicion = null, contexto = {}, textos = true } = {}) {
  const p = prep.params;
  const s = prep.porSimbolo[simbolo];
  const et = c.etiqueta(simbolo);
  const prox = p.rebalanceo === 'semanal' ? 'el lunes' : 'a principio de mes';
  if (!s || i < 0 || i >= s.c.length) return c.senal(posicion ? 'mantener' : 'nada', { estado: textos ? `No tengo datos de ${et} ahora mismo.` : '' });

  if (!esRebalanceo(prep, s, i, iAnterior)) {
    if (posicion) {
      return c.senal('mantener', {
        peso: prep.peso, stop: posicion.stop ?? null,
        estado: textos ? `Tengo ${et} desde ${c.px(posicion.entrada)}; si cae a ${c.px(posicion.stop)}, vendo (stop). Vuelvo a repartir ${prox}.` : '',
      });
    }
    if (!textos) return c.senal('nada');
    const r = ranking(prep, s.t[i]);
    const pl = puestoLlano(r, simbolo);
    return c.senal('nada', { estado: `No tengo ${et}${pl ? `: es ${pl} por ${perfilLlano(p)}` : ''}. Solo compro los ${p.top} primeros; vuelvo a repartir ${prox}.` });
  }

  const r = ranking(prep, s.t[i]);
  const puntuacion = s.puntuacion[i];
  const rent = s.rentMedia[i];
  const motivoBase = textos
    ? (puntuacion === null ? `sin ${Math.max(...p.lookbacks)} velas de historia` : `${textoPuesto(r, simbolo)} en ${textoPerfil(p)}; rentabilidad ${formato.pct(rent, { signo: true })}`)
    : '';
  // «es el 2.º de 6 por lo que ha subido en 28 días (+12,3 %)», o por qué no hay puesto.
  const pl = puntuacion === null ? null : puestoLlano(r, simbolo);
  const motivoLlano = textos
    ? (pl ? `es ${pl} por ${perfilLlano(p)} (${formato.pct(rent, { signo: true })})` : `aún no tiene ${Math.max(...p.lookbacks)} días de historia`)
    : '';

  if (r.elegidos.has(simbolo)) {
    if (posicion) {
      return c.senal('mantener', {
        peso: prep.peso, stop: posicion.stop ?? null, motivo: motivoBase,
        estado: textos ? `Reparto de nuevo y me quedo ${et}: ${motivoLlano}, sigue entre los ${p.top} primeros.` : '',
      });
    }
    const a = s.atr[i];
    if (a === null) return c.senal('nada', { estado: textos ? `Aún no compro ${et}: me falta historia para calcular cuánto se mueve y dónde poner el stop.` : '' });
    const stop = s.c[i] - p.atrStop * a;
    const filtro = c.filtroQueBloquea(prep, simbolo, i, contexto);
    if (filtro) {
      return c.senal('nada', { motivo: motivoBase, estado: textos ? `Reparto de nuevo: ${et} entra entre los ${p.top} primeros, pero no compro: ${c.bloqueoLlano(filtro, contexto, prep, simbolo, i)}.` : '' });
    }
    return c.senal('abrir', {
      peso: prep.peso, stop, motivo: motivoBase,
      estado: textos ? `Reparto de nuevo y mi regla dice comprar ${et}: ${motivoLlano}. Si cae a ${c.px(stop)}, vendo (stop).` : '',
    });
  }

  if (posicion) {
    const negativa = p.soloPositivos && !(rent > 0) && puntuacion !== null;
    const porque = textos ? (negativa ? `rentabilidad ${formato.pct(rent, { signo: true })} ≤ 0` : `fuera del top ${p.top} (${textoPuesto(r, simbolo)})`) : '';
    const porqueLlano = textos
      ? (negativa ? `en su tramo va ${formato.pct(rent, { signo: true })} y esta mesa solo tiene lo que sube` : `ya no está entre los ${p.top} primeros${pl ? ` (es ${pl})` : ''}`)
      : '';
    return c.senal('cerrar', { motivo: porque, estado: textos ? `Reparto de nuevo y mi regla dice vender ${et}: ${porqueLlano}.` : '' });
  }
  return c.senal('nada', { motivo: motivoBase, estado: textos ? `Reparto de nuevo: ${et} se queda fuera (${motivoLlano}; solo entran los ${p.top} primeros).` : '' });
}

function trailing() { return null; }

// Vecino más lento: el siguiente juego de lookbacks más largo de la rejilla del perfil.
function vecinoMasLento(params) {
  const p = completar(params);
  const lista = (p.perfil === 'etf' ? rejillaEtf : rejilla).lookbacks;
  // Más lento = lookback medio mayor (en empate, el de máximo mayor).
  const clave = lb => (lb.reduce((a, b) => a + b, 0) / lb.length) * 1e4 + Math.max(...lb);
  const actual = clave(p.lookbacks);
  const mayores = lista.filter(lb => clave(lb) > actual).sort((a, b) => clave(a) - clave(b));
  return mayores.length ? { lookbacks: [...mayores[0]] } : null;
}

function describir(params) {
  const p = completar(params);
  return `${textoPerfil(p)}, top ${p.top}, rebalanceo ${p.rebalanceo}${p.soloPositivos ? ', solo con rentabilidad > 0' : ''}, stop ${formato.numero(p.atrStop, 1)}×ATR(${p.atr})`;
}

// En lenguaje llano, con los parámetros de la mesa (§4.3, explicar).
function explicar(params, { universo = [], filtros = [], limites = null } = {}) {
  const base = params && params.perfil === 'etf' ? parametrosEtf : parametrosPorDefecto;
  const p = { ...base, ...(params || {}) };
  const n = (universo || []).length;
  const quien = c.activosLlano(universo, 'los activos de la mesa');
  const etf = p.perfil === 'etf';
  const lb = c.listaLlana(p.lookbacks.map(String));
  const media = p.lookbacks.length > 1 ? ` (la media de ${etf ? 'las' : 'los'} ${p.lookbacks.length})` : '';
  const tramo = etf ? `las últimas ${lb} sesiones de bolsa${media}` : `los últimos ${lb} días${media}`;
  const cuando = p.rebalanceo === 'semanal' ? 'Cada lunes' : 'A principio de cada mes';
  const top = p.top === 1 ? 'el que más ha subido' : `los ${p.top} que más han subido`;
  return {
    queMira: `Mira ${quien}${n ? ` (${n})` : ''} y los ordena por cuánto han subido en ${tramo}${p.ajustarVol ? ', descontando lo nerviosos que son (la subida se divide por su volatilidad: un activo que sube a trompicones puntúa menos)' : ''}.`,
    cuandoCompra: `${cuando} compra ${top} (momentum: lo que sube tiende a seguir subiendo un tiempo)${p.soloPositivos ? ', pero solo si de verdad ha subido: si todos bajan, se queda en efectivo' : ''}.`,
    cuandoVende: `${cuando} vende lo que ya no está entre ${p.top === 1 ? 'el primero' : `los ${p.top} primeros`}${p.soloPositivos ? ' o ha dejado de subir' : ''}. Entre medias solo vende si salta el stop de emergencia, a ${c.numeroLlano(p.atrStop)} veces el movimiento típico de ${p.atr} días (ATR) por debajo de la compra.`,
    cuandoNada: `${p.rebalanceo === 'semanal' ? 'De martes a domingo' : 'El resto del mes'} no toca nada: mantiene lo que tiene.`,
    riesgo: `Llega tarde a los giros: cuando el mercado se da la vuelta, aguanta hasta el siguiente ${p.rebalanceo === 'semanal' ? 'lunes' : 'mes'} o hasta el stop. Con pocos activos elegidos, el resultado depende mucho de ellos. ${c.riesgoComun(limites)}`,
    filtros: c.explicarFiltros(filtros),
  };
}

module.exports = {
  familia,
  nombre: 'Rotación por momentum',
  explicacion: explicar(parametrosPorDefecto),
  explicar,
  descripcion: 'Mantiene los 2 activos con más momentum (cripto: 28 días ajustado por volatilidad, cada lunes; ETF: 63/126/252 sesiones, cada mes), solo si su rentabilidad es positiva; stop de catástrofe a 3×ATR(14).',
  marco,
  parametrosPorDefecto,
  parametrosEtf,
  rejilla,
  rejillaEtf,
  dominio,
  parametrosPara,
  rejillaPara,
  calentamiento,
  preparar,
  decidir,
  trailing,
  vecinoMasLento,
  describir,
  esRebalanceo,
};
