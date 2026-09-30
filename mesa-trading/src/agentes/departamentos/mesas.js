'use strict';
// Mesas (§6.7): con cada vela nueva del marco de una mesa, cada operador
// decide su puesto con la estrategia (la misma función que el backtest), se
// dimensiona con dimensionar() y la propuesta pasa por Riesgos y el Ejecutor.
//
//   capital de mesa = patrimonio · peso
//   nocional = dimensionar(…).nocional · factor de tamaño
//   factor = (0,5 si DEFENSIVO) · multiplicador de la mesa · reducción del Megáfono · caída
//
// El factor va sobre el nocional FINAL de dimensionar(), después de todos sus
// topes: aplicado al capital, no llegaba cuando mandaba el riesgo por
// operación o el tope por activo (con DEFENSIVO, 7 de 33 compras salían a ×1).
// Lo aplica solo tamanoApertura(); Riesgos lo comprueba sin volver a multiplicar.
//
// En paralelo, el puesto sombra «sin comité» decide lo mismo con su propia
// posición y su propia cartera, sin bróker (se llena en los libros al precio
// actual con los costes del simulado). Sufre todo lo que no es el comité
// (§5.5): el nivel del fondo real, el kill, el Megáfono y las noticias graves;
// no le llegan el DEFENSIVO ni el SOLO_CERRAR del comité, sus multiplicadores
// por mesa ni sus vetos.
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
const limitesMod = require('../../riesgo/limites');
const { directivasVigentes } = require('../megafono');
const { valorEn, RETRASO_FG } = require('../../mercado/sentimiento');
const calendario = require('../../mercado/calendario');
const { inicioVela, MIN } = require('../../util/reloj');
const { EPS, etiqueta, puestoId, puestoSombraId, agenteDePuesto, precioDe, isoCompacto, llenarSombra, posicionDe } = require('./comun');
const f = require('../../util/formato');

const MARCOS = universo.MARCOS;
const COMPROBAR_ACCIONES = 15 * MIN;
const ESPERA_VELA = 10 * MIN;
// Modo DEFENSIVO del comité: posiciones nuevas a la mitad (§6.7).
const FACTOR_DEFENSIVO = limitesMod.FACTOR_DEFENSIVO;

function multiplicador(ctx, mesaId) {
  const m = ctx.estado.directivas.multiplicadores;
  return m && typeof m[mesaId] === 'number' ? m[mesaId] : 1;
}

// Recorte del tamaño de cada apertura nueva del fondo real, para la
// instantánea (§7, fondo.factorTamano): la misma función con la que
// tamanoApertura() lo aplica (limites.factorTamano), para que la interfaz no
// lo recalcule (y no diga ×0,5 cuando es ×0,25). El multiplicador por mesa
// del comité no entra: es de cada mesa (mesas[].multiplicador).
function factorTamano(ctx, ahora = ctx.reloj.ahora()) {
  const e = ctx.estado;
  const r = limitesMod.factorTamano({ directivas: directivasVigentes(e.directivas, ahora), multiplicadorCaida: e.fondo.multiplicadorCaida, ahora });
  return { total: r.total, comite: r.comite, megafono: r.megafono, caida: r.caida };
}

// Capital de la mesa: patrimonio · peso (el de la sombra con su patrimonio).
// Lo que decide el comité ya no va aquí sino en el factor (tamanoApertura).
function capitalMesa(ctx, mesa, { sombra = false } = {}) {
  const peso = mesa.peso || 0;
  return ((sombra ? ctx.vivo.patrimonioSombra : ctx.vivo.patrimonio) || 0) * peso;
}

