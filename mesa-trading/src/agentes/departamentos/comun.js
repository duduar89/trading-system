'use strict';
// Piezas que comparten los departamentos (§6.7-§6.9): ids de puesto, etiquetas,
// sesgo del analista y el rellenado de un puesto sombra.
//
// Todos los departamentos reciben el mismo contexto: el propio Orquestador,
// que expone { reloj, bus, estado, datos, broker, llm, fg, config, limites,
// libros, universo, plantilla, vivo, ejecutor, opciones } y unas pocas
// ayudas (moverAgente, refrescarCartera, registrarOperacion, kill…). Se pasa
// el objeto vivo y no una copia porque `estado` y `libros` se sustituyen al
// cargar desde disco.

const universo = require('../../mercado/universo');
const { COSTES_POR_DEFECTO } = require('../../broker/simulado');

const EPS = 1e-12;

function etiqueta(simbolo) {
  const a = universo.porSimbolo(simbolo);
  return a ? a.etiqueta : String(simbolo || '').split('/')[0];
}

// Un puesto = mesa × símbolo (§5.1). El agente que lo lleva es puesto-<id>
// (registro.js) y la interfaz los empareja por ese nombre.
function puestoId(mesaId, simbolo) { return `${mesaId}-${etiqueta(simbolo)}`; }
function puestoSombraId(mesaId, simbolo) { return `${puestoId(mesaId, simbolo)}@sombra`; }
function agenteDePuesto(mesaId, simbolo) { return `puesto-${puestoId(mesaId, simbolo)}`; }

// Precio plano de { sim: { precio, t } }.
function precioDe(precios, simbolo) {
  const v = precios && precios[simbolo];
  if (!v) return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  return v.precio > 0 ? v.precio : null;
}

// «2026-09-29T04:00:00.000Z» → «20260929T0400Z» (para el idCliente).
function isoCompacto(t) {
  return new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace(/00Z$/, 'Z');
}

// El sombra «sin comité» (§6.7) no pasa por el bróker: se llena en los libros
// al precio actual con los MISMOS costes que el bróker simulado (comisión
// cripto cobrada en el activo al comprar, en dólares al vender).
function llenarSombra({ lado, simbolo, precio, nocional, cantidad }) {
  const c = COSTES_POR_DEFECTO.comision(simbolo);
  const d = COSTES_POR_DEFECTO.deslizamiento(simbolo);
  if (lado === 'compra') {
    const precioEjec = precio * (1 + d);
    const bruta = nocional / precioEjec;
    const cripto = universo.esCripto(simbolo);
    return {
      precio: precioEjec,
      cantidad: cripto ? bruta * (1 - c) : bruta,
      comision: nocional * c,
      efectivoDelta: -(cripto ? nocional : nocional * (1 + c)),
    };
  }
  const precioEjec = precio * (1 - d);
  const bruto = cantidad * precioEjec;
  const comision = bruto * c;
  return { precio: precioEjec, cantidad, comision, efectivoDelta: bruto - comision };
}

// Posición de los libros en la forma que esperan decidir() y trailing().
function posicionDe(p) {
  if (!p || !(p.cantidad > EPS)) return null;
  return {
    cantidad: p.cantidad,
    entrada: p.costeMedio,
    entradaT: p.abiertaT,
    stop: p.stop,
    maxPrecio: p.maxPrecio,
    barrasAbierta: p.barrasAbierta,
  };
}

module.exports = { EPS, etiqueta, puestoId, puestoSombraId, agenteDePuesto, precioDe, isoCompacto, llenarSombra, posicionDe };
