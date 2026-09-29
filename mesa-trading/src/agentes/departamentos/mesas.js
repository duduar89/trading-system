'use strict';
// Mesas (§6.7): con cada vela nueva del marco de una mesa, cada operador
// decide su puesto con la estrategia (la misma función que el backtest), se
// dimensiona con dimensionar() y la propuesta pasa por Riesgos y el Ejecutor.
//
//   capital de mesa = patrimonio · peso · multiplicador del comité · (0,5 si DEFENSIVO)
//
// En paralelo, el puesto sombra «sin comité» decide lo mismo con su propia
// posición y su propia cartera: multiplicador 1, sin directivas y sin bróker
// (se llena en los libros al precio actual con los costes del simulado).
//
// En vivo se prepara con velasNecesarias(mesa) velas: así la decisión y el
// stop del último índice son los del backtest con todo el histórico
// (informe de A, pendiente 1).

const { FAMILIAS, velasNecesarias } = require('../../estrategias');
const comunEst = require('../../estrategias/comun');
const { volatilidad } = require('../../mercado/indicadores');
const { dimensionar } = require('../../cuant/dimensionado');
const universo = require('../../mercado/universo');
const plantillas = require('../plantillas');
const riesgos = require('./riesgos');
const { inicioVela, MIN } = require('../../util/reloj');
const { EPS, etiqueta, puestoId, puestoSombraId, agenteDePuesto, precioDe, isoCompacto, llenarSombra, posicionDe } = require('./comun');

const MARCOS = universo.MARCOS;
const COMPROBAR_ACCIONES = 15 * MIN;
const ESPERA_VELA = 10 * MIN;

function multiplicador(ctx, mesaId) {
  const m = ctx.estado.directivas.multiplicadores;
  return m && typeof m[mesaId] === 'number' ? m[mesaId] : 1;
}

// Capital con el que dimensiona la mesa. Con multiplicador 0 se dimensiona
// como si fuera 1 para que sea Riesgos quien vete con su motivo (el comité la
// dejó a ×0) en vez de una propuesta vacía sin explicación.
function capitalMesa(ctx, mesa, { sombra = false, paraProponer = false } = {}) {
  const peso = mesa.peso || 0;
  if (sombra) return (ctx.vivo.patrimonioSombra || 0) * peso;
  let mult = multiplicador(ctx, mesa.id);
  if (paraProponer && mult === 0) mult = 1;
  const defensivo = ctx.estado.directivas.modo === 'DEFENSIVO' ? 0.5 : 1;
  return (ctx.vivo.patrimonio || 0) * peso * mult * defensivo;
}

function paramsDe(mesa) {
  const e = FAMILIAS[mesa.familia];
  const base = e.parametrosPara ? e.parametrosPara(mesa.universo) : e.parametrosPorDefecto;
  return { ...base, ...(mesa.params || {}) };
}

async function cargarVelas(ctx, mesa, ahora) {
  const marcoMs = MARCOS[mesa.marco];
  const cripto = mesa.universo.every(s => universo.esCripto(s));
  const n = velasNecesarias(mesa) + 5;
  // Acciones: una vela por sesión; 1,6 días por vela cubre fines de semana y festivos.
  const desde = ahora - Math.ceil((n + 2) * marcoMs * (cripto ? 1 : 1.6));
  const velas = {};
  for (const s of mesa.universo) {
    if (!ctx.datos.disponible(s)) continue;
    const v = await ctx.datos.velas(s, mesa.marco, { desde, hasta: ahora });
    if (v.length) velas[s] = v;
  }
  return velas;
}

function contextoEstrategia(ctx, mesa) {
  const m = ctx.estado.macro;
  return { regimen: m.regimen ? m.regimen.valor : null, fg: m.fg ? m.fg.valor : null, filtros: mesa.filtros || [] };
}

function textoPuesto(ctx, mesa, simbolo, senal, pLibros) {
  if (ctx.estado.fondo.nivel === 'bloqueado') return 'Fondo bloqueado por el kill switch: no se opera hasta Reabrir.';
  if (mesa.estado === 'banquillo') return `Mesa en el banquillo: ${etiqueta(simbolo)} sigue solo en sombra.`;
  const pos = pLibros && pLibros.cantidad > EPS ? pLibros : null;
  const px = precioDe(ctx.vivo.precios, simbolo);
  return plantillas.estadoPuesto({
    etiqueta: etiqueta(simbolo), marco: mesa.marco,
    posicion: pos ? { cantidad: pos.cantidad, entrada: pos.costeMedio, stop: pos.stop, pnlAbiertoPct: px && pos.costeMedio > 0 ? px / pos.costeMedio - 1 : null } : null,
    estadoEstrategia: senal ? senal.estado : null,
  });
}

