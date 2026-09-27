#!/usr/bin/env node
/**
 * Banco de pruebas de GENERALIZACIÓN de la lectura local de cartas sobre cartas PROCEDURALES (scripts/gen-random-menus.mjs):
 * cada semilla es una carta distinta (contenido, diseño y degradación de la foto al azar) con su verdad de referencia.
 *
 * Mismo canal que la app:
 *  - Fotos (limpia y degradada) y PDF escaneados: escala de grises (lado ≤ 3200 px) → polaridad (pizarras) → preparación
 *    (imageOps.ts) → lector PaddleOCR (scripts/paddle-node.mjs: el mismo onnxruntime-web, modelos y código que la app) y
 *    tesseract.js de segunda opinión con las pasadas de ocrPipeline.ocrMenu → parseMenuOcr (cajas de palabras) +
 *    mergeMenuPasses. Con --engine=tesseract, el canal anterior (sólo Tesseract; la polaridad, con --polarity).
 *  - PDF con texto: pdf.js (legacy) → filas (layout.ts) → orden por columnas (ocrLayout.columnsReadingOrder) →
 *    parseMenuText(…, 'pdf-texto').
 *
 * Protocolo contra el sobreajuste: afinar SÓLO con --set=tune (semillas 1–60, lo que se usa por defecto); --set=holdout
 * (1001–1040) o --set=all imprimen sólo el agregado, sin detalle por carta (--reveal lo muestra, para el análisis final de
 * fallos).
 *
 * Las lecturas de tesseract se guardan en caché (node_modules/.cache/escandallo-random-ocr, clave = imagen + modo).
 *
 * Uso: node scripts/bench-random-menus.mjs [--set=tune|holdout|all] [--seeds=1-10] [--kinds=clean,degraded,pdf]
 *                                         [--jobs=2] [--features] [--verbose] [--reveal] [--json=<archivo>] [--no-cache]
 *                                         [--fast] [--polarity] [--pdf-boxes] [--extract-dir=<ruta>] [--assert]
 *                                         [--engine=paddle|tesseract]
 *   --engine    paddle (por defecto, como la app: PaddleOCR y Tesseract de reserva) o tesseract (sólo Tesseract)
 *   --fast      reutiliza las lecturas de tesseract ya hechas sin repetir la preparación de imagen (para afinar el parser;
 *               sólo con --engine=tesseract: las lecturas de Paddle tienen su propia caché)
 *   --polarity  invierte antes del preprocesado las cartas de fondo oscuro (menuImage.normalizeMenuPolarity, pendiente
 *               de integrar en el canal de la app)
 *   --pdf-boxes PDF con texto: también las posiciones de la capa de texto (menuUtils.pdfLinesToMenuBoxes, integración
 *               solicitada en index.ts)
 *   --extract-dir  otra copia de src/extract (ruta desde la raíz del proyecto) para comparar con la versión anterior
 *   --assert    código 1 si no se alcanzan: limpia ≥ 95 %, degradada ≥ 90 %
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OUT, ensureGenerated, seedDir, seedsFor } from './gen-random-menus.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const log = (...a) => console.log(...a);
const OUT = args.dir ? resolve(String(args.dir)) : DEFAULT_OUT;
const CACHE = join(ROOT, 'node_modules/.cache/escandallo-random-ocr');
mkdirSync(CACHE, { recursive: true });
// Por defecto, sólo las semillas de ajuste: las reservadas se piden expresamente (--set=holdout|all)
const seeds = seedsFor(args.set || typeof args.seeds === 'string' ? args : { ...args, set: 'tune' });
// Con alguna semilla reservada, sólo el agregado (sin detalle por carta)
const HOLDOUT = seeds.some((s) => s > 1000);
const REVEAL = !HOLDOUT || !!args.reveal;
const KINDS = new Set(String(args.kinds ?? 'clean,degraded,pdf').split(','));
const JOBS = Math.max(1, Math.min(4, Number(args.jobs ?? 2)));

// ───────────────────────────── Cartas ─────────────────────────────

const t0 = Date.now();
const exps = await ensureGenerated(seeds, OUT, { log: (m) => log(m) });

// ───────────────────────────── Módulos de la app ─────────────────────────────

const { createServer } = await import('vite');
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);
// --extract-dir: otra copia de src/extract (ruta desde la raíz del proyecto), p. ej. la versión anterior del parser
// para medir el antes y el después con las mismas lecturas de tesseract
const EX = typeof args['extract-dir'] === 'string' ? `/${String(args['extract-dir']).replace(/^\/+|\/+$/g, '')}` : '/src/extract';
const layout = await load(`${EX}/layout.ts`);
const pdfMod = await load(`${EX}/pdf.ts`);
const imageOps = await load(`${EX}/imageOps.ts`);
const pipeline = await load(`${EX}/ocrPipeline.ts`);
const ocrLayout = await load(`${EX}/ocrLayout.ts`);
const extractIndex = await load(`${EX}/index.ts`);
const menuParser = await load(`${EX}/menuParser.ts`);
const menuImage = await load(`${EX}/menuImage.ts`);
const menuUtils = await load(`${EX}/menuUtils.ts`);
/** Motor de las fotos: paddle (como la app) o tesseract (canal anterior). */
const ENGINE = args.engine === 'tesseract' ? 'tesseract' : 'paddle';
/** Polaridad (pizarras y cartas de fondo oscuro invertidas antes del preprocesado): la app la aplica siempre. */
const POLARITY = !!args.polarity || ENGINE === 'paddle';
const paddle =
  ENGINE === 'paddle'
    ? await (await import('./paddle-node.mjs')).createPaddleReader({
        paddleOcr: await load(`${EX}/paddleOcr.ts`),
        paddleModel: await load(`${EX}/paddleModel.ts`),
        imageOps,
        noCache: !!args['no-cache'],
      })
    : undefined;
