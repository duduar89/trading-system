'use strict';
// Operaciones (§6.7, §6.9, §6.10): el Ejecutor y el Controller.
//
// Ejecutor: cada orden deja primero su INTENCIÓN en ordenes.jsonl (con todo
// lo necesario para rehacerla), luego se envía, se espera la ejecución y se
// aplica a los libros. Órdenes del mismo símbolo en serie (anti-lavado, ficha
// §0.6); ventas = min(puesto, disponible en el bróker); acciones con la bolsa
// cerrada esperan a la apertura + 5 min. Al arrancar, lo que quedó en
// INTENCIÓN/ENVIADA se consulta por idCliente antes de nada: nunca se
// reenvía a ciegas.
//
// Controller: conciliación en cada latido (escala lo que es comisión, avisa
// de lo grave y, con 3 graves seguidas, pausa), cierre diario (curvas, sombras,
// métricas), informes diario y semanal y el kill switch.

const path = require('path');
const universo = require('../../mercado/universo');
const calendario = require('../../mercado/calendario');
const { conciliar } = require('../../cartera/conciliacion');
const { valorarBenchmarks } = require('../../cartera/benchmarks');
const { metricasMesa, sharpeRodante, alarmaDeriva } = require('../../aprendizaje/evaluador');
const plantillas = require('../plantillas');
const { anadirJSONL, leerJSONL } = require('../../util/almacen');
const { redondearAbajo } = require('../../util/numeros');
const { diaUTC, MIN, DIA } = require('../../util/reloj');
const f = require('../../util/formato');
const log = require('../../util/log').crear('operaciones');
const { EPS, etiqueta, isoCompacto } = require('./comun');

const ESTADOS_FINALES = new Set(['ejecutada', 'cancelada', 'rechazada', 'caducada']);
const POLVO_USD = 0.01;           // lo que queda tras cerrar y vale menos de un céntimo es redondeo
const GRAVES_PARA_PAUSAR = 3;

class Ejecutor {
  constructor(ctx) {
    this.ctx = ctx;
    this.colas = new Map();         // simbolo → promesa de la última orden
    this.activos = new Map();       // simbolo → activo() del bróker (incrementos)
    this.usados = new Set();        // idCliente ya usados (no se repiten nunca)
    this.ruta = path.join(ctx.carpeta, 'ordenes.jsonl');
    for (const r of leerJSONL(this.ruta)) if (r && r.idCliente) this.usados.add(r.idCliente);
  }

  _registrar(reg) {
    try { anadirJSONL(this.ruta, { t: this.ctx.reloj.ahora(), ...reg }); } catch (e) { log.error(`no se pudo apuntar la orden: ${e.message}`); }
  }

  // mt-<mesaId>-<CLAVE>-<vela ISO compacta>-<accion>-<n> (§6.7), ≤ 128.
  idCliente({ mesaId, simbolo, velaT, accion }) {
    const base = `mt-${mesaId}-${universo.clave(simbolo)}-${isoCompacto(velaT)}-${accion}`;
    let n = 1;
    while (this.usados.has(`${base}-${n}`)) n++;
    const id = `${base}-${n}`.slice(0, 128);
    this.usados.add(id);
    return id;
  }

  async _incremento(simbolo) {
    if (!this.activos.has(simbolo)) {
      try { this.activos.set(simbolo, await this.ctx.broker.activo(simbolo)); } catch (_) { this.activos.set(simbolo, null); }
    }
    const a = this.activos.get(simbolo);
    return a && a.incremento > 0 ? a.incremento : 1e-9;
  }

  // Cola por símbolo: la orden siguiente espera a que acabe la anterior.
  ejecutar(orden) {
    const previa = this.colas.get(orden.simbolo) || Promise.resolve();
    const p = previa.catch(() => {}).then(() => this._ejecutar(orden));
    this.colas.set(orden.simbolo, p.catch(() => {}));
    return p;
  }

