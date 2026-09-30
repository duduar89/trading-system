'use strict';
// GET /api/estrategias: una ficha por mesa para la vista «Estrategias».
//
// Todo sale de datos ya calculados por la mesa: la instantánea (§7: estado,
// peso, capital, explicación llana, métricas de papel y backtest de
// referencia), historial.jsonl (su evolución hora a hora) y decisiones.jsonl
// (sus hitos: contratación, ascenso, despido, descarte, cambios de peso).
// Las dos frases que se añaden aquí las escribe el código con esas cifras:
//
// - `lectura`: papel frente al histórico, con el Sharpe (la misma medida que
//   usa el asignador). Con menos operaciones de las que pide el asignador
//   para juzgar una mesa en prueba, lo dice en vez de sacar conclusiones.
// - `regla`: dónde está la mesa frente a la regla del asignador (§5.7, sus
//   REGLAS, no copias): cuánto le falta para ascender o qué la mandaría al
//   banquillo. Es una lectura de hoy; decide la revisión mensual.

const f = require('../util/formato');
const { REGLAS } = require('../aprendizaje/asignador');
const lectores = require('./lectores');
const registros = require('../registros');

const PUNTOS_EVOLUCION = 120;
const RANGO_ESTADO = { titular: 0, incubacion: 1, banquillo: 2 };
const MAX_HITOS = 12;
const es = x => typeof x === 'number' && Number.isFinite(x);
const n2 = x => (es(x) ? f.numero(x, 2) : 'sin dato');
const p1 = x => (es(x) ? f.pct(x, { decimales: 1 }) : 'sin dato');

// Papel frente al histórico (backtest de referencia).
function lectura(m) {
  const papel = m.metricas || {};
  const bt = m.backtest || null;
  const sP = es(papel.sharpe) ? papel.sharpe : null;
  const sB = bt && es(bt.sharpe) ? bt.sharpe : (es(m.sharpeBacktest) ? m.sharpeBacktest : null);
  const ops = es(papel.operaciones) ? papel.operaciones : 0;
  const min = REGLAS.ascensoMinOperaciones;
  const base = { sharpePapel: sP, sharpeBacktest: sB, operaciones: ops, minimo: min };
  if (sB === null) {
    return { ...base, tipo: 'sin_backtest', texto: 'Aún no hay backtest de referencia con el que comparar: se calcula al arrancar la mesa.' };
  }
  if (ops < min || sP === null) {
    return {
      ...base, tipo: 'pocas',
      texto: `Con ${f.numero(ops)} ${ops === 1 ? 'operación cerrada' : 'operaciones cerradas'} en papel aún no se puede comparar con el histórico (el asignador no juzga una mesa con menos de ${min}). Sharpe del histórico: ${n2(sB)}${sP !== null ? `; en papel, de momento, ${n2(sP)}` : ''}.`,
    };
  }
  if (sP >= sB) return { ...base, tipo: 'mejor', texto: `En papel va mejor que en el histórico: Sharpe ${n2(sP)} frente a ${n2(sB)}, con ${f.numero(ops)} operaciones.` };
  return { ...base, tipo: 'peor', texto: `En papel va peor que en el histórico: Sharpe ${n2(sP)} frente a ${n2(sB)}, con ${f.numero(ops)} operaciones.` };
}

