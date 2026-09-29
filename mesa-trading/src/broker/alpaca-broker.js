'use strict';
// Cliente REST de la cuenta PAPER de Alpaca, sin librería (ARQUITECTURA §3.4,
// ficha-alpaca §1). Solo papel: la URL base es fija y el constructor rechaza
// cualquier otra, así que la cuenta real no se puede tocar ni por error.
//
// Importes: Alpaca los manda como string → Number(). Posiciones cripto llegan
// como 'BTCUSD' → símbolo canónico 'BTC/USD'. No se leen pattern_day_trader ni
// daytrade_count: se retiraron de la API el 6-jul-2026 (ficha §0.1).

const { ErrorBroker } = require('./errores');
const { Limitador, pedir } = require('../mercado/limitador');
const universo = require('../mercado/universo');
const { RelojReal } = require('../util/reloj');

const URL_PAPER = 'https://paper-api.alpaca.markets';

// Estados de Alpaca → estados del contrato. Lo que no es final queda en
// 'pendiente' (o 'parcial' si ya se ejecutó algo).
const ESTADOS = Object.freeze({
  new: 'pendiente', accepted: 'pendiente', pending_new: 'pendiente', accepted_for_bidding: 'pendiente',
  pending_cancel: 'pendiente', pending_replace: 'pendiente', calculated: 'pendiente', stopped: 'pendiente',
  suspended: 'pendiente', held: 'pendiente', done_for_day: 'pendiente',
  partially_filled: 'parcial',
  filled: 'ejecutada',
  canceled: 'cancelada', replaced: 'cancelada',
  expired: 'caducada',
  rejected: 'rechazada',
});
const FINALES = new Set(['ejecutada', 'cancelada', 'rechazada', 'caducada']);

const numOnull = x => (x === null || x === undefined || x === '' ? null : Number(x));

