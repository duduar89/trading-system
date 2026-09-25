#!/usr/bin/env node
/**
 * Banco de pruebas de la lectura LOCAL de cartas (gratis, sin IA, en el dispositivo):
 *   foto de carta → preprocesado (escala de grises, contraste, ampliación) → tesseract.js (spa) → parseMenuText (con las
 *   cajas de palabras del OCR) → comparación con los 10 platos reales de public/samples/carta-el-fogon.jpg.
 *
 * Además de la foto limpia genera variantes DEGRADADAS con Chromium (Playwright): giros de 1–3°, desenfoque, ruido y
 * compresión JPEG, baja resolución, perspectiva y una «foto de móvil» que lo combina todo.
 *
 * Uso:   node scripts/bench-menu.mjs [--verbose] [--only=giro-3] [--text-only] [--assert]
 *   --verbose     muestra los platos leídos en cada variante
 *   --only=a,b    sólo esas variantes
 *   --text-only   no pasa las cajas del OCR al parser (mide la ruta de texto plano)
 *   --assert      termina con código 1 si alguna variante baja del 95 %
 *
 * Los datos del idioma (spa) se descargan una vez y quedan en node_modules/.cache/escandallo-bench.
 */
import { chromium } from 'playwright';
import { createWorker } from 'tesseract.js';
import { runnerImport } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}`);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const verbose = flag('verbose');
const textOnly = flag('text-only');
const only = option('only')?.split(',');

const cacheDir = path.join(root, 'node_modules/.cache/escandallo-bench');
const variantsDir = path.join(cacheDir, 'menu-variants');
fs.mkdirSync(variantsDir, { recursive: true });

const expected = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/menus/bench-el-fogon.expected.json'), 'utf8'));
const sourceImage = path.join(root, expected.image);

const { module: parser } = await runnerImport(path.join(root, 'src/extract/menuParser.ts'), { root, configFile: false, logLevel: 'error' });
const { parseMenuText, mergeMenuPasses, menuQuality } = parser;

/** Variantes: transformaciones en canvas (rotate en grados, blur en px, noise = desviación típica, scale, quality JPEG). */
const VARIANTS = [
  { name: 'limpia', spec: null },
  { name: 'giro-1', spec: { rotate: 1.2 } },
  { name: 'giro-2', spec: { rotate: -2.1 } },
  { name: 'giro-3', spec: { rotate: 3 } },
  { name: 'desenfoque', spec: { blur: 1.3 } },
  { name: 'ruido-jpeg', spec: { noise: 22, quality: 0.3 } },
  { name: 'baja-res', spec: { scale: 0.5, quality: 0.7 } },
  { name: 'perspectiva', spec: { perspective: { rx: 12, ry: -9 } } },
  { name: 'foto-movil', spec: { rotate: -1.8, blur: 0.8, noise: 12, scale: 0.75, quality: 0.5, shadow: true } },
];

// ───────────────────────────── Imágenes (Chromium) ─────────────────────────────

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
await page.setContent('<!doctype html><html><body style="margin:0;background:#6b5a48"></body></html>');
const srcDataUrl = `data:image/jpeg;base64,${fs.readFileSync(sourceImage).toString('base64')}`;

function dataUrlToBuffer(url) {
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

async function makeVariant(spec) {
  if (spec.perspective) {
    // Perspectiva real con CSS 3D y captura del elemento
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#6b5a48"><div id="w" style="width:1100px;height:1250px;display:flex;align-items:center;justify-content:center;perspective:1300px;background:#6b5a48">` +
        `<img src="${srcDataUrl}" style="width:900px;transform:rotateX(${spec.perspective.rx}deg) rotateY(${spec.perspective.ry}deg)"></div></body></html>`,
    );
    await page.waitForFunction(() => document.querySelector('img')?.complete);
    return await page.locator('#w').screenshot({ type: 'jpeg', quality: 85 });
  }
  const url = await page.evaluate(
    async ({ src, spec }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = spec.scale ?? 1;
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#6b5a48';
      g.fillRect(0, 0, w, h);
      g.save();
      g.translate(w / 2, h / 2);
      if (spec.rotate) g.rotate((spec.rotate * Math.PI) / 180);
      if (spec.blur) g.filter = `blur(${spec.blur * scale}px)`;
      g.drawImage(img, -w / 2, -h / 2, w, h);
      g.restore();
      if (spec.shadow) {
        const grad = g.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.28)');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      }
      if (spec.noise) {
        const d = g.getImageData(0, 0, w, h);
        let seed = 12345;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        for (let i = 0; i < d.data.length; i += 4) {
          const n = (rnd() + rnd() + rnd() - 1.5) * spec.noise * 1.4;
          d.data[i] += n;
          d.data[i + 1] += n;
          d.data[i + 2] += n;
        }
        g.putImageData(d, 0, 0);
      }
      return c.toDataURL('image/jpeg', spec.quality ?? 0.9);
    },
    { src: srcDataUrl, spec },
  );
  return dataUrlToBuffer(url);
}

