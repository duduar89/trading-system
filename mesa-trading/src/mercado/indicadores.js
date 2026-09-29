'use strict';
// Indicadores técnicos (§4.1 de ARQUITECTURA.md).
//
// Todas las funciones devuelven un array ALINEADO con la entrada (mismo largo,
// null donde aún no hay datos) y son CAUSALES: el valor en i depende solo de
// 0..i. Por eso se calculan de izquierda a derecha sin mirar nunca a i+1, y la
// prueba de causalidad (calcular sobre N y N+50 velas) da los mismos N valores.
//
// Un null en la entrada (p. ej. al encadenar sma(rsi(...))) se trata como
// "sin dato": las ventanas que lo contienen devuelven null.

function esNum(x) { return typeof x === 'number' && Number.isFinite(x); }

function comprobarN(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`periodo inválido: ${n}`);
}

function cierres(velas) { return velas.map(v => v.c); }

// Media simple con suma rodante. Se recalcula la suma desde cero cada 1.000
// pasos para que el error de coma flotante no se acumule en series largas.
function sma(valores, n) {
  comprobarN(n);
  const out = new Array(valores.length).fill(null);
  let suma = 0;
  let validos = 0; // valores numéricos consecutivos al final de la ventana
  for (let i = 0; i < valores.length; i++) {
    const x = valores[i];
    if (!esNum(x)) { suma = 0; validos = 0; continue; }
    suma += x;
    validos++;
    if (validos > n) suma -= valores[i - n];
    if (validos >= n) {
      if (i % 1000 === 0) {
        suma = 0;
        for (let j = i - n + 1; j <= i; j++) suma += valores[j];
      }
      out[i] = suma / n;
    }
  }
  return out;
}

