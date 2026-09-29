'use strict';
// Comité (§6.8): cada COMITE_HORAS (alineado a 00, 04, 08… UTC) o a demanda.
//
// Orden del día fijo; cada punto es un mensaje en el canal `comite`:
//   1. Controller: patrimonio, P&L del día, caída, exposición.
//   2. Estratega macro: régimen y por qué. Voto: RISK-OFF → DEFENSIVO.
//   3. Jefa de riesgos: límites cerca de saltar y vetos del periodo. Voto:
//      nivel ≠ normal o caída ≤ −5 % → DEFENSIVO. Su DEFENSIVO es veto: no
//      puede salir NORMAL.
//   4. Mesas: mejor y peor por P&L del periodo.
//   5. Laboratorio: hipótesis en curso.
//   6. Megáfono: lo pendiente.
//   7. Presidenta: decisión.
//
// La decisión es UNA llamada al LLM (uso 'comite') con esquema estricto:
// modo de una lista, multiplicadores de {0; 0,5; 1}, vetos de 24 h de activos
// del universo. Sin LLM, o si no valida: plan por defecto (mayoría de votos,
// en empate el más prudente; multiplicadores 1; vetos = eventos graves de
// noticias). Las intervenciones del LLM sustituyen a las plantillas de los
// puntos 1-6 solo si pasan verificarCifras() contra los datos que se le dieron.

const plantillas = require('./plantillas');
const { verificarCifras } = require('./cifras');
const { directivasVigentes } = require('./megafono');
const { HORA } = require('../util/reloj');
const f = require('../util/formato');
const { pnlMesaTotal } = require('./departamentos/operaciones');
const { etiqueta } = require('./departamentos/comun');

const JEFES = Object.freeze(['cio', 'controller', 'macro', 'riesgos', 'laboratorio']);
const MODOS = Object.freeze(['NORMAL', 'DEFENSIVO', 'SOLO_CERRAR']);
const PRUDENCIA = Object.freeze({ NORMAL: 0, DEFENSIVO: 1, SOLO_CERRAR: 2 });
const MULTIPLICADORES = Object.freeze([0, 0.5, 1]);
const PUNTOS = Object.freeze(['controller', 'macro', 'riesgos', 'mesas', 'laboratorio', 'megafono']);
// Quién habla en cada punto: los puntos de mesas y del Megáfono los lleva la Presidenta.
const PORTAVOZ = Object.freeze({ controller: 'controller', macro: 'macro', riesgos: 'riesgos', mesas: 'cio', laboratorio: 'laboratorio', megafono: 'cio' });
const CAIDA_DEFENSIVA = -0.05;
const CERCA = 0.8;           // un límite «cerca de saltar» es el 80 % de su tope
const VETO_HORAS = 24;

const esperarReal = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());

function cercanos(ctx, patrimonio, pnlDiaPct, caida) {
  const lim = ctx.limites;
  const val = ctx.vivo.valoracion || { exposicionBruta: 0, exposicionCripto: 0, exposicionPorActivo: {}, posicionesAbiertas: 0 };
  const out = [];
  const mirar = (nombre, uso, tope, texto) => { if (tope > 0 && uso >= CERCA * tope) out.push(texto); };
  if (patrimonio > 0) {
    mirar('bruta', val.exposicionBruta / patrimonio, lim.maxExposicionBruta, `exposición bruta ${f.pct(val.exposicionBruta / patrimonio, { decimales: 0 })} de ${f.pct(lim.maxExposicionBruta, { decimales: 0 })}`);
    mirar('cripto', val.exposicionCripto / patrimonio, lim.maxExposicionCripto, `cripto ${f.pct(val.exposicionCripto / patrimonio, { decimales: 0 })} de ${f.pct(lim.maxExposicionCripto, { decimales: 0 })}`);
    for (const [s, v] of Object.entries(val.exposicionPorActivo || {})) {
      mirar('activo', v / patrimonio, lim.maxPesoPorActivo, `${etiqueta(s)} ${f.pct(v / patrimonio, { decimales: 1 })} de ${f.pct(lim.maxPesoPorActivo, { decimales: 0 })}`);
    }
  }
  if (pnlDiaPct !== null && pnlDiaPct < 0) mirar('dia', -pnlDiaPct, lim.perdidaDiariaSoloCerrar, `pérdida del día ${f.pct(pnlDiaPct)} (solo cerrar en ${f.pct(-lim.perdidaDiariaSoloCerrar)})`);
  if (caida !== null && caida < 0) mirar('caida', -caida, lim.caidaKill, `caída ${f.pct(caida)} (kill en ${f.pct(-lim.caidaKill, { decimales: 0 })})`);
  mirar('posiciones', val.posicionesAbiertas || 0, lim.maxPosiciones, `${val.posicionesAbiertas} posiciones de ${lim.maxPosiciones}`);
  return out;
}

