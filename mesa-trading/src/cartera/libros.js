'use strict';
// Libros por puesto (mesa × símbolo) — ARQUITECTURA §5.1.
//
// Un puesto es la unidad de posición y de atribución. El fondo real es la
// suma de los puestos NO-sombra, y eso es lo que se concilia con el bróker.
// Los puestos sombra («mismas mesas sin comité») llevan su propia
// contabilidad y nunca se mezclan con los reales: `sombra` elige qué libro se
// mira (false = el real, true = el sombra).
//
// Contabilidad:
// - Compras: coste medio ponderado. La comisión de entrada NO entra en el
//   coste medio: se guarda aparte (comisionesPendientes) y se imputa a
//   prorrata de la parte que se vende. Así `entradaPrecio` es el precio real
//   de ejecución y el deslizamiento se puede medir contra él.
// - Ventas: realizado = (precio − costeMedio)·cantidad − comisión de salida
//   − comisiones de entrada a prorrata de la parte vendida.
// - Un cierre parcial genera una Operación por la parte cerrada.
// - rMultiple = pnl / riesgoInicial, con riesgoInicial = (entrada − stop)·cantidad
//   al abrir (a prorrata en cierres parciales).

const universo = require('../mercado/universo');
const log = require('../util/log').crear('libros');

const VERSION = 1;
const EPS = 1e-12;                 // cantidad que se considera cero
const RESTO_RELATIVO = 1e-9;       // un resto así de pequeño tras vender es ruido de coma flotante: se cierra entero
const MAX_APLICADAS = 2000;        // ejecuciones recordadas para no contarlas dos veces tras un reinicio
const MAX_AJUSTES = 200;
const MOTIVOS_SALIDA = Object.freeze(['señal', 'stop', 'kill', 'riesgo', 'manual', 'prueba']);

const esNumero = x => typeof x === 'number' && Number.isFinite(x);
const positivo = x => esNumero(x) && x > 0;

// Acepta { sim: precio } y también { sim: { precio, t } } (forma de fuente.ultimos()).
function precioDe(precios, simbolo) {
  if (!precios) return null;
  const v = precios[simbolo];
  if (positivo(v)) return v;
  if (v && positivo(v.precio)) return v.precio;
  return null;
}

// Deslizamiento en contra, en fracción: comprar más caro o vender más barato
// que el precio de referencia (el de la decisión) es positivo.
function deslizamientoEnContra(lado, precio, referencia) {
  if (!positivo(referencia)) return null;
  return lado === 'compra' ? (precio - referencia) / referencia : (referencia - precio) / referencia;
}

function normalizarMotivo(m) {
  if (m === 'senal') return 'señal';
  return m ?? null;
}

function puestoVacio({ puestoId, mesaId, simbolo, sombra }) {
  return {
    puestoId,
    mesaId,
    simbolo,
    sombra: Boolean(sombra),
    cantidad: 0,
    costeMedio: 0,
    stop: null,
    objetivoPrecio: null,
    abiertaT: null,
    maxPrecio: null,
    barrasAbierta: 0,
    riesgoInicial: null,
    regimenEntrada: null,
    realizado: 0,
    comisiones: 0,
    nOperaciones: 0,
    // Internos (se serializan): comisiones de entrada aún no imputadas y el
    // deslizamiento medio de entrada ponderado por cantidad.
    comisionesPendientes: 0,
    deslizamientoSuma: 0,
    deslizamientoCantidad: 0,
    ultimoPrecio: null,
    ultimaT: null,
  };
}

// Al cerrar del todo, el puesto vuelve a vacío pero conserva su historia.
function reiniciarPosicion(p) {
  p.cantidad = 0;
  p.costeMedio = 0;
  p.stop = null;
  p.objetivoPrecio = null;
  p.abiertaT = null;
  p.maxPrecio = null;
  p.barrasAbierta = 0;
  p.riesgoInicial = null;
  p.regimenEntrada = null;
  p.comisionesPendientes = 0;
  p.deslizamientoSuma = 0;
  p.deslizamientoCantidad = 0;
}

