'use strict';
// Laboratorio (§4.8, §6.9) y Auditor post-mortem (§6.6).
//
// - Semanal: generarHipotesis (≤ 3, gramática cerrada) y evaluarHipotesis con
//   velas del histórico. Corre en segundo plano y en trozos: el walk-forward
//   cede el bucle con setImmediate entre backtests y aquí se cede también
//   entre hipótesis, así los latidos (stops, precios) no esperan.
// - El contador de ensayos se persiste con los Sharpe de cada ensayo: el DSR
//   penaliza por todo lo probado (N acumulado y la varianza de TODOS los
//   Sharpe guardados, sharpesPrevios), no solo por lo de esta semana.
// - Sin repetir: no se propone una hipótesis cuyo contenido (firmaHipotesis:
//   familia, marco, universo, params, filtros) ya se evaluó en los últimos 90
//   días, está pendiente o aprobada, o es el de una mesa viva, aunque cambie
//   la semana (el id lleva la semana dentro).
// - Pesos y referencias: cada hipótesis se evalúa como una mesa con el 25 %
//   del fondo (pesoMesa 0,25), y maxDDReferencia es la caída máxima del
//   backtest de la mesa vigente de la misma familia en el MISMO tramo fuera de
//   muestra que usa el walk-forward (evaluarHipotesis pasa el tramo); sin mesa
//   de esa familia, el laboratorio usa comprar y mantener.
// - Lo aprobado queda en `aprobadas` (con su firma) hasta la contratación
//   mensual (Dirección).
// - Auditor: post-mortem en lote una vez al día; las lecciones se guardan con
//   mesaId y motivo de salida y alimentan las pistas de la semana
//   (hipotesisDesdeLecciones, que no saca pistas de lo cerrado por un kill, a
//   mano o en la prueba).

const { FAMILIAS } = require('../../estrategias');
const comunEst = require('../../estrategias/comun');
const { evaluarHipotesis, generarHipotesis, describirHipotesis, firmaHipotesis } = require('../../cuant/laboratorio');
const { backtest, costesPorDefecto } = require('../../backtest/motor');
const { regimenEnFecha } = require('../../mercado/regimen');
const { valorEn, RETRASO_FG } = require('../../mercado/sentimiento');
const postmortem = require('../postmortem');
const plantillas = require('../plantillas');
const conversacion = require('../conversacion');
const f = require('../../util/formato');
const { diaUTC, DIA } = require('../../util/reloj');
const { momentos } = require('../../backtest/metricas');
const { paramsDe, desdeCalentamiento } = require('./mesas');
const { etiqueta } = require('./comun');
const log = require('../../util/log').crear('laboratorio');

const PESO_HIPOTESIS = 0.25;
const DIAS_SIN_REPETIR = 90;
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
  // VIXY cuenta en el régimen en vivo (macro): aquí igual, para que el
  // histórico del laboratorio vea el mismo régimen. Sin claves no hay.
  let vixy = null;
  if (spy && ctx.datos.disponible('VIXY')) {
    try { vixy = await cargar('VIXY', '1Day'); } catch (e) { log.aviso(`sin VIXY para el régimen histórico: ${e.message}`); }
  }
  let fgHist = [];
  try { fgHist = (await ctx.fg.historico()) || []; } catch (e) { log.aviso(`sin histórico de miedo y codicia: ${e.message}`); }
  // Miedo y codicia vigente en t: el de t − RETRASO_FG, como en vivo (el de
  // un día se publica a las 00:00, el mismo instante en que deciden las diarias).
  return t => {
    const f = fgHist.length ? valorEn(fgHist, t - RETRASO_FG) : null;
    return { regimen: regimenEnFecha(btc, spy, t, vixy), fg: f ? f.valor : null };
  };
}

async function velasDeMesa(mesa, cargar) {
  const velas = {};
  for (const s of mesa.universo) {
    const v = await cargar(s, mesa.marco);
    if (v && v.length) velas[s] = v;
  }
  return velas;
}

