#!/usr/bin/env node
/**
 * Banco de pruebas de GENERALIZACIÓN de la extracción local (gratis, en el dispositivo) sobre documentos que el parser
 * no ha visto nunca: tests/fixtures/unseen (12 facturas PDF con capa de texto y 7 fotos de carta, generados con
 * scripts/gen-unseen.mjs; la verdad de referencia sale de los mismos datos que el HTML, nunca de la salida del parser).
 *
 * Mismo canal que la app:
 *  - PDF con texto: pdf.js (legacy) → filas (layout.ts) → parseInvoicePages.
 *  - Fotos y PDF escaneados: preparación de imagen (imageOps.ts) → tesseract.js con las pasadas y la validación
 *    aritmética de ocrPipeline.ts (facturas) o parseMenuOcr + mergeMenuPasses (cartas).
 * Variantes degradadas generadas con Chromium con parámetros DISTINTOS de los de bench-extraction.mjs: foto girada,
 * perspectiva con sombra, baja resolución con ruido JPEG y PDF escaneado (sólo imagen, también de varias páginas).
 *
 * Las lecturas de tesseract se guardan en caché (node_modules/.cache/escandallo-unseen-ocr, clave = imagen + modo) para
 * poder medir cambios del parser sin repetir el OCR; --no-cache la desactiva.
 *
 * Uso: node scripts/bench-unseen.mjs [--only=<texto>] [--no-ocr] [--no-menus] [--no-invoices] [--no-cache]
 *                                    [--keep=<dir>] [--json=<archivo>] [--verbose] [--assert] [--polarity]
 *                                    [--engine=paddle|tesseract]
 *   --engine    fotos (cartas y facturas): paddle (por defecto, como la app: lector PaddleOCR primero) o tesseract
 *   --polarity  cartas con --engine=tesseract: invierte las de fondo oscuro antes del preprocesado (con paddle, siempre)
 *   --assert  termina con código 1 si no se alcanzan los objetivos (PDF texto ≥ 97 % líneas y ≥ 95 % cabecera,
 *             degradadas ≥ 93 %, cartas ≥ 95 %).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEGRADED_INVOICES, INVOICES } from './unseen/invoices.mjs';
import { DEGRADED_MENUS, MENUS } from './unseen/menus.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const VERBOSE = !!args.verbose;
const log = (...a) => console.log(...a);
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const FIX = join(ROOT, 'tests/fixtures/unseen');
const CACHE = join(ROOT, 'node_modules/.cache/escandallo-unseen-ocr');
mkdirSync(CACHE, { recursive: true });

// ───────────────────────────── Módulos de la app ─────────────────────────────

const { createServer } = await import('vite');
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
const layout = await load('/src/extract/layout.ts');
const pdfMod = await load('/src/extract/pdf.ts');
const imageOps = await load('/src/extract/imageOps.ts');
const pipeline = await load('/src/extract/ocrPipeline.ts');
const extractIndex = await load('/src/extract/index.ts');
const menuParser = await load('/src/extract/menuParser.ts');
const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const workDir = args.keep ? resolve(String(args.keep)) : mkdtempSync(join(tmpdir(), 'bench-unseen-'));
mkdirSync(workDir, { recursive: true });

// ───────────────────────────── Adaptadores de Node (equivalentes a pdf.ts / ocr.ts) ─────────────────────────────

const openPdf = (bytes) => pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }).promise;

async function extractPdfText(bytes) {
  const doc = await openPdf(bytes);
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const fragments = pdfMod.pdfItemsToFragments(content.items, viewport.transform);
    for (const l of layout.buildLines(fragments, p)) lines.push({ page: l.page, y: l.y, text: l.text, items: l.items });
  }
  const pageCount = doc.numPages;
  await doc.destroy();
  return { pageCount, lines, text: layout.linesToText(lines), hasText: layout.looksLikeText(lines, pageCount) };
}

async function pdfToImages(bytes, { scale = 300 / 72, maxSide = 3300 } = {}) {
  const doc = await openPdf(bytes);
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const s = Math.min(scale, maxSide / Math.max(base.width, base.height));
    const vp = page.getViewport({ scale: s });
    const { canvas, context } = doc.canvasFactory.create(Math.floor(vp.width), Math.floor(vp.height));
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport: vp, canvas }).promise;
    out.push(canvas.toBuffer('image/png'));
  }
  await doc.destroy();
  return out;
}

async function loadGray(bytes, maxSide = 3200) {
  const img = await loadImage(bytes);
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * s));
  const h = Math.max(1, Math.round(img.height * s));
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return imageOps.rgbaToGray(ctx.getImageData(0, 0, w, h).data, w, h);
}

let worker;
async function getWorker() {
  if (worker) return worker;
  const T = require('tesseract.js');
  const cachePath = join(ROOT, 'node_modules/.cache/escandallo-tessdata');
  mkdirSync(cachePath, { recursive: true });
  worker = await T.createWorker('spa', 1, { cachePath });
  await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
  return worker;
}

/** Sólo lo que usa ocrLayout (TessPage), para la caché. */
function slimPage(d) {
  return {
    text: d.text,
    confidence: d.confidence,
    blocks: (d.blocks ?? []).map((b) => ({
      bbox: b.bbox,
      paragraphs: (b.paragraphs ?? []).map((p) => ({
        lines: (p.lines ?? []).map((l) => ({
          text: l.text,
          confidence: l.confidence,
          bbox: l.bbox,
          baseline: l.baseline,
          rowAttributes: l.rowAttributes ? { rowHeight: l.rowAttributes.rowHeight } : undefined,
          words: (l.words ?? []).map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
        })),
      })),
    })),
  };
}

