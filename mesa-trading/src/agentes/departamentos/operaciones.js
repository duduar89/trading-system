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
// - Antes de vender se concilia ESE símbolo con la regla de la conciliación:
//   con Alpaca la comisión de compra se cobra en el activo y, si la venta llega
//   antes que la conciliación del latido (un stop, un kill, la prueba), vender
//   lo disponible dejaría en los libros un resto fantasma que ya no se cierra.
// - Un error de red al enviar NO es un rechazo: la orden pudo entrar. Queda en
//   vuelo como DESCONOCIDA y se consulta por idCliente antes de mandar nada más
//   de ese símbolo (si no, la mesa volvería a comprar).
// - Una orden en vuelo se consulta primero por idCliente: si el bróker no la
//   conoce (404), no llegó y se abandona; si lleva 60 s sin terminar (cripto
//   gtc llenada a medias fuera del collar), se cancela lo que falta.
//
// Controller: conciliación en cada latido (escala lo que es comisión, avisa
// de lo grave y, con 3 graves seguidas, pausa), cierre diario (curvas, sombras,
// métricas), informes diario y semanal y el kill switch (con reintento si no
// consigue vender todo).

const path = require('path');
const universo = require('../../mercado/universo');
const calendario = require('../../mercado/calendario');
const { conciliar, factorEscalado } = require('../../cartera/conciliacion');
const { valorarBenchmarks } = require('../../cartera/benchmarks');
const { metricasMesa, sharpeRodante, alarmaDeriva } = require('../../aprendizaje/evaluador');
const plantillas = require('../plantillas');
const { anadirJSONL, leerJSONL } = require('../../util/almacen');
const { redondearAbajo } = require('../../util/numeros');
const { diaUTC, inicioVela, MIN, HORA, DIA } = require('../../util/reloj');
const f = require('../../util/formato');
const log = require('../../util/log').crear('operaciones');
const { EPS, etiqueta, isoCompacto } = require('./comun');

