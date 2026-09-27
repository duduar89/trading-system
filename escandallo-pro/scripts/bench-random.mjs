#!/usr/bin/env node
/**
 * Banco de pruebas de GENERALIZACIÓN sobre facturas PROCEDIMENTALES (scripts/gen-random-invoices.mjs).
 *
 * Método anti-sobreajuste:
 *  - se ajusta SÓLO con las semillas de ajuste (1–150) mirando sus fallos documento a documento;
 *  - las semillas reservadas (1001–1100) sólo se miden en AGREGADO: este script se niega a mostrar el detalle de
 *    cualquier semilla reservada (ni fallos, ni textos, ni documentos) para que nunca se inspeccionen al ajustar.
 *
 * Mismo canal que la app:
 *  - PDF con texto: pdf.js (legacy) → filas (layout.ts) → parseInvoicePages.
 *  - Fotos y PDF escaneados: render a imagen → degradación con Chromium (giro, perspectiva, sombra, desenfoque,
 *    ruido, JPEG, baja resolución; parámetros aleatorios con la semilla) → imageOps + tesseract.js con las pasadas y la
 *    validación aritmética de ocrPipeline.ts; en las fotos, primero el lector PaddleOCR (scripts/paddle-node.mjs), como
 *    la app (--engine=tesseract: sólo Tesseract). Las lecturas de ambos motores se guardan en caché.
 *
 * Uso: node scripts/bench-random.mjs [--set=tuning|heldout] [--seeds=1-40] [--ocr] [--ocr-count=30] [--no-text]
 *                                    [--verbose] [--only=<plantilla|rasgo>] [--json=<archivo>] [--regen]
 *   --verbose   detalle de los fallos (sólo semillas de ajuste)
 *   --ocr       mide también la ruta OCR con las primeras --ocr-count semillas del conjunto (foto o PDF escaneado)
 *   --dump=<dir> guarda el texto leído por el OCR de cada documento (sólo semillas de ajuste)
 *   --font-scale=<k> variante de maquetación de las semillas de ajuste (letra ×k: otras roturas de línea y de página)
 *   --engine=paddle|tesseract  motor de las fotos (por defecto paddle, como la app; los PDF escaneados, siempre Tesseract)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { HELDOUT_SEEDS, TUNING_SEEDS, makeRng, parseSeeds, renderInvoicePdf } from './gen-random-invoices.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const log = (...a) => console.log(...a);
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const set = args.set === 'heldout' ? 'heldout' : 'tuning';
const seeds = args.seeds ? parseSeeds(args.seeds) : set === 'heldout' ? HELDOUT_SEEDS : TUNING_SEEDS;
const isHeldout = (s) => s >= 1001;
const anyHeldout = seeds.some(isHeldout);
const VERBOSE = !!args.verbose && !anyHeldout;
if (args.verbose && anyHeldout) log('Aviso: las semillas reservadas sólo se informan en agregado (se ignora --verbose).');

// Caché de PDF ligada al código del generador (si cambia el generador, se regeneran)
const genHash = createHash('sha1').update(readFileSync(join(ROOT, 'scripts/gen-random-invoices.mjs'))).digest('hex').slice(0, 10);
const PDF_CACHE = join(ROOT, `node_modules/.cache/escandallo-random/${genHash}`);
const OCR_CACHE = join(ROOT, 'node_modules/.cache/escandallo-random-ocr');
mkdirSync(PDF_CACHE, { recursive: true });
// Las cachés de versiones anteriores del generador ya no sirven
// (salvo si otra ejecución las está usando: modificadas hace menos de 30 minutos)
for (const d of readdirSync(dirname(PDF_CACHE))) {
  const full = join(dirname(PDF_CACHE), d);
  if (d !== genHash && Date.now() - statSync(full).mtimeMs > 30 * 60 * 1000) rmSync(full, { recursive: true, force: true });
}
mkdirSync(OCR_CACHE, { recursive: true });

// ───────────────────────────── Módulos de la app ─────────────────────────────

const { createServer } = await import('vite');
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
const layout = await load('/src/extract/layout.ts');
const pdfMod = await load('/src/extract/pdf.ts');
const imageOps = await load('/src/extract/imageOps.ts');
const pipeline = await load('/src/extract/ocrPipeline.ts');
const extractIndex = await load('/src/extract/index.ts');
const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
const { createCanvas, loadImage } = require('@napi-rs/canvas');

let browser;
async function getBrowser() {
  if (browser) return browser;
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  return browser;
}

// Variante de maquetación de las mismas semillas (sólo ajuste): otra escala de letra reparte distinto las filas
const fontScale = args['font-scale'] ? Number(args['font-scale']) : undefined;
if (fontScale && anyHeldout) {
  log('Las variantes de maquetación (--font-scale) sólo se permiten con semillas de ajuste.');
  process.exit(1);
}

async function docFor(seed) {
  const tag = fontScale ? `-f${fontScale}` : '';
  const pdfFile = join(PDF_CACHE, `${seed}${tag}.pdf`);
  const jsonFile = join(PDF_CACHE, `${seed}${tag}.json`);
  if (!args.regen && existsSync(pdfFile) && existsSync(jsonFile)) return { pdf: readFileSync(pdfFile), expected: JSON.parse(readFileSync(jsonFile, 'utf8')) };
  const { doc, pdf } = await renderInvoicePdf(await getBrowser(), seed, fontScale ? { fontScale } : {});
  writeFileSync(pdfFile, pdf);
  writeFileSync(jsonFile, JSON.stringify(doc.expected));
  return { pdf: Buffer.from(pdf), expected: doc.expected };
}

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
    const file = join(OCR_CACHE, `${key}.json`);
    ocrStats.calls++;
    if (existsSync(file)) {
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

/** Fotos: lector PaddleOCR primero, como la app (--engine=tesseract: sólo Tesseract). */
const paddle =
  args.ocr && args.engine !== 'tesseract'
    ? await (await import('./paddle-node.mjs')).createPaddleReader({
        paddleOcr: await server.ssrLoadModule('/src/extract/paddleOcr.ts'),
        paddleModel: await server.ssrLoadModule('/src/extract/paddleModel.ts'),
        imageOps,
      })
    : undefined;