const ocrStats = { calls: 0, cached: 0, ms: 0 };
const backend = {
  async recognize(image, psm) {
    const pgm = Buffer.from(imageOps.encodePgm(image));
    const key = createHash('sha1').update(pgm).update(`psm${psm}`).digest('hex');
    const file = join(CACHE, `${key}.json`);
    ocrStats.calls++;
    if (!args['no-cache'] && existsSync(file)) {
      ocrStats.cached++;
      return JSON.parse(readFileSync(file, 'utf8'));
    }
    const t0 = Date.now();
    const w = await getWorker();
    const res = await w.recognize(pgm, { tessedit_pageseg_mode: psm }, { text: true, blocks: true });
    ocrStats.ms += Date.now() - t0;
    const slim = slimPage(res.data);
    writeFileSync(file, JSON.stringify(slim));
    return slim;
  },
};

// ───────────────────────────── Variantes degradadas (Chromium) ─────────────────────────────

const INVOICE_VARIANTS = [
  { id: 'foto-girada', rotate: 2.4, blur: 0.55, noise: 0.06, jpeg: 70, pageWidth: 1500, margin: 0.08, background: '#3b3530' },
  { id: 'foto-perspectiva-sombra', rotate: -1.6, tiltX: 7, tiltY: -4, blur: 0.5, noise: 0.05, jpeg: 60, pageWidth: 1600, margin: 0.1, background: '#5a4a3c', shade: true },
  { id: 'foto-baja-resolucion', rotate: 0.9, blur: 0.8, noise: 0.08, jpeg: 50, pageWidth: 1050, margin: 0.03, background: '#777777' },
  { id: 'pdf-escaneado', rotate: 1.2, blur: 0.4, noise: 0.05, jpeg: 78, pageWidth: 1654, margin: 0, background: '#ffffff', grayscale: true, pdf: true },
];
const MENU_VARIANTS = [
  { id: 'foto-girada', rotate: 2.5, blur: 0.4, noise: 0.05, jpeg: 70, pageWidth: 1000, margin: 0.04, background: '#6a5b4a' },
  { id: 'foto-perspectiva-sombra', rotate: -1.5, tiltX: 9, tiltY: 5, blur: 0.45, noise: 0.05, jpeg: 60, pageWidth: 1000, margin: 0.07, background: '#2b2622', shade: true },
  { id: 'foto-baja-resolucion', rotate: 0.6, blur: 0.5, noise: 0.07, jpeg: 50, pageWidth: 700, margin: 0.02, background: '#6a5b4a' },
  { id: 'pdf-escaneado', rotate: 0.8, blur: 0.35, noise: 0.05, jpeg: 78, pageWidth: 1240, margin: 0, background: '#ffffff', grayscale: true, pdf: true },
];

let browser;
async function getBrowser() {
  if (browser) return browser;
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  return browser;
}