// Datos de los seis primeros puntos, calculados por el código.
function reunirDatos(ctx) {
  const e = ctx.estado;
  const v = ctx.vivo;
  const ahora = ctx.reloj.ahora();
  const patrimonio = v.patrimonio;
  const pnlDia = patrimonio - e.patrimonioInicioDia;
  const pnlDiaPct = e.patrimonioInicioDia > 0 ? pnlDia / e.patrimonioInicioDia : null;
  const caida = e.pico > 0 ? Math.min(0, patrimonio / e.pico - 1) : 0;
  const val = v.valoracion || { exposicionBruta: 0, exposicionCripto: 0, posicionesAbiertas: 0 };
  const controller = {
    patrimonio, pnlDia, pnlDiaPct, caida,
    exposicionBrutaPct: patrimonio > 0 ? val.exposicionBruta / patrimonio : null,
    exposicionCriptoPct: patrimonio > 0 ? val.exposicionCripto / patrimonio : null,
    posiciones: val.posicionesAbiertas,
  };
  const reg = e.macro.regimen || { valor: 'NEUTRAL', puntos: 0, detalle: 'sin datos' };
  const votoMacro = reg.valor === 'RISK-OFF' ? 'DEFENSIVO' : 'NORMAL';
  const macro = { regimen: reg.valor, puntos: reg.puntos, detalle: reg.detalle, fg: e.macro.fg ? e.macro.fg.valor : null, voto: votoMacro };
  const votoRiesgos = e.fondo.nivel !== 'normal' || caida <= CAIDA_DEFENSIVA ? 'DEFENSIVO' : 'NORMAL';
  const riesgos = { nivel: e.fondo.nivel, vetos: e.contadores.vetosDesdeComite || 0, cercanos: cercanos(ctx, patrimonio, pnlDiaPct, caida), caida, voto: votoRiesgos };
  const previos = (e.comite && e.comite.pnlMesas) || {};
  const porMesa = e.mesas.filter(m => m.estado !== 'banquillo').map(m => {
    const total = pnlMesaTotal(ctx, m.id);
    return { id: m.id, nombre: m.nombre, estado: m.estado, peso: m.peso, pnl: total - (previos[m.id] ?? 0), pnlTotal: total };
  });
  const conMovimiento = porMesa.filter(m => Math.abs(m.pnl) >= 0.005).sort((a, b) => b.pnl - a.pnl);
  const mesas = {
    mejor: conMovimiento.length ? { nombre: conMovimiento[0].nombre, pnl: conMovimiento[0].pnl } : null,
    peor: conMovimiento.length > 1 ? { nombre: conMovimiento[conMovimiento.length - 1].nombre, pnl: conMovimiento[conMovimiento.length - 1].pnl } : null,
    lista: porMesa,
  };
  const lab = e.laboratorio;
  const laboratorio = {
    enCurso: lab.hipotesis.filter(h => h.estado === 'pendiente' || h.estado === 'evaluando').length,
    aprobadas: lab.aprobadas.length,
    ensayos: lab.ensayosTotales,
  };
  const vig = directivasVigentes(e.directivas, ahora);
  const deMegafono = [...(vig.activosVetados || []), ...(vig.mesasPausadas || [])].filter(x => x.origen === 'megafono').length
    + (vig.reduccion && vig.reduccion.origen === 'megafono' ? 1 : 0) + (vig.soloCerrarHasta ? 1 : 0);
  const megafono = { vigentes: deMegafono, pendientes: e.megafonoPendiente ? 1 : 0 };
  const graves = (e.noticias.eventosGraves || []).filter(x => x.hasta > ahora).map(x => x.simbolo);
  return { hora: f.hora(ahora), controller, macro, riesgos, mesas, laboratorio, megafono, votos: { macro: votoMacro, riesgos: votoRiesgos }, eventosGraves: [...new Set(graves)] };
}

