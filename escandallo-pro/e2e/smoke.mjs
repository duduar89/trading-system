// Prueba de humo E2E: carga el restaurante de ejemplo y recorre todas las pantallas
// en móvil y escritorio, recogiendo errores de consola y capturas.
// Uso: node e2e/smoke.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const OUT = process.argv[3] ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch();

async function run(viewport, tag, colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme, locale: 'es-ES' });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/${tag}-00-bienvenida.png`, fullPage: true });
  const demoBtn = page.getByRole('button', { name: /ejemplo/i }).first();
  await demoBtn.click();
  await page.waitForURL(/#\/?$/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const routes = [
    ['01-panel', '#/'],
    ['02-facturas', '#/facturas'],
    ['03-ingredientes', '#/ingredientes'],
    ['04-carta', '#/carta'],
    ['05-platos', '#/platos'],
    ['06-mermas', '#/mermas'],
    ['07-informes', '#/informes'],
    ['08-ajustes', '#/ajustes'],
  ];
  for (const [name, hash] of routes) {
    await page.goto(BASE + hash, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${tag}-${name}.png`, fullPage: true });
  }
  // Detalles: primer plato, primera factura, primer ingrediente, primera prueba de merma
  const details = [
    ['09-plato', '#/platos', 'a[href*="#/platos/"]'],
    ['10-factura', '#/facturas', 'a[href*="#/facturas/"]'],
    ['11-ingrediente', '#/ingredientes', 'a[href*="#/ingredientes/"]'],
    ['12-merma', '#/mermas', 'a[href*="#/mermas/"]'],
  ];
  for (const [name, hash, sel] of details) {
    await page.goto(BASE + hash, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const link = page.locator(sel).first();
    if (await link.count()) {
      const href = await link.getAttribute('href');
      await page.goto(new URL(href, BASE).toString(), { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/${tag}-${name}.png`, fullPage: true });
    } else {
      errors.push(`[${tag}] sin enlace de detalle en ${hash} (${sel})`);
    }
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) errors.push(`[${tag}] scroll horizontal en ${page.url()}`);
  await ctx.close();
}

await run({ width: 1440, height: 900 }, 'desk');
await run({ width: 390, height: 844 }, 'movil');
await run({ width: 1440, height: 900 }, 'oscuro', 'dark');
await browser.close();
console.log(errors.length ? errors.join('\n') : 'SIN ERRORES');