class Libros {
  constructor(json) {
    this._puestos = new Map();
    this._aplicadas = [];            // claves `${puestoId}|${idCliente}` en orden de llegada
    this._aplicadasSet = new Set();
    this._ajustes = [];
    if (json) this._cargar(json);
  }

  _cargar(json) {
    if (json.version !== undefined && json.version !== VERSION) {
      throw new Error(`Libros: versión ${json.version} desconocida (esperada ${VERSION})`);
    }
    for (const guardado of json.puestos || []) {
      // Se parte de un puesto vacío para que un campo nuevo tenga valor aunque
      // el JSON sea de una versión anterior.
      const p = Object.assign(puestoVacio(guardado), guardado);
      p.sombra = Boolean(p.sombra);
      this._puestos.set(p.puestoId, p);
    }
    for (const clave of json.aplicadas || []) this._recordar(clave);
    this._ajustes = Array.isArray(json.ajustes) ? json.ajustes.slice(-MAX_AJUSTES) : [];
  }

  _recordar(clave) {
    if (this._aplicadasSet.has(clave)) return;
    this._aplicadas.push(clave);
    this._aplicadasSet.add(clave);
    while (this._aplicadas.length > MAX_APLICADAS) this._aplicadasSet.delete(this._aplicadas.shift());
  }

  _exigir(puestoId) {
    const p = this._puestos.get(puestoId);
    if (!p) throw new Error(`Libros: el puesto ${puestoId} no existe (llamar antes a asegurarPuesto)`);
    return p;
  }

  asegurarPuesto({ puestoId, mesaId, simbolo, sombra = false } = {}) {
    if (!puestoId || !mesaId || !simbolo) throw new Error('Libros.asegurarPuesto necesita puestoId, mesaId y simbolo');
    const existente = this._puestos.get(puestoId);
    if (existente) {
      if (existente.simbolo !== simbolo || existente.mesaId !== mesaId || existente.sombra !== Boolean(sombra)) {
        throw new Error(`Libros: el puesto ${puestoId} ya existe con otros datos (${existente.mesaId}, ${existente.simbolo}, sombra=${existente.sombra})`);
      }
      return this.puesto(puestoId);
    }
    this._puestos.set(puestoId, puestoVacio({ puestoId, mesaId, simbolo, sombra }));
    return this.puesto(puestoId);
  }

  // Copia: quien la reciba no puede tocar los libros por la puerta de atrás.
  puesto(puestoId) {
    const p = this._puestos.get(puestoId);
    return p ? { ...p } : null;
  }

  // Lista de puestos (copias). Sin `sombra`, todos; con true/false, ese libro.
  listaPuestos({ sombra } = {}) {
    const out = [];
    for (const p of this._puestos.values()) {
      if (sombra === undefined || p.sombra === Boolean(sombra)) out.push({ ...p });
    }
    return out;
  }

