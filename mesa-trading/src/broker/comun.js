'use strict';
// Piezas que comparten AlpacaBroker y BrokerSimulado para cumplir el mismo
// contrato (ARQUITECTURA §3.4): costes por defecto, redondeo a 9 decimales y
// la comprobación de que una orden ya existente con nuestro idCliente es de
// verdad la que se quería enviar.

const universo = require('../mercado/universo');

const DECIMALES = 9;                    // Alpaca admite hasta 9 decimales en qty
const redondear9 = x => Number(Number(x).toFixed(DECIMALES));

// Costes por defecto: comisión taker nivel 1 de Alpaca cripto (0,25 %, ficha
// §4), acciones sin comisión. Deslizamiento: BTC/ETH 5 pb, resto cripto 15 pb,
// ETF 2 pb (§3.4). Misma forma que los `costes` del backtest.
const COSTES_POR_DEFECTO = Object.freeze({
  comision: s => (universo.esCripto(s) ? 0.0025 : 0),
  deslizamiento: s => {
    if (s === 'BTC/USD' || s === 'ETH/USD') return 0.0005;
    return universo.esCripto(s) ? 0.0015 : 0.0002;
  },
});

// Acepta funciones (sim → fracción), números fijos o mapas { simbolo: fracción }.
function aFuncion(valor, porDefecto) {
  if (typeof valor === 'function') return valor;
  if (typeof valor === 'number') return () => valor;
  if (valor && typeof valor === 'object') return s => (s in valor ? valor[s] : porDefecto(s));
  return porDefecto;
}

const mismoImporte = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// ¿La orden `existente` (del bróker, con nuestro idCliente) es la que se pide
// ahora? Mismo símbolo canónico, mismo lado y mismo importe (nocional o
// cantidad, el que se pidió). Si el bróker no trae el importe de esa clase no
// se puede comparar y no se rechaza por él; si trae el de la otra clase, es
// otra orden (las ventas van por cantidad y las compras por nocional).
// Devuelve null si coincide o el motivo si no.
function diferenciaOrden(existente, pedida) {
  if (!existente) return 'no existe';
  const sExistente = universo.desdeClave(existente.simbolo);
  const sPedida = universo.desdeClave(pedida.simbolo);
  if (sExistente !== sPedida) return `símbolo ${sExistente} en vez de ${sPedida}`;
  if (existente.lado !== pedida.lado) return `lado ${existente.lado} en vez de ${pedida.lado}`;
  const hayNocional = pedida.nocional !== undefined && pedida.nocional !== null;
  const campo = hayNocional ? 'nocional' : 'cantidad';
  const otro = hayNocional ? 'cantidad' : 'nocional';
  const pedido = Number(hayNocional ? pedida.nocional : pedida.cantidad);
  const suyo = existente[campo];
  if (suyo === null || suyo === undefined) {
    // Una compra por nocional puede traer qty ya rellena tras ejecutarse, pero
    // no al revés: una venta por cantidad nunca trae nocional.
    if (!hayNocional && existente[otro] !== null && existente[otro] !== undefined) return `es una orden por ${otro}, no por ${campo}`;
    return null;
  }
  if (!mismoImporte(Number(suyo), redondear9(pedido))) return `${campo} ${suyo} en vez de ${redondear9(pedido)}`;
  return null;
}

module.exports = { COSTES_POR_DEFECTO, DECIMALES, aFuncion, redondear9, diferenciaOrden };