// Caída máxima de la mesa vigente de la misma familia en el tramo fuera de
// muestra que usa el walk-forward (evaluarHipotesis lo pasa): { valor, mesaId }.
async function maxDDReferencia(ctx, h, tramo, { cargar, contexto }) {
  const vivas = ctx.estado.mesas.filter(m => m.familia === h.familia && m.estado !== 'banquillo');
  const mesa = vivas.find(m => m.id === h.mesaId) || vivas[0];
  if (!mesa) return { valor: undefined, mesaId: null };
  if (!tramo || !Number.isFinite(tramo.desde) || !Number.isFinite(tramo.hasta)) return { valor: undefined, mesaId: mesa.id };
  const est = FAMILIAS[h.familia];
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

// Firmas que ya no se pueden proponer: hipótesis de los últimos 90 días (las
// guarda lab.hipotesis con su t), las aprobadas pendientes de contratar y las
// mesas vivas contratadas de una hipótesis (firmasBloqueadas mira mesas).
function previasDe(lab) {
  return [
    ...lab.hipotesis.map(x => ({ h: x.h, t: x.t, firma: x.firma || null })),
    ...lab.aprobadas.map(a => ({ h: a, t: a.t, firma: a.firma || null })),
  ];
}

// Semanal: nuevas hipótesis y su evaluación en segundo plano.
function revisionSemanal(ctx) {
  const ahora = ctx.reloj.ahora();
  const lab = ctx.estado.laboratorio;
  const semana = diaUTC(ahora);
  // Lecciones guardadas antes de llevar motivoSalida: se completa con el de su
  // operación, para que las de un kill o a mano tampoco den pistas.
  const salidaDe = new Map(ctx.operaciones.map(o => [String(o.id), o.motivoSalida]));
  const lecciones = ctx.estado.lecciones
    .filter(l => l.t >= ahora - DIAS_PISTAS * DIA)
    .map(l => (l.motivoSalida == null && salidaDe.has(String(l.operacionId)) ? { ...l, motivoSalida: salidaDe.get(String(l.operacionId)) } : l));
  const pistas = postmortem.hipotesisDesdeLecciones(lecciones);
  const previas = previasDe(lab);
  const vistas = new Set(previas.filter(p => p.t >= ahora - DIAS_SIN_REPETIR * DIA).map(p => p.firma || firmaHipotesis(p.h)));
  const nuevas = generarHipotesis({ mesas: ctx.estado.mesas, pistas, semana, previas, ahora })
    .filter(h => !lab.hipotesis.some(x => x.id === h.id) && !vistas.has(firmaHipotesis(h)));
  lab.proximaRevision = siguienteLunes(ahora);
  for (const h of nuevas) {
    const entrada = { id: h.id, h, firma: firmaHipotesis(h), descripcion: describirHipotesis(h), estado: 'pendiente', criterios: [], t: ahora, informe: null };
    lab.hipotesis.push(entrada);
    // La idea abre su hilo: el resultado del examen le contesta (§6.2).
    const m = ctx.bus.publicar({ de: 'laboratorio', canal: 'laboratorio', tipo: 'hipotesis', texto: plantillas.hipotesis(h), datos: { id: h.id, origen: h.origen, motivo: h.motivo, mesaId: h.mesaId }, importancia: 2, hilo: true });
    entrada.mensajeId = m.id;
  }
  if (lab.hipotesis.length > 60) lab.hipotesis.splice(0, lab.hipotesis.length - 60);
  if (!nuevas.length) {
    ctx.bus.publicar({ de: 'laboratorio', canal: 'laboratorio', tipo: 'nota', texto: `Esta semana (${semana}) no hay ideas nuevas que probar; el Auditor ha dejado ${pistas.length} ${pistas.length === 1 ? 'pista' : 'pistas'}.` });
  }
  // Modo latido: la evaluación (larga) la hace scripts/laboratorio.js fuera del latido.
  if (!(ctx.opciones && ctx.opciones.laboratorioFuera)) ctx.lanzar('laboratorio', () => evaluarPendientes(ctx));
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
      const ev = await evaluarUna(ctx, entrada, { ensayosPrevios: lab.ensayosTotales, sharpesPrevios: [...lab.sharpesEnsayos] });
      aplicarEvaluacion(ctx, entrada, ev);
      n++;
      await ceder();
    }
  } finally {
    ctx._labEnCurso = false;
  }
  return n;
}

