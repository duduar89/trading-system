'use strict';
// Ayudas para las pruebas del panel en un Chromium de verdad (Playwright): lanzar el navegador (sin
// él, la prueba se salta), compilar el panel si falta y lo que se mira en cada pantalla: que nada
// desborde a lo ancho, que el texto se lea (contraste AA de las WCAG), que cada control tenga nombre
// accesible y que el foco se vea al moverse con el teclado.
//
// El contraste y el foco se miden sobre píxeles de verdad, no sobre el CSS: el terciopelo es un
// degradado con grano, y lo que importa es lo que se ve. Para el texto se capturan los fondos con los
// textos ocultos y se compara el color de cada texto con lo que tiene detrás; para el foco, la zona de
// cada control con foco y sin él.
/* global window, document, getComputedStyle, Image -- lo de «Dentro de la página» corre en el navegador */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PUBLICO = path.join(RAIZ, 'servidor', 'public');
const CHROMIUM = [process.env.CHROMIUM_RUTA, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'];

async function lanzarNavegador() {
  let chromium;
  try { ({ chromium } = require('@playwright/test')); } catch { return null; }
  for (const executablePath of [...CHROMIUM.filter((r) => r && fs.existsSync(r)), undefined]) {
    try { return await chromium.launch({ executablePath, headless: true }); } catch { /* el siguiente */ }
  }
  return null;
}

// El fichero más reciente de una carpeta.
function ultimoCambio(ruta) {
  const st = fs.statSync(ruta);
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(0, ...fs.readdirSync(ruta).map((f) => ultimoCambio(path.join(ruta, f))));
}

// El panel compilado que sirve el servidor (servidor/public): `npm run build` si falta o si algo de
// app/ (o la configuración de Vite) es más nuevo que él. Devuelve si ha compilado.
function compilarPanelSiHaceFalta() {
  const indice = path.join(PUBLICO, 'index.html');
  const fuentes = Math.max(ultimoCambio(path.join(RAIZ, 'app')), ultimoCambio(path.join(RAIZ, 'vite.config.mjs')));
  if (fs.existsSync(indice) && fs.statSync(indice).mtimeMs >= fuentes) return false;
  execFileSync(process.execPath, [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error'], { cwd: RAIZ, stdio: 'pipe' });
  return true;
}

// ── Dentro de la página ──────────────────────────────────────────────────────────────────────
// Se ejecuta con pagina.evaluate: no puede usar nada de fuera. Deja en window.__wcag los colores
// (cualquier color CSS a sRGB con un lienzo de 1 px), la relación de contraste de las WCAG 2.2, los
// píxeles de una captura y qué se mira de cada pantalla.
function instalarWcag() {
  if (window.__wcag) return;
  const lienzo = document.createElement('canvas');
  lienzo.width = 1; lienzo.height = 1;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const rgba = (css) => {
    if (!cache.has(css)) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      cache.set(css, { r, g, b, a: a / 255 });
    }
    return cache.get(css);
  };
  const sobre = (c, f, alfa = c.a) => ({ r: c.r * alfa + f.r * (1 - alfa), g: c.g * alfa + f.g * (1 - alfa), b: c.b * alfa + f.b * (1 - alfa), a: 1 });
  const lineal = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lineal(c.r) + 0.7152 * lineal(c.g) + 0.0722 * lineal(c.b);
  const relacion = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const hex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const describir = (el) => {
    const texto = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}> «${texto}»`;
  };
  // Los píxeles de una captura PNG (en base64), con el tamaño en píxeles CSS.
  const pixeles = async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    return { ancho: c.width, alto: c.height, datos: x.getImageData(0, 0, c.width, c.height).data };
  };
  const pixel = (p, x, y) => { const i = (y * p.ancho + x) * 4; return { r: p.datos[i], g: p.datos[i + 1], b: p.datos[i + 2], a: 1 }; };
  // La parte de una caja que se ve: dentro de la ventana y de los contenedores que recortan.
  const recortar = (el, caja) => {
    let { x0, y0, x1, y1 } = caja;
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      if (getComputedStyle(n).overflow === 'visible') continue;
      const r = n.getBoundingClientRect();
      x0 = Math.max(x0, r.left); y0 = Math.max(y0, r.top); x1 = Math.min(x1, r.right); y1 = Math.min(y1, r.bottom);
    }
    x0 = Math.max(x0, 0); y0 = Math.max(y0, 0);
    x1 = Math.min(x1, document.documentElement.clientWidth); y1 = Math.min(y1, window.innerHeight);
    return x1 - x0 >= 2 && y1 - y0 >= 2 ? { x0, y0, x1, y1 } : null;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && el.checkVisibility({ visibilityProperty: true });
  };
  // Lo que no tiene que llegar al contraste de texto: lo decorativo (aria-hidden), los gráficos (con
  // role="img" el nombre lo lleva el contenedor, como las estrellas de una reseña), lo que solo lee el
  // lector de pantalla y los controles desactivados. Con un diálogo modal abierto, solo cuenta el diálogo.
  const exento = (el) => Boolean(el.closest('[aria-hidden="true"], [role="img"], :disabled, [aria-disabled="true"], .sr-only, svg'))
    || Boolean(document.querySelector('dialog[open]') && !el.closest('dialog[open]'));
  const opacidad = (el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };

  // Los textos que se ven ahora en la ventana: sus cajas (las de sus nodos de texto), su color y su
  // umbral (4,5:1; 3:1 si es grande: 24 px, o 18,66 px en negrita). Una línea que su contenedor corta
  // por arriba o por abajo (más de la mitad escondida) no se lee de ninguna manera: no cuenta.
  const textosVisibles = () => {
    const lista = [];
    const agregar = (el, cajas, texto) => {
      const cs = getComputedStyle(el);
      const tam = parseFloat(cs.fontSize);
      const grande = tam >= 24 || (tam >= 18.66 && Number(cs.fontWeight) >= 700);
      const recortes = cajas.map((c) => {
        const r = recortar(el, c);
        return r && r.y1 - r.y0 >= 0.6 * (c.y1 - c.y0) ? r : null;
      }).filter(Boolean);
      if (recortes.length) lista.push({ el, cajas: recortes, color: rgba(cs.color), opacidad: opacidad(el), umbral: grande ? 3 : 4.5, texto });
    };
    for (const el of document.body.querySelectorAll('*')) {
      if (['SCRIPT', 'STYLE', 'OPTION', 'SELECT', 'TEXTAREA', 'INPUT'].includes(el.tagName) || exento(el) || !visible(el)) continue;
      const nodos = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!nodos.length) continue;
      const cajas = nodos.flatMap((n) => {
        const rango = document.createRange();
        rango.selectNodeContents(n);
        return [...rango.getClientRects()].map((r) => ({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }));
      });
      agregar(el, cajas, nodos.map((n) => n.textContent).join('').trim());
    }
    for (const el of document.body.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, select')) {
      if (exento(el) || !visible(el)) continue;
      const texto = (el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent : el.value) || '';
      if (!texto.trim()) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const [pi, pa, pd, pb] = ['Left', 'Top', 'Right', 'Bottom'].map((k) => parseFloat(cs[`padding${k}`]) + parseFloat(cs[`border${k}Width`]));
      agregar(el, [{ x0: r.left + pi, y0: r.top + pa, x1: r.right - pd, y1: r.bottom - pb }], texto.trim());
    }
    return lista;
  };

  // Compara cada texto con lo que tiene detrás en la captura sin textos: los percentiles 20 y 80 de
  // luminancia del fondo (el que tiene detrás la mayor parte del texto: ni un píxel del grano ni la
  // línea de «ahora» que cruza una cita cuentan como fondo).
  const contrastesBajos = async (lista, b64) => {
    const p = await pixeles(b64);
    const malos = [];
    for (const t of lista) {
      const fondo = [];
      for (const c of t.cajas) {
        const paso = Math.max(1, Math.floor(Math.sqrt(((c.x1 - c.x0) * (c.y1 - c.y0)) / 400)));
        for (let y = Math.floor(c.y0); y < Math.min(c.y1, p.alto); y += paso) {
          for (let x = Math.floor(c.x0); x < Math.min(c.x1, p.ancho); x += paso) fondo.push(pixel(p, x, y));
        }
      }
      if (!fondo.length) continue;
      fondo.sort((a, b) => lum(a) - lum(b));
      const candidatos = [fondo[Math.floor(fondo.length * 0.2)], fondo[Math.min(fondo.length - 1, Math.floor(fondo.length * 0.8))]];
      let peor = null;
      for (const f of candidatos) {
        const texto = sobre(sobre(t.color, f), f, t.opacidad);
        const r = relacion(texto, f);
        if (!peor || r < peor.r) peor = { r, f, texto };
      }
      if (peor.r < t.umbral) {
        malos.push(`${describir(t.el)} «${t.texto.slice(0, 40)}»: ${peor.r.toFixed(2)}:1 (${hex(peor.texto)} sobre ${hex(peor.f)}; hace falta ${t.umbral}:1)`);
      }
    }
    return malos;
  };

  // El foco se ve: entre la captura con foco y sin él tiene que cambiar un contorno que contraste 3:1
  // con lo que había (al menos la mitad del perímetro del control, por si un contenedor lo recorta).
  const focoVisible = async (b64Con, b64Sin, caja) => {
    const [a, b] = [await pixeles(b64Con), await pixeles(b64Sin)];
    let fuertes = 0;
    for (let y = 0; y < Math.min(a.alto, b.alto); y++) {
      for (let x = 0; x < Math.min(a.ancho, b.ancho); x++) {
        const [pa, pb] = [pixel(a, x, y), pixel(b, x, y)];
        if (Math.abs(pa.r - pb.r) + Math.abs(pa.g - pb.g) + Math.abs(pa.b - pb.b) < 12) continue;
        if (relacion(pa, pb) >= 3) fuertes++;
      }
    }
    return { fuertes, hacen: Math.max(12, Math.round(caja.ancho + caja.alto)) };
  };

  // Qué clase de control es, para mirar el foco una vez por clase: etiqueta, tipo, clases, estado y el
  // fondo sobre el que está (el mismo botón sobre una tarjeta o sobre el terciopelo no es el mismo caso).
  const firma = (el) => {
    let fondo = 'lienzo';
    for (let n = el.parentElement; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') { fondo = 'degradado'; break; }
      if (rgba(cs.backgroundColor).a > 0) { fondo = cs.backgroundColor; break; }
    }
    return [el.tagName, el.getAttribute('type'), el.className, el.getAttribute('aria-pressed'), el.getAttribute('aria-current'), fondo].join('|');
  };

  window.__wcag = { rgba, sobre, relacion, hex, describir, textosVisibles, contrastesBajos, focoVisible, exento, visible, firma };
}

// Lo que desborda a lo ancho: la página no puede tener barra horizontal. Si la tiene, qué se sale por
// la derecha (fuera de un contenedor con su propio desplazamiento).
function desbordes() {
  const ancho = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth <= ancho) return [];
  const recortado = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).overflowX !== 'visible') return true;
    }
    return false;
  };
  const culpables = [...document.body.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.right > ancho + 0.5 && !recortado(el);
  }).map((el) => `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 70)}"> hasta ${Math.round(el.getBoundingClientRect().right)} px`);
  return [`la página mide ${document.documentElement.scrollWidth} px de ancho en ${ancho} px`, ...culpables.slice(0, 8)];
}

