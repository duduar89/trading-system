'use strict';
// Laboratorio (§4.8): el único camino para que entre una estrategia nueva.
//
// Gramática CERRADA: una hipótesis es una familia del catálogo sobre un
// universo, con filtros del catálogo y, como mucho, unos parámetros fijados
// dentro del dominio de la familia. No hay reglas nuevas ni valores continuos.
//
// Criterios de aprobación (TODOS):
//   Sharpe OOS ≥ 0,6 · ≥ 75 % de ventanas de prueba con rentabilidad > 0 ·
//   DSR ≥ 0,90 con el contador de ensayos · ≥ 30 operaciones OOS ·
//   maxDD OOS ≤ 1,5 × maxDDReferencia · correlación diaria con cada mesa activa < 0,7.
//
// Mapa pista → hipótesis (cerrado):
//   contra_regimen → añadir filtro regimen-no-riskoff
//   stop_estrecho  → atrStop + 0,5
//   señal_falsa    → vecino más lento de la rejilla
//   noticia, ejecucion → nada (no hay histórico con qué probarlas)

const { FAMILIAS } = require('../estrategias');
const { validarFiltro } = require('../estrategias/filtros');
const comun = require('../estrategias/comun');
const { walkForwardAsync } = require('../backtest/walkforward');
const { compraYMantener, costesPorDefecto } = require('../backtest/motor');
const { sharpeDeflactado, momentos, correlacion } = require('../backtest/metricas');
const formato = require('../util/formato');

const CRITERIOS = Object.freeze({
  sharpeMin: 0.6,
  fraccionVentanas: 0.75,
  dsrMin: 0.90,
  operacionesMin: 30,
  factorMaxDD: 1.5,
  correlacionMax: 0.7,
});
const MAX_HIPOTESIS = 3;

// Filtros que prueba la exploración semanal, en este orden (dentro del catálogo).
const EXPLORACION = Object.freeze([
  { id: 'regimen-no-riskoff', parametro: null },
  { id: 'vol-max', parametro: 90 },
  { id: 'fg-max', parametro: 80 },
  { id: 'fg-min', parametro: 20 },
]);

function simbolosDe(universo) {
  if (!Array.isArray(universo)) return null;
  return universo.map(a => (typeof a === 'string' ? a : a && a.simbolo)).filter(Boolean);
}

function enDominio(valores, v) {
  return valores.some(x => comun.igual(x, v));
}

function validarHipotesis(h, { universo, familias = FAMILIAS } = {}) {
  const mal = error => ({ ok: false, error });
  if (!h || typeof h !== 'object') return mal('hipótesis vacía');
  if (typeof h.id !== 'string' || !h.id.trim()) return mal('falta id');
  const est = familias[h.familia];
  if (!est) return mal(`familia desconocida: ${h.familia}`);
  if (h.marco !== est.marco) return mal(`marco ${h.marco} no es el de ${h.familia} (${est.marco})`);
  if (!Array.isArray(h.universo) || h.universo.length === 0) return mal('universo vacío');
  if (new Set(h.universo).size !== h.universo.length) return mal('universo con símbolos repetidos');
  const permitidos = simbolosDe(universo);
  if (permitidos) {
    const fuera = h.universo.filter(s => !permitidos.includes(s));
    if (fuera.length) return mal(`símbolos fuera del universo: ${fuera.join(', ')}`);
  }
  const cripto = h.universo.filter(comun.esCripto).length;
  if (cripto !== 0 && cripto !== h.universo.length) return mal('no se mezclan cripto y acciones en una hipótesis');
  if (h.filtros !== undefined && !Array.isArray(h.filtros)) return mal('filtros debe ser una lista');
  const ids = new Set();
  for (const f of h.filtros || []) {
    const v = validarFiltro(f);
    if (!v.ok) return mal(v.error);
    if (ids.has(f.id)) return mal(`filtro repetido: ${f.id}`);
    ids.add(f.id);
  }
  if (h.params !== undefined && h.params !== null) {
    if (typeof h.params !== 'object' || Array.isArray(h.params)) return mal('params debe ser un objeto');
    for (const [k, v] of Object.entries(h.params)) {
      const dom = est.dominio && est.dominio[k];
      if (!dom) return mal(`parámetro ${k} no existe en ${h.familia}`);
      if (!enDominio(dom, v)) return mal(`valor ${JSON.stringify(v)} fuera del dominio de ${k}`);
    }
    if (h.familia === 'tendencia-sma') {
      const p = { ...est.parametrosPorDefecto, ...h.params };
      if (p.rapida >= p.lenta) return mal('la media rápida debe ser menor que la lenta');
    }
  }
  if (h.origen !== 'leccion' && h.origen !== 'exploracion') return mal(`origen inválido: ${h.origen}`);
  if (typeof h.motivo !== 'string' || !h.motivo.trim()) return mal('falta motivo');
  return { ok: true, error: null };
}

