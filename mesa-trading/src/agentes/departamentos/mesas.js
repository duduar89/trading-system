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
//
// Con el ordenador apagado o dormido las velas intermedias no se decidieron:
// al volver se marcan (barras abiertas, trailing del stop) una a una y la
// decisión recibe iAnterior (la última vela decidida), para que un cruce o un
// rebalanceo que cayó en medio no se pierda.
//
// Acciones con la bolsa cerrada: la real espera a la apertura + 5 min en la
// cola del Ejecutor y el sombra en la suya (estado.sombra.pendientes), y los
// dos se vuelven a dimensionar con el capital de ese momento. Si no, Riesgos
// vetaría siempre el sombra por «mercado cerrado» y la sombra «sin comité» no
// tendría nunca ETF mientras el fondo sí.

const { FAMILIAS, velasNecesarias } = require('../../estrategias');
const comunEst = require('../../estrategias/comun');
const { volatilidad } = require('../../mercado/indicadores');
const { dimensionar } = require('../../cuant/dimensionado');
const universo = require('../../mercado/universo');
const plantillas = require('../plantillas');
const riesgos = require('./riesgos');
const { valorEn, RETRASO_FG } = require('../../mercado/sentimiento');
const calendario = require('../../mercado/calendario');
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

// Desde dónde hay que pedir velas para que la decisión (o el backtest de
// referencia) de la vela de `hasta` tenga todo su calentamiento, filtros
// incluidos. Acciones: una vela por sesión; 1,6 días por vela cubre fines de
// semana y festivos.
function desdeCalentamiento(mesa, hasta) {
  const marcoMs = MARCOS[mesa.marco];
  const cripto = mesa.universo.every(s => universo.esCripto(s));
  const n = velasNecesarias(mesa) + 5;
  return hasta - Math.ceil((n + 2) * marcoMs * (cripto ? 1 : 1.6));
}

async function cargarVelas(ctx, mesa, ahora) {
  const desde = desdeCalentamiento(mesa, ahora);
  const velas = {};
  for (const s of mesa.universo) {
    if (!ctx.datos.disponible(s)) continue;
    const v = await ctx.datos.velas(s, mesa.marco, { desde, hasta: ahora });
    if (v.length) velas[s] = v;
  }
  return velas;
}

// Miedo y codicia vigente en t: el del día de t − RETRASO_FG (a las 00:00 el
// de ayer, desde la 01:00 el de hoy), la misma regla que el backtest. Macro
// guarda los últimos días en fgDias; sin ellos, el último valor leído.
function contextoEstrategia(ctx, mesa, t = ctx.reloj.ahora()) {
  const m = ctx.estado.macro;
  let fg = m.fg ? m.fg.valor : null;
  if (Array.isArray(m.fgDias) && m.fgDias.length) {
    const v = valorEn(m.fgDias, t - RETRASO_FG);
    fg = v ? v.valor : null;
  }
  return { regimen: m.regimen ? m.regimen.valor : null, fg, filtros: mesa.filtros || [] };
}

function textoPuesto(ctx, mesa, simbolo, senal, pLibros) {
  if (ctx.estado.fondo.nivel === 'bloqueado') return 'Fondo bloqueado por el kill switch: no se opera hasta Reabrir.';
  if (mesa.estado === 'banquillo') {
    // Con peso 0 la sombra de la mesa dimensiona con 0 $: no abre nada; lo que
    // tuviera abierto en sombra solo se cierra por su regla.
    const ps = ctx.libros.puesto(puestoSombraId(mesa.id, simbolo));
    return ps && ps.cantidad > EPS
      ? `Mesa en el banquillo: no abre nada; solo termina en sombra lo que tenía abierto en ${etiqueta(simbolo)}.`
      : 'Mesa en el banquillo: no abre nada, ni real ni en sombra.';
  }
  const pos = pLibros && pLibros.cantidad > EPS ? pLibros : null;
  // El % abierto es el de la tabla del puesto (neto de la comisión de entrada).
  const vp = ctx.vivo.valoracion && ctx.vivo.valoracion.porPuesto ? ctx.vivo.valoracion.porPuesto[puestoId(mesa.id, simbolo)] : null;
  const px = precioDe(ctx.vivo.precios, simbolo);
  const pct = vp && vp.cantidad > EPS && Number.isFinite(vp.pnlAbiertoPct) ? vp.pnlAbiertoPct : (pos && px && pos.costeMedio > 0 ? px / pos.costeMedio - 1 : null);
  return plantillas.estadoPuesto({
    etiqueta: etiqueta(simbolo), marco: mesa.marco,
    posicion: pos ? { cantidad: pos.cantidad, entrada: pos.costeMedio, stop: pos.stop, pnlAbiertoPct: pct } : null,
    estadoEstrategia: senal ? senal.estado : null,
  });
}