// Media exponencial sembrada con la SMA de los n primeros valores válidos.
function ema(valores, n) {
  comprobarN(n);
  const out = new Array(valores.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  let acum = 0;
  let validos = 0;
  for (let i = 0; i < valores.length; i++) {
    const x = valores[i];
    if (!esNum(x)) { prev = null; acum = 0; validos = 0; continue; }
    if (prev === null) {
      acum += x;
      validos++;
      if (validos === n) { prev = acum / n; out[i] = prev; }
    } else {
      prev = x * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

// RSI de Wilder: primera media de subidas/bajadas = media simple de los n
// primeros cambios (valor en i = n); después, suavizado (m·(n-1) + x) / n.
function rsi(valores, n) {
  comprobarN(n);
  const out = new Array(valores.length).fill(null);
  let mSube = 0;
  let mBaja = 0;
  let cambios = 0;
  for (let i = 1; i < valores.length; i++) {
    const a = valores[i - 1];
    const b = valores[i];
    if (!esNum(a) || !esNum(b)) { mSube = 0; mBaja = 0; cambios = 0; continue; }
    const d = b - a;
    const sube = d > 0 ? d : 0;
    const baja = d < 0 ? -d : 0;
    cambios++;
    if (cambios <= n) {
      mSube += sube;
      mBaja += baja;
      if (cambios < n) continue;
      mSube /= n;
      mBaja /= n;
    } else {
      mSube = (mSube * (n - 1) + sube) / n;
      mBaja = (mBaja * (n - 1) + baja) / n;
    }
    out[i] = valorRsi(mSube, mBaja);
  }
  return out;
}

function valorRsi(mSube, mBaja) {
  if (mBaja === 0) return mSube === 0 ? 50 : 100; // plano: ni sobrecompra ni sobreventa
  const rs = mSube / mBaja;
  return 100 - 100 / (1 + rs);
}

// Rango verdadero: TR[0] = h-l (no hay cierre previo).
function rangoVerdadero(velas) {
  return velas.map((v, i) => {
    if (i === 0) return v.h - v.l;
    const pc = velas[i - 1].c;
    return Math.max(v.h - v.l, Math.abs(v.h - pc), Math.abs(v.l - pc));
  });
}

// ATR de Wilder: siembra con la media simple de los n primeros TR (valor en
// i = n-1) y después (atr·(n-1) + tr) / n. Igual que el ATR de TradingView.
function atr(velas, n) {
  comprobarN(n);
  const tr = rangoVerdadero(velas);
  const out = new Array(velas.length).fill(null);
  let prev = null;
  let acum = 0;
  for (let i = 0; i < tr.length; i++) {
    if (prev === null) {
      acum += tr[i];
      if (i === n - 1) { prev = acum / n; out[i] = prev; }
    } else {
      prev = (prev * (n - 1) + tr[i]) / n;
      out[i] = prev;
    }
  }
  return out;
}

// Máximo / mínimo de la ventana [i-n+1, i] (INCLUYE i). Cola monótona: O(N).
function extremoVentana(valores, n, esMejor) {
  comprobarN(n);
  const out = new Array(valores.length).fill(null);
  const cola = []; // índices con valores monótonos
  let inicioValidos = 0; // primer índice del tramo sin nulls
  for (let i = 0; i < valores.length; i++) {
    const x = valores[i];
    if (!esNum(x)) { cola.length = 0; inicioValidos = i + 1; continue; }
    while (cola.length && !esMejor(valores[cola[cola.length - 1]], x)) cola.pop();
    cola.push(i);
    while (cola[0] <= i - n) cola.shift();
    if (i - inicioValidos + 1 >= n) out[i] = valores[cola[0]];
  }
  return out;
}

function maximo(valores, n) { return extremoVentana(valores, n, (a, b) => a > b); }
function minimo(valores, n) { return extremoVentana(valores, n, (a, b) => a < b); }

// Rentabilidad simple a n periodos: c[i]/c[i-n] - 1.
function rentabilidad(valores, n) {
  comprobarN(n);
  const out = new Array(valores.length).fill(null);
  for (let i = n; i < valores.length; i++) {
    const a = valores[i - n];
    const b = valores[i];
    if (esNum(a) && esNum(b) && a !== 0) out[i] = b / a - 1;
  }
  return out;
}

// Desviación típica muestral (n-1) de las n últimas log-rentabilidades,
// anualizada con √periodosAnio. Primer valor en i = n (hacen falta n+1 precios).
// Sumas rodantes de x y x², recalculadas cada 1.000 pasos contra la deriva.
function volatilidad(valores, n, periodosAnio) {
  if (!Number.isInteger(n) || n < 2) throw new Error(`periodo de volatilidad inválido: ${n}`);
  if (!(periodosAnio > 0)) throw new Error(`periodosAnio inválido: ${periodosAnio}`);
  const out = new Array(valores.length).fill(null);
  const lr = new Array(valores.length).fill(null);
  for (let i = 1; i < valores.length; i++) {
    const a = valores[i - 1];
    const b = valores[i];
    if (esNum(a) && esNum(b) && a > 0 && b > 0) lr[i] = Math.log(b / a);
  }
  const anual = Math.sqrt(periodosAnio);
  let s = 0;
  let s2 = 0;
  let validos = 0;
  for (let i = 1; i < lr.length; i++) {
    const x = lr[i];
    if (x === null) { s = 0; s2 = 0; validos = 0; continue; }
    s += x; s2 += x * x; validos++;
    if (validos > n) { const y = lr[i - n]; s -= y; s2 -= y * y; }
    if (validos >= n) {
      if (i % 1000 === 0) {
        s = 0; s2 = 0;
        for (let j = i - n + 1; j <= i; j++) { s += lr[j]; s2 += lr[j] * lr[j]; }
      }
      const varianza = Math.max(0, (s2 - (s * s) / n) / (n - 1));
      out[i] = Math.sqrt(varianza) * anual;
    }
  }
  return out;
}

// Percentil (0-100) de cada valor dentro de SU PROPIA historia hasta i
// (incluido): % de valores previos válidos ≤ valor actual. Causal por
// construcción: inserta en una lista ordenada y cuenta con búsqueda binaria.
// Devuelve null hasta tener `minHistoria` valores válidos.
function percentilHistorico(valores, minHistoria = 1) {
  const out = new Array(valores.length).fill(null);
  const ordenados = [];
  for (let i = 0; i < valores.length; i++) {
    const x = valores[i];
    if (!esNum(x)) continue;
    // posición tras el último elemento ≤ x
    let lo = 0;
    let hi = ordenados.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ordenados[m] <= x) lo = m + 1; else hi = m;
    }
    ordenados.splice(lo, 0, x);
    if (ordenados.length >= minHistoria) out[i] = (100 * (lo + 1)) / ordenados.length;
  }
  return out;
}

// Percentil (0-100) de cada valor entre los `ventana` últimos valores válidos
// (incluido el actual). null hasta tener la ventana completa: así el valor en
// i es el mismo tenga la serie 400 velas o 4.000 (vivo = backtest).
function percentilMovil(valores, ventana) {
  comprobarN(ventana);
  const out = new Array(valores.length).fill(null);
  const ordenados = [];
  const cola = []; // valores en orden de llegada
  const posicion = (x, estricto) => {
    let lo = 0;
    let hi = ordenados.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (estricto ? ordenados[m] < x : ordenados[m] <= x) lo = m + 1; else hi = m;
    }
    return lo;
  };
  for (let i = 0; i < valores.length; i++) {
    const x = valores[i];
    if (!esNum(x)) continue;
    ordenados.splice(posicion(x, false), 0, x);
    cola.push(x);
    if (cola.length > ventana) ordenados.splice(posicion(cola.shift(), true), 1);
    if (cola.length === ventana) out[i] = (100 * posicion(x, false)) / ventana;
  }
  return out;
}

module.exports = {
  sma, ema, rsi, atr, maximo, minimo, rentabilidad, volatilidad, cierres,
  rangoVerdadero, percentilHistorico, percentilMovil,
};