const ESTADOS_FINALES = new Set(['ejecutada', 'cancelada', 'rechazada', 'caducada']);
const POLVO_USD = 0.01;           // lo que queda tras cerrar y vale menos de un céntimo es redondeo
const GRAVES_PARA_PAUSAR = 3;
// Una orden a mercado que lleva un minuto sin terminar es una decisión vieja:
// se cancela lo que falta (lo ejecutado se apunta y el resto se decide de nuevo).
const CANCELAR_TRAS = 60_000;
// Tras un kill, lo que el bróker aún tenga por encima de esto se vuelve a
// intentar vender (por debajo es polvo que ni se puede vender).
const MIN_REINTENTO_USD = 1;
// Espera entre reintentos del kill: 1, 2, 4, 8 y luego cada 10 min.
const esperaReintento = n => Math.min(10 * MIN, MIN * 2 ** Math.max(0, n));
// El cierre de las 00:05 que llega más tarde que esto (portátil apagado o
// dormido) arranca el día nuevo desde el último patrimonio visto antes de las 00:00.
const CIERRE_TARDE = 15 * MIN;
// Contraste de la comisión estimada de Alpaca con la real (CFEE).
const DESVIO_COMISION = 0.05;
const DIAS_COMISIONES = 10;

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

  // mt-<sal>-<mesaId>-<CLAVE>-<vela ISO compacta>-<accion>-<n>, ≤ 128. La sal
  // es propia de cada carpeta de datos (el instante en que se creó su
  // estado.json, en base 36): el contador n solo conoce el ordenes.jsonl de su
  // carpeta, y otra carpeta sobre la misma cuenta paper repetiría el id de una
  // orden vieja (Alpaca devolvería la vieja como si fuera la nueva).
  _sal() {
    const c = this.ctx.estado && this.ctx.estado.creado;
    return Number.isFinite(c) ? Math.floor(c / 1000).toString(36) : null;
  }

  idCliente({ mesaId, simbolo, velaT, accion }) {
    const sal = this._sal();
    const base = `mt-${sal ? `${sal}-` : ''}${mesaId}-${universo.clave(simbolo)}-${isoCompacto(velaT)}-${accion}`;
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
      const precio = ctx.vivo.precios[orden.simbolo] ? ctx.vivo.precios[orden.simbolo].precio : 0;
      const factor = this._conciliarAntesDeVender(orden.simbolo, pos);
      // Cierre total de todos los puestos del símbolo: se vende lo que haya en
      // los libros (ya conciliados) o lo que pide la orden (el kill pide todo lo
      // del bróker, huérfanas incluidas), lo mayor; y si es justo lo que dice el
      // bróker, exactamente eso, para no dejar un resto de redondeo sin dueño.
      const propios = new Set([orden.puestoId, ...(orden.reparto || []).map(r => r.puestoId)]);
      let otros = 0;
      let deLibros = 0;
      for (const p of ctx.libros.listaPuestos({ sombra: false })) {
        if (p.simbolo !== orden.simbolo) continue;
        if (propios.has(p.puestoId)) deLibros += p.cantidad; else otros += p.cantidad;
      }
      // Sin precio no se puede decir que un resto es polvo: solo cuenta el cero.
      const esPolvo = q => (precio > 0 ? Math.abs(q) * precio < POLVO_USD : Math.abs(q) <= EPS);
      const cubreTodo = Boolean(orden.cierraTodo) && esPolvo(otros);
      // Venta de un solo puesto entre varios: su cantidad salió de los libros
      // antes de conciliar, así que se escala igual (no se lleva lo de otra mesa).
      const pedida = cubreTodo ? Math.max(Number(orden.cantidad) || 0, deLibros) : (Number(orden.cantidad) || 0) * (factor || 1);
      cantidad = redondearAbajo(Math.min(pedida, disponible), await this._incremento(orden.simbolo));
      if (cubreTodo && disponible > 0 && esPolvo(disponible - pedida)) cantidad = disponible;
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
      const mensaje = String(err && err.message).slice(0, 300);
      if (esIncierto(err)) {
        // Sin respuesta (red, timeout, 5xx): la orden pudo entrar. No es un
        // rechazo: queda en vuelo, bloquea otras de este símbolo y aplaza la
        // conciliación hasta saber por su idCliente si existe.
        this._registrar({ estado: 'DESCONOCIDA', idCliente, tipoError: err.tipo || 'desconocido', mensaje });
        ctx.estado.ordenesEnVuelo[idCliente] = { ...registro, enviadaT: ahora, incierta: true };
        ctx.bus.publicar({
          de: 'ejecutor', canal: 'ejecucion', tipo: 'alerta',
          texto: plantillas.frase(`Sin respuesta del bróker con la orden de ${e}: no sé si entró. La compruebo por su idCliente antes de mandar nada más de ${e}.`),
          datos: { puestoId: orden.puestoId, idCliente, tipoError: err.tipo || null }, importancia: 3,
        });
        return { ok: false, motivo: 'incierta', error: err };
      }
      this._registrar({ estado: 'ERROR', idCliente, tipoError: err.tipo || 'desconocido', mensaje });
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

  // Concilia un símbolo justo antes de venderlo, con la misma regla que la
  // conciliación de cada latido (factorEscalado): si libros y bróker difieren
  // en menos de la tolerancia, es comisión cobrada en el activo o redondeo y se
  // escala. No se toca si hay otra orden en vuelo del símbolo (el descuadre
  // sería transitorio).
  _conciliarAntesDeVender(simbolo, pos) {
    const ctx = this.ctx;
    if (!pos) return null;
    if (Object.values(ctx.estado.ordenesEnVuelo).some(o => o.simbolo === simbolo)) return null;
    const qL = ctx.libros.totalesPorSimbolo({ sombra: false })[simbolo] || 0;
    const factor = factorEscalado(qL, Number(pos.cantidad));
    if (factor === null) return null;
    ctx.libros.escalarSimbolo(simbolo, factor, 'conciliación antes de vender');
    ctx.bus.publicar({
      de: 'controller', canal: 'riesgo', tipo: 'nota',
      texto: plantillas.conciliacion({ acciones: [{ tipo: 'escalar', simbolo, factor }], grave: false }),
      datos: { acciones: [{ tipo: 'escalar', simbolo, factor }], antesDeVender: true },
    });
    return factor;
  }

  // Una orden que el bróker no conoce (404 con la red funcionando) no llegó:
  // se abandona, sin repetirla (la decisión ya es vieja).
  _abandonar(idCliente) {
    const ctx = this.ctx;
    const reg = ctx.estado.ordenesEnVuelo[idCliente];
    delete ctx.estado.ordenesEnVuelo[idCliente];
    this._registrar({ estado: 'ABANDONADA', idCliente });
    // Un 404 de una orden que el bróker había aceptado es anómalo; el de una
    // que se quedó sin respuesta o en INTENCIÓN, no.
    const aceptada = Boolean(reg) && !reg.incierta && (reg.enviadaT !== undefined || reg.estado === 'ENVIADA');
    ctx.bus.publicar({
      de: 'ejecutor', canal: 'ejecucion', tipo: 'alerta',
      texto: plantillas.frase(`Orden ${idCliente} sin rastro en el bróker: no se envió y no se repite.`),
      datos: { idCliente, puestoId: reg && reg.puestoId }, importancia: aceptada ? 3 : 2,
    });
  }

  // Espera (o consulta) el estado final de una orden en vuelo y la aplica.
  // Sin la orden en la mano, primero se pregunta por su idCliente: null (404)
  // → nunca llegó y se abandona; si la consulta falla, sigue en vuelo hasta
  // el latido siguiente.
  async _resolver(idCliente, ultima = null) {
    const ctx = this.ctx;
    const registro = ctx.estado.ordenesEnVuelo[idCliente];
    if (!registro) return { ok: false, motivo: 'desconocida' };
    let orden = ultima;
    if (!orden) {
      try {
        orden = await ctx.broker.ordenPorIdCliente(idCliente);
      } catch (err) {
        log.aviso(`consulta de ${idCliente}: ${err.message}`);
        return { ok: false, motivo: 'sin_estado' };
      }
      if (!orden) {
        this._abandonar(idCliente);
        return { ok: false, motivo: 'abandonada' };
      }
    }
    try {
      if (!ESTADOS_FINALES.has(orden.estado)) orden = await ctx.broker.esperarEjecucion(idCliente, { timeoutMs: 20_000 });
    } catch (err) {
      log.aviso(`no se pudo saber el estado de ${idCliente}: ${err.message}`);
      return { ok: false, motivo: 'sin_estado' };
    }
    if (orden && !ESTADOS_FINALES.has(orden.estado)) orden = await this._cancelarSiVieja(idCliente, registro, orden);
    if (!orden || !ESTADOS_FINALES.has(orden.estado)) return { ok: false, motivo: 'en_vuelo' };
    delete ctx.estado.ordenesEnVuelo[idCliente];
    this._registrar({
      estado: orden.estado.toUpperCase(), idCliente, cantidadEjecutada: orden.cantidadEjecutada, precioMedio: orden.precioMedio, comision: orden.comision ?? null,
      ...(orden.comisionEstimada ? { comisionEstimada: true } : {}),
    });
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

  // Cripto va con gtc: una venta llenada a medias fuera del collar del 2 % se
  // queda viva sin límite, bloquea el símbolo y aplaza la conciliación. A los
  // 60 s se cancela lo que falta; lo ejecutado se apunta por el camino normal
  // y el resto lo vuelve a pedir quien lo pidió (el stop, en el latido siguiente).
  async _cancelarSiVieja(idCliente, registro, orden) {
    const ctx = this.ctx;
    if (typeof ctx.broker.cancelarOrden !== 'function' || !orden.id) return orden;
    const desde = registro.enviadaT ?? registro.t;
    if (!Number.isFinite(desde) || ctx.reloj.ahora() - desde < CANCELAR_TRAS) return orden;
    if (registro.cancelacionPedida) {
      try { return await ctx.broker.esperarEjecucion(idCliente, { timeoutMs: 10_000 }); } catch (_) { return orden; }
    }
    try {
      // false: ya no se puede cancelar (se llenó entretanto): basta con releerla.
      if (!(await ctx.broker.cancelarOrden(orden.id))) return (await ctx.broker.ordenPorIdCliente(idCliente)) || orden;
      registro.cancelacionPedida = true;
      ctx.bus.publicar({
        de: 'ejecutor', canal: 'ejecucion', tipo: 'nota',
        texto: plantillas.frase(`La orden de ${etiqueta(registro.simbolo)} lleva más de un minuto sin completarse: cancelo lo que falta. Lo ejecutado se apunta y el resto se decide de nuevo.`),
        datos: { idCliente, puestoId: registro.puestoId, cantidadEjecutada: orden.cantidadEjecutada ?? null },
      });
      return await ctx.broker.esperarEjecucion(idCliente, { timeoutMs: 10_000 });
    } catch (err) {
      log.aviso(`no se pudo cancelar ${idCliente}: ${err.message}`);
      return orden;
    }
  }

  // Sigue una orden que el fondo no generó (las liquidaciones de cerrarTodo):
  // se apunta como las suyas y, al terminar, entra en los libros repartida
  // entre los puestos del símbolo.
  async seguirAjena(orden, extra = {}) {
    const ctx = this.ctx;
    if (!orden || !orden.idCliente) return { ok: false, motivo: 'sin_id' };
    const idCliente = orden.idCliente;
    const reparto = ctx.libros.listaPuestos({ sombra: false })
      .filter(p => p.simbolo === orden.simbolo && p.cantidad > EPS)
      .map(p => ({ puestoId: p.puestoId, cantidad: p.cantidad }));
    const registro = {
      puestoId: reparto.length ? reparto[0].puestoId : null, mesaId: 'fondo', simbolo: orden.simbolo, lado: orden.lado,
      cantidad: orden.cantidad ?? null, nocional: orden.nocional ?? null, reparto, cierraTodo: true, idCliente, ...extra,
    };
    this.usados.add(idCliente);
    this._registrar({ estado: 'INTENCION', ...registro });
    this._registrar({ estado: 'ENVIADA', idCliente, id: orden.id });
    ctx.estado.ordenesEnVuelo[idCliente] = { ...registro, enviadaT: ctx.reloj.ahora() };
    return this._resolver(idCliente, orden);
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
    // Comisión estimada (Alpaca no la da en la orden): se suma por día para
    // contrastarla con la real (CFEE) en el cierre diario.
    if (orden.comisionEstimada && comision > 0) {
      const porDia = ctx.estado.comisionesEstimadas || (ctx.estado.comisionesEstimadas = {});
      const d = diaUTC(t);
      porDia[d] = (porDia[d] || 0) + comision;
    }
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

  // Al arrancar: lo EJECUTADO después del último estado.json se vuelve a
  // aplicar (los libros descartan lo repetido) y lo que quedó en INTENCIÓN,
  // ENVIADA o DESCONOCIDA pasa a en vuelo y se resuelve como en cada latido
  // (resolverEnVuelo): se consulta por idCliente y, si el bróker no la
  // conoce, no llegó a enviarse y se abandona.
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
      if (r.estado !== 'INTENCION' && r.estado !== 'ENVIADA' && r.estado !== 'DESCONOCIDA') continue;
      if (!ctx.estado.ordenesEnVuelo[idCliente]) ctx.estado.ordenesEnVuelo[idCliente] = { ...r, ...(r.estado === 'DESCONOCIDA' ? { incierta: true } : {}) };
    }
    return resueltas + await this.resolverEnVuelo();
  }

  // En cada latido (y en el kill): cada orden en vuelo se consulta por
  // idCliente (_resolver). Una que el bróker no conoce se abandona en el
  // primer latido con red, sin gastar los 20 s de esperarEjecucion.
  async resolverEnVuelo() {
    let n = 0;
    for (const idCliente of Object.keys(this.ctx.estado.ordenesEnVuelo)) {
      const r = await this._resolver(idCliente);
      if (r.ok) n++;
    }
    return n;
  }
}

