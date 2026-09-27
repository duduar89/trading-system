#!/usr/bin/env node
/**
 * Genera el conjunto de prueba «unseen» (documentos que el parser no ha visto nunca) en tests/fixtures/unseen/:
 *   invoices/<id>.html  · fuente de la factura
 *   invoices/<id>.pdf   · PDF con capa de texto (Chromium, page.pdf)
 *   invoices/<id>.expected.json · verdad de referencia, calculada de los MISMOS datos que el HTML
 *   invoices/<id>.lines.json    · filas posicionales de pdf.js (mismo algoritmo que la app) para los tests unitarios
 *   menus/<id>.html, menus/<id>.jpg (captura), menus/<id>.expected.json
 *
 * Uso: node scripts/gen-unseen.mjs [--only=<texto>]
 * Es determinista: volver a ejecutarlo sólo cambia los archivos si cambian los datos o las plantillas.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INVOICES } from './unseen/invoices.mjs';
import { MENUS } from './unseen/menus.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests/fixtures/unseen');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const wanted = (id) => !only || id.includes(only);
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

mkdirSync(join(OUT, 'invoices'), { recursive: true });
mkdirSync(join(OUT, 'menus'), { recursive: true });

const { createServer } = await import('vite');
const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const layout = await server.ssrLoadModule('/src/extract/layout.ts');
const pdfMod = await server.ssrLoadModule('/src/extract/pdf.ts');
const pdfjs = await import(join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));

/** Filas de pdf.js exactamente como las construye la app (pdfItemsToFragments + buildLines). */
async function pdfLines(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const fragments = pdfMod.pdfItemsToFragments(content.items, viewport.transform);
    for (const l of layout.buildLines(fragments, p)) {
      out.push({ page: l.page, y: Math.round(l.y * 100) / 100, text: l.text, items: l.items.map((it) => ({ x: Math.round(it.x * 100) / 100, width: Math.round(it.width * 100) / 100, str: it.str })) });
    }
  }
  await doc.destroy();
  return out;
}

const { chromium } = await import('playwright');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  for (const inv of INVOICES) {
    if (!wanted(inv.id)) continue;
    const page = await browser.newPage();
    await page.setContent(inv.html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const opts = { printBackground: true };
    if (inv.page.autoHeight) {
      const h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
      Object.assign(opts, { width: inv.page.width, height: `${h + 4}px`, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    } else {
      const m = inv.page.margin ?? '12mm';
      Object.assign(opts, { format: inv.page.format, landscape: !!inv.page.landscape, margin: { top: m, right: m, bottom: m, left: m } });
    }
    const pdf = await page.pdf(opts);
    await page.close();
    writeFileSync(join(OUT, 'invoices', `${inv.id}.html`), inv.html);
    writeFileSync(join(OUT, 'invoices', `${inv.id}.pdf`), pdf);
    writeFileSync(join(OUT, 'invoices', `${inv.id}.expected.json`), `${JSON.stringify(inv.expected, null, 2)}\n`);
    writeFileSync(join(OUT, 'invoices', `${inv.id}.lines.json`), `${JSON.stringify(await pdfLines(pdf))}\n`);
    console.log(`factura ${inv.id}: ${inv.expected.lines.length} líneas, ${(pdf.length / 1024).toFixed(0)} KB`);
  }
  for (const menu of MENUS) {
    if (!wanted(menu.id)) continue;
    const page = await browser.newPage({ viewport: menu.size, deviceScaleFactor: 1 });
    await page.setContent(menu.html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 88, fullPage: false });
    await page.close();
    writeFileSync(join(OUT, 'menus', `${menu.id}.html`), menu.html);
    writeFileSync(join(OUT, 'menus', `${menu.id}.jpg`), jpg);
    writeFileSync(join(OUT, 'menus', `${menu.id}.expected.json`), `${JSON.stringify(menu.expected, null, 2)}\n`);
    console.log(`carta ${menu.id}: ${menu.expected.entries.length} platos, ${(jpg.length / 1024).toFixed(0)} KB`);
  }
} finally {
  await browser.close();
  await server.close();
}