  _proximaApertura(ahora) {
    const rm = this.ctx.vivo.relojMercado;
    if (rm && rm.proximaApertura > ahora) return rm.proximaApertura;
    return calendario.proximaApertura(ahora);
  }

  async _ejecutar(orden) {
    const ctx = this.ctx;
    const ahora = ctx.reloj.ahora();
    const e = etiqueta(orden.simbolo);

    // Acciones con la bolsa cerrada: la decisión espera a la apertura + 5 min.
    if (!universo.esCripto(orden.simbolo) && !(ctx.vivo.mercadoAbierto && ctx.vivo.mercadoAbierto.accion)) {
      // Una sola pendiente por puesto y lado: un stop saltado de noche no se encola en cada latido.
      if (ctx.estado.pendientes.some(p => p.puestoId === orden.puestoId && p.lado === orden.lado)) return { ok: false, pendiente: true, repetida: true };
      const enviarDesde = this._proximaApertura(ahora) + 5 * MIN;
      ctx.estado.pendientes.push({ ...orden, enviarDesde, encolada: ahora });
      ctx.bus.publicar({
        de: 'ejecutor', canal: 'ejecucion', tipo: 'nota',
        texto: plantillas.frase(`Bolsa cerrada: la orden de ${orden.lado === 'compra' ? 'compra' : 'venta'} de ${e} espera a la apertura (${f.hora(enviarDesde)}).`),
        datos: { puestoId: orden.puestoId, simbolo: orden.simbolo, enviarDesde },
      });
      return { ok: false, pendiente: true };
    }

    // Serie por símbolo también entre latidos: si la anterior sigue sin estado
    // final en el bróker, no se manda otra encima (salvo el kill, que cancela antes).
    if (orden.tipo !== 'kill' && Object.values(ctx.estado.ordenesEnVuelo).some(o => o.simbolo === orden.simbolo)) {
      ctx.bus.publicar({
        de: 'ejecutor', canal: 'ejecucion', tipo: 'alerta',
        texto: plantillas.frase(`No envío la orden de ${e}: la anterior de ${e} sigue sin ejecutarse en el bróker.`),
        datos: { puestoId: orden.puestoId, simbolo: orden.simbolo }, importancia: 2,
      });
      return { ok: false, motivo: 'orden_en_vuelo' };
    }

    let cantidad = orden.cantidad ?? null;
    if (orden.lado === 'venta') {
      const posiciones = await ctx.broker.posiciones();
      const pos = posiciones.find(p => p.simbolo === orden.simbolo);
      const disponible = pos ? Number(pos.disponible ?? pos.cantidad) : 0;
      cantidad = redondearAbajo(Math.min(Number(orden.cantidad) || 0, disponible), await this._incremento(orden.simbolo));
      // Cierre total del único puesto del símbolo: se vende justo lo que dice
      // el bróker, para no dejar en él un resto de redondeo sin dueño.
      const propios = new Set([orden.puestoId, ...(orden.reparto || []).map(r => r.puestoId)]);
      const otros = ctx.libros.listaPuestos({ sombra: false })
        .filter(p => p.simbolo === orden.simbolo && !propios.has(p.puestoId))
        .reduce((s, p) => s + p.cantidad, 0);
      const precio = ctx.vivo.precios[orden.simbolo] ? ctx.vivo.precios[orden.simbolo].precio : 0;
      if (orden.cierraTodo && otros * precio < POLVO_USD && disponible > 0 && Math.abs(disponible - (Number(orden.cantidad) || 0)) * precio < POLVO_USD) {
        cantidad = disponible;
      }
      if (!(cantidad > 0)) {
        ctx.bus.publicar({
          de: 'ejecutor', canal: 'ejecucion', tipo: 'alerta',
          texto: plantillas.frase(`No hay ${e} disponible en el bróker para vender (libros ${f.cantidad(orden.cantidad, 9)}, bróker ${f.cantidad(disponible, 9)}).`),
          datos: { puestoId: orden.puestoId, simbolo: orden.simbolo }, importancia: 3,
        });
        return { ok: false, motivo: 'sin_disponible' };
      }
    }

    const idCliente = this.idCliente({ mesaId: orden.mesaId, simbolo: orden.simbolo, velaT: orden.velaT ?? ahora, accion: orden.accion || orden.tipo });
    const envio = orden.lado === 'compra' && cantidad === null
      ? { idCliente, simbolo: orden.simbolo, lado: 'compra', nocional: Math.floor(orden.nocional * 100) / 100 }
      : { idCliente, simbolo: orden.simbolo, lado: orden.lado, cantidad };
    const registro = { ...orden, cantidad: envio.cantidad ?? null, nocional: envio.nocional ?? null, idCliente };
    this._registrar({ estado: 'INTENCION', ...registro });
    ctx.bus.publicar({
      de: 'ejecutor', canal: 'ejecucion', tipo: 'orden',
      texto: envio.nocional !== undefined
        ? plantillas.frase(`Orden a mercado: comprar ${f.usd(envio.nocional)} de ${e}.`)
        : plantillas.frase(`Orden a mercado: vender ${f.cantidad(envio.cantidad, 8)} ${e}${orden.tipo === 'stop' ? ' (stop)' : orden.tipo === 'kill' ? ' (kill switch)' : ''}.`),
      datos: { puestoId: orden.puestoId, idCliente, simbolo: orden.simbolo, lado: orden.lado, tipo: orden.tipo, nocional: envio.nocional ?? null, cantidad: envio.cantidad ?? null },
      importancia: 2,
    });

    if (orden.mesaId !== 'sombra') (ctx.registroOrdenes || (ctx.registroOrdenes = [])).push({ t: ahora, mesaId: orden.mesaId });
    let enviada;
    try {
      enviada = await ctx.broker.enviarOrden(envio);
    } catch (err) {
      this._registrar({ estado: 'ERROR', idCliente, tipoError: err.tipo || 'desconocido', mensaje: String(err.message).slice(0, 300) });
      ctx.bus.publicar({
        de: 'ejecutor', canal: 'ejecucion', tipo: 'alerta',
        texto: plantillas.frase(`El bróker rechazó la orden de ${e} (${err.tipo || 'error'}): ${String(err.message).slice(0, 80)}`),
        datos: { puestoId: orden.puestoId, idCliente, tipoError: err.tipo || null }, importancia: 3,
      });
      return { ok: false, motivo: 'rechazo', error: err };
    }
    this._registrar({ estado: 'ENVIADA', idCliente, id: enviada && enviada.id });
    ctx.estado.ordenesEnVuelo[idCliente] = { ...registro, enviadaT: ahora };
    return this._resolver(idCliente, enviada);
  }

