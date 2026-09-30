'use strict';
// Riesgos (§5.3, §5.4, §6.7): la Jefa de riesgos envuelve evaluarPropuesta y
// vigilar. Aquí no se decide nada nuevo: se arma el contexto con el estado del
// fondo, se llama a las funciones de C y se cuenta en el chat lo que dijeron,
// con sus cifras.

const { evaluarPropuesta } = require('../../riesgo/limites');
const { vigilar, FACTOR_CAIDA } = require('../../riesgo/vigilante');
const { directivasVigentes } = require('../megafono');
const plantillas = require('../plantillas');
const { diaUTC, HORA } = require('../../util/reloj');
const { etiqueta } = require('./comun');

const MINUTO = 60_000;

// Órdenes enviadas al bróker (solo las reales) en la última hora.
function contarOrdenes(ctx, ahora) {
  const lista = ctx.registroOrdenes || [];
  while (lista.length && lista[0].t <= ahora - HORA) lista.shift();
  const porMesa = {};
  let ultimoMinuto = 0;
  for (const o of lista) {
    if (o.t > ahora - MINUTO) ultimoMinuto++;
    porMesa[o.mesaId] = (porMesa[o.mesaId] || 0) + 1;
  }
  return { ultimoMinuto, ultimaHoraPorMesa: porMesa };
}

// Lo que le llega a la sombra «sin comité» de las directivas vigentes: todo
// menos las decisiones del comité (§5.5). Se quitan su modo (DEFENSIVO o
// SOLO_CERRAR), sus multiplicadores por mesa y sus vetos de 24 h; se quedan
// las del Megáfono (solo cerrar, pausas de activo y de mesa, reducción) y los
// vetos por noticias graves, que no decide el comité.
function directivasSinComite(directivas, ahora) {
  const v = directivasVigentes(directivas, ahora);
  return { ...v, modo: 'NORMAL', multiplicadores: {}, activosVetados: (v.activosVetados || []).filter(x => x.origen !== 'comite') };
}

// Contexto de evaluarPropuesta. La sombra «sin comité» (§5.5, §6.7) mide si
// el comité aporta algo: sufre todo lo que no es el comité, igual que el
// fondo. Usa su propia cartera (patrimonio, exposición y la caída desde SU
// máximo, límites duros) y el nivel del fondo real (solo cerrar, pausa,
// bloqueo), con las directivas sin las del comité (directivasSinComite). Sus
// órdenes no van al bróker: no cuentan para el ritmo de órdenes.
function contexto(ctx, { sombra = false } = {}) {
  const ahora = ctx.reloj.ahora();
  const v = ctx.vivo;
  if (sombra) {
    const s = ctx.estado.sombra;
    const caida = s.pico > 0 ? v.patrimonioSombra / s.pico - 1 : 0;
    return {
      ahora, patrimonio: v.patrimonioSombra, valoracion: v.valoracionSombra, nivel: ctx.estado.fondo.nivel,
      multiplicadorCaida: caida <= -ctx.limites.caidaReducir + 1e-9 ? FACTOR_CAIDA : 1,
      directivas: directivasSinComite(ctx.estado.directivas, ahora),
      ordenes: { ultimoMinuto: 0, ultimaHoraPorMesa: {} }, mercadoAbierto: v.mercadoAbierto, limites: ctx.limites,
    };
  }
  return {
    ahora,
    patrimonio: v.patrimonio,
    valoracion: v.valoracion,
    nivel: ctx.estado.fondo.nivel,
    multiplicadorCaida: ctx.estado.fondo.multiplicadorCaida,
    directivas: directivasVigentes(ctx.estado.directivas, ahora),
    ordenes: contarOrdenes(ctx, ahora),
    mercadoAbierto: v.mercadoAbierto,
    limites: ctx.limites,
  };
}

// Evalúa una propuesta. Las reales se cuentan en el canal de riesgo con las
// cifras de cada motivo; las del sombra, en silencio.
function evaluar(ctx, propuesta, { sombra = false } = {}) {
  const r = evaluarPropuesta(propuesta, contexto(ctx, { sombra }));
  if (sombra) return r;
  const e = etiqueta(propuesta.simbolo);
  const datos = {
    puestoId: propuesta.puestoId, mesaId: propuesta.mesaId, simbolo: propuesta.simbolo, tipo: propuesta.tipo, lado: propuesta.lado,
    decision: r.decision, nocionalPedido: propuesta.nocional ?? null, nocional: r.nocional, cantidad: r.cantidad, motivos: r.motivos,
  };
  if (r.decision === 'vetar') {
    ctx.estado.contadores.vetos++;
    ctx.estado.contadores.vetosDesdeComite++;
    ctx.bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'veto', texto: plantillas.veto({ etiqueta: e, motivos: r.motivos }), datos, importancia: 2 });
  } else {
    ctx.bus.publicar({
      de: 'riesgos', canal: 'riesgo', tipo: 'aprobacion',
      texto: plantillas.aprobacion({ etiqueta: e, lado: propuesta.lado, decision: r.decision, nocional: r.nocional, nocionalPedido: propuesta.nocional, cantidad: r.cantidad, motivos: r.motivos }),
      datos, importancia: r.decision === 'reducir' ? 2 : 1,
    });
  }
  return r;
}

