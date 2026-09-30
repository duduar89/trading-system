'use strict';
// GET /api/laboratorio: cada hipótesis que ha probado el laboratorio con
// TODAS sus puertas (valor frente a umbral), el contador de ensayos y qué ha
// sido de las aprobadas. Es la respuesta a «¿quien crea las estrategias lo
// hace bien?»: cuántas prueba, cuántas pasan, qué puerta tumba a cada una y
// cómo van en papel las que se contrataron.
//
// Fuentes, sin inventar nada:
// - decisiones.jsonl, tipo `laboratorio` (§6.10): la evaluación completa con
//   sus criterios, el walk-forward, el DSR y el informe.
// - La instantánea (§7 `laboratorio`): lo que aún no tiene evaluación
//   (pendientes y en curso), los ensayos acumulados y la próxima revisión.
// - decisiones.jsonl, tipo `asignacion` (contratadas) y la instantánea
//   (`mesas`): qué hipótesis aprobada se contrató como mesa y cómo va.

const lectores = require('./lectores');

const es = x => typeof x === 'number' && Number.isFinite(x);
const MAX_HIPOTESIS = 300;

function deDecision(d) {
  const x = d.datos || {};
  const h = x.hipotesis || {};
  return {
    id: String(x.hipotesisId || ''),
    t: d.t,
    estado: x.aprobada ? 'aprobada' : 'rechazada',
    aprobada: Boolean(x.aprobada),
    descripcion: x.descripcion || null,
    resumen: d.resumen || null,
    familia: h.familia || null, marco: h.marco || null, universo: Array.isArray(h.universo) ? h.universo : [],
    filtros: Array.isArray(h.filtros) ? h.filtros : [], params: h.params || null,
    origen: h.origen || null, motivo: h.motivo || null, mesaId: h.mesaId || null,
    criterios: Array.isArray(x.criterios) ? x.criterios : [],
    puertasOk: es(x.puertasOk) ? x.puertasOk : null, puertasTotal: es(x.puertasTotal) ? x.puertasTotal : null,
    walkforward: x.walkforward || null, dsr: es(x.dsr) ? x.dsr : null,
    ensayosPrevios: es(x.ensayosPrevios) ? x.ensayosPrevios : null, ensayosTotales: es(x.ensayosTotales) ? x.ensayosTotales : null,
    paramsFinales: x.paramsFinales || null, referenciaDD: x.referenciaDD || null, informe: x.informe || null,
    contratada: null,
  };
}

function laboratorio({ instantanea, carpeta } = {}) {
  const inst = instantanea || {};
  const lab = inst.laboratorio || {};
  const decs = carpeta ? lectores.decisionesDe(carpeta, ['laboratorio', 'asignacion']) : [];

  // Una por hipótesis (si se apuntó dos veces, manda la última).
  const porId = new Map();
  for (const d of decs) {
    if (d.tipo !== 'laboratorio') continue;
    const h = deDecision(d);
    if (h.id) porId.set(h.id, h);
  }
  // Lo que aún no tiene evaluación: pendientes y en curso de la instantánea.
  for (const h of Array.isArray(lab.hipotesis) ? lab.hipotesis : []) {
    if (!h || !h.id || porId.has(h.id)) continue;
    if (h.estado !== 'pendiente' && h.estado !== 'evaluando') continue;
    porId.set(h.id, {
      id: h.id, t: es(h.t) ? h.t : null, estado: h.estado, aprobada: false, descripcion: h.descripcion || null, resumen: null,
      familia: null, marco: null, universo: [], filtros: [], params: null, origen: null, motivo: null, mesaId: null,
      criterios: [], puertasOk: null, puertasTotal: null, walkforward: null, dsr: null, ensayosPrevios: null, ensayosTotales: null,
      paramsFinales: null, referenciaDD: null, informe: null, contratada: null,
    });
  }

  // Contratadas: hipótesis aprobada → mesa, y cómo va esa mesa hoy.
  const mesas = new Map((Array.isArray(inst.mesas) ? inst.mesas : []).map(m => [m.id, m]));
  const contratadas = [];
  for (const d of decs) {
    if (d.tipo !== 'asignacion') continue;
    for (const c of (d.datos && d.datos.contratadas) || []) {
      const m = mesas.get(c.mesaId);
      const fila = {
        hipotesisId: c.hipotesisId || null, mesaId: c.mesaId || null, mesa: c.mesa || (m && m.nombre) || null, t: d.t,
        estadoActual: m ? m.estado : null, sharpePapel: m && m.metricas && es(m.metricas.sharpe) ? m.metricas.sharpe : null,
        operaciones: m && m.metricas && es(m.metricas.operaciones) ? m.metricas.operaciones : null,
        sharpeBacktest: m && es(m.sharpeBacktest) ? m.sharpeBacktest : null, diasActiva: m && es(m.diasActiva) ? m.diasActiva : null,
      };
      contratadas.push(fila);
      const h = c.hipotesisId && porId.get(String(c.hipotesisId));
      if (h) h.contratada = { mesaId: fila.mesaId, mesa: fila.mesa, t: d.t };
    }
  }

  const lista = [...porId.values()].sort((a, b) => (b.t ?? 0) - (a.t ?? 0)).slice(0, MAX_HIPOTESIS);
  const evaluadas = lista.filter(h => h.estado === 'aprobada' || h.estado === 'rechazada');
  // Cuántas veces tumba cada puerta (y cuántas veces se miró): qué filtra de verdad.
  const puertas = new Map();
  for (const h of evaluadas) {
    for (const c of h.criterios) {
      if (!c || !c.nombre) continue;
      if (!puertas.has(c.nombre)) puertas.set(c.nombre, { nombre: c.nombre, comparacion: c.comparacion || null, miradas: 0, pasan: 0, fallan: 0 });
      const p = puertas.get(c.nombre);
      p.miradas++;
      if (c.ok) p.pasan++; else p.fallan++;
    }
  }
  const aprobadas = evaluadas.filter(h => h.aprobada).length;
  return {
    t: es(inst.ahora) ? inst.ahora : null,
    ensayosTotales: es(lab.ensayosTotales) ? lab.ensayosTotales : (evaluadas.length && es(evaluadas[0].ensayosTotales) ? evaluadas[0].ensayosTotales : null),
    proximaRevision: es(lab.proximaRevision) ? lab.proximaRevision : null,
    resumen: {
      evaluadas: evaluadas.length,
      aprobadas,
      rechazadas: evaluadas.length - aprobadas,
      pendientes: lista.filter(h => h.estado === 'pendiente' || h.estado === 'evaluando').length,
      contratadas: contratadas.length,
      tasaAprobacion: evaluadas.length ? aprobadas / evaluadas.length : null,
    },
    puertas: [...puertas.values()],
    hipotesis: lista,
    contratadas,
  };
}

module.exports = { laboratorio, deDecision };
