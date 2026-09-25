#!/usr/bin/env node
/**
 * Banco de pruebas de la extracción LOCAL (gratuita, sin IA) de Escandallo Pro.
 *
 * Ejecuta en Node el mismo canal que usa la app en el navegador:
 *  - PDF con texto: pdf.js (build "legacy") → reconstrucción de filas (src/extract/layout.ts) → parser de facturas.
 *  - PDF escaneado / fotos: render/decodificación → preparación de la imagen (src/extract/imageOps.ts) →
 *    tesseract.js (Node) con las mismas pasadas y la misma validación aritmética (src/extract/ocrPipeline.ts).
 * sobre los documentos de public/samples y sobre variantes DEGRADADAS generadas con Playwright/Chromium
 * (giro, perspectiva, desenfoque, ruido, compresión JPEG, baja resolución y un "PDF escaneado" sólo imagen).
 *
 * Verdad de referencia: tests/fixtures/bench/expected.json.
 *
 * Uso:  node scripts/bench-extraction.mjs [--only=<texto>] [--no-ocr] [--no-menus] [--menu-text-only] [--keep=<dir>] [--json=<archivo>] [--verbose]
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

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
const vlog = (...a) => VERBOSE && console.log(...a);

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

// ───────────────────────────── Carga de los módulos TypeScript de la app ─────────────────────────────

const { createServer } = await import('vite');
const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const load = (p) => server.ssrLoadModule(p);
const layout = await load('/src/extract/layout.ts');
const pdfMod = await load('/src/extract/pdf.ts');
const imageOps = await load('/src/extract/imageOps.ts');
const pipeline = await load('/src/extract/ocrPipeline.ts');
const extractIndex = await load('/src/extract/index.ts');
const menuParser = await load('/src/extract/menuParser.ts');

const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const expected = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/bench/expected.json'), 'utf8'));
const workDir = args.keep ? resolve(String(args.keep)) : mkdtempSync(join(tmpdir(), 'bench-extraccion-'));
mkdirSync(workDir, { recursive: true });

// ───────────────────────────── Adaptadores de Node (equivalentes a pdf.ts / ocr.ts) ─────────────────────────────

async function openPdf(bytes) {
  return pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }).promise;
}

/** Igual que extractPdfText del navegador. */
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

/** Igual que pdfToImages del navegador (scale 300/72, lado máximo 3300). Devuelve PNG. */
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

/** Igual que loadGrayImage del navegador (lado máximo 3200). */
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

const backend = {
  async recognize(image, psm) {
    const w = await getWorker();
    const res = await w.recognize(Buffer.from(imageOps.encodePgm(image)), { tessedit_pageseg_mode: psm }, { text: true, blocks: true });
    return res.data;
  },
};

// ───────────────────────────── Variantes degradadas con Chromium ─────────────────────────────

const INVOICE_VARIANTS = [
  { id: 'foto-girada-2º', rotate: 2.2, blur: 0.5, noise: 0.06, jpeg: 72, pageWidth: 1500, margin: 0.08, background: '#3b3530' },
  { id: 'foto-perspectiva', rotate: -1.4, tiltX: 7, tiltY: -3, blur: 0.45, noise: 0.05, jpeg: 62, pageWidth: 1600, margin: 0.1, background: '#6b5b4b', shade: true },
  { id: 'escaneo-baja-resolución', rotate: 0.8, blur: 0.7, noise: 0.07, jpeg: 55, pageWidth: 1000, margin: 0, background: '#ffffff' },
  { id: 'pdf-escaneado', rotate: 1.1, blur: 0.35, noise: 0.05, jpeg: 80, pageWidth: 1654, margin: 0, background: '#ffffff', grayscale: true, pdf: true },
  { id: 'foto-sombra-fuerte', rotate: -2.6, tiltX: 4, blur: 0.5, noise: 0.06, jpeg: 50, pageWidth: 1400, margin: 0.07, background: '#2f2a26', shade: true },
  { id: 'fax-150ppp-ruido', rotate: 0.5, blur: 0.3, noise: 0.12, jpeg: 60, pageWidth: 1240, margin: 0, background: '#ffffff', grayscale: true },
];