// ¿Error de envío tras el que la orden pudo entrar? Red, timeout y 5xx
// ('red'), o un error sin respuesta del bróker (sin tipo, o 'desconocido' sin
// código HTTP). Un 403/422/429 sí trae respuesta: es un rechazo.
function esIncierto(err) {
  const tipo = err && err.tipo;
  if (tipo === 'red' || !tipo) return true;
  return tipo === 'desconocido' && !err.status;
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
// nuevo día de P&L e informe. Devuelve las operaciones del cierre (para el Auditor).
//
// Si llega tarde (portátil apagado o dormido a las 00:05):
// - el día que se cierra es el de la referencia (diaInicio), no el de la hora
//   del arranque, así que no falta ningún día en la curva diaria;
// - las operaciones van por ventana de tiempo (desde el cierre anterior), así
//   que cada una pasa por un cierre y por el Auditor exactamente una vez;
// - el informe dice el tramo real si no dura 24 h;
// - el día nuevo arranca desde el último patrimonio visto antes de las 00:00
//   (la curva horaria): lo perdido durante la noche cuenta para los límites
//   del día, que si no se saltarían sin avisar (los límites solo se aprietan).
function cierreDiario(ctx) {
  const ahora = ctx.reloj.ahora();
  const e = ctx.estado;
  const dia = e.diaInicio || diaUTC(ahora - 10 * MIN);            // el día que se cierra
  const medianoche = inicioVela(ahora, DIA);
  const desde = Number.isFinite(e.ultimoCierreT) ? e.ultimoCierreT : inicioVela(ahora - 10 * MIN, DIA);
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

  // P&L de lo que se cierra y arranque del día nuevo.
  const pnlDia = patrimonio - e.patrimonioInicioDia;
  const pnlDiaPct = e.patrimonioInicioDia > 0 ? pnlDia / e.patrimonioInicioDia : null;
  const opsDia = ctx.operaciones.filter(o => o.salidaT !== null && o.salidaT > desde && o.salidaT <= ahora && o.motivoSalida !== 'prueba');
  const ganadoras = opsDia.filter(o => o.pnl > 0).length;
  let inicio = patrimonio;
  if (ahora - medianoche > CIERRE_TARDE) {
    for (let k = e.curva.length - 1; k >= 0; k--) {
      const p = e.curva[k];
      if (p.t < medianoche) { if (p.patrimonio > 0) inicio = p.patrimonio; break; }
    }
  }
  e.patrimonioInicioDia = inicio;
  e.diaInicio = diaUTC(ahora);
  // La referencia de vigilancia de una reapertura vale solo el día en que se reabrió.
  e.inicioDiaVigilancia = null;
  e.diaInicioVigilancia = null;
  e.inicioDiaPuestos = {};
  for (const [pid, v] of Object.entries(ctx.vivo.valoracion ? ctx.vivo.valoracion.porPuesto : {})) e.inicioDiaPuestos[pid] = v.realizado + v.pnlAbierto;
  e.ultimoCierreT = ahora;

  const informe = {
    dia, desde, hasta: ahora, patrimonio, pnlDia, pnlDiaPct, operaciones: opsDia.length,
    acierto: opsDia.length ? ganadoras / opsDia.length : null, gastoLLMUsd: gastoLLMDe(ctx, desde, ahora, dia),
  };
  const texto = plantillas.informeDiario(informe);
  ctx.bus.publicar({ de: 'controller', canal: 'direccion', tipo: 'informe', texto, datos: informe, importancia: 2 });
  anadirJSONL(path.join(ctx.carpeta, 'informes.jsonl'), { t: ahora, tipo: 'diario', texto, ...informe });

  // Comisión estimada de Alpaca frente a la real (CFEE) del día anterior al
  // que se cierra: Alpaca la apunta al final del día, así tiene un día de margen.
  if (ctx.broker && typeof ctx.broker.comisiones === 'function' && typeof ctx.lanzar === 'function') {
    const anterior = diaUTC(Date.parse(`${dia}T00:00:00Z`) - DIA);
    ctx.lanzar('contraste de comisiones', () => contrastarComisiones(ctx, anterior));
  }
  return opsDia;
}

// Gasto del LLM de lo que cubre el cierre (tiempo real). En sintético el día
// del gasto es el real y no el simulado: no se da cifra (null la omite).
function gastoLLMDe(ctx, desde, hasta, dia) {
  const llm = ctx.llm;
  if (!llm || !ctx.reloj || ctx.reloj.tipo === 'simulado') return null;
  if (typeof llm.gastoEntre === 'function') return llm.gastoEntre(desde, hasta);
  if (typeof llm.gastoDelDia === 'function') return llm.gastoDelDia(dia);
  return null;
}

// Contrasta la comisión que se estimó (a la tasa taker, ficha §4) con la que
// Alpaca apuntó como CFEE ese día. Responde con datos a si paper cobra de
// verdad y a qué nivel; si no cuadra, lo dice el Controller (no cambia nada:
// qué tasa usar lo decide Eduardo).
async function contrastarComisiones(ctx, dia) {
  const e = ctx.estado;
  const porDia = e.comisionesEstimadas || (e.comisionesEstimadas = {});
  const limite = diaUTC(Date.parse(`${dia}T00:00:00Z`) - DIAS_COMISIONES * DIA);
  for (const d of Object.keys(porDia)) if (d < limite) delete porDia[d];
  const estimada = porDia[dia] || 0;
  if (!(estimada > 0)) return null;
  const inicioDia = Date.parse(`${dia}T00:00:00Z`);
  const lista = await ctx.broker.comisiones({ desde: inicioDia - DIA });
  const delDia = (lista || []).filter(x => Number.isFinite(x.t) && diaUTC(x.t) === dia);
  const sinImporte = delDia.filter(x => x.importeUsd === null || x.importeUsd === undefined).length;
  const real = delDia.reduce((s, x) => s + (Number(x.importeUsd) || 0), 0);
  const desvio = (real - estimada) / estimada;
  const r = { dia, estimada, real, apuntes: delDia.length, sinImporte, desvio };
  if (!delDia.length || sinImporte || Math.abs(desvio) > DESVIO_COMISION) {
    const detalle = !delDia.length
      ? 'Alpaca no ha apuntado ninguna comisión (CFEE) ese día'
      : `Alpaca apuntó ${f.usd(real)}${sinImporte ? ` (${sinImporte} apuntes sin importe en dólares)` : ''}, un ${f.pct(desvio, { signo: true, decimales: 1 })}`;
    ctx.bus.publicar({
      de: 'controller', canal: 'riesgo', tipo: 'alerta',
      texto: plantillas.frase(`Comisiones del ${dia}: estimadas ${f.usd(estimada)}; ${detalle}. Revisar la tasa con la que se estima.`, 200),
      datos: r, importancia: 2,
    });
  }
  delete porDia[dia];
  return r;
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

// Kill switch (§7): bloquea (y lo guarda ya: un kill que muere a mitad tiene
// que arrancar bloqueado), cancela todo y vende todo lo del bróker con el
// Ejecutor, repartiendo cada venta entre los puestos del símbolo. La sombra
// «sin comité» lo sufre igual (§5.5): la cierra el orquestador, al precio de
// estas ventas (preciosVenta), aunque el kill falle a mitad.
// Si el bróker falla a mitad (red caída, una venta rechazada), el fondo queda
// bloqueado y lo que quede se vuelve a intentar vender solo, con esperas
// crecientes (reintentarKill, desde el vigilante del orquestador).
async function killSwitch(ctx, motivo) {
  const e = ctx.estado;
  e.fondo.nivel = 'bloqueado';
  e.fondo.motivo = motivo;
  e.fondo.soloCerrarHasta = null;
  e.fondo.killReintento = null;
  try { ctx.guardar(); } catch (err) { log.aviso(`no se pudo guardar el bloqueo: ${err.message}`); }
  // La plantilla ya pone el punto: el motivo del vigilante trae el suyo.
  ctx.bus.publicar({ de: 'riesgos', canal: 'riesgo', tipo: 'alerta', texto: plantillas.killSwitch({ motivo: String(motivo || '').replace(/[.\s]+$/, '') }), datos: { motivo }, importancia: 3 });
  for (const a of ctx.plantilla) ctx.moverAgente(a.id, null, 'de_pie');
  e.pendientes = [];
  try { await ctx.broker.cancelarTodas(); } catch (err) { log.aviso(`cancelarTodas: ${err.message}`); }
  // Lo cancelado (o ejecutado a medias) entra en los libros antes de vender.
  try { await ctx.ejecutor.resolverEnVuelo(); } catch (err) { log.aviso(`órdenes en vuelo: ${err.message}`); }
  const r = await venderKill(ctx);
  programarReintento(ctx, r, 0);
  if (r.abiertos.length || r.errores.length || r.quedanEnBroker.length) {
    ctx.bus.publicar({
      de: 'riesgos', canal: 'riesgo', tipo: 'alerta',
      texto: plantillas.frase(`Tras el kill quedan ${r.abiertos.length} puestos abiertos y ${r.errores.length} errores${r.quedanEnBroker.length ? `: se reintenta vender ${r.quedanEnBroker.map(etiqueta).join(', ')} cada pocos minutos` : ''}.`),
      datos: { abiertos: r.abiertos, errores: r.errores, quedanEnBroker: r.quedanEnBroker }, importancia: 3,
    });
  }
  return r;
}

// Reintento con el fondo bloqueado: vende lo que el bróker aún tenga, sin
// volver a publicar el KILL SWITCH ni vaciar las ventas que esperan a la apertura.
async function reintentarKill(ctx) {
  const e = ctx.estado;
  const previo = e.fondo.killReintento || { n: 0 };
  const n = (previo.n || 0) + 1;
  const r = await venderKill(ctx);
  programarReintento(ctx, r, n);
  if (r.quedanEnBroker.length) {
    ctx.bus.publicar({
      de: 'riesgos', canal: 'riesgo', tipo: 'alerta',
      texto: plantillas.frase(`Kill, reintento ${n}: siguen en el bróker ${r.quedanEnBroker.map(etiqueta).join(', ')}. Vuelvo a intentarlo a las ${f.hora(e.fondo.killReintento.proximo)}.`),
      datos: { n, quedanEnBroker: r.quedanEnBroker, errores: r.errores }, importancia: 3,
    });
  } else {
    ctx.bus.publicar({
      de: 'riesgos', canal: 'riesgo', tipo: 'alerta',
      texto: plantillas.frase(`Kill completado en el reintento ${n}: el bróker ya no tiene nada${r.esperanApertura.length ? ` salvo ${r.esperanApertura.map(etiqueta).join(', ')}, que se vende a la apertura` : ''}.`),
      datos: { n, cerradas: r.cerradas, esperanApertura: r.esperanApertura }, importancia: 3,
    });
  }
  return r;
}

function programarReintento(ctx, r, n) {
  const e = ctx.estado;
  e.fondo.killReintento = r.quedanEnBroker.length ? { n, proximo: ctx.reloj.ahora() + esperaReintento(n) } : null;
}

// Símbolos del bróker que tras un kill habría que vender aún: posiciones de
// más de MIN_REINTENTO_USD sin una venta ya encolada para la apertura ni una
// orden en vuelo.
function quedanEnBroker(ctx, posiciones = ctx.vivo.posicionesBroker || []) {
  const e = ctx.estado;
  const esperan = new Set(e.pendientes.filter(o => o.lado === 'venta').map(o => o.simbolo));
  const enVuelo = new Set(Object.values(e.ordenesEnVuelo).map(o => o.simbolo));
  return (posiciones || [])
    .filter(p => Math.abs(Number(p.valor) || 0) >= MIN_REINTENTO_USD && !esperan.has(p.simbolo) && !enVuelo.has(p.simbolo))
    .map(p => p.simbolo);
}

// Vende con el Ejecutor todo lo que tenga el bróker. Ningún fallo del bróker
// corta la venta a mitad: se anota y se sigue con el siguiente símbolo.
async function venderKill(ctx) {
  const e = ctx.estado;
  const ahora = ctx.reloj.ahora();
  const cerradas = [];
  const errores = [];
  const preciosVenta = {};         // símbolo → precio medio al que vendió el kill (la sombra cierra a ese)
  const esperanApertura = new Set(e.pendientes.filter(o => o.lado === 'venta' && o.tipo === 'kill').map(o => o.simbolo));

  const leerPosiciones = async () => {
    try { return await ctx.broker.posiciones(); } catch (err) { errores.push({ simbolo: null, motivo: `posiciones: ${err.message}` }); return null; }
  };
  const vender = async (simbolo, cantidad) => {
    if (esperanApertura.has(simbolo)) return 'espera';
    if (Object.values(e.ordenesEnVuelo).some(o => o.simbolo === simbolo)) return 'en_vuelo';
    const reparto = ctx.libros.listaPuestos({ sombra: false })
      .filter(p => p.simbolo === simbolo && p.cantidad > EPS)
      .map(p => ({ puestoId: p.puestoId, cantidad: p.cantidad }));
    let r;
    try {
      r = await ctx.ejecutor.ejecutar({
        puestoId: reparto.length ? reparto[0].puestoId : null, mesaId: 'fondo', simbolo, lado: 'venta',
        cantidad, tipo: 'kill', motivo: 'kill', accion: 'kill', velaT: ahora, reparto, cierraTodo: true,
      });
    } catch (err) {
      r = { ok: false, motivo: err.message };
    }
    if (r && r.ok && r.precio > 0) preciosVenta[simbolo] = r.precio;
    if (r && r.ok) return 'ok';
    if (r && r.pendiente) { esperanApertura.add(simbolo); return 'espera'; }
    return (r && r.motivo) || 'error';
  };

  // Primera pasada: lo que dice el bróker.
  const fallidos = new Map();
  const posiciones = await leerPosiciones();
  for (const pos of posiciones || []) {
    const r = await vender(pos.simbolo, Number(pos.disponible ?? pos.cantidad));
    if (r === 'ok') cerradas.push(pos.simbolo); else if (r !== 'espera') fallidos.set(pos.simbolo, r);
  }
  // Segunda pasada para lo que quedó a medias (una venta llenada en parte,
  // sin respuesta o rechazada): se cancela, lo ejecutado entra en los libros
  // y se vuelve a vender lo que diga el bróker.
  if (fallidos.size) {
    try { await ctx.broker.cancelarTodas(); } catch (err) { log.aviso(`cancelarTodas: ${err.message}`); }
    try { await ctx.ejecutor.resolverEnVuelo(); } catch (err) { log.aviso(`órdenes en vuelo: ${err.message}`); }
    const otra = await leerPosiciones();
    for (const pos of otra || []) {
      if (!fallidos.has(pos.simbolo)) continue;
      const r = await vender(pos.simbolo, Number(pos.disponible ?? pos.cantidad));
      if (r === 'ok') { cerradas.push(pos.simbolo); fallidos.delete(pos.simbolo); } else if (r !== 'espera') fallidos.set(pos.simbolo, r);
    }
    for (const s of [...fallidos.keys()]) if (otra && !otra.some(p => p.simbolo === s)) fallidos.delete(s);
  }
  for (const [simbolo, motivo] of fallidos) errores.push({ simbolo, motivo });

  // Último recurso, cerrarTodo(): solo si no hay ventas de acciones esperando
  // a la apertura (con Alpaca, su DELETE dejaría otra venta encolada que nadie
  // sigue) y siguiendo cada liquidación como una orden propia.
  if (fallidos.size && !esperanApertura.size && typeof ctx.broker.cerrarTodo === 'function') {
    try {
      const barrido = await ctx.broker.cerrarTodo();
      for (const o of barrido.ordenes || []) {
        try {
          const r = await ctx.ejecutor.seguirAjena(o, { tipo: 'kill', motivo: 'kill', accion: 'kill' });
          if (r && r.ok && r.precio > 0) preciosVenta[o.simbolo] = r.precio;
        } catch (err) { log.aviso(`liquidación de ${o.simbolo}: ${err.message}`); }
      }
      for (const x of barrido.errores || []) {
        if (x.tipo === 'mercado_cerrado') esperanApertura.add(x.simbolo); else errores.push(x);
      }
    } catch (err) { errores.push({ simbolo: null, motivo: err.message }); }
  }

  try { await ctx.refrescarCartera(); } catch (err) { errores.push({ simbolo: null, motivo: `valoración: ${err.message}` }); }
  const abiertos = ctx.libros.listaPuestos({ sombra: false }).filter(p => p.cantidad > EPS).map(p => p.puestoId);
  // Sin la lista del bróker no se puede saber qué queda: al menos lo de los libros.
  let quedan = quedanEnBroker(ctx);
  if (posiciones === null && !quedan.length) quedan = [...new Set(ctx.libros.listaPuestos({ sombra: false }).filter(p => p.cantidad > EPS).map(p => p.simbolo))];
  return { cerradas, errores, esperanApertura: [...esperanApertura], quedanEnBroker: quedan.filter(s => !esperanApertura.has(s)), abiertos, preciosVenta };
}

module.exports = {
  Ejecutor, conciliarCadaLatido, cierreDiario, informeSemanal, killSwitch, reintentarKill, venderKill, quedanEnBroker, contrastarComisiones,
  valorMesa, pnlMesaTotal, sharpes90, anotarCurva, esIncierto, GRAVES_PARA_PAUSAR, CANCELAR_TRAS, esperaReintento,
};