const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const openPdf = (bytes) => pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }).promise;

async function pdfTextLines(bytes) {
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
  return { lines, hasText: layout.looksLikeText(lines, pageCount) };
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

// ───────────────────────────── OCR (reserva de motores + caché) ─────────────────────────────

const pool = [];
const idle = [];
const waiters = [];
async function acquire() {
  if (idle.length) return idle.pop();
  if (pool.length < JOBS) {
    const T = require('tesseract.js');
    const cachePath = join(ROOT, 'node_modules/.cache/escandallo-tessdata');
    mkdirSync(cachePath, { recursive: true });
    const w = await T.createWorker('spa', 1, { cachePath });
    await w.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
    pool.push(w);
    return w;
  }
  return new Promise((res) => waiters.push(res));
}
function release(w) {
  const next = waiters.shift();
  if (next) next(w);
  else idle.push(w);
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
    const file = join(CACHE, `${key}.json`);
    ocrStats.calls++;
    if (!args['no-cache'] && existsSync(file)) {
      ocrStats.cached++;
      return JSON.parse(readFileSync(file, 'utf8'));
    }
    const w = await acquire();
    try {
      const ts = Date.now();
      const res = await w.recognize(pgm, { tessedit_pageseg_mode: psm }, { text: true, blocks: true });
      ocrStats.ms += Date.now() - ts;
      const slim = slimPage(res.data);
      writeFileSync(file, JSON.stringify(slim));
      return slim;
    } finally {
      release(w);
    }
  },
};

/**
 * Índice rápido (--fast): imagen de origen + página + modo → clave de la caché de tesseract. Evita repetir la
 * preparación de imagen al afinar el parser (válido mientras no cambie imageOps; sin --fast se recalcula todo).
 */
const INDEX = join(CACHE, 'index');
mkdirSync(INDEX, { recursive: true });

