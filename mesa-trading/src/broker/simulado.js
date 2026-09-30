'use strict';
// Bróker simulado con la misma interfaz que AlpacaBroker (ARQUITECTURA §3.4).
// Se usa sin claves de Alpaca y en la demo sintética.
//
// Llena al instante al último precio de la fuente ± deslizamiento. Imita a
// Alpaca en la comisión cripto: en compras se cobra en el ACTIVO recibido
// (recibes cantidad × (1 − comisión)) y en ventas en dólares (ficha §4).
// Sin margen, sin cortos y sin acciones con el mercado cerrado: esos casos se
// rechazan con ErrorBroker del mismo tipo que daría Alpaca.
//
// Diferencia con Alpaca que hay que conocer: Alpaca NO rechaza una orden
// market/day de acciones con la bolsa cerrada; la acepta y la deja en cola
// hasta la apertura siguiente (también las liquidaciones de cerrarTodo). Aquí
// se rechaza con 'mercado_cerrado', como fija el contrato, y el Ejecutor
// encola él mismo esas órdenes; con Alpaca hay que seguir la que devuelve
// cerrarTodo en `ordenes`.
//
// Mismo contrato de Orden que AlpacaBroker: `cantidadEjecutada` es lo que
// ENTRA en la posición (neto de comisión en compras cripto), `comision` va en
// dólares y `cantidadBruta` lleva la cifra bruta. Alpaca no da la comisión en
// la orden y el adaptador la estima a la misma tasa (alpaca-broker.js).

const { ErrorBroker } = require('./errores');
const { COSTES_POR_DEFECTO, DECIMALES, aFuncion, redondear9, diferenciaOrden } = require('./comun');
const universo = require('../mercado/universo');
const calendarioPorDefecto = require('../mercado/calendario');
const { leerJSON, escribirJSON } = require('../util/almacen');
const { diaUTC } = require('../util/reloj');
const log = require('../util/log').crear('broker-simulado');

const MAX_ORDENES_GUARDADAS = 1000;

function estadoInicial(capital, ahora) {
  return {
    version: 1,
    efectivo: capital,
    posiciones: {},          // simbolo → { cantidad, precioMedio }
    ordenes: [],             // últimas MAX_ORDENES_GUARDADAS, en orden de llegada
    contador: 0,
    patrimonioAyer: capital,
    ultimoPatrimonio: { dia: diaUTC(ahora), valor: capital },
    creado: ahora,
  };
}

class BrokerSimulado {
  constructor({ capitalInicial = 100000, fuente, reloj, ruta = null, calendario = calendarioPorDefecto, costes = {} } = {}) {
    if (!fuente || typeof fuente.ultimos !== 'function') throw new Error('BrokerSimulado necesita una fuente con ultimos()');
    if (!reloj) throw new Error('BrokerSimulado necesita un reloj');
    this.nombre = 'simulado';
    this.fuente = fuente;
    this.reloj = reloj;
    this.ruta = ruta;
    this.calendario = calendario;
    this.comision = aFuncion(costes.comision, COSTES_POR_DEFECTO.comision);
    this.deslizamiento = aFuncion(costes.deslizamiento, COSTES_POR_DEFECTO.deslizamiento);
    // Crítico: si el fichero existe pero no se puede leer (bloqueado un
    // instante, corrupto), arrancar con 100.000 $ nuevos dejaría los libros
    // contra un bróker vacío. Mejor no arrancar (lo decide util/almacen).
    const guardado = ruta ? leerJSON(ruta, null, { critico: true }) : null;
    this.estado = guardado && guardado.version === 1 ? guardado : estadoInicial(capitalInicial, reloj.ahora());
    this.guardadoPendiente = false;
    if (!guardado && ruta) this._guardar();
  }

  // Una vez cambiado el estado (una orden llenada), no poder escribirlo en
  // disco NO puede convertir la ejecución en un error: el Ejecutor la daría
  // por rechazada, no la apuntaría y quedaría una posición sin puesto. Se
  // avisa y se reintenta en la siguiente llamada que guarde (cuenta(), en
  // cada latido).
  _guardar() {
    if (!this.ruta) return;
    try {
      escribirJSON(this.ruta, this.estado, { durable: true });
      if (this.guardadoPendiente) log.info(`${this.ruta} guardado de nuevo tras el fallo anterior`);
      this.guardadoPendiente = false;
    } catch (e) {
      if (!this.guardadoPendiente) log.aviso(`no se pudo guardar ${this.ruta} (${e.code || e.message}); se reintenta en la siguiente llamada`);
      this.guardadoPendiente = true;
    }
  }

  async _precios(simbolos) {
    if (!simbolos.length) return {};
    return (await this.fuente.ultimos(simbolos)) || {};
  }