/**
 * Preprocesado equivalente al de la app (src/extract/ocr.ts → preprocessImage): escala de grises, estiramiento de
 * contraste por percentiles y ampliación para que el texto tenga altura suficiente para el OCR.
 */
async function preprocess(buffer, target = Number(option('target') ?? 1800), sharpen = Number(option('sharpen') ?? 0)) {
  const url = await page.evaluate(
    async ({ src, target, sharpen }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const long = Math.max(img.naturalWidth, img.naturalHeight);
      const s = Math.min(3, Math.max(1, target / long));
      const w = Math.round(img.naturalWidth * s);
      const h = Math.round(img.naturalHeight * s);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h);
      const px = d.data;
      let gray = new Float32Array(w * h);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (sharpen > 0) {
        // Máscara de enfoque: gris + k · (gris − desenfoque 3×3)
        const out = new Float32Array(w * h);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            let acc = 0;
            let n = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const yy = y + dy;
                const xx = x + dx;
                if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
                acc += gray[yy * w + xx];
                n++;
              }
            const v = gray[y * w + x];
            out[y * w + x] = v + sharpen * (v - acc / n);
          }
        gray = out;
      }
      const hist = new Uint32Array(256);
      for (let j = 0; j < gray.length; j++) hist[Math.max(0, Math.min(255, Math.round(gray[j])))]++;
      const total = w * h;
      let lo = 0;
      let hi = 255;
      for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.01; lo++);
      for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.01; hi--);
      const span = Math.max(1, hi - lo);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        const v = Math.max(0, Math.min(255, ((gray[j] - lo) * 255) / span));
        px[i] = px[i + 1] = px[i + 2] = v;
      }
      g.putImageData(d, 0, 0);
      return c.toDataURL('image/png');
    },
    { src: `data:image/jpeg;base64,${buffer.toString('base64')}`, target, sharpen },
  );
  return dataUrlToBuffer(url);
}

// ───────────────────────────── OCR ─────────────────────────────

const worker = await createWorker('spa', 1, { cachePath: cacheDir });

async function ocr(buffer, psm) {
  await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1', user_defined_dpi: '300' });
  const r = await worker.recognize(buffer, {}, { text: true, blocks: true });
  const words = [];
  const confs = [];
  for (const b of r.data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines)
        for (const wd of l.words) {
          words.push({ text: wd.text, bbox: wd.bbox, confidence: wd.confidence, baseline: l.baseline });
          confs.push(wd.confidence);
        }
  return { text: r.data.text, words, confidence: confs.length ? confs.reduce((s, c) => s + c, 0) / confs.length : 0 };
}

// ───────────────────────────── Evaluación ─────────────────────────────

const key = (s) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();

function score(menu) {
  const rows = expected.entries.map((exp) => {
    const got = menu.entries.find((e) => key(e.name) === key(exp.name));
    const priceOk = !!got && got.price !== undefined && Math.abs(got.price - exp.price) < 0.001;
    const sectionOk = !!got && key(got.section) === key(exp.section);
    const descOk = !!got && (exp.description ? key(got.description) === key(exp.description) : !got.description);
    const exact = !!got && got.name === exp.name;
    return { exp, got, ok: !!got && priceOk, priceOk, sectionOk, descOk, exact };
  });
  const matched = new Set(rows.filter((r) => r.got).map((r) => r.got));
  const extras = menu.entries.filter((e) => !matched.has(e));
  return { rows, extras, correct: rows.filter((r) => r.ok).length, full: rows.filter((r) => r.ok && r.sectionOk && r.descOk && r.exact).length };
}

