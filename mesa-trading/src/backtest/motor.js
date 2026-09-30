'use strict';
// Motor de backtest (§4.5). Imita al vivo tanto como se puede sin libro de
// órdenes:
//
//   · Decide al CIERRE de la vela i con datos ≤ i y ejecuta en la APERTURA de
//     la vela i+1 del mismo símbolo. Nunca en la misma vela.
//   · Compra por nocional, como Alpaca: se gasta el nocional y se recibe
//     nocional·(1−comisión)/precio (la comisión se cobra en el activo). La venta
//     cobra la comisión en dólares. Deslizamiento y penalización de papel
//     empeoran el precio en los dos lados.
//   · Stop dentro de la vela: si el mínimo toca el stop se sale a
//     min(apertura, stop): con hueco a la baja se sale en la apertura.
//   · El trailing se calcula al cierre y vale desde la vela siguiente.
//   · Tamaño con src/cuant/dimensionado.js, igual que en vivo.
//   · Varias series del mismo marco se alinean por t; un símbolo sin vela en
//     un instante simplemente no hace nada en él.
//   · Lo que queda abierto al final se liquida al último cierre (con costes):
//     así Σ pnl de las operaciones = patrimonio final − capital.
//   · HUECO en los datos de un símbolo (más de 4 velas y más de 5 días sin
//     ninguna, comun.umbralHueco): al ver la primera vela de después, la orden
//     pendiente caduca, lo abierto se vende al último cierre ANTERIOR al hueco
//     (motivo 'hueco') y el símbolo no decide hasta que sus indicadores ya no
//     miran nada de antes (comun.velasMemoria, el criterio de velasNecesarias).
//     Sin esto, una orden decidida antes del hueco se llenaba meses después a
//     una apertura rancia (SOL en Alpaca: compra a 18 $ con SOL a 157 $).
//   · Hora de la decisión: el cierre de la vela. En acciones diarias (t a
//     medianoche de Nueva York) es el fin de la sesión, como en vivo
//     (alpaca-datos._cerrada), y no t + 1 día: el contexto (régimen, miedo y
//     codicia) no puede ver lo que pasó entre el cierre de Nueva York y la
//     medianoche UTC.
//
// Extras sobre el contrato (opcionales): desde/hasta (ms) para operar solo en
// un tramo usando todo el histórico anterior como calentamiento; prep ya
// preparado (el walk-forward lo reutiliza entre ventanas); pesoMesa (fracción
// del fondo que es esta mesa: los límites del fondo se aplican sobre
// patrimonio = capital de la mesa / pesoMesa); volObjetivo.

const { dimensionar } = require('../cuant/dimensionado');
const { calcularMetricas, retornosDiarios } = require('./metricas');
const { volatilidad } = require('../mercado/indicadores');
const { asegurarFiltros } = require('../estrategias/filtros');
const comun = require('../estrategias/comun');
const { cierreVelaDiaria } = require('../mercado/regimen');
const { LIMITES_DUROS } = require('../config');
const { DIA } = require('../util/reloj');

// Mismos costes que el bróker simulado (§3.4): comisión cripto 0,25 % (taker
// nivel 1), acciones 0; deslizamiento BTC/ETH 5 pb, resto cripto 15 pb, ETF 2 pb;
// más la penalización de papel por lado.
function costesPorDefecto({ penalizacion = LIMITES_DUROS.penalizacionPapel, multiplicador = 1 } = {}) {
  return {
    comision: s => (comun.esCripto(s) ? 0.0025 : 0) * multiplicador,
    deslizamiento: s => (!comun.esCripto(s) ? 0.0002 : (s === 'BTC/USD' || s === 'ETH/USD') ? 0.0005 : 0.0015) * multiplicador,
    penalizacion: penalizacion * multiplicador,
  };
}

function inferirMarco(velas) {
  let min = Infinity;
  for (const serie of Object.values(velas)) {
    for (let i = 1; i < Math.min(serie.length, 50); i++) min = Math.min(min, serie[i].t - serie[i - 1].t);
  }
  return Number.isFinite(min) && min > 0 ? min : DIA;
}

// Primer índice con t ≥ x.
function primerIndice(serie, x) {
  let lo = 0; let hi = serie.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (serie[m].t < x) lo = m + 1; else hi = m; }
  return lo;
}

// Unión ordenada de los t de todas las series (se guarda en prep: el
// walk-forward la usa para cada ventana y combinación).
function lineaDeTiempo(velas, simbolos, cacheEn) {
  if (cacheEn && cacheEn._lineaTiempo) return cacheEn._lineaTiempo;
  const set = new Set();
  for (const s of simbolos) for (const v of velas[s]) set.add(v.t);
  const linea = Float64Array.from(set).sort();
  if (cacheEn) cacheEn._lineaTiempo = linea;
  return linea;
}

