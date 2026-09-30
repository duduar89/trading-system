'use strict';
// Dirección (§5.7, §6.9): una vez al mes (día 1, 00:15 UTC).
//
//   1. Contrata las hipótesis aprobadas por el laboratorio: mesa nueva en
//      incubación con el 2 %, con sus puestos y sus operadores, que llegan al
//      parqué.
//   2. asignador.reasignar() con las métricas de papel de cada mesa.
//   3. Aplica pesos (anotando el flujo en la curva de la mesa para que la
//      reasignación no cuente como rentabilidad), ascensos, despidos y
//      descartes. Una mesa al banquillo cierra sus puestos reales y sus
//      operadores pasan al estado 'banquillo'. Con peso 0 su sombra ya no abre
//      nada (dimensiona con 0 $); lo que tuviera abierto en sombra se cierra
//      por su regla. pesoAntesBanquillo queda solo como registro.
// Una hipótesis aprobada se contrata una sola vez: se descartan las aprobadas
// con la misma firma (contenido) que otra de la lista o que una mesa viva.

const { FAMILIAS } = require('../../estrategias');
const { firmaHipotesis } = require('../../cuant/laboratorio');
const { reasignar, REGLAS } = require('../../aprendizaje/asignador');
const plantillas = require('../plantillas');
const { DIA } = require('../../util/reloj');
const f = require('../../util/formato');
const mesasDep = require('./mesas');
const { valorMesa } = require('./operaciones');

function diasActiva(mesa, ahora) { return Math.max(0, Math.floor((ahora - mesa.fechaAlta) / DIA)); }

function siguienteMes(t) {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 15);
}

function contratar(ctx, h) {
  const e = ctx.estado;
  const ahora = ctx.reloj.ahora();
  e.contadores.contrataciones = (e.contadores.contrataciones || 0) + 1;
  let n = e.contadores.contrataciones;
  while (e.mesas.some(m => m.id === `lab${n}`)) n++;
  const est = FAMILIAS[h.familia];
  const base = est.parametrosPara ? est.parametrosPara(h.universo) : est.parametrosPorDefecto;
  const peso = REGLAS.incubacion;
  const mesa = {
    id: `lab${n}`,
    nombre: `${est.nombre} · lab ${n}`,
    familia: h.familia,
    marco: h.marco,
    universo: [...h.universo],
    params: JSON.parse(JSON.stringify({ ...base, ...(h.params || {}) })),
    filtros: (h.filtros || []).map(x => ({ id: x.id, parametro: x.parametro ?? null })),
    estado: 'incubacion',
    origen: 'laboratorio',
    nota: `Aprobada por el laboratorio (${h.id}): empieza en incubación con el ${f.pct(peso, { decimales: 0 })}.`,
    peso,
    fechaAlta: ahora,
    capitalBase: ctx.vivo.patrimonio * peso,
    flujoPendiente: 0,
    curvaDiaria: [],
    metricas: null,
    backtest: null,
    hipotesisId: h.id,
    firmaHipotesis: h.firma || firmaHipotesis(h),
  };
  ctx.agregarMesa(mesa);
  ctx.bus.publicar({
    de: 'cio', canal: 'direccion', tipo: 'contratacion',
    texto: plantillas.contratacion({ nombre: mesa.nombre, familia: mesa.familia, peso, universo: mesa.universo }),
    datos: { mesaId: mesa.id, hipotesisId: h.id, peso, universo: mesa.universo, filtros: mesa.filtros, params: mesa.params }, importancia: 3,
  });
  return mesa;
}

async function mandarAlBanquillo(ctx, mesa, motivo, { descarte = false } = {}) {
  mesa.estado = 'banquillo';
  mesa.nota = motivo;
  mesa.pesoAntesBanquillo = mesa.peso;
  for (const simbolo of mesa.universo) {
    await mesasDep.proponerCierre(ctx, { mesaId: mesa.id, simbolo, tipo: 'cierre', motivo: 'riesgo', accion: 'despido', velaT: ctx.reloj.ahora() });
  }
  for (const a of ctx.plantilla.filter(x => x.mesaId === mesa.id)) ctx.moverAgente(a.id, 'parque', 'banquillo');
  ctx.bus.publicar({
    de: 'cio', canal: 'direccion', tipo: 'despido',
    texto: plantillas.despido({ nombre: mesa.nombre, motivo: descarte ? `descartada tras la incubación. ${motivo}` : motivo }),
    datos: { mesaId: mesa.id, descarte, motivo }, importancia: 3,
  });
}

// Cambia el peso de una mesa: el capital que entra o sale es un flujo, no rentabilidad.
function fijarPeso(ctx, mesa, nuevo) {
  if (Math.abs((mesa.peso || 0) - nuevo) <= 1e-9) return 0;
  const nav = valorMesa(ctx, mesa);
  const objetivo = ctx.vivo.patrimonio * nuevo;
  const flujo = objetivo - nav;
  mesa.capitalBase += flujo;
  mesa.flujoPendiente = (mesa.flujoPendiente || 0) + flujo;
  mesa.peso = nuevo;
  return flujo;
}