  // Espera (o consulta) el estado final de una orden en vuelo y la aplica.
  async _resolver(idCliente, ultima = null) {
    const ctx = this.ctx;
    const registro = ctx.estado.ordenesEnVuelo[idCliente];
    if (!registro) return { ok: false, motivo: 'desconocida' };
    let orden = ultima;
    try {
      if (!orden || !ESTADOS_FINALES.has(orden.estado)) orden = await ctx.broker.esperarEjecucion(idCliente, { timeoutMs: 20_000 });
    } catch (err) {
      log.aviso(`no se pudo saber el estado de ${idCliente}: ${err.message}`);
      return { ok: false, motivo: 'sin_estado' };
    }
    if (!orden || !ESTADOS_FINALES.has(orden.estado)) return { ok: false, motivo: 'en_vuelo' };
    delete ctx.estado.ordenesEnVuelo[idCliente];
    this._registrar({ estado: orden.estado.toUpperCase(), idCliente, cantidadEjecutada: orden.cantidadEjecutada, precioMedio: orden.precioMedio, comision: orden.comision ?? null });
    if (!(orden.cantidadEjecutada > 0) || !(orden.precioMedio > 0)) {
      ctx.bus.publicar({
        de: 'ejecutor', canal: 'ejecucion', tipo: 'alerta',
        texto: plantillas.frase(`La orden de ${etiqueta(registro.simbolo)} terminó ${orden.estado} sin ejecutarse.`),
        datos: { puestoId: registro.puestoId, idCliente, estado: orden.estado }, importancia: 2,
      });
      return { ok: false, motivo: orden.estado };
    }
    return { ok: true, ...this._aplicar(registro, orden) };
  }