function varianzaMuestral(xs) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
}

function describirHipotesis(h) {
  const ets = h.universo.map(comun.etiqueta).join(', ');
  const filtros = (h.filtros || []).map(f => (f.parametro === null || f.parametro === undefined ? f.id : `${f.id} ${f.parametro}`));
  const params = h.params && Object.keys(h.params).length ? `; fija ${Object.entries(h.params).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : v}`).join(', ')}` : '';
  return `${h.familia} en ${ets} (${comun.textoMarco(h.marco)})${filtros.length ? `, filtros: ${filtros.join(', ')}` : ''}${params}`;
}

const sino = ok => (ok ? 'cumple' : 'NO cumple');

async function evaluarHipotesis(h, {
  cargarVelas, contextoHistorico, ensayosPrevios = 0, retornosMesasActivas = {}, maxDDReferencia,
  costes, limites, universo, familias = FAMILIAS, pesoMesa = 1, capital = 10000,
} = {}) {
  const v = validarHipotesis(h, { universo, familias });
  if (!v.ok) {
    return { aprobada: false, criterios: [], walkforward: null, dsr: null, correlacionMax: null, informe: `Hipótesis ${h && h.id} no válida: ${v.error}` };
  }
  if (typeof cargarVelas !== 'function') throw new Error('evaluarHipotesis: falta cargarVelas(sim, marco)');
  const est = familias[h.familia];
  const velas = {};
  for (const s of h.universo) velas[s] = (await cargarVelas(s, h.marco)) || [];
  const cst = costes || costesPorDefecto();
  const pa = h.universo.every(comun.esCripto) ? 365 : 252;

  const wf = await walkForwardAsync({
    velas, estrategia: est, filtros: h.filtros || [], costes: cst, contexto: contextoHistorico,
    limites, periodosAnio: pa, fijos: h.params || {}, pesoMesa, capital,
  });
  const ensayos = ensayosPrevios + wf.combinaciones;
  const cabecera = `Hipótesis ${h.id}: ${describirHipotesis(h)}.`;

  if (!wf.suficiente) {
    return {
      aprobada: false,
      criterios: [{ nombre: 'Datos suficientes', valor: wf.ventanas.length, umbral: 4, ok: false }],
      walkforward: wf, dsr: null, correlacionMax: null, ensayos,
      informe: `${cabecera} Sin datos suficientes para el walk-forward (${wf.motivo}). RECHAZADA.`,
    };
  }

  const m = wf.oos.metricas;
  const criterios = [];

  criterios.push({ nombre: 'Sharpe OOS', valor: m.sharpe, umbral: CRITERIOS.sharpeMin, ok: m.sharpe !== null && m.sharpe >= CRITERIOS.sharpeMin });

  const total = wf.ventanas.length;
  const positivas = wf.ventanas.filter(x => x.metricasPrueba.rentabilidad > 0).length;
  const fraccion = total ? positivas / total : 0;
  criterios.push({ nombre: 'Ventanas de prueba en positivo', valor: fraccion, umbral: CRITERIOS.fraccionVentanas, ok: fraccion >= CRITERIOS.fraccionVentanas, positivas, total });

  // DSR en unidades DIARIAS: Sharpe diario de la curva OOS y varianza de los
  // Sharpe anualizados de los ensayos pasada a diaria (÷ periodosAnio).
  const rets = wf.oos.retornosDiarios.map(x => x.r);
  const mom = momentos(rets);
  const srDiario = mom.desviacion > 0 ? mom.media / mom.desviacion : NaN;
  const dsr = sharpeDeflactado({
    sharpe: srDiario,
    n: rets.length,
    ensayos,
    varianzaSharpes: varianzaMuestral(wf.sharpesEnsayos) / pa,
    asimetria: mom.asimetria,
    curtosis: mom.curtosis,
  });
  criterios.push({ nombre: 'Sharpe deflactado', valor: dsr.dsr, umbral: CRITERIOS.dsrMin, ok: dsr.dsr !== null && dsr.dsr >= CRITERIOS.dsrMin, ensayos });

  criterios.push({ nombre: 'Operaciones OOS', valor: m.operaciones, umbral: CRITERIOS.operacionesMin, ok: m.operaciones >= CRITERIOS.operacionesMin });

  // Sin referencia de las mesas activas, la referencia es comprar y mantener
  // el mismo universo en el mismo tramo OOS.
  let ref = maxDDReferencia;
  let fuenteRef = 'mesas activas';
  if (!(typeof ref === 'number' && ref > 0)) {
    const bh = compraYMantener({ velas, capital, costes: cst, desde: wf.ventanas[0].desde, hasta: wf.ventanas[total - 1].hasta, periodosAnio: pa, marcoMs: comun.MARCOS[h.marco] });
    ref = bh.metricas.maxDD;
    fuenteRef = 'comprar y mantener';
  }
  const umbralDD = CRITERIOS.factorMaxDD * ref;
  criterios.push({ nombre: 'maxDD OOS', valor: m.maxDD, umbral: umbralDD, ok: m.maxDD <= umbralDD, referencia: ref, fuenteReferencia: fuenteRef });

  let correlacionMax = null;
  let mesaMax = null;
  for (const [mesaId, serie] of Object.entries(retornosMesasActivas || {})) {
    if (!Array.isArray(serie)) continue;
    const cr = correlacion(wf.oos.retornosDiarios, serie, 20);
    if (cr.valor !== null && (correlacionMax === null || cr.valor > correlacionMax)) { correlacionMax = cr.valor; mesaMax = mesaId; }
  }
  criterios.push({ nombre: 'Correlación con mesas activas', valor: correlacionMax, umbral: CRITERIOS.correlacionMax, ok: correlacionMax === null || correlacionMax < CRITERIOS.correlacionMax, mesa: mesaMax });

  const aprobada = criterios.every(c => c.ok);
  const f2 = x => (x === null || x === undefined || !Number.isFinite(x) ? '—' : formato.numero(x, 2));
  const [cSh, cVe, cDs, cOp, cDD, cCo] = criterios;
  const informe = [
    cabecera,
    `Walk-forward de ${total} ventanas ${wf.entrenoMeses}/${wf.pruebaMeses} meses con ${wf.combinaciones} combinaciones (${ensayos} ensayos acumulados).`,
    `Sharpe OOS ${f2(cSh.valor)} (mín. ${f2(CRITERIOS.sharpeMin)}): ${sino(cSh.ok)}.`,
    `Ventanas en positivo ${positivas} de ${total} = ${formato.pct(fraccion, { decimales: 0 })} (mín. 75 %): ${sino(cVe.ok)}.`,
    `DSR ${f2(cDs.valor)} (mín. ${f2(CRITERIOS.dsrMin)}): ${sino(cDs.ok)}.`,
    `${cOp.valor} operaciones OOS (mín. ${CRITERIOS.operacionesMin}): ${sino(cOp.ok)}.`,
    `maxDD ${formato.pct(m.maxDD, { decimales: 1 })} (máx. ${formato.pct(umbralDD, { decimales: 1 })}, 1,5 × ${fuenteRef}): ${sino(cDD.ok)}.`,
    correlacionMax === null
      ? 'Sin mesas activas con 20 días comunes para medir correlación: cumple.'
      : `Correlación máx. ${f2(correlacionMax)} con ${mesaMax} (máx. ${f2(CRITERIOS.correlacionMax)}): ${sino(cCo.ok)}.`,
    aprobada ? 'APROBADA.' : 'RECHAZADA.',
  ].join(' ');

  return {
    aprobada,
    criterios,
    walkforward: wf,
    dsr: dsr.dsr,
    sharpeUmbral: dsr.sharpeUmbral,
    correlacionMax,
    ensayos,
    paramsFinales: wf.ventanas.length ? wf.ventanas[wf.ventanas.length - 1].params : null,
    informe,
  };
}

function idSeguro(x) { return String(x).replace(/[^A-Za-z0-9_-]+/g, '-'); }

function base(mesa, semana, sufijo, origen, motivo) {
  return {
    id: `h-${idSeguro(semana)}-${idSeguro(mesa.id)}-${sufijo}`,
    familia: mesa.familia,
    marco: mesa.marco,
    universo: [...mesa.universo],
    filtros: (mesa.filtros || []).map(f => ({ id: f.id, parametro: f.parametro === undefined ? null : f.parametro })),
    origen,
    motivo,
    mesaId: mesa.id,
  };
}

// Número estable a partir de la semana (misma semana → misma exploración).
function indiceSemana(semana, n) {
  const s = String(semana);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return n ? h % n : 0;
}

function generarHipotesis({ mesas = [], pistas = [], semana = '' } = {}) {
  const salida = [];
  const vistas = new Set();
  const porId = new Map(mesas.map(m => [m.id, m]));
  const ordenadas = [...(pistas || [])].sort((a, b) => (b.n - a.n) || String(a.mesaId).localeCompare(String(b.mesaId)) || String(a.categoria).localeCompare(String(b.categoria)));

  for (const pista of ordenadas) {
    if (salida.length >= MAX_HIPOTESIS) break;
    const mesa = porId.get(pista.mesaId);
    const est = mesa && FAMILIAS[mesa.familia];
    if (!est) continue;
    const clave = `${mesa.id}|${pista.categoria}`;
    if (vistas.has(clave)) continue;
    const params = { ...est.parametrosPorDefecto, ...(mesa.params || {}) };
    let h = null;
    if (pista.categoria === 'contra_regimen') {
      if ((mesa.filtros || []).some(f => f.id === 'regimen-no-riskoff')) continue;
      h = base(mesa, semana, 'contra_regimen', 'leccion', `${pista.n} pérdidas de ${mesa.id} abiertas en RISK-OFF: probar sin abrir en RISK-OFF`);
      h.filtros.push({ id: 'regimen-no-riskoff', parametro: null });
    } else if (pista.categoria === 'stop_estrecho') {
      const nuevo = params.atrStop + 0.5;
      if (!enDominio(est.dominio.atrStop, nuevo)) continue;
      h = base(mesa, semana, 'stop_estrecho', 'leccion', `${pista.n} stops de ${mesa.id} saltados en ≤ 2 velas: probar stop a ${formato.numero(nuevo, 1)}×ATR`);
      h.params = { atrStop: nuevo };
    } else if (pista.categoria === 'señal_falsa') {
      const vecino = est.vecinoMasLento(params);
      if (!vecino) continue;
      h = base(mesa, semana, 'senal_falsa', 'leccion', `${pista.n} señales falsas en ${mesa.id}: probar el vecino más lento de la rejilla`);
      h.params = vecino;
    } else {
      continue; // noticia, ejecucion y el resto no generan hipótesis
    }
    vistas.add(clave);
    salida.push(h);
  }

  // Exploración: como mucho una por semana y solo si queda hueco. Añade a una
  // mesa un filtro del catálogo que aún no tiene, elegido por la semana.
  if (salida.length < MAX_HIPOTESIS) {
    const candidatos = [];
    for (const mesa of [...mesas].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      if (!FAMILIAS[mesa.familia] || mesa.estado === 'banquillo') continue;
      for (const f of EXPLORACION) {
        if ((mesa.filtros || []).some(x => x.id === f.id)) continue;
        candidatos.push({ mesa, f });
      }
    }
    if (candidatos.length) {
      const { mesa, f } = candidatos[indiceSemana(semana, candidatos.length)];
      const h = base(mesa, semana, `explora-${f.id}`, 'exploracion', `Exploración semanal: ${mesa.id} con filtro ${f.id}${f.parametro === null ? '' : ` ${f.parametro}`}`);
      h.filtros.push({ ...f });
      salida.push(h);
    }
  }
  return salida.slice(0, MAX_HIPOTESIS);
}

module.exports = { validarHipotesis, evaluarHipotesis, generarHipotesis, describirHipotesis, CRITERIOS, MAX_HIPOTESIS, EXPLORACION };