async function menuFromImages(images) {
  const src = createHash('sha1');
  for (const img of images) src.update(img);
  if (POLARITY) src.update('polaridad');
  const srcKey = src.digest('hex');
  const passIds = typeof args['pass-ids'] === 'string' ? args['pass-ids'].split(',') : undefined;
  const allPasses = paddle ? pipeline.MENU_PASSES_PADDLE : pipeline.MENU_PASSES;
  const opts = {
    merge: menuParser.mergeMenuPasses,
    quality: menuParser.menuQuality,
    ...(paddle ? pipeline.MENU_PADDLE_OPTIONS : { passes: allPasses }),
    ...(args.passes ? { maxPasses: Number(args.passes) } : {}),
    ...(passIds ? { passes: passIds.map((id) => allPasses.find((p) => p.id === id)).filter(Boolean) } : {}),
  };
  if (args.fast && !paddle) {
    const calls = new Map();
    let miss = false;
    const fastBackend = {
      async recognize(_image, psm) {
        const n = calls.get(psm) ?? 0;
        calls.set(psm, n + 1);
        const ptr = join(INDEX, `${srcKey}-${n}-${psm}`);
        if (!existsSync(ptr)) {
          miss = true;
          throw new Error('fuera del índice');
        }
        ocrStats.calls++;
        ocrStats.cached++;
        return JSON.parse(readFileSync(join(CACHE, `${readFileSync(ptr, 'utf8').trim()}.json`), 'utf8'));
      },
    };
    const dummy = images.map(() => ({ image: { width: 1, height: 1, data: new Uint8ClampedArray([255]) }, info: { scale: 1, lineHeight: 36 } }));
    try {
      const outcome = await pipeline.ocrMenu(dummy, fastBackend, extractIndex.parseMenuOcr, opts);
      return { menu: outcome.menu, passes: outcome.passes.map((p) => p.id), rawText: outcome.ocr.text };
    } catch (err) {
      if (!miss) throw err;
    }
  }
  const grays = [];
  for (const img of images) {
    const g = await loadGray(img);
    grays.push(POLARITY ? menuImage.normalizeMenuPolarity(g).image : g);
  }
  const calls = new Map();
  const indexing = {
    ...(paddle ? { recognizePaddle: (image) => paddle.recognize(image) } : {}),
    async recognize(image, psm) {
      const n = calls.get(psm) ?? 0;
      calls.set(psm, n + 1);
      const page = await backend.recognize(image, psm);
      const key = createHash('sha1').update(Buffer.from(imageOps.encodePgm(image))).update(`psm${psm}`).digest('hex');
      writeFileSync(join(INDEX, `${srcKey}-${n}-${psm}`), key);
      return page;
    },
  };
  const outcome = await pipeline.ocrMenu(pipeline.preparePages(grays), indexing, extractIndex.parseMenuOcr, opts);
  return { menu: outcome.menu, passes: outcome.passes.map((p) => p.id), rawText: outcome.ocr.text };
}

