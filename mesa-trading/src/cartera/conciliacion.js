'use strict';
// Conciliación libros ↔ bróker — ARQUITECTURA §5.2.
//
// El bróker es la verdad (principio 4). Se compara la cantidad por símbolo de
// los puestos NO-sombra con las posiciones del bróker:
// - diferencia relativa ≤ tolerancia → escalar. Alpaca cobra la comisión de
//   compra en el activo (de 0,01 BTC pedidos llegan 0,009975, ficha §4) y
//   AlpacaBroker ya da esa cantidad neta con la tasa estimada; lo que queda
//   para escalar es el resto: otra tasa de verdad (otro nivel, o una cuenta
//   paper que no cobre) y los redondeos del incremento del activo.
// - mayor → grave (algo se ha perdido por el camino; lo mira un humano).
// - posición en el bróker sin puesto → huérfana; puesto sin posición → fantasma.
//
// Esta función no toca los libros: devuelve las acciones y quien orquesta
// aplica los escalados con libros.escalarSimbolo().

const universo = require('../mercado/universo');
const { cantidad: fCantidad, pct, usd } = require('../util/formato');
const { precioDe } = require('./libros');

const IGUAL_RELATIVO = 1e-9;   // por debajo, es la misma cantidad (ruido de coma flotante)
const TOLERANCIA = 0.01;       // hasta aquí la diferencia es comisión cobrada en el activo o redondeo

// Regla única de «se escala» (la usan conciliar y el Ejecutor antes de vender):
// factor bróker/libros si la diferencia relativa es mayor que el ruido y cabe
// en la tolerancia; null si no hay nada que escalar o si es grave.
function factorEscalado(qLibros, qBroker, tolerancia = TOLERANCIA) {
  if (!(qLibros > 0) || !(qBroker > 0)) return null;
  const dif = (qBroker - qLibros) / qLibros;
  if (Math.abs(dif) <= IGUAL_RELATIVO || Math.abs(dif) > tolerancia + IGUAL_RELATIVO) return null;
  return qBroker / qLibros;
}

function etiqueta(simbolo) {
  const a = universo.porSimbolo(simbolo);
  return a ? a.etiqueta : simbolo;
}