  // Aplica una ejecución a los libros. Un kill reparte una sola venta entre
  // los puestos del símbolo, a prorrata, con el mismo idCliente (libros lo admite).
  _aplicar(registro, orden) {
    const ctx = this.ctx;
    const t = orden.actualizada ?? ctx.reloj.ahora();
    const precio = orden.precioMedio;
    const cantidad = orden.cantidadEjecutada;
    const comision = Number.isFinite(orden.comision) ? orden.comision : null;
    const cerradas = [];
    const reparto = Array.isArray(registro.reparto) && registro.reparto.length
      ? registro.reparto
      : [{ puestoId: registro.puestoId, cantidad: registro.cantidadPuesto ?? cantidad }];
    const total = reparto.reduce((s, x) => s + (x.cantidad || 0), 0) || cantidad;
    let aplicadas = 0;
    let duplicadas = 0;
    for (const r of reparto) {
      const p = ctx.libros.puesto(r.puestoId);
      if (!p) continue;
      const fraccion = reparto.length === 1 ? 1 : (r.cantidad || 0) / total;
      let q = cantidad * fraccion;
      // Cierre total: el resto de redondeo (menos de un céntimo) no deja un puesto «abierto» con polvo.
      if (registro.lado === 'venta' && registro.cierraTodo && Math.abs(p.cantidad - q) * precio < POLVO_USD) q = p.cantidad;
      if (!(q > 0)) continue;
      const res = ctx.libros.aplicarEjecucion({
        puestoId: r.puestoId, lado: registro.lado, cantidad: q, precio,
        comision: comision === null ? null : comision * fraccion, t, motivo: registro.motivo, idCliente: registro.idCliente,
        stop: registro.stop, objetivoPrecio: registro.objetivoPrecio, regimen: registro.regimen, precioReferencia: registro.precioReferencia,
      });
      if (res.duplicada) { duplicadas++; continue; }
      aplicadas++;
      if (res.operacionCerrada) cerradas.push(res.operacionCerrada);
    }
    // Ya estaba en los libros (se re-aplica tras un reinicio): nada que contar.
    if (!aplicadas && duplicadas) return { cantidad, precio, comision, operaciones: [], duplicada: true };
    const ej = {
      t, puestoId: registro.puestoId, simbolo: registro.simbolo, etiqueta: etiqueta(registro.simbolo), lado: registro.lado,
      cantidad, precio, nocional: cantidad * precio, comision, motivo: registro.motivo,
    };
    ctx.registrarEjecucion(ej);
    ctx.bus.publicar({
      de: 'ejecutor', canal: 'ejecucion', tipo: 'ejecucion',
      texto: plantillas.ejecucion({ etiqueta: ej.etiqueta, lado: ej.lado, cantidad, precio, nocional: registro.lado === 'compra' ? registro.nocional : ej.nocional, comision }),
      datos: { puestoId: registro.puestoId, idCliente: registro.idCliente, simbolo: registro.simbolo, lado: registro.lado, cantidad, precio, comision, motivo: registro.motivo },
    });
    for (const op of cerradas) ctx.registrarOperacion(op);
    return { cantidad, precio, comision, operaciones: cerradas };
  }

  // Órdenes de acciones que esperaban a la bolsa: a la apertura + 5 min se
  // vuelven a pasar por Riesgos (el precio ya no es el de la decisión).
  async procesarPendientes(evaluar) {
    const ctx = this.ctx;
    const ahora = ctx.reloj.ahora();
    const lista = ctx.estado.pendientes;
    if (!lista.length || !(ctx.vivo.mercadoAbierto && ctx.vivo.mercadoAbierto.accion)) return 0;
    const listas = lista.filter(o => ahora >= o.enviarDesde);
    ctx.estado.pendientes = lista.filter(o => ahora < o.enviarDesde);
    let n = 0;
    for (const o of listas) {
      const ok = await evaluar(o);
      if (ok) { await this.ejecutar(ok); n++; }
    }
    return n;
  }

