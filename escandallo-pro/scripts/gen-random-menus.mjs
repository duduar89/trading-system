#!/usr/bin/env node
/**
 * Generador PROCEDURAL de cartas de restaurante (semilla → carta) para medir la generalización de la lectura local de
 * cartas sin sobreajustar a un puñado de documentos. Cada semilla produce una carta española realista pero aleatoria
 * (contenido: scripts/random-menus/content.mjs; diseño: scripts/random-menus/render.mjs) y:
 *   s0001/menu.html       · fuente
 *   s0001/clean.jpg       · captura limpia («foto original» de alta calidad)
 *   s0001/photo.jpg       · foto degradada (giro, perspectiva, sombra, desenfoque, baja resolución, ruido JPEG), o
 *   s0001/scan.pdf        · PDF escaneado (sólo imagen, gris) en ~20 % de las semillas
 *   s0001/menu.pdf        · PDF con capa de texto (carta digital) en ~30 % de las semillas
 *   s0001/expected.json   · verdad de referencia (de los mismos datos que el HTML) + diseño + degradación
 *
 * Protocolo contra el sobreajuste: se afina SÓLO con las semillas de ajuste (1–60) y se informa del resultado en las
 * semillas reservadas (1001–1040), que no se inspeccionan una a una (scripts/bench-random-menus.mjs --set=holdout sólo
 * imprime el agregado).
 *
 * Uso: node scripts/gen-random-menus.mjs [--seeds=1-60,1001-1040] [--set=tune|holdout|all] [--out=<dir>] [--force]
 * Por defecto genera todas (ajuste + reservadas) en node_modules/.cache/escandallo-random-menus. Es determinista.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { Rng } from './random-menus/rng.mjs';
import { generateContent } from './random-menus/content.mjs';
import { generateDesign, renderMenu } from './random-menus/render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Sube la versión al cambiar el generador: las cartas ya generadas con otra versión se regeneran. */
export const GEN_VERSION = 7;
export const TUNE_SEEDS = range(1, 60);
export const HOLDOUT_SEEDS = range(1001, 1040);
export const DEFAULT_OUT = join(ROOT, 'node_modules/.cache/escandallo-random-menus');

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/** "1-60,1001-1040" → [1..60, 1001..1040]. */
export function parseSeeds(spec) {
  const out = [];
  for (const part of String(spec).split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (m) out.push(...range(Number(m[1]), Number(m[2] ?? m[1])));
  }
  return [...new Set(out)];
}

export function seedsFor(args) {
  if (typeof args.seeds === 'string') return parseSeeds(args.seeds);
  if (args.set === 'tune') return TUNE_SEEDS;
  if (args.set === 'holdout') return HOLDOUT_SEEDS;
  return [...TUNE_SEEDS, ...HOLDOUT_SEEDS];
}

export const seedDir = (out, seed) => join(out, `s${String(seed).padStart(4, '0')}`);

/** Parámetros de la foto degradada (flujo propio de la semilla). */
function degradation(seed, width, height, dishSize) {
  const rng = new Rng(`${seed}:foto`);
  const scan = rng.chance(0.2);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  if (scan) {
    return {
      kind: 'scan',
      rotate: clamp(rng.normal() * 0.7, -1.5, 1.5),
      tiltX: 0,
      tiltY: 0,
      blur: rng.float(0.2, 0.55),
      noise: rng.float(0.02, 0.06),
      jpeg: rng.int(65, 85),
      long: Math.max(rng.int(1700, 2400), Math.ceil((13 / dishSize) * Math.max(width, height))),
      margin: 0,
      background: '#ffffff',
      shade: 'none',
      shadeAlpha: 0,
      grayscale: true,
    };
  }
  const res = rng.weighted({ high: 0.45, mid: 0.4, low: 0.15 });
  let long = res === 'high' ? rng.int(2200, 3000) : res === 'mid' ? rng.int(1600, 2200) : rng.int(1200, 1600);
  // Foto legible (quien fotografía la carta encuadra para que se lea): letra de los platos de al menos ~12 px
  long = Math.max(long, Math.ceil((12 / dishSize) * Math.max(width, height)));
  return {
    kind: 'photo',
    rotate: clamp(rng.normal() * 1.6, -4, 4),
    tiltX: rng.chance(0.5) ? rng.float(-9, 9) : 0,
    tiltY: rng.chance(0.5) ? rng.float(-8, 8) : 0,
    blur: rng.float(0.15, 1.0),
    noise: rng.float(0.02, 0.09),
    jpeg: rng.int(45, 85),
    long: Math.round(Math.min(long, Math.max(width, height) * 1.15)),
    margin: rng.float(0.01, 0.1),
    background: rng.pick(['#6a5b4a', '#2b2622', '#3b3530', '#777777', '#5a4a3c', '#1f1f1f', '#8a7a66', '#40505a']),
    shade: rng.weighted({ none: 0.4, radial: 0.35, linear: 0.25 }),
    shadeAlpha: rng.float(0.12, 0.38),
    shadeAngle: rng.int(0, 359),
    shadeX: rng.int(10, 90),
    shadeY: rng.int(10, 90),
    grayscale: false,
  };
}