// Evalúa una hipótesis sin tocar el estado. Devuelve lo que hace falta para
// apuntarla (aplicarEvaluacion), en JSON: así el laboratorio fuera de banda
// (scripts/laboratorio.js) lo deja en un fichero y el latido lo incorpora.
async function evaluarUna(ctx, entrada, { ensayosPrevios, sharpesPrevios }) {
  const h = entrada.h;
  const firma = entrada.firma || firmaHipotesis(h);
  const ahora = ctx.reloj.ahora();
  const cargar = crearCargador(ctx, ahora);
  const contexto = await crearContextoHistorico(ctx, cargar);
  await ceder();
  let ref = { valor: undefined, mesaId: null };
  const res = await evaluarHipotesis(h, {
    cargarVelas: cargar, contextoHistorico: contexto, ensayosPrevios, sharpesPrevios,
    retornosMesasActivas: retornosMesasActivas(ctx),
    maxDDReferencia: async tramo => { ref = await maxDDReferencia(ctx, h, tramo, { cargar, contexto }); return ref; },
    costes: costesPorDefecto(), limites: ctx.limites, universo: ctx.universo, pesoMesa: PESO_HIPOTESIS,
  });
  const wf = res.walkforward;
  return {
    id: h.id,
    firma,
    aprobada: Boolean(res.aprobada),
    criterios: res.criterios || [],
    informe: res.informe,
    paramsFinales: res.paramsFinales || null,
    dsr: res.dsr ?? null,
    walkforward: wf ? {
      combinaciones: wf.combinaciones || 0, sharpesEnsayos: wf.sharpesEnsayos || [],
      ventanas: Array.isArray(wf.ventanas) ? wf.ventanas.length : null, entrenoMeses: wf.entrenoMeses ?? null, pruebaMeses: wf.pruebaMeses ?? null,
      suficiente: wf.suficiente !== false,
    } : null,
    ensayosPrevios,
    referenciaDD: { valor: ref.valor ?? null, mesaId: ref.mesaId ?? null },
    tFin: ctx.reloj.ahora(),
  };
}

// Cómo se compara cada puerta con su umbral (src/cuant/laboratorio.js).
const COMPARACION = Object.freeze({
  'Sharpe OOS': '≥', 'Ventanas de prueba en positivo': '≥', 'Sharpe deflactado': '≥', 'Operaciones OOS': '≥',
  'maxDD OOS': '≤', 'Correlación con mesas activas': '<', 'Datos suficientes': '≥',
});

