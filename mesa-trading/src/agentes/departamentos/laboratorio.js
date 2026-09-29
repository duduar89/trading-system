'use strict';
// Laboratorio (§4.8, §6.9) y Auditor post-mortem (§6.6).
//
// - Semanal: generarHipotesis (≤ 3, gramática cerrada) y evaluarHipotesis con
//   velas del histórico. Corre en segundo plano y en trozos: el walk-forward
//   cede el bucle con setImmediate entre backtests y aquí se cede también
//   entre hipótesis, así los latidos (stops, precios) no esperan.
// - El contador de ensayos se persiste con los Sharpe de cada ensayo (el DSR
//   penaliza por todo lo probado, no solo por lo de esta semana).
// - Pesos y referencias (pendientes de A): cada hipótesis se evalúa como una
//   mesa con el 25 % del fondo (pesoMesa 0,25), y maxDDReferencia es la caída
//   máxima del backtest de la mesa vigente de la misma familia en el mismo
//   tramo fuera de muestra; sin mesa de esa familia, el laboratorio usa
//   comprar y mantener.
// - Lo aprobado queda en `aprobadas` hasta la contratación mensual (Dirección).
// - Auditor: post-mortem en lote una vez al día; las lecciones se guardan con
//   mesaId y alimentan las pistas de la semana (hipotesisDesdeLecciones).

const { FAMILIAS } = require('../../estrategias');
const comunEst = require('../../estrategias/comun');
const { evaluarHipotesis, generarHipotesis, describirHipotesis } = require('../../cuant/laboratorio');
const { calcularVentanas } = require('../../backtest/walkforward');
const { backtest, costesPorDefecto } = require('../../backtest/motor');
const { regimenEnFecha } = require('../../mercado/regimen');
const { valorEn } = require('../../mercado/sentimiento');
const postmortem = require('../postmortem');
const plantillas = require('../plantillas');
const f = require('../../util/formato');
const { diaUTC, DIA } = require('../../util/reloj');
const { momentos } = require('../../backtest/metricas');
const { paramsDe } = require('./mesas');
const { etiqueta } = require('./comun');
const log = require('../../util/log').crear('laboratorio');

const PESO_HIPOTESIS = 0.25;
const MAX_SHARPES_GUARDADOS = 5000;
const DIAS_LECCIONES = 90;
const DIAS_PISTAS = 30;

const ceder = () => new Promise(r => setImmediate(r));

// Días de historia que se piden: en sintético hay 900 días generados en
// memoria; con Alpaca, 4H cuesta una página por semana (informe de B), así
// que se limita a lo que necesita un walk-forward de 12/3 meses.
function diasHistoria(ctx, marco) {
  if (ctx.modo === 'sintetico') return 1200;
  return marco === '1Day' ? 1800 : 800;
}

function crearCargador(ctx, ahora) {
  const cache = new Map();
  return async (simbolo, marco) => {
    const k = `${simbolo}|${marco}`;
    if (!cache.has(k)) cache.set(k, await ctx.datos.velas(simbolo, marco, { desde: ahora - diasHistoria(ctx, marco) * DIA, hasta: ahora }));
    return cache.get(k);
  };
}

async function crearContextoHistorico(ctx, cargar) {
  const btc = await cargar('BTC/USD', '1Day');
  const spy = ctx.universo.some(a => a.simbolo === 'SPY') ? await cargar('SPY', '1Day') : null;
  let fgHist = [];
  try { fgHist = (await ctx.fg.historico()) || []; } catch (e) { log.aviso(`sin histórico de miedo y codicia: ${e.message}`); }
  return t => {
    const f = fgHist.length ? valorEn(fgHist, t) : null;
    return { regimen: regimenEnFecha(btc, spy, t), fg: f ? f.valor : null };
  };
}