// Marca la vela, sube el trailing y decide un puesto (real o sombra).
function decidirPuesto(ctx, { mesa, est, prep, simbolo, i, tDecision, pid }) {
  const serie = prep.velas[simbolo];
  const cierre = serie[i].c;
  let p = ctx.libros.puesto(pid);
  if (p.cantidad > EPS) {
    ctx.libros.marcarVela(pid, cierre);
    p = ctx.libros.puesto(pid);
    const nuevo = est.trailing(prep, { simbolo, i, posicion: posicionDe(p), params: prep.params });
    if (nuevo !== null && nuevo !== undefined && Number.isFinite(nuevo)) ctx.libros.fijarStop(pid, nuevo);
    p = ctx.libros.puesto(pid);
  } else {
    ctx.libros.marcarVela(pid, cierre);
  }
  const senal = est.decidir(prep, { simbolo, i, posicion: posicionDe(p), t: tDecision, contexto: contextoEstrategia(ctx, mesa) });
  return { senal, p };
}

// ---------- Real ----------

async function proponerApertura(ctx, { mesa, simbolo, senal, cierre, tVela, vol }) {
  const pid = puestoId(mesa.id, simbolo);
  const agente = agenteDePuesto(mesa.id, simbolo);
  const q = ctx.vivo.precios[simbolo];
  const precio = q ? q.precio : null;
  if (!(precio > 0)) {
    ctx.bus.publicar({ de: agente, canal: 'parque', tipo: 'estado', texto: `Sin precio de ${etiqueta(simbolo)}: no propongo nada.`, datos: { puestoId: pid } });
    return null;
  }
  const dim = dimensionar({
    capitalMesa: capitalMesa(ctx, mesa, { paraProponer: true }), peso: senal.peso, precio, stop: senal.stop, volAnual: vol,
    patrimonio: ctx.vivo.patrimonio, limites: ctx.limites,
  });
  const propuesta = {
    puestoId: pid, mesaId: mesa.id, simbolo, clase: universo.esCripto(simbolo) ? 'cripto' : 'accion', lado: 'compra', tipo: 'apertura',
    nocional: dim.nocional, cantidad: dim.cantidad, precio, precioT: q.t, stop: senal.stop, precioDecision: cierre,
  };
  ctx.bus.publicar({
    de: agente, canal: 'parque', tipo: 'propuesta',
    texto: plantillas.propuesta({ etiqueta: etiqueta(simbolo), lado: 'compra', nocional: dim.nocional, cantidad: dim.cantidad, precio, stop: senal.stop }),
    datos: { ...propuesta, limitadoPor: dim.limitadoPor, capitalMesa: capitalMesa(ctx, mesa) }, importancia: 2,
  });
  // Acciones con la bolsa cerrada (§6.7): la decisión queda pendiente y Riesgos
  // la mira a la apertura + 5 min, con el precio de entonces (si se ha movido
  // más del 2 % desde la decisión, la veta). Mirarla ahora la vetaría siempre.
  const cerrada = !universo.esCripto(simbolo) && !(ctx.vivo.mercadoAbierto && ctx.vivo.mercadoAbierto.accion);
  const r = cerrada ? { decision: 'aprobar', nocional: dim.nocional } : riesgos.evaluar(ctx, propuesta);
  if (r.decision === 'vetar') return null;
  const res = await ctx.ejecutor.ejecutar({
    puestoId: pid, mesaId: mesa.id, simbolo, lado: 'compra', nocional: r.nocional, tipo: 'apertura', motivo: 'señal', accion: 'abrir',
    velaT: tVela, stop: senal.stop, objetivoPrecio: senal.objetivoPrecio, regimen: ctx.estado.macro.regimen ? ctx.estado.macro.regimen.valor : null,
    precioReferencia: precio,
  });
  await ctx.refrescarCartera();
  return res;
}

// Venta de todo el puesto por señal, stop o decisión de riesgo (despido).
async function proponerCierre(ctx, { mesaId, simbolo, tipo = 'cierre', motivo = 'señal', accion = 'cerrar', velaT }) {
  const pid = puestoId(mesaId, simbolo);
  const p = ctx.libros.puesto(pid);
  if (!p || !(p.cantidad > EPS)) return null;
  const q = ctx.vivo.precios[simbolo];
  const precio = q ? q.precio : p.ultimoPrecio;
  const propuesta = {
    puestoId: pid, mesaId, simbolo, clase: universo.esCripto(simbolo) ? 'cripto' : 'accion', lado: 'venta', tipo,
    cantidad: p.cantidad, nocional: precio ? p.cantidad * precio : null, precio, precioT: q ? q.t : null,
  };
  if (tipo === 'cierre') {
    ctx.bus.publicar({
      de: agenteDePuesto(mesaId, simbolo), canal: 'parque', tipo: 'propuesta',
      texto: plantillas.propuesta({ etiqueta: etiqueta(simbolo), lado: 'venta', cantidad: p.cantidad, precio }), datos: propuesta, importancia: 2,
    });
  }
  const r = riesgos.evaluar(ctx, propuesta);
  if (r.decision === 'vetar') return null;
  const res = await ctx.ejecutor.ejecutar({
    puestoId: pid, mesaId, simbolo, lado: 'venta', cantidad: p.cantidad, cantidadPuesto: p.cantidad, tipo, motivo, accion,
    velaT: velaT ?? ctx.reloj.ahora(), precioReferencia: precio, cierraTodo: true,
  });
  await ctx.refrescarCartera();
  return res;
}