  aplicarEjecucion({ puestoId, lado, cantidad, precio, comision, t, motivo, idCliente, stop, objetivoPrecio, regimen, precioReferencia } = {}) {
    const p = this._exigir(puestoId);
    if (lado !== 'compra' && lado !== 'venta') throw new Error(`Libros: lado inválido «${lado}»`);
    if (!positivo(cantidad)) throw new Error(`Libros: cantidad inválida ${cantidad} en ${puestoId}`);
    if (!positivo(precio)) throw new Error(`Libros: precio inválido ${precio} en ${puestoId}`);
    // La comisión llega en dólares: la del simulado, o la ESTIMADA por
    // AlpacaBroker (comisionEstimada), que ya da la cantidad neta de lo cobrado
    // en el activo. Sin número (una orden cripto sin nada ejecutado) cuenta 0;
    // lo que quede de diferencia lo corrige escalarSimbolo al conciliar.
    const com = esNumero(comision) ? comision : 0;

    if (idCliente) {
      const clave = `${puestoId}|${idCliente}`;
      if (this._aplicadasSet.has(clave)) {
        log.aviso(`ejecución ${idCliente} ya aplicada en ${puestoId}; se ignora`);
        return { operacionCerrada: null, duplicada: true };
      }
      this._recordar(clave);
    }

    const desliz = deslizamientoEnContra(lado, precio, precioReferencia);
    const instante = esNumero(t) ? t : null;
    if (lado === 'compra') {
      this._comprar(p, { cantidad, precio, com, t: instante, stop, objetivoPrecio, regimen, desliz });
      return { operacionCerrada: null };
    }
    return this._vender(p, { cantidad, precio, com, t: instante, motivo: normalizarMotivo(motivo), idCliente, desliz });
  }

  _comprar(p, { cantidad, precio, com, t, stop, objetivoPrecio, regimen, desliz }) {
    if (p.cantidad <= EPS) {
      // Apertura: el puesto empieza de cero (lo que quedara era polvo).
      reiniciarPosicion(p);
      p.abiertaT = t;
      p.maxPrecio = precio;
      p.regimenEntrada = regimen ?? null;
      p.stop = positivo(stop) ? stop : null;
      p.objetivoPrecio = positivo(objetivoPrecio) ? objetivoPrecio : null;
    } else {
      // Aumento: el stop solo sube.
      if (positivo(stop) && (p.stop === null || stop > p.stop)) p.stop = stop;
      if (positivo(objetivoPrecio)) p.objetivoPrecio = objetivoPrecio;
      p.maxPrecio = Math.max(p.maxPrecio ?? precio, precio);
    }
    const nueva = p.cantidad + cantidad;
    p.costeMedio = (p.cantidad * p.costeMedio + cantidad * precio) / nueva;
    p.cantidad = nueva;
    p.comisionesPendientes += com;
    p.comisiones += com;
    if (p.stop !== null) {
      // Un stop por encima del precio de compra no añade riesgo (no resta).
      p.riesgoInicial = (p.riesgoInicial || 0) + Math.max(0, (precio - p.stop) * cantidad);
    }
    if (desliz !== null) {
      p.deslizamientoSuma += desliz * cantidad;
      p.deslizamientoCantidad += cantidad;
    }
    p.ultimoPrecio = precio;
    p.ultimaT = t;
  }