// Mayoría de votos; en empate, el más prudente. El DEFENSIVO de Riesgos es veto.
function planPorDefecto(datos, mesasActivas) {
  const votos = Object.values(datos.votos);
  const cuenta = {};
  for (const v of votos) cuenta[v] = (cuenta[v] || 0) + 1;
  const max = Math.max(...Object.values(cuenta));
  let modo = Object.keys(cuenta).filter(k => cuenta[k] === max).sort((a, b) => PRUDENCIA[b] - PRUDENCIA[a])[0] || 'NORMAL';
  if (datos.votos.riesgos !== 'NORMAL' && PRUDENCIA[modo] < PRUDENCIA[datos.votos.riesgos]) modo = datos.votos.riesgos;
  return {
    modo,
    multiplicadores: Object.fromEntries(mesasActivas.map(m => [m.id, 1])),
    vetos: [...datos.eventosGraves],
    razon: null,
  };
}

function esquemaDecision(mesasActivas, simbolos) {
  const props = {};
  for (const m of mesasActivas) props[m.id] = { type: 'number', enum: [...MULTIPLICADORES] };
  return {
    type: 'object',
    properties: {
      modo: { type: 'string', enum: [...MODOS] },
      multiplicadores: { type: 'object', properties: props, required: mesasActivas.map(m => m.id), additionalProperties: false },
      vetos: { type: 'array', items: { type: 'string', enum: simbolos } },
      razon: { type: 'string' },
      intervenciones: {
        type: 'array',
        items: {
          type: 'object',
          properties: { agente: { type: 'string', enum: [...PUNTOS] }, texto: { type: 'string' } },
          required: ['agente', 'texto'],
          additionalProperties: false,
        },
      },
    },
    required: ['modo', 'multiplicadores', 'vetos', 'razon', 'intervenciones'],
    additionalProperties: false,
  };
}

const SISTEMA = 'Eres la Presidenta del comité de una mesa de trading en papel. Decides entre opciones cerradas con los datos que te da el código. '
  + 'Nunca cambias límites duros ni inventas cifras: cualquier número que escribas tiene que estar en los datos.';

const INSTRUCCIONES = [
  'Decide el modo del fondo para las próximas horas: NORMAL, DEFENSIVO (las mesas operan con la mitad de capital) o SOLO_CERRAR.',
  'Reglas que el código aplica igualmente: si Riesgos vota DEFENSIVO, no puede salir NORMAL. Los multiplicadores por mesa solo pueden ser 0, 0,5 o 1.',
  'Vetos: activos del universo en los que no se abrirá durante 24 h (solo si hay motivo en los datos).',
  '«planPorDefecto» es lo que haría el código sin ti: apártate de él solo con un motivo que esté en los datos.',
  'razon: una o dos frases con cifras copiadas de los datos.',
  'intervenciones: una frase por punto del orden del día (controller, macro, riesgos, mesas, laboratorio, megafono), en español, con cifras de los datos.',
].join('\n');