/** Degrada una imagen y devuelve el JPEG de la «foto». El lado largo se limita a ~1,41 × pageWidth (tickets largos). */
async function degradeImage(imageBytes, mime, v, size) {
  const b = await getBrowser();
  const aspect = size.height / size.width;
  const pageW = Math.round(Math.min(v.pageWidth, (v.pageWidth * 1.414) / Math.max(1, aspect)));
  const pageH = Math.round(pageW * aspect);
  const W = Math.round(pageW * (1 + 2 * v.margin));
  const H = Math.round(pageH + pageW * 2 * v.margin);
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const src = `data:${mime};base64,${Buffer.from(imageBytes).toString('base64')}`;
  const transform = `perspective(1600px) rotateX(${v.tiltX ?? 0}deg) rotateY(${v.tiltY ?? 0}deg) rotateZ(${v.rotate ?? 0}deg)`;
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${v.background};display:flex;align-items:center;justify-content:center">
    <img id="doc" src="${src}" style="width:${pageW}px;height:${pageH}px;transform:${transform};filter:blur(${v.blur}px) contrast(0.9) brightness(1.03)${v.grayscale ? ' grayscale(1)' : ''};box-shadow:0 10px 40px rgba(0,0,0,.45)">
    ${v.shade ? '<div style="position:fixed;inset:0;background:radial-gradient(ellipse at 75% 20%, rgba(255,255,255,0) 30%, rgba(0,0,0,.3) 100%)"></div>' : ''}
    <canvas id="noise" width="${W}" height="${H}" style="position:fixed;inset:0;opacity:${v.noise}"></canvas>
    <script>
      let s = 424242;
      const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const c = document.getElementById('noise'); const ctx = c.getContext('2d');
      const img = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) { const g = rnd() * 255; img.data[i] = img.data[i+1] = img.data[i+2] = g; img.data[i+3] = 255; }
      ctx.putImageData(img, 0, 0);
    </script></body></html>`);
  await page.waitForFunction(() => document.getElementById('doc').complete);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: v.jpeg });
  await page.close();
  return { jpeg, W, H };
}

/** PDF escaneado: una imagen JPEG por página, sin capa de texto. */
async function scannedPdf(pages) {
  const b = await getBrowser();
  const page = await b.newPage();
  const imgs = pages.map((p) => `<img src="data:image/jpeg;base64,${p.jpeg.toString('base64')}" style="width:210mm;height:${(210 * p.H) / p.W}mm;display:block;page-break-after:always">`).join('');
  const h = Math.max(...pages.map((p) => (210 * p.H) / p.W));
  await page.setContent(`<!doctype html><html><body style="margin:0">${imgs}</body></html>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const pdf = await page.pdf({ width: '210mm', height: `${h}mm`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await page.close();
  return pdf;
}

// ───────────────────────────── Puntuación ─────────────────────────────

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
const eq = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

function scoreInvoice(inv, exp) {
  const lines = inv?.lines ?? [];
  const used = new Set();
  let exact = 0;
  const fails = [];
  for (const e of exp.lines) {
    const idx = lines.findIndex(
      (l, i) =>
        !used.has(i) &&
        norm(l.description) === norm(e.description) &&
        eq(l.quantity, e.quantity, 0.0005) &&
        eq(l.unitPrice, e.unitPrice, 0.00005) &&
        eq(l.total, e.total, 0.005) &&
        (e.discountPct === undefined ? !l.discountPct : eq(l.discountPct, e.discountPct, 0.005)),
    );
    if (idx >= 0) {
      used.add(idx);
      exact++;
    } else {
      const near = lines.find((l, i) => !used.has(i) && eq(l.total, e.total, 0.005)) ?? lines.find((l) => norm(l.description) === norm(e.description));
      fails.push({ expected: e, got: near ? { description: near.description, quantity: near.quantity, unitPrice: near.unitPrice, discountPct: near.discountPct, total: near.total } : null });
    }
  }
  const extras = lines.filter((_, i) => !used.has(i)).map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total }));
  const h = exp.header;
  const headerChecks = {
    supplierName: norm(inv?.supplierName) === norm(h.supplierName),
    supplierTaxId: inv?.supplierTaxId === h.supplierTaxId,
    number: inv?.number === h.number,
    date: inv?.date === h.date,
    subtotal: eq(inv?.subtotal, h.subtotal, 0.005),
    vatTotal: eq(inv?.vatTotal, h.vatTotal, 0.005),
    total: eq(inv?.total, h.total, 0.005),
  };
  const denom = Math.max(exp.lines.length, lines.length);
  return {
    exact,
    expected: exp.lines.length,
    extra: lines.length - used.size,
    extras,
    accuracy: denom ? exact / denom : 1,
    headerOk: Object.values(headerChecks).filter(Boolean).length,
    headerTotal: 7,
    headerChecks,
    fails,
  };
}