const PASSES = ['6', '11', '4'];
const results = [];
const t0 = Date.now();
for (const v of VARIANTS) {
  if (only && !only.includes(v.name)) continue;
  const raw = v.spec ? await makeVariant(v.spec) : fs.readFileSync(sourceImage);
  fs.writeFileSync(path.join(variantsDir, `${v.name}.jpg`), raw);
  const img = await preprocess(raw);
  // Como en la app: varias pasadas de OCR (PSM 6 = bloque uniforme, 11 = texto disperso, 4 = una columna), se elige la de
  // mayor calidad estimada (sin conocer la verdad) y se completa con las demás.
  const passes = [];
  const tv = Date.now();
  for (const psm of PASSES) {
    const o = await ocr(img, psm);
    const menu = textOnly ? parseMenuText(o.text, 'ocr') : parseMenuText(o.text, 'ocr', o.words);
    passes.push({ psm, menu, o, q: menuQuality(menu) });
    const priced = menu.entries.filter((e) => e.price !== undefined).length;
    if (passes.length >= 2 && priced >= 8 && passes.some((p) => p !== passes.at(-1) && p.menu.entries.filter((e) => e.price !== undefined).length >= 8)) break;
  }
  passes.sort((a, b) => b.q - a.q);
  const merged = mergeMenuPasses(passes.map((p) => p.menu));
  const top = passes[0];
  const best = { psm: passes.map((p) => p.psm).join('+'), menu: merged, s: score(merged), conf: top.o.confidence, ms: Date.now() - tv, text: top.o.text, words: top.o.words };
  results.push({ name: v.name, ...best });
  fs.writeFileSync(path.join(variantsDir, `${v.name}.ocr.json`), JSON.stringify({ psm: best.psm, text: best.text, words: best.words }));
  if (verbose) {
    console.log(`\n── ${v.name} (PSM ${best.psm}, OCR ${best.conf.toFixed(0)} %)`);
    for (const e of best.menu.entries) console.log(`   [${e.section ?? '—'}] ${e.name} | ${e.price ?? '—'} | ${e.description ?? ''} | ${e.confidence}`);
    for (const r of best.s.rows.filter((x) => !x.ok || !x.sectionOk || !x.descOk || !x.exact))
      console.log(`   ✗ ${r.exp.name}: ${r.got ? `precio ${r.got.price} sección ${r.got.section} desc «${r.got.description ?? ''}» nombre «${r.got.name}»` : 'no encontrado'}`);
    if (best.menu.warnings.length) console.log(`   avisos: ${best.menu.warnings.join(' · ')}`);
  }
}
await worker.terminate();
await browser.close();

// ───────────────────────────── Informe ─────────────────────────────

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nLectura local de cartas — ${expected.entries.length} platos esperados — ruta: ${textOnly ? 'texto plano' : 'cajas de palabras del OCR'}`);
console.log(`${pad('Variante', 13)}${pad('PSM', 5)}${pad('Plato+precio', 14)}${pad('Sección', 9)}${pad('Descr.', 8)}${pad('Exacto', 8)}${pad('Extra', 7)}${pad('Precisión', 11)}Tiempo`);
let allOk = true;
let sum = 0;
for (const r of results) {
  const n = expected.entries.length;
  const acc = (100 * r.s.correct) / n;
  sum += acc;
  if (acc < 95) allOk = false;
  console.log(
    `${pad(r.name, 13)}${pad(r.psm, 5)}${pad(`${r.s.correct}/${n}`, 14)}${pad(`${r.s.rows.filter((x) => x.sectionOk).length}/${n}`, 9)}${pad(`${r.s.rows.filter((x) => x.descOk).length}/${n}`, 8)}${pad(`${r.s.full}/${n}`, 8)}${pad(r.s.extras.length, 7)}${pad(`${acc.toFixed(1)} %`, 11)}${(r.ms / 1000).toFixed(1)} s`,
  );
}
console.log(`Media: ${(sum / Math.max(1, results.length)).toFixed(1)} % · total ${((Date.now() - t0) / 1000).toFixed(0)} s · variantes en ${path.relative(root, variantsDir)}`);
if (flag('assert') && !allOk) process.exit(1);