  // Al arrancar (y en cada latido para las que quedaron sin estado final):
  // se consulta por idCliente. Si el bróker no la conoce, no llegó a enviarse:
  // se abandona (la decisión ya es vieja) y se dice.
  async resolverAlArrancar() {
    const ctx = this.ctx;
    const ultimos = new Map();
    for (const r of leerJSONL(this.ruta)) if (r && r.idCliente) ultimos.set(r.idCliente, { ...(ultimos.get(r.idCliente) || {}), ...r, estado: r.estado });
    let resueltas = 0;
    const guardado = ctx.estado.guardado || 0;
    for (const [idCliente, r] of ultimos) {
      // «>=»: en sintético varias cosas pasan en el mismo instante; los libros descartan lo repetido.
      if (r.estado === 'EJECUTADA' && r.t >= guardado && r.lado && r.cantidadEjecutada > 0) {
        // Ejecutada después del último estado.json (corte entre ambas cosas):
        // se vuelve a aplicar; los libros descartan lo que ya tenían.
        const res = this._aplicar(r, { cantidadEjecutada: r.cantidadEjecutada, precioMedio: r.precioMedio, comision: r.comision, actualizada: r.t });
        if (!res.duplicada) resueltas++;
        continue;
      }
      if (r.estado !== 'INTENCION' && r.estado !== 'ENVIADA') continue;
      if (!ctx.estado.ordenesEnVuelo[idCliente]) ctx.estado.ordenesEnVuelo[idCliente] = { ...r };
    }
    for (const idCliente of Object.keys(ctx.estado.ordenesEnVuelo)) {
      let orden = null;
      try { orden = await ctx.broker.ordenPorIdCliente(idCliente); } catch (e) { log.aviso(`consulta de ${idCliente}: ${e.message}`); continue; }
      if (!orden) {
        const reg = ctx.estado.ordenesEnVuelo[idCliente];
        delete ctx.estado.ordenesEnVuelo[idCliente];
        this._registrar({ estado: 'ABANDONADA', idCliente });
        ctx.bus.publicar({
          de: 'ejecutor', canal: 'ejecucion', tipo: 'alerta',
          texto: plantillas.frase(`Orden ${idCliente} sin rastro en el bróker tras el reinicio: no se envió y no se repite.`),
          datos: { idCliente, puestoId: reg && reg.puestoId }, importancia: 2,
        });
        continue;
      }
      const r = await this._resolver(idCliente, orden);
      if (r.ok) resueltas++;
    }
    return resueltas;
  }

  async resolverEnVuelo() {
    let n = 0;
    for (const idCliente of Object.keys(this.ctx.estado.ordenesEnVuelo)) {
      const r = await this._resolver(idCliente);
      if (r.ok) n++;
    }
    return n;
  }
}

// ---------- Controller ----------