const photoBackend = paddle ? { ...backend, recognizePaddle: (image) => paddle.recognize(image) } : backend;

/** Parámetros de degradación aleatorios pero deterministas para cada semilla. */
function variantFor(seed, pages, template) {
  const R = makeRng(seed * 31 + 7);
  const scan = pages > 1 || R.chance(0.45);
  if (scan) {
    return { id: 'pdf-escaneado', rotate: R.float(-1.4, 1.4), blur: R.float(0.3, 0.5), noise: R.float(0.03, 0.06), jpeg: R.int(70, 85), pageWidth: 1654, margin: 0, background: '#ffffff', grayscale: true, pdf: true };
  }
  const ticket = template === 'ticket';
  return {
    id: 'foto',
    rotate: R.float(-2.6, 2.6),
    tiltX: R.chance(0.5) ? R.float(-7, 7) : 0,
    tiltY: R.chance(0.5) ? R.float(-5, 5) : 0,
    blur: R.float(0.3, 0.75),
    noise: R.float(0.03, 0.07),
    jpeg: R.int(55, 80),
    pageWidth: ticket ? R.int(700, 900) : R.int(1250, 1700),
    margin: R.float(0.02, 0.09),
    background: R.pick(['#3b3530', '#5a4a3c', '#777777', '#2b2622', '#6a5b4a']),
    shade: R.chance(0.4),
  };
}

