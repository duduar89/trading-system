'use strict';
// Universo de activos (ARQUITECTURA §2). El símbolo canónico es el de las
// órdenes y los datos de Alpaca: cripto con barra ('BTC/USD'), acciones sin ella.
// Las posiciones cripto de Alpaca llegan SIN barra ('BTCUSD'), de ahí clave() y
// desdeClave().

const MARCOS = Object.freeze({ '1Hour': 3_600_000, '4Hour': 14_400_000, '1Day': 86_400_000 });

const UNIVERSO = Object.freeze([
  // Cripto: funcionan sin claves (endpoint público de datos, ficha §3).
  { simbolo: 'BTC/USD', etiqueta: 'BTC', clase: 'cripto', nombre: 'Bitcoin' },
  { simbolo: 'ETH/USD', etiqueta: 'ETH', clase: 'cripto', nombre: 'Ethereum' },
  { simbolo: 'SOL/USD', etiqueta: 'SOL', clase: 'cripto', nombre: 'Solana' },
  { simbolo: 'LINK/USD', etiqueta: 'LINK', clase: 'cripto', nombre: 'Chainlink' },
  { simbolo: 'AVAX/USD', etiqueta: 'AVAX', clase: 'cripto', nombre: 'Avalanche' },
  { simbolo: 'DOGE/USD', etiqueta: 'DOGE', clase: 'cripto', nombre: 'Dogecoin' },
  // ETF: solo con claves de Alpaca (feed IEX).
  { simbolo: 'SPY', etiqueta: 'SPY', clase: 'accion', nombre: 'S&P 500 (SPDR)' },
  { simbolo: 'QQQ', etiqueta: 'QQQ', clase: 'accion', nombre: 'Nasdaq 100 (Invesco QQQ)' },
  { simbolo: 'IWM', etiqueta: 'IWM', clase: 'accion', nombre: 'Russell 2000 (iShares)' },
  { simbolo: 'TLT', etiqueta: 'TLT', clase: 'accion', nombre: 'Bonos EE. UU. 20+ años (iShares)' },
  { simbolo: 'GLD', etiqueta: 'GLD', clase: 'accion', nombre: 'Oro (SPDR)' },
  { simbolo: 'XLE', etiqueta: 'XLE', clase: 'accion', nombre: 'Energía (Select Sector SPDR)' },
  { simbolo: 'XLK', etiqueta: 'XLK', clase: 'accion', nombre: 'Tecnología (Select Sector SPDR)' },
  { simbolo: 'XLF', etiqueta: 'XLF', clase: 'accion', nombre: 'Financieras (Select Sector SPDR)' },
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

// Sin claves de Alpaca solo hay datos (y bróker simulado) de las cripto.
function disponibles({ hayAlpaca = false } = {}) {
  return UNIVERSO.filter(a => a.clase === 'cripto' || hayAlpaca);
}

const CRIPTO = Object.freeze(UNIVERSO.filter(a => a.clase === 'cripto').map(a => a.simbolo));
const ETF = Object.freeze(UNIVERSO.filter(a => a.clase === 'accion').map(a => a.simbolo));

module.exports = {
  MARCOS, UNIVERSO, CRIPTO, ETF,
  porSimbolo, porEtiqueta, clave, desdeClave, disponibles, esCripto,
};