  _vender(p, { cantidad, precio, com, t, motivo, idCliente, desliz }) {
    if (p.cantidad <= EPS) {
      log.aviso(`venta de ${cantidad} en ${p.puestoId} sin posición en libros; no se contabiliza (la conciliación lo verá)`);
      return { operacionCerrada: null, exceso: cantidad };
    }
    let q = cantidad;
    let exceso = 0;
    const margen = Math.max(EPS, p.cantidad * RESTO_RELATIVO);
    if (q > p.cantidad) {
      exceso = q - p.cantidad;
      if (exceso > margen) log.aviso(`venta de ${cantidad} en ${p.puestoId} mayor que el puesto (${p.cantidad}); se contabiliza ${p.cantidad}`);
      else exceso = 0;
      q = p.cantidad;
    }
    const resto = p.cantidad - q;
    const cierraTodo = resto <= margen;
    const qCerrada = cierraTodo ? p.cantidad : q;
    const fraccion = cierraTodo ? 1 : q / p.cantidad;

    const comEntrada = p.comisionesPendientes * fraccion;
    const pnl = (precio - p.costeMedio) * qCerrada - com - comEntrada;
    const invertido = p.costeMedio * qCerrada;
    const riesgo = p.riesgoInicial !== null ? p.riesgoInicial * fraccion : null;
    const deslEntrada = p.deslizamientoCantidad > 0 ? p.deslizamientoSuma / p.deslizamientoCantidad : null;
    const deslizamiento = deslEntrada === null && desliz === null ? null : (deslEntrada || 0) + (desliz || 0);

    p.nOperaciones += 1;
    const operacion = {
      id: `${p.puestoId}#${p.nOperaciones}`,
      puestoId: p.puestoId,
      mesaId: p.mesaId,
      simbolo: p.simbolo,
      entradaT: p.abiertaT,
      entradaPrecio: p.costeMedio,
      salidaT: t,
      salidaPrecio: precio,
      cantidad: qCerrada,
      pnl,
      pnlPct: invertido > 0 ? pnl / invertido : null,
      comisiones: com + comEntrada,
      motivoSalida: motivo,
      barras: p.barrasAbierta,
      rMultiple: riesgo !== null && riesgo > 0 ? pnl / riesgo : null,
      regimenEntrada: p.regimenEntrada,
      deslizamiento,
      sombra: p.sombra,
      idCliente: idCliente || null,
    };

    p.realizado += pnl;
    p.comisiones += com;
    p.ultimoPrecio = precio;
    p.ultimaT = t;
    if (cierraTodo) {
      reiniciarPosicion(p);
    } else {
      p.cantidad = resto;
      p.comisionesPendientes -= comEntrada;
      if (riesgo !== null) p.riesgoInicial -= riesgo;
      p.deslizamientoSuma *= 1 - fraccion;
      p.deslizamientoCantidad *= 1 - fraccion;
    }
    const salida = { operacionCerrada: operacion };
    if (exceso > 0) salida.exceso = exceso;
    return salida;
  }

  // El stop nunca baja mientras la posición sigue abierta. Devuelve el vigente.
  fijarStop(puestoId, stop) {
    const p = this._exigir(puestoId);
    if (p.cantidad <= EPS || !positivo(stop)) return p.stop;
    if (p.stop === null || stop > p.stop) p.stop = stop;
    return p.stop;
  }

  // Una vela cerrada más con la posición abierta: cuenta barras y máximo.
  marcarVela(puestoId, precioCierre) {
    const p = this._exigir(puestoId);
    if (positivo(precioCierre)) p.ultimoPrecio = precioCierre;
    if (p.cantidad > EPS) {
      p.barrasAbierta += 1;
      if (positivo(precioCierre)) p.maxPrecio = Math.max(p.maxPrecio ?? precioCierre, precioCierre);
    }
  }

  totalesPorSimbolo({ sombra = false } = {}) {
    const out = {};
    for (const p of this._puestos.values()) {
      if (p.sombra !== Boolean(sombra) || p.cantidad <= EPS) continue;
      out[p.simbolo] = (out[p.simbolo] || 0) + p.cantidad;
    }
    return out;
  }