// Hasta 9 decimales y sin notación científica (Alpaca no acepta '1e-7').
function decimalTexto(x) {
  const s = Number(x).toFixed(9).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

function mapearEstado(o) {
  const e = ESTADOS[o.status] || 'pendiente';
  if (e === 'pendiente' && Number(o.filled_qty || 0) > 0) return 'parcial';
  return e;
}

function simboloCanonico(sym, claseAlpaca) {
  return universo.desdeClave(sym, { clase: claseAlpaca === 'us_equity' ? 'accion' : undefined });
}

// Order de Alpaca → Orden del contrato. comision = null: Alpaca no la da en la
// orden (la cobra en el activo recibido y la apunta al final del día, ficha §4).
function mapearOrden(o) {
  if (!o) return null;
  const estado = mapearEstado(o);
  return {
    id: o.id,
    idCliente: o.client_order_id,
    simbolo: simboloCanonico(o.symbol, o.asset_class),
    lado: o.side === 'buy' ? 'compra' : 'venta',
    cantidad: numOnull(o.qty),
    nocional: numOnull(o.notional),
    estado,
    cantidadEjecutada: Number(o.filled_qty || 0),
    precioMedio: numOnull(o.filled_avg_price),
    comision: null,
    creada: o.created_at ? Date.parse(o.created_at) : null,
    actualizada: o.updated_at ? Date.parse(o.updated_at) : null,
    motivo: estado === 'rechazada' || estado === 'cancelada' || estado === 'caducada' ? `alpaca: ${o.status}` : null,
    estadoAlpaca: o.status,
  };
}

class AlpacaBroker {
  constructor({
    claveId, secreto, urlBase = URL_PAPER, fetch = globalThis.fetch, reloj = new RelojReal(),
    // Hay que pasar el MISMO limitador que a AlpacaDatos: la cuota de 200/min es por cuenta.
    limitador = new Limitador(), timeoutMs = 15_000, maxReintentos = 5, dormir, intervaloSondeoMs = 1000,
  } = {}) {
    const base = String(urlBase || '').replace(/\/+$/, '');
    if (base !== URL_PAPER) {
      throw new Error(`AlpacaBroker solo opera en papel: la URL base tiene que ser ${URL_PAPER} (llegó «${urlBase}»)`);
    }
    if (!claveId || !secreto) throw new Error('AlpacaBroker necesita claveId y secreto de la cuenta paper');
    if (typeof fetch !== 'function') throw new Error('AlpacaBroker necesita fetch');
    this.nombre = 'alpaca-paper';
    this.urlBase = URL_PAPER;
    this.claveId = claveId;
    this.secreto = secreto;
    this.fetch = fetch;
    this.reloj = reloj;
    this.limitador = limitador;
    this.timeoutMs = timeoutMs;
    this.maxReintentos = maxReintentos;
    this.dormir = dormir || (ms => new Promise(r => setTimeout(r, ms)));
    this.intervaloSondeoMs = intervaloSondeoMs;
  }

  _cabeceras() {
    return { 'APCA-API-KEY-ID': this.claveId, 'APCA-API-SECRET-KEY': this.secreto, Accept: 'application/json' };
  }

  // GET y DELETE (idempotentes) se reintentan; POST jamás (ver enviarOrden).
  async _pedir(metodo, ruta, { cuerpo, reintentar = metodo !== 'POST', aceptar = [] } = {}) {
    return pedir({
      fetch: this.fetch, url: this.urlBase + ruta, metodo, cabeceras: this._cabeceras(), cuerpo,
      timeoutMs: this.timeoutMs, limitador: this.limitador, reintentar, maxReintentos: this.maxReintentos,
      dormir: this.dormir, contexto: `${metodo} ${ruta.split('?')[0]}`, aceptar,
    });
  }

  async cuenta() {
    const { json: a } = await this._pedir('GET', '/v2/account');
    const bloqueada = Boolean(a.trading_blocked || a.account_blocked || a.trade_suspended_by_user) || a.status !== 'ACTIVE';
    // Sin margen: el poder de compra que cuenta es el no marginable (el de las
    // órdenes cripto, ficha §1); si no viene, el de efectivo.
    const poderCompra = numOnull(a.non_marginable_buying_power) ?? numOnull(a.cash);
    return {
      patrimonio: Number(a.equity),
      efectivo: Number(a.cash),
      poderCompra,
      patrimonioAyer: Number(a.last_equity),
      bloqueada,
      estado: a.status,
      poderCompraMargen: numOnull(a.buying_power),
    };
  }

  async posiciones() {
    const { json } = await this._pedir('GET', '/v2/positions');
    return (json || []).map(p => ({
      simbolo: simboloCanonico(p.symbol, p.asset_class),
      cantidad: Number(p.qty),
      // Para vender se usa qty_available: lo bloqueado por órdenes abiertas no se puede vender.
      disponible: Number(p.qty_available ?? p.qty),
      precioMedio: Number(p.avg_entry_price),
      precioActual: numOnull(p.current_price),
      valor: Number(p.market_value),
      pnlNoRealizado: Number(p.unrealized_pl),
      clase: p.asset_class === 'crypto' ? 'cripto' : 'accion',
      idActivo: p.asset_id,
    }));
  }

  _cuerpoOrden({ idCliente, simbolo, lado, cantidad, nocional }) {
    if (!idCliente || typeof idCliente !== 'string' || idCliente.length > 128) {
      throw new ErrorBroker('idCliente obligatorio y de 128 caracteres como mucho', { tipo: 'invalida' });
    }
    if (lado !== 'compra' && lado !== 'venta') throw new ErrorBroker(`lado no válido: ${lado}`, { tipo: 'invalida' });
    const hayCantidad = cantidad !== undefined && cantidad !== null;
    const hayNocional = nocional !== undefined && nocional !== null;
    if (hayCantidad === hayNocional) {
      throw new ErrorBroker('la orden lleva cantidad O nocional, uno de los dos', { tipo: 'invalida' });
    }
    const valor = hayCantidad ? Number(cantidad) : Number(nocional);
    if (!(valor > 0) || !Number.isFinite(valor)) throw new ErrorBroker(`importe no válido: ${valor}`, { tipo: 'invalida' });
    const cuerpo = {
      symbol: simbolo,
      side: lado === 'compra' ? 'buy' : 'sell',
      type: 'market',
      // Cripto solo admite gtc/ioc; las fraccionarias de acciones solo day (ficha §1).
      time_in_force: universo.esCripto(simbolo) ? 'gtc' : 'day',
      client_order_id: idCliente,
    };
    if (hayCantidad) cuerpo.qty = decimalTexto(valor);
    else cuerpo.notional = decimalTexto(valor);
    return cuerpo;
  }

  // Envío idempotente. Ante timeout o 5xx NO se reenvía a ciegas: puede que la
  // orden sí entrara. Se consulta por idCliente y solo si no existe se reenvía.
  // Un 422 «client_order_id must be unique» prueba que ya entró.
  async enviarOrden(orden) {
    const cuerpo = this._cuerpoOrden(orden);
    const maxEnvios = 3;
    let ultimoError = null;
    for (let envio = 0; envio < maxEnvios; envio++) {
      if (envio > 0) {
        const existente = await this.ordenPorIdCliente(orden.idCliente);
        if (existente) return existente;
      }
      try {
        const { json } = await this._pedir('POST', '/v2/orders', { cuerpo, reintentar: false });
        return mapearOrden(json);
      } catch (e) {
        if (!(e instanceof ErrorBroker)) throw e;
        if (e.status === 422 && /client_order_id must be unique/i.test(e.message)) {
          const existente = await this.ordenPorIdCliente(orden.idCliente);
          if (existente) return existente;
          throw e;
        }
        if (e.tipo !== 'red') throw e;       // 403/422/429…: decide el Ejecutor
        ultimoError = e;
        await this.dormir(1000 * 2 ** envio);
      }
    }
    // Última comprobación: tras tres fallos de red la orden puede haber entrado igual.
    const existente = await this.ordenPorIdCliente(orden.idCliente);
    if (existente) return existente;
    throw ultimoError;
  }

  async ordenPorIdCliente(idCliente) {
    const ruta = `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(idCliente)}`;
    const { status, json } = await this._pedir('GET', ruta, { aceptar: [404] });
    return status === 404 ? null : mapearOrden(json);
  }

  // Sondea hasta un estado final. Cuenta intentos además del tiempo para no
  // quedarse colgado con un reloj simulado que no avanza.
  async esperarEjecucion(idCliente, { timeoutMs = 20_000, intervaloMs = this.intervaloSondeoMs } = {}) {
    const intentos = Math.max(1, Math.ceil(timeoutMs / Math.max(1, intervaloMs)) + 1);
    const inicio = this.reloj.ahora();
    let orden = null;
    for (let i = 0; i < intentos; i++) {
      orden = await this.ordenPorIdCliente(idCliente);
      if (orden && FINALES.has(orden.estado)) return orden;
      if (this.reloj.ahora() - inicio >= timeoutMs) break;
      await this.dormir(intervaloMs);
    }
    if (!orden) throw new ErrorBroker(`orden ${idCliente} no encontrada en Alpaca`, { tipo: 'desconocido' });
    return orden;
  }

  async ordenesAbiertas() {
    const { json } = await this._pedir('GET', '/v2/orders?status=open&limit=500&direction=asc');
    return (json || []).map(mapearOrden);
  }

  // DELETE /v2/orders → 207 [{ id, status }]. Cuenta las aceptadas.
  async cancelarTodas() {
    const { json } = await this._pedir('DELETE', '/v2/orders');
    if (!Array.isArray(json)) return 0;
    return json.filter(r => r && Number(r.status) >= 200 && Number(r.status) < 300).length;
  }

  // Kill switch: DELETE /v2/positions?cancel_orders=true → 207 [{ symbol, status, body }].
  // No lanza: devuelve lo cerrado y los errores para que se vea qué quedó.
  async cerrarTodo() {
    try {
      const { json } = await this._pedir('DELETE', '/v2/positions?cancel_orders=true');
      const cerradas = [];
      const errores = [];
      for (const r of Array.isArray(json) ? json : []) {
        const clase = r.body && r.body.asset_class;
        const simbolo = simboloCanonico(r.symbol, clase);
        if (Number(r.status) >= 200 && Number(r.status) < 300) cerradas.push(simbolo);
        else errores.push({ simbolo, status: Number(r.status), mensaje: (r.body && r.body.message) || `HTTP ${r.status}` });
      }
      return { cerradas, errores };
    } catch (e) {
      return { cerradas: [], errores: [{ simbolo: null, status: e.status || null, mensaje: e.message, tipo: e.tipo }] };
    }
  }

  async relojMercado() {
    const { json: c } = await this._pedir('GET', '/v2/clock');
    return {
      abierto: Boolean(c.is_open),
      proximaApertura: Date.parse(c.next_open),
      proximoCierre: Date.parse(c.next_close),
      t: c.timestamp ? Date.parse(c.timestamp) : null,
    };
  }

  // Cripto: la barra va codificada (/v2/assets/BTC%2FUSD, ficha §1). Los
  // mínimos se leen del activo, no se cablean.
  async activo(simbolo) {
    const { json: a } = await this._pedir('GET', `/v2/assets/${encodeURIComponent(simbolo)}`);
    const cripto = a.class === 'crypto';
    return {
      negociable: Boolean(a.tradable) && a.status === 'active',
      fraccionable: Boolean(a.fractionable),
      minCantidad: numOnull(a.min_order_size),
      incremento: numOnull(a.min_trade_increment),
      // Acciones: «notional must be >= 1.00» (ficha §1). Cripto: la doc se
      // contradice; se deja null y manda minCantidad × precio.
      minNocional: cripto ? null : 1,
      incrementoPrecio: numOnull(a.price_increment),
      clase: cripto ? 'cripto' : 'accion',
    };
  }

  // Comisiones cripto apuntadas por Alpaca (se cargan al final del día, ficha §4).
  async comisiones({ desde } = {}) {
    const q = desde ? `?after=${encodeURIComponent(new Date(desde).toISOString())}` : '';
    const { json } = await this._pedir('GET', `/v2/account/activities/CFEE${q}`);
    return (json || []).map(x => ({
      id: x.id, t: Date.parse(x.date || x.transaction_time || x.created_at || 0),
      simbolo: x.symbol ? universo.desdeClave(x.symbol) : null,
      cantidad: numOnull(x.qty), importe: numOnull(x.net_amount), crudo: x,
    }));
  }
}

module.exports = { AlpacaBroker, URL_PAPER, mapearOrden, mapearEstado, decimalTexto, ESTADOS };
