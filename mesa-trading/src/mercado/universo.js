'use strict';
// Universo de activos (ARQUITECTURA §2). El símbolo canónico es el de las
// órdenes y los datos de Alpaca: cripto con barra ('BTC/USD'), acciones sin ella.
// Las posiciones cripto de Alpaca llegan SIN barra ('BTCUSD'), de ahí clave() y
// desdeClave().

const MARCOS = Object.freeze({ '1Hour': 3_600_000, '4Hour': 14_400_000, '1Day': 86_400_000 });

// Tipo de activo (30-sep-2026, para el capital de la cabecera y la vista
// Estrategias): qué es cada cosa para quien no sabe de bolsa. Los ETF de
// sectores (XLE, XLK, XLF) son cestas de acciones de empresas: «Acciones».
// VIXY no es ninguno de los cinco (futuros sobre la volatilidad) y nadie lo
// opera: nunca sale en un desglose.
const TIPOS = Object.freeze([
  { id: 'cripto', nombre: 'Cripto' },
  { id: 'indices', nombre: 'Índices' },
  { id: 'bonos', nombre: 'Bonos' },
  { id: 'materias', nombre: 'Materias primas' },
  { id: 'acciones', nombre: 'Acciones' },
  { id: 'volatilidad', nombre: 'Volatilidad' },
].map(t => Object.freeze(t)));
const TIPO_OTROS = Object.freeze({ id: 'otros', nombre: 'Otros' });

const UNIVERSO = Object.freeze([
  // Cripto: funcionan sin claves (endpoint público de datos, ficha §3).
  { simbolo: 'BTC/USD', etiqueta: 'BTC', clase: 'cripto', tipo: 'cripto', nombre: 'Bitcoin' },
  { simbolo: 'ETH/USD', etiqueta: 'ETH', clase: 'cripto', tipo: 'cripto', nombre: 'Ethereum' },
  { simbolo: 'SOL/USD', etiqueta: 'SOL', clase: 'cripto', tipo: 'cripto', nombre: 'Solana' },
  { simbolo: 'LINK/USD', etiqueta: 'LINK', clase: 'cripto', tipo: 'cripto', nombre: 'Chainlink' },
  { simbolo: 'AVAX/USD', etiqueta: 'AVAX', clase: 'cripto', tipo: 'cripto', nombre: 'Avalanche' },
  { simbolo: 'DOGE/USD', etiqueta: 'DOGE', clase: 'cripto', tipo: 'cripto', nombre: 'Dogecoin' },
  // Ampliación del 30-sep-2026 (decisión de Eduardo con el histórico real):
  // solo las opera la mesa «Momentum cripto ampliada», en incubación. La
  // titular sigue con sus 6: con LTC y BCH su Sharpe baja de 0,63 a 0,40
  // (dic-2021 → sep-2026) y con XRP, de 0,81 a 0,65 (ene-2024 → sep-2026); ADA
  // solo tiene 7 meses en Alpaca (docs/estudios/ampliada-2026-09-30.json).
  { simbolo: 'XRP/USD', etiqueta: 'XRP', clase: 'cripto', tipo: 'cripto', nombre: 'XRP', desde: 2 },
  { simbolo: 'LTC/USD', etiqueta: 'LTC', clase: 'cripto', tipo: 'cripto', nombre: 'Litecoin', desde: 2 },
  { simbolo: 'BCH/USD', etiqueta: 'BCH', clase: 'cripto', tipo: 'cripto', nombre: 'Bitcoin Cash', desde: 2 },
  { simbolo: 'ADA/USD', etiqueta: 'ADA', clase: 'cripto', tipo: 'cripto', nombre: 'Cardano', desde: 2 },
  // ETF: solo con claves de Alpaca (feed IEX).
  { simbolo: 'SPY', etiqueta: 'SPY', clase: 'accion', tipo: 'indices', nombre: 'S&P 500 (SPDR)' },
  { simbolo: 'QQQ', etiqueta: 'QQQ', clase: 'accion', tipo: 'indices', nombre: 'Nasdaq 100 (Invesco QQQ)' },
  { simbolo: 'IWM', etiqueta: 'IWM', clase: 'accion', tipo: 'indices', nombre: 'Russell 2000 (iShares)' },
  { simbolo: 'TLT', etiqueta: 'TLT', clase: 'accion', tipo: 'bonos', nombre: 'Bonos EE. UU. 20+ años (iShares)' },
  { simbolo: 'GLD', etiqueta: 'GLD', clase: 'accion', tipo: 'materias', nombre: 'Oro (SPDR)' },
  { simbolo: 'XLE', etiqueta: 'XLE', clase: 'accion', tipo: 'acciones', nombre: 'Energía (Select Sector SPDR)' },
  { simbolo: 'XLK', etiqueta: 'XLK', clase: 'accion', tipo: 'acciones', nombre: 'Tecnología (Select Sector SPDR)' },
  { simbolo: 'XLF', etiqueta: 'XLF', clase: 'accion', tipo: 'acciones', nombre: 'Financieras (Select Sector SPDR)' },
  { simbolo: 'DIA', etiqueta: 'DIA', clase: 'accion', tipo: 'indices', nombre: 'Dow Jones 30 (SPDR)', desde: 2 },
  // SOLO DATO: el termómetro del miedo para Macro (§4.2). Ninguna mesa lo
  // opera: no tiene analista, ni puesto, ni orden (disponibles() no lo da y
  // el Ejecutor rechaza cualquier orden suya).
  { simbolo: 'VIXY', etiqueta: 'VIXY', clase: 'accion', tipo: 'volatilidad', nombre: 'Futuros del VIX a corto (ProShares)', soloDato: true, desde: 2 },
].map(a => Object.freeze(a)));