// Tamaño de una apertura: dimensionar() con el capital de la mesa y, sobre su
// nocional final (el menor de todos sus topes), el factor de tamaño. Es el
// ÚNICO sitio que lo aplica; la propuesta lleva `factorTamano` y Riesgos lo
// comprueba sin volver a multiplicar (limites.js). El fondo real: modo
// DEFENSIVO × multiplicador de la mesa × Megáfono × su caída. La sombra «sin
// comité»: su contexto de Riesgos (directivas sin las del comité y la caída
// desde SU referencia), así que Megáfono y caída sí, comité no.
// Con paraProponer, una mesa a ×0 se dimensiona como si fuera ×1 para que sea
// Riesgos quien la vete con su motivo (el comité la dejó a ×0) en vez de una
// propuesta vacía sin explicación.
function tamanoApertura(ctx, mesa, { peso, precio, stop, volAnual }, { sombra = false, paraProponer = false } = {}) {
  const cr = riesgos.contexto(ctx, { sombra });
  const dim = dimensionar({
    capitalMesa: capitalMesa(ctx, mesa, { sombra }), peso, precio, stop, volAnual, patrimonio: cr.patrimonio, limites: ctx.limites,
  });
  const factor = limitesMod.factorTamano({ directivas: cr.directivas, multiplicadorCaida: cr.multiplicadorCaida, mesaId: mesa.id, ahora: cr.ahora });
  if (paraProponer && factor.mesa === 0) { factor.mesa = 1; factor.total = factor.comite * factor.megafono * factor.caida; }
  const nocional = dim.nocional * factor.total;
  return { nocional, cantidad: nocional / precio, limitadoPor: dim.limitadoPor, nocionalBase: dim.nocional, factor };
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

// Tarjeta del puesto (estadoTexto): si el fondo no deja abrir (kill, pausa,
// solo cerrar por la pérdida del día) o la mesa está en el banquillo, lo dice
// eso; si no, la espera de la estrategia (textoEstrategia).
function textoPuesto(ctx, mesa, simbolo, senal, pLibros) {
  return textoNivel(ctx, mesa, simbolo, pLibros) || textoEstrategia(ctx, mesa, simbolo, senal, pLibros);
}

// Lo que dice la tarjeta por el nivel del fondo o el banquillo, o null. Con
// posición, la pausa y el solo cerrar no tapan la posición (la instantánea la
// rehace con las cifras de ahora); el kill sí, como en cada vela bloqueada.
function textoNivel(ctx, mesa, simbolo, pLibros) {
  const nivel = ctx.estado.fondo.nivel;
  if (nivel === 'bloqueado') return 'Fondo bloqueado por el kill switch: no se opera hasta Reabrir.';
  if (mesa.estado === 'banquillo') {
    // Con peso 0 la sombra de la mesa dimensiona con 0 $: no abre nada; lo que
    // tuviera abierto en sombra solo se cierra por su regla.
    const ps = ctx.libros.puesto(puestoSombraId(mesa.id, simbolo));
    return ps && ps.cantidad > EPS
      ? `Mesa en el banquillo: no abre nada; solo termina en sombra lo que tenía abierto en ${etiqueta(simbolo)}.`
      : 'Mesa en el banquillo: no abre nada, ni real ni en sombra.';
  }
  if (pLibros && pLibros.cantidad > EPS) return null;
  if (nivel === 'pausado') return 'Fondo en pausa: no se abre nada hasta Reabrir.';
  if (nivel === 'solo_cerrar') return 'Solo cerrar hasta las 00:00 UTC por la pérdida del día: no se abre nada.';
  return null;
}

// La espera de la estrategia (o la posición, con sus cifras): lo que dice el
// operador en el chat con cada vela.
function textoEstrategia(ctx, mesa, simbolo, senal, pLibros) {
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

// Rehace en el acto la tarjeta de cada puesto con el nivel del fondo de ahora
// (tras Reabrir, Pausar, el kill o un cambio del vigilante). Si no, la de un
// puesto sin posición seguía con el nivel viejo hasta su vela siguiente: hasta
// 4 h en las mesas de 4H y 24 h en las de 1D. En nivel normal y sin posición
// vuelve a la espera de la estrategia en su última vela (aux.espera); si en
// esa vela tenía posición o iba a abrir, esa frase ya no vale y dice
// «Esperando señal». Sin ninguna vela todavía, la tarjeta queda vacía y la
// instantánea dice «Esperando la primera vela…».
function refrescarTextos(ctx) {
  const e = ctx.estado;
  let n = 0;
  for (const mesa of e.mesas) {
    for (const s of mesa.universo) {
      const pid = puestoId(mesa.id, s);
      const p = ctx.libros.puesto(pid);
      const nivel = textoNivel(ctx, mesa, s, p);
      let aux = e.puestos[pid];
      if (!aux) {
        if (!nivel) continue;
        aux = e.puestos[pid] = { estadoTexto: '', ultimaSenal: null, chispa: [] };
      }
      if (nivel) aux.estadoTexto = nivel;
      else if (!aux.ultimaSenal && !(p && p.cantidad > EPS)) aux.estadoTexto = '';
      else aux.estadoTexto = textoEstrategia(ctx, mesa, s, { estado: aux.espera || null }, p);
      n++;
    }
  }
  return n;
}

// Marca las velas que faltan desde la última decidida (desde…i), sube el
// trailing en cada una y decide el puesto (real o sombra) en la vela i.
function decidirPuesto(ctx, { mesa, est, prep, simbolo, i, desde = i, tDecision, pid, rebalanceoYa = false, precioAhora = null }) {
  const serie = prep.velas[simbolo];
  const d0 = Number.isInteger(desde) && desde >= 1 && desde <= i ? desde : i;
  // Rebalanceo pedido sobre una vela ya decidida: no se vuelve a marcar (las
  // velas abiertas y el trailing de esa vela ya se contaron).
  const marcarDesde = rebalanceoYa && desde > i ? i + 1 : d0;
  for (let j = marcarDesde; j <= i; j++) {
    ctx.libros.marcarVela(pid, serie[j].c);
    const p = ctx.libros.puesto(pid);
    if (!(p.cantidad > EPS)) continue;
    const nuevo = est.trailing(prep, { simbolo, i: j, posicion: posicionDe(p), params: prep.params });
    if (nuevo !== null && nuevo !== undefined && Number.isFinite(nuevo)) ctx.libros.fijarStop(pid, nuevo);
  }
  const p = ctx.libros.puesto(pid);
  const contexto = contextoEstrategia(ctx, mesa, tDecision);
  if (rebalanceoYa) { contexto.rebalanceoYa = true; contexto.precioAhora = precioAhora; }
  const senal = est.decidir(prep, { simbolo, i, iAnterior: d0 - 1, posicion: posicionDe(p), t: tDecision, contexto });
  return { senal, p };
}

// ---------- Real ----------

async function proponerApertura(ctx, { mesa, simbolo, senal, cierre, tVela, vol, rebalanceoPedido = false }) {
  const pid = puestoId(mesa.id, simbolo);
  const agente = agenteDePuesto(mesa.id, simbolo);
  const q = ctx.vivo.precios[simbolo];
  const precio = q ? q.precio : null;
  if (!(precio > 0)) {
    ctx.bus.publicar({ de: agente, canal: 'parque', tipo: 'estado', texto: `Sin precio de ${etiqueta(simbolo)}: no propongo nada.`, datos: { puestoId: pid } });
    return null;
  }
  const dim = tamanoApertura(ctx, mesa, { peso: senal.peso, precio, stop: senal.stop, volAnual: vol }, { paraProponer: true });
  const propuesta = {
    puestoId: pid, mesaId: mesa.id, simbolo, clase: universo.esCripto(simbolo) ? 'cripto' : 'accion', lado: 'compra', tipo: 'apertura',
    nocional: dim.nocional, cantidad: dim.cantidad, precio, precioT: q.t, stop: senal.stop, precioDecision: cierre, factorTamano: dim.factor.total,
  };
  ctx.bus.publicar({
    de: agente, canal: 'parque', tipo: 'propuesta',
    texto: plantillas.propuesta({ etiqueta: etiqueta(simbolo), lado: 'compra', nocional: dim.nocional, cantidad: dim.cantidad, precio, stop: senal.stop, factor: dim.factor }),
    datos: { ...propuesta, limitadoPor: dim.limitadoPor, nocionalBase: dim.nocionalBase, capitalMesa: capitalMesa(ctx, mesa), ...(rebalanceoPedido ? { rebalanceoPedido: true } : {}) }, importancia: 2,
  });
  // Acciones con la bolsa cerrada (§6.7): la decisión queda pendiente y Riesgos
  // la mira a la apertura + 5 min, con el precio de entonces (si se ha movido
  // más del 2 % desde la decisión, la veta). Mirarla ahora la vetaría siempre.
  // Salvo con el fondo parado (pausa, solo cerrar): entonces no se deja nada
  // en cola para después de Reabrir, igual que la sombra (abrirSombra), y
  // Riesgos la veta ya con su motivo.
  const cerrada = !universo.esCripto(simbolo) && !(ctx.vivo.mercadoAbierto && ctx.vivo.mercadoAbierto.accion);
  const r = cerrada && ctx.estado.fondo.nivel === 'normal' ? { decision: 'aprobar', nocional: dim.nocional } : riesgos.evaluar(ctx, propuesta);
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

// Tamaño de una apertura de acciones que esperaba a la bolsa, con el capital
// y el factor de ahora: el DEFENSIVO o el ×0,5 de los comités de la noche
// cuentan, y una mesa que pasó al banquillo ya no abre (null). Se vuelve a
// dimensionar (no se escala), porque el tope activo puede ser el del activo o
// el del riesgo. Una ×0 la sigue vetando Riesgos con su motivo.
// → { nocional, factorTamano } (factorTamano null si la orden no traía el
// peso de la señal: guardada antes, Riesgos le aplica el factor entero).
function redimensionarPendiente(ctx, o, precio, { sombra = false } = {}) {
  const mesa = ctx.mesaPorId(o.mesaId);
  if (!mesa || mesa.estado === 'banquillo') return null;
  if (!Number.isFinite(o.pesoSenal)) return { nocional: o.nocional, factorTamano: null };
  const t = tamanoApertura(ctx, mesa, { peso: o.pesoSenal, precio, stop: o.stop, volAnual: o.volAnual }, { sombra, paraProponer: !sombra });
  return { nocional: t.nocional, factorTamano: t.factor.total };
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
    factorTamano: Number.isFinite(o.factorTamano) ? o.factorTamano : undefined,
  };
  const r = riesgos.evaluar(ctx, propuesta, { sombra: true });
  if (r.decision === 'vetar') return null;
  const fill = llenarSombra({ lado: 'compra', simbolo: o.simbolo, precio: o.precio, nocional: r.nocional });
  if (ctx.estado.sombra.efectivo + fill.efectivoDelta < -1e-9) return null;   // sin margen, como el bróker
  const ap = ctx.libros.aplicarEjecucion({
    puestoId: sid, lado: 'compra', cantidad: fill.cantidad, precio: fill.precio, comision: fill.comision, t: ctx.reloj.ahora(), motivo: 'señal',
    idCliente: `sombra-${sid}-${isoCompacto(o.tVela)}-abrir`, stop: o.stop, objetivoPrecio: o.objetivoPrecio,
    regimen: o.regimen ?? null, precioReferencia: o.precio,
  });
  // Ya aplicada (la misma vela dos veces): ni posición ni dinero.
  if (ap && ap.duplicada) return null;
  ctx.estado.sombra.efectivo += fill.efectivoDelta;
  ctx.revalorarSombra();
  return fill;
}

// Con el fondo parado (bloqueado, pausa, solo cerrar) la sombra no decide
// aperturas, igual que el fondo (procesarMesa y proponerApertura): si no, una
// de ETF decidida con la bolsa cerrada se quedaba en su cola y se compraba al
// reabrir algo que el fondo nunca propuso.
function abrirSombra(ctx, { mesa, simbolo, senal, cierre, tVela, vol }) {
  if (ctx.estado.fondo.nivel !== 'normal') return null;
  const sid = puestoSombraId(mesa.id, simbolo);
  const q = ctx.vivo.precios[simbolo];
  if (!q || !(q.precio > 0)) return null;
  const dim = tamanoApertura(ctx, mesa, { peso: senal.peso, precio: q.precio, stop: senal.stop, volAnual: vol }, { sombra: true });
  const orden = {
    puestoId: sid, mesaId: mesa.id, simbolo, lado: 'compra', nocional: dim.nocional, factorTamano: dim.factor.total, stop: senal.stop, objetivoPrecio: senal.objetivoPrecio,
    precioDecision: cierre, tVela, regimen: ctx.estado.macro.regimen ? ctx.estado.macro.regimen.valor : null,
    pesoSenal: senal.peso, volAnual: Number.isFinite(vol) ? vol : null,
  };
  if (bolsaCerrada(ctx, simbolo)) { encolarSombra(ctx, orden); return null; }
  return llenarAperturaSombra(ctx, { ...orden, precio: q.precio, precioT: q.t });
}

function cerrarSombra(ctx, { puestoId: sid, motivo = 'señal', clave, precioEjecutado = null }) {
  const p = ctx.libros.puesto(sid);
  if (!p || !(p.cantidad > EPS)) return null;
  // Acciones con la bolsa cerrada: a la apertura, como la real (no al precio de la noche).
  if (!(precioEjecutado > 0) && bolsaCerrada(ctx, p.simbolo)) { encolarSombra(ctx, { puestoId: sid, mesaId: p.mesaId, simbolo: p.simbolo, lado: 'venta', motivo, clave: clave || null }); return null; }
  const q = ctx.vivo.precios[p.simbolo];
  const precio = q && q.precio > 0 ? q.precio : p.ultimoPrecio;
  if (!(precio > 0) && !(precioEjecutado > 0)) return null;
  const fill = llenarSombra({ lado: 'venta', simbolo: p.simbolo, precio, cantidad: p.cantidad, precioEjecutado });
  const sufijo = motivo === 'stop' || motivo === 'kill' ? motivo : 'cerrar';
  const res = ctx.libros.aplicarEjecucion({
    puestoId: sid, lado: 'venta', cantidad: p.cantidad, precio: fill.precio, comision: fill.comision, t: ctx.reloj.ahora(), motivo,
    idCliente: `sombra-${sid}-${clave || isoCompacto(ctx.reloj.ahora())}-${sufijo}`, precioReferencia: precio > 0 ? precio : fill.precio,
  });
  ctx.estado.sombra.efectivo += fill.efectivoDelta;
  if (res.operacionCerrada) ctx.registrarOperacion(res.operacionCerrada);
  ctx.revalorarSombra();
  return fill;
}

// Kill (§5.5): la sombra «sin comité» lo sufre como el fondo. Se cierra todo lo
// suyo en el mismo instante: al precio al que vendió el fondo cada símbolo
// (`preciosVenta`, el de la ejecución del kill, con su deslizamiento) y, si el
// fondo no lo tenía o no llegó a venderlo, al precio de ahora con los costes
// del simulado. Las acciones con la bolsa cerrada, a la apertura, como las
// reales. Las compras que esperaban a la apertura se descartan, como las del
// fondo (el kill vacía su cola). Después, con el fondo bloqueado, Riesgos le
// veta toda apertura hasta Reabrir (contexto de la sombra).
function killSombra(ctx, preciosVenta = {}) {
  vaciarAperturasSombra(ctx);
  const ahora = ctx.reloj.ahora();
  let n = 0;
  for (const p of ctx.libros.listaPuestos({ sombra: true })) {
    if (!(p.cantidad > EPS)) continue;
    const px = preciosVenta[p.simbolo];
    if (cerrarSombra(ctx, { puestoId: p.puestoId, motivo: 'kill', clave: isoCompacto(ahora), precioEjecutado: px > 0 ? px : null })) n++;
  }
  return n;
}

// Las compras que la sombra tiene en cola se descartan (sus ventas siguen).
function vaciarAperturasSombra(ctx) {
  const s = ctx.estado.sombra;
  if (!s || !Array.isArray(s.pendientes)) return 0;
  const antes = s.pendientes.length;
  s.pendientes = s.pendientes.filter(o => o.lado !== 'compra');
  return antes - s.pendientes.length;
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
    const t = redimensionarPendiente(ctx, o, q.precio, { sombra: true });
    if (!t || !(t.nocional > 0)) continue;
    if (llenarAperturaSombra(ctx, { ...o, nocional: t.nocional, factorTamano: t.factorTamano, precio: q.precio, precioT: q.t })) n++;
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
  // Rebalanceo pedido desde el panel (comando 'rebalancear'): se decide ya con
  // la última vela cerrada aunque ya estuviera decidida, y con el precio de
  // ahora (ver más abajo). Una sola vez: la marca se quita al acabar.
  let rebalanceoYa = Boolean(mesa.rebalanceoYa) && est.familia === 'momentum-rotacion';
  // Con el fondo parado o la mesa en el banquillo no se hace: se quita la
  // marca y se dice, para no gastarla en silencio con todo vetado.
  if (rebalanceoYa && (e.fondo.nivel !== 'normal' || mesa.estado === 'banquillo')) {
    delete mesa.rebalanceoYa;
    rebalanceoYa = false;
    ctx.bus.publicar({ de: 'cio', canal: 'parque', tipo: 'nota', importancia: 2, datos: { mesaId: mesa.id, nivel: e.fondo.nivel },
      texto: plantillas.frase(`${mesa.nombre}: el rebalanceo pedido no se hace, ${mesa.estado === 'banquillo' ? 'la mesa está en el banquillo' : 'el fondo no está en marcha normal'}. Vuelve a pedirlo tras Reabrir.`, 280) });
  }
  if (cripto) {
    // La vela que acaba de cerrar empieza un marco antes del inicio de la actual.
    if (!rebalanceoYa && ultima !== undefined && inicioVela(ahora, marcoMs) - marcoMs <= ultima) return false;
  } else {
    if (!rebalanceoYa && ahora - (e.comprobadoMesa[mesa.id] || 0) < COMPROBAR_ACCIONES) return false;
    e.comprobadoMesa[mesa.id] = ahora;
  }
  const velas = await cargarVelas(ctx, mesa, ahora);
  const simbolos = Object.keys(velas);
  if (!simbolos.length) return false;
  const tVela = Math.max(...simbolos.map(s => velas[s][velas[s].length - 1].t));
  if (!rebalanceoYa && ultima !== undefined && tVela <= ultima) return false;
  if (rebalanceoYa) {
    // Una sola vez por vela: si ya se rebalanceó con esta, no se repite (tras
    // un stop, volver a abrir sobre la misma vela duplicaría la sombra).
    if (mesa.rebalanceoVela !== undefined && tVela <= mesa.rebalanceoVela) {
      delete mesa.rebalanceoYa;
      ctx.bus.publicar({ de: 'cio', canal: 'parque', tipo: 'nota', importancia: 2, datos: { mesaId: mesa.id, tVela },
        texto: plantillas.frase(`${mesa.nombre}: ya se rebalanceó con la vela del ${f.fechaCorta(tVela)}; no se repite. El próximo, en su día.`, 280) });
      return false;
    }
    // Todas las de la mesa con la última vela y con precio de ahora: si falta
    // alguna, se espera (la marca sigue) en vez de decidir sin ella.
    const faltan = mesa.universo.filter(s => !velas[s] || velas[s][velas[s].length - 1].t !== tVela || (ultima !== undefined && tVela < ultima)
      || !(ctx.vivo.precios[s] && ctx.vivo.precios[s].precio > 0));
    if (faltan.length) {
      if (!mesa.rebalanceoYa.avisado) {
        mesa.rebalanceoYa.avisado = true;
        ctx.bus.publicar({ de: 'cio', canal: 'parque', tipo: 'nota', importancia: 1, datos: { mesaId: mesa.id, faltan },
          texto: plantillas.frase(`${mesa.nombre}: el rebalanceo pedido espera a tener la última vela y el precio de ${faltan.map(etiqueta).join(', ')}.`, 280) });
      }
      return false;
    }
  }
  // Alpaca publica cada vela con algo de retraso y no todas a la vez: si falta
  // la de algún símbolo, se espera un poco (una decisión por puesto y vela, y
  // marcar la vela como vista dejaría sin decidir al que llegó tarde).
  if (cripto && simbolos.some(s => velas[s][velas[s].length - 1].t < tVela) && ahora - (tVela + marcoMs) < ESPERA_VELA) return false;
  e.ultimaVela[mesa.id] = ultima !== undefined ? Math.max(ultima, tVela) : tVela;

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
    // Rebalanceo pedido sobre una vela ya decidida: nada que marcar.
    if (rebalanceoYa && ultima !== undefined && serie[i].t <= ultima) desde = i + 1;
    sinDecidir = Math.max(sinDecidir, Math.max(0, i - desde));
    // Con el rebalanceo pedido se decide AHORA: el precio de la decisión es el
    // de ahora (si no, el control de desvío lo vetaría al llevar horas desde el
    // cierre) y el stop se traslada para mantener su distancia (3×ATR).
    const qAhora = rebalanceoYa ? ctx.vivo.precios[simbolo] : null;
    const precioAhora = qAhora && qAhora.precio > 0 ? qAhora.precio : null;
    const cierre = precioAhora || serie[i].c;
    const vol = volatilidad(serie.map(v => v.c), n30, comunEst.periodosAnio([simbolo], mesa.marco))[i];
    const pid = puestoId(mesa.id, simbolo);
    const sid = puestoSombraId(mesa.id, simbolo);
    const aux = e.puestos[pid] || (e.puestos[pid] = { estadoTexto: '', ultimaSenal: null, chispa: [] });
    aux.chispa = serie.slice(-16).map(v => v.c);

    // Real
    const real = decidirPuesto(ctx, { mesa, est, prep, simbolo, i, desde, tDecision, pid, rebalanceoYa, precioAhora });
    aux.ultimaSenal = { accion: real.senal.accion, t: ahora };
    // La espera de la estrategia se guarda para rehacer la tarjeta si cambia el
    // nivel del fondo antes de la vela siguiente (refrescarTextos). Solo vale
    // sin posición y sin nada que hacer: «Abro…» o «Largo en…» caducan solos.
    aux.espera = !(real.p.cantidad > EPS) && real.senal.accion === 'nada' ? (real.senal.estado || null) : null;
    aux.estadoTexto = textoPuesto(ctx, mesa, simbolo, real.senal, real.p);
    const agente = agenteDePuesto(mesa.id, simbolo);
    const opera = mesa.estado !== 'banquillo' && e.fondo.nivel !== 'bloqueado';
    const accion = real.senal.accion;
    // Actividad del paso (§7): el operador decidió su puesto con esta vela; si
    // abre o cierra, lleva la propuesta al puesto de ejecución.
    const llevaOrden = opera && ((accion === 'abrir' && !(real.p.cantidad > EPS)) || (accion === 'cerrar' && real.p.cantidad > EPS));
    if (typeof ctx.anotarActividad === 'function') {
      ctx.anotarActividad({ agente, accion: 'senal', objetivo: llevaOrden ? 'ejecucion' : 'monitor', detalle: llevaOrden ? accion : 'sin cambio', puestoId: pid });
    }
    if (opera && accion === 'abrir' && !(real.p.cantidad > EPS)) {
      ctx.bus.publicar({ de: agente, canal: 'parque', tipo: 'senal', texto: plantillas.frase(real.senal.estado || real.senal.motivo), datos: { puestoId: pid, accion, motivo: real.senal.motivo, stop: real.senal.stop }, importancia: 2 });
      aperturas.push({ mesa, simbolo, senal: real.senal, cierre, tVela, vol });
    } else if (opera && accion === 'cerrar' && real.p.cantidad > EPS) {
      ctx.bus.publicar({ de: agente, canal: 'parque', tipo: 'senal', texto: plantillas.frase(real.senal.estado || real.senal.motivo), datos: { puestoId: pid, accion, motivo: real.senal.motivo }, importancia: 2 });
      cierres.push({ mesaId: mesa.id, simbolo, velaT: tVela });
    } else if (opera) {
      // Con el fondo bloqueado o la mesa en el banquillo el texto se actualiza
      // en su tarjeta, pero no se repite en el chat en cada vela. En el chat,
      // la espera de la estrategia (la pausa ya la dicen la píldora y la tarjeta).
      ctx.bus.publicar({ de: agente, canal: 'parque', tipo: 'estado', texto: textoEstrategia(ctx, mesa, simbolo, real.senal, real.p), datos: { puestoId: pid, accion } });
    }

    // Sombra: misma regla, su propia posición. Con el fondo parado no decide
    // aperturas (abrirSombra), como el fondo.
    const sombra = decidirPuesto(ctx, { mesa, est, prep, simbolo, i, desde, tDecision, pid: sid, rebalanceoYa, precioAhora });
    if (sombra.senal.accion === 'abrir' && !(sombra.p.cantidad > EPS) && e.fondo.nivel === 'normal') aperturasSombra.push({ mesa, simbolo, senal: sombra.senal, cierre, tVela, vol });
    else if (sombra.senal.accion === 'cerrar' && sombra.p.cantidad > EPS) cierresSombra.push({ puestoId: sid, clave: isoCompacto(tVela) });
  }

  if (sinDecidir > 0) {
    ctx.bus.publicar({
      de: 'cio', canal: 'parque', tipo: 'nota',
      texto: plantillas.frase(`${mesa.nombre}: ${sinDecidir} ${sinDecidir === 1 ? 'vela' : 'velas'} ${mesa.marco === '1Day' ? 'diarias' : 'de 4H'} sin decidir por el ordenador apagado; se marcan y se decide con la última.`),
      datos: { mesaId: mesa.id, sinDecidir, tVela },
    });
  }

  // Rebalanceo pedido: la marca se quita ANTES de mandar órdenes (si el
  // latido muere después, el siguiente no lo repite: resuelve lo pendiente por
  // ordenes.jsonl como cualquier orden) y se apunta la vela usada.
  const antesRebalanceo = rebalanceoYa ? new Set(mesa.universo.filter(s => { const p = ctx.libros.puesto(puestoId(mesa.id, s)); return p && p.cantidad > EPS; })) : null;
  const pedido = rebalanceoYa ? mesa.rebalanceoYa : null;
  if (rebalanceoYa) { delete mesa.rebalanceoYa; mesa.rebalanceoVela = tVela; }

  // Como el motor: primero se vende (libera efectivo y exposición) y luego se compra.
  for (const c of cierres) await proponerCierre(ctx, c);
  for (const a of aperturas) await proponerApertura(ctx, { ...a, rebalanceoPedido: rebalanceoYa });
  for (const c of cierresSombra) cerrarSombra(ctx, c);
  for (const a of aperturasSombra) abrirSombra(ctx, a);

  if (rebalanceoYa) {
    // Lo que de verdad quedó en los libros, no lo decidido (Riesgos puede vetar).
    const ahoraDentro = new Set(mesa.universo.filter(s => { const p = ctx.libros.puesto(puestoId(mesa.id, s)); return p && p.cantidad > EPS; }));
    const entran = [...ahoraDentro].filter(s => !antesRebalanceo.has(s));
    const salen = [...antesRebalanceo].filter(s => !ahoraDentro.has(s));
    const mov = s => {
      const serie = velas[s]; const q = ctx.vivo.precios[s];
      return serie && q && q.precio > 0 ? q.precio / serie[serie.length - 1].c - 1 : null;
    };
    const conMov = s => { const m = mov(s); return m === null ? etiqueta(s) : `${etiqueta(s)} (${f.pct(m, { signo: true, decimales: 1 })} desde el cierre)`; };
    const texto = `${mesa.nombre}: rebalanceo pedido hecho ya, al precio de ahora. `
      + (entran.length ? `Entran ${entran.map(conMov).join(' y ')}.` : 'No entra ninguna.')
      + (salen.length ? ` Salen ${salen.map(etiqueta).join(' y ')}.` : '');
    ctx.bus.publicar({
      de: 'cio', canal: 'parque', tipo: 'nota', importancia: 2,
      texto: plantillas.frase(texto, 280),
      datos: { mesaId: mesa.id, tVela, entran, salen, decididas: aperturas.map(a => a.simbolo), movimientos: Object.fromEntries(mesa.universo.map(s => [s, mov(s)])), pedido },
    });
  }
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
  procesar, procesarMesa, proponerApertura, proponerCierre, abrirSombra, cerrarSombra, killSombra, vaciarAperturasSombra, procesarPendientesSombra, redimensionarPendiente,
  capitalMesa, tamanoApertura, multiplicador, factorTamano, FACTOR_DEFENSIVO, paramsDe, cargarVelas, desdeCalentamiento, contextoEstrategia, textoPuesto, textoNivel, textoEstrategia, refrescarTextos,
};