// Conciliación en cada latido (§5.2 con las acciones del contrato).
function conciliarCadaLatido(ctx) {
  const ahora = ctx.reloj.ahora();
  // Con órdenes en vuelo el bróker y los libros no pueden cuadrar todavía: se
  // espera a que terminen (si no, un descuadre transitorio acabaría en pausa).
  if (Object.keys(ctx.estado.ordenesEnVuelo).length) {
    return { acciones: [], grave: false, limpia: ctx.estado.conciliacion.limpia, descuadres: [], resumen: 'Conciliación aplazada: hay órdenes en vuelo.', aplazada: true };
  }
  const r = conciliar({ posicionesBroker: ctx.vivo.posicionesBroker || [], libros: ctx.libros, tolerancia: 0.01, precios: ctx.vivo.precios });
  const c = ctx.estado.conciliacion;
  const escalados = r.acciones.filter(a => a.tipo === 'escalar');
  for (const a of escalados) ctx.libros.escalarSimbolo(a.simbolo, a.factor, 'conciliación');
  if (escalados.length) {
    ctx.bus.publicar({ de: 'controller', canal: 'riesgo', tipo: 'nota', texto: plantillas.conciliacion({ acciones: escalados, grave: false }), datos: { acciones: escalados } });
  }
  c.gravesSeguidas = r.grave ? (c.gravesSeguidas || 0) + 1 : 0;
  const incidencias = r.acciones.filter(a => a.tipo !== 'escalar');
  const clave = r.limpia ? 'limpia' : JSON.stringify([r.grave, incidencias.map(a => [a.tipo, a.simbolo]), (r.descuadres || []).map(d => d.simbolo)]);
  if (!r.limpia && clave !== c.clave) {
    ctx.bus.publicar({ de: 'controller', canal: 'riesgo', tipo: 'alerta', texto: plantillas.frase(r.resumen, 280), datos: { acciones: incidencias, descuadres: r.descuadres, grave: r.grave }, importancia: 3 });
  } else if (r.limpia && c.clave && c.clave !== 'limpia') {
    ctx.bus.publicar({ de: 'controller', canal: 'riesgo', tipo: 'nota', texto: 'Conciliación limpia otra vez: los libros cuadran con el bróker.' });
  }
  c.clave = clave;
  c.limpia = r.limpia;
  c.grave = r.grave;
  c.resumen = r.resumen;
  c.t = ahora;
  const f0 = ctx.estado.fondo;
  if (c.gravesSeguidas >= GRAVES_PARA_PAUSAR && (f0.nivel === 'normal' || f0.nivel === 'solo_cerrar')) {
    f0.nivel = 'pausado';
    f0.motivo = `${c.gravesSeguidas} conciliaciones graves seguidas: pausa hasta que un humano revise y pulse Reabrir.`;
    ctx.bus.publicar({ de: 'controller', canal: 'riesgo', tipo: 'alerta', texto: plantillas.frase(f0.motivo), importancia: 3 });
  }
  return r;
}

// Valor de una mesa para su curva: capital asignado (con los flujos de las
// reasignaciones) + lo realizado y lo abierto de sus puestos reales.
function valorMesa(ctx, mesa) {
  const val = ctx.vivo.valoracion && ctx.vivo.valoracion.porMesa[mesa.id];
  const pnl = val ? val.realizado + val.pnlAbierto : 0;
  return mesa.capitalBase + pnl;
}

function pnlMesaTotal(ctx, mesaId) {
  const val = ctx.vivo.valoracion && ctx.vivo.valoracion.porMesa[mesaId];
  return val ? val.realizado + val.pnlAbierto : 0;
}

function anotarCurva(lista, punto, max = 3650) {
  const ultimo = lista[lista.length - 1];
  if (ultimo && ultimo.dia === punto.dia) lista[lista.length - 1] = { ...ultimo, ...punto };
  else lista.push(punto);
  if (lista.length > max) lista.splice(0, lista.length - max);
}

