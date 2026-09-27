// E2E de la PWA: service worker, manifiesto, instalación y funcionamiento sin conexión.
// Uso: node e2e/offline.mjs [baseUrl]   (contra un build de producción servido con vite preview)
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:4173/').replace(/#.*$/, '').replace(/\/?$/, '/');
const results = [];
const check = (ok, msg) => results.push({ ok: !!ok, msg });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-ES' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  // Manifiesto válido
  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  check(manifestHref, 'hay <link rel="manifest">');
  const manifest = manifestHref ? await (await page.request.get(new URL(manifestHref, BASE).toString())).json() : {};
  check(manifest.name && manifest.short_name, `manifiesto con nombre (${manifest.short_name})`);
  check(manifest.display === 'standalone', 'display standalone');
  check((manifest.icons ?? []).some((i) => i.sizes === '512x512') && (manifest.icons ?? []).some((i) => i.purpose === 'maskable'), 'iconos 512 y maskable');
  // Service worker activo y controlando
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'sin soporte';
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 15000))]);
    return reg ? 'ok' : 'timeout';
  });
  check(swReady === 'ok', `service worker listo (${swReady})`);
  await page.reload({ waitUntil: 'networkidle' });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check(controlled, 'la página está controlada por el service worker');
  // Datos de ejemplo mientras hay red
  await page.getByRole('button', { name: /ejemplo/i }).first().click({ timeout: 15000 });
  await page.waitForURL(/#\/?$/, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // Sin conexión: recargar y navegar
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  const banner = await page.getByText(/Sin conexión/i).count();
  check(banner > 0, 'muestra el aviso «Sin conexión»');
  for (const [hash, text] of [
    ['#/platos', /Escandallos|Platos/i],
    ['#/ingredientes', /Ingredientes/i],
    ['#/facturas', /Facturas/i],
    ['#/informes', /Informes|Ingeniería de menú/i],
  ]) {
    await page.goto(BASE + hash, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1200);
    const ok = (await page.getByRole('heading', { name: text }).count()) > 0;
    check(ok, `sin conexión se abre ${hash}`);
  }
  // Un escandallo concreto se calcula sin red
  await page.goto(BASE + '#/platos', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const href = await page.locator('a[href*="#/platos/"]').first().getAttribute('href');
  await page.goto(new URL(href, BASE).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const food = await page.getByText(/Food cost/i).count();
  check(food > 0, 'sin conexión el editor de escandallo muestra el food cost');
  await ctx.setOffline(false);
  check(errors.length === 0, `sin excepciones de página (${errors.join(' | ')})`);
} catch (e) {
  check(false, `Excepción: ${e.message}`);
} finally {
  await browser.close();
}
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.msg}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} comprobaciones fallidas` : 'PWA OK: funciona sin conexión');
process.exit(failed ? 1 : 0);