const POR_SIMBOLO = new Map(UNIVERSO.map(a => [a.simbolo, a]));
const POR_ETIQUETA = new Map(UNIVERSO.map(a => [a.etiqueta, a]));
const POR_CLAVE = new Map(UNIVERSO.map(a => [a.simbolo.replace('/', ''), a]));

// Monedas de cotización que Alpaca admite en pares cripto (ficha §2).
const COTIZACIONES = ['USDT', 'USDC', 'USD', 'BTC'];

function porSimbolo(s) { return POR_SIMBOLO.get(s) || null; }
function porEtiqueta(e) { return POR_ETIQUETA.get(String(e || '').toUpperCase()) || null; }

// 'BTC/USD' → 'BTCUSD' (así vienen las posiciones cripto y así se piden noticias).
function clave(s) { return String(s).replace('/', ''); }

// 'BTCUSD' → 'BTC/USD'. Con { clase: 'accion' } (o 'us_equity') no se toca: un
// ticker de acción que acabe en USD no es un par. Sin clase, fuera del universo
// solo se parte si termina en una cotización conocida.
function desdeClave(k, { clase } = {}) {
  const s = String(k || '');
  if (!s || s.includes('/')) return s;
  const conocido = POR_CLAVE.get(s);
  if (conocido) return conocido.simbolo;
  if (clase === 'accion' || clase === 'us_equity') return s;
  for (const q of COTIZACIONES) {
    if (s.length > q.length + 1 && s.endsWith(q)) return `${s.slice(0, -q.length)}/${q}`;
  }
  return s;
}

function esCripto(s) {
  const a = POR_SIMBOLO.get(s);
  if (a) return a.clase === 'cripto';
  return String(s || '').includes('/');
}

// Un activo que solo es dato (VIXY): nadie lo opera.
function esSoloDato(s) {
  const a = POR_SIMBOLO.get(s);
  return Boolean(a && a.soloDato);
}

// Lo que se puede operar. Sin claves de Alpaca solo hay datos (y bróker
// simulado) de las cripto. Los de solo dato no salen nunca de aquí.
function disponibles({ hayAlpaca = false } = {}) {
  return UNIVERSO.filter(a => !a.soloDato && (a.clase === 'cripto' || hayAlpaca));
}

// `desde`: 1 (sin campo) el universo original; 2 la ampliación del 30-sep-2026.
// Sirve para que los agentes nuevos no cambien el nombre de los que ya había
// (src/agentes/registro.js).
function generacion(s) {
  const a = POR_SIMBOLO.get(s);
  return a && a.desde ? a.desde : 1;
}

// Tipo de un símbolo ('cripto', 'indices'…). Fuera del universo (una posición
// del bróker que el fondo no conoce) no se adivina: 'otros'.
function tipoDe(s) {
  const a = POR_SIMBOLO.get(s) || POR_SIMBOLO.get(desdeClave(s));
  return a ? a.tipo : TIPO_OTROS.id;
}

function nombreTipo(id) {
  const t = TIPOS.find(x => x.id === id);
  return t ? t.nombre : TIPO_OTROS.nombre;
}

const CRIPTO = Object.freeze(UNIVERSO.filter(a => a.clase === 'cripto').map(a => a.simbolo));
// La cesta de «comprar y mantener» cripto (§5.5) son las 6 originales: la
// ampliación no la cambia (una cartera sombra no se redefine a mitad).
const CESTA_CRIPTO = Object.freeze(['BTC/USD', 'ETH/USD', 'SOL/USD', 'LINK/USD', 'AVAX/USD', 'DOGE/USD']);
const ETF = Object.freeze(UNIVERSO.filter(a => a.clase === 'accion' && !a.soloDato).map(a => a.simbolo));
const SOLO_DATO = Object.freeze(UNIVERSO.filter(a => a.soloDato).map(a => a.simbolo));

module.exports = {
  MARCOS, UNIVERSO, CRIPTO, CESTA_CRIPTO, ETF, SOLO_DATO, TIPOS, TIPO_OTROS,
  porSimbolo, porEtiqueta, clave, desdeClave, disponibles, esCripto, esSoloDato, generacion, tipoDe, nombreTipo,
};
