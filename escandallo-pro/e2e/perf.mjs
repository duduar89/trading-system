// Medición de carga inicial: JS y CSS que descarga el navegador para pintar la bienvenida (restaurante nuevo) y el panel
// (restaurante de ejemplo), con su tamaño comprimido en gzip, y comprobación de que las librerías pesadas (pdf.js, OCR,
// Excel, gráficos, SDK de IA, base de conocimiento) no forman parte de la carga inicial.
//
// Uso: node e2e/perf.mjs [baseUrl] [distDir]
//   baseUrl  app compilada servida con `vite preview` (por defecto http://localhost:4173/)
//   distDir  carpeta del build servido (por defecto ./dist), para medir el gzip de cada archivo
// Variables: PERF_BUDGET_KB (por defecto 250) = presupuesto de JS inicial (gzip) de la bienvenida.
// Termina con código ≠ 0 si se supera el presupuesto o si una librería pesada entra en la carga inicial.
import { chromium } from 'playwright';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] ?? 'http://localhost:4173/').replace(/#.*$/, '').replace(/\/?$/, '/');
const DIST = resolve(process.argv[3] ?? join(ROOT, 'dist'));
const BUDGET_KB = Number(process.env.PERF_BUDGET_KB ?? 250);
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

// Nombres de chunk que nunca deben llegar en la primera pintura.
const HEAVY = [
  { name: 'pdf.js', re: /(^|\/)pdf[-.]|pdfjs/i },
  { name: 'tesseract', re: /tesseract/i },
  { name: 'exceljs', re: /exceljs/i },
  { name: 'recharts', re: /recharts|CartesianChart|AreaChart|BarChart|ScatterChart/i },
  { name: 'SDK de IA', re: /(^|\/)sdk-|anthropic/i },
  { name: 'base de conocimiento', re: /(^|\/)(ingredients|propose|recipes)-/i },
  { name: 'extracción', re: /(^|\/)extract-/i },
];

const gzCache = new Map();
function gzipKb(url) {
  const path = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
  const file = join(DIST, path);
  if (!existsSync(file)) return undefined;
  if (!gzCache.has(file)) gzCache.set(file, { raw: statSync(file).size / 1024, gz: gzipSync(readFileSync(file)).length / 1024 });
  return gzCache.get(file);
}

async function measure(browser, label, prepare) {
  // Sin service worker: medimos la red real de una primera visita.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', serviceWorkers: 'block' });
  // Momento en que aparece el primer <h1> de la pantalla (primera pintura útil): lo que se descarga antes es la carga
  // inicial; lo que llega después (gráficos, datos…) es diferido y no retrasa la pintura.
  await ctx.addInitScript(() => {
    const mark = () => {
      if (window.__h1At == null && document.querySelector('main h1, h1')) window.__h1At = performance.now();
    };
    new MutationObserver(mark).observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (prepare) {
    await prepare(page);
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(800);
  const { entries, h1At } = await page.evaluate(() => ({
    h1At: window.__h1At ?? null,
    entries: performance
      .getEntriesByType('resource')
      .map((e) => ({ name: e.name, type: e.initiatorType, start: e.startTime, transfer: e.transferSize, body: e.encodedBodySize })),
  }));
  const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null);
  await ctx.close();
  const all = entries
    .filter((e) => /\.(m?js|css)(\?|$)/.test(e.name))
    .map((e) => ({
      url: e.name,
      file: new URL(e.name).pathname.split('/').pop(),
      css: /\.css(\?|$)/.test(e.name),
      size: gzipKb(e.name),
      initial: h1At == null || e.start <= h1At,
    }));
  const files = all.filter((f) => f.initial);
  const deferred = all.filter((f) => !f.initial && !f.css);
  const js = files.filter((f) => !f.css);
  const css = files.filter((f) => f.css);
  const sum = (arr, k) => arr.reduce((s, f) => s + (f.size?.[k] ?? 0), 0);
  const heavy = js.flatMap((f) => HEAVY.filter((h) => h.re.test(f.file)).map((h) => `${h.name} (${f.file})`));
  return {
    label,
    js,
    css,
    deferred,
    jsGz: sum(js, 'gz'),
    jsRaw: sum(js, 'raw'),
    cssGz: sum(css, 'gz'),
    cssRaw: sum(css, 'raw'),
    deferredGz: sum(deferred, 'gz'),
    heavy,
    fcp,
    h1At,
  };
}

function mainChunk() {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const src = /<script[^>]+type="module"[^>]+src="\.?\/?([^"]+)"/.exec(html)?.[1];
  const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\.?\/?([^"]+)"/g)].map((m) => m[1]);
  const size = (p) => {
    const f = join(DIST, p);
    return existsSync(f) ? { raw: statSync(f).size / 1024, gz: gzipSync(readFileSync(f)).length / 1024 } : { raw: 0, gz: 0 };
  };
  return { src, main: src ? size(src) : { raw: 0, gz: 0 }, preloads: preloads.map((p) => ({ p, ...size(p) })) };
}

function largestChunks(n = 8) {
  const dir = join(DIST, 'assets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ f, gz: gzipSync(readFileSync(join(dir, f))).length / 1024 }))
    .sort((a, b) => b.gz - a.gz)
    .slice(0, n);
}

const kb = (v) => `${v.toFixed(1)} KB`;
const browser = await chromium.launch();
let failed = 0;
try {
  const welcome = await measure(browser, 'Bienvenida (restaurante nuevo)');
  const dashboard = await measure(browser, 'Panel (restaurante de ejemplo)', async (page) => {
    await page.getByRole('button', { name: /ejemplo/i }).first().click({ timeout: 15000 });
    await page.waitForURL(/#\/?$/, { timeout: 30000 }).catch(() => {});
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
  });
  const m = mainChunk();
  console.log(`Chunk principal ${m.src}: ${kb(m.main.raw)} (gzip ${kb(m.main.gz)})`);
  for (const p of m.preloads) console.log(`  modulepreload ${p.p}: ${kb(p.raw)} (gzip ${kb(p.gz)})`);
  for (const r of [welcome, dashboard]) {
    console.log(`\n${r.label}: JS inicial ${kb(r.jsRaw)} (gzip ${kb(r.jsGz)}) en ${r.js.length} archivos · CSS ${kb(r.cssRaw)} (gzip ${kb(r.cssGz)})`);
    console.log(`  diferido tras la primera pintura: ${kb(r.deferredGz)} gzip (${r.deferred.map((f) => f.file).join(', ') || 'nada'})`);
    if (r.fcp != null) console.log(`  first-contentful-paint: ${Math.round(r.fcp)} ms · primer <h1>: ${r.h1At != null ? Math.round(r.h1At) : '—'} ms`);
    for (const f of [...r.js].sort((a, b) => (b.size?.gz ?? 0) - (a.size?.gz ?? 0)).slice(0, 12)) console.log(`  ${f.file}  gzip ${kb(f.size?.gz ?? 0)}`);
    if (r.heavy.length) {
      failed++;
      console.log(`  FAIL librerías pesadas en la carga inicial: ${r.heavy.join(', ')}`);
    } else console.log('  PASS sin librerías pesadas en la carga inicial');
  }
  if (welcome.jsGz > BUDGET_KB) {
    failed++;
    console.log(`\nFAIL la bienvenida carga ${kb(welcome.jsGz)} de JS (gzip), presupuesto ${BUDGET_KB} KB`);
  } else console.log(`\nPASS la bienvenida carga ${kb(welcome.jsGz)} de JS (gzip), presupuesto ${BUDGET_KB} KB`);
  console.log('\nChunks más grandes (gzip):');
  for (const c of largestChunks()) console.log(`  ${c.f}  ${kb(c.gz)}`);
} catch (e) {
  failed++;
  console.log(`FAIL Excepción: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
