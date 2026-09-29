// Cifras del parqué: formato en español y números que cuentan hacia arriba.
//
// El navegador no puede cargar src/util/formato.js (es CommonJS del servidor),
// así que aquí se reproducen sus MISMAS reglas; test/parque-cifras.test.js
// compara las dos salidas con una batería de valores para que no se separen.
// Script clásico (window.Parque.cifras) y a la vez módulo CommonJS para las pruebas.
(function (raiz, fabrica) {
  const mod = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).cifras = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const cacheNf = new Map();
  function nf(min, max) {
    const clave = min + '|' + max;
    if (!cacheNf.has(clave)) {
      cacheNf.set(clave, new Intl.NumberFormat('es-ES', {
        minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: true,
      }));
    }
    return cacheNf.get(clave);
  }

  // es-ES no agrupa los números de 4 cifras (1234); en dinero se quiere 1.234.
  function agrupar(texto) {
    const partes = texto.split(',');
    const ent = partes[0];
    const dec = partes[1];
    const signo = ent.startsWith('-') ? '-' : '';
    const digitos = ent.replace(/^-/, '').replace(/\./g, '');
    const conPuntos = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return signo + conPuntos + (dec !== undefined ? ',' + dec : '');
  }

  const valido = x => typeof x === 'number' && Number.isFinite(x);

  // Dólares: sin decimales a partir de 1.000, con dos por debajo (igual que formato.usd).
  function usd(x, opciones) {
    const signo = Boolean(opciones && opciones.signo);
    if (!valido(x)) return '—';
    const abs = Math.abs(x);
    const cuerpo = agrupar(abs >= 1000 ? nf(0, 0).format(x) : nf(2, 2).format(x));
    return (signo && x > 0 ? '+' : '') + cuerpo + ' $';
  }

  // Fracción → porcentaje: 0.0125 → «1,25 %».
  function pct(fraccion, opciones) {
    const decimales = opciones && Number.isInteger(opciones.decimales) ? opciones.decimales : 2;
    const signo = Boolean(opciones && opciones.signo);
    if (!valido(fraccion)) return '—';
    const v = fraccion * 100;
    return (signo && v > 0 ? '+' : '') + agrupar(nf(decimales, decimales).format(v)) + ' %';
  }

  // Precio de un activo: más decimales cuanto más barato (DOGE 0,1234; BTC 83.547).
  function precio(x) {
    if (!valido(x)) return '—';
    const abs = Math.abs(x);
    const dec = abs >= 1000 ? 0 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4;
    return agrupar(nf(dec, dec).format(x));
  }

  function cantidad(x, maxDecimales) {
    if (!valido(x)) return '—';
    return agrupar(nf(0, maxDecimales === undefined ? 6 : maxDecimales).format(x));
  }

  function numero(x, decimales) {
    if (!valido(x)) return '—';
    const d = decimales === undefined ? 0 : decimales;
    return agrupar(nf(d, d).format(x));
  }

  // Hora HH:MM. Sin zona, la del ordenador que mira el panel.
  function hora(t, zona) {
    if (!valido(t)) return '—';
    const op = { hour: '2-digit', minute: '2-digit' };
    if (zona) op.timeZone = zona;
    return new Intl.DateTimeFormat('es-ES', op).format(new Date(t));
  }

  // Cuenta atrás «HH:MM» (redondeando hacia arriba: con 30 s quedan «00:01», no «00:00»).
  function cuentaAtras(ms) {
    if (!valido(ms) || ms <= 0) return '00:00';
    const minutos = Math.ceil(ms / 60000);
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  // Clase de color de una cifra con signo.
  function claseSigno(x, umbral) {
    const u = umbral || 0;
    if (!valido(x)) return 'cero';
    if (x > u) return 'pos';
    if (x < -u) return 'neg';
    return 'cero';
  }

  // Curva ease-out cúbica: monótona y sin pasarse de 1 (en cifras de negocio un
  // número que se pasa y vuelve se lee como un error de cálculo).
  function suavizar(p) {
    const q = Math.min(1, Math.max(0, p));
    return 1 - Math.pow(1 - q, 3);
  }

  function reducirMovimiento() {
    try {
      return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  // Anima el texto de un elemento desde su último valor (0 la primera vez) hasta
  // `valor`, en `duracion` ms. Con movimiento reducido, salta al final.
  function animar(el, valor, formatear, opciones) {
    if (!el) return;
    const duracion = (opciones && opciones.duracion) || 500;
    const fmt = formatear || (x => numero(x));
    if (!valido(valor)) {
      el.textContent = fmt(valor);
      el._cifra = { valor: null };
      return;
    }
    const previo = el._cifra && valido(el._cifra.valor) ? el._cifra.valor : 0;
    if (el._cifra && el._cifra.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(el._cifra.raf);
    const estado = { valor, raf: 0 };
    el._cifra = estado;
    if (previo === valor || reducirMovimiento() || typeof requestAnimationFrame !== 'function') {
      el.textContent = fmt(valor);
      return;
    }
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const paso = (ahora) => {
      if (el._cifra !== estado) return;
      const p = (ahora - t0) / duracion;
      const v = p >= 1 ? valor : previo + (valor - previo) * suavizar(p);
      el.textContent = fmt(v);
      if (p < 1) estado.raf = requestAnimationFrame(paso);
    };
    estado.raf = requestAnimationFrame(paso);
  }

  return { usd, pct, precio, cantidad, numero, hora, cuentaAtras, claseSigno, suavizar, reducirMovimiento, animar, agrupar };
});
