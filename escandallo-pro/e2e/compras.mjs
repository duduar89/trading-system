// Prueba E2E del flujo de compras de un restaurante NUEVO (sin datos de ejemplo y sin IA):
// alta del restaurante → subida de facturas (3 PDF, una foto de móvil y un CSV) → lectura local →
// revisión (edición, vínculo manual, línea ignorada) → confirmación → base de ingredientes (nombres, categorías,
// unidades, precios, alérgenos, histórico) → segunda factura con subida de precio (alerta y retirada al borrarla) →
// fusión de duplicados, cambio manual de precio e importación de tarifa → comprobaciones en móvil (390×844).
//
// Uso: node e2e/compras.mjs [baseUrl] [outDir]
//   baseUrl  URL de la app compilada servida con `vite preview` (por defecto http://localhost:4173/)
//   outDir   carpeta para capturas y archivos generados (por defecto e2e/screenshots/compras)
// Variables: E2E_OCR_NETWORK=1 descarga el OCR de la CDN en vez de servirlo desde node_modules;
//            E2E_HEADED=1 abre el navegador visible.
// Imprime PASS/FAIL por paso y termina con código ≠ 0 si algo falla.
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] ?? 'http://localhost:4173/').replace(/#.*$/, '').replace(/\/?$/, '/');
const OUT = resolve(process.argv[3] ?? join(ROOT, 'e2e/screenshots/compras'));
const ASSETS = join(OUT, 'archivos');
mkdirSync(ASSETS, { recursive: true });
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const SAMPLES = join(ROOT, 'public/samples');
const OCR_TIMEOUT = 8 * 60_000;

// ───────────────────────────── Informe ─────────────────────────────

const results = [];
let current = null;
const consoleErrors = [];

function norm(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
function fold(s) {
  return norm(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}
const eur2 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur4 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtEur = (v) => norm(eur2.format(v));
const fmtEurPrecise = (v) => norm(eur4.format(v));
const near = (a, b, tol = 0.006) => typeof a === 'number' && Math.abs(a - b) <= tol;

/** Comprobación blanda: se anota el fallo y el paso sigue para dar el máximo de información. */
function check(cond, msg) {
  if (!cond) current?.errors.push(msg);
  return !!cond;
}

async function step(name, fn, { critical = false } = {}) {
  current = { name, errors: [], notes: [] };
  const t0 = Date.now();
  let fatal;
  try {
    await fn();
  } catch (e) {
    fatal = e;
    current.errors.push(`Excepción: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  const ms = Date.now() - t0;
  const ok = current.errors.length === 0;
  results.push({ name, ok, ms, errors: current.errors, notes: current.notes });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${(ms / 1000).toFixed(1)} s)`);
  for (const n of current.notes) console.log(`      · ${n}`);
  for (const e of current.errors) console.log(`      ✗ ${e}`);
  if (!ok && page) await shot(`FALLO-${name}`).catch(() => undefined);
  if (!ok && critical) throw new Error(`Paso crítico fallido: ${name}${fatal ? '' : ''}`);
}
const note = (m) => current?.notes.push(m);

// ───────────────────────────── Navegador ─────────────────────────────

const browser = await chromium.launch({ headless: !process.env.E2E_HEADED });
let page;
let shotIndex = 0;

async function shot(name, opts = {}) {
  const file = join(OUT, `${String(++shotIndex).padStart(2, '0')}-${name.replace(/[^\w.-]+/g, '-').slice(0, 70)}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? true, animations: 'disabled' });
  return file;
}

/** Sirve el motor de OCR (tesseract.js + modelo español) desde node_modules: la prueba no depende de la red. */
async function routeOcrAssets(ctx) {
  if (process.env.E2E_OCR_NETWORK === '1') return;
  const nm = join(ROOT, 'node_modules');
  const lang = [join(nm, '.cache/escandallo-tessdata/spa.traineddata'), join(nm, '.cache/escandallo-bench/spa.traineddata')].find(existsSync);
  const types = { js: 'text/javascript', wasm: 'application/wasm', gz: 'application/octet-stream', traineddata: 'application/octet-stream' };
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\//, async (route) => {
    const url = new URL(route.request().url());
    let file;
    let m;
    if ((m = /^\/npm\/tesseract\.js@[^/]+\/dist\/(.+)$/.exec(url.pathname))) file = join(nm, 'tesseract.js/dist', m[1]);
    else if ((m = /^\/npm\/tesseract\.js-core@[^/]+\/(.+)$/.exec(url.pathname))) file = join(nm, 'tesseract.js-core', m[1]);
    else if (/^\/npm\/@tesseract\.js-data\/spa\/[^/]+\/spa\.traineddata(\.gz)?$/.test(url.pathname)) file = lang;
    if (!file || !existsSync(file)) return route.continue();
    const ext = file.split('.').pop();
    await route.fulfill({
      status: 200,
      body: readFileSync(file),
      headers: { 'content-type': types[ext] ?? 'application/octet-stream', 'access-control-allow-origin': '*' },
    });
  });
}

async function newAppContext(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({
    viewport,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  await routeOcrAssets(ctx);
  return ctx;
}

function watchConsole(p, tag) {
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Avisos esperables del navegador sin relación con la app.
    if (/favicon|Download the React DevTools/i.test(t)) return;
    consoleErrors.push(`[${tag}] ${t.slice(0, 300)}`);
  });
  p.on('pageerror', (e) => consoleErrors.push(`[${tag}] pageerror: ${e.message.slice(0, 300)}`));
}

async function go(hash) {
  await page.goto(BASE + '#' + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

/** Lee una tabla del IndexedDB del restaurante activo (sin los archivos binarios). */
async function dbAll(store) {
  return page.evaluate(async (s) => {
    const open = (name) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const all = (db, st) =>
      new Promise((res, rej) => {
        const r = db.transaction(st, 'readonly').objectStore(st).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const meta = await open('escandallo-meta');
    const settings = await all(meta, 'settings');
    meta.close();
    const app = settings.find((x) => x.id === 'app');
    if (s === '__settings') return [app];
    if (!app?.currentWorkspaceId) return [];
    const db = await open(`escandallo-ws-${app.currentWorkspaceId}`);
    const rows = await all(db, s);
    db.close();
    return rows.map((r) => {
      const { file, images, ...rest } = r;
      return { ...rest, hasFile: !!file, imageCount: images?.length ?? 0 };
    });
  }, store);
}

async function waitFor(fn, { timeout = 30_000, interval = 400, what = 'condición' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (last) return last;
    await page.waitForTimeout(interval);
  }
  throw new Error(`Tiempo agotado esperando ${what}`);
}

async function noHorizontalOverflow() {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const offenders = [];
    if (document.documentElement.scrollWidth > w + 1) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > w + 1 && getComputedStyle(el).position !== 'fixed') {
          const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
          offenders.push(`${el.tagName.toLowerCase()}.${cls} (${Math.round(r.right)}px)`);
          if (offenders.length >= 4) break;
        }
      }
    }
    return { overflow: document.documentElement.scrollWidth > w + 1, scrollWidth: document.documentElement.scrollWidth, width: w, offenders };
  });
}

/** Texto de la tarjeta (Card) que contiene el encabezado indicado. */
async function cardText(heading) {
  const h = page.getByRole('heading', { name: heading }).first();
  await h.waitFor({ timeout: 15_000 });
  return norm(await h.evaluate((el) => el.closest('.shadow-card')?.innerText ?? ''));
}

/** El elemento está dentro de la ventana y no lo tapa nada (barra inferior, avisos…). */
async function reachable(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return false;
  const vp = page.viewportSize();
  if (box.y < 0 || box.y + box.height > vp.height + 1 || box.x < 0 || box.x + box.width > vp.width + 1) return false;
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  });
}

// ───────────────────────────── Archivos de prueba ─────────────────────────────

/** HTML con el mismo diseño que las facturas de ejemplo (para generar variantes en PDF). */
function invoiceHtml({ supplier, address, taxId, number, date, lines, vatPct }) {
  const f2 = (v) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const f3 = (v) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v);
  const base = Math.round(lines.reduce((s, l) => s + Math.round(l.qty * l.price * 100) / 100, 0) * 100) / 100;
  const vat = Math.round(base * vatPct) / 100;
  const total = Math.round((base + vat) * 100) / 100;
  const rows = lines
    .map(
      (l) => `<tr><td>${l.code}</td><td>${l.desc}</td><td class="n">${f3(l.qty)}</td><td>${l.unit}</td><td class="n">${f2(l.price)}</td>
      <td class="n">${f2(Math.round(l.qty * l.price * 100) / 100)}</td></tr>`,
    )
    .join('');
  return {
    base,
    vat,
    total,
    html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0 }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 40px 40px; font-size: 11px }
    .top { display: flex; justify-content: space-between } h1 { font-size: 20px; margin: 0 0 8px } .inv { text-align: right }
    .inv b.t { font-size: 20px; display: block; margin-bottom: 8px } .muted { color: #555 }
    .client { border: 1px solid #999; padding: 8px 12px; margin: 16px 0 20px }
    table.l { width: 100%; border-collapse: collapse; font-size: 15px } table.l th { background: #eee; font-size: 11px; text-align: left; padding: 6px 8px; border-bottom: 1px solid #999 }
    table.l td { padding: 5px 8px; border-bottom: 1px solid #ddd } .n { text-align: right } th.n { text-align: right }
    table.t { margin: 20px 0 0 auto; width: 45%; font-size: 15px; border-collapse: collapse } table.t td { padding: 4px 8px }
    table.t tr.tot td { font-weight: bold; font-size: 13px; border-top: 1px solid #111 } .foot { margin-top: 30px; font-size: 9px; color: #555 }
    </style></head><body>
    <div class="top"><div><h1>${supplier}</h1><div class="muted">${address}</div><div class="muted">CIF: ${taxId}</div></div>
    <div class="inv"><b class="t">FACTURA</b><div>Nº Factura: <b>${number}</b></div><div>Fecha: ${date}</div></div></div>
    <div class="client"><b>Cliente:</b> Bar Prueba E2E · CIF B11223344 · C/ Mayor 1, 28013 Madrid</div>
    <table class="l"><thead><tr><th>Código</th><th>Descripción</th><th class="n">Cantidad</th><th>Ud.</th><th class="n">Precio</th><th class="n">Importe</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <table class="t"><tr><td>Base imponible</td><td class="n">${f2(base)} €</td></tr><tr><td>IVA ${vatPct}%</td><td class="n">${f2(vat)} €</td></tr>
    <tr class="tot"><td>TOTAL FACTURA</td><td class="n">${f2(total)} €</td></tr></table>
    <div class="foot">Forma de pago: transferencia a 30 días. Inscrita en el Registro Mercantil de Madrid. Gracias por su confianza.</div>
    </body></html>`,
  };
}

const FRUIT_LINES = [
  { code: '1021', desc: 'PATATA AGRIA SACO 25KG', qty: 25, unit: 'KG', price: 0.89 },
  { code: '1044', desc: 'CEBOLLA DULCE MALLA', qty: 10, unit: 'KG', price: 1.15 },
  { code: '1102', desc: 'TOMATE PERA CAT.I', qty: 12.4, unit: 'KG', price: 2.35 },
  { code: '1160', desc: 'PIMIENTO ROJO', qty: 5.25, unit: 'KG', price: 2.4 },
  { code: '1201', desc: 'AJO MORADO LAS PEDROÑERAS', qty: 2, unit: 'KG', price: 5.9 },
  { code: '1307', desc: 'LIMONES MALLA 1KG', qty: 3, unit: 'UD', price: 1.95 },
  { code: '1410', desc: 'PEREJIL MANOJO', qty: 6, unit: 'UD', price: 0.55 },
  { code: '1522', desc: 'LECHUGA ROMANA', qty: 8, unit: 'UD', price: 0.78 },
];

const CSV_NAME = 'compras-cash-carry-sierra.csv';
const CSV = [
  'Fecha;Proveedor;Nº Factura;Descripción;Cantidad;Ud.;Precio;Dto %;Importe',
  '22/09/2026;Cash & Carry La Sierra S.L.;CCS-2026/0456;AZUCAR BLANCO 1KG;10;ud;1,15;;11,50',
  '22/09/2026;Cash & Carry La Sierra S.L.;CCS-2026/0456;SAL MARINA FINA 1KG;5;ud;0,45;;2,25',
  '22/09/2026;Cash & Carry La Sierra S.L.;CCS-2026/0456;VINAGRE DE JEREZ 750ML;2;bot;4,80;10;8,64',
  '22/09/2026;Cash & Carry La Sierra S.L.;CCS-2026/0456;QUESO MANCHEGO CURADO;2,350;kg;16,40;;38,54',
  '22/09/2026;Cash & Carry La Sierra S.L.;CCS-2026/0456;ATUN CLARO EN ACEITE LATA 900G;3;lata;7,90;;23,70',
  '22/09/2026;Cash & Carry La Sierra S.L.;CCS-2026/0456;PATATA NUEVA SACO 10KG;1;saco;8,90;;8,90',
  '22/09/2026;Cash & Carry La Sierra S.L.;CCS-2026/0456;BOLSAS BASURA 85X105 20U;2;paq;3,20;;6,40',
].join('\r\n');

const TARIFF_NAME = 'tarifa-distribuciones-octubre.csv';
const TARIFF = ['Código;Artículo;Formato;Precio', '430201;ARROZ BOMBA 1KG;ud;3,80', '400230;HARINA TRIGO FUERZA SACO 10KG;saco;9,50', '460110;PIMIENTO VERDE ITALIANO;kg;2,10'].join(
  '\r\n',
);

async function buildAssets() {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1250 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  // Mini servidor en memoria: pdf.js del proyecto + las facturas de ejemplo.
  await p.route('http://e2e.local/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const map = {
      '/pdf.mjs': [join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.min.mjs'), 'text/javascript'],
      '/pdf.worker.mjs': [join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'), 'text/javascript'],
      '/carnes.pdf': [join(SAMPLES, 'factura-carnes-guadarrama.pdf'), 'application/pdf'],
    };
    if (path === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    const hit = map[path];
    if (!hit) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: hit[1], body: readFileSync(hit[0]) });
  });
  await p.goto('http://e2e.local/');
  // Render de la factura de carnes con pdf.js y montaje como foto de móvil: papel algo girado y en perspectiva,
  // sombra, luz desigual y fondo de mesa. Se captura en JPEG (como una cámara).
  await p.evaluate(async () => {
    const pdfjs = await import('http://e2e.local/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'http://e2e.local/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ url: 'http://e2e.local/carnes.pdf' }).promise;
    const pg = await doc.getPage(1);
    const vp = pg.getViewport({ scale: 2.2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
    document.body.style.cssText =
      'margin:0;width:900px;height:1250px;overflow:hidden;background:radial-gradient(circle at 30% 20%,#8a6a4f,#5b4331 70%,#3e2d21);';
    const stage = document.createElement('div');
    stage.id = 'stage';
    stage.style.cssText = 'position:absolute;inset:0;perspective:2200px;';
    const paper = document.createElement('div');
    paper.style.cssText =
      'position:absolute;left:70px;top:60px;width:760px;transform:rotateZ(-2.4deg) rotateX(4deg) rotateY(-2deg);transform-origin:50% 40%;' +
      'box-shadow:0 30px 60px rgba(0,0,0,.55),0 4px 12px rgba(0,0,0,.4);background:#fbfaf6;';
    canvas.style.cssText = 'display:block;width:760px;height:auto;filter:contrast(.92) brightness(.98) sepia(.08);';
    const light = document.createElement('div');
    light.style.cssText =
      'position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.18),rgba(0,0,0,0) 45%,rgba(0,0,0,.16));mix-blend-mode:multiply;';
    paper.append(canvas, light);
    stage.append(paper);
    document.body.append(stage);
  });
  const photo = join(ASSETS, 'foto-factura-carnes.jpg');
  await p.screenshot({ path: photo, type: 'jpeg', quality: 84 });

  // Variante de la factura de la frutería: nuevo número y fecha, TOMATE PERA más caro.
  const variant = invoiceHtml({
    supplier: 'Frutas y Verduras Hermanos García S.L.',
    address: 'Mercamadrid, Nave C-14, 28053 Madrid',
    taxId: 'B28123456',
    number: 'FV-2026/0987',
    date: '24/09/2026',
    lines: FRUIT_LINES,
    vatPct: 4,
  });
  await p.setContent(variant.html);
  const variantPdf = join(ASSETS, 'factura-fruteria-garcia-2.pdf');
  await p.pdf({ path: variantPdf, format: 'A4', printBackground: true });
  await ctx.close();

  const csv = join(ASSETS, CSV_NAME);
  writeFileSync(csv, '﻿' + CSV, 'utf8');
  const tariff = join(ASSETS, TARIFF_NAME);
  writeFileSync(tariff, TARIFF, 'utf8');
  return { photo, variantPdf, variant, csv, tariff };
}

// ───────────────────────────── Verdad de referencia ─────────────────────────────

const L = (description, quantity, unit, unitPrice, total, pricePerBase, baseUnit, discountPct) => ({
  description,
  quantity,
  unit,
  unitPrice,
  total,
  pricePerBase,
  baseUnit,
  discountPct,
});

const EXPECTED = {
  fruta: {
    file: 'factura-fruteria-garcia.pdf',
    supplierName: 'Frutas y Verduras Hermanos García S.L.',
    number: 'FV-2026/0913',
    date: '2026-09-18',
    subtotal: 96.48,
    vatTotal: 3.86,
    total: 100.34,
    method: 'pdf-texto',
    lines: [
      L('PATATA AGRIA SACO 25KG', 25, 'kg', 0.89, 22.25, 0.89, 'kg'),
      L('CEBOLLA DULCE MALLA', 10, 'kg', 1.15, 11.5, 1.15, 'kg'),
      L('TOMATE PERA CAT.I', 12.4, 'kg', 1.85, 22.94, 1.85, 'kg'),
      L('PIMIENTO ROJO', 5.25, 'kg', 2.4, 12.6, 2.4, 'kg'),
      L('AJO MORADO LAS PEDROÑERAS', 2, 'kg', 5.9, 11.8, 5.9, 'kg'),
      L('LIMONES MALLA 1KG', 3, 'ud', 1.95, 5.85, 1.95, 'kg'),
      L('PEREJIL MANOJO', 6, 'ud', 0.55, 3.3, 0.55, 'ud'),
      L('LECHUGA ROMANA', 8, 'ud', 0.78, 6.24, 0.78, 'ud'),
    ],
  },
  carnes: {
    file: 'factura-carnes-guadarrama.pdf',
    supplierName: 'Carnes Selectas Guadarrama S.L.',
    number: 'CSG-26-004187',
    date: '2026-09-19',
    subtotal: 596.58,
    vatTotal: 59.66,
    total: 656.24,
    method: 'pdf-texto',
    lines: [
      L('SOLOMILLO TERNERA NAC. ENTERO', 4.62, 'kg', 33.5, 154.77, 33.5, 'kg'),
      L('LOMO ALTO VACA MADURADA 30D', 6.1, 'kg', 29.9, 182.39, 29.9, 'kg'),
      L('SECRETO IBERICO CEBO', 3.4, 'kg', 16.8, 57.12, 16.8, 'kg'),
      L('CARRILLERA IBERICA', 5, 'kg', 11.2, 56, 11.2, 'kg'),
      L('PECHUGA POLLO CAMPERO', 4.25, 'kg', 7.6, 32.3, 7.6, 'kg'),
      L('JAMON IBERICO BELLOTA LONCHEADO 100G', 10, 'ud', 11.4, 114, 114, 'kg'),
    ],
  },
  distrib: {
    file: 'factura-distribuciones-centro.pdf',
    supplierName: 'Distribuciones Hosteleras Centro S.L.',
    number: 'A/2026/15542',
    date: '2026-09-20',
    subtotal: 292.68,
    vatTotal: 29.27,
    total: 321.95,
    method: 'pdf-texto',
    lines: [
      L('ACEITE OLIVA V.E. GARRAFA 5L', 4, 'ud', 44.5, 169.1, 8.455, 'l', 5),
      L('HARINA TRIGO FUERZA SACO 10KG', 1, 'ud', 9.8, 9.8, 0.98, 'kg'),
      L('LECHE ENTERA 6X1L', 3, 'caja', 5.94, 17.82, 0.99, 'l'),
      L('NATA 35% MG 1L', 6, 'ud', 3.85, 22.41, 3.7345, 'l', 3),
      L('HUEVOS M 30 UDS', 4, 'ud', 6.9, 27.6, 0.23, 'ud'),
      L('ARROZ BOMBA 1KG', 5, 'ud', 3.95, 19.75, 3.95, 'kg'),
      L('MANTEQUILLA SIN SAL 250G', 8, 'ud', 2.45, 19.6, 9.8, 'kg'),
      L('PIMENTON DULCE DE LA VERA 75G', 3, 'ud', 2.2, 6.6, 29.3333, 'kg'),
    ],
  },
  csv: {
    file: CSV_NAME,
    supplierName: 'Cash & Carry La Sierra S.L.',
    number: 'CCS-2026/0456',
    date: '2026-09-22',
    method: 'hoja',
    lines: [
      L('AZUCAR BLANCO 1KG', 10, 'ud', 1.15, 11.5, 1.15, 'kg'),
      L('SAL MARINA FINA 1KG', 5, 'ud', 0.45, 2.25, 0.45, 'kg'),
      L('VINAGRE DE JEREZ 750ML', 2, 'bot', 4.8, 8.64, 5.76, 'l', 10),
      L('QUESO MANCHEGO CURADO', 2.35, 'kg', 16.4, 38.54, 16.4, 'kg'),
      L('ATUN CLARO EN ACEITE LATA 900G', 3, 'lata', 7.9, 23.7, 8.7778, 'kg'),
      L('PATATA NUEVA SACO 10KG', 1, 'saco', 8.9, 8.9, 0.89, 'kg'),
      L('BOLSAS BASURA 85X105 20U', 2, 'paq', 3.2, 6.4, undefined, undefined),
    ],
  },
};
EXPECTED.foto = { ...EXPECTED.carnes, file: 'foto-factura-carnes.jpg', method: 'ocr' };

function sameUnit(a, b) {
  const n = (u) => fold(u).replace(/\.$/, '');
  return n(a) === n(b);
}

/** Compara las líneas guardadas de una factura con las esperadas (orden libre, por descripción). */
function checkInvoiceData(tag, inv, exp) {
  check(inv, `${tag}: no se ha encontrado la factura`);
  if (!inv) return;
  check(inv.status === 'revision', `${tag}: estado «${inv.status}» (se esperaba «revision»)${inv.error ? `: ${inv.error}` : ''}`);
  check(norm(inv.supplierName) === exp.supplierName, `${tag}: proveedor «${inv.supplierName}» ≠ «${exp.supplierName}»`);
  check(norm(inv.number) === exp.number, `${tag}: nº «${inv.number}» ≠ «${exp.number}»`);
  check(inv.date === exp.date, `${tag}: fecha ${inv.date} ≠ ${exp.date}`);
  check(inv.method === exp.method, `${tag}: método ${inv.method} ≠ ${exp.method}`);
  if (exp.subtotal != null) check(near(inv.subtotal, exp.subtotal, 0.001), `${tag}: base ${inv.subtotal} ≠ ${exp.subtotal}`);
  if (exp.vatTotal != null) check(near(inv.vatTotal, exp.vatTotal, 0.001), `${tag}: IVA ${inv.vatTotal} ≠ ${exp.vatTotal}`);
  if (exp.total != null) check(near(inv.total, exp.total, 0.001), `${tag}: total ${inv.total} ≠ ${exp.total}`);
  check(inv.lines.length === exp.lines.length, `${tag}: ${inv.lines.length} líneas (se esperaban ${exp.lines.length})`);
  for (const e of exp.lines) {
    const l = inv.lines.find((x) => fold(x.description) === fold(e.description));
    if (!check(l, `${tag}: falta la línea «${e.description}» (leídas: ${inv.lines.map((x) => x.description).join(' | ')})`)) continue;
    check(near(l.quantity, e.quantity, 0.0005), `${tag} «${e.description}»: cantidad ${l.quantity} ≠ ${e.quantity}`);
    check(sameUnit(l.unit, e.unit), `${tag} «${e.description}»: unidad «${l.unit}» ≠ «${e.unit}»`);
    check(near(l.unitPrice, e.unitPrice, 0.0005), `${tag} «${e.description}»: precio ${l.unitPrice} ≠ ${e.unitPrice}`);
    check(near(l.total, e.total, 0.005), `${tag} «${e.description}»: importe ${l.total} ≠ ${e.total}`);
    check((l.discountPct ?? 0) === (e.discountPct ?? 0), `${tag} «${e.description}»: dto ${l.discountPct ?? 0} ≠ ${e.discountPct ?? 0}`);
    if (e.pricePerBase != null) {
      check(l.baseUnit === e.baseUnit, `${tag} «${e.description}»: unidad base ${l.baseUnit} ≠ ${e.baseUnit}`);
      check(near(l.pricePerBase, e.pricePerBase, 0.0006), `${tag} «${e.description}»: €/${e.baseUnit} ${l.pricePerBase} ≠ ${e.pricePerBase}`);
    }
  }
}

/** Lee las tarjetas de línea de la pantalla de revisión. */
async function readLineCards() {
  return page.$$eval('[data-line-id]', (cards) =>
    cards.map((c) => {
      const v = (f) => c.querySelector(`[data-field="${f}"]`)?.value ?? '';
      const text = (c.innerText || '').replace(/\s+/g, ' ');
      const real = /Precio real\s*([\d.,]+\s*€)\s*\/\s*(kg|l|ud)/.exec(text);
      let status = 'desconocido';
      if (/Línea ignorada/.test(text)) status = 'ignorado';
      else if (/Nuevo producto/.test(text)) status = 'nuevo';
      else if (/¿Es…\?/.test(text)) status = 'sugerido';
      else if (/Vinculado/.test(text)) status = 'vinculado';
      return {
        id: c.getAttribute('data-line-id'),
        description: v('description'),
        quantity: v('quantity'),
        unit: v('unit'),
        unitPrice: v('unitPrice'),
        discountPct: v('discountPct'),
        total: v('total'),
        realPrice: real ? `${real[1]}/${real[2]}` : null,
        status,
        text,
      };
    }),
  );
}

const numText = (v, dec) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec[0], maximumFractionDigits: dec[1], useGrouping: false }).format(v);

function checkLineCards(tag, cards, exp) {
  check(cards.length === exp.lines.length, `${tag}: la pantalla muestra ${cards.length} líneas (se esperaban ${exp.lines.length})`);
  for (const e of exp.lines) {
    const c = cards.find((x) => fold(x.description) === fold(e.description));
    if (!check(c, `${tag}: la pantalla no muestra «${e.description}»`)) continue;
    check(c.quantity === numText(e.quantity, [0, 3]), `${tag} «${e.description}»: cantidad en pantalla «${c.quantity}»`);
    check(c.unitPrice === numText(e.unitPrice, [2, 4]), `${tag} «${e.description}»: precio en pantalla «${c.unitPrice}»`);
    check(c.total === numText(e.total, [2, 2]), `${tag} «${e.description}»: importe en pantalla «${c.total}»`);
    if (e.discountPct) check(c.discountPct === numText(e.discountPct, [0, 2]), `${tag} «${e.description}»: dto en pantalla «${c.discountPct}»`);
    if (e.pricePerBase != null) {
      const want = `${fmtEurPrecise(Math.round(e.pricePerBase * 1e4) / 1e4)}/${e.baseUnit}`;
      check(norm(c.realPrice) === norm(want), `${tag} «${e.description}»: precio real en pantalla «${c.realPrice}» (se esperaba «${want}»)`);
    }
  }
}

async function openInvoice(id) {
  await go(`/facturas/${id}`);
  await page.getByRole('heading', { name: 'Líneas de la factura' }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(300);
}

async function modalCounts() {
  const dlg = page.getByRole('dialog').filter({ hasText: 'Factura confirmada' });
  await dlg.waitFor({ timeout: 20_000 });
  const text = norm(await dlg.innerText());
  const num = (re) => {
    const m = re.exec(text);
    return m ? Number(m[1]) : NaN;
  };
  return {
    dlg,
    text,
    updated: num(/(\d+)\s*precios? actualizados?/),
    created: num(/(\d+)\s*productos? nuevos?/),
    dishes: num(/(\d+)\s*escandallos? cambian?/),
  };
}

async function closeModal() {
  const dlg = page.getByRole('dialog').first();
  await dlg.getByRole('button', { name: 'Cerrar' }).first().click();
  await dlg.waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
}

async function confirmCurrentInvoice() {
  const btn = page.getByRole('button', { name: /Confirmar y actualizar precios|Volver a aplicar precios/ });
  await btn.click();
  // Si hay líneas con unidad incompatible aparece un aviso previo: se confirma igualmente (se anota).
  const mismatch = page.getByRole('dialog').filter({ hasText: 'Hay precios que no se podrán aplicar' });
  if (await mismatch.isVisible().catch(() => false)) {
    note('Aviso de unidades incompatibles antes de confirmar');
    await mismatch.getByRole('button', { name: 'Confirmar igualmente' }).click();
  }
  return modalCounts();
}

// ───────────────────────────── Escenario ─────────────────────────────

let assets;
const ids = {};
let products = [];
const byName = (name) => products.find((p) => fold(p.name) === fold(name));
const findProduct = (re) => products.find((p) => re.test(fold(p.name)));

let exitCode = 0;
try {
  await step('0. Preparar archivos (foto de móvil, variante PDF, CSV de compras y tarifa)', async () => {
    assets = await buildAssets();
    check(existsSync(assets.photo), 'no se generó la foto');
    check(existsSync(assets.variantPdf), 'no se generó la variante PDF');
    check(near(assets.variant.base, 102.68, 0.001), `base de la variante ${assets.variant.base} ≠ 102,68`);
    note(`archivos en ${ASSETS}`);
  }, { critical: true });

  const ctx = await newAppContext();
  page = await ctx.newPage();
  watchConsole(page, 'escritorio');

  await step('1. Bienvenida → «Empezar con mi restaurante» → crear «Bar Prueba E2E»', async () => {
    await go('/');
    await page.getByRole('button', { name: 'Empezar con mi restaurante' }).first().waitFor({ timeout: 20_000 });
    await shot('bienvenida', { fullPage: false });
    await page.getByRole('button', { name: 'Empezar con mi restaurante' }).first().click();
    const name = page.getByLabel('Nombre del restaurante o cliente');
    await name.waitFor();
    await name.fill('Bar Prueba E2E');
    await shot('crear-restaurante', { fullPage: false });
    await page.getByRole('button', { name: 'Crear y empezar' }).click();
    await page.getByRole('heading', { name: /Bar Prueba E2E/ }).first().waitFor({ timeout: 20_000 });
    const [settings] = await dbAll('__settings');
    check(settings?.aiEnabled !== true, 'la IA debería estar desactivada por defecto');
    check(!settings?.apiKey, 'no debería haber clave de IA');
    check((await dbAll('products')).length === 0, 'un restaurante nuevo no debe tener ingredientes');
    await shot('panel-vacio');
  }, { critical: true });

  await step('2. Facturas: subir 3 PDF, una foto y un CSV y esperar a que se lean (100 % local)', async () => {
    await go('/facturas');
    await page.getByText('Tu primera factura').waitFor({ timeout: 15_000 });
    const main = page.locator('input[type=file][accept*=".pdf"]').first();
    await main.setInputFiles(['factura-fruteria-garcia.pdf', 'factura-carnes-guadarrama.pdf', 'factura-distribuciones-centro.pdf'].map((f) => join(SAMPLES, f)));
    await page.locator('input[type=file][capture]').first().setInputFiles(assets.photo);
    await main.setInputFiles(assets.csv);
    // La cola se ve en pantalla mientras se leen.
    await page.getByRole('status').filter({ hasText: /Leyendo facturas|Facturas en cola/ }).first().waitFor({ timeout: 15_000 });
    await shot('cola-de-lectura', { fullPage: false });
    const t0 = Date.now();
    let sawProcessing = false;
    const invoices = await waitFor(
      async () => {
        const list = await dbAll('invoices');
        if (list.some((i) => i.status === 'procesando')) sawProcessing = true;
        return list.length >= 5 && list.every((i) => i.status !== 'pendiente' && i.status !== 'procesando') ? list : null;
      },
      { timeout: OCR_TIMEOUT, interval: 1000, what: 'a que terminen las lecturas' },
    );
    note(`lectura de 5 archivos: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    check(sawProcessing, 'no se vio ninguna factura en estado «procesando»');
    check(invoices.length === 5, `se esperaban 5 facturas y hay ${invoices.length}`);
    for (const inv of invoices) note(`${inv.fileName}: ${inv.status} · ${inv.method} · ${inv.lines.length} líneas${inv.error ? ` · ${inv.error}` : ''}`);
    const byFile = (f) => invoices.find((i) => i.fileName === f);
    for (const k of ['fruta', 'carnes', 'distrib', 'foto', 'csv']) {
      const inv = byFile(EXPECTED[k].file);
      if (inv) ids[k] = inv.id;
      checkInvoiceData(k, inv, EXPECTED[k]);
    }
    const [settings] = await dbAll('__settings');
    check(settings?.aiEnabled !== true, 'la IA sigue desactivada');
    await page.waitForTimeout(800);
    // En la lista: 5 «Por revisar» con proveedor, nº, líneas y total.
    const rows = page.locator('table tbody tr');
    await waitFor(async () => (await rows.count()) === 5, { what: '5 filas en la lista' });
    const texts = (await rows.allInnerTexts()).map(norm);
    check(texts.filter((t) => t.includes('Por revisar')).length === 5, `no todas las filas muestran «Por revisar»: ${texts.join(' || ')}`);
    for (const k of ['fruta', 'carnes', 'distrib', 'csv']) {
      const e = EXPECTED[k];
      const row = texts.find((t) => t.includes(e.number));
      if (!check(row, `la lista no muestra la factura ${e.number}`)) continue;
      check(row.includes(e.supplierName), `fila ${e.number}: falta el proveedor`);
      check(new RegExp(`\\b${e.lines.length}\\b`).test(row), `fila ${e.number}: no muestra ${e.lines.length} líneas`);
      const amount = e.subtotal ?? e.lines.reduce((s, l) => s + l.total, 0);
      check(row.includes(fmtEur(amount)), `fila ${e.number}: no muestra el total ${fmtEur(amount)} («${row}»)`);
    }
    check(texts.filter((t) => t.includes(EXPECTED.carnes.number)).length === 2, 'la foto de la factura de carnes debería aparecer como segunda factura CSG-26-004187');
    check((await page.getByRole('status').filter({ hasText: 'Leyendo facturas' }).count()) === 0, 'el panel de la cola sigue visible al terminar');
    await shot('facturas-por-revisar');
  }, { critical: true });

  await step('3a. Revisar frutería: líneas, €/kg-€/ud y confirmar (8 productos nuevos)', async () => {
    await openInvoice(ids.fruta);
    const cards = await readLineCards();
    checkLineCards('fruta', cards, EXPECTED.fruta);
    check(cards.every((c) => c.status === 'nuevo'), `todas deberían ser «Nuevo producto»: ${cards.map((c) => c.status).join(',')}`);
    const bar = norm(await page.getByRole('status').filter({ hasText: 'Suma de líneas' }).first().innerText());
    check(bar.includes('Cuadra'), `la barra de totales no dice «Cuadra»: ${bar}`);
    await shot('revision-fruteria');
    const res = await confirmCurrentInvoice();
    await shot('confirmada-fruteria', { fullPage: false });
    check(res.created === 8, `productos nuevos en el resumen: ${res.created} (8)`);
    check(res.updated === 0, `precios actualizados en el resumen: ${res.updated} (0)`);
    await closeModal();
  });

  await step('3b. Revisar carnes (PDF): €/kg (solomillo 33,50) y confirmar (6 nuevos)', async () => {
    await openInvoice(ids.carnes);
    const cards = await readLineCards();
    checkLineCards('carnes', cards, EXPECTED.carnes);
    check(cards.every((c) => c.status === 'nuevo'), `todas deberían ser nuevas: ${cards.map((c) => `${c.description}=${c.status}`).join(', ')}`);
    await shot('revision-carnes');
    const res = await confirmCurrentInvoice();
    check(res.created === 6, `productos nuevos: ${res.created} (6)`);
    check(res.updated === 0, `precios actualizados: ${res.updated} (0)`);
    await closeModal();
  });

  await step('3c. Revisar distribuciones: dto 5 %, 6x1L, 30 uds, saco 10 kg, 75 g; editar cantidad con recálculo en vivo', async () => {
    await openInvoice(ids.distrib);
    const cards = await readLineCards();
    checkLineCards('distrib', cards, EXPECTED.distrib);
    await shot('revision-distribuciones');
    // Editar la cantidad de la leche (3 → 4 cajas): importe y litros comprados se recalculan al momento.
    const milk = page.locator('[data-line-id]').filter({ has: page.locator('[data-field="description"][value="LECHE ENTERA 6X1L"]') });
    const qty = milk.locator('[data-field="quantity"]');
    await qty.fill('4');
    await page.waitForTimeout(150);
    check((await milk.locator('[data-field="total"]').inputValue()) === '23,76', `importe tras editar: ${await milk.locator('[data-field="total"]').inputValue()} (23,76)`);
    const milkText = norm(await milk.innerText());
    check(/24 l comprados/.test(milkText), `no muestra «24 l comprados»: ${milkText.slice(0, 200)}`);
    check(milkText.includes(`${fmtEurPrecise(0.99)}/l`), 'el precio real de la leche debería seguir en 0,99 €/l');
    const bar = norm(await page.getByRole('status').filter({ hasText: 'Suma de líneas' }).first().innerText());
    check(/No cuadra por 5,94/.test(bar), `la barra de totales debería avisar «No cuadra por 5,94 €»: ${bar}`);
    await shot('edicion-cantidad', { fullPage: false });
    await qty.fill('3');
    await page.waitForTimeout(150);
    check((await milk.locator('[data-field="total"]').inputValue()) === '17,82', 'el importe no vuelve a 17,82');
    const bar2 = norm(await page.getByRole('status').filter({ hasText: 'Suma de líneas' }).first().innerText());
    check(bar2.includes('Cuadra'), `tras deshacer, la barra debería decir «Cuadra»: ${bar2}`);
    // Guardado automático
    await page.getByText('Guardado').first().waitFor({ timeout: 8000 });
    const inv = (await dbAll('invoices')).find((i) => i.id === ids.distrib);
    check(near(inv.lines.find((l) => l.description === 'LECHE ENTERA 6X1L')?.quantity, 3), 'la cantidad guardada de la leche no es 3');
    const res = await confirmCurrentInvoice();
    check(res.created === 8, `productos nuevos: ${res.created} (8)`);
    await closeModal();
  });

  await step('4. Foto de la factura de carnes (OCR): mismas líneas, todo vinculado, sin alertas falsas', async () => {
    await openInvoice(ids.foto);
    const cards = await readLineCards();
    checkLineCards('foto', cards, EXPECTED.foto);
    check(cards.every((c) => c.status === 'vinculado'), `todas deberían venir vinculadas a los productos de la factura PDF: ${cards.map((c) => `${c.description}=${c.status}`).join(', ')}`);
    check(cards.every((c) => /sin cambio/.test(c.text)), 'cada línea debería indicar «= sin cambio» respecto al precio vigente');
    const pageText = norm(await page.locator('main').innerText());
    check(/duplicad|ya (está|has) (confirmad|subid)|misma factura/i.test(pageText), 'no avisa de que es la misma factura (proveedor y nº) que otra ya confirmada');
    await shot('revision-foto-duplicada');
    const before = await dbAll('pricePoints');
    const res = await confirmCurrentInvoice();
    check(res.created === 0, `la foto no debe crear productos (creó ${res.created})`);
    check(res.updated === 6, `precios aplicados: ${res.updated} (6)`);
    check(/6 ingredientes mantienen el mismo precio/.test(res.text), `el resumen debería decir que 6 mantienen el precio: ${res.text.slice(0, 300)}`);
    check(!/Cambios de precio/.test(res.text), 'no debería listar cambios de precio');
    await shot('confirmada-foto', { fullPage: false });
    await closeModal();
    products = await dbAll('products');
    const solomillo = findProduct(/solomillo/);
    check(near(solomillo?.pricePerBase, 33.5, 1e-6), `precio del solomillo tras la foto: ${solomillo?.pricePerBase}`);
    const after = await dbAll('pricePoints');
    note(`puntos de precio: ${before.length} → ${after.length}`);
    const soloPts = after.filter((p) => p.productId === solomillo?.id);
    check(soloPts.every((p) => near(p.pricePerBase, 33.5, 1e-6)), 'el solomillo tiene puntos con otro precio');
    await go('/');
    await page.getByRole('heading', { name: 'Alertas de precio' }).waitFor({ timeout: 15_000 });
    const alerts = await cardText('Alertas de precio');
    check(/Precios estables/.test(alerts), `el panel no debería mostrar alertas: ${alerts.slice(0, 200)}`);
  });

  await step('3d. CSV de compras: vincular una línea con el selector, ignorar otra y confirmar', async () => {
    await openInvoice(ids.csv);
    let cards = await readLineCards();
    checkLineCards('csv', cards, EXPECTED.csv);
    products = await dbAll('products');
    const potato = findProduct(/^patata/);
    check(potato, 'no existe el producto de la patata agria');
    // Vincular «PATATA NUEVA SACO 10KG» con la patata que ya existe, desde el selector.
    const line = page.locator('[data-line-id]').filter({ has: page.locator('[data-field="description"][value="PATATA NUEVA SACO 10KG"]') });
    await line.getByTitle('Elegir ingrediente para esta línea').click();
    const search = page.getByRole('combobox');
    await search.fill('patata agria');
    await page.getByRole('option', { name: new RegExp(potato?.name ?? 'Patata', 'i') }).first().click();
    await page.waitForTimeout(200);
    cards = await readLineCards();
    const linked = cards.find((c) => c.description === 'PATATA NUEVA SACO 10KG');
    check(linked?.status === 'vinculado', `la patata nueva debería quedar vinculada (${linked?.status})`);
    check(linked?.text.includes(potato?.name ?? '¿?'), 'la línea no muestra el ingrediente elegido');
    check(/sin cambio/.test(linked?.text ?? ''), 'misma tarifa (0,89 €/kg): debería indicar «= sin cambio»');
    // Ignorar las bolsas de basura (no es comida).
    const bags = page.locator('[data-line-id]').filter({ has: page.locator('[data-field="description"][value="BOLSAS BASURA 85X105 20U"]') });
    await bags.getByTitle('Elegir ingrediente para esta línea').click();
    await page.getByRole('option', { name: /Ignorar línea/ }).click();
    await page.waitForTimeout(200);
    check(/Línea ignorada/.test(norm(await bags.innerText())), 'las bolsas no aparecen como ignoradas');
    await shot('revision-csv');
    const res = await confirmCurrentInvoice();
    check(res.created === 5, `productos nuevos: ${res.created} (5)`);
    check(res.updated === 1, `precios actualizados: ${res.updated} (1)`);
    check(/1 línea omitida/.test(res.text), `el resumen debería contar 1 línea omitida: ${res.text.slice(0, 300)}`);
    await shot('confirmada-csv', { fullPage: false });
    await closeModal();
    const inv = (await dbAll('invoices')).find((i) => i.id === ids.csv);
    check(inv?.status === 'confirmada', `estado del CSV: ${inv?.status}`);
    check(inv?.lines.find((l) => l.description.startsWith('PATATA NUEVA'))?.productId === potato?.id, 'la línea de patata no quedó vinculada a la patata existente');
    check(inv?.lines.find((l) => l.description.startsWith('BOLSAS'))?.matchStatus === 'ignorado', 'la línea de bolsas no quedó ignorada');
  });

  await step('5. Ingredientes: nombres limpios, categorías, unidades, precios y alérgenos', async () => {
    products = await dbAll('products');
    note(`${products.length} ingredientes: ${products.map((p) => `${p.name} [${p.category}, ${p.pricePerBase}/${p.baseUnit}${p.allergens.length ? `, ${p.allergens.join('+')}` : ''}]`).join(' · ')}`);
    check(products.length === 27, `se esperaban 27 ingredientes y hay ${products.length}`);
    const exp = [
      // [regex sobre el nombre plegado, nombre ideal, categoría, unidad, precio, alérgenos obligatorios]
      [/^patata agria$/, 'Patata agria', 'verdura', 'kg', 0.89, []],
      [/^cebolla dulce$/, 'Cebolla dulce', 'verdura', 'kg', 1.15, []],
      [/^tomate pera$/, 'Tomate pera', 'verdura', 'kg', 1.85, []],
      [/^pimiento rojo$/, 'Pimiento rojo', 'verdura', 'kg', 2.4, []],
      [/^ajo morado/, 'Ajo morado', 'verdura', 'kg', 5.9, []],
      [/^limon(es)?$/, 'Limón', 'fruta', 'kg', 1.95, []],
      [/^perejil$/, 'Perejil', 'verdura', 'ud', 0.55, []],
      [/^lechuga romana$/, 'Lechuga romana', 'verdura', 'ud', 0.78, []],
      [/^solomillo de ternera$/, 'Solomillo de ternera', 'carne', 'kg', 33.5, []],
      [/^lomo alto de vaca/, 'Lomo alto de vaca', 'carne', 'kg', 29.9, []],
      [/^secreto iberico/, 'Secreto ibérico', 'carne', 'kg', 16.8, []],
      [/^carrillera iberica/, 'Carrillera ibérica', 'carne', 'kg', 11.2, []],
      [/^pechuga de pollo/, 'Pechuga de pollo', 'carne', 'kg', 7.6, []],
      [/^jamon iberico/, 'Jamón ibérico', 'charcuteria', 'kg', 114, []],
      [/^aceite de oliva virgen extra$/, 'Aceite de oliva virgen extra', 'aceite', 'l', 8.455, []],
      [/^harina de (trigo de )?fuerza$/, 'Harina de fuerza', 'cereal', 'kg', 0.98, ['gluten']],
      [/^leche entera$/, 'Leche entera', 'lacteo', 'l', 0.99, ['lacteos']],
      [/^nata/, 'Nata', 'lacteo', 'l', 3.7345, ['lacteos']],
      [/^huevos?/, 'Huevo', 'huevo', 'ud', 0.23, ['huevo']],
      [/^arroz bomba$/, 'Arroz bomba', 'cereal', 'kg', 3.95, []],
      [/^mantequilla/, 'Mantequilla', 'lacteo', 'kg', 9.8, ['lacteos']],
      [/^pimenton dulce/, 'Pimentón dulce', 'condimento', 'kg', 29.3333, []],
      [/^azucar/, 'Azúcar', null, 'kg', 1.15, []],
      [/^sal/, 'Sal', 'condimento', 'kg', 0.45, []],
      [/^vinagre de jerez$/, 'Vinagre de Jerez', null, 'l', 5.76, ['sulfitos']],
      [/^queso manchego/, 'Queso manchego', 'lacteo', 'kg', 16.4, ['lacteos']],
      [/^atun/, 'Atún en aceite', 'conserva', 'kg', 8.7778, ['pescado']],
    ];
    for (const [re, ideal, cat, unit, price, allergens] of exp) {
      const p = findProduct(re);
      if (!check(p, `no hay un ingrediente con nombre tipo «${ideal}» (${re})`)) continue;
      check(!/\d|\b(kg|saco|malla|garrafa|uds?|caja|cat)\b/i.test(p.name), `«${p.name}»: el nombre no está limpio (formato o calibre)`);
      check(p.name.charAt(0) === p.name.charAt(0).toUpperCase() && p.name !== p.name.toUpperCase(), `«${p.name}»: debería ir en formato «Nombre propio»`);
      if (cat) check(p.category === cat, `«${p.name}»: categoría ${p.category} (se esperaba ${cat})`);
      check(p.baseUnit === unit, `«${p.name}»: unidad ${p.baseUnit} (se esperaba ${unit})`);
      check(near(p.pricePerBase, price, 0.0006), `«${p.name}»: precio ${p.pricePerBase} (se esperaba ${price})`);
      for (const a of allergens) check(p.allergens.includes(a), `«${p.name}»: falta el alérgeno ${a} (tiene ${p.allergens.join(', ') || 'ninguno'})`);
      check(p.priceSource === 'factura', `«${p.name}»: origen del precio ${p.priceSource}`);
    }
    for (const p of products)
      if (/^(patata|cebolla|tomate|pimiento|lechuga|solomillo|lomo|secreto|carrillera|pechuga|aceite|arroz|azucar|sal\b)/.test(fold(p.name)))
        check(!p.allergens.length, `«${p.name}» no debería tener alérgenos (${p.allergens.join(', ')})`);
    const bags = findProduct(/bolsa/);
    check(!bags, 'la línea ignorada (bolsas) no debe crear ingrediente');
    await go('/ingredientes');
    await page.getByRole('heading', { name: 'Ingredientes' }).waitFor();
    await page.waitForTimeout(500);
    const table = norm(await page.locator('table').first().innerText());
    for (const re of [/Solomillo de ternera/i, /Aceite de oliva virgen extra/i, /Patata agria/i]) check(re.test(table), `la lista no muestra ${re}`);
    check(table.includes(`${fmtEurPrecise(33.5)}/kg`), 'la lista no muestra 33,50 €/kg');
    check(table.includes(`${fmtEurPrecise(8.455)}/l`), 'la lista no muestra 8,455 €/l');
    await shot('ingredientes');
    // Ficha: histórico con el punto de la factura.
    const tomato = findProduct(/^tomate pera$/);
    await go(`/ingredientes/${tomato?.id}`);
    await page.getByRole('heading', { name: 'Histórico de precios' }).waitFor();
    const hist = norm(await page.locator('table').first().innerText());
    check(hist.includes(fmtEurPrecise(1.85)), `el histórico no muestra 1,85 €: ${hist}`);
    check((await page.locator('table tbody tr').count()) === 1, 'el histórico del tomate debería tener 1 punto');
    check((await page.getByRole('link', { name: /Factura/ }).count()) >= 1, 'el punto del histórico no enlaza a la factura');
    check(/1 precio registrado/.test(norm(await page.locator('main').innerText())), 'no indica «1 precio registrado»');
    await shot('ficha-tomate');
  });

  await step('6. Segunda factura de la frutería (tomate más caro): alerta en panel y ficha; al borrarla el precio vuelve', async () => {
    await go('/facturas');
    await page.locator('input[type=file][accept*=".pdf"]').first().setInputFiles(assets.variantPdf);
    const inv = await waitFor(
      async () => (await dbAll('invoices')).find((i) => i.fileName === 'factura-fruteria-garcia-2.pdf' && (i.status === 'revision' || i.status === 'error')),
      { timeout: 120_000, what: 'la lectura de la segunda factura' },
    );
    ids.fruta2 = inv.id;
    const exp2 = {
      ...EXPECTED.fruta,
      file: 'factura-fruteria-garcia-2.pdf',
      number: 'FV-2026/0987',
      date: '2026-09-24',
      subtotal: 102.68,
      vatTotal: 4.11,
      total: 106.79,
      lines: EXPECTED.fruta.lines.map((l) => (l.description.startsWith('TOMATE') ? { ...l, unitPrice: 2.35, total: 29.14, pricePerBase: 2.35 } : l)),
    };
    checkInvoiceData('fruta2', inv, exp2);
    await openInvoice(inv.id);
    const cards = await readLineCards();
    check(cards.every((c) => c.status === 'vinculado'), `todas las líneas deberían venir vinculadas: ${cards.map((c) => `${c.description}=${c.status}`).join(', ')}`);
    const tomatoCard = cards.find((c) => c.description.startsWith('TOMATE'));
    check(/antes 1,85\s*€/.test(tomatoCard?.text ?? ''), `la línea del tomate debería mostrar «antes 1,85 €»: ${tomatoCard?.text.slice(0, 200)}`);
    check(/▲\s*Sube\s*27/.test(tomatoCard?.text ?? '') || /27[,.]\d\s*%/.test(tomatoCard?.text ?? ''), 'la línea del tomate debería mostrar la subida del 27 %');
    await shot('revision-fruteria-2');
    const res = await confirmCurrentInvoice();
    check(/Cambios de precio/.test(res.text) && /Tomate pera/i.test(res.text), 'el resumen debería listar el cambio de precio del tomate');
    check(res.updated === 8 && res.created === 0, `resumen: ${res.updated} actualizados, ${res.created} nuevos (8 y 0)`);
    check(/7 ingredientes mantienen el mismo precio/.test(res.text), 'el resumen debería decir que 7 mantienen el precio');
    await shot('confirmada-fruteria-2', { fullPage: false });
    await closeModal();
    products = await dbAll('products');
    const tomato = findProduct(/^tomate pera$/);
    check(near(tomato?.pricePerBase, 2.35, 1e-6), `precio vigente del tomate: ${tomato?.pricePerBase} (2,35)`);
    check(tomato?.lastPurchaseDate === '2026-09-24', `última compra del tomate: ${tomato?.lastPurchaseDate}`);
    // Panel: alerta de precio.
    await go('/');
    await page.getByRole('heading', { name: 'Alertas de precio' }).waitFor({ timeout: 15_000 });
    const alerts = await cardText('Alertas de precio');
    check(/Tomate pera/i.test(alerts) && alerts.includes('1,85') && alerts.includes('2,35'), `el panel no muestra la alerta del tomate 1,85 → 2,35: ${alerts.slice(0, 300)}`);
    check(/1 subida/.test(alerts), 'el panel debería indicar «1 subida»');
    await page.getByRole('heading', { name: 'Alertas de precio' }).scrollIntoViewIfNeeded();
    await shot('panel-alerta-precio');
    // Ficha: 2 puntos en el histórico.
    await go(`/ingredientes/${tomato?.id}`);
    await page.getByRole('heading', { name: 'Histórico de precios' }).waitFor();
    check((await page.locator('table tbody tr').count()) === 2, 'el histórico del tomate debería tener 2 puntos');
    const txt = norm(await page.locator('main').innerText());
    check(/2 precios registrados/.test(txt), 'no indica «2 precios registrados»');
    await shot('ficha-tomate-2-puntos');
    // Borrar la factura → el precio vuelve a 1,85.
    await go('/facturas');
    const row = page.locator('table tbody tr').filter({ hasText: 'FV-2026/0987' });
    await row.getByRole('button', { name: /Más acciones de/ }).click();
    await page.getByRole('menuitem', { name: /Eliminar/ }).click();
    const dlg = page.getByRole('dialog').filter({ hasText: '¿Eliminar esta factura?' });
    check(/se retirarán sus precios/.test(norm(await dlg.innerText())), 'el diálogo debería avisar de que se retiran sus precios');
    await dlg.getByRole('button', { name: 'Eliminar' }).click();
    await waitFor(async () => !(await dbAll('invoices')).some((i) => i.id === ids.fruta2), { what: 'el borrado de la factura' });
    products = await dbAll('products');
    const t2 = findProduct(/^tomate pera$/);
    check(near(t2?.pricePerBase, 1.85, 1e-6), `tras borrar, el tomate debería volver a 1,85 (está en ${t2?.pricePerBase})`);
    check(t2?.lastPurchaseDate === '2026-09-18', `tras borrar, la última compra debería ser 18/09 (${t2?.lastPurchaseDate})`);
    const pts = (await dbAll('pricePoints')).filter((p) => p.productId === t2?.id);
    check(pts.length === 1, `tras borrar, el tomate debería tener 1 punto (${pts.length})`);
    await go('/');
    await page.getByRole('heading', { name: 'Alertas de precio' }).waitFor();
    const alerts2 = await cardText('Alertas de precio');
    check(/Precios estables/.test(alerts2), `tras borrar, no debería quedar la alerta: ${alerts2.slice(0, 200)}`);
  });

  await step('7a. Fusionar un duplicado creado a mano', async () => {
    await go('/ingredientes');
    await page.getByRole('button', { name: 'Nuevo ingrediente' }).click();
    const dlg = page.getByRole('dialog').filter({ hasText: 'Nuevo ingrediente' });
    await dlg.getByLabel('Nombre *').fill('Tomates pera maduros');
    await dlg.getByLabel(/Precio sin IVA/).fill('1,90');
    await shot('nuevo-ingrediente', { fullPage: false });
    await dlg.getByRole('button', { name: 'Crear ingrediente' }).click();
    await dlg.waitFor({ state: 'detached' });
    products = await dbAll('products');
    const dup = byName('Tomates pera maduros');
    const tomato = findProduct(/^tomate pera$/);
    check(dup && near(dup.pricePerBase, 1.9), 'no se creó el duplicado con precio 1,90');
    check(dup?.category === 'verdura' && dup?.baseUnit === 'kg', `el duplicado debería autocompletarse como verdura/kg (${dup?.category}/${dup?.baseUnit})`);
    await page.getByLabel(`Seleccionar ${dup?.name}`).check();
    await page.getByLabel(`Seleccionar ${tomato?.name}`).check();
    await page.getByRole('button', { name: 'Fusionar', exact: true }).click();
    const mdlg = page.getByRole('dialog').filter({ hasText: 'Fusionar ingredientes duplicados' });
    await mdlg.getByRole('radio', { name: new RegExp(`^.*${tomato?.name}`) }).first().click();
    await shot('fusionar', { fullPage: false });
    await mdlg.getByRole('button', { name: /^Fusionar en/ }).click();
    await mdlg.waitFor({ state: 'detached' });
    products = await dbAll('products');
    const kept = products.find((p) => p.id === tomato?.id);
    check(!products.some((p) => p.id === dup?.id), 'el duplicado sigue existiendo');
    check(kept?.aliases.some((a) => fold(a) === fold('Tomates pera maduros')), `el nombre del duplicado debería pasar a alias (${kept?.aliases.join(' | ')})`);
    check(near(kept?.pricePerBase, 1.85, 1e-6), `el precio vigente del tomate debería seguir en 1,85 (compra más reciente) y es ${kept?.pricePerBase}`);
    const pts = (await dbAll('pricePoints')).filter((p) => p.productId === tomato?.id);
    note(`puntos del tomate tras fusionar: ${pts.map((p) => `${p.date} ${p.pricePerBase} ${p.source}`).join(' · ')}`);
    check(products.length === 27, `tras fusionar deberían quedar 27 ingredientes (${products.length})`);
  });

  await step('7b. Cambio manual de precio desde la ficha', async () => {
    const onion = findProduct(/^cebolla dulce$/);
    await go(`/ingredientes/${onion?.id}`);
    await page.getByRole('button', { name: 'Cambiar precio' }).click();
    const dlg = page.getByRole('dialog').filter({ hasText: 'Cambiar precio' });
    await dlg.getByLabel(/Nuevo precio sin IVA/).fill('1,25');
    check(/8[,.]7\s*%/.test(norm(await dlg.innerText())), 'el diálogo debería mostrar la variación +8,7 %');
    await shot('cambio-precio', { fullPage: false });
    await dlg.getByRole('button', { name: 'Guardar precio' }).click();
    await dlg.waitFor({ state: 'detached' });
    await page.waitForTimeout(400);
    products = await dbAll('products');
    const o2 = products.find((p) => p.id === onion?.id);
    check(near(o2?.pricePerBase, 1.25, 1e-6), `precio de la cebolla ${o2?.pricePerBase} (1,25)`);
    check(o2?.priceSource === 'manual', `origen ${o2?.priceSource} (manual)`);
    const txt = norm(await page.locator('main').innerText());
    check(txt.includes(fmtEurPrecise(1.25)) && /Precio introducido a mano/.test(txt), 'la ficha no muestra el precio manual');
    check((await page.locator('table tbody tr').count()) === 2, 'el histórico debería tener 2 puntos (factura + manual)');
    await shot('ficha-cebolla-manual');
  });

  await step('7c. Importar tarifa CSV desde Ingredientes (2 actualizan, 1 nuevo)', async () => {
    await go('/ingredientes');
    await page.getByRole('button', { name: 'Importar tarifa' }).click();
    const dlg = page.getByRole('dialog').filter({ hasText: 'Importar tarifa o listado de precios' });
    await dlg.locator('input[type=file]').setInputFiles(assets.tariff);
    await dlg.getByText('Vista previa').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    const txt = norm(await dlg.innerText());
    check(/2 actualizan precio/.test(txt), `la vista previa debería decir «2 actualizan precio»: ${txt.slice(0, 400)}`);
    check(/1 ingredientes? nuevos?/.test(txt), 'la vista previa debería decir «1 ingrediente nuevo»');
    check(txt.includes(`${fmtEurPrecise(0.95)} /kg`) || txt.includes(`${fmtEurPrecise(0.95)}/kg`), 'la harina debería salir a 0,95 €/kg en la vista previa');
    await shot('importar-tarifa', { fullPage: false });
    await dlg.getByRole('button', { name: /^Importar \d+ precios?/ }).click();
    await dlg.getByText('Tarifa importada').first().waitFor({ timeout: 20_000 });
    await dlg.getByRole('button', { name: 'Ver ingredientes' }).click();
    products = await dbAll('products');
    check(near(findProduct(/^arroz bomba$/)?.pricePerBase, 3.8, 1e-6), `arroz bomba ${findProduct(/^arroz bomba$/)?.pricePerBase} (3,80)`);
    check(near(findProduct(/^harina/)?.pricePerBase, 0.95, 1e-6), `harina ${findProduct(/^harina/)?.pricePerBase} (0,95)`);
    const green = findProduct(/^pimiento verde/);
    check(green && near(green.pricePerBase, 2.1, 1e-6) && green.baseUnit === 'kg' && green.priceSource === 'hoja', 'no se creó «Pimiento verde italiano» a 2,10 €/kg');
    check(products.length === 28, `deberían quedar 28 ingredientes (${products.length})`);
    await shot('ingredientes-tras-tarifa');
  });

  await step('8. Móvil 390×844: lista de facturas y revisión sin desbordes y con acciones alcanzables', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await go('/facturas');
    await page.getByRole('heading', { name: 'Facturas' }).waitFor();
    await page.waitForTimeout(500);
    let o = await noHorizontalOverflow();
    check(!o.overflow, `lista de facturas con scroll horizontal (${o.scrollWidth}px): ${o.offenders.join(', ')}`);
    await shot('movil-facturas');
    // Subir otra vez la segunda factura desde el botón compacto del móvil.
    const compact = page.locator('input[type=file][accept*=".pdf"]').first();
    await compact.setInputFiles(assets.variantPdf);
    const inv = await waitFor(
      async () => (await dbAll('invoices')).find((i) => i.fileName === 'factura-fruteria-garcia-2.pdf' && (i.status === 'revision' || i.status === 'error')),
      { timeout: 120_000, what: 'la lectura en móvil' },
    );
    check(inv.status === 'revision' && inv.lines.length === 8, `lectura en móvil: ${inv.status}, ${inv.lines.length} líneas`);
    await page.waitForTimeout(500);
    const card = page.locator('div').filter({ hasText: 'FV-2026/0987' }).getByRole('button', { name: 'Revisar y confirmar precios' }).first();
    check(await reachable(card), 'el botón «Revisar y confirmar precios» no es alcanzable en móvil');
    const menu = page.getByRole('button', { name: /Más acciones de Frutas/ }).first();
    check(await reachable(menu), 'el menú de acciones de la tarjeta no es alcanzable');
    await shot('movil-facturas-con-pendiente');
    await card.click();
    await page.getByRole('heading', { name: 'Líneas de la factura' }).waitFor();
    await page.waitForTimeout(500);
    o = await noHorizontalOverflow();
    check(!o.overflow, `revisión con scroll horizontal (${o.scrollWidth}px): ${o.offenders.join(', ')}`);
    await shot('movil-revision', { fullPage: false });
    await shot('movil-revision-completa');
    // Los campos de una línea se pueden tocar y editar.
    const firstQty = page.locator('[data-field="quantity"]').first();
    check(await reachable(firstQty), 'la cantidad de la primera línea no es alcanzable');
    // Selector de ingrediente en móvil (hoja inferior) y cierre.
    const pickerBtn = page.getByTitle('Elegir ingrediente para esta línea').first();
    await pickerBtn.scrollIntoViewIfNeeded();
    await pickerBtn.click();
    const sheet = page.getByRole('dialog').filter({ hasText: 'Elegir ingrediente para esta línea' });
    await sheet.waitFor();
    o = await noHorizontalOverflow();
    check(!o.overflow, 'el selector en móvil desborda en horizontal');
    await shot('movil-selector', { fullPage: false });
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    // El botón de confirmar (barra fija) es alcanzable y no lo tapa la navegación inferior.
    const confirm = page.getByRole('button', { name: /Confirmar · \d+ precios?/ });
    check(await reachable(confirm), 'el botón de confirmar no es alcanzable (tapado o fuera de pantalla)');
    const res = await confirmCurrentInvoice();
    check(res.updated === 8, `confirmación en móvil: ${res.updated} precios`);
    o = await noHorizontalOverflow();
    check(!o.overflow, 'el resumen de confirmación desborda en móvil');
    await shot('movil-confirmada', { fullPage: false });
    await closeModal();
    await go('/ingredientes');
    await page.waitForTimeout(500);
    o = await noHorizontalOverflow();
    check(!o.overflow, `ingredientes con scroll horizontal en móvil: ${o.offenders.join(', ')}`);
    await shot('movil-ingredientes');
    await go('/');
    await page.waitForTimeout(800);
    o = await noHorizontalOverflow();
    check(!o.overflow, `panel con scroll horizontal en móvil: ${o.offenders.join(', ')}`);
    await shot('movil-panel');
  });

  await step('9. Sin errores de consola ni excepciones', async () => {
    for (const e of consoleErrors) check(false, e);
  });
  await ctx.close();
} catch (e) {
  console.log(`\nABORTADO: ${e instanceof Error ? e.message : String(e)}`);
  exitCode = 1;
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} pasos correctos · capturas en ${OUT}`);
writeFileSync(join(OUT, 'resultado.json'), JSON.stringify(results, null, 2));
process.exit(failed.length || exitCode ? 1 : 0);