async function degrade(browser, jpeg, size, v) {
  const aspect = size.height / size.width;
  const inner = v.long / (1 + 2 * v.margin);
  const pageH = aspect >= 1 ? inner : inner * aspect;
  const pageW = pageH / aspect;
  const W = Math.round(pageW * (1 + 2 * v.margin));
  const H = Math.round(pageH + pageW * 2 * v.margin);
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const src = `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`;
  const transform = `perspective(${Math.round(Math.max(W, H) * 1.3)}px) rotateX(${v.tiltX}deg) rotateY(${v.tiltY}deg) rotateZ(${v.rotate}deg)`;
  const shade =
    v.shade === 'radial'
      ? `<div style="position:fixed;inset:0;background:radial-gradient(ellipse at ${v.shadeX}% ${v.shadeY}%, rgba(255,255,255,0) 25%, rgba(0,0,0,${v.shadeAlpha.toFixed(2)}) 100%)"></div>`
      : v.shade === 'linear'
        ? `<div style="position:fixed;inset:0;background:linear-gradient(${v.shadeAngle}deg, rgba(0,0,0,0) 35%, rgba(0,0,0,${v.shadeAlpha.toFixed(2)}) 100%)"></div>`
        : '';
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${v.background};display:flex;align-items:center;justify-content:center">
    <img id="doc" src="${src}" style="width:${Math.round(pageW)}px;height:${Math.round(pageH)}px;transform:${transform};filter:blur(${v.blur.toFixed(2)}px) contrast(0.92) brightness(1.02)${v.grayscale ? ' grayscale(1)' : ''};box-shadow:0 10px 40px rgba(0,0,0,.45)">
    ${shade}
    <canvas id="noise" width="${W}" height="${H}" style="position:fixed;inset:0;opacity:${v.noise.toFixed(3)}"></canvas>
    <script>
      let s = ${Math.round(v.noise * 1e6) + W};
      const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const c = document.getElementById('noise'); const ctx = c.getContext('2d');
      const img = ctx.createImageData(c.width, c.height);
      for (let i = 0; i < img.data.length; i += 4) { const g = rnd() * 255; img.data[i] = img.data[i+1] = img.data[i+2] = g; img.data[i+3] = 255; }
      ctx.putImageData(img, 0, 0);
    </script></body></html>`);
  await page.waitForFunction(() => document.getElementById('doc').complete);
  const out = await page.screenshot({ type: 'jpeg', quality: v.jpeg });
  await page.close();
  return { jpeg: out, W, H };
}

async function scannedPdf(browser, shot) {
  const page = await browser.newPage();
  const hmm = (210 * shot.H) / shot.W;
  await page.setContent(`<!doctype html><html><body style="margin:0"><img src="data:image/jpeg;base64,${shot.jpeg.toString('base64')}" style="width:210mm;height:${hmm}mm;display:block"></body></html>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const pdf = await page.pdf({ width: '210mm', height: `${hmm}mm`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  await page.close();
  return pdf;
}

/** Resumen del diseño para el informe por rasgos (sólo semillas de ajuste). */
function designSummary(design, content, deg, pdfText) {
  return {
    concept: content.concept,
    granularity: content.granularity,
    theme: design.theme,
    columns: design.columns,
    rowStyle: design.rowStyle,
    priceDec: design.price.dec,
    priceCur: design.price.cur || 'sin',
    priceSep: design.price.sep,
    multiPrice: design.multiPrice,
    bodyFont: design.fonts.bodyKind,
    nameCase: design.nameCase,
    descStyle: design.desc.style,
    descInline: design.desc.inline,
    allergens: design.allergens.mode,
    allergenPlace: design.allergens.place,
    section: design.section.style,
    numbering: design.numbering,
    dishSize: design.dishSize,
    degraded: deg.kind,
    pdfText,
  };
}

/** Genera (o reutiliza) la carta de una semilla. */
export async function generateSeed(browser, kb, seed, out, force = false) {
  const dir = seedDir(out, seed);
  const expFile = join(dir, 'expected.json');
  if (!force && existsSync(expFile)) {
    try {
      const prev = JSON.parse(readFileSync(expFile, 'utf8'));
      if (prev.version === GEN_VERSION) return prev;
    } catch {
      // se regenera
    }
  }
  mkdirSync(dir, { recursive: true });
  const content = generateContent(new Rng(`${seed}:contenido`), kb);
  const design = generateDesign(new Rng(`${seed}:diseno`), content);
  const pdfText = new Rng(`${seed}:pdf`).chance(0.3);
  // Formato de carta real (A4, A3, díptico, DL): si el contenido sale demasiado alargado se reparte en más columnas
  let rendered;
  let height = 0;
  let page;
  for (let attempt = 0; attempt < 3; attempt++) {
    rendered = renderMenu(content, design, new Rng(`${seed}:detalles`));
    page = await browser.newPage({ viewport: { width: rendered.width, height: 1000 }, deviceScaleFactor: 1 });
    await page.setContent(rendered.html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
    if (height <= 2.1 * rendered.width || design.columns >= Math.min(3, content.sections.length)) break;
    await page.close();
    design.columns++;
    design.width = Math.round(design.width * (design.columns === 2 ? 1.3 : 1.25));
    design.dishSize = Math.min(design.dishSize, design.columns === 3 ? 22 : 26);
  }
  const { html, width, expected } = rendered;
  await page.setViewportSize({ width, height });
  const clean = await page.screenshot({ type: 'jpeg', quality: new Rng(`${seed}:jpeg`).int(82, 92), fullPage: true });
  if (pdfText) {
    const pdf = await page.pdf({ width: `${width}px`, height: `${height + 2}px`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    writeFileSync(join(dir, 'menu.pdf'), pdf);
  }
  await page.close();

  const deg = degradation(seed, width, height, design.dishSize);
  const shot = await degrade(browser, clean, { width, height }, deg);
  if (deg.kind === 'scan') writeFileSync(join(dir, 'scan.pdf'), await scannedPdf(browser, shot));
  else writeFileSync(join(dir, 'photo.jpg'), shot.jpeg);
  writeFileSync(join(dir, 'menu.html'), html);
  writeFileSync(join(dir, 'clean.jpg'), clean);
  const exp = {
    version: GEN_VERSION,
    id: `s${String(seed).padStart(4, '0')}`,
    seed,
    kind: 'menu',
    size: { width, height },
    design: designSummary(design, content, deg, pdfText),
    degradation: deg,
    files: { clean: 'clean.jpg', degraded: deg.kind === 'scan' ? 'scan.pdf' : 'photo.jpg', ...(pdfText ? { pdf: 'menu.pdf' } : {}) },
    entries: expected,
  };
  writeFileSync(expFile, `${JSON.stringify(exp, null, 2)}\n`);
  return exp;
}

/** Base de conocimiento local (recetas e ingredientes) con el mismo cargador que la app (Vite). */
export async function loadKb() {
  const opts = { root: ROOT, configFile: false, logLevel: 'error' };
  const { module: recipes } = await runnerImport(join(ROOT, 'src/kb/recipes.ts'), opts);
  const { module: ingredients } = await runnerImport(join(ROOT, 'src/kb/ingredients.ts'), opts);
  return { recipes: recipes.KB_RECIPES, ingredients: ingredients.KB_INGREDIENTS };
}

export async function launchBrowser() {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
  const { chromium } = await import('playwright');
  return chromium.launch({ args: ['--no-sandbox'] });
}

/** Genera las semillas que falten (o todas con force) y devuelve sus expected.json. */
export async function ensureGenerated(seeds, out = DEFAULT_OUT, { force = false, log = () => {} } = {}) {
  const missing = seeds.filter((s) => {
    if (force) return true;
    try {
      return JSON.parse(readFileSync(join(seedDir(out, s), 'expected.json'), 'utf8')).version !== GEN_VERSION;
    } catch {
      return true;
    }
  });
  if (missing.length) {
    const kb = await loadKb();
    const browser = await launchBrowser();
    try {
      for (const s of missing) {
        const exp = await generateSeed(browser, kb, s, out, true);
        log(`carta ${exp.id}: ${exp.entries.length} platos · ${exp.design.columns} col. · ${exp.design.rowStyle} · ${exp.design.theme} · ${exp.degradation.kind}${exp.files.pdf ? ' + PDF' : ''}`);
      }
    } finally {
      await browser.close();
    }
  }
  return seeds.map((s) => JSON.parse(readFileSync(join(seedDir(out, s), 'expected.json'), 'utf8')));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
      return m ? [m[1], m[2] ?? true] : [a, true];
    }),
  );
  const out = args.out ? resolve(String(args.out)) : DEFAULT_OUT;
  const seeds = seedsFor(args);
  const t0 = Date.now();
  const list = await ensureGenerated(seeds, out, { force: !!args.force, log: (m) => console.log(m) });
  const dishes = list.reduce((n, e) => n + e.entries.length, 0);
  console.log(`${list.length} cartas (${dishes} platos) en ${out} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