// Dónde está frente a la regla del asignador (§5.7).
function regla(m) {
  const met = m.metricas || {};
  const dias = es(m.diasActiva) ? m.diasActiva : 0;
  const ops = es(met.operaciones) ? met.operaciones : 0;
  const R = REGLAS;
  if (m.estado === 'incubacion') {
    const sB = es(m.sharpeBacktest) ? m.sharpeBacktest : (m.backtest && es(m.backtest.sharpe) ? m.backtest.sharpe : null);
    const necesario = sB === null ? null : Math.max(0, sB - R.ascensoMargenSharpe);
    const cumpleSharpe = necesario !== null && es(met.sharpe) && met.sharpe > necesario;
    const cumpleOps = ops >= R.ascensoMinOperaciones;
    const cumpleDias = dias >= R.incubacionDias;
    const partes = [
      cumpleDias ? `En prueba desde hace ${f.numero(dias)} días: la próxima revisión mensual ya la puede juzgar.`
        : `En prueba desde hace ${f.numero(dias)} días: no se juzga hasta los ${f.numero(R.incubacionDias)}.`,
      necesario === null
        ? `Para ascender a titular necesita un Sharpe de papel por encima del de su backtest menos ${f.numero(R.ascensoMargenSharpe)} (el backtest aún no está) y al menos ${f.numero(R.ascensoMinOperaciones)} operaciones (lleva ${f.numero(ops)}).`
        : `Para ascender a titular necesita un Sharpe de papel por encima de ${n2(necesario)} (hoy ${n2(met.sharpe)}) y al menos ${f.numero(R.ascensoMinOperaciones)} operaciones (lleva ${f.numero(ops)}). Ese umbral es el Sharpe del histórico (${n2(sB)}) menos ${f.numero(R.ascensoMargenSharpe)}, y nunca menos de 0.`,
      `Desde el día ${f.numero(R.incubacionDias)}, en cada revisión mensual: si tiene las operaciones pero no el Sharpe, se descarta; si aún no tiene las operaciones, sigue en prueba hasta los ${f.numero(R.incubacionMaxDias)} días.`,
    ];
    return {
      tipo: 'incubacion', diasActiva: dias, diasMin: R.incubacionDias, diasMax: R.incubacionMaxDias,
      operaciones: ops, operacionesMin: R.ascensoMinOperaciones, sharpePapel: es(met.sharpe) ? met.sharpe : null,
      sharpeNecesario: necesario, cumpleSharpe, cumpleOperaciones: cumpleOps, cumpleDias, texto: partes.join(' '),
    };
  }
  if (m.estado === 'titular') {
    const sa = es(met.sharpeAjustado) ? met.sharpeAjustado : null;
    const dd = es(met.maxDD) ? met.maxDD : null;
    return {
      tipo: 'titular', operaciones: ops, sharpeAjustado: sa, despidoSharpe: R.despidoSharpe, despidoMinOperaciones: R.despidoMinOperaciones,
      maxDD: dd, despidoMaxDD: R.despidoMaxDD,
      texto: `Titular. Pasa al banquillo si su caída máxima supera el ${p1(R.despidoMaxDD)} (hoy ${p1(dd)}) o si, con ${f.numero(R.despidoMinOperaciones)} operaciones o más, su Sharpe ajustado baja de ${n2(R.despidoSharpe)} (hoy ${n2(sa)} con ${f.numero(ops)}).`,
    };
  }
  return { tipo: 'banquillo', texto: 'En el banquillo: sin capital y sin abrir posiciones nuevas.' };
}

// Evolución de cada mesa desde historial.jsonl: P&L acumulado, peso y estado
// hora a hora, reducido a unos pocos puntos (la forma, con picos y valles).
function evoluciones(carpeta, { lineas = lectores.MAX_LINEAS, puntos = PUNTOS_EVOLUCION } = {}) {
  const filas = lectores.leerCola(registros.rutas(carpeta).historial, { lineas });
  const porMesa = new Map();
  for (const l of filas) {
    if (!Number.isFinite(l.t) || !Array.isArray(l.mesas)) continue;
    for (const m of l.mesas) {
      if (!m || !m.id) continue;
      if (!porMesa.has(m.id)) porMesa.set(m.id, []);
      porMesa.get(m.id).push({ t: l.t, pnl: es(m.pnlAcumulado) ? m.pnlAcumulado : null, peso: es(m.peso) ? m.peso : null, estado: m.estado || null });
    }
  }
  const out = new Map();
  for (const [id, serie] of porMesa) {
    serie.sort((a, b) => a.t - b.t);
    // Los cambios de estado o de peso siempre se quedan (son hitos visibles).
    const clave = new Set();
    for (let i = 1; i < serie.length; i++) {
      if (serie[i].estado !== serie[i - 1].estado || serie[i].peso !== serie[i - 1].peso) { clave.add(i - 1); clave.add(i); }
    }
    const idx = new Set(lectores.indicesConExtremos(serie, puntos, p => p.t, p => p.pnl));
    for (const i of clave) idx.add(i);
    out.set(id, [...idx].sort((a, b) => a - b).map(i => serie[i]));
  }
  return out;
}