  // Exposiciones en DÓLARES (no en fracción: aquí no se sabe el patrimonio).
  // Sin precio de un símbolo se usa el último conocido del puesto (o su coste
  // medio) y se marca `precioEstimado`, en vez de valorar a cero.
  valorar(precios, { sombra = false } = {}) {
    const porPuesto = {};
    const porMesa = {};
    const exposicionPorActivo = {};
    const simbolosAbiertos = new Set();
    let exposicionBruta = 0;
    let exposicionCripto = 0;
    let pnlAbiertoTotal = 0;
    let puestosAbiertos = 0;
    const preciosEstimados = new Set();

    for (const p of this._puestos.values()) {
      if (p.sombra !== Boolean(sombra)) continue;
      const abierta = p.cantidad > EPS;
      let px = precioDe(precios, p.simbolo);
      let estimado = false;
      if (px === null && abierta) {
        px = positivo(p.ultimoPrecio) ? p.ultimoPrecio : p.costeMedio;
        estimado = true;
        preciosEstimados.add(p.simbolo);
      }
      const valor = abierta ? p.cantidad * px : 0;
      const invertido = abierta ? p.costeMedio * p.cantidad : 0;
      // Abierto neto de las comisiones de entrada: lo que quedaría al cerrar a
      // este precio antes de la comisión de salida.
      const pnlAbierto = abierta ? (px - p.costeMedio) * p.cantidad - p.comisionesPendientes : 0;

      porPuesto[p.puestoId] = {
        puestoId: p.puestoId,
        mesaId: p.mesaId,
        simbolo: p.simbolo,
        cantidad: abierta ? p.cantidad : 0,
        precio: px,
        valor,
        costeMedio: abierta ? p.costeMedio : null,
        stop: p.stop,
        pnlAbierto,
        pnlAbiertoPct: invertido > 0 ? pnlAbierto / invertido : null,
        realizado: p.realizado,
        precioEstimado: estimado,
      };

      const mesa = porMesa[p.mesaId] || (porMesa[p.mesaId] = { valor: 0, pnlAbierto: 0, realizado: 0, posiciones: 0 });
      mesa.valor += valor;
      mesa.pnlAbierto += pnlAbierto;
      mesa.realizado += p.realizado;
      if (abierta) {
        mesa.posiciones += 1;
        puestosAbiertos += 1;
        simbolosAbiertos.add(p.simbolo);
        exposicionPorActivo[p.simbolo] = (exposicionPorActivo[p.simbolo] || 0) + valor;
        exposicionBruta += Math.abs(valor);
        if (universo.esCripto(p.simbolo)) exposicionCripto += Math.abs(valor);
        pnlAbiertoTotal += pnlAbierto;
      }
    }

    return {
      porPuesto,
      porMesa,
      exposicionBruta,
      exposicionCripto,
      exposicionPorActivo,
      // Posiciones = símbolos distintos (lo que ve el bróker): dos mesas en BTC son una posición.
      posicionesAbiertas: simbolosAbiertos.size,
      puestosAbiertos,
      valorTotal: exposicionBruta,
      pnlAbierto: pnlAbiertoTotal,
      preciosEstimados: [...preciosEstimados],
    };
  }

  // Conciliación: multiplica la cantidad de cada puesto no-sombra del símbolo
  // por `factor`, que reparte la diferencia a prorrata. Lo pagado sigue
  // pagado: el valor que desaparece (la comisión cobrada en el activo) pasa a
  // comisiones de entrada, y se imputará al vender.
  escalarSimbolo(simbolo, factor, motivo) {
    if (!positivo(factor)) throw new Error(`Libros.escalarSimbolo: factor inválido ${factor}`);
    const ajustados = [];
    for (const p of this._puestos.values()) {
      if (p.sombra || p.simbolo !== simbolo || p.cantidad <= EPS) continue;
      const antes = p.cantidad;
      const despues = antes * factor;
      const ajusteUsd = (antes - despues) * p.costeMedio;
      p.cantidad = despues;
      p.comisionesPendientes += ajusteUsd;
      p.comisiones += ajusteUsd;
      p.deslizamientoSuma *= factor;
      p.deslizamientoCantidad *= factor;
      ajustados.push({ puestoId: p.puestoId, antes, despues, ajusteUsd });
    }
    if (ajustados.length) {
      this._ajustes.push({ simbolo, factor, motivo: motivo ?? null, puestos: ajustados.map(a => a.puestoId) });
      if (this._ajustes.length > MAX_AJUSTES) this._ajustes.splice(0, this._ajustes.length - MAX_AJUSTES);
    }
    return { ajustados };
  }

  ajustes() {
    return this._ajustes.map(a => ({ ...a, puestos: [...a.puestos] }));
  }

  serializar() {
    return {
      version: VERSION,
      puestos: [...this._puestos.values()].map(p => ({ ...p })),
      aplicadas: [...this._aplicadas],
      ajustes: this.ajustes(),
    };
  }
}

module.exports = { Libros, MOTIVOS_SALIDA, precioDe };