function conciliar({ posicionesBroker = [], libros, tolerancia = TOLERANCIA, precios = null, minValorUsd = 1 } = {}) {
  if (!libros || typeof libros.totalesPorSimbolo !== 'function') throw new Error('conciliar necesita los libros');
  const enLibros = libros.totalesPorSimbolo({ sombra: false });
  const enBroker = {};
  for (const pos of posicionesBroker || []) {
    // El bróker ya da el símbolo canónico; desdeClave cubre un 'BTCUSD' que se cuele.
    const s = universo.desdeClave(pos.simbolo);
    const q = Number(pos.cantidad);
    if (!s || !Number.isFinite(q) || q === 0) continue;
    enBroker[s] = (enBroker[s] || 0) + q;
  }

  // Con precios, lo que vale menos de minValorUsd es polvo (restos de redondeo):
  // se informa pero no se convierte en acción.
  const esPolvo = (s, q) => {
    const px = precioDe(precios, s);
    return px !== null && Math.abs(q) * px < minValorUsd;
  };

  const acciones = [];
  const descuadres = [];
  const ignoradas = [];
  const frases = [];
  let cuadran = 0;
  let grave = false;
  const simbolos = [...new Set([...Object.keys(enLibros), ...Object.keys(enBroker)])].sort();

  for (const s of simbolos) {
    const qL = enLibros[s] || 0;
    const qB = enBroker[s] || 0;
    const e = etiqueta(s);
    if (qL > 0 && qB !== 0) {
      const dif = (qB - qL) / qL;
      const factor = factorEscalado(qL, qB, tolerancia);
      if (Math.abs(dif) <= IGUAL_RELATIVO) {
        cuadran += 1;
      } else if (factor !== null) {
        acciones.push({ tipo: 'escalar', simbolo: s, factor });
        frases.push(`${e}: libros ${fCantidad(qL, 9)}, bróker ${fCantidad(qB, 9)} (${pct(dif, { signo: true })}) → se escala ×${fCantidad(factor, 6)}.`);
      } else {
        grave = true;
        descuadres.push({ simbolo: s, cantidadLibros: qL, cantidadBroker: qB, diferencia: dif });
        frases.push(`Descuadre grave en ${e}: libros ${fCantidad(qL, 9)}, bróker ${fCantidad(qB, 9)} (${pct(dif, { signo: true })}; tolerancia ${pct(tolerancia)}).`);
      }
    } else if (qB !== 0) {
      if (esPolvo(s, qB)) {
        ignoradas.push({ tipo: 'huerfana', simbolo: s, cantidad: qB });
        continue;
      }
      acciones.push({ tipo: 'huerfana', simbolo: s, cantidad: qB });
      const px = precioDe(precios, s);
      frases.push(`Huérfana: ${fCantidad(qB, 9)} ${e} en el bróker sin puesto${px !== null ? ` (${usd(qB * px)})` : ''}.`);
    } else if (qL > 0) {
      if (esPolvo(s, qL)) {
        ignoradas.push({ tipo: 'fantasma', simbolo: s, cantidadLibros: qL });
        continue;
      }
      acciones.push({ tipo: 'fantasma', simbolo: s, cantidadLibros: qL });
      frases.push(`Fantasma: ${fCantidad(qL, 9)} ${e} en libros sin posición en el bróker.`);
    }
  }

  const hayHuerfanas = acciones.some(a => a.tipo === 'huerfana');
  const hayFantasmas = acciones.some(a => a.tipo === 'fantasma');
  // Limpia = nada que requiera a un humano; los escalados se corrigen solos.
  const limpia = !grave && !hayHuerfanas && !hayFantasmas;
  let resumen;
  if (!simbolos.length) resumen = 'Conciliación: sin posiciones ni en libros ni en el bróker.';
  else if (!frases.length) resumen = `Conciliación limpia: ${cuadran} ${cuadran === 1 ? 'símbolo cuadra' : 'símbolos cuadran'} con el bróker.`;
  else resumen = `Conciliación${limpia ? '' : ' con incidencias'}: ${frases.join(' ')}${cuadran ? ` ${cuadran} más ${cuadran === 1 ? 'cuadra' : 'cuadran'}.` : ''}`;

  return { acciones, grave, limpia, descuadres, ignoradas, resumen };
}

// Exposición con la verdad del bróker (principio 4): por símbolo, el máximo
// entre lo que dicen los libros y lo que hay en el bróker. Una posición del
// bróker sin puesto (huérfana: cuenta paper usada antes, otra carpeta sobre la
// misma cuenta, una orden que entró sin que el fondo lo supiera) cuenta así
// para los topes por activo, cripto, bruta y de posiciones. Se toma el máximo,
// no solo el bróker, para que una orden en vuelo o una lectura algo vieja de
// las posiciones no rebaje la cifra. porPuesto y porMesa (el P&L de las mesas)
// no cambian.
function exposicionConBroker(val, posicionesBroker) {
  const porActivo = { ...(val.exposicionPorActivo || {}) };
  for (const q of posicionesBroker || []) {
    const s = universo.desdeClave(q.simbolo);
    const v = Math.abs(Number(q.valor) || 0);
    if (s && v > (porActivo[s] || 0)) porActivo[s] = v;
  }
  let bruta = 0; let cripto = 0; let n = 0;
  for (const [s, v] of Object.entries(porActivo)) {
    if (!(v > 0)) continue;
    bruta += v;
    n++;
    if (universo.esCripto(s)) cripto += v;
  }
  return { ...val, exposicionPorActivo: porActivo, exposicionBruta: bruta, exposicionCripto: cripto, posicionesAbiertas: n };
}

module.exports = { conciliar, factorEscalado, exposicionConBroker, TOLERANCIA };