// Marca las velas que faltan desde la última decidida (desde…i), sube el
// trailing en cada una y decide el puesto (real o sombra) en la vela i.
function decidirPuesto(ctx, { mesa, est, prep, simbolo, i, desde = i, tDecision, pid }) {
  const serie = prep.velas[simbolo];
  const d0 = Number.isInteger(desde) && desde >= 1 && desde <= i ? desde : i;
  for (let j = d0; j <= i; j++) {
    ctx.libros.marcarVela(pid, serie[j].c);
    const p = ctx.libros.puesto(pid);
    if (!(p.cantidad > EPS)) continue;
    const nuevo = est.trailing(prep, { simbolo, i: j, posicion: posicionDe(p), params: prep.params });
    if (nuevo !== null && nuevo !== undefined && Number.isFinite(nuevo)) ctx.libros.fijarStop(pid, nuevo);
  }
  const p = ctx.libros.puesto(pid);
  const senal = est.decidir(prep, { simbolo, i, iAnterior: d0 - 1, posicion: posicionDe(p), t: tDecision, contexto: contextoEstrategia(ctx, mesa, tDecision) });
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
  // pesoSenal y volAnual viajan con la orden: una apertura que espera a la
  // bolsa se vuelve a dimensionar a la apertura con el capital de entonces
  // (el comité de la noche puede haberla dejado a la mitad o a ×0).
  const res = await ctx.ejecutor.ejecutar({
    puestoId: pid, mesaId: mesa.id, simbolo, lado: 'compra', nocional: r.nocional, tipo: 'apertura', motivo: 'señal', accion: 'abrir',
    velaT: tVela, stop: senal.stop, objetivoPrecio: senal.objetivoPrecio, regimen: ctx.estado.macro.regimen ? ctx.estado.macro.regimen.valor : null,
    precioReferencia: precio, pesoSenal: senal.peso, volAnual: Number.isFinite(vol) ? vol : null,
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

// Nocional de una apertura de acciones que esperaba a la bolsa, con el capital
// de ahora: el DEFENSIVO o el ×0,5 de los comités de la noche cuentan, y una
// mesa que pasó al banquillo ya no abre (null). Se vuelve a dimensionar (no se
// escala), porque el tope activo puede ser el del activo o el del riesgo. Con
// paraProponer, un ×0 lo sigue vetando Riesgos con su motivo.
function redimensionarPendiente(ctx, o, precio, { sombra = false } = {}) {
  const mesa = ctx.mesaPorId(o.mesaId);
  if (!mesa || mesa.estado === 'banquillo') return null;
  if (!Number.isFinite(o.pesoSenal)) return o.nocional;           // guardada antes de llevar el peso
  const patrimonio = sombra ? ctx.vivo.patrimonioSombra : ctx.vivo.patrimonio;
  return dimensionar({
    capitalMesa: capitalMesa(ctx, mesa, sombra ? { sombra: true } : { paraProponer: true }), peso: o.pesoSenal, precio,
    stop: o.stop, volAnual: o.volAnual, patrimonio, limites: ctx.limites,
  }).nocional;
}

// ---------- Sombra «sin comité» ----------

const bolsaCerrada = (ctx, simbolo) => !universo.esCripto(simbolo) && !(ctx.vivo.mercadoAbierto && ctx.vivo.mercadoAbierto.accion);

function proximaApertura(ctx, ahora) {
  if (ctx.ejecutor && typeof ctx.ejecutor._proximaApertura === 'function') return ctx.ejecutor._proximaApertura(ahora);
  const rm = ctx.vivo.relojMercado;
  if (rm && rm.proximaApertura > ahora) return rm.proximaApertura;
  return calendario.proximaApertura(ahora);
}

// Cola del sombra para las acciones con la bolsa cerrada: una por puesto y lado.
function encolarSombra(ctx, o) {
  const s = ctx.estado.sombra;
  const lista = s.pendientes || (s.pendientes = []);
  if (lista.some(x => x.puestoId === o.puestoId && x.lado === o.lado)) return { pendiente: true, repetida: true };
  const ahora = ctx.reloj.ahora();
  lista.push({ ...o, enviarDesde: proximaApertura(ctx, ahora) + 5 * MIN, encolada: ahora });
  return { pendiente: true };
}

// Riesgos (sin comité) y llenado de una apertura del sombra al precio de
// ahora; la usan la decisión y la cola de la bolsa. `o.precioDecision` es el
// cierre de la vela decidida (el desvío > 2 % la veta, como a la real).
function llenarAperturaSombra(ctx, o) {
  const sid = o.puestoId;
  const propuesta = {
    puestoId: sid, mesaId: o.mesaId, simbolo: o.simbolo, clase: universo.esCripto(o.simbolo) ? 'cripto' : 'accion', lado: 'compra', tipo: 'apertura',
    nocional: o.nocional, cantidad: o.precio > 0 ? o.nocional / o.precio : 0, precio: o.precio, precioT: o.precioT, stop: o.stop, precioDecision: o.precioDecision,
  };
  const r = riesgos.evaluar(ctx, propuesta, { sombra: true });
  if (r.decision === 'vetar') return null;
  const fill = llenarSombra({ lado: 'compra', simbolo: o.simbolo, precio: o.precio, nocional: r.nocional });
  if (ctx.estado.sombra.efectivo + fill.efectivoDelta < -1e-9) return null;   // sin margen, como el bróker
  ctx.libros.aplicarEjecucion({
    puestoId: sid, lado: 'compra', cantidad: fill.cantidad, precio: fill.precio, comision: fill.comision, t: ctx.reloj.ahora(), motivo: 'señal',
    idCliente: `sombra-${sid}-${isoCompacto(o.tVela)}-abrir`, stop: o.stop, objetivoPrecio: o.objetivoPrecio,
    regimen: o.regimen ?? null, precioReferencia: o.precio,
  });
  ctx.estado.sombra.efectivo += fill.efectivoDelta;
  ctx.revalorarSombra();
  return fill;
}

function abrirSombra(ctx, { mesa, simbolo, senal, cierre, tVela, vol }) {
  const sid = puestoSombraId(mesa.id, simbolo);
  const q = ctx.vivo.precios[simbolo];
  if (!q || !(q.precio > 0)) return null;
  const dim = dimensionar({
    capitalMesa: capitalMesa(ctx, mesa, { sombra: true }), peso: senal.peso, precio: q.precio, stop: senal.stop, volAnual: vol,
    patrimonio: ctx.vivo.patrimonioSombra, limites: ctx.limites,
  });
  const orden = {
    puestoId: sid, mesaId: mesa.id, simbolo, lado: 'compra', nocional: dim.nocional, stop: senal.stop, objetivoPrecio: senal.objetivoPrecio,
    precioDecision: cierre, tVela, regimen: ctx.estado.macro.regimen ? ctx.estado.macro.regimen.valor : null,
    pesoSenal: senal.peso, volAnual: Number.isFinite(vol) ? vol : null,
  };
  if (bolsaCerrada(ctx, simbolo)) { encolarSombra(ctx, orden); return null; }
  return llenarAperturaSombra(ctx, { ...orden, precio: q.precio, precioT: q.t });
}

function cerrarSombra(ctx, { puestoId: sid, motivo = 'señal', clave }) {
  const p = ctx.libros.puesto(sid);
  if (!p || !(p.cantidad > EPS)) return null;
  // Acciones con la bolsa cerrada: a la apertura, como la real (no al precio de la noche).
  if (bolsaCerrada(ctx, p.simbolo)) { encolarSombra(ctx, { puestoId: sid, mesaId: p.mesaId, simbolo: p.simbolo, lado: 'venta', motivo, clave: clave || null }); return null; }
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

// Cola del sombra a la apertura + 5 min: primero las ventas (liberan efectivo)
// y después las compras, redimensionadas con el capital del sombra de ahora y
// evaluadas con el precio de ahora (el mismo desvío del 2 % que la real).
function procesarPendientesSombra(ctx) {
  const s = ctx.estado.sombra;
  const lista = (s && s.pendientes) || [];
  if (!lista.length || !(ctx.vivo.mercadoAbierto && ctx.vivo.mercadoAbierto.accion)) return 0;
  const ahora = ctx.reloj.ahora();
  const listas = lista.filter(o => ahora >= o.enviarDesde);
  if (!listas.length) return 0;
  s.pendientes = lista.filter(o => ahora < o.enviarDesde);
  let n = 0;
  for (const o of listas.filter(x => x.lado === 'venta')) {
    if (cerrarSombra(ctx, { puestoId: o.puestoId, motivo: o.motivo || 'señal', clave: o.clave || null })) n++;
  }
  for (const o of listas.filter(x => x.lado === 'compra')) {
    const p = ctx.libros.puesto(o.puestoId);
    if (p && p.cantidad > EPS) continue;
    const q = ctx.vivo.precios[o.simbolo];
    if (!q || !(q.precio > 0)) continue;
    const nocional = redimensionarPendiente(ctx, o, q.precio, { sombra: true });
    if (!(nocional > 0)) continue;
    if (llenarAperturaSombra(ctx, { ...o, nocional, precio: q.precio, precioT: q.t })) n++;
  }
  return n;
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

  let sinDecidir = 0;
  for (const simbolo of mesa.universo) {
    const serie = velas[simbolo];
    if (!serie || serie[serie.length - 1].t !== tVela) continue;
    const i = serie.length - 1;
    // Primera vela aún sin decidir (ordenador apagado o dormido: puede haber varias).
    let desde = i;
    if (ultima !== undefined) while (desde > 1 && serie[desde - 1].t > ultima) desde--;
    sinDecidir = Math.max(sinDecidir, i - desde);
    const cierre = serie[i].c;
    const vol = volatilidad(serie.map(v => v.c), n30, comunEst.periodosAnio([simbolo], mesa.marco))[i];
    const pid = puestoId(mesa.id, simbolo);
    const sid = puestoSombraId(mesa.id, simbolo);
    const aux = e.puestos[pid] || (e.puestos[pid] = { estadoTexto: '', ultimaSenal: null, chispa: [] });
    aux.chispa = serie.slice(-16).map(v => v.c);

    // Real
    const real = decidirPuesto(ctx, { mesa, est, prep, simbolo, i, desde, tDecision, pid });
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
    const sombra = decidirPuesto(ctx, { mesa, est, prep, simbolo, i, desde, tDecision, pid: sid });
    if (sombra.senal.accion === 'abrir' && !(sombra.p.cantidad > EPS)) aperturasSombra.push({ mesa, simbolo, senal: sombra.senal, cierre, tVela, vol });
    else if (sombra.senal.accion === 'cerrar' && sombra.p.cantidad > EPS) cierresSombra.push({ puestoId: sid, clave: isoCompacto(tVela) });
  }

  if (sinDecidir > 0) {
    ctx.bus.publicar({
      de: 'cio', canal: 'parque', tipo: 'nota',
      texto: plantillas.frase(`${mesa.nombre}: ${sinDecidir} ${sinDecidir === 1 ? 'vela' : 'velas'} ${mesa.marco === '1Day' ? 'diarias' : 'de 4H'} sin decidir por el ordenador apagado; se marcan y se decide con la última.`),
      datos: { mesaId: mesa.id, sinDecidir, tVela },
    });
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
  procesar, procesarMesa, proponerApertura, proponerCierre, abrirSombra, cerrarSombra, procesarPendientesSombra, redimensionarPendiente,
  capitalMesa, multiplicador, paramsDe, cargarVelas, desdeCalentamiento, contextoEstrategia, textoPuesto,
};
