// Accesibilidad: axe-core en todas las pantallas (restaurante nuevo y de ejemplo), en móvil y escritorio, tema claro y
// oscuro, y también con los diálogos principales abiertos. Falla si hay incidencias graves («serious») o críticas.
//
// Uso: node e2e/a11y.mjs [baseUrl]
// axe-core: AXE_PATH=/ruta/axe.min.js, o node_modules si está instalado, o la CDN (https://cdn.jsdelivr.net/npm/axe-core@4).
// Variables: A11Y_ALL=1 muestra también las incidencias moderadas y leves.
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const BASE = (process.argv[2] ?? 'http://localhost:4173/').replace(/#.*$/, '').replace(/\/?$/, '/');
const SHOW_ALL = !!process.env.A11Y_ALL;
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const AXE_CDN = 'https://cdn.jsdelivr.net/npm/axe-core@4/axe.min.js';
/** axe-core: AXE_PATH (copia local) → node_modules → descarga desde Node → etiqueta <script> con la URL de la CDN. */
async function loadAxeSource() {
  if (process.env.AXE_PATH && existsSync(process.env.AXE_PATH)) return readFileSync(process.env.AXE_PATH, 'utf8');
  try {
    return readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    /* no instalado */
  }
  try {
    const res = await fetch(AXE_CDN);
    if (res.ok) return await res.text();
  } catch {
    /* sin red desde Node (p. ej. detrás de un proxy): lo intentará el navegador */
  }
  return undefined;
}
const axeSource = await loadAxeSource();

const ROUTES = [
  ['panel', '#/'],
  ['facturas', '#/facturas'],
  ['ingredientes', '#/ingredientes'],
  ['carta', '#/carta'],
  ['platos', '#/platos'],
  ['mermas', '#/mermas'],
  ['informes', '#/informes'],
  ['informes-precios', '#/informes?tab=precios'],
  ['informes-compras', '#/informes?tab=compras'],
  ['informes-mermas', '#/informes?tab=mermas'],
  ['informes-simulador', '#/informes?tab=simulador'],
  ['informes-exportar', '#/informes?tab=exportar'],
  ['ajustes', '#/ajustes'],
];
const DETAILS = [
  ['plato', '#/platos', 'a[href*="#/platos/"]'],
  ['factura', '#/facturas', 'a[href*="#/facturas/"]'],
  ['ingrediente', '#/ingredientes', 'a[href*="#/ingredientes/"]'],
  ['merma', '#/mermas', 'a[href*="#/mermas/"]'],
];
// Diálogos: [nombre, ruta, texto del botón que lo abre]
const DIALOGS = [
  ['nuevo-plato', '#/platos', /^Nuevo plato$/],
  ['nuevo-ingrediente', '#/ingredientes', /^Nuevo ingrediente$/],
  ['nueva-prueba', '#/mermas', /^Nueva prueba$/],
];

const failures = [];
const summary = new Map();

async function injectAxe(page) {
  if (await page.evaluate(() => typeof window.axe !== 'undefined')) return;
  if (axeSource) await page.addScriptTag({ content: axeSource });
  else await page.addScriptTag({ url: AXE_CDN });
}

async function audit(page, label) {
  await injectAxe(page);
  const result = await page.evaluate(async () => {
    // Los logotipos están exentos del requisito de contraste (WCAG 1.4.3): el «Pro» de la marca va marcado con data-logotype.
    const r = await window.axe.run({ exclude: [['[data-logotype]']] }, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      resultTypes: ['violations'],
    });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\n').slice(0, 3).join(' ') })),
      count: v.nodes.length,
    }));
  });
  for (const v of result) {
    const grave = v.impact === 'serious' || v.impact === 'critical';
    if (!grave && !SHOW_ALL) continue;
    const key = `${v.impact} · ${v.id}`;
    summary.set(key, (summary.get(key) ?? 0) + v.count);
    const line = `[${label}] ${v.impact} ${v.id} (${v.count}): ${v.help}\n${v.nodes.map((n) => `      → ${n.target}  ${n.summary ?? ''}`).join('\n')}`;
    if (grave) failures.push(line);
    else console.log(`INFO ${line}`);
  }
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(900);
}

async function run(browser, { viewport, colorScheme, tag }) {
  const ctx = await browser.newContext({ viewport, colorScheme, locale: 'es-ES', serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await settle(page);
  await audit(page, `${tag} bienvenida`);
  await page.getByRole('button', { name: /ejemplo/i }).first().click();
  await page.waitForURL(/#\/?$/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  for (const [name, hash] of ROUTES) {
    await page.goto(BASE + hash);
    await settle(page);
    await audit(page, `${tag} ${name}`);
  }
  for (const [name, hash, sel] of DETAILS) {
    await page.goto(BASE + hash);
    await settle(page);
    const href = await page.locator(sel).first().getAttribute('href').catch(() => null);
    if (!href) continue;
    await page.goto(new URL(href, BASE).toString());
    await settle(page);
    await audit(page, `${tag} ${name}`);
  }
  for (const [name, hash, label] of DIALOGS) {
    await page.goto(BASE + hash);
    await settle(page);
    const btn = page.getByRole('button', { name: label }).first();
    if (!(await btn.count())) continue;
    await btn.click();
    await page.getByRole('dialog').first().waitFor({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    await audit(page, `${tag} diálogo ${name}`);
    await page.keyboard.press('Escape');
  }
  await ctx.close();
}

/** Restaurante nuevo (sin datos): estados vacíos de todas las pantallas. */
async function runEmpty(browser, { viewport, colorScheme, tag }) {
  const ctx = await browser.newContext({ viewport, colorScheme, locale: 'es-ES', serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Empezar con mi restaurante/i }).first().click();
  await page.getByPlaceholder(/Taberna La Lonja/).fill('Casa Pepa');
  await page.getByRole('button', { name: /Crear y empezar/i }).click();
  await page.waitForURL(/#\/?$/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  for (const [name, hash] of ROUTES) {
    await page.goto(BASE + hash);
    await settle(page);
    await audit(page, `${tag} ${name}`);
  }
  await ctx.close();
}

const browser = await chromium.launch();
try {
  await runEmpty(browser, { viewport: { width: 1440, height: 900 }, colorScheme: 'light', tag: 'vacío' });
  await run(browser, { viewport: { width: 1440, height: 900 }, colorScheme: 'light', tag: 'escritorio' });
  await run(browser, { viewport: { width: 390, height: 844 }, colorScheme: 'light', tag: 'móvil' });
  await run(browser, { viewport: { width: 1440, height: 900 }, colorScheme: 'dark', tag: 'oscuro' });
} catch (e) {
  failures.push(`Excepción: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
}
for (const f of failures) console.log(`FAIL ${f}`);
console.log('\nResumen (incidencias por regla):');
for (const [k, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
console.log(failures.length ? `\n${failures.length} incidencias graves o críticas` : '\nA11Y OK: sin incidencias graves ni críticas');
process.exit(failures.length ? 1 : 0);