  // Patrimonio del «día anterior» al estilo de last_equity, pero con corte a
  // las 00:00 UTC: el último patrimonio visto en un día anterior.
  _anotarPatrimonio(patrimonio) {
    const hoy = diaUTC(this.reloj.ahora());
    const u = this.estado.ultimoPatrimonio;
    if (u && u.dia !== hoy) this.estado.patrimonioAyer = u.valor;
    this.estado.ultimoPatrimonio = { dia: hoy, valor: patrimonio };
  }

  async cuenta() {
    const posiciones = await this.posiciones();
    const valor = posiciones.reduce((s, p) => s + p.valor, 0);
    const patrimonio = this.estado.efectivo + valor;
    this._anotarPatrimonio(patrimonio);
    this._guardar();
    return {
      patrimonio,
      efectivo: this.estado.efectivo,
      poderCompra: this.estado.efectivo,
      patrimonioAyer: this.estado.patrimonioAyer,
      bloqueada: false,
      estado: 'ACTIVE',
    };
  }

  async posiciones() {
    const simbolos = Object.keys(this.estado.posiciones);
    const precios = await this._precios(simbolos);
    return simbolos.map(simbolo => {
      const p = this.estado.posiciones[simbolo];
      // Sin precio nuevo se valora al coste: mejor que valorar a 0.
      const precioActual = precios[simbolo] ? precios[simbolo].precio : p.precioMedio;
      const valor = p.cantidad * precioActual;
      return {
        simbolo,
        cantidad: p.cantidad,
        disponible: p.cantidad,   // se llena al instante: nada queda bloqueado por órdenes
        precioMedio: p.precioMedio,
        precioActual,
        valor,
        pnlNoRealizado: valor - p.cantidad * p.precioMedio,
        clase: universo.esCripto(simbolo) ? 'cripto' : 'accion',
      };
    });
  }

  _rechazo(mensaje, tipo, status) {
    return new ErrorBroker(mensaje, { tipo, status, cuerpo: { message: mensaje } });
  }

  async enviarOrden({ idCliente, simbolo, lado, cantidad, nocional } = {}) {
    // Idempotente como Alpaca: repetir un idCliente devuelve la orden que ya
    // hay, pero solo si es la misma orden; si no, el id lo usa otra.
    const previa = this.estado.ordenes.find(o => o.idCliente === idCliente);
    if (previa) {
      const diferencia = diferenciaOrden(previa, { simbolo, lado, cantidad, nocional });
      if (diferencia) throw this._rechazo(`idCliente ${idCliente} ya usado por otra orden (${diferencia})`, 'invalida', 422);
      return { ...previa };
    }

    if (!idCliente || typeof idCliente !== 'string' || idCliente.length > 128) {
      throw this._rechazo('idCliente obligatorio y de 128 caracteres como mucho', 'invalida', 422);
    }
    if (lado !== 'compra' && lado !== 'venta') throw this._rechazo(`lado no válido: ${lado}`, 'invalida', 422);
    const hayCantidad = cantidad !== undefined && cantidad !== null;
    const hayNocional = nocional !== undefined && nocional !== null;
    if (hayCantidad === hayNocional) throw this._rechazo('qty or notional is required (uno de los dos)', 'invalida', 422);
    const importe = Number(hayCantidad ? cantidad : nocional);
    if (!(importe > 0) || !Number.isFinite(importe)) throw this._rechazo(`importe no válido: ${importe}`, 'invalida', 422);
    if (hayNocional && importe < 1) throw this._rechazo('notional must be >= 1.00', 'invalida', 422);

    const ahora = this.reloj.ahora();
    const cripto = universo.esCripto(simbolo);
    if (!cripto && !this.calendario.abierto(ahora)) {
      throw this._rechazo(`mercado cerrado para ${simbolo}`, 'mercado_cerrado', 403);
    }
    const precios = await this._precios([simbolo]);
    const ultimo = precios[simbolo];
    if (!ultimo || !(ultimo.precio > 0)) throw this._rechazo(`sin precio para ${simbolo}`, 'invalida', 422);

    const c = this.comision(simbolo);
    const d = this.deslizamiento(simbolo);
    const pos = this.estado.posiciones[simbolo] || { cantidad: 0, precioMedio: 0 };
    let cantidadBruta, cantidadNeta, efectivoDelta, comisionUsd, precioEjec;

    if (lado === 'compra') {
      precioEjec = ultimo.precio * (1 + d);
      // Por nocional sale exactamente el nocional: no se recalcula con el precio.
      const coste = hayNocional ? importe : importe * precioEjec;
      cantidadBruta = hayNocional ? importe / precioEjec : importe;
      comisionUsd = coste * c;
      // Cripto: la comisión se queda con parte del activo recibido. Acciones
      // (si alguien les pone comisión): en dólares aparte.
      cantidadNeta = redondear9(cripto ? cantidadBruta * (1 - c) : cantidadBruta);
      const salida = cripto ? coste : coste + comisionUsd;
      if (salida > this.estado.efectivo + 1e-9) {
        throw this._rechazo(`insufficient buying power (hacen falta ${salida.toFixed(2)} $, hay ${this.estado.efectivo.toFixed(2)} $)`, 'fondos', 403);
      }
      efectivoDelta = -salida;
      const nueva = pos.cantidad + cantidadNeta;
      // Precio medio al precio de ejecución, como avg_entry_price de Alpaca.
      pos.precioMedio = nueva > 0 ? (pos.cantidad * pos.precioMedio + cantidadNeta * precioEjec) / nueva : 0;
      pos.cantidad = redondear9(nueva);
    } else {
      precioEjec = ultimo.precio * (1 - d);
      cantidadBruta = hayCantidad ? redondear9(importe) : redondear9(importe / precioEjec);
      if (cantidadBruta > pos.cantidad + 1e-12) {
        throw this._rechazo(`insufficient qty available for order (pedido ${cantidadBruta}, disponible ${pos.cantidad})`, 'cantidad', 403);
      }
      cantidadNeta = cantidadBruta;
      const bruto = cantidadBruta * precioEjec;
      comisionUsd = bruto * c;
      efectivoDelta = bruto - comisionUsd;
      pos.cantidad = redondear9(pos.cantidad - cantidadBruta);
    }

    this.estado.efectivo += efectivoDelta;
    if (pos.cantidad > 0) this.estado.posiciones[simbolo] = pos;
    else delete this.estado.posiciones[simbolo];

    this.estado.contador += 1;
    const orden = {
      id: `sim-${this.estado.contador}`,
      idCliente,
      simbolo,
      lado,
      cantidad: hayCantidad ? importe : null,
      nocional: hayNocional ? importe : null,
      estado: 'ejecutada',
      cantidadEjecutada: cantidadNeta,
      precioMedio: precioEjec,
      comision: comisionUsd,
      creada: ahora,
      actualizada: ahora,
      motivo: null,
      cantidadBruta,
      precioReferencia: ultimo.precio,
      tPrecio: ultimo.t,
    };
    this.estado.ordenes.push(orden);
    if (this.estado.ordenes.length > MAX_ORDENES_GUARDADAS) this.estado.ordenes.splice(0, this.estado.ordenes.length - MAX_ORDENES_GUARDADAS);
    this._guardar();
    return { ...orden };
  }