async function degradeImage(imageBytes, v, size) {
  const b = await getBrowser();
  const aspect = size.height / size.width;
  // Escáner: resolución fija sobre un cristal A4 (un ticket largo queda a ~200 ppp). Foto: el lado largo del papel,
  // como mucho el de una foto de móvil encuadrada (~3000 px); con el límite del A4 un ticket largo quedaba a ~320 px
  // de ancho, ilegible para cualquier OCR y muy por debajo de una foto real
  const pageW = Math.round(Math.min(v.pageWidth, v.pdf ? (v.pageWidth * 1.414) / Math.max(1, aspect) : 3000 / Math.max(1, aspect)));
  const pageH = Math.round(pageW * aspect);
  const W = Math.round(pageW * (1 + 2 * v.margin));
  const H = Math.round(pageH + pageW * 2 * v.margin);
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const src = `data:image/png;base64,${Buffer.from(imageBytes).toString('base64')}`;
  const transform = `perspective(1600px) rotateX(${v.tiltX ?? 0}deg) rotateY(${v.tiltY ?? 0}deg) rotateZ(${v.rotate ?? 0}deg)`;
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${v.background};display:flex;align-items:center;justify-content:center">
    <img id="doc" src="${src}" style="width:${pageW}px;height:${pageH}px;transform:${transform};filter:blur(${v.blur}px) contrast(0.9) brightness(1.03)${v.grayscale ? ' grayscale(1)' : ''};box-shadow:0 10px 40px rgba(0,0,0,.45)">
    ${v.shade ? '<div style="position:fixed;inset:0;background:radial-gradient(ellipse at 70% 25%, rgba(255,255,255,0) 30%, rgba(0,0,0,.3) 100%)"></div>' : ''}
    <canvas id="noise" width="${W}" height="${H}" style="position:fixed;inset:0;opacity:${v.noise}"></canvas>
    <script>
      let s = 90210;
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

function lineMatches(l, e) {
  return (
    norm(l.description) === norm(e.description) &&
    eq(l.quantity, e.quantity, 0.0005) &&
    eq(l.unitPrice, e.unitPrice, 0.00005) &&
    eq(l.total, e.total, 0.005) &&
    (e.discountPct === undefined ? !l.discountPct : eq(l.discountPct, e.discountPct, 0.005))
  );
}

/** Motivo principal de un fallo de línea (para agregar por causa). */
function failReason(e, got) {
  if (!got) return 'falta';
  if (!eq(got.total, e.total, 0.005)) return 'importe';
  if (eq(got.quantity, e.unitPrice, 0.0005) && eq(got.unitPrice, e.quantity, 0.00005)) return 'cantidad↔precio';
  if (!eq(got.quantity, e.quantity, 0.0005)) return 'cantidad';
  if (!eq(got.unitPrice, e.unitPrice, 0.00005)) return 'precio';
  if (e.discountPct === undefined ? !!got.discountPct : !eq(got.discountPct, e.discountPct, 0.005)) return 'descuento';
  return 'descripción';
}

function scoreInvoice(inv, exp) {
  const lines = inv?.lines ?? [];
  const used = new Set();
  let exact = 0;
  let unitOk = 0;
  let unitN = 0;
  const fails = [];
  for (const e of exp.lines) {
    const idx = lines.findIndex((l, i) => !used.has(i) && lineMatches(l, e));
    if (idx >= 0) {
      used.add(idx);
      exact++;
      if (e.unitShown) {
        unitN++;
        if (lines[idx].unit === e.unit) unitOk++;
      }
    } else {
      const nearIdx = lines.findIndex((l, i) => !used.has(i) && eq(l.total, e.total, 0.005));
      const near = nearIdx >= 0 ? lines[nearIdx] : lines.find((l) => norm(l.description) === norm(e.description));
      fails.push({ reason: failReason(e, near), expected: e, got: near ? { description: near.description, quantity: near.quantity, unit: near.unit, unitPrice: near.unitPrice, discountPct: near.discountPct, total: near.total } : null });
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
  return {
    exact,
    expected: exp.lines.length,
    extra: lines.length - used.size,
    extras,
    denom: Math.max(exp.lines.length, lines.length),
    headerOk: Object.values(headerChecks).filter(Boolean).length,
    headerTotal: 7,
    headerChecks,
    unitOk,
    unitN,
    fails,
  };
}

// ───────────────────────────── Ejecución ─────────────────────────────

const only = typeof args.only === 'string' ? args.only.toLowerCase() : undefined;
const results = [];
const t0 = Date.now();

async function ocrInvoiceFromPdf(bytes) {
  const pngs = await pdfToImages(bytes);
  const grays = [];
  for (const png of pngs) grays.push(await loadGray(png));
  const outcome = await pipeline.ocrInvoice(pipeline.preparePages(grays), backend);
  const inv = pngs.length > 1 && outcome.ocr.rows?.length ? extractIndex.parseInvoicePages(outcome.ocr.rows, 'ocr') : [outcome.invoice];
  return { inv: inv.length > 1 ? outcome.invoice : inv[0], passes: outcome.passes, rows: outcome.ocr.rows };
}

try {
  const ocrSeeds = new Set(args.ocr ? seeds.slice(0, Number(args['ocr-count'] ?? 30)) : []);
  for (const seed of seeds) {
    const { pdf, expected } = await docFor(seed);
    if (only && !expected.features.some((f) => f.toLowerCase().includes(only)) && !expected.template.includes(only)) continue;
    if (!args['no-text']) {
      const ts = Date.now();
      const text = await extractPdfText(pdf);
      const inv = text.hasText ? extractIndex.parseInvoicePages(text.lines, 'pdf-texto')[0] : undefined;
      results.push({ group: 'texto', seed, expected, ms: Date.now() - ts, inv, score: scoreInvoice(inv, expected), rawText: text.text });
    }
    if (ocrSeeds.has(seed)) {
      const ts = Date.now();
      const pngs = await pdfToImages(pdf, { scale: 200 / 72, maxSide: 2400 });
      const v = variantFor(seed, pngs.length, expected.template);
      const shots = [];
      for (const png of pngs) {
        const size = await loadImage(png);
        shots.push(await degradeImage(png, v, { width: size.width, height: size.height }));
      }
      let r;
      if (v.pdf) r = await ocrInvoiceFromPdf(await scannedPdf(shots));
      else {
        const outcome = await pipeline.ocrInvoice(pipeline.preparePages([await loadGray(shots[0].jpeg)]), photoBackend, paddle ? { passes: pipeline.INVOICE_PASSES_PADDLE } : {});
        r = { inv: outcome.invoice, passes: outcome.passes, rows: outcome.ocr.rows };
      }
      results.push({ group: v.pdf ? 'escaneo' : 'foto', seed, expected, ms: Date.now() - ts, inv: r.inv, score: scoreInvoice(r.inv, expected), rawText: r.inv?.rawText });
      // Texto leído por el OCR para depurar (nunca de las semillas reservadas)
      if (typeof args.dump === 'string' && !isHeldout(seed)) {
        mkdirSync(resolve(args.dump), { recursive: true });
        writeFileSync(join(resolve(args.dump), `${seed}-${v.pdf ? 'escaneo' : 'foto'}.txt`), r.inv?.rawText ?? '');
        shots.forEach((shot, k) => writeFileSync(join(resolve(args.dump), `${seed}-${v.pdf ? 'escaneo' : 'foto'}-p${k + 1}.jpg`), shot.jpeg));
        if (r.rows) writeFileSync(join(resolve(args.dump), `${seed}-${v.pdf ? 'escaneo' : 'foto'}.rows.json`), JSON.stringify(r.rows));
      }
    }
  }
} finally {
  if (worker) await worker.terminate();
  if (browser) await browser.close();
  await server.close();
}

// ───────────────────────────── Informe ─────────────────────────────

const pct = (x) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
const pad = (s, n) => String(s).padEnd(n);
log('');
log(`Facturas procedimentales · conjunto ${anyHeldout ? 'RESERVADO (sólo agregado)' : 'de ajuste'} · ${seeds.length} semillas · línea exacta = descripción, cantidad, precio, dto e importe`);
if (!anyHeldout) {
  log('');
  for (const r of results) {
    const s = r.score;
    if (s.exact === s.expected && !s.extra && s.headerOk === 7 && !VERBOSE) continue;
    log(`${pad(`#${r.seed}`, 6)}${pad(r.group, 9)}${pad(r.expected.template, 8)}${pad(`${s.exact}/${s.expected}${s.extra ? ` (+${s.extra})` : ''}`, 12)}cab ${s.headerOk}/7  ${r.expected.features.slice(1).join(' ')}`);
    if (VERBOSE) {
      for (const f of s.fails) log(`    ✗ [${f.reason}] esperado ${JSON.stringify(f.expected)}\n      leído    ${JSON.stringify(f.got)}`);
      for (const x of s.extras) log(`    + sobra ${JSON.stringify(x)}`);
      if (s.headerOk < 7) log(`    cabecera: ${Object.entries(s.headerChecks).filter(([, ok]) => !ok).map(([k]) => `${k}=${JSON.stringify(r.inv?.[k])} (esperado ${JSON.stringify(r.expected.header[k])})`).join(', ')}`);
    }
  }
}
const agg = (list) => {
  const exact = list.reduce((a, r) => a + r.score.exact, 0);
  const denom = list.reduce((a, r) => a + r.score.denom, 0);
  const head = list.reduce((a, r) => a + r.score.headerOk, 0);
  const unit = list.reduce((a, r) => [a[0] + r.score.unitOk, a[1] + r.score.unitN], [0, 0]);
  const perfect = list.filter((r) => r.score.exact === r.score.expected && !r.score.extra).length;
  return { exact, denom, acc: denom ? exact / denom : 1, head, headTotal: list.length * 7, unit, perfect, docs: list.length };
};
log('');
for (const group of ['texto', 'foto', 'escaneo']) {
  const list = results.filter((r) => r.group === group);
  if (!list.length) continue;
  const a = agg(list);
  const label = group === 'texto' ? 'PDF con texto' : group === 'foto' ? 'Fotos degradadas' : 'PDF escaneados';
  log(`${pad(label, 18)} líneas ${a.exact}/${a.denom} = ${pct(a.acc)} · cabecera ${a.head}/${a.headTotal} (${pct(a.head / a.headTotal)}) · unidad ${a.unit[0]}/${a.unit[1]} · documentos perfectos ${a.perfect}/${a.docs}`);
  const fields = Object.keys(list[0].score.headerChecks);
  log(`${pad('', 18)} cabecera por campo: ${fields.map((f) => `${f} ${list.filter((r) => r.score.headerChecks[f]).length}/${list.length}`).join(' · ')}`);
  const reasons = {};
  for (const r of list) for (const f of r.score.fails) reasons[f.reason] = (reasons[f.reason] ?? 0) + 1;
  const extras = list.reduce((a, r) => a + r.score.extra, 0);
  log(`${pad('', 18)} fallos por causa: ${Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'} · líneas sobrantes ${extras}`);
  if (group === 'texto' || args.features) {
    const feats = new Map();
    for (const r of list) {
      for (const f of new Set(r.expected.features.map((x) => (x.startsWith('columnas:') ? null : x)).filter(Boolean))) {
        const e = feats.get(f) ?? [];
        e.push(r);
        feats.set(f, e);
      }
    }
    const rows = [...feats.entries()].map(([f, l]) => [f, agg(l)]).sort((a, b) => a[1].acc - b[1].acc);
    log(`${pad('', 18)} por rasgo: ${rows.map(([f, a]) => `${f} ${pct(a.acc)} (${a.docs})`).join(' · ')}`);
  }
}
log(`OCR: ${ocrStats.calls} lecturas (${ocrStats.cached} de caché, ${(ocrStats.ms / 1000).toFixed(0)} s de tesseract) · total ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (args.json) {
  if (anyHeldout) log('Aviso: --json no se escribe para semillas reservadas.');
  else writeFileSync(resolve(String(args.json)), JSON.stringify(results.map(({ inv, ...r }) => ({ ...r, inv: inv ? { ...inv, rawText: undefined } : inv })), null, 2));
}