// Tramo fuera de muestra que usará el walk-forward, calculado con la misma
// regla (18/6 meses y, si no hay 4 ventanas, 12/3) para medir la referencia
// de caída en el mismo tramo.
function tramoOOS(est, velas, fijos = {}) {
  const simbolos = Object.keys(velas).filter(s => velas[s] && velas[s].length);
  if (!simbolos.length) return null;
  const rejilla = est.rejillaPara ? est.rejillaPara(simbolos) : est.rejilla;
  const base = est.parametrosPara ? est.parametrosPara(simbolos) : est.parametrosPorDefecto;
  const combos = comunEst.combinaciones(rejilla, base, fijos);
  const calent = Math.max(...combos.map(c => est.calentamiento(c)));
  const marcoMs = comunEst.MARCOS[est.marco];
  let tCalentado = Infinity;
  let tFin = -Infinity;
  for (const s of simbolos) {
    const serie = velas[s];
    if (serie.length > calent) tCalentado = Math.min(tCalentado, serie[calent].t);
    tFin = Math.max(tFin, serie[serie.length - 1].t + marcoMs);
  }
  if (!Number.isFinite(tCalentado)) return null;
  let v = calcularVentanas({ tCalentado, tFin, entrenoMeses: 18, pruebaMeses: 6 });
  if (v.length < 4) v = calcularVentanas({ tCalentado, tFin, entrenoMeses: 12, pruebaMeses: 3 });
  if (v.length < 4) return null;
  return { desde: v[0].pruebaDesde, hasta: v[v.length - 1].pruebaHasta };
}

async function velasDeMesa(mesa, cargar) {
  const velas = {};
  for (const s of mesa.universo) {
    const v = await cargar(s, mesa.marco);
    if (v && v.length) velas[s] = v;
  }
  return velas;
}

async function maxDDReferencia(ctx, h, { cargar, contexto }) {
  const vivas = ctx.estado.mesas.filter(m => m.familia === h.familia && m.estado !== 'banquillo');
  const mesa = vivas.find(m => m.id === h.mesaId) || vivas[0];
  if (!mesa) return { valor: undefined, mesaId: null };
  const est = FAMILIAS[h.familia];
  const velasH = {};
  for (const s of h.universo) velasH[s] = await cargar(s, h.marco);
  const tramo = tramoOOS(est, velasH, h.params || {});
  if (!tramo) return { valor: undefined, mesaId: mesa.id };
  const velas = await velasDeMesa(mesa, cargar);
  const r = backtest({
    velas, estrategia: est, params: paramsDe(mesa), filtros: mesa.filtros || [], costes: costesPorDefecto(), contexto,
    limites: ctx.limites, desde: tramo.desde, hasta: tramo.hasta, pesoMesa: PESO_HIPOTESIS,
  });
  const dd = r.metricas.maxDD;
  return { valor: dd > 0 ? dd : undefined, mesaId: mesa.id };
}

function retornosMesasActivas(ctx) {
  const out = {};
  for (const m of ctx.estado.mesas) {
    if (m.estado === 'banquillo') continue;
    const c = m.curvaDiaria || [];
    const rs = [];
    for (let i = 1; i < c.length; i++) if (c[i - 1].valor > 0) rs.push({ dia: c[i].dia, r: (c[i].valor - (c[i].flujo || 0)) / c[i - 1].valor - 1 });
    if (rs.length) out[m.id] = rs;
  }
  return out;
}

function siguienteLunes(t) {
  const d = new Date(Math.floor(t / DIA) * DIA);
  const dow = d.getUTCDay();
  const dias = ((8 - dow) % 7) || 7;
  return Math.floor(t / DIA) * DIA + dias * DIA + 10 * 60_000;
}

// Semanal: nuevas hipótesis y su evaluación en segundo plano.
function revisionSemanal(ctx) {
  const ahora = ctx.reloj.ahora();
  const lab = ctx.estado.laboratorio;
  const semana = diaUTC(ahora);
  const lecciones = ctx.estado.lecciones.filter(l => l.t >= ahora - DIAS_PISTAS * DIA);
  const pistas = postmortem.hipotesisDesdeLecciones(lecciones);
  const nuevas = generarHipotesis({ mesas: ctx.estado.mesas, pistas, semana })
    .filter(h => !lab.hipotesis.some(x => x.id === h.id));
  lab.proximaRevision = siguienteLunes(ahora);
  for (const h of nuevas) {
    lab.hipotesis.push({ id: h.id, h, descripcion: describirHipotesis(h), estado: 'pendiente', criterios: [], t: ahora, informe: null });
    ctx.bus.publicar({ de: 'laboratorio', canal: 'laboratorio', tipo: 'hipotesis', texto: plantillas.hipotesis(h), datos: { id: h.id, origen: h.origen, motivo: h.motivo, mesaId: h.mesaId }, importancia: 2 });
  }
  if (lab.hipotesis.length > 60) lab.hipotesis.splice(0, lab.hipotesis.length - 60);
  if (!nuevas.length) {
    ctx.bus.publicar({ de: 'laboratorio', canal: 'laboratorio', tipo: 'nota', texto: `Semana ${semana}: sin hipótesis nuevas (${pistas.length} pistas del Auditor).` });
  }
  ctx.lanzar('laboratorio', () => evaluarPendientes(ctx));
  return nuevas;
}