// Cierre diario (00:05 UTC): curvas del día que acaba, métricas de mesa,
// nuevo día de P&L e informe. Devuelve las operaciones del día (para el Auditor).
function cierreDiario(ctx) {
  const ahora = ctx.reloj.ahora();
  const e = ctx.estado;
  const dia = diaUTC(ahora - 10 * MIN);           // el día que acaba de terminar
  const patrimonio = ctx.vivo.patrimonio;

  anotarCurva(e.curvaDiaria, { dia, valor: patrimonio });
  for (const b of valorarBenchmarks(e.sombras.benchmarks, ctx.vivo.precios)) {
    if (b.valor === null) continue;
    anotarCurva(e.sombras.curvas[b.id] || (e.sombras.curvas[b.id] = []), { dia, valor: b.valor });
  }
  anotarCurva(e.sombras.curvas['sin-comite'] || (e.sombras.curvas['sin-comite'] = []), { dia, valor: ctx.vivo.patrimonioSombra });

  for (const mesa of e.mesas) {
    const punto = { dia, valor: valorMesa(ctx, mesa) };
    if (mesa.flujoPendiente) { punto.flujo = mesa.flujoPendiente; mesa.flujoPendiente = 0; }
    anotarCurva(mesa.curvaDiaria, punto);
    mesa.metricas = metricasMesa({
      operaciones: ctx.operaciones.filter(o => o.mesaId === mesa.id),
      curvaDiaria: mesa.curvaDiaria,
      penalizacionPapel: ctx.limites.penalizacionPapel,
      diasActiva: Math.max(0, Math.floor((ahora - mesa.fechaAlta) / DIA)),
    });
  }

  // P&L del día que acaba y arranque del nuevo.
  const pnlDia = patrimonio - e.patrimonioInicioDia;
  const pnlDiaPct = e.patrimonioInicioDia > 0 ? pnlDia / e.patrimonioInicioDia : null;
  const opsDia = ctx.operaciones.filter(o => o.salidaT !== null && diaUTC(o.salidaT) === dia && o.motivoSalida !== 'prueba');
  const ganadoras = opsDia.filter(o => o.pnl > 0).length;
  e.patrimonioInicioDia = patrimonio;
  e.diaInicio = diaUTC(ahora);
  e.inicioDiaPuestos = {};
  for (const [pid, v] of Object.entries(ctx.vivo.valoracion ? ctx.vivo.valoracion.porPuesto : {})) e.inicioDiaPuestos[pid] = v.realizado + v.pnlAbierto;

  const informe = {
    dia, patrimonio, pnlDia, pnlDiaPct, operaciones: opsDia.length,
    acierto: opsDia.length ? ganadoras / opsDia.length : null, gastoLLMUsd: ctx.llm ? ctx.llm.gastoHoy() : 0,
  };
  const texto = plantillas.informeDiario(informe);
  ctx.bus.publicar({ de: 'controller', canal: 'direccion', tipo: 'informe', texto, datos: informe, importancia: 2 });
  anadirJSONL(path.join(ctx.carpeta, 'informes.jsonl'), { t: ahora, tipo: 'diario', texto, ...informe });
  return opsDia;
}

function sharpes90(ctx) {
  const s = ctx.estado.sombras.curvas;
  return {
    sharpe90Fondo: sharpeRodante(ctx.estado.curvaDiaria, 90),
    sharpe90SinComite: sharpeRodante(s['sin-comite'] || [], 90),
    sharpe90Btc: sharpeRodante(s.btc || [], 90),
  };
}

// Informe semanal (lunes 00:10): rentabilidad de la semana y Sharpe 90 d del
// fondo contra sus sombras; alarma de deriva de cada mesa contra su backtest.
function informeSemanal(ctx) {
  const ahora = ctx.reloj.ahora();
  const curva = ctx.estado.curvaDiaria;
  const hace7 = curva.length > 7 ? curva[curva.length - 8].valor : ctx.estado.capitalInicial;
  const rentabilidad = hace7 > 0 ? ctx.vivo.patrimonio / hace7 - 1 : null;
  const datos = { rentabilidad, ...sharpes90(ctx) };
  const texto = plantillas.informeSemanal(datos);
  ctx.bus.publicar({ de: 'controller', canal: 'direccion', tipo: 'informe', texto, datos, importancia: 2 });
  anadirJSONL(path.join(ctx.carpeta, 'informes.jsonl'), { t: ahora, tipo: 'semanal', texto, ...datos });
  for (const mesa of ctx.estado.mesas) {
    if (mesa.estado === 'banquillo' || !mesa.backtest) continue;
    const c = mesa.curvaDiaria;
    const retornos = [];
    for (let i = 1; i < c.length; i++) if (c[i - 1].valor > 0) retornos.push((c[i].valor - (c[i].flujo || 0)) / c[i - 1].valor - 1);
    const d = alarmaDeriva({ retornosPapel: retornos, muBacktest: mesa.backtest.mu, sigmaBacktest: mesa.backtest.sigma });
    if (d.alarma) {
      ctx.bus.publicar({
        de: 'controller', canal: 'direccion', tipo: 'alerta',
        texto: plantillas.frase(`Deriva en ${mesa.nombre}: los últimos ${d.n} días van ${f.numero(Math.abs(d.z), 2)} σ por debajo de su backtest.`),
        datos: { mesaId: mesa.id, z: d.z, n: d.n }, importancia: 2,
      });
    }
  }
  return datos;
}