// Registro de decisiones (§6.10): TODAS las puertas con su valor, su umbral y
// si pasó, más el walk-forward y el contador de ensayos. Es lo que dice si el
// laboratorio trabaja bien (cuántas prueba, cuántas aprueba y por qué).
function anotarDecisionLaboratorio(ctx, entrada, ev) {
  if (typeof ctx.anotarDecision !== 'function') return;
  const h = entrada.h;
  const lab = ctx.estado.laboratorio;
  const criterios = (ev.criterios || []).map(c => ({ ...c, comparacion: COMPARACION[c.nombre] || null }));
  const ok = criterios.filter(c => c.ok).length;
  const wf = ev.walkforward;
  ctx.anotarDecision({
    tipo: 'laboratorio', quien: 'laboratorio',
    resumen: `Hipótesis ${h.id} ${ev.aprobada ? 'APROBADA' : 'RECHAZADA'}: pasa ${ok} de ${criterios.length} puertas. ${entrada.descripcion || describirHipotesis(h)}.`,
    datos: {
      hipotesisId: h.id, aprobada: Boolean(ev.aprobada), descripcion: entrada.descripcion || describirHipotesis(h),
      hipotesis: { familia: h.familia, marco: h.marco, universo: h.universo, filtros: h.filtros || [], params: h.params || null, origen: h.origen || null, motivo: h.motivo || null, mesaId: h.mesaId || null },
      criterios, puertasOk: ok, puertasTotal: criterios.length,
      walkforward: wf ? { ventanas: wf.ventanas ?? null, entrenoMeses: wf.entrenoMeses ?? null, pruebaMeses: wf.pruebaMeses ?? null, combinaciones: wf.combinaciones || 0, suficiente: wf.suficiente !== false } : null,
      dsr: ev.dsr ?? null,
      ensayosPrevios: Number.isFinite(ev.ensayosPrevios) ? ev.ensayosPrevios : null,
      ensayosTotales: lab.ensayosTotales || 0,
      paramsFinales: ev.paramsFinales || null,
      referenciaDD: ev.referenciaDD || null,
      informe: ev.informe || null,
    },
  });
}

// Apunta en el estado lo que devolvió evaluarUna y lo cuenta en el chat.
function aplicarEvaluacion(ctx, entrada, ev) {
  const lab = ctx.estado.laboratorio;
  const h = entrada.h;
  const wf = ev.walkforward;
  if (wf) {
    lab.ensayosTotales = (lab.ensayosTotales || 0) + (wf.combinaciones || 0);
    lab.sharpesEnsayos.push(...(wf.sharpesEnsayos || []));
    if (lab.sharpesEnsayos.length > MAX_SHARPES_GUARDADOS) lab.sharpesEnsayos.splice(0, lab.sharpesEnsayos.length - MAX_SHARPES_GUARDADOS);
    lab.ensayos.push({ hipotesisId: h.id, t: ctx.reloj.ahora(), combinaciones: wf.combinaciones || 0, sharpesEnsayos: wf.sharpesEnsayos || [] });
    if (lab.ensayos.length > 200) lab.ensayos.splice(0, lab.ensayos.length - 200);
  }
  entrada.estado = ev.aprobada ? 'aprobada' : 'rechazada';
  entrada.firma = ev.firma;
  entrada.criterios = (ev.criterios || []).map(c => ({ nombre: c.nombre, valor: c.valor, umbral: c.umbral, ok: c.ok }));
  entrada.informe = ev.informe;
  entrada.referenciaDD = { valor: ev.referenciaDD ? ev.referenciaDD.valor ?? null : null, mesaId: ev.referenciaDD ? ev.referenciaDD.mesaId ?? null : null };
  entrada.tFin = ev.tFin ?? ctx.reloj.ahora();
  // La firma es la del contenido que fijó la hipótesis (antes de los
  // parámetros finales del walk-forward): una aprobada no entra dos veces.
  if (ev.aprobada && !lab.aprobadas.some(a => a.firma === ev.firma)) {
    lab.aprobadas.push({ ...h, params: { ...(h.params || {}), ...(ev.paramsFinales || {}) }, firma: ev.firma, informe: ev.informe, t: ctx.reloj.ahora() });
  }
  anotarDecisionLaboratorio(ctx, entrada, ev);
  ctx.bus.publicar({
    de: 'laboratorio', canal: 'laboratorio', tipo: 'hipotesis',
    texto: plantillas.resultadoHipotesis({ id: h.id, aprobada: ev.aprobada, criterios: (ev.criterios || []).map(c => ({ ...c, comparacion: c.comparacion || COMPARACION[c.nombre] || null })) }),
    datos: { id: h.id, aprobada: ev.aprobada, criterios: entrada.criterios, informe: ev.informe, ensayos: lab.ensayosTotales, dsr: ev.dsr ?? null },
    importancia: ev.aprobada ? 3 : 2,
    ...(entrada.mensajeId ? { respondeA: entrada.mensajeId } : {}),
  });
}