  async ordenPorIdCliente(idCliente) {
    const o = this.estado.ordenes.find(x => x.idCliente === idCliente);
    return o ? { ...o } : null;
  }

  // Todo se llena al instante: basta con leerla.
  async esperarEjecucion(idCliente) {
    const o = await this.ordenPorIdCliente(idCliente);
    if (!o) throw new ErrorBroker(`orden ${idCliente} no encontrada`, { tipo: 'desconocido' });
    return o;
  }

  async ordenesAbiertas() { return []; }

  async cancelarTodas() { return 0; }

  // Todo se llena al instante: no queda nada que cancelar (como el 422 de
  // Alpaca para una orden ya terminada).
  async cancelarOrden() { return false; }

  // Kill switch: vende todo a mercado. Las acciones con el mercado cerrado no
  // se pueden vender y quedan en `errores`. Las órdenes de liquidación van en
  // `ordenes`, como en AlpacaBroker.
  async cerrarTodo() {
    const cerradas = [];
    const errores = [];
    const ordenes = [];
    const t = this.reloj.ahora();
    for (const [simbolo, pos] of Object.entries({ ...this.estado.posiciones })) {
      try {
        ordenes.push(await this.enviarOrden({ idCliente: `kill-${universo.clave(simbolo)}-${t}-${this.estado.contador + 1}`, simbolo, lado: 'venta', cantidad: pos.cantidad }));
        cerradas.push(simbolo);
      } catch (e) {
        errores.push({ simbolo, status: e.status || null, mensaje: e.message, tipo: e.tipo });
      }
    }
    return { cerradas, errores, ordenes };
  }

  async relojMercado() {
    return this.calendario.relojMercado(this.reloj.ahora());
  }

  async activo(simbolo) {
    const conocido = universo.porSimbolo(simbolo);
    return {
      negociable: Boolean(conocido),
      fraccionable: true,
      minCantidad: 10 ** -DECIMALES,
      incremento: 10 ** -DECIMALES,
      minNocional: 1,
      clase: universo.esCripto(simbolo) ? 'cripto' : 'accion',
    };
  }
}

module.exports = { BrokerSimulado, COSTES_POR_DEFECTO };