// ── Desde la prueba ──────────────────────────────────────────────────────────────────────────

const SIN_TEXTO = '*, *::before, *::after, ::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; '
  + 'text-shadow: none !important; caret-color: transparent !important; text-decoration-color: transparent !important; }';

// Los textos que no se leen bien (contraste por debajo de AA), bajando por la página: como mucho
// `pantallas` alturas de ventana (lo de más abajo repite lo mismo).
async function contrastes(pagina, { pantallas = 3 } = {}) {
  await pagina.evaluate(instalarWcag);
  const malos = new Set();
  for (let i = 0; i < pantallas; i++) {
    const quedan = await pagina.evaluate((k) => {
      const dialogo = document.querySelector('dialog[open]');
      if (dialogo) { if (k > 0) return false; } else window.scrollTo(0, k * window.innerHeight);
      window.__textos = window.__wcag.textosVisibles();
      return k === 0 || window.scrollY > 0;
    }, i);
    if (!quedan) break;
    const estilo = await pagina.addStyleTag({ content: SIN_TEXTO });
    const b64 = (await pagina.screenshot({ animations: 'disabled' })).toString('base64');
    await estilo.evaluate((e) => e.remove());
    for (const m of await pagina.evaluate((png) => window.__wcag.contrastesBajos(window.__textos, png), b64)) malos.add(m);
    const alFinal = await pagina.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1);
    if (alFinal) break;
  }
  await pagina.evaluate(() => window.scrollTo(0, 0));
  return [...malos];
}