// Kill switch (§7): cancela todo, vende todo lo que hay en el bróker
// repartiendo cada venta entre los puestos del símbolo, barre lo que quede
// con cerrarTodo() y deja el fondo bloqueado. Los puestos sombra no se tocan:
// son una cartera hipotética.
async function killSwitch(ctx, motivo) {
  const e = ctx.estado;
  e.fondo.nivel = 'bloqueado';
  e.fondo.motivo = motivo;
  e.fondo.soloCerrarHasta = null;
  // La plantilla ya pone el punto: el motivo del vigilante trae el suyo.
  ctx.bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'alerta', texto: plantillas.killSwitch({ motivo: String(motivo || '').replace(/[.\s]+$/, '') }), datos: { motivo }, importancia: 3 });
  for (const a of ctx.plantilla) ctx.moverAgente(a.id, null, 'de_pie');
  e.pendientes = [];
  try { await ctx.broker.cancelarTodas(); } catch (err) { log.aviso(`cancelarTodas: ${err.message}`); }
  // Lo cancelado (o ejecutado a medias) entra en los libros antes de vender.
  try { await ctx.ejecutor.resolverEnVuelo(); } catch (err) { log.aviso(`órdenes en vuelo: ${err.message}`); }
  const ahora = ctx.reloj.ahora();
  const cerradas = [];
  const errores = [];
  const posiciones = await ctx.broker.posiciones();
  for (const pos of posiciones) {
    const reparto = ctx.libros.listaPuestos({ sombra: false })
      .filter(p => p.simbolo === pos.simbolo && p.cantidad > EPS)
      .map(p => ({ puestoId: p.puestoId, cantidad: p.cantidad }));
    const r = await ctx.ejecutor.ejecutar({
      puestoId: reparto.length ? reparto[0].puestoId : null, mesaId: 'fondo', simbolo: pos.simbolo, lado: 'venta',
      cantidad: Number(pos.disponible ?? pos.cantidad), tipo: 'kill', motivo: 'kill', accion: 'kill', velaT: ahora, reparto, cierraTodo: true,
    });
    if (r && r.ok) cerradas.push(pos.simbolo); else errores.push({ simbolo: pos.simbolo, motivo: r && r.motivo });
  }
  // Barrido final por si algo no pasó por la cola (acciones con la bolsa cerrada quedan en errores).
  try {
    const barrido = await ctx.broker.cerrarTodo();
    for (const x of barrido.errores || []) errores.push(x);
  } catch (err) { errores.push({ simbolo: null, motivo: err.message }); }
  await ctx.refrescarCartera();
  const abiertos = ctx.libros.listaPuestos({ sombra: false }).filter(p => p.cantidad > EPS);
  if (abiertos.length || errores.length) {
    ctx.bus.publicar({
      de: 'riesgos', canal: 'riesgo', tipo: 'alerta',
      texto: plantillas.frase(`Tras el kill quedan ${abiertos.length} puestos abiertos y ${errores.length} errores: revisar a mano.`),
      datos: { abiertos: abiertos.map(p => p.puestoId), errores }, importancia: 3,
    });
  }
  return { cerradas, errores, abiertos: abiertos.map(p => p.puestoId) };
}

module.exports = {
  Ejecutor, conciliarCadaLatido, cierreDiario, informeSemanal, killSwitch, valorMesa, pnlMesaTotal, sharpes90, anotarCurva, GRAVES_PARA_PAUSAR,
};