// ---------- Fuera de banda (modo latido, docs/ARQUITECTURA-WEB.md W2) ----------
// scripts/laboratorio.js evalúa, con su propio cerrojo y sobre una COPIA del
// estado, las hipótesis pendientes; deja el resultado en un fichero y el
// latido siguiente lo incorpora bajo el cerrojo principal (una sola vez: el
// id del resultado queda en estado.laboratorio.incorporados).

// ctx: { estado (copia), reloj, datos, fg, universo, limites, modo }. No publica nada.
async function evaluarFueraDeBanda(ctx) {
  const lab = ctx.estado.laboratorio;
  const evaluaciones = [];
  let ensayos = lab.ensayosTotales || 0;
  const sharpes = [...(lab.sharpesEnsayos || [])];
  for (const entrada of lab.hipotesis.filter(x => x.estado === 'pendiente' || x.estado === 'evaluando')) {
    const ev = await evaluarUna(ctx, entrada, { ensayosPrevios: ensayos, sharpesPrevios: [...sharpes] });
    if (ev.walkforward) {
      ensayos += ev.walkforward.combinaciones || 0;
      sharpes.push(...(ev.walkforward.sharpesEnsayos || []));
    }
    evaluaciones.push(ev);
    await ceder();
  }
  return evaluaciones;
}

// Incorpora un resultado de evaluarFueraDeBanda ({ id, evaluaciones }).
// Devuelve cuántas hipótesis apuntó; 0 si ya estaba incorporado o si sus
// hipótesis ya no esperan (se apuntaron por otro camino).
function incorporarResultado(ctx, resultado) {
  if (!resultado || !resultado.id || !Array.isArray(resultado.evaluaciones)) return 0;
  const lab = ctx.estado.laboratorio;
  if (!Array.isArray(lab.incorporados)) lab.incorporados = [];
  if (lab.incorporados.includes(resultado.id)) return 0;
  let n = 0;
  for (const ev of resultado.evaluaciones) {
    const entrada = lab.hipotesis.find(x => x.id === ev.id && (x.estado === 'pendiente' || x.estado === 'evaluando'));
    if (!entrada) continue;
    aplicarEvaluacion(ctx, entrada, ev);
    n++;
  }
  lab.incorporados.push(resultado.id);
  if (lab.incorporados.length > 20) lab.incorporados.splice(0, lab.incorporados.length - 20);
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
  // El mismo calentamiento que el vivo (velasNecesarias, con el año del filtro
  // vol-max y el factor de sesiones de las acciones), con 400 velas de suelo:
  // con 400 fijas, en 4H el percentil de vol-max no llegaba a tener valor y la
  // referencia era la de la estrategia sin filtro.
  const inicioTramo = ahora - dias * DIA;
  const desdeVelas = Math.min(desdeCalentamiento(mesa, inicioTramo), inicioTramo - 400 * comunEst.MARCOS[mesa.marco]);
  const velas = {};
  for (const s of mesa.universo) {
    if (!ctx.datos.disponible(s)) continue;
    const v = await ctx.datos.velas(s, mesa.marco, { desde: desdeVelas, hasta: ahora });
    if (v.length) velas[s] = v;
  }
  if (!Object.keys(velas).length) return null;
  await ceder();
  const cargar = async (s, marco) => ctx.datos.velas(s, marco, { desde: ahora - (dias + 400) * DIA, hasta: ahora });
  const contexto = await crearContextoHistorico(ctx, cargar);
  const r = backtest({
    velas, estrategia: est, params: paramsDe(mesa), filtros: mesa.filtros || [], costes: costesPorDefecto(), contexto,
    limites: ctx.limites, desde: inicioTramo, pesoMesa: mesa.peso > 0 ? mesa.peso : PESO_HIPOTESIS,
  });
  const rs = r.retornosDiarios.map(x => x.r);
  const m = momentos(rs);
  const pa = comunEst.periodosAnio(mesa.universo, '1Day');
  return {
    sharpe: r.metricas.sharpe, mu: m.media, sigma: m.desviacion, vol: m.desviacion > 0 ? m.desviacion * Math.sqrt(pa) : null,
    maxDD: r.metricas.maxDD, operaciones: r.metricas.operaciones, rentabilidad: r.metricas.rentabilidad, dias, t: ahora,
    // El universo de la mesa con el que se hizo: si la mesa cambia de
    // universo, este backtest ya no es su referencia (backtestVigente).
    universo: [...mesa.universo],
  };
}