function normalizarDecision(datosLLM, mesasActivas, simbolos, votos) {
  const multiplicadores = {};
  for (const m of mesasActivas) {
    const v = datosLLM.multiplicadores ? datosLLM.multiplicadores[m.id] : undefined;
    multiplicadores[m.id] = MULTIPLICADORES.includes(v) ? v : 1;
  }
  let modo = MODOS.includes(datosLLM.modo) ? datosLLM.modo : 'NORMAL';
  let vetoRiesgos = false;
  if (votos.riesgos !== 'NORMAL' && PRUDENCIA[modo] < PRUDENCIA[votos.riesgos]) { modo = votos.riesgos; vetoRiesgos = true; }
  const vetos = [...new Set((datosLLM.vetos || []).filter(s => simbolos.includes(s)))];
  return { modo, multiplicadores, vetos, vetoRiesgos };
}

function textoPlantilla(punto, datos) {
  if (punto === 'controller') return plantillas.informeComite.controller(datos.controller);
  if (punto === 'macro') return plantillas.informeComite.macro(datos.macro);
  if (punto === 'riesgos') return plantillas.informeComite.riesgos(datos.riesgos);
  if (punto === 'mesas') return plantillas.informeComite.mesas(datos.mesas);
  if (punto === 'laboratorio') return plantillas.informeComite.laboratorio(datos.laboratorio);
  return plantillas.informeComite.megafono(datos.megafono);
}

function aplicarDecision(ctx, decision, ahora) {
  const d = ctx.estado.directivas;
  d.modo = decision.modo;
  d.multiplicadores = { ...decision.multiplicadores };
  const hasta = ahora + VETO_HORAS * HORA;
  for (const s of decision.vetos) {
    d.activosVetados = (d.activosVetados || []).filter(x => !(x.simbolo === s && x.origen === 'comite'));
    d.activosVetados.push({ simbolo: s, hasta, motivo: 'comité', origen: 'comite' });
  }
}

