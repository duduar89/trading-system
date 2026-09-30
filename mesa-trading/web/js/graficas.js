// Gráficas propias en SVG para las vistas (Evolución, Estrategias, Laboratorio).
// Sin librerías: la CSP de la web solo deja recursos propios.
//
// Dos partes:
// - Cálculo puro (escalas, marcas de los ejes, reducción de puntos, apilado,
//   rutas SVG): sin DOM, se prueba en Node (test/parque-graficas.test.js).
// - Dibujo (solo en el navegador): gráfica de líneas con cruz y ficha al
//   tocar, áreas apiladas y la versión mínima para las tarjetas. Todo con
//   createElementNS y atributos de presentación: nada de style="" en el
//   marcado (la CSP lo prohíbe); lo que se fija desde JS va por el CSSOM.
//
// Normas del panel: las líneas se descubren de izquierda a derecha y las
// áreas crecen desde su base, sin rebote; con movimiento reducido no se anima
// nada (lo hace vistas.css con prefers-reduced-motion). Los textos van con los
// colores de texto, nunca con el de la serie: la serie la identifica la marca
// de color que tienen al lado.
(function (raiz, fabrica) {
  const esNode = typeof module === 'object' && module.exports;
  const mod = esNode ? fabrica(require('./cifras.js')) : fabrica(raiz.Parque.cifras);
  if (esNode) module.exports = mod;
  else (raiz.Parque = raiz.Parque || {}).graficas = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cifras) {
  'use strict';

  const valido = x => typeof x === 'number' && Number.isFinite(x);
  const H = 3600e3;
  const D = 24 * H;
  const ZONA = (cifras && cifras.ZONA) || 'Europe/Madrid';

  // Paleta categórica validada sobre el fondo del panel (#151b2e) con el
  // validador de la guía de visualización: banda de luminosidad, croma,
  // separación para daltónicos y contraste ≥ 3:1. El orden es parte de la
  // validación: se asigna por entidad y en este orden, nunca en ciclo.
  const PALETA = Object.freeze(['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']);
  const GRIS_OTRAS = '#6b7493';
  const TINTA = { primaria: '#e6e9f2', secundaria: '#aab2cc', tenue: '#8a93b0', rejilla: '#232b45', base: '#39446a', superficie: '#151b2e' };
  const ESTADO = { bien: '#22c55e', aviso: '#f59e0b', grave: '#ef4444', neutro: '#8a93b0' };

  // ---------- escalas ----------

  function escalaLineal(dominio, rango) {
    const [d0, d1] = dominio;
    const [r0, r1] = rango;
    const ancho = d1 - d0;
    const f = x => (ancho === 0 ? (r0 + r1) / 2 : r0 + ((x - d0) / ancho) * (r1 - r0));
    f.invertir = px => (r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * ancho);
    f.dominio = [d0, d1];
    f.rango = [r0, r1];
    return f;
  }

  // Paso «bonito» (1, 2, 2,5 o 5 por potencia de diez) para unas `n` marcas.
  function pasoBonito(ancho, n) {
    if (!(ancho > 0)) return 1;
    const bruto = ancho / Math.max(1, n);
    const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
    const r = bruto / pot;
    const m = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10;
    return m * pot;
  }

  // Marcas del eje Y que cubren [min, max] con números redondos.
  function ticksBonitos(min, max, n) {
    const cuantas = n || 5;
    let a = valido(min) ? min : 0;
    let b = valido(max) ? max : 1;
    if (a > b) [a, b] = [b, a];
    if (a === b) { const d = Math.abs(a) > 0 ? Math.abs(a) * 0.05 : 1; a -= d; b += d; }
    const paso = pasoBonito(b - a, cuantas);
    const ini = Math.floor(a / paso + 1e-9) * paso;
    const fin = Math.ceil(b / paso - 1e-9) * paso;
    const ticks = [];
    for (let v = ini, k = 0; v <= fin + paso * 1e-6 && k < 50; v += paso, k++) ticks.push(Math.abs(v) < paso * 1e-9 ? 0 : Number(v.toPrecision(12)));
    return { ticks, min: ini, max: fin, paso };
  }

  // Decimales que necesita una marca del eje con este paso (`escala` 100 para
  // porcentajes): con pasos de 2,5 % el eje dice «-2,5 %», no «-3 %».
  function decimalesPaso(paso, escala) {
    const x = Math.abs(paso * (escala || 1));
    for (let d = 0; d <= 3; d++) { const y = x * Math.pow(10, d); if (Math.abs(y - Math.round(y)) < 1e-6 * Math.max(1, y)) return d; }
    return 3;
  }

  // Mínimo y máximo de varias listas (sin null). `cero` mete el 0 dentro.
  function extension(listas, opciones) {
    let min = Infinity;
    let max = -Infinity;
    for (const l of listas) for (const v of l || []) { if (valido(v)) { if (v < min) min = v; if (v > max) max = v; } }
    if (opciones && opciones.cero) { min = Math.min(min, 0); max = Math.max(max, 0); }
    if (min === Infinity) return null;
    return { min, max };
  }

  // ---------- tiempo ----------

  // Diferencia entre la hora de la pared en `zona` y UTC, en ms, en el instante t.
  const cacheDtf = new Map();
  function dtfPartes(zona) {
    if (!cacheDtf.has(zona)) {
      cacheDtf.set(zona, new Intl.DateTimeFormat('en-GB', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
    return cacheDtf.get(zona);
  }
  function partes(t, zona) {
    const p = {};
    for (const x of dtfPartes(zona || ZONA).formatToParts(new Date(t))) p[x.type] = x.value;
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), s: Number(p.second) };
  }
  function desfase(t, zona) {
    const p = partes(t, zona);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(t / 1000) * 1000;
  }
  // Hora de la pared (ms «como si fuera UTC») → instante real.
  function desdePared(pared, zona) {
    const t1 = pared - desfase(pared, zona);
    return pared - desfase(t1, zona);
  }

  const PASOS_TIEMPO = [
    { ms: H }, { ms: 2 * H }, { ms: 3 * H }, { ms: 6 * H }, { ms: 12 * H },
    { ms: D }, { ms: 2 * D }, { ms: 7 * D, semana: true }, { ms: 14 * D, semana: true },
    { meses: 1 }, { meses: 2 }, { meses: 3 }, { meses: 6 }, { meses: 12 },
  ];
  const MES_MS = 30.44 * D;

  // Marcas del eje de tiempo entre t0 y t1 (como mucho `n`), alineadas a la
  // hora de Madrid: horas en punto, medianoches, lunes o días 1 de mes.
  function ticksTiempo(t0, t1, n, zona) {
    const z = zona || ZONA;
    const cuantas = Math.max(2, n || 6);
    if (!valido(t0) || !valido(t1) || t1 <= t0) return valido(t0) ? [{ t: t0, texto: cifras.fechaCorta(t0, z) }] : [];
    const ancho = t1 - t0;
    const paso = PASOS_TIEMPO.find(p => ancho / (p.ms || p.meses * MES_MS) <= cuantas + 0.5) || PASOS_TIEMPO[PASOS_TIEMPO.length - 1];
    const salida = [];
    const pared0 = t0 + desfase(t0, z);
    const pared1 = t1 + desfase(t1, z);
    if (paso.meses) {
      const p = partes(t0, z);
      let y = p.y;
      let m = p.m - 1;
      // Primer día 1 de mes múltiplo del paso (enero, abril… con 3 meses).
      if (!(p.d === 1 && p.h === 0 && p.min === 0)) m += 1;
      while (m % paso.meses !== 0) m += 1;
      for (let k = 0; k < 40; k++) {
        const yy = y + Math.floor(m / 12);
        const mm = ((m % 12) + 12) % 12;
        const pared = Date.UTC(yy, mm, 1);
        if (pared > pared1) break;
        const t = desdePared(pared, z);
        if (t >= t0) salida.push({ t, texto: textoMes(yy, mm, paso.meses >= 12, salida.length === 0 || mm === 0) });
        m += paso.meses;
      }
      return salida;
    }
    let pared;
    if (paso.ms >= D) {
      pared = Math.ceil(pared0 / D) * D;
      if (paso.semana) {
        const diaSemana = (Math.floor(pared / D) + 4) % 7;   // 0 = domingo (el 1-1-1970 fue jueves)
        pared += ((8 - diaSemana) % 7) * D;
      }
    } else {
      pared = Math.ceil(pared0 / paso.ms) * paso.ms;
    }
    for (let k = 0; pared <= pared1 && k < 60; pared += paso.ms, k++) {
      const t = desdePared(pared, z);
      if (t < t0 || t > t1) continue;
      const medianoche = pared % D === 0;
      salida.push({ t, texto: paso.ms < D && !medianoche ? cifras.hora(t, z) : cifras.fechaCorta(t, z) });
    }
    return salida;
  }

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
  function textoMes(y, m, soloAno, conAno) {
    if (soloAno) return String(y);
    return conAno ? `${MESES[m]} ${y}` : MESES[m];
  }

  // Índice del instante de `ts` (ordenado) más cercano a t.
  function indiceCercano(ts, t) {
    if (!ts.length) return -1;
    let a = 0;
    let b = ts.length - 1;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (ts[m] <= t) a = m; else b = m;
    }
    return Math.abs(ts[a] - t) <= Math.abs(ts[b] - t) ? a : b;
  }

  // ---------- reducción de puntos (LTTB) ----------

  // Índices de los `umbral` puntos que conservan la forma de la serie (picos
  // y valles incluidos); siempre el primero y el último.
  function indicesLTTB(xs, ys, umbral) {
    const n = xs.length;
    if (umbral >= n || n <= 2) return xs.map((_, i) => i);
    const u = Math.max(3, Math.floor(umbral));
    const fuera = [0];
    const cubo = (n - 2) / (u - 2);
    let a = 0;
    for (let i = 0; i < u - 2; i++) {
      const ini = Math.floor(i * cubo) + 1;
      const fin = Math.min(n - 1, Math.floor((i + 1) * cubo) + 1);
      const sFin = Math.min(n, Math.floor((i + 2) * cubo) + 1);
      let mx = 0;
      let my = 0;
      let k = 0;
      for (let j = fin; j < Math.max(sFin, fin + 1) && j < n; j++) { if (valido(ys[j])) { mx += xs[j]; my += ys[j]; k++; } }
      if (k) { mx /= k; my /= k; } else { mx = xs[n - 1]; my = valido(ys[n - 1]) ? ys[n - 1] : 0; }
      const ay = valido(ys[a]) ? ys[a] : my;
      let mejor = -1;
      let elegido = ini;
      for (let j = ini; j < fin; j++) {
        if (!valido(ys[j])) continue;
        const area = Math.abs((xs[a] - mx) * (ys[j] - ay) - (xs[a] - xs[j]) * (my - ay));
        if (area > mejor) { mejor = area; elegido = j; }
      }
      fuera.push(elegido);
      a = elegido;
    }
    fuera.push(n - 1);
    return fuera;
  }

  // Reduce varias series alineadas con `ts` a la vez: manda la forma de la
  // `principal` y se añaden los índices que pida `conservar` (sucesos).
  function reducirAlineadas(ts, series, umbral, principal, conservar) {
    if (ts.length <= umbral) return { ts: ts.slice(), series: series.map(s => s.slice()), indices: ts.map((_, i) => i) };
    const ys = principal || series[0];
    const idx = new Set(indicesLTTB(ts, ys, Math.max(3, umbral - 2)));
    // El máximo y el mínimo, siempre (LTTB no lo promete).
    let iMax = -1;
    let iMin = -1;
    ys.forEach((v, i) => { if (!valido(v)) return; if (iMax < 0 || v > ys[iMax]) iMax = i; if (iMin < 0 || v < ys[iMin]) iMin = i; });
    if (iMax >= 0) idx.add(iMax);
    if (iMin >= 0) idx.add(iMin);
    for (const i of conservar || []) if (i >= 0 && i < ts.length) idx.add(i);
    const orden = [...idx].sort((a, b) => a - b);
    return { ts: orden.map(i => ts[i]), series: series.map(s => orden.map(i => s[i])), indices: orden };
  }

  // ---------- transformaciones ----------

  // Variación frente al primer valor válido (fracción): 0 en el arranque.
  function rebasar(valores) {
    const base = (valores || []).find(v => valido(v) && v !== 0);
    return (valores || []).map(v => (valido(v) && valido(base) ? v / base - 1 : null));
  }

  // Diferencia frente al primer valor válido (en las mismas unidades).
  function desdeInicio(valores) {
    const base = (valores || []).find(valido);
    return (valores || []).map(v => (valido(v) && valido(base) ? v - base : null));
  }

  // Capas apiladas: devuelve por capa [ [y0, y1] por instante ] (null → 0).
  function apilar(capas) {
    const n = capas.length ? capas[0].length : 0;
    const acumulado = new Array(n).fill(0);
    return capas.map(valores => valores.map((v, i) => {
      const y0 = acumulado[i];
      const y1 = y0 + (valido(v) && v > 0 ? v : 0);
      acumulado[i] = y1;
      return [y0, y1];
    }));
  }

  // ---------- rutas SVG ----------

  const r2 = x => Math.round(x * 100) / 100;

  // Línea por los puntos [x, y]; un null corta la línea (sin dato no se une).
  function rutaLinea(puntos) {
    let d = '';
    let pluma = false;
    for (const p of puntos) {
      if (!p || !valido(p[0]) || !valido(p[1])) { pluma = false; continue; }
      d += `${pluma ? 'L' : 'M'}${r2(p[0])} ${r2(p[1])}`;
      pluma = true;
    }
    return d;
  }

  // Línea en escalón: el valor se mantiene hasta el instante siguiente (pesos).
  function rutaEscalon(puntos) {
    let d = '';
    let prev = null;
    for (const p of puntos) {
      if (!p || !valido(p[0]) || !valido(p[1])) { prev = null; continue; }
      if (!prev) d += `M${r2(p[0])} ${r2(p[1])}`;
      else d += `H${r2(p[0])}V${r2(p[1])}`;
      prev = p;
    }
    return d;
  }

  // Área entre un borde de arriba y uno de abajo (mismos x), en escalón o no.
  function rutaArea(xs, arriba, abajo, escalon) {
    const n = xs.length;
    if (!n) return '';
    let d = `M${r2(xs[0])} ${r2(arriba[0])}`;
    for (let i = 1; i < n; i++) d += escalon ? `H${r2(xs[i])}V${r2(arriba[i])}` : `L${r2(xs[i])} ${r2(arriba[i])}`;
    d += `L${r2(xs[n - 1])} ${r2(abajo[n - 1])}`;
    for (let i = n - 2; i >= 0; i--) d += escalon ? `V${r2(abajo[i])}H${r2(xs[i])}` : `L${r2(xs[i])} ${r2(abajo[i])}`;
    // El escalón de abajo, al revés, también tiene que bajar antes de ir a la izquierda.
    return `${d}Z`;
  }

  // Ancho aproximado de un texto de 11 px (sin medir: el SVG aún no está en la página).
  const anchoTexto = (s, px) => String(s).length * (px || 11) * 0.58;

  // ---------- dibujo (solo navegador) ----------

  const NS = 'http://www.w3.org/2000/svg';
  function nodo(tag, attrs, padre) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, String(v));
    if (padre) padre.appendChild(e);
    return e;
  }
  function html(tag, clase, texto) {
    const e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto !== undefined && texto !== null) e.textContent = String(texto);
    return e;
  }

  function reducirMovimiento() { return cifras.reducirMovimiento(); }

  // Ficha flotante (una por gráfica) con la cruz. Filas: marca de línea de la
  // serie, valor en fuerte y nombre en secundario (el lector ya sabe la serie
  // y busca el número).
  function crearFicha(cont) {
    const f = html('div', 'g-ficha');
    f.setAttribute('role', 'status');
    f.setAttribute('aria-live', 'polite');
    f.hidden = true;
    cont.appendChild(f);
    return f;
  }
  function rellenarFicha(ficha, titulo, filas, notas) {
    ficha.textContent = '';
    ficha.appendChild(html('div', 'g-ficha-t', titulo));
    for (const r of filas) {
      const fila = html('div', 'g-ficha-f');
      const llave = html('span', 'g-llave' + (r.forma === 'caja' ? ' caja' : ''));
      llave.style.setProperty('--c', r.color || TINTA.tenue);
      fila.appendChild(llave);
      fila.appendChild(html('span', 'g-ficha-nombre', r.nombre));
      fila.appendChild(html('b', null, r.valor));
      if (r.detalle) fila.appendChild(html('span', 'g-ficha-det', r.detalle));
      ficha.appendChild(fila);
    }
    for (const n of notas || []) {
      const p = html('div', 'g-ficha-n' + (n.clase ? ` ${n.clase}` : ''), n.texto);
      ficha.appendChild(p);
    }
  }
  function colocarFicha(ficha, cont, x, y) {
    const ancho = cont.clientWidth;
    ficha.hidden = false;
    const fw = ficha.offsetWidth || 180;
    let izq = x + 14;
    if (izq + fw > ancho - 4) izq = x - fw - 14;
    if (izq < 4) izq = Math.max(4, Math.min(ancho - fw - 4, x - fw / 2));
    ficha.style.left = `${Math.round(izq)}px`;
    ficha.style.top = `${Math.round(Math.max(0, y))}px`;
  }

  // Interacción común: cruz que busca el instante más cercano (el lector
  // apunta a una fecha, no a una línea de 2 px), con ratón, dedo o teclado.
  function instalarCruz({ cont, svg, capa, xs, ts, alto, arriba, alMover, alOcultar }) {
    let indice = -1;
    const mostrar = (i) => {
      if (i < 0 || i >= ts.length) return;
      indice = i;
      alMover(i);
    };
    const ocultar = () => { indice = -1; alOcultar(); };
    const desdeEvento = (ev) => {
      const r = svg.getBoundingClientRect();
      // En unidades del viewBox (si el SVG se ha estirado o encogido con el CSS).
      const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal.width : r.width;
      const px = (ev.clientX - r.left) * (r.width > 0 ? vb / r.width : 1);
      let mejor = 0;
      let dist = Infinity;
      // xs está ordenado: búsqueda binaria sobre las x en pantalla.
      let a = 0;
      let b = xs.length - 1;
      while (b - a > 1) { const m = (a + b) >> 1; if (xs[m] <= px) a = m; else b = m; }
      for (const j of [a, b]) { const d = Math.abs(xs[j] - px); if (d < dist) { dist = d; mejor = j; } }
      return mejor;
    };
    capa.addEventListener('pointermove', ev => mostrar(desdeEvento(ev)));
    capa.addEventListener('pointerdown', ev => mostrar(desdeEvento(ev)));
    capa.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') ocultar(); });
    cont.addEventListener('keydown', ev => {
      if (!ts.length) return;
      const paso = Math.max(1, Math.round(ts.length / 40));
      const teclas = { ArrowRight: paso, ArrowLeft: -paso, End: Infinity, Home: -Infinity };
      // Escape cierra la ficha y nada más (no la vista que contiene la gráfica).
      if (ev.key === 'Escape') { if (indice >= 0) { ocultar(); ev.stopPropagation(); } return; }
      if (!(ev.key in teclas)) return;
      ev.preventDefault();
      const d = teclas[ev.key];
      const base = indice < 0 ? (d > 0 ? -1 : ts.length) : indice;
      mostrar(Math.max(0, Math.min(ts.length - 1, d === Infinity ? ts.length - 1 : d === -Infinity ? 0 : base + d)));
    });
    cont.addEventListener('blur', ocultar);
    return { ocultar, alto, arriba };
  }

  // Tocar fuera de una gráfica cierra su ficha (en el móvil no hay «salir»).
  const abiertas = new Set();
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', ev => {
      for (const g of abiertas) if (!g.cont.contains(ev.target)) g.ocultar();
    }, { capture: true, passive: true });
  }

  // Gráfica de líneas.
  // cfg = { ts: [t], series: [{ id, nombre, color, grosor?, valores: [v] }], alto, formatoY(v), formatoValor(v, serie, i),
  //         tituloFicha(t, i), cero: bool, marcas: [{ t, tipo, texto, color, forma }], bandas: [{ desde, hasta, color, texto }],
  //         animar: bool, compacto: bool, descripcion, notasFicha(i) }
  // Cada dibujo va en una caja nueva dentro de `destino`: así volver a
  // dibujar (al cambiar el ancho) no acumula oyentes en el contenedor.
  function cajaNueva(destino, cfg) {
    destino.textContent = '';
    const caja = html('div', 'g-cont' + (cfg.animar && !reducirMovimiento() ? ' g-entra' : ''));
    caja.tabIndex = 0;
    caja.setAttribute('role', 'group');
    if (cfg.descripcion) caja.setAttribute('aria-label', cfg.descripcion);
    destino.appendChild(caja);
    return caja;
  }

  function lineas(destino, cfg) {
    const cont = cajaNueva(destino, cfg);
    const compacto = Boolean(cfg.compacto);
    const ancho = Math.max(120, Math.floor(cont.clientWidth || cfg.ancho || 600));
    const alto = cfg.alto || (compacto ? 56 : 240);
    const ts = cfg.ts || [];
    const series = (cfg.series || []).filter(s => s && Array.isArray(s.valores));
    const marcas = (cfg.marcas || []).filter(m => valido(m.t));
    const carril = !compacto && marcas.length ? 18 : 0;
    const refs = (cfg.referencias || []).filter(r => valido(r.v));
    const ext = extension(series.map(s => s.valores).concat([refs.map(r => r.v)]), { cero: Boolean(cfg.cero) }) || { min: 0, max: 1 };
    // Una referencia en el borde se confundiría con el eje: un poco de aire.
    if (refs.some(r => r.v <= ext.min)) ext.min -= (ext.max - ext.min) * 0.06;
    const yt = compacto ? { ticks: [], min: ext.min, max: ext.max } : ticksBonitos(ext.min, ext.max, alto < 200 ? 4 : 5);
    if (compacto && ext.min === ext.max) { yt.min -= 1; yt.max += 1; }
    const fmtY = cfg.formatoY || (v => cifras.numero(v, 0));
    const izq = compacto ? 2 : Math.ceil(Math.max(...yt.ticks.map(v => anchoTexto(fmtY(v, yt.paso))), 20)) + 10;
    const der = compacto ? 2 : 14;
    const arriba = compacto ? 4 : 10;
    const abajo = compacto ? 4 : 22 + carril;
    const t0 = ts.length ? ts[0] : 0;
    const t1 = ts.length ? ts[ts.length - 1] : 1;
    const fx = escalaLineal([t0, t1 === t0 ? t0 + 1 : t1], [izq, ancho - der]);
    const fy = escalaLineal([yt.min, yt.max], [alto - abajo, arriba]);
    const svg = nodo('svg', { viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, class: 'g-svg', role: 'img', 'aria-hidden': 'true', focusable: 'false' });
    cont.appendChild(svg);

    // Bandas (p. ej. comité en DEFENSIVO): lavado muy suave detrás de todo.
    for (const b of cfg.bandas || []) {
      const x0 = fx(Math.max(t0, b.desde));
      const x1 = fx(Math.min(t1, b.hasta));
      if (!(x1 > x0)) continue;
      nodo('rect', { x: x0, y: arriba, width: x1 - x0, height: alto - abajo - arriba, fill: b.color || ESTADO.aviso, 'fill-opacity': 0.1, class: 'g-banda' }, svg);
    }

    // Rejilla y ejes: líneas finas, sólidas y un paso por encima del fondo.
    if (!compacto) {
      const g = nodo('g', { class: 'g-ejes' }, svg);
      for (const v of yt.ticks) {
        const y = fy(v);
        nodo('line', { x1: izq, x2: ancho - der, y1: y, y2: y, stroke: v === 0 && cfg.cero ? TINTA.base : TINTA.rejilla, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
        const t = nodo('text', { x: izq - 6, y: y + 3.5, 'text-anchor': 'end', class: 'g-tick' }, g);
        t.textContent = fmtY(v, yt.paso);
      }
      const xt = ticksTiempo(t0, t1, Math.max(2, Math.floor((ancho - izq - der) / 72)));
      for (const k of xt) {
        const x = fx(k.t);
        nodo('line', { x1: x, x2: x, y1: alto - abajo, y2: alto - abajo + 4, stroke: TINTA.base, 'stroke-width': 1 }, g);
        const t = nodo('text', { x, y: alto - 6, 'text-anchor': 'middle', class: 'g-tick' }, g);
        t.textContent = k.texto;
      }
      nodo('line', { x1: izq, x2: ancho - der, y1: alto - abajo, y2: alto - abajo, stroke: TINTA.base, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
    } else if (cfg.cero && yt.min < 0 && yt.max > 0) {
      nodo('line', { x1: izq, x2: ancho - der, y1: fy(0), y2: fy(0), stroke: TINTA.base, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, svg);
    }

    // Líneas de referencia (límites): finas, en tinta tenue, con su rótulo.
    for (const r of refs) {
      const y = fy(r.v);
      nodo('line', { x1: izq, x2: ancho - der, y1: y, y2: y, stroke: TINTA.secundaria, 'stroke-width': 1, 'stroke-opacity': 0.8, 'shape-rendering': 'crispEdges', class: 'g-ref' }, svg);
      if (r.texto && !compacto) {
        const t = nodo('text', { x: ancho - der - 4, y: y - 4, 'text-anchor': 'end', class: 'g-tick g-ref-t' }, svg);
        t.textContent = r.texto;
      }
    }

    // Marcas de sucesos: en su carril, bajo la gráfica; las graves, además
    // con una línea vertical que cruza la gráfica.
    const gm = nodo('g', { class: 'g-marcas' }, svg);
    for (const m of marcas) {
      if (m.t < t0 || m.t > t1) continue;
      const x = fx(m.t);
      if (m.vertical) nodo('line', { x1: x, x2: x, y1: arriba, y2: alto - abajo, stroke: m.color || ESTADO.grave, 'stroke-width': 1, 'stroke-opacity': 0.7 }, gm);
      if (!carril) continue;
      const y = alto - abajo + 4 + carril / 2 - 2;
      forma(gm, m.forma || 'circulo', x, y, 4.5, m.color || ESTADO.neutro);
    }

    // Series (la principal la última: queda por encima).
    const gs = nodo('g', { class: 'g-series' }, svg);
    const xs = ts.map(t => fx(t));
    const orden = series.slice().sort((a, b) => (a.principal ? 1 : 0) - (b.principal ? 1 : 0));
    for (const s of orden) {
      const pts = s.valores.map((v, i) => (valido(v) ? [xs[i], fy(v)] : null));
      if (s.relleno) {
        const base = fy(cfg.cero ? 0 : yt.min);
        const tramos = [];
        let actual = [];
        pts.forEach((p, i) => { if (p) actual.push(i); else if (actual.length) { tramos.push(actual); actual = []; } });
        if (actual.length) tramos.push(actual);
        for (const tr of tramos) {
          const d = rutaArea(tr.map(i => xs[i]), tr.map(i => pts[i][1]), tr.map(() => base), false);
          nodo('path', { d, fill: s.color, 'fill-opacity': 0.12, stroke: 'none', class: 'g-area' }, gs);
        }
      }
      nodo('path', {
        d: s.escalon ? rutaEscalon(pts) : rutaLinea(pts), fill: 'none', stroke: s.color, 'stroke-width': s.grosor || (compacto ? 1.75 : 2),
        'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'g-linea',
      }, gs);
    }

    // Cruz, puntos y ficha.
    const cruz = nodo('line', { y1: arriba, y2: alto - abajo, stroke: TINTA.tenue, 'stroke-width': 1, visibility: 'hidden' }, svg);
    const puntos = orden.map(s => nodo('circle', { r: 4, fill: s.color, stroke: TINTA.superficie, 'stroke-width': 2, visibility: 'hidden' }, svg));
    const capa = nodo('rect', { x: izq, y: 0, width: Math.max(1, ancho - izq - der), height: alto, fill: 'transparent', class: 'g-capa' }, svg);
    const ficha = crearFicha(cont);
    const fmtV = cfg.formatoValor || ((v) => fmtY(v));
    const tituloDe = cfg.tituloFicha || (t => `${cifras.fechaCorta(t)} ${cifras.hora(t)}`);
    const ocultar = () => {
      cruz.setAttribute('visibility', 'hidden');
      for (const p of puntos) p.setAttribute('visibility', 'hidden');
      ficha.hidden = true;
    };
    const control = instalarCruz({
      cont, svg, capa, xs, ts, alto, arriba,
      alMover: (i) => {
        cruz.setAttribute('x1', xs[i]); cruz.setAttribute('x2', xs[i]); cruz.setAttribute('visibility', 'visible');
        orden.forEach((s, k) => {
          const v = s.valores[i];
          if (valido(v)) { puntos[k].setAttribute('cx', xs[i]); puntos[k].setAttribute('cy', fy(v)); puntos[k].setAttribute('visibility', 'visible'); } else puntos[k].setAttribute('visibility', 'hidden');
        });
        // En la ficha, por orden de valor (de mayor a menor), como se ven las líneas.
        const filas = series.map(s => ({ s, v: s.valores[i] }))
          .sort((a, b) => (valido(b.v) ? b.v : -Infinity) - (valido(a.v) ? a.v : -Infinity))
          .map(({ s, v }) => {
            // formatoValor puede dar un texto o { valor, detalle } (la cifra y, debajo, otra más pequeña).
            const x = valido(v) ? fmtV(v, s, i) : '—';
            return x && typeof x === 'object' ? { color: s.color, valor: x.valor, detalle: x.detalle, nombre: s.nombre } : { color: s.color, valor: x, nombre: s.nombre };
          });
        const antes = i > 0 ? (ts[i - 1] + ts[i]) / 2 : -Infinity;
        const despues = i < ts.length - 1 ? (ts[i] + ts[i + 1]) / 2 : Infinity;
        const notas = marcas.filter(m => m.t >= antes && m.t < despues).map(m => ({ texto: m.texto, clase: m.clase }));
        for (const n of cfg.notasFicha ? cfg.notasFicha(i) || [] : []) notas.push(n);
        rellenarFicha(ficha, tituloDe(ts[i], i), filas, notas);
        colocarFicha(ficha, cont, xs[i], compacto ? 0 : arriba);
        abiertas.add(registro);
      },
      alOcultar: () => { ocultar(); abiertas.delete(registro); },
    });
    const registro = { cont, ocultar: control.ocultar };
    return { svg, ocultar: control.ocultar, fx, fy };
  }

  // Forma de una marca: círculo, triángulo arriba/abajo, cuadrado o rombo
  // (la forma dice qué es aunque no se distinga el color).
  function forma(padre, tipo, x, y, r, color) {
    const attrs = { fill: color, stroke: TINTA.superficie, 'stroke-width': 1.5 };
    if (tipo === 'arriba') return nodo('path', { d: `M${x} ${y - r}L${x + r} ${y + r * 0.8}L${x - r} ${y + r * 0.8}Z`, ...attrs }, padre);
    if (tipo === 'abajo') return nodo('path', { d: `M${x} ${y + r}L${x + r} ${y - r * 0.8}L${x - r} ${y - r * 0.8}Z`, ...attrs }, padre);
    if (tipo === 'cuadrado') return nodo('rect', { x: x - r * 0.85, y: y - r * 0.85, width: r * 1.7, height: r * 1.7, rx: 1, ...attrs }, padre);
    if (tipo === 'rombo') return nodo('path', { d: `M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`, ...attrs }, padre);
    return nodo('circle', { cx: x, cy: y, r: r * 0.8, ...attrs }, padre);
  }

  // Áreas apiladas (reparto del capital). cfg = { ts, capas: [{ id, nombre, color, valores }], maxY, formatoY, alto, escalon, animar, descripcion }
  function apiladas(destino, cfg) {
    const cont = cajaNueva(destino, cfg);
    const ancho = Math.max(160, Math.floor(cont.clientWidth || 600));
    const alto = cfg.alto || 200;
    const ts = cfg.ts || [];
    const capas = cfg.capas || [];
    const pilas = apilar(capas.map(c => c.valores));
    const maxY = valido(cfg.maxY) ? cfg.maxY : Math.max(1e-9, ...pilas.flatMap(p => p.map(x => x[1])));
    const yt = ticksBonitos(0, maxY, 4);
    const fmtY = cfg.formatoY || (v => cifras.pct(v, { decimales: 0 }));
    const izq = Math.ceil(Math.max(...yt.ticks.map(v => anchoTexto(fmtY(v, yt.paso))), 20)) + 10;
    const der = 14;
    const arriba = 10;
    const abajo = 22;
    const t0 = ts.length ? ts[0] : 0;
    const t1 = ts.length > 1 ? ts[ts.length - 1] : t0 + 1;
    const fx = escalaLineal([t0, t1], [izq, ancho - der]);
    const fy = escalaLineal([0, yt.max], [alto - abajo, arriba]);
    const svg = nodo('svg', { viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, class: 'g-svg', role: 'img', 'aria-hidden': 'true', focusable: 'false' });
    cont.appendChild(svg);
    const g = nodo('g', { class: 'g-ejes' }, svg);
    for (const v of yt.ticks) {
      const y = fy(v);
      nodo('line', { x1: izq, x2: ancho - der, y1: y, y2: y, stroke: TINTA.rejilla, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, g);
      const t = nodo('text', { x: izq - 6, y: y + 3.5, 'text-anchor': 'end', class: 'g-tick' }, g);
      t.textContent = fmtY(v, yt.paso);
    }
    for (const k of ticksTiempo(t0, t1, Math.max(2, Math.floor((ancho - izq - der) / 72)))) {
      const t = nodo('text', { x: fx(k.t), y: alto - 6, 'text-anchor': 'middle', class: 'g-tick' }, g);
      t.textContent = k.texto;
    }
    // Las áreas crecen desde la base del eje (transform-origin en la base).
    const ga = nodo('g', { class: 'g-apiladas' }, svg);
    ga.style.transformOrigin = `0px ${fy(0)}px`;
    // Con un solo instante, se estira hasta el borde derecho.
    const xs = ts.length > 1 ? ts.map(t => fx(t)) : [izq, ancho - der];
    const P = ts.length > 1 ? pilas : pilas.map(p => [p[0], p[0]]);
    capas.forEach((c, k) => {
      const arribaY = P[k].map(x => fy(x[1]));
      const abajoY = P[k].map(x => fy(x[0]));
      if (P[k].every(x => x[1] - x[0] <= 0)) return;
      nodo('path', { d: rutaArea(xs, arribaY, abajoY, cfg.escalon !== false), fill: c.color, 'fill-opacity': 0.55, stroke: TINTA.superficie, 'stroke-width': 1, class: 'g-capa-area' }, ga);
    });
    nodo('line', { x1: izq, x2: ancho - der, y1: fy(0), y2: fy(0), stroke: TINTA.base, 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, svg);
    const cruz = nodo('line', { y1: arriba, y2: alto - abajo, stroke: TINTA.primaria, 'stroke-width': 1, 'stroke-opacity': 0.7, visibility: 'hidden' }, svg);
    const capa = nodo('rect', { x: izq, y: 0, width: Math.max(1, ancho - izq - der), height: alto, fill: 'transparent', class: 'g-capa' }, svg);
    const ficha = crearFicha(cont);
    const tituloDe = cfg.tituloFicha || (t => `${cifras.fechaCorta(t)} ${cifras.hora(t)}`);
    const control = instalarCruz({
      cont, svg, capa, xs: ts.map(t => fx(t)), ts, alto, arriba,
      alMover: (i) => {
        const x = fx(ts[i]);
        cruz.setAttribute('x1', x); cruz.setAttribute('x2', x); cruz.setAttribute('visibility', 'visible');
        const filas = capas.map(c => ({ color: c.color, forma: 'caja', valor: valido(c.valores[i]) ? fmtY(c.valores[i]) : '—', nombre: c.nombre })).reverse();
        rellenarFicha(ficha, tituloDe(ts[i], i), filas.filter(f => f.valor !== '—'));
        colocarFicha(ficha, cont, x, arriba);
        abiertas.add(registro);
      },
      alOcultar: () => { cruz.setAttribute('visibility', 'hidden'); ficha.hidden = true; abiertas.delete(registro); },
    });
    const registro = { cont, ocultar: control.ocultar };
    return { svg, ocultar: control.ocultar };
  }

  // Leyenda: marca de la forma de la serie (línea o caja) + nombre + valor.
  function leyenda(items, opciones) {
    const ul = html('ul', 'g-leyenda');
    if (opciones && opciones.etiqueta) ul.setAttribute('aria-label', opciones.etiqueta);
    for (const it of items) {
      const li = html('li');
      const llave = html('span', 'g-llave' + (it.forma === 'caja' ? ' caja' : ''));
      llave.style.setProperty('--c', it.color);
      li.appendChild(llave);
      li.appendChild(html('span', 'g-leyenda-n', it.nombre));
      if (it.valor !== undefined && it.valor !== null) {
        const v = html('b', 'g-leyenda-v' + (it.clase ? ` ${it.clase}` : ''), it.valor);
        li.appendChild(v);
      }
      ul.appendChild(li);
    }
    return ul;
  }

  return {
    PALETA, GRIS_OTRAS, TINTA, ESTADO, PASOS_TIEMPO,
    escalaLineal, pasoBonito, ticksBonitos, decimalesPaso, extension, ticksTiempo, indiceCercano, desfase, desdePared, partes,
    indicesLTTB, reducirAlineadas, rebasar, desdeInicio, apilar, rutaLinea, rutaEscalon, rutaArea, anchoTexto,
    lineas, apiladas, leyenda, forma,
  };
});