// Los controles sin nombre accesible, según el árbol de accesibilidad del propio Chromium.
const CONTROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch', 'slider',
  'spinbutton', 'menuitem', 'tab', 'PopUpButton', 'ToggleButton', 'date', 'DateTime', 'InputTime', 'time']);
async function sinNombre(pagina) {
  const cdp = await pagina.context().newCDPSession(pagina);
  try {
    await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const malos = [];
    for (const n of nodes) {
      if (n.ignored || !CONTROLES.has(n.role?.value) || String(n.name?.value || '').trim()) continue;
      let html = '';
      try {
        const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: n.backendDOMNodeId });
        const r = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { return this.outerHTML.slice(0, 140); }', returnByValue: true });
        html = r.result.value;
      } catch { /* sin el HTML, al menos el rol */ }
      malos.push(`${n.role.value}: ${html}`);
    }
    return malos;
  } finally {
    await cdp.detach();
  }
}

// El foco se ve con el teclado: tras un Tab (el navegador pasa a «modo teclado»), se enfoca cada
// control y se compara su zona con foco y sin él. Uno de cada clase (firma), como mucho `maximo`; con
// `vistos` (las firmas ya comprobadas en otras pantallas, con el mismo tema) no se repiten.
async function focosInvisibles(pagina, { maximo = 30, vistos = new Set() } = {}) {
  await pagina.evaluate(instalarWcag);
  await pagina.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await pagina.keyboard.press('Tab');
  const firmas = await pagina.evaluate(([max, ya]) => {
    const vistas = new Set(ya);
    const nuevas = [];
    window.__focables = [];
    for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')) {
      if (window.__focables.length >= max) break;
      if (el.disabled || el.tabIndex < 0 || el.closest('[inert]') || window.__wcag.exento(el) || !window.__wcag.visible(el)) continue;
      const firma = window.__wcag.firma(el);
      if (vistas.has(firma)) continue;
      vistas.add(firma);
      nuevas.push(firma);
      window.__focables.push(el);
    }
    return nuevas;
  }, [maximo, [...vistos]]);
  for (const f of firmas) vistos.add(f);
  const total = firmas.length;
  const malos = [];
  for (let i = 0; i < total; i++) {
    const caja = await pagina.evaluate((k) => {
      const el = window.__focables[k];
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.focus();
      const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.floor(r.left - 6));
      const y = Math.max(0, Math.floor(r.top - 6));
      return { x, y, width: Math.min(document.documentElement.clientWidth, Math.ceil(r.right + 6)) - x, height: Math.min(window.innerHeight, Math.ceil(r.bottom + 6)) - y, ancho: r.width, alto: r.height, enfocado: document.activeElement === el };
    }, i);
    if (!caja.enfocado || caja.width < 4 || caja.height < 4) continue;
    const clip = { x: caja.x, y: caja.y, width: caja.width, height: caja.height };
    const con = (await pagina.screenshot({ clip, animations: 'disabled' })).toString('base64');
    await pagina.evaluate((k) => window.__focables[k].blur(), i);
    const sin = (await pagina.screenshot({ clip, animations: 'disabled' })).toString('base64');
    const r = await pagina.evaluate(([a, b, k, c]) => window.__wcag.focoVisible(a, b, c).then((v) => ({ ...v, desc: window.__wcag.describir(window.__focables[k]) })), [con, sin, i, caja]);
    if (r.fuertes < r.hacen) malos.push(`${r.desc}: el foco apenas se ve (${r.fuertes} píxeles con contraste 3:1; hacen falta ${r.hacen})`);
  }
  return malos;
}

// Todo lo que se mira en una pantalla, con el tema y el ancho que tenga la página en ese momento.
// vistos: las clases de control a las que ya se les ha mirado el foco con este tema.
async function revisarPantalla(pagina, { vistos } = {}) {
  await pagina.evaluate(instalarWcag);
  return {
    desbordes: await pagina.evaluate(desbordes),
    contraste: await contrastes(pagina),
    sinNombre: await sinNombre(pagina),
    foco: await focosInvisibles(pagina, { vistos }),
  };
}

module.exports = { lanzarNavegador, compilarPanelSiHaceFalta, revisarPantalla, contrastes, desbordes, sinNombre, focosInvisibles };