function primerT(linea, x) {
  let lo = 0; let hi = linea.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (linea[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

// Volatilidad 30 d anualizada de cada símbolo, para el término de
// volatilidad del dimensionado (también se guarda en prep).
function volatilidades(velas, simbolos, marco, marcoMs, cacheEn) {
  if (cacheEn && cacheEn._volDim) return cacheEn._volDim;
  const n30 = Math.max(2, Math.round((30 * DIA) / marcoMs));
  const out = {};
  for (const s of simbolos) out[s] = volatilidad(velas[s].map(v => v.c), n30, comun.periodosAnio([s], marco));
  if (cacheEn) cacheEn._volDim = out;
  return out;
}

// Índices de reanudación tras un hueco de cada símbolo (también en prep).
function huecosDe(velas, simbolos, umbral, cacheEn) {
  if (cacheEn && cacheEn._huecos && cacheEn._huecos.umbral === umbral) return cacheEn._huecos.porSimbolo;
  const porSimbolo = {};
  for (const s of simbolos) porSimbolo[s] = comun.reanudaciones(velas[s], umbral);
  if (cacheEn) cacheEn._huecos = { umbral, porSimbolo };
  return porSimbolo;
}

function parametrosBase(estrategia, simbolos) {
  return estrategia.parametrosPara ? estrategia.parametrosPara(simbolos) : estrategia.parametrosPorDefecto;
}

function backtest({
  velas, estrategia, params, filtros = [], capital = 10000, costes, contexto, limites, periodosAnio,
  desde = -Infinity, hasta = Infinity, prep, pesoMesa = 1, volObjetivo = 0.40,
} = {}) {
  if (!velas || typeof velas !== 'object') throw new Error('backtest: faltan velas');
  if (!estrategia || typeof estrategia.decidir !== 'function') throw new Error('backtest: falta la estrategia');
  const simbolos = Object.keys(velas).filter(s => Array.isArray(velas[s]) && velas[s].length);
  const marco = estrategia.marco;
  const marcoMs = comun.MARCOS[marco] || inferirMarco(velas);
  const pa = periodosAnio || (simbolos.length && simbolos.every(comun.esCripto) ? 365 : 252);
  const p = { ...parametrosBase(estrategia, simbolos), ...(params || {}) };
  const pr = prep || estrategia.preparar(velas, p);
  const listaFiltros = asegurarFiltros(filtros);
  const cst = costes || costesPorDefecto();
  const lim = limites || LIMITES_DUROS;
  const minNocional = lim.minNocionalOrden > 0 ? lim.minNocionalOrden : 0;
  const vol = volatilidades(velas, simbolos, marco, marcoMs, pr);
  const linea = lineaDeTiempo(velas, simbolos, pr);
  const umbral = comun.umbralHueco(marcoMs);
  const huecos = huecosDe(velas, simbolos, umbral, pr);
  const recalentar = comun.velasMemoria(estrategia, p, listaFiltros);
  const acciones1D = marco === '1Day' && simbolos.length > 0 && !simbolos.some(comun.esCripto);

  const k0 = primerT(linea, desde);
  const k1 = primerT(linea, hasta); // exclusivo
  const ptr = {};
  for (const s of simbolos) ptr[s] = primerIndice(velas[s], desde);

  let efectivo = capital;
  const pos = {};
  const pendiente = {};
  const ultimoCierre = {};
  const operaciones = [];
  const curva = [];
  let sumaExpo = 0;

  const coste = s => (cst.deslizamiento ? cst.deslizamiento(s) : 0) + (cst.penalizacion || 0);
  const comision = s => (cst.comision ? cst.comision(s) : 0);

  function comprar(s, precioBase, nocional, t, stop) {
    const precio = precioBase * (1 + coste(s));
    const com = comision(s);
    pos[s] = {
      cantidad: (nocional * (1 - com)) / precio,
      entrada: precio,
      entradaT: t,
      stop: stop ?? null,
      maxPrecio: precio,
      barrasAbierta: 0,
      nocional,
      comisionEntrada: nocional * com,
    };
    efectivo -= nocional;
  }

  function vender(s, precioBase, motivo, t, barrasExtra = 0) {
    const ps = pos[s];
    const precio = precioBase * (1 - coste(s));
    const bruto = ps.cantidad * precio;
    const comS = bruto * comision(s);
    const neto = bruto - comS;
    efectivo += neto;
    const pnl = neto - ps.nocional;
    operaciones.push({
      simbolo: s,
      entradaT: ps.entradaT,
      entradaPrecio: ps.entrada,
      salidaT: t,
      salidaPrecio: precio,
      cantidad: ps.cantidad,
      pnl,
      pnlPct: pnl / ps.nocional,
      comisiones: ps.comisionEntrada + comS,
      barras: ps.barrasAbierta + barrasExtra,
      motivoSalida: motivo,
      stop: ps.stop,
    });
    pos[s] = null;
  }

  const hoy = []; // [simbolo, j] con vela en el instante actual
  for (let k = k0; k < k1; k++) {
    const T = linea[k];
    hoy.length = 0;
    for (const s of simbolos) {
      const serie = velas[s];
      if (ptr[s] < serie.length && serie[ptr[s]].t === T) {
        const j = ptr[s];
        if (j > 0 && T - serie[j - 1].t > umbral) {
          // Primera vela tras un hueco: nada de lo decidido antes vale.
          pendiente[s] = null;
          if (pos[s]) vender(s, serie[j - 1].c, 'hueco', serie[j - 1].t + marcoMs);
        }
        hoy.push(s, j); ptr[s]++;
      }
    }

    // 1) Órdenes pendientes en la apertura: primero ventas (liberan efectivo).
    for (let h = 0; h < hoy.length; h += 2) {
      const s = hoy[h]; const v = velas[s][hoy[h + 1]];
      if (pendiente[s] && pendiente[s].tipo === 'cerrar') {
        if (pos[s]) vender(s, v.o, 'señal', T);
        pendiente[s] = null;
      }
    }
    for (let h = 0; h < hoy.length; h += 2) {
      const s = hoy[h]; const v = velas[s][hoy[h + 1]];
      const pd = pendiente[s];
      if (pd && pd.tipo === 'abrir') {
        pendiente[s] = null;
        const nocional = Math.min(pd.nocional, efectivo); // sin margen
        if (!pos[s] && nocional >= minNocional && nocional > 0) comprar(s, v.o, nocional, T, pd.stop);
      }
    }

    // 2) Stops dentro de la vela (también en la vela de entrada: la apertura es el primer precio).
    for (let h = 0; h < hoy.length; h += 2) {
      const s = hoy[h]; const v = velas[s][hoy[h + 1]];
      const ps = pos[s];
      if (ps && ps.stop !== null && v.l <= ps.stop) vender(s, Math.min(v.o, ps.stop), 'stop', T, 1);
    }

    // 3) Cierre: marcar la vela y valorar.
    for (let h = 0; h < hoy.length; h += 2) {
      const s = hoy[h]; const v = velas[s][hoy[h + 1]];
      ultimoCierre[s] = v.c;
      const ps = pos[s];
      if (ps) { ps.barrasAbierta++; if (v.c > ps.maxPrecio) ps.maxPrecio = v.c; }
    }
    let invertido = 0;
    for (const s of simbolos) if (pos[s]) invertido += pos[s].cantidad * ultimoCierre[s];
    const patrimonio = efectivo + invertido;
    curva.push({ t: T, valor: patrimonio });
    if (patrimonio > 0) sumaExpo += invertido / patrimonio;

    // 4) Decisiones al cierre (en la última vela no se decide: no hay apertura siguiente).
    if (k === k1 - 1) break;
    const tDecision = acciones1D ? cierreVelaDiaria(T) : T + marcoMs;
    const ctx = contexto ? (contexto(tDecision) || {}) : {};
    const ctxEstrategia = { regimen: ctx.regimen ?? null, fg: ctx.fg ?? null, volPercentil: ctx.volPercentil ?? null, filtros: listaFiltros };
    for (let h = 0; h < hoy.length; h += 2) {
      const s = hoy[h]; const j = hoy[h + 1];
      if (j - comun.ultimaReanudacion(huecos[s], j) < recalentar) continue; // recalentando tras un hueco
      const ps = pos[s];
      if (ps) {
        const nuevo = estrategia.trailing(pr, { simbolo: s, i: j, posicion: ps, params: p });
        if (nuevo !== null && nuevo !== undefined && Number.isFinite(nuevo) && (ps.stop === null || nuevo > ps.stop)) ps.stop = nuevo;
      }
      const posicion = ps ? { cantidad: ps.cantidad, entrada: ps.entrada, entradaT: ps.entradaT, stop: ps.stop, maxPrecio: ps.maxPrecio, barrasAbierta: ps.barrasAbierta } : null;
      const senal = estrategia.decidir(pr, { simbolo: s, i: j, posicion, t: tDecision, contexto: ctxEstrategia, textos: false });
      if (!senal) continue;
      if (senal.accion === 'abrir' && !ps && !pendiente[s]) {
        const cierre = velas[s][j].c;
        const dim = dimensionar({
          capitalMesa: patrimonio,
          peso: senal.peso,
          precio: cierre,
          stop: senal.stop,
          volAnual: vol[s][j],
          patrimonio: patrimonio / pesoMesa,
          limites: lim,
          volObjetivo,
        });
        if (dim.nocional >= minNocional && dim.nocional > 0) {
          pendiente[s] = { tipo: 'abrir', nocional: dim.nocional, stop: senal.stop, limitadoPor: dim.limitadoPor };
        }
      } else if (senal.accion === 'cerrar' && ps) {
        pendiente[s] = { tipo: 'cerrar' };
      }
    }
  }

  // 5) Fin: liquidar al último cierre.
  if (curva.length) {
    const tFin = curva[curva.length - 1].t + marcoMs;
    for (const s of simbolos) if (pos[s]) vender(s, ultimoCierre[s], 'fin', tFin);
    curva[curva.length - 1] = { t: curva[curva.length - 1].t, valor: efectivo };
  }

  const metricas = calcularMetricas({ curva, operaciones, periodosAnio: pa });
  metricas.exposicionMedia = curva.length ? sumaExpo / curva.length : 0;
  return { operaciones, curva, metricas, retornosDiarios: retornosDiarios(curva), params: p };
}

// Comprar y mantener a partes iguales (la sombra con la que se compara todo):
// cada símbolo recibe capital/n en su primera apertura del tramo, con costes,
// y se liquida al final como las estrategias. Tras un HUECO en los datos de un
// símbolo se vende al último cierre anterior al hueco y lo cobrado se vuelve a
// invertir en la apertura de la SEGUNDA vela de después: la primera abre con
// el precio rancio de antes del hueco (SOL en Alpaca: 18 $ con SOL a 157 $).
function compraYMantener({ velas, capital = 10000, costes, desde = -Infinity, hasta = Infinity, periodosAnio, marcoMs } = {}) {
  const simbolos = Object.keys(velas).filter(s => Array.isArray(velas[s]) && velas[s].length);
  const cst = costes || costesPorDefecto();
  const mMs = marcoMs || inferirMarco(velas);
  const pa = periodosAnio || (simbolos.every(comun.esCripto) ? 365 : 252);
  const umbral = comun.umbralHueco(mMs);
  const linea = lineaDeTiempo(velas, simbolos, null);
  const k0 = primerT(linea, desde);
  const k1 = primerT(linea, hasta);
  const ptr = {};
  for (const s of simbolos) ptr[s] = primerIndice(velas[s], desde);
  const aInvertir = {};
  for (const s of simbolos) aInvertir[s] = capital / Math.max(1, simbolos.length);
  let efectivo = capital;
  const pos = {};          // s → { cantidad, invertido, t, precio }
  const ultimo = {};
  const curva = [];
  const operaciones = [];
  const coste = s => (cst.deslizamiento ? cst.deslizamiento(s) : 0) + (cst.penalizacion || 0);
  const comision = s => (cst.comision ? cst.comision(s) : 0);

  function liquidar(s, precioBase, motivo, t) {
    const ps = pos[s];
    const precio = precioBase * (1 - coste(s));
    const neto = ps.cantidad * precio * (1 - comision(s));
    efectivo += neto;
    operaciones.push({
      simbolo: s, entradaT: ps.t, entradaPrecio: ps.precio, salidaT: t, salidaPrecio: precio,
      cantidad: ps.cantidad, pnl: neto - ps.invertido, pnlPct: (neto - ps.invertido) / ps.invertido, comisiones: null, barras: null, motivoSalida: motivo,
    });
    pos[s] = null;
    return neto;
  }

  for (let k = k0; k < k1; k++) {
    const T = linea[k];
    for (const s of simbolos) {
      const serie = velas[s];
      if (!(ptr[s] < serie.length && serie[ptr[s]].t === T)) continue;
      const j = ptr[s]++;
      const v = serie[j];
      const trasHueco = j > 0 && T - serie[j - 1].t > umbral;
      if (trasHueco && pos[s]) aInvertir[s] = liquidar(s, serie[j - 1].c, 'hueco', serie[j - 1].t + mMs);
      if (!pos[s] && aInvertir[s] > 0 && !trasHueco) {
        const precio = v.o * (1 + coste(s));
        pos[s] = { cantidad: (aInvertir[s] * (1 - comision(s))) / precio, invertido: aInvertir[s], t: T, precio };
        efectivo -= aInvertir[s];
        aInvertir[s] = 0;
      }
      ultimo[s] = v.c;
    }
    let valor = efectivo;
    for (const s of simbolos) if (pos[s]) valor += pos[s].cantidad * ultimo[s];
    curva.push({ t: T, valor });
  }
  if (curva.length) {
    const tFin = curva[curva.length - 1].t + mMs;
    for (const s of simbolos) if (pos[s]) liquidar(s, ultimo[s], 'fin', tFin);
    curva[curva.length - 1] = { t: curva[curva.length - 1].t, valor: efectivo };
  }
  const metricas = calcularMetricas({ curva, operaciones, periodosAnio: pa });
  return { operaciones, curva, metricas, retornosDiarios: retornosDiarios(curva) };
}

module.exports = { backtest, compraYMantener, costesPorDefecto };