const MENU_VARIANTS = [
  { id: 'foto-girada-3º', rotate: 3, blur: 0.3, noise: 0.04, jpeg: 70, pageWidth: 900, margin: 0, background: '#6a5b4a', fromPhoto: true },
  { id: 'ruido-desenfoque', rotate: -1, blur: 0.6, noise: 0.08, jpeg: 60, pageWidth: 900, margin: 0, background: '#6a5b4a', fromPhoto: true },
  { id: 'baja-resolución', rotate: 0, blur: 0.2, noise: 0.03, jpeg: 70, pageWidth: 650, margin: 0, background: '#6a5b4a', fromPhoto: true },
  { id: 'móvil-perspectiva-sombra', rotate: -2, tiltX: 8, tiltY: 4, blur: 0.4, noise: 0.05, jpeg: 55, pageWidth: 900, margin: 0.06, background: '#2b2622', shade: true, fromPhoto: true },
];

let browser;
async function getBrowser() {
  if (browser) return browser;
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  return browser;
}

/** Degrada una imagen (PNG/JPEG) en Chromium y devuelve { jpeg, pdf? }. */
async function degrade(imageBytes, mime, v, size) {
  const b = await getBrowser();
  const aspect = size.height / size.width;
  const pageW = v.pageWidth;
  const pageH = Math.round(pageW * aspect);
  const W = Math.round(pageW * (1 + 2 * v.margin));
  const H = Math.round(pageH + pageW * 2 * v.margin);
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const src = `data:${mime};base64,${Buffer.from(imageBytes).toString('base64')}`;
  const transform = `perspective(1600px) rotateX(${v.tiltX ?? 0}deg) rotateY(${v.tiltY ?? 0}deg) rotateZ(${v.rotate ?? 0}deg)`;
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${v.background};display:flex;align-items:center;justify-content:center">
    <img id="doc" src="${src}" style="width:${pageW}px;height:${pageH}px;transform:${transform};filter:blur(${v.blur}px) contrast(0.9) brightness(1.03)${v.grayscale ? ' grayscale(1)' : ''};box-shadow:0 10px 40px rgba(0,0,0,.45)">
    ${v.shade ? '<div style="position:fixed;inset:0;background:radial-gradient(ellipse at 20% 15%, rgba(255,255,255,0) 30%, rgba(0,0,0,.28) 100%)"></div>' : ''}
    <canvas id="noise" width="${W}" height="${H}" style="position:fixed;inset:0;opacity:${v.noise}"></canvas>
    <script>
      let s = 12345;
      const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const c = document.getElementById('noise'); const ctx = c.getContext('2d');
      const img = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) { const g = rnd() * 255; img.data[i] = img.data[i+1] = img.data[i+2] = g; img.data[i+3] = 255; }
      ctx.putImageData(img, 0, 0);
    </script></body></html>`);
  await page.waitForFunction(() => document.getElementById('doc').complete);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: v.jpeg });
  let pdf;
  if (v.pdf) {
    // PDF escaneado: sólo una imagen por página, sin capa de texto
    const scan = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    await page.setContent(`<!doctype html><html><body style="margin:0"><img src="${scan}" style="width:210mm;height:${(210 * H) / W}mm;display:block"></body></html>`);
    await page.waitForFunction(() => document.images[0].complete);
    pdf = await page.pdf({ width: '210mm', height: `${(210 * H) / W}mm`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  }
  await page.close();
  return { jpeg, pdf };
}

// ───────────────────────────── Evaluación ─────────────────────────────

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
        (e.discountPct === undefined || eq(l.discountPct, e.discountPct, 0.005)),
    );
    if (idx >= 0) {
      used.add(idx);
      exact++;
    } else {
      const near = lines.find((l) => eq(l.total, e.total, 0.005)) ?? lines.find((l) => norm(l.description) === norm(e.description));
      fails.push({ expected: e, got: near ? { description: near.description, quantity: near.quantity, unitPrice: near.unitPrice, discountPct: near.discountPct, total: near.total } : null });
    }
  }
  const extra = lines.length - used.size;
  const denom = Math.max(exp.lines.length, lines.length);
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
  const headerOk = Object.values(headerChecks).filter(Boolean).length;
  return { exact, expected: exp.lines.length, extra, accuracy: denom ? exact / denom : 1, headerOk, headerTotal: 7, headerChecks, fails };
}

function scoreMenu(menu, exp) {
  const entries = menu?.entries ?? [];
  const used = new Set();
  let exact = 0;
  const fails = [];
  for (const e of exp.entries) {
    const idx = entries.findIndex((x, i) => !used.has(i) && norm(x.name) === norm(e.name) && eq(x.price, e.price, 0.005));
    if (idx >= 0) {
      used.add(idx);
      exact++;
    } else fails.push({ expected: e, got: entries.find((x) => eq(x.price, e.price, 0.005)) ?? null });
  }
  const denom = Math.max(exp.entries.length, entries.length);
  return { exact, expected: exp.entries.length, extra: entries.length - used.size, accuracy: denom ? exact / denom : 1, fails };
}

// ───────────────────────────── Casos ─────────────────────────────

const results = [];
const only = typeof args.only === 'string' ? args.only.toLowerCase() : undefined;
const wanted = (name) => !only || name.toLowerCase().includes(only);

async function runInvoicePdf(name, bytes, variant) {
  const t0 = Date.now();
  const text = await extractPdfText(bytes);
  let invoices;
  let method;
  let passes;
  if (text.hasText) {
    invoices = extractIndex.parseInvoicePages(text.lines, 'pdf-texto');
    method = 'pdf-texto';
  } else {
    const pngs = await pdfToImages(bytes);
    const grays = [];
    for (const png of pngs) grays.push(await loadGray(png));
    const outcome = await pipeline.ocrInvoice(pipeline.preparePages(grays), backend);
    invoices = [outcome.invoice];
    passes = outcome.passes;
    method = 'ocr (pdf escaneado)';
  }
  return { name, variant, method, ms: Date.now() - t0, inv: invoices[0], passes };
}

async function runInvoiceImage(name, jpeg, variant) {
  const t0 = Date.now();
  const gray = await loadGray(jpeg);
  const pages = pipeline.preparePages([gray]);
  const outcome = await pipeline.ocrInvoice(pages, backend);
  return { name, variant, method: 'ocr (foto)', ms: Date.now() - t0, inv: outcome.invoice, passes: outcome.passes, prep: pages[0].info };
}

async function runMenuImage(name, bytes, variant) {
  const t0 = Date.now();
  const gray = await loadGray(bytes);
  const pages = pipeline.preparePages([gray]);
  // Mismo camino que la app (index.ts): texto por columnas + cajas de palabras y combinación de pasadas del parser
  const parse = args['menu-text-only'] ? (t) => menuParser.parseMenuText(t, 'ocr') : extractIndex.parseMenuOcr;
  const outcome = await pipeline.ocrMenu(pages, backend, parse, { merge: menuParser.mergeMenuPasses, quality: menuParser.menuQuality });
  return { name, variant, method: 'ocr (foto)', ms: Date.now() - t0, menu: outcome.menu, passes: outcome.passes, prep: pages[0].info, rawText: outcome.ocr.text };
}

try {
  for (const [name, exp] of Object.entries(expected.invoices)) {
    const bytes = readFileSync(join(ROOT, 'public/samples', name));
    if (wanted(`${name} texto`)) {
      const r = await runInvoicePdf(name, bytes, 'PDF con texto');
      results.push({ ...r, kind: 'invoice', degraded: false, score: scoreInvoice(r.inv, exp) });
    }
    if (args['no-ocr']) continue;
    const variants = INVOICE_VARIANTS.filter((v) => wanted(`${name} ${v.id}`));
    if (!variants.length) continue;
    const [png] = await pdfToImages(bytes, { scale: 200 / 72, maxSide: 2400 });
    const size = await loadImage(png);
    for (const v of variants) {
      const { jpeg, pdf } = await degrade(png, 'image/png', v, { width: size.width, height: size.height });
      const base = `${name.replace(/\.pdf$/, '')}-${v.id}`;
      writeFileSync(join(workDir, `${base}.jpg`), jpeg);
      if (pdf) writeFileSync(join(workDir, `${base}.pdf`), pdf);
      const r = v.pdf ? await runInvoicePdf(name, pdf, v.id) : await runInvoiceImage(name, jpeg, v.id);
      results.push({ ...r, kind: 'invoice', degraded: true, score: scoreInvoice(r.inv, exp) });
      vlog(`  ${name} · ${v.id}: ${JSON.stringify(r.passes)} ${JSON.stringify(r.prep ?? {})}`);
    }
  }

  if (!args['no-menus'] && !args['no-ocr']) {
    for (const [name, exp] of Object.entries(expected.menus)) {
      const bytes = readFileSync(join(ROOT, 'public/samples', name));
      const cases = [{ id: 'foto original', bytes }];
      for (const v of MENU_VARIANTS) {
        if (!wanted(`${name} ${v.id}`)) continue;
        const size = await loadImage(bytes);
        const { jpeg } = await degrade(bytes, 'image/jpeg', v, { width: size.width, height: size.height });
        writeFileSync(join(workDir, `${name.replace(/\.jpg$/, '')}-${v.id}.jpg`), jpeg);
        cases.push({ id: v.id, bytes: jpeg, degraded: true });
      }
      for (const c of cases) {
        if (!wanted(`${name} ${c.id}`)) continue;
        try {
          const r = await runMenuImage(name, c.bytes, c.id);
          results.push({ ...r, kind: 'menu', degraded: !!c.degraded, score: scoreMenu(r.menu, exp) });
          vlog(r.rawText);
        } catch (err) {
          results.push({ name, variant: c.id, kind: 'menu', degraded: !!c.degraded, method: 'ocr (foto)', ms: 0, error: String(err?.message ?? err) });
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
log('Extracción local (gratis, en el dispositivo) · exactitud por línea: descripción, cantidad, precio y total');
log('');
log(`${pad('Documento', 34)}${pad('Variante', 26)}${pad('Método', 21)}${pad('Líneas exactas', 16)}${pad('Exactitud', 11)}${pad('Cabecera', 10)}Tiempo`);
log('─'.repeat(128));
for (const r of results) {
  if (r.error) {
    log(`${pad(r.name, 34)}${pad(r.variant, 26)}${pad(r.method, 21)}ERROR: ${r.error}`);
    continue;
  }
  const s = r.score;
  const head = r.kind === 'invoice' ? `${s.headerOk}/${s.headerTotal}` : '—';
  log(`${pad(r.name, 34)}${pad(r.variant, 26)}${pad(r.method, 21)}${pad(`${s.exact}/${s.expected}${s.extra ? ` (+${s.extra})` : ''}`, 16)}${pad(pct(s.accuracy), 11)}${pad(head, 10)}${(r.ms / 1000).toFixed(1).replace('.', ',')} s`);
  if (s.fails.length && (VERBOSE || s.accuracy < 1)) for (const f of s.fails) log(`    ✗ esperado ${JSON.stringify(f.expected)} → leído ${JSON.stringify(f.got)}`);
  if (r.kind === 'invoice' && s.headerOk < s.headerTotal) log(`    cabecera: ${Object.entries(s.headerChecks).filter(([, ok]) => !ok).map(([k]) => `${k}=${JSON.stringify(r.inv?.[k])}`).join(', ')}`);
}
const agg = (list) => {
  const ok = list.filter((r) => !r.error);
  const exact = ok.reduce((a, r) => a + r.score.exact, 0);
  const denom = ok.reduce((a, r) => a + Math.max(r.score.expected, r.score.exact + r.score.extra), 0);
  const head = ok.filter((r) => r.kind === 'invoice').reduce((a, r) => [a[0] + r.score.headerOk, a[1] + r.score.headerTotal], [0, 0]);
  return { exact, denom, acc: denom ? exact / denom : 1, head };
};
const groups = [
  ['Facturas PDF con texto', results.filter((r) => r.kind === 'invoice' && !r.degraded)],
  ['Facturas degradadas (fotos y escaneos)', results.filter((r) => r.kind === 'invoice' && r.degraded)],
  ['Cartas (foto original)', results.filter((r) => r.kind === 'menu' && !r.degraded)],
  ['Cartas degradadas', results.filter((r) => r.kind === 'menu' && r.degraded)],
];
log('─'.repeat(128));
for (const [label, list] of groups) {
  if (!list.length) continue;
  const a = agg(list);
  const head = a.head[1] ? ` · cabecera ${a.head[0]}/${a.head[1]} (${pct(a.head[0] / a.head[1])})` : '';
  log(`${pad(label, 42)} líneas ${a.exact}/${a.denom} = ${pct(a.acc)}${head}`);
}
if (args.json) {
  writeFileSync(resolve(String(args.json)), JSON.stringify(results.map(({ inv, menu, rawText, ...r }) => ({ ...r, supplierName: inv?.supplierName })), null, 2));
}