function scoreMenu(menu, exp) {
  const entries = menu?.entries ?? [];
  const used = new Set();
  let exact = 0;
  let sectionOk = 0;
  let descOk = 0;
  const fails = [];
  for (const e of exp.entries) {
    const idx = entries.findIndex((x, i) => !used.has(i) && norm(x.name) === norm(e.name) && eq(x.price, e.price, 0.005));
    if (idx >= 0) {
      used.add(idx);
      exact++;
      const got = entries[idx];
      if (norm(got.section) === norm(e.section)) sectionOk++;
      if (e.description ? norm(got.description) === norm(e.description) : !got.description) descOk++;
    } else fails.push({ expected: { name: e.name, price: e.price }, got: entries.find((x) => eq(x.price, e.price, 0.005)) ?? entries.find((x) => norm(x.name) === norm(e.name)) ?? null });
  }
  const denom = Math.max(exp.entries.length, entries.length);
  const extras = entries.filter((_, i) => !used.has(i)).map((x) => ({ name: x.name, price: x.price }));
  return { exact, expected: exp.entries.length, extra: entries.length - used.size, extras, accuracy: denom ? exact / denom : 1, sectionOk, descOk, fails };
}

// ───────────────────────────── Ejecución ─────────────────────────────

const only = typeof args.only === 'string' ? args.only.toLowerCase() : undefined;
const wanted = (name) => !only || name.toLowerCase().includes(only);
const results = [];

async function invoiceFromPdf(bytes) {
  const text = await extractPdfText(bytes);
  if (text.hasText) return { inv: extractIndex.parseInvoicePages(text.lines, 'pdf-texto')[0], method: 'pdf-texto' };
  const pngs = await pdfToImages(bytes);
  const grays = [];
  for (const png of pngs) grays.push(await loadGray(png));
  const outcome = await pipeline.ocrInvoice(pipeline.preparePages(grays), backend);
  return { inv: outcome.invoice, method: `ocr pdf ${pngs.length} pág.`, passes: outcome.passes };
}

async function invoiceFromImage(jpeg) {
  // Fotos de facturas: lector PaddleOCR primero (como la app); los PDF escaneados siguen sólo con Tesseract
  const photoBackend = paddle ? { ...backend, recognizePaddle: (image) => paddle.recognize(image) } : backend;
  const outcome = await pipeline.ocrInvoice(pipeline.preparePages([await loadGray(jpeg)]), photoBackend, paddle ? { passes: pipeline.INVOICE_PASSES_PADDLE } : {});
  return { inv: outcome.invoice, method: 'ocr foto', passes: outcome.passes };
}

/**
 * Cartas: motor como la app (--engine=paddle, por defecto: lector PaddleOCR con Tesseract de reserva y polaridad
 * normalizada) o sólo Tesseract (--engine=tesseract; la polaridad, con --polarity).
 */
const MENU_ENGINE = args.engine === 'tesseract' ? 'tesseract' : 'paddle';
const menuImage = args.polarity || MENU_ENGINE === 'paddle' ? await load('/src/extract/menuImage.ts') : undefined;
const paddle =
  MENU_ENGINE === 'paddle' && !args['no-ocr']
    ? await (await import('./paddle-node.mjs')).createPaddleReader({
        paddleOcr: await load('/src/extract/paddleOcr.ts'),
        paddleModel: await load('/src/extract/paddleModel.ts'),
        imageOps,
        noCache: !!args['no-cache'],
      })
    : undefined;