async function revisionMensual(ctx) {
  const e = ctx.estado;
  const ahora = ctx.reloj.ahora();
  e.cadencias.proximoMensual = siguienteMes(ahora);

  const contratadas = [];
  const vivas = new Set(e.mesas.filter(m => m.estado !== 'banquillo' && m.firmaHipotesis).map(m => m.firmaHipotesis));
  for (const h of e.laboratorio.aprobadas.splice(0)) {
    const firma = h.firma || firmaHipotesis(h);
    if (firma && vivas.has(firma)) continue;          // ya hay una mesa con ese mismo contenido
    if (firma) vivas.add(firma);
    contratadas.push(contratar(ctx, { ...h, firma }));
  }

  const entrada = e.mesas.map(m => ({
    id: m.id,
    estado: m.estado,
    pesoActual: m.peso,
    volHistorica: m.backtest ? m.backtest.vol : null,
    metricas: m.metricas || {},
    diasActiva: diasActiva(m, ahora),
    sharpeBacktest: m.backtest ? m.backtest.sharpe : null,
  }));
  const r = reasignar({ mesas: entrada, ahora });
  const porId = new Map(e.mesas.map(m => [m.id, m]));
  const motivoDe = id => {
    const c = r.cambios.find(x => x.id === id);
    return c ? c.motivo : '';
  };

  const anotar = d => { if (typeof ctx.anotarDecision === 'function') ctx.anotarDecision(d); };
  const metricasDe = m => {
    const x = m.metricas || {};
    return {
      operaciones: x.operaciones ?? null, sharpe: x.sharpe ?? null, sharpeAjustado: x.sharpeAjustado ?? null, maxDD: x.maxDD ?? null,
      diasActiva: diasActiva(m, ahora), sharpeBacktest: m.backtest ? m.backtest.sharpe ?? null : null,
    };
  };
  for (const id of r.ascensos) {
    const m = porId.get(id);
    m.estado = 'titular';
    m.nota = `Ascendida el ${new Date(ahora).toISOString().slice(0, 10)}. ${motivoDe(id)}`.trim();
    const texto = plantillas.frase(`Asciendo ${m.nombre} a titular: deja de estar en prueba. ${motivoDe(id)}`);
    ctx.bus.publicar({ de: 'cio', canal: 'direccion', tipo: 'decision', texto, datos: { mesaId: id }, importancia: 3 });
    anotar({ tipo: 'ascenso', quien: 'cio', resumen: texto, datos: { mesaId: id, mesa: m.nombre, motivo: motivoDe(id) || null, reglas: 'asignador §5.7', ...metricasDe(m) } });
  }
  for (const id of r.despidos) {
    const m = porId.get(id);
    await mandarAlBanquillo(ctx, m, motivoDe(id) || 'por debajo del umbral');
    anotar({ tipo: 'despido', quien: 'cio', resumen: `${m.nombre} al banquillo: ${motivoDe(id) || 'por debajo del umbral'}`, datos: { mesaId: id, mesa: m.nombre, motivo: motivoDe(id) || null, ...metricasDe(m) } });
  }
  for (const id of r.descartes) {
    const m = porId.get(id);
    await mandarAlBanquillo(ctx, m, motivoDe(id) || 'no superó la incubación', { descarte: true });
    anotar({ tipo: 'descarte', quien: 'cio', resumen: `${m.nombre} descartada tras la incubación: ${motivoDe(id) || 'no superó la incubación'}`, datos: { mesaId: id, mesa: m.nombre, motivo: motivoDe(id) || null, ...metricasDe(m) } });
  }

  const cambiosPeso = [];
  for (const m of e.mesas) {
    const nuevo = typeof r.pesos[m.id] === 'number' ? r.pesos[m.id] : (m.estado === 'banquillo' ? 0 : m.peso);
    const antes = m.peso || 0;
    const flujo = fijarPeso(ctx, m, nuevo);
    if (flujo) cambiosPeso.push({ mesaId: m.id, mesa: m.nombre, de: antes, a: nuevo, flujo, motivo: motivoDe(m.id) || null });
    if (flujo && !r.despidos.includes(m.id) && !r.descartes.includes(m.id)) {
      ctx.bus.publicar({
        de: 'cio', canal: 'direccion', tipo: 'decision',
        texto: plantillas.frase(`${m.nombre} pasa a manejar el ${f.pct(nuevo, { decimales: 1 })} del capital (${f.usd(flujo, { signo: true })}). ${motivoDe(m.id)}`, 220),
        datos: { mesaId: m.id, peso: nuevo, flujo }, importancia: 2,
      });
    }
  }
  const resumen = {
    pesos: r.pesos, ascensos: r.ascensos, despidos: r.despidos, descartes: r.descartes, contratadas: contratadas.map(m => m.id),
  };
  const textoRevision = plantillas.frase(`Revisión del mes: ${contratadas.length} mesas contratadas, ${r.ascensos.length} ascendidas, ${r.despidos.length} al banquillo, ${r.descartes.length} descartadas tras la prueba y ${r.cambios.length} cambios de capital.`);
  ctx.bus.publicar({ de: 'cio', canal: 'direccion', tipo: 'informe', texto: textoRevision, datos: resumen, importancia: 2 });
  anotar({
    tipo: 'asignacion', quien: 'cio', resumen: textoRevision,
    datos: { ...resumen, cambios: cambiosPeso, contratadas: contratadas.map(m => ({ mesaId: m.id, mesa: m.nombre, hipotesisId: m.hipotesisId || null, peso: m.peso })) },
  });
  // Historial (§6.10): un punto por cada clase de suceso de esta revisión.
  if (typeof ctx.anotarHistorial === 'function') {
    if (cambiosPeso.length || contratadas.length) ctx.anotarHistorial('asignacion');
    if (r.ascensos.length) ctx.anotarHistorial('ascenso');
    if (r.despidos.length) ctx.anotarHistorial('despido');
    if (r.descartes.length) ctx.anotarHistorial('descarte');
  }
  return resumen;
}

module.exports = { revisionMensual, contratar, mandarAlBanquillo, fijarPeso, siguienteMes };