// ---------- Sombra «sin comité» ----------

function abrirSombra(ctx, { mesa, simbolo, senal, cierre, tVela, vol }) {
  const sid = puestoSombraId(mesa.id, simbolo);
  const q = ctx.vivo.precios[simbolo];
  if (!q || !(q.precio > 0)) return null;
  const dim = dimensionar({
    capitalMesa: capitalMesa(ctx, mesa, { sombra: true }), peso: senal.peso, precio: q.precio, stop: senal.stop, volAnual: vol,
    patrimonio: ctx.vivo.patrimonioSombra, limites: ctx.limites,
  });
  const propuesta = {
    puestoId: sid, mesaId: mesa.id, simbolo, clase: universo.esCripto(simbolo) ? 'cripto' : 'accion', lado: 'compra', tipo: 'apertura',
    nocional: dim.nocional, cantidad: dim.cantidad, precio: q.precio, precioT: q.t, stop: senal.stop, precioDecision: cierre,
  };
  const r = riesgos.evaluar(ctx, propuesta, { sombra: true });
  if (r.decision === 'vetar') return null;
  const fill = llenarSombra({ lado: 'compra', simbolo, precio: q.precio, nocional: r.nocional });
  if (ctx.estado.sombra.efectivo + fill.efectivoDelta < -1e-9) return null;   // sin margen, como el bróker
  ctx.libros.aplicarEjecucion({
    puestoId: sid, lado: 'compra', cantidad: fill.cantidad, precio: fill.precio, comision: fill.comision, t: ctx.reloj.ahora(), motivo: 'señal',
    idCliente: `sombra-${sid}-${isoCompacto(tVela)}-abrir`, stop: senal.stop, objetivoPrecio: senal.objetivoPrecio,
    regimen: ctx.estado.macro.regimen ? ctx.estado.macro.regimen.valor : null, precioReferencia: q.precio,
  });
  ctx.estado.sombra.efectivo += fill.efectivoDelta;
  ctx.revalorarSombra();
  return fill;
}

function cerrarSombra(ctx, { puestoId: sid, motivo = 'señal', clave }) {
  const p = ctx.libros.puesto(sid);
  if (!p || !(p.cantidad > EPS)) return null;
  const q = ctx.vivo.precios[p.simbolo];
  const precio = q && q.precio > 0 ? q.precio : p.ultimoPrecio;
  if (!(precio > 0)) return null;
  const fill = llenarSombra({ lado: 'venta', simbolo: p.simbolo, precio, cantidad: p.cantidad });
  const res = ctx.libros.aplicarEjecucion({
    puestoId: sid, lado: 'venta', cantidad: p.cantidad, precio: fill.precio, comision: fill.comision, t: ctx.reloj.ahora(), motivo,
    idCliente: `sombra-${sid}-${clave || isoCompacto(ctx.reloj.ahora())}-${motivo === 'stop' ? 'stop' : 'cerrar'}`, precioReferencia: precio,
  });
  ctx.estado.sombra.efectivo += fill.efectivoDelta;
  if (res.operacionCerrada) ctx.registrarOperacion(res.operacionCerrada);
  ctx.revalorarSombra();
  return fill;
}

// ---------- Vela nueva ----------