async function menuFromImages(images) {
  const grays = [];
  for (const img of images) {
    const g = await loadGray(img);
    grays.push(menuImage ? menuImage.normalizeMenuPolarity(g).image : g);
  }
  const menuBackend = paddle ? { ...backend, recognizePaddle: (image) => paddle.recognize(image) } : backend;
  const outcome = await pipeline.ocrMenu(pipeline.preparePages(grays), menuBackend, extractIndex.parseMenuOcr, {
    merge: menuParser.mergeMenuPasses,
    quality: menuParser.menuQuality,
    ...(paddle ? pipeline.MENU_PADDLE_OPTIONS : {}),
  });
  return { menu: outcome.menu, passes: outcome.passes, rawText: outcome.ocr.text };
}

const t0 = Date.now();
try {
  if (!args['no-invoices']) {
    for (const def of INVOICES) {
      const exp = JSON.parse(readFileSync(join(FIX, 'invoices', `${def.id}.expected.json`), 'utf8'));
      const bytes = readFileSync(join(FIX, 'invoices', `${def.id}.pdf`));
      if (wanted(`${def.id} texto`)) {
        const ts = Date.now();
        const r = await invoiceFromPdf(bytes);
        results.push({ kind: 'invoice', group: 'texto', name: def.id, variant: 'PDF con texto', ms: Date.now() - ts, ...r, score: scoreInvoice(r.inv, exp) });
      }
      if (args['no-ocr']) continue;
      const degraded = DEGRADED_INVOICES.includes(def.id);
      const multipage = def.id.startsWith('inv01');
      const variants = INVOICE_VARIANTS.filter((v) => (degraded || (multipage && v.pdf)) && wanted(`${def.id} ${v.id}`));
      if (!variants.length) continue;
      const pngs = await pdfToImages(bytes, { scale: 200 / 72, maxSide: 2400 });
      for (const v of variants) {
        const ts = Date.now();
        const shots = [];
        for (const png of pngs) {
          const size = await loadImage(png);
          shots.push(await degradeImage(png, 'image/png', v, { width: size.width, height: size.height }));
        }
        const base = `${def.id}-${v.id}`;
        let r;
        if (v.pdf) {
          const pdf = await scannedPdf(shots);
          writeFileSync(join(workDir, `${base}.pdf`), pdf);
          r = await invoiceFromPdf(pdf);
        } else {
          writeFileSync(join(workDir, `${base}.jpg`), shots[0].jpeg);
          r = await invoiceFromImage(shots[0].jpeg);
        }
        results.push({ kind: 'invoice', group: v.pdf ? 'escaneo' : 'foto', name: def.id, variant: v.id, ms: Date.now() - ts, ...r, score: scoreInvoice(r.inv, exp) });
        if (VERBOSE) log(`  ${def.id} · ${v.id}: ${JSON.stringify(r.passes)}`);
      }
    }
  }
  if (!args['no-menus'] && !args['no-ocr']) {
    for (const def of MENUS) {
      const exp = JSON.parse(readFileSync(join(FIX, 'menus', `${def.id}.expected.json`), 'utf8'));
      const bytes = readFileSync(join(FIX, 'menus', `${def.id}.jpg`));
      const cases = [];
      if (wanted(`${def.id} foto original`)) cases.push({ id: 'foto original', images: [bytes], degraded: false });
      if (DEGRADED_MENUS.includes(def.id)) {
        const size = await loadImage(bytes);
        for (const v of MENU_VARIANTS) {
          if (!wanted(`${def.id} ${v.id}`)) continue;
          const shot = await degradeImage(bytes, 'image/jpeg', v, { width: size.width, height: size.height });
          let images = [shot.jpeg];
          if (v.pdf) {
            const pdf = await scannedPdf([shot]);
            writeFileSync(join(workDir, `${def.id}-${v.id}.pdf`), pdf);
            images = await pdfToImages(pdf);
          } else writeFileSync(join(workDir, `${def.id}-${v.id}.jpg`), shot.jpeg);
          cases.push({ id: v.id, images, degraded: true });
        }
      }
      for (const c of cases) {
        const ts = Date.now();
        try {
          const r = await menuFromImages(c.images);
          results.push({ kind: 'menu', group: c.degraded ? 'carta degradada' : 'carta', name: def.id, variant: c.id, method: 'ocr', ms: Date.now() - ts, ...r, score: scoreMenu(r.menu, exp) });
          if (VERBOSE) log(r.rawText);
        } catch (err) {
          results.push({ kind: 'menu', group: c.degraded ? 'carta degradada' : 'carta', name: def.id, variant: c.id, method: 'ocr', ms: 0, error: String(err?.message ?? err) });
        }
      }
    }
  }
} finally {
  if (worker) await worker.terminate();
  if (browser) await browser.close();
  await server.close();
  if (!args.keep) rmSync(workDir, { recursive: true, force: true });
}