// ¿El backtest de referencia de la mesa es de su universo de ahora? Uno de
// antes de guardar su universo vale hasta que una migración diga lo contrario
// (orquestador._migrarUniverso).
function backtestVigente(mesa) {
  const bt = mesa && mesa.backtest;
  if (!bt) return false;
  if (!Array.isArray(bt.universo)) return true;
  const a = new Set(bt.universo);
  return a.size === new Set(mesa.universo).size && mesa.universo.every(s => a.has(s));
}

async function backtestsPendientes(ctx) {
  let n = 0;
  for (const mesa of ctx.estado.mesas) {
    if (backtestVigente(mesa)) continue;
    try {
      mesa.backtest = await backtestMesa(ctx, mesa);
      if (mesa.backtest) {
        n++;
        ctx.bus.publicar({
          de: 'laboratorio', canal: 'laboratorio', tipo: 'nota',
          texto: plantillas.frase(`He probado ${mesa.nombre} con ${mesa.backtest.dias} días de precios pasados: ${mesa.backtest.operaciones} operaciones, rentabilidad por riesgo (Sharpe) ${f.numero(mesa.backtest.sharpe, 2)} y peor caída ${f.pct(mesa.backtest.maxDD, { decimales: 1 })}.`),
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
    ctx.estado.lecciones.push({ t: ahora, ...l, mesaId: l.mesaId ?? op.mesaId ?? null, motivoSalida: l.motivoSalida ?? op.motivoSalida ?? null });
    // El Auditor le contesta al operador en el hilo de su operación (§6.2).
    const hilo = conversacion.cierreDe(ctx, l.operacionId);
    const operador = hilo && conversacion.agente(ctx, hilo.de) && hilo.de !== 'ejecutor' ? hilo.de : conversacion.operadorDe(ctx, l.mesaId ?? op.mesaId, l.simbolo);
    const mesa = typeof ctx.mesaPorId === 'function' ? ctx.mesaPorId(l.mesaId ?? op.mesaId) : null;
    ctx.bus.publicar({
      de: 'auditor', para: operador || 'todos', canal: 'laboratorio', tipo: 'leccion',
      texto: plantillas.leccion({ mesaId: l.mesaId, mesa: mesa ? mesa.nombre : null, etiqueta: etiqueta(l.simbolo), categoria: l.categoria, pnl: op.pnl, barras: op.barras, leccion: l.leccion, a: operador ? conversacion.pilaDe(ctx, operador) : null }),
      datos: { operacionId: l.operacionId, mesaId: l.mesaId, simbolo: l.simbolo, categoria: l.categoria, fuente: l.fuente },
      ...(hilo ? { respondeA: hilo.id, hilo: hilo.hilo } : {}),
    });
  }
  const limite = ahora - DIAS_LECCIONES * DIA;
  ctx.estado.lecciones = ctx.estado.lecciones.filter(l => l.t >= limite);
  return res;
}

module.exports = {
  revisionSemanal, evaluarPendientes, evaluarUna, aplicarEvaluacion, evaluarFueraDeBanda, incorporarResultado, backtestsPendientes, backtestMesa, backtestVigente, auditoria, maxDDReferencia, siguienteLunes, crearContextoHistorico,
  PESO_HIPOTESIS,
};
