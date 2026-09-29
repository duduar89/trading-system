'use strict';
// Aritmética de dinero y cantidades. Los importes van en dólares como número;
// el redondeo es solo para enviar órdenes (incrementos del bróker) y para pintar.

// Redondea hacia abajo al múltiplo de `incremento` (p. ej. 0.0001 BTC). Hacia
// abajo porque pasarse del saldo disponible hace que el bróker rechace la orden.
function redondearAbajo(x, incremento) {
  if (!incremento || incremento <= 0) return x;
  const decimales = Math.max(0, Math.ceil(-Math.log10(incremento)) + 2);
  // x / incremento arrastra el error de coma flotante de x (167,363836 / 1e-9 =
  // 167363835999,99997): la holgura tiene que ser relativa al cociente.
  const q = x / incremento;
  const n = Math.floor(q + Math.max(1e-9, Math.abs(q) * 1e-14));
  return Number((n * incremento).toFixed(decimales));
}

function redondear(x, decimales = 2) {
  const f = 10 ** decimales;
  return Math.round(x * f) / f;
}

function limitar(x, min, max) {
  return Math.min(max, Math.max(min, x));
}

function casiIgual(a, b, tolRelativa = 1e-9, tolAbsoluta = 1e-9) {
  return Math.abs(a - b) <= Math.max(tolAbsoluta, tolRelativa * Math.max(Math.abs(a), Math.abs(b)));
}

function suma(arr) { return arr.reduce((s, x) => s + x, 0); }
function media(arr) { return arr.length ? suma(arr) / arr.length : 0; }
function desviacion(arr) {
  if (arr.length < 2) return 0;
  const m = media(arr);
  return Math.sqrt(suma(arr.map(x => (x - m) ** 2)) / (arr.length - 1));
}

module.exports = { redondearAbajo, redondear, limitar, casiIgual, suma, media, desviacion };