async function evaluarPendientes(ctx) {
  const lab = ctx.estado.laboratorio;
  if (ctx._labEnCurso) return 0;
  ctx._labEnCurso = true;
  let n = 0;
  try {
    for (;;) {
      const entrada = lab.hipotesis.find(x => x.estado === 'pendiente');
      if (!entrada) break;
      entrada.estado = 'evaluando';
      const h = entrada.h;
      const ahora = ctx.reloj.ahora();
      const cargar = crearCargador(ctx, ahora);
      const contexto = await crearContextoHistorico(ctx, cargar);
      const ref = await maxDDReferencia(ctx, h, { cargar, contexto });
      await ceder();
      const ensayosPrevios = lab.ensayosTotales;
      const res = await evaluarHipotesis(h, {
        cargarVelas: cargar, contextoHistorico: contexto, ensayosPrevios, retornosMesasActivas: retornosMesasActivas(ctx),
        maxDDReferencia: ref.valor, costes: costesPorDefecto(), limites: ctx.limites, universo: ctx.universo, pesoMesa: PESO_HIPOTESIS,
      });
      const wf = res.walkforward;
      if (wf) {
        lab.ensayosTotales = ensayosPrevios + (wf.combinaciones || 0);
        lab.sharpesEnsayos.push(...(wf.sharpesEnsayos || []));
        if (lab.sharpesEnsayos.length > MAX_SHARPES_GUARDADOS) lab.sharpesEnsayos.splice(0, lab.sharpesEnsayos.length - MAX_SHARPES_GUARDADOS);
        lab.ensayos.push({ hipotesisId: h.id, t: ctx.reloj.ahora(), combinaciones: wf.combinaciones || 0, sharpesEnsayos: wf.sharpesEnsayos || [] });
        if (lab.ensayos.length > 200) lab.ensayos.splice(0, lab.ensayos.length - 200);
      }
      entrada.estado = res.aprobada ? 'aprobada' : 'rechazada';
      entrada.criterios = (res.criterios || []).map(c => ({ nombre: c.nombre, valor: c.valor, umbral: c.umbral, ok: c.ok }));
      entrada.informe = res.informe;
      entrada.referenciaDD = { valor: ref.valor ?? null, mesaId: ref.mesaId };
      entrada.tFin = ctx.reloj.ahora();
      if (res.aprobada) lab.aprobadas.push({ ...h, params: { ...(h.params || {}), ...(res.paramsFinales || {}) }, informe: res.informe, t: ctx.reloj.ahora() });
      ctx.bus.publicar({
        de: 'laboratorio', canal: 'laboratorio', tipo: 'hipotesis',
        texto: plantillas.resultadoHipotesis({ id: h.id, aprobada: res.aprobada, criterios: res.criterios }),
        datos: { id: h.id, aprobada: res.aprobada, criterios: entrada.criterios, informe: res.informe, ensayos: lab.ensayosTotales, dsr: res.dsr ?? null },
        importancia: res.aprobada ? 3 : 2,
      });
      n++;
      await ceder();
    }
  } finally {
    ctx._labEnCurso = false;
  }
  return n;
}

