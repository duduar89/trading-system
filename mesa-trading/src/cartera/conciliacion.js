'use strict';
// Conciliación libros ↔ bróker — ARQUITECTURA §5.2.
//
// El bróker es la verdad (principio 4). Se compara la cantidad por símbolo de
// los puestos NO-sombra con las posiciones del bróker:
// - diferencia relativa ≤ tolerancia → escalar. Es el caso normal en cripto:
//   Alpaca cobra la comisión de compra en el activo, así que de 0,01 BTC
//   pedidos llegan 0,009975 (ficha §4, crítica §2.4).
// - mayor → grave (algo se ha perdido por el camino; lo mira un humano).
// - posición en el bróker sin puesto → huérfana; puesto sin posición → fantasma.
//
// Esta función no toca los libros: devuelve las acciones y quien orquesta
// aplica los escalados con libros.escalarSimbolo().

const universo = require('../mercado/universo');
const { cantidad: fCantidad, pct, usd } = require('../util/formato');
const { precioDe } = require('./libros');

const IGUAL_RELATIVO = 1e-9;   // por debajo, es la misma cantidad (ruido de coma flotante)

function etiqueta(simbolo) {
  const a = universo.porSimbolo(simbolo);
  return a ? a.etiqueta : simbolo;
}

function conciliar({ posicionesBroker = [], libros, tolerancia = 0.01, precios = null, minValorUsd = 1 } = {}) {
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
      if (Math.abs(dif) <= IGUAL_RELATIVO) {
        cuadran += 1;
      } else if (Math.abs(dif) <= tolerancia + IGUAL_RELATIVO) {
        const factor = qB / qL;
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

module.exports = { conciliar };