// Hitos de cada mesa en decisiones.jsonl.
function hitos(carpeta) {
  const lista = lectores.decisionesDe(carpeta, ['asignacion', 'ascenso', 'despido', 'descarte']);
  const out = new Map();
  const poner = (id, h) => {
    if (!id) return;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(h);
  };
  for (const d of lista) {
    const x = d.datos || {};
    if (d.tipo === 'asignacion') {
      if (x.migracion) { poner(x.mesaId, { t: d.t, tipo: 'alta', texto: d.resumen }); continue; }
      for (const c of x.contratadas || []) poner(c.mesaId, { t: d.t, tipo: 'alta', texto: `Contratada desde el laboratorio (hipótesis ${c.hipotesisId}) con el ${p1(c.peso)} del capital.` });
      for (const c of x.cambios || []) {
        if (!es(c.de) || !es(c.a)) continue;
        poner(c.mesaId, { t: d.t, tipo: 'peso', texto: `Peso del ${p1(c.de)} al ${p1(c.a)}.${c.motivo ? ` ${c.motivo}` : ''}` });
      }
      continue;
    }
    poner(x.mesaId, { t: d.t, tipo: d.tipo, texto: d.resumen });
  }
  for (const [id, l] of out) out.set(id, l.sort((a, b) => a.t - b.t).slice(-MAX_HITOS));
  return out;
}

function estrategias({ instantanea, carpeta } = {}) {
  const inst = instantanea || {};
  const mesas = Array.isArray(inst.mesas) ? inst.mesas : [];
  const evol = carpeta ? evoluciones(carpeta) : new Map();
  const hit = carpeta ? hitos(carpeta) : new Map();
  const cuenta = e => mesas.filter(m => m.estado === e).length;
  const sa = inst.cabecera && inst.cabecera.sinAsignar ? inst.cabecera.sinAsignar : null;
  return {
    t: es(inst.ahora) ? inst.ahora : null,
    modo: inst.modo || null,
    resumen: { total: mesas.length, titulares: cuenta('titular'), incubacion: cuenta('incubacion'), banquillo: cuenta('banquillo'), sinAsignar: sa },
    // Primero las titulares, luego las que están en prueba y al final el
    // banquillo; dentro de cada grupo, la de más peso delante.
    mesas: mesas.slice().sort((a, b) => (RANGO_ESTADO[a.estado] ?? 9) - (RANGO_ESTADO[b.estado] ?? 9) || (b.peso || 0) - (a.peso || 0)).map(m => ({
      id: m.id, nombre: m.nombre || m.id, familia: m.familia || null, marco: m.marco || null, estado: m.estado || null,
      peso: es(m.peso) ? m.peso : null, capital: es(m.capital) ? m.capital : null, multiplicador: es(m.multiplicador) ? m.multiplicador : null,
      universo: Array.isArray(m.universo) ? m.universo : [], params: m.params || null, filtros: Array.isArray(m.filtros) ? m.filtros : [],
      diasActiva: es(m.diasActiva) ? m.diasActiva : null, nota: m.nota || null, explicacion: m.explicacion || null,
      papel: m.metricas ? { ...m.metricas, pnlDia: es(m.pnlDia) ? m.pnlDia : null } : null,
      backtest: m.backtest || null,
      sharpeBacktest: es(m.sharpeBacktest) ? m.sharpeBacktest : null,
      lectura: lectura(m),
      regla: regla(m),
      evolucion: evol.get(m.id) || [],
      hitos: hit.get(m.id) || [],
    })),
  };
}

module.exports = { estrategias, lectura, regla, evoluciones, hitos, PUNTOS_EVOLUCION };