// Backtest de referencia de cada mesa (Sharpe, μ y σ diarios, volatilidad
// anual y caída): lo usan el asignador (ascensos y paridad de riesgo) y la
// alarma de deriva. Se hace una vez por mesa, en segundo plano.
async function backtestMesa(ctx, mesa) {
  const est = FAMILIAS[mesa.familia];
  if (!est) return null;
  const ahora = ctx.reloj.ahora();
  const dias = ctx.modo === 'sintetico' ? 365 : (mesa.marco === '1Day' ? 365 : 180);
  const n = 400;   // calentamiento de sobra para cualquier familia
  const marcoMs = comunEst.MARCOS[mesa.marco];
  const velas = {};
  for (const s of mesa.universo) {
    if (!ctx.datos.disponible(s)) continue;
    const v = await ctx.datos.velas(s, mesa.marco, { desde: ahora - dias * DIA - n * marcoMs, hasta: ahora });
    if (v.length) velas[s] = v;
  }
  if (!Object.keys(velas).length) return null;
  await ceder();
  const cargar = async (s, marco) => ctx.datos.velas(s, marco, { desde: ahora - (dias + 400) * DIA, hasta: ahora });
  const contexto = await crearContextoHistorico(ctx, cargar);
  const r = backtest({
    velas, estrategia: est, params: paramsDe(mesa), filtros: mesa.filtros || [], costes: costesPorDefecto(), contexto,
    limites: ctx.limites, desde: ahora - dias * DIA, pesoMesa: mesa.peso > 0 ? mesa.peso : PESO_HIPOTESIS,
  });
  const rs = r.retornosDiarios.map(x => x.r);
  const m = momentos(rs);
  const pa = comunEst.periodosAnio(mesa.universo, '1Day');
  return {
    sharpe: r.metricas.sharpe, mu: m.media, sigma: m.desviacion, vol: m.desviacion > 0 ? m.desviacion * Math.sqrt(pa) : null,
    maxDD: r.metricas.maxDD, operaciones: r.metricas.operaciones, rentabilidad: r.metricas.rentabilidad, dias, t: ahora,
  };
}

async function backtestsPendientes(ctx) {
  let n = 0;
  for (const mesa of ctx.estado.mesas) {
    if (mesa.backtest) continue;
    try {
      mesa.backtest = await backtestMesa(ctx, mesa);
      if (mesa.backtest) {
        n++;
        ctx.bus.publicar({
          de: 'laboratorio', canal: 'laboratorio', tipo: 'nota',
          texto: plantillas.frase(`Backtest de referencia de ${mesa.nombre} (${mesa.backtest.dias} días): ${mesa.backtest.operaciones} operaciones, Sharpe ${f.numero(mesa.backtest.sharpe, 2)}, caída máx. ${f.pct(mesa.backtest.maxDD, { decimales: 1 })}.`),
          datos: { mesaId: mesa.id, ...mesa.backtest },
        });
      }
    } catch (e) {
      log.aviso(`backtest de ${mesa.id}: ${e.message}`);
    }
    await ceder();
  }
  return n;
}

// ---------- Auditor ----------

async function auditoria(ctx, operaciones) {
  const ops = (operaciones || []).filter(o => o && !o.sombra && o.motivoSalida !== 'prueba');
  if (!ops.length) return [];
  const ahora = ctx.reloj.ahora();
  const res = await postmortem.lote({ operaciones: ops, llm: ctx.llm });
  const porId = new Map(ops.map(o => [String(o.id), o]));
  for (const l of res) {
    const op = porId.get(l.operacionId) || {};
    ctx.estado.lecciones.push({ t: ahora, ...l, mesaId: l.mesaId ?? op.mesaId ?? null });
    ctx.bus.publicar({
      de: 'auditor', canal: 'laboratorio', tipo: 'leccion',
      texto: plantillas.leccion({ mesaId: l.mesaId, etiqueta: etiqueta(l.simbolo), categoria: l.categoria, pnl: op.pnl, barras: op.barras, leccion: l.leccion }),
      datos: { operacionId: l.operacionId, mesaId: l.mesaId, simbolo: l.simbolo, categoria: l.categoria, fuente: l.fuente },
    });
  }
  const limite = ahora - DIAS_LECCIONES * DIA;
  ctx.estado.lecciones = ctx.estado.lecciones.filter(l => l.t >= limite);
  return res;
}

module.exports = {
  revisionSemanal, evaluarPendientes, backtestsPendientes, backtestMesa, auditoria, tramoOOS, maxDDReferencia, siguienteLunes,
  PESO_HIPOTESIS,
};
