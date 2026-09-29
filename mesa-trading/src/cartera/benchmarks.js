'use strict';
// Carteras sombra de comprar y mantener — ARQUITECTURA §5.5.
//
// «Mejorar» se mide contra ellas (principio 7): 100 % BTC, cesta cripto a
// partes iguales y, con claves de Alpaca, 100 % SPY y 50/50 BTC-SPY. Se
// compran una vez, al empezar, y no se rebalancean nunca. Pagan su coste de
// entrada igual que el fondo (comisión cripto en el activo, como Alpaca, más
// la penalización de papel si se pasa), para comparar neto contra neto.
// La sombra «mismas mesas sin comité» no está aquí: la lleva F con puestos
// sombra en los libros.

const universo = require('../mercado/universo');
const { precioDe } = require('./libros');

const VERSION = 1;

// Comisión por defecto: la de Alpaca (taker nivel 1 cripto 0,25 %, acciones 0; ficha §4).
const comisionPorDefecto = s => (universo.esCripto(s) ? 0.0025 : 0);

const CARTERAS = Object.freeze([
  { id: 'btc', nombre: '100 % BTC', pesos: { 'BTC/USD': 1 }, conAlpaca: false },
  { id: 'cesta-cripto', nombre: 'Cesta cripto a partes iguales', pesos: 'cripto', conAlpaca: false },
  { id: 'spy', nombre: '100 % SPY', pesos: { SPY: 1 }, conAlpaca: true },
  { id: 'btc-spy', nombre: '50 % BTC · 50 % SPY', pesos: { 'BTC/USD': 0.5, SPY: 0.5 }, conAlpaca: true },
]);

function aFuncion(c) {
  if (typeof c === 'function') return c;
  if (typeof c === 'number') return () => c;
  return comisionPorDefecto;
}

function crearBenchmarks({ capital, preciosIniciales, hayAlpaca = false, t = null, comision, penalizacion = 0 } = {}) {
  if (!(capital > 0)) throw new Error(`crearBenchmarks: capital inválido ${capital}`);
  const fComision = aFuncion(comision);
  const carteras = [];
  const omitidos = [];

  for (const def of CARTERAS) {
    if (def.conAlpaca && !hayAlpaca) continue;
    let pesos = def.pesos;
    if (pesos === 'cripto') {
      // Solo las cripto con precio: una cesta a partes iguales de lo que hay.
      const conPrecio = universo.CRIPTO.filter(s => precioDe(preciosIniciales, s) !== null);
      pesos = Object.fromEntries(conPrecio.map(s => [s, 1 / conPrecio.length]));
    }
    const sinPrecio = Object.keys(pesos).filter(s => precioDe(preciosIniciales, s) === null);
    if (!Object.keys(pesos).length || sinPrecio.length) {
      omitidos.push({ id: def.id, motivo: `sin precio inicial de ${sinPrecio.join(', ') || 'ningún activo'}` });
      continue;
    }
    const componentes = Object.entries(pesos).map(([simbolo, peso]) => {
      const precioInicial = precioDe(preciosIniciales, simbolo);
      const importe = capital * peso;
      // Se compra neto de comisión y de penalización: recibes menos activo.
      const cantidad = (importe / precioInicial) * (1 - fComision(simbolo)) * (1 - penalizacion);
      return { simbolo, peso, importe, precioInicial, cantidad };
    });
    carteras.push({ id: def.id, nombre: def.nombre, componentes });
  }

  if (!carteras.some(c => c.id === 'btc')) throw new Error('crearBenchmarks: hace falta el precio de BTC/USD');
  return { version: VERSION, capital, t, penalizacion, carteras, omitidos };
}

// Un precio que falta deja la cartera sin valor (null) en vez de inventarlo.
function valorarBenchmarks(estado, precios) {
  if (!estado || !Array.isArray(estado.carteras)) return [];
  return estado.carteras.map(c => {
    let valor = 0;
    for (const comp of c.componentes) {
      const px = precioDe(precios, comp.simbolo);
      if (px === null) { valor = null; break; }
      valor += comp.cantidad * px;
    }
    return {
      id: c.id,
      nombre: c.nombre,
      valor,
      rentabilidad: valor === null ? null : valor / estado.capital - 1,
    };
  });
}

module.exports = { crearBenchmarks, valorarBenchmarks, CARTERAS };