async function procesarMesa(ctx, mesa, ahora) {
  const est = FAMILIAS[mesa.familia];
  if (!est) return false;
  const e = ctx.estado;
  const marcoMs = MARCOS[mesa.marco];
  const ultima = e.ultimaVela[mesa.id];
  const cripto = mesa.universo.every(s => universo.esCripto(s));
  if (cripto) {
    // La vela que acaba de cerrar empieza un marco antes del inicio de la actual.
    if (ultima !== undefined && inicioVela(ahora, marcoMs) - marcoMs <= ultima) return false;
  } else {
    if (ahora - (e.comprobadoMesa[mesa.id] || 0) < COMPROBAR_ACCIONES) return false;
    e.comprobadoMesa[mesa.id] = ahora;
  }
  const velas = await cargarVelas(ctx, mesa, ahora);
  const simbolos = Object.keys(velas);
  if (!simbolos.length) return false;
  const tVela = Math.max(...simbolos.map(s => velas[s][velas[s].length - 1].t));
  if (ultima !== undefined && tVela <= ultima) return false;
  // Alpaca publica cada vela con algo de retraso y no todas a la vez: si falta
  // la de algún símbolo, se espera un poco (una decisión por puesto y vela, y
  // marcar la vela como vista dejaría sin decidir al que llegó tarde).
  if (cripto && simbolos.some(s => velas[s][velas[s].length - 1].t < tVela) && ahora - (tVela + marcoMs) < ESPERA_VELA) return false;
  e.ultimaVela[mesa.id] = tVela;

  const prep = est.preparar(velas, paramsDe(mesa));
  const tDecision = tVela + marcoMs;
  const n30 = Math.max(2, Math.round((30 * 86_400_000) / marcoMs));
  const aperturas = [];
  const cierres = [];
  const aperturasSombra = [];
  const cierresSombra = [];

  for (const simbolo of mesa.universo) {
    const serie = velas[simbolo];
    if (!serie || serie[serie.length - 1].t !== tVela) continue;
    const i = serie.length - 1;
    const cierre = serie[i].c;
    const vol = volatilidad(serie.map(v => v.c), n30, comunEst.periodosAnio([simbolo], mesa.marco))[i];
    const pid = puestoId(mesa.id, simbolo);
    const sid = puestoSombraId(mesa.id, simbolo);
    const aux = e.puestos[pid] || (e.puestos[pid] = { estadoTexto: '', ultimaSenal: null, chispa: [] });
    aux.chispa = serie.slice(-16).map(v => v.c);

    // Real
    const real = decidirPuesto(ctx, { mesa, est, prep, simbolo, i, tDecision, pid });
    aux.ultimaSenal = { accion: real.senal.accion, t: ahora };
    aux.estadoTexto = textoPuesto(ctx, mesa, simbolo, real.senal, real.p);
    const agente = agenteDePuesto(mesa.id, simbolo);
    const opera = mesa.estado !== 'banquillo' && e.fondo.nivel !== 'bloqueado';
    const accion = real.senal.accion;
    if (opera && accion === 'abrir' && !(real.p.cantidad > EPS)) {
      ctx.bus.publicar({ de: agente, canal: 'parque', tipo: 'senal', texto: plantillas.frase(real.senal.estado || real.senal.motivo), datos: { puestoId: pid, accion, motivo: real.senal.motivo, stop: real.senal.stop }, importancia: 2 });
      aperturas.push({ mesa, simbolo, senal: real.senal, cierre, tVela, vol });
    } else if (opera && accion === 'cerrar' && real.p.cantidad > EPS) {
      ctx.bus.publicar({ de: agente, canal: 'parque', tipo: 'senal', texto: plantillas.frase(real.senal.estado || real.senal.motivo), datos: { puestoId: pid, accion, motivo: real.senal.motivo }, importancia: 2 });
      cierres.push({ mesaId: mesa.id, simbolo, velaT: tVela });
    } else if (opera) {
      // Con el fondo bloqueado o la mesa en el banquillo el texto se actualiza
      // en su tarjeta, pero no se repite en el chat en cada vela.
      ctx.bus.publicar({ de: agente, canal: 'parque', tipo: 'estado', texto: aux.estadoTexto, datos: { puestoId: pid, accion } });
    }

    // Sombra: misma regla, su propia posición.
    const sombra = decidirPuesto(ctx, { mesa, est, prep, simbolo, i, tDecision, pid: sid });
    if (sombra.senal.accion === 'abrir' && !(sombra.p.cantidad > EPS)) aperturasSombra.push({ mesa, simbolo, senal: sombra.senal, cierre, tVela, vol });
    else if (sombra.senal.accion === 'cerrar' && sombra.p.cantidad > EPS) cierresSombra.push({ puestoId: sid, clave: isoCompacto(tVela) });
  }

  // Como el motor: primero se vende (libera efectivo y exposición) y luego se compra.
  for (const c of cierres) await proponerCierre(ctx, c);
  for (const a of aperturas) await proponerApertura(ctx, a);
  for (const c of cierresSombra) cerrarSombra(ctx, c);
  for (const a of aperturasSombra) abrirSombra(ctx, a);
  return true;
}

async function procesar(ctx) {
  const ahora = ctx.reloj.ahora();
  let n = 0;
  for (const mesa of [...ctx.estado.mesas]) {
    if (await procesarMesa(ctx, mesa, ahora)) n++;
  }
  return n;
}

module.exports = {
  procesar, procesarMesa, proponerApertura, proponerCierre, abrirSombra, cerrarSombra, capitalMesa, multiplicador, paramsDe, cargarVelas,
};