// ───────────────────────────── Informe ─────────────────────────────

const pct = (x) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
const pad = (s, n) => String(s).padEnd(n);
log('');
log('Generalización de la extracción local (documentos nunca vistos) · línea exacta = descripción, cantidad, precio, dto e importe');
log('');
log(`${pad('Documento', 40)}${pad('Variante', 26)}${pad('Método', 18)}${pad('Exactas', 13)}${pad('Exactitud', 11)}${pad('Cabecera', 10)}Tiempo`);
log('─'.repeat(128));
for (const r of results) {
  if (r.error) {
    log(`${pad(r.name, 40)}${pad(r.variant, 26)}${pad(r.method, 18)}ERROR: ${r.error}`);
    continue;
  }
  const s = r.score;
  const head = r.kind === 'invoice' ? `${s.headerOk}/${s.headerTotal}` : `sec ${s.sectionOk}/${s.exact}`;
  log(`${pad(r.name, 40)}${pad(r.variant, 26)}${pad(r.method, 18)}${pad(`${s.exact}/${s.expected}${s.extra ? ` (+${s.extra})` : ''}`, 13)}${pad(pct(s.accuracy), 11)}${pad(head, 10)}${(r.ms / 1000).toFixed(1).replace('.', ',')} s`);
  if (s.accuracy < 1 || VERBOSE) {
    for (const f of s.fails) log(`    ✗ esperado ${JSON.stringify(f.expected)}\n      leído    ${JSON.stringify(f.got)}`);
    for (const x of s.extras) log(`    + sobra ${JSON.stringify(x)}`);
  }
  if (r.kind === 'invoice' && s.headerOk < s.headerTotal) log(`    cabecera: ${Object.entries(s.headerChecks).filter(([, ok]) => !ok).map(([k]) => `${k}=${JSON.stringify(r.inv?.[k])}`).join(', ')}`);
}
const agg = (list) => {
  const ok = list.filter((r) => !r.error);
  const exact = ok.reduce((a, r) => a + r.score.exact, 0);
  const denom = ok.reduce((a, r) => a + Math.max(r.score.expected, r.score.exact + r.score.extra), 0) + list.filter((r) => r.error).length;
  const head = ok.filter((r) => r.kind === 'invoice').reduce((a, r) => [a[0] + r.score.headerOk, a[1] + r.score.headerTotal], [0, 0]);
  return { exact, denom, acc: denom ? exact / denom : 1, head };
};
const groups = [
  ['Facturas PDF con texto', results.filter((r) => r.group === 'texto'), 0.97],
  ['Facturas: fotos degradadas', results.filter((r) => r.group === 'foto'), 0.93],
  ['Facturas: PDF escaneados', results.filter((r) => r.group === 'escaneo'), 0.93],
  ['Cartas (foto original)', results.filter((r) => r.group === 'carta'), 0.95],
  ['Cartas degradadas', results.filter((r) => r.group === 'carta degradada'), 0.93],
];
log('─'.repeat(128));
let pass = true;
for (const [label, list, target] of groups) {
  if (!list.length) continue;
  const a = agg(list);
  const head = a.head[1] ? ` · cabecera ${a.head[0]}/${a.head[1]} (${pct(a.head[0] / a.head[1])})` : '';
  if (a.acc < target) pass = false;
  if (label.startsWith('Facturas PDF') && a.head[1] && a.head[0] / a.head[1] < 0.95) pass = false;
  log(`${pad(label, 34)} líneas ${a.exact}/${a.denom} = ${pct(a.acc)} (objetivo ${pct(target)})${head}`);
}
log(`OCR: ${ocrStats.calls} lecturas (${ocrStats.cached} de caché, ${(ocrStats.ms / 1000).toFixed(0)} s de tesseract) · total ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (args.json) writeFileSync(resolve(String(args.json)), JSON.stringify(results.map(({ inv, menu, rawText, ...r }) => r), null, 2));
if (args.assert && !pass) process.exit(1);