async function menuFromTextPdf(bytes) {
  const { lines, hasText } = await pdfTextLines(bytes);
  if (!hasText) return menuFromImages(await pdfToImages(bytes));
  const text = layout.linesToText(ocrLayout.columnsReadingOrder(lines));
  // --pdf-boxes: la capa de texto con sus posiciones (menuUtils.pdfLinesToMenuBoxes, integración solicitada en index.ts)
  const boxes = args['pdf-boxes'] ? menuUtils.pdfLinesToMenuBoxes(lines) : undefined;
  return { menu: menuParser.parseMenuText(text, 'pdf-texto', boxes), passes: ['pdf-texto'], rawText: text };
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

function scoreMenu(menu, exp) {
  const entries = menu?.entries ?? [];
  const used = new Set();
  let exact = 0;
  let sectionOk = 0;
  let descOk = 0;
  let nameOnly = 0;
  const fails = [];
  for (const e of exp.entries) {
    const idx = entries.findIndex((x, i) => !used.has(i) && norm(x.name) === norm(e.name) && eq(x.price, e.price, 0.005));
    if (idx >= 0) {
      used.add(idx);
      exact++;
      const got = entries[idx];
      if (norm(got.section) === norm(e.section)) sectionOk++;
      if (e.description ? norm(got.description) === norm(e.description) : !got.description) descOk++;
      continue;
    }
    if (entries.some((x) => norm(x.name) === norm(e.name))) nameOnly++;
    const got = entries.find((x, i) => !used.has(i) && norm(x.name) === norm(e.name)) ?? entries.find((x, i) => !used.has(i) && eq(x.price, e.price, 0.005) && norm(x.name).split(' ')[0] === norm(e.name).split(' ')[0]) ?? null;
    fails.push({ expected: { name: e.name, price: e.price }, got: got ? { name: got.name, price: got.price } : null });
  }
  const extras = entries.filter((_, i) => !used.has(i)).map((x) => ({ name: x.name, price: x.price }));
  const denom = Math.max(exp.entries.length, entries.length);
  return { exact, expected: exp.entries.length, extra: entries.length - used.size, extras, accuracy: denom ? exact / denom : 1, sectionOk, descOk, nameOnly, fails };
}

// ───────────────────────────── Ejecución ─────────────────────────────

const jobs = [];
for (const exp of exps) {
  const dir = seedDir(OUT, exp.seed);
  if (KINDS.has('clean')) jobs.push({ exp, group: 'limpia', run: () => menuFromImages([readFileSync(join(dir, exp.files.clean))]) });
  if (KINDS.has('degraded')) {
    const f = join(dir, exp.files.degraded);
    jobs.push({ exp, group: 'degradada', run: async () => (f.endsWith('.pdf') ? menuFromImages(await pdfToImages(readFileSync(f))) : menuFromImages([readFileSync(f)])) });
  }
  if (KINDS.has('pdf') && exp.files.pdf) jobs.push({ exp, group: 'pdf-texto', run: () => menuFromTextPdf(readFileSync(join(dir, exp.files.pdf))) });
}

const results = [];
let next = 0;
let done = 0;
async function runner() {
  while (next < jobs.length) {
    const job = jobs[next++];
    const ts = Date.now();
    try {
      const r = await job.run();
      results.push({ seed: job.exp.seed, id: job.exp.id, group: job.group, design: job.exp.design, ms: Date.now() - ts, passes: r.passes, rawText: r.rawText, menu: r.menu, score: scoreMenu(r.menu, job.exp) });
    } catch (err) {
      results.push({ seed: job.exp.seed, id: job.exp.id, group: job.group, design: job.exp.design, ms: 0, error: String(err?.stack ?? err) });
    }
    done++;
    if (process.stdout.isTTY) process.stdout.write(`\r${done}/${jobs.length}`);
  }
}
try {
  await Promise.all(Array.from({ length: JOBS }, runner));
} finally {
  await Promise.all(pool.map((w) => w.terminate()));
  await server.close();
}
if (process.stdout.isTTY) process.stdout.write('\r');

// ───────────────────────────── Informe ─────────────────────────────

const pct = (x) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
const pad = (s, n) => String(s).padEnd(n);
const order = { limpia: 0, degradada: 1, 'pdf-texto': 2 };
results.sort((a, b) => a.seed - b.seed || order[a.group] - order[b.group]);

if (REVEAL) {
  log(`${pad('Carta', 8)}${pad('Variante', 11)}${pad('Diseño', 58)}${pad('Exactas', 12)}${pad('Exactitud', 11)}${pad('Sección', 9)}Pasadas`);
  log('─'.repeat(130));
  for (const r of results) {
    const d = r.design;
    const desc = `${d.columns}c ${d.rowStyle} ${d.theme} ${d.bodyFont} ${d.priceDec}${d.priceCur !== 'sin' ? d.priceCur.trim() : ''}${d.multiPrice ? ' multi' : ''} ${d.allergens}`;
    if (r.error) {
      log(`${pad(r.id, 8)}${pad(r.group, 11)}${pad(desc, 58)}ERROR ${r.error.split('\n')[0]}`);
      continue;
    }
    const s = r.score;
    log(`${pad(r.id, 8)}${pad(r.group, 11)}${pad(desc.slice(0, 57), 58)}${pad(`${s.exact}/${s.expected}${s.extra ? ` (+${s.extra})` : ''}`, 12)}${pad(pct(s.accuracy), 11)}${pad(`${s.sectionOk}/${s.exact}`, 9)}${r.passes.join('+')}`);
    if (args.verbose && s.accuracy < 1) {
      for (const f of s.fails) log(`    ✗ ${JSON.stringify(f.expected)}  ←  ${JSON.stringify(f.got)}`);
      for (const x of s.extras) log(`    + ${JSON.stringify(x)}`);
    }
  }
}

function agg(list) {
  const ok = list.filter((r) => !r.error);
  const exact = ok.reduce((a, r) => a + r.score.exact, 0);
  const expected = ok.reduce((a, r) => a + r.score.expected, 0);
  const denom = ok.reduce((a, r) => a + Math.max(r.score.expected, r.score.exact + r.score.extra), 0) + list.filter((r) => r.error).length;
  const section = ok.reduce((a, r) => a + r.score.sectionOk, 0);
  const desc = ok.reduce((a, r) => a + r.score.descOk, 0);
  const extra = ok.reduce((a, r) => a + r.score.extra, 0);
  const perfect = ok.filter((r) => r.score.accuracy === 1).length;
  return { exact, expected, denom, acc: denom ? exact / denom : 1, recall: expected ? exact / expected : 1, section, desc, extra, perfect, n: list.length, errors: list.length - ok.length };
}

const targets = { limpia: 0.95, degradada: 0.9, 'pdf-texto': 0.97 };
log('─'.repeat(130));
log(`Cartas procedurales · semillas ${seeds.every((x) => x > 1000) ? 'RESERVADAS' : HOLDOUT ? 'de ajuste + RESERVADAS' : 'de ajuste'} (${exps.length} cartas, ${exps.reduce((n, e) => n + e.entries.length, 0)} platos) · plato exacto = nombre + precio`);
let pass = true;
for (const g of ['limpia', 'degradada', 'pdf-texto']) {
  const list = results.filter((r) => r.group === g);
  if (!list.length) continue;
  const a = agg(list);
  if (a.acc < targets[g] && g !== 'pdf-texto') pass = false;
  log(
    `${pad(`Carta ${g}`, 20)} exactos ${a.exact}/${a.denom} = ${pct(a.acc)} (objetivo ${pct(targets[g])}) · cobertura ${pct(a.recall)} · sobran ${a.extra} · sección ${pct(a.section / Math.max(1, a.exact))} · descripción ${pct(a.desc / Math.max(1, a.exact))} · cartas perfectas ${a.perfect}/${a.n}${a.errors ? ` · ERRORES ${a.errors}` : ''}`,
  );
}

if (args.features && REVEAL) {
  log('\nExactitud por rasgo de diseño (foto limpia y degradada):');
  const keys = ['concept', 'granularity', 'theme', 'columns', 'rowStyle', 'priceDec', 'priceCur', 'priceSep', 'multiPrice', 'bodyFont', 'nameCase', 'descStyle', 'descInline', 'allergens', 'allergenPlace', 'section', 'numbering', 'degraded'];
  for (const k of keys) {
    const vals = [...new Set(results.map((r) => String(r.design[k])))].sort();
    const parts = vals.map((v) => {
      const list = results.filter((r) => String(r.design[k]) === v && r.group !== 'pdf-texto');
      if (!list.length) return '';
      const a = agg(list);
      return `${v} ${pct(a.acc)} (${list.length})`;
    });
    log(`  ${pad(k, 14)} ${parts.filter(Boolean).join(' · ')}`);
  }
}
log(
  `OCR: ${ocrStats.calls} lecturas de Tesseract (${ocrStats.cached} de caché, ${(ocrStats.ms / 1000).toFixed(0)} s)${paddle ? ` · ${paddle.stats.calls} de PaddleOCR (${paddle.stats.cached} de caché, ${(paddle.stats.ms / 1000).toFixed(0)} s)` : ''} · motor ${ENGINE} · total ${((Date.now() - t0) / 1000).toFixed(0)} s`,
);
if (args.json) {
  const dump = REVEAL ? results.map(({ menu, ...r }) => ({ ...r, entries: menu?.entries })) : results.map((r) => ({ seed: r.seed, group: r.group, accuracy: r.score?.accuracy }));
  writeFileSync(resolve(String(args.json)), JSON.stringify(dump, null, 1));
}
if (args.assert && !pass) process.exit(1);