// Alertas que no se repiten: el vigilante avisa en cada latido mientras dure
// una situación (p. ej. bloqueado con algo abierto); se cuenta una vez por hora.
function alertaUnaVez(ctx, texto, importancia = 3) {
  const ahora = ctx.reloj.ahora();
  const vistas = ctx.estado.riesgo.alertasVistas || (ctx.estado.riesgo.alertasVistas = {});
  if (vistas[texto] !== undefined && ahora - vistas[texto] < HORA) return false;
  vistas[texto] = ahora;
  for (const k of Object.keys(vistas)) if (ahora - vistas[k] >= HORA) delete vistas[k];
  ctx.bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'alerta', texto: plantillas.frase(texto), importancia });
  return true;
}

// Referencias con las que el vigilante mide los límites de pérdida:
// normalmente las contables (pico histórico e inicio real del día). Tras un
// REABRIR humano después de un kill, el orquestador guarda aparte una
// referencia de vigilancia (el patrimonio al reabrir): si no, el vigilante
// volvería a disparar en el latido siguiente. La contabilidad (cabecera,
// informes) no la usa: sigue midiendo desde el máximo histórico y desde el
// inicio real del día. La del día vale solo el día en que se reabrió.
function referenciasVigilancia(e, ahora) {
  const conDia = e.diaInicioVigilancia === diaUTC(ahora) && e.inicioDiaVigilancia > 0;
  const conPico = e.picoVigilancia > 0;
  return {
    patrimonioInicioDia: conDia ? e.inicioDiaVigilancia : e.patrimonioInicioDia,
    diaInicio: conDia ? e.diaInicioVigilancia : e.diaInicio,
    pico: conPico ? e.picoVigilancia : e.pico,
    desdeReapertura: conDia || conPico,
  };
}

// Vigilante en cada latido. Devuelve las acciones para que el orquestador las
// ejecute (kill, stops reales y del sombra).
function vigilarFondo(ctx) {
  const ahora = ctx.reloj.ahora();
  const e = ctx.estado;
  const precios = ctx.vivo.precios;
  const patrimonio = ctx.vivo.patrimonio;
  const ref = referenciasVigilancia(e, ahora);
  const puestos = ctx.libros.listaPuestos().map(p => ({ ...p, precio: precios[p.simbolo] ? precios[p.simbolo].precio : null }));
  const r = vigilar({
    ahora,
    patrimonio,
    patrimonioInicioDia: ref.patrimonioInicioDia,
    pico: ref.pico,
    puestos,
    precios,
    limites: ctx.limites,
    nivelActual: e.fondo.nivel,
    soloCerrarHasta: e.fondo.soloCerrarHasta,
    multiplicadorCaidaActual: e.fondo.multiplicadorCaida,
    diaInicio: ref.diaInicio,
  });
  const antes = e.fondo.nivel;
  e.fondo.multiplicadorCaida = r.multiplicadorCaida;
  if (r.pico && r.pico > e.pico) e.pico = r.pico;
  // El pico de vigilancia sube con el patrimonio; al volver al máximo histórico ya no hace falta.
  if (e.picoVigilancia > 0) {
    if (patrimonio >= e.pico) e.picoVigilancia = null;
    else if (patrimonio > e.picoVigilancia) e.picoVigilancia = patrimonio;
  }

  // Con kill, el aviso lo da kill() con su motivo: aquí no se repite.
  const hayKill = r.acciones.some(a => a.tipo === 'kill');
  if (!hayKill) for (const texto of r.alertas) alertaUnaVez(ctx, texto, /^Stop saltado/.test(texto) ? 2 : 3);

  if (r.nivel !== antes && r.nivel !== 'bloqueado') {
    e.fondo.nivel = r.nivel;
    e.fondo.soloCerrarHasta = r.soloCerrarHasta;
    e.fondo.motivo = r.nivel === 'normal' ? null : e.fondo.motivo;
  }
  for (const a of r.acciones) {
    if (a.tipo === 'solo_cerrar') {
      e.fondo.nivel = 'solo_cerrar';
      e.fondo.soloCerrarHasta = a.hasta;
      e.fondo.motivo = a.motivo;   // el aviso con las cifras ya salió en r.alertas
    }
  }
  return { ...r, dia: diaUTC(ahora), desdeReapertura: ref.desdeReapertura };
}

module.exports = { evaluar, vigilarFondo, referenciasVigilancia, contexto, directivasSinComite, contarOrdenes, alertaUnaVez };