async function celebrar(ctx, { motivo = 'programado' } = {}) {
  if (ctx.comiteEnCurso) return { ok: false, mensaje: 'Ya hay un comité reunido.' };
  ctx.comiteEnCurso = true;
  const e = ctx.estado;
  const t0 = ctx.reloj.ahora();
  // Pausa real entre puntos para verlo en el panel, pero acotada: el comité
  // entero (8 mensajes) no puede ocupar más de la mitad del intervalo entre
  // comités en tiempo de pantalla (a ×3000, 4 h simuladas son 4,8 s).
  const intervaloPantalla = (ctx.config.cadencias.comiteHoras * HORA) / (ctx.modo === 'sintetico' ? Math.max(1, ctx.velocidad) : 1);
  const pausaMs = Math.min(ctx.opciones.pausaComiteMs || 0, intervaloPantalla / 2 / 8);
  const pausa = () => esperarReal(pausaMs);
  try {
    for (const id of JEFES) ctx.moverAgente(id, 'comite', 'reunion');
    ctx.bus.publicar({
      de: 'cio', canal: 'comite', tipo: 'comite',
      texto: `Abro el comité de las ${f.hora(t0)}${motivo === 'demanda' ? ' (convocado a demanda)' : ''}. Orden del día: siete puntos.`,
      datos: { motivo }, importancia: 3,
    });
    const datos = reunirDatos(ctx);
    const mesasActivas = e.mesas.filter(m => m.estado !== 'banquillo');
    const simbolos = ctx.universo.map(a => a.simbolo);
    const plan = planPorDefecto(datos, mesasActivas);
    let decision = { ...plan, vetoRiesgos: false };
    let fuente = 'defecto';
    let razon = null;
    let costeUsd = 0;
    const intervenciones = {};
    let motivoDefecto = null;

    if (ctx.llm && ctx.llm.activo) {
      const entrada = {
        hora: datos.hora, controller: datos.controller, macro: datos.macro, riesgos: datos.riesgos,
        mesas: { mejor: datos.mesas.mejor, peor: datos.mesas.peor, lista: datos.mesas.lista.map(m => ({ id: m.id, nombre: m.nombre, estado: m.estado, peso: m.peso, pnl: m.pnl })) },
        laboratorio: datos.laboratorio, megafono: datos.megafono, votos: datos.votos, eventosGraves: datos.eventosGraves,
        planPorDefecto: { modo: plan.modo, multiplicadores: plan.multiplicadores, vetos: plan.vetos },
        limites: { maxExposicionBruta: ctx.limites.maxExposicionBruta, maxExposicionCripto: ctx.limites.maxExposicionCripto, perdidaDiariaSoloCerrar: ctx.limites.perdidaDiariaSoloCerrar, caidaKill: ctx.limites.caidaKill },
      };
      const r = await ctx.llm.pedirJSON({
        uso: 'comite', proposito: 'comite', sistema: SISTEMA, instrucciones: INSTRUCCIONES, entrada,
        esquema: esquemaDecision(mesasActivas, simbolos), maxTokens: 4000, esfuerzo: 'medium',
      });
      costeUsd = r.costeUsd || 0;
      if (r.ok) {
        decision = normalizarDecision(r.datos, mesasActivas, simbolos, datos.votos);
        fuente = 'llm';
        const rz = String(r.datos.razon || '').trim();
        if (rz && verificarCifras(rz, entrada).ok) razon = plantillas.frase(rz, 200);
        for (const it of r.datos.intervenciones || []) {
          const texto = String(it.texto || '').trim();
          if (texto && PUNTOS.includes(it.agente) && !intervenciones[it.agente] && verificarCifras(texto, entrada).ok) intervenciones[it.agente] = plantillas.frase(texto, 200);
        }
      } else {
        motivoDefecto = r.motivo;
      }
    }

    for (const punto of PUNTOS) {
      await pausa();
      let texto = intervenciones[punto] || textoPlantilla(punto, datos);
      const esVoto = punto === 'macro' || punto === 'riesgos';
      if (esVoto && intervenciones[punto] && !/voto/i.test(texto)) texto = plantillas.frase(`${texto} Voto ${datos.votos[punto]}.`, 200);
      ctx.bus.publicar({
        de: PORTAVOZ[punto], canal: 'comite', tipo: esVoto ? 'voto' : 'informe', texto,
        datos: { punto, fuente: intervenciones[punto] ? 'llm' : 'plantilla', ...(esVoto ? { voto: datos.votos[punto] } : {}), ...(punto === 'riesgos' ? { cercanos: datos.riesgos.cercanos } : {}) },
        importancia: 2,
      });
    }
    await pausa();
    const ahora = ctx.reloj.ahora();
    aplicarDecision(ctx, decision, ahora);
    let texto = plantillas.decisionComite({ ...decision, fuente });
    if (decision.vetoRiesgos) texto = plantillas.frase(`${texto} Riesgos vota ${datos.votos.riesgos}: veto a NORMAL.`, 200);
    if (razon) texto = plantillas.frase(`${texto} ${razon}`, 280);
    ctx.bus.publicar({
      de: 'cio', canal: 'comite', tipo: 'decision', texto,
      datos: { modo: decision.modo, multiplicadores: decision.multiplicadores, vetos: decision.vetos, fuente, votos: datos.votos, motivoPlanPorDefecto: motivoDefecto },
      importancia: 3, costeUsd,
    });
    const c = e.comite;
    c.celebrados = (c.celebrados || 0) + 1;
    c.ultimo = { t: ahora, modo: decision.modo, multiplicadores: decision.multiplicadores, vetos: decision.vetos, fuente };
    c.historial = [...(c.historial || []), ahora].slice(-50);
    c.pnlMesas = Object.fromEntries(e.mesas.map(m => [m.id, pnlMesaTotal(ctx, m.id)]));
    e.contadores.vetosDesdeComite = 0;
    return { ok: true, mensaje: `Comité celebrado: modo ${decision.modo}.`, datos: { ...c.ultimo } };
  } finally {
    const bloqueado = e.fondo.nivel === 'bloqueado';
    for (const id of JEFES) ctx.moverAgente(id, null, bloqueado ? 'de_pie' : 'trabajando');
    ctx.comiteEnCurso = false;
  }
}

module.exports = { celebrar, reunirDatos, planPorDefecto, esquemaDecision, normalizarDecision, aplicarDecision, JEFES, PUNTOS, MODOS };
