// E2E «foto de la carta → platos → escandallo → mermas» como usuario nuevo (sin demo), 100 % local (IA desactivada).
//
// 1. Restaurante nuevo · 2. Foto de la carta → OCR local → revisión y edición · 3. Importar con receta propuesta
// 4. Facturas → precios reales y revinculación · 5. Editor del solomillo (bases, mermas, PVP, raciones, autoguardado)
// 6. Elaboración usada por ml · 7. Prueba de rendimiento enlazada · 8. Ficha técnica impresa · 9. Móvil 390×844.
//
// Uso: node e2e/carta.mjs [baseUrl] [outDir]
//   baseUrl  URL de la app compilada servida con `vite preview` (por defecto http://localhost:4173/)
//   outDir   carpeta para capturas y volcados (por defecto e2e/screenshots/carta)
// Variables: E2E_OCR_NETWORK=1 descarga el OCR de la CDN en vez de servirlo desde node_modules;
//            E2E_HEADED=1 abre el navegador visible; E2E_MAX_MIN=minutos máximos de la prueba completa (25 por defecto);
//            E2E_CPU_THROTTLE=4 ralentiza la CPU de la página (móvil lento).
// Imprime PASS/FAIL por paso según avanza y termina con código ≠ 0 si algo falla. Todas las esperas están acotadas.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] ?? 'http://localhost:4173/').replace(/#.*$/, '').replace(/\/?$/, '/');
const OUT = path.resolve(process.argv[3] ?? path.join(ROOT, 'e2e/screenshots/carta'));
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^FALLO-.*\.png$/.test(f)) fs.rmSync(path.join(OUT, f)); // capturas de fallos de otra ejecución
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';

const OCR_TIMEOUT = 5 * 60_000; // lectura local de la foto de la carta
const STEP_TIMEOUT = 6 * 60_000; // tope de cada paso (si se supera, se aborta el resto: el estado ya no es fiable)
const TOTAL_TIMEOUT = Number(process.env.E2E_MAX_MIN || 25) * 60_000;

// ───────────────────────────── Utilidades ─────────────────────────────

const results = [];
let failures = [];
const consoleErrors = [];
const log = (m) => process.stdout.write(`${m}\n`);

function check(cond, msg) {
  if (!cond) failures.push(msg);
  return !!cond;
}
function near(a, b, tol = 0.011) {
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
}
/** "1.234,56 €" → 1234.56 */
function num(text) {
  if (text == null) return undefined;
  const m = String(text)
    .replace(/\u00a0/g, ' ')
    .match(/-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?/);
  return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : undefined;
}
function norm(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

class StepTimeout extends Error {}
let aborted = false;

/**
 * Ejecuta un paso con tope de tiempo. Las comprobaciones son blandas (se anotan y el paso sigue); una excepción corta el
 * paso. `critical`: si falla, los pasos siguientes no tienen sentido y se aborta. Un tope agotado también aborta.
 */
async function step(name, fn, { critical = false, timeout = STEP_TIMEOUT } = {}) {
  if (aborted) {
    results.push({ name, ok: false, failures: ['no ejecutado (prueba abortada)'] });
    log(`SKIP  ${name}`);
    return;
  }
  failures = [];
  const t0 = Date.now();
  log(`…     ${name}`);
  let timer;
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new StepTimeout(`tiempo del paso agotado (${Math.round(timeout / 1000)} s)`)), timeout);
      }),
    ]);
  } catch (e) {
    failures.push(`excepción: ${e?.message?.split('\n')[0] ?? e}`);
    if (e instanceof StepTimeout) aborted = true;
  } finally {
    clearTimeout(timer);
  }
  const ok = failures.length === 0;
  if (!ok)
    await page
      ?.screenshot({ path: path.join(OUT, `FALLO-${name.replace(/[^\w]+/g, '-').slice(0, 40)}.png`), fullPage: true, timeout: 15_000 })
      .catch(() => undefined);
  if (!ok && critical) aborted = true;
  results.push({ name, ok, failures: [...failures] });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const f of failures) log(`      - ${f}`);
}

// Tope global: pase lo que pase, la prueba termina (con código ≠ 0) y lo dice.
const watchdog = setTimeout(() => {
  log(`\nABORTADO: la prueba completa ha superado ${(TOTAL_TIMEOUT / 60_000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} min`);
  process.exit(3);
}, TOTAL_TIMEOUT);
watchdog.unref();

const browser = await chromium.launch({ headless: !process.env.E2E_HEADED, timeout: 60_000 });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'es-ES',
  timezoneId: 'Europe/Madrid',
  serviceWorkers: 'block',
  acceptDownloads: true,
});
ctx.setDefaultTimeout(15_000);
ctx.setDefaultNavigationTimeout(30_000);

// Tesseract (worker, núcleo WASM y datos del español): se sirven desde node_modules si están, para que la prueba no dependa de la red.
if (process.env.E2E_OCR_NETWORK !== '1') {
  const nm = path.join(ROOT, 'node_modules');
  const lang = [path.join(nm, '.cache/escandallo-tessdata/spa.traineddata'), path.join(nm, '.cache/escandallo-bench/spa.traineddata')].find((f) =>
    fs.existsSync(f),
  );
  const types = { js: 'text/javascript', wasm: 'application/wasm', gz: 'application/octet-stream', traineddata: 'application/octet-stream' };
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\//, async (route) => {
    const url = new URL(route.request().url());
    let file;
    let m;
    if ((m = /^\/npm\/tesseract\.js@[^/]+\/dist\/(.+)$/.exec(url.pathname))) file = path.join(nm, 'tesseract.js/dist', m[1]);
    else if ((m = /^\/npm\/tesseract\.js-core@[^/]+\/(.+)$/.exec(url.pathname))) file = path.join(nm, 'tesseract.js-core', m[1]);
    else if (/^\/npm\/@tesseract\.js-data\/spa\/[^/]+\/spa\.traineddata(\.gz)?$/.test(url.pathname)) file = lang;
    if (!file || !fs.existsSync(file)) return route.continue();
    const ext = file.split('.').pop();
    await route.fulfill({
      status: 200,
      body: fs.readFileSync(file),
      headers: { 'content-type': types[ext] ?? 'application/octet-stream', 'access-control-allow-origin': '*' },
    });
  });
}

const page = await ctx.newPage();
// E2E_CPU_THROTTLE=4 simula un móvil lento (para destapar esperas mal sincronizadas).
if (Number(process.env.E2E_CPU_THROTTLE) > 1) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.E2E_CPU_THROTTLE) });
}
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon|Download the React DevTools/i.test(t)) return;
  consoleErrors.push(t.slice(0, 300));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));

const shot = (name, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', timeout: 20_000, ...opts });
const go = async (hash) => {
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
};

/** Espera acotada a que `fn` devuelva algo verdadero (lo devuelve); si no llega, lanza un error claro. */
async function until(fn, { timeout = 20_000, interval = 400, what = 'la condición' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (last) return last;
    await page.waitForTimeout(interval);
  }
  throw new Error(`tiempo agotado (${Math.round(timeout / 1000)} s) esperando ${what}`);
}

/** Promesa con tope de tiempo (page.evaluate no tiene timeout propio). */
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`tiempo agotado (${Math.round(ms / 1000)} s) ${what}`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Lee todos los registros de un almacén de la BD del restaurante activo (IndexedDB directo). */
async function idb(store) {
  return withTimeout(idbRead(store), 15_000, `leyendo «${store}» de IndexedDB`);
}
async function idbRead(store) {
  return page.evaluate(async (store) => {
    const open = (name) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error(`IndexedDB «${name}» bloqueada`));
        // Nunca crear una BD vacía: si no existía, se aborta la apertura.
        r.onupgradeneeded = () => {
          r.transaction?.abort();
          rej(new Error(`IndexedDB «${name}» no existe todavía`));
        };
      });
    const all = (db, s) =>
      new Promise((res, rej) => {
        const r = db.transaction(s, 'readonly').objectStore(s).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const meta = await open('escandallo-meta');
    const settings = await all(meta, 'settings');
    meta.close();
    const app = settings.find((x) => x.id === 'app');
    if (store === '__settings') return [app];
    if (!app?.currentWorkspaceId) return [];
    const db = await open(`escandallo-ws-${app.currentWorkspaceId}`);
    const rows = await all(db, store);
    db.close();
    return rows.map((r) => {
      const { file: _f, images: _i, ...rest } = r;
      return rest;
    });
  }, store);
}

/** Sin scroll horizontal: anota el fallo con los elementos que se salen. */
async function noHorizontalOverflow(label) {
  const o = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const offenders = [];
    if (document.documentElement.scrollWidth > w + 1) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > w + 1 && getComputedStyle(el).position !== 'fixed') {
          const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
          offenders.push(`${el.tagName.toLowerCase()}.${cls} (${Math.round(r.right)}px)`);
          if (offenders.length >= 4) break;
        }
      }
    }
    return { sw: document.documentElement.scrollWidth, w, offenders };
  });
  check(o.sw <= o.w + 1, `${label}: scroll horizontal (${o.sw}px > ${o.w}px): ${o.offenders.join(', ')}`);
}

/** El elemento está dentro de la ventana y no lo tapa nada (barra inferior, avisos…). */
async function reachable(locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
  const box = await locator.boundingBox();
  if (!box) return false;
  const vp = page.viewportSize();
  if (box.y < 0 || box.y + box.height > vp.height + 1 || box.x < 0 || box.x + box.width > vp.width + 1) return false;
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (el === hit || el.contains(hit));
  });
}

const eurFmt = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 12,3 → "12,30 €" (como lib/format, con espacios normalizados). */
const fmtE = (v) => norm(eurFmt.format(v));

// ───────────────────────────── Datos esperados ─────────────────────────────

const EXPECTED = [
  ['Patatas bravas', 'para picar', 6.5],
  ['Croquetas caseras de jamón (6 uds)', 'para picar', 9],
  ['Pulpo a la gallega', 'para picar', 19.5, 'Con cachelos, pimentón de la Vera y aceite de oliva virgen extra'],
  ['Gambas al ajillo', 'para picar', 14],
  ['Solomillo de ternera a la pimienta', 'principales', 24, 'Con patatas panaderas'],
  ['Secreto ibérico a la brasa', 'principales', 18.5],
  ['Merluza en salsa verde', 'principales', 21, 'Con almejas y espárragos'],
  ['Arroz negro con alioli', 'principales', 17],
  ['Tarta de queso al horno', 'postres', 6.5],
  ['Torrija caramelizada con helado', 'postres', 7],
];
const SOLOMILLO = 'Solomillo de ternera a la pimienta';
const state = {};

/** Tarjetas de /platos: nombre → métricas visibles. */
async function readCards() {
  return page.evaluate(() => {
    const out = {};
    for (const art of document.querySelectorAll('article')) {
      const name = art.querySelector('h3')?.textContent?.trim();
      if (!name) continue;
      const metric = (label) =>
        [...art.querySelectorAll('dt')].find((dt) => dt.textContent.trim().toLowerCase() === label)?.nextElementSibling?.textContent?.trim();
      out[name] = {
        pvp: metric('pvp'),
        cost: metric('coste'),
        margin: metric('margen'),
        text: art.innerText,
        allergens: [...art.querySelectorAll('[title]')].map((el) => el.getAttribute('title')).filter(Boolean),
      };
    }
    return out;
  });
}

async function dishByName(name) {
  return (await idb('dishes')).find((d) => d.name === name);
}

// ───────────────────────────── Verificación independiente de las fórmulas ─────────────────────────────
// Réplica mínima de ARCHITECTURE.md / core/yield.ts para comprobar lo que pinta la app (no importa el código de la app).

const UNITS = { kg: ['kg', 1], g: ['kg', 0.001], mg: ['kg', 1e-6], l: ['l', 1], dl: ['l', 0.1], cl: ['l', 0.01], ml: ['l', 0.001], ud: ['ud', 1], docena: ['ud', 12] };
function toBase(qty, unit, base, p = {}) {
  const u = UNITS[unit];
  if (!u) throw new Error(`unidad ${unit} no cubierta por la verificación`);
  const v = qty * u[1];
  if (u[0] === base) return v;
  if (u[0] === 'l' && base === 'kg') return v * (p.densityKgPerL || 1);
  if (u[0] === 'kg' && base === 'l') return v / (p.densityKgPerL || 1);
  if (u[0] === 'ud' && base === 'kg' && p.unitWeightKg) return v * p.unitWeightKg;
  if (u[0] === 'kg' && base === 'ud' && p.unitWeightKg) return v / p.unitWeightKg;
  throw new Error(`conversión ${unit} → ${base} no cubierta por la verificación`);
}
function toKg(q, base, p = {}) {
  if (base === 'kg') return q;
  if (base === 'l') return q * (p.densityKgPerL || 1);
  return p.unitWeightKg ? q * p.unitWeightKg : undefined;
}
/** bruto = neto / (1 − w); servido = neto · (1 − k) */
function applyWaste(q, basis, w, k) {
  const yc = 1 - w / 100;
  const yk = 1 - k / 100;
  if (basis === 'bruta') return { gross: q, net: q * yc, served: q * yc * yk };
  if (basis === 'cocinada') return { gross: q / yk / yc, net: q / yk, served: q };
  return { gross: q / yc, net: q, served: q * yk };
}
/** core/yield: coste €/kg útil = (G·p − valor subproductos) / P; merma total = 1 − P/G */
function yieldOf(t, price) {
  const G = t.grossWeightKg;
  let P = 0;
  let value = 0;
  for (const o of t.outputs) {
    if (o.kind === 'principal') P += o.weightKg;
    else if (o.kind === 'subproducto') value += o.weightKg * (o.valuePerKg ?? 0);
  }
  value = Math.min(value, G * price);
  return { P, G, wastePct: 100 - (P / G) * 100, costPerUsableKg: (G * price - value) / P, cook: t.cookingLossPct ?? 0 };
}
function expectedCost(dishId, data) {
  const dish = data.dishes.get(dishId);
  const lines = [];
  for (const it of dish.items) {
    const line = { id: it.id, name: it.name, cost: 0, gross: 0, net: 0, served: 0, grossKg: 0, servedKg: 0 };
    lines.push(line);
    if (!it.ref || !(it.quantity > 0)) continue;
    if (it.ref.type === 'dish') {
      const sub = data.dishes.get(it.ref.id);
      const subCost = expectedCost(sub.id, data);
      const q = toBase(it.quantity, it.unit, sub.yieldUnit);
      Object.assign(line, applyWaste(q, it.basis, it.wastePct ?? 0, it.cookingLossPct ?? 0), { price: subCost.total / sub.yieldQty, base: sub.yieldUnit });
      line.cost = line.gross * line.price;
    } else {
      const p = data.products.get(it.ref.id);
      const q = toBase(it.quantity, it.unit, p.baseUnit, p);
      const testId = it.yieldTestId ?? (it.wastePct == null ? p.yieldTestId : undefined);
      const test = testId && data.tests.get(testId);
      const y = test && yieldOf(test, p.baseUnit === 'kg' && p.pricePerBase > 0 ? p.pricePerBase : test.purchasePricePerKg);
      const w = y ? y.wastePct : (it.wastePct ?? p.wastePct ?? 0);
      const k = it.cookingLossPct ?? (y ? y.cook : (p.cookingLossPct ?? 0));
      Object.assign(line, applyWaste(q, it.basis, w, k), { price: p.pricePerBase, base: p.baseUnit, yield: y, w, k });
      line.cost = y && p.baseUnit === 'kg' ? line.net * y.costPerUsableKg : line.gross * p.pricePerBase;
      line.grossKg = toKg(line.gross, p.baseUnit, p) ?? 0;
      line.servedKg = toKg(line.served, p.baseUnit, p) ?? 0;
      continue;
    }
    line.grossKg = toKg(line.gross, line.base) ?? 0;
    line.servedKg = toKg(line.served, line.base) ?? 0;
  }
  const total = lines.reduce((s, l) => s + l.cost, 0);
  const portions = dish.portions > 0 ? dish.portions : 1;
  const grossKg = lines.reduce((s, l) => s + l.grossKg, 0);
  const servedKg = lines.reduce((s, l) => s + l.servedKg, 0);
  return { total, perPortion: total / portions, lines, wasteKgPerPortion: (grossKg - servedKg) / portions, portions };
}
async function loadData() {
  const [dishes, products, tests] = await Promise.all([idb('dishes'), idb('products'), idb('yieldTests')]);
  return { dishes: new Map(dishes.map((d) => [d.id, d])), products: new Map(products.map((p) => [p.id, p])), tests: new Map(tests.map((t) => [t.id, t])) };
}

/** Valor visible de una tarjeta de KPI del editor (por su etiqueta, sin la transformación a mayúsculas del CSS). */
async function kpi(label) {
  return page.evaluate((label) => {
    const el = [...document.querySelectorAll('.no-print div.uppercase')].find((d) => d.textContent.trim() === label);
    const tile = el?.parentElement;
    if (!tile) return undefined;
    const input = tile.querySelector('input');
    return { value: input ? input.value : (tile.children[1]?.textContent ?? '').trim(), hint: (tile.children[2]?.textContent ?? '').trim() };
  }, label);
}
/** Fila del escandallo (tabla de escritorio) por posición 1…n. */
async function row(n) {
  const tr = page.locator('tbody tr').filter({ has: page.getByRole('combobox', { name: `Ingrediente ${n}`, exact: true }) });
  const tds = tr.locator('td');
  return {
    tr,
    gross: num(await tds.nth(5).locator('div').nth(0).innerText()),
    served: num(await tds.nth(5).locator('div').nth(1).innerText()),
    cost: num(await tds.nth(7).locator('div').first().innerText()),
  };
}
/** Alta de plato/elaboración: espera a que el diálogo ponga el foco en «Nombre» antes de escribir en sus campos. */
async function focusedName(modal) {
  const name = modal.getByLabel('Nombre');
  await name.waitFor({ timeout: 10_000 });
  await until(async () => name.evaluate((el) => el === document.activeElement), { timeout: 5_000, interval: 50, what: 'el foco en el nombre del diálogo' });
}

/** Tras editar en el escandallo: espera a que el autoguardado termine («Guardando…» desaparece) y a que se repinte. */
async function settle() {
  await page.waitForTimeout(150);
  await page
    .getByText('Guardando…')
    .first()
    .waitFor({ state: 'hidden', timeout: 10_000 })
    .catch(() => check(false, 'el autoguardado no ha terminado en 10 s'));
  await page.waitForTimeout(250);
}
const itemIndex = (dish, name) => dish.items.findIndex((i) => i.name === name) + 1;

// ───────────────────────────── Pasos ─────────────────────────────

await step(
  '1. Contexto nuevo → crear restaurante «Taberna E2E»',
  async () => {
    await go('');
    const start = page.getByRole('button', { name: /Empezar con mi restaurante/i }).first();
    await start.waitFor({ timeout: 30_000 });
    await start.click();
    await page.getByLabel(/Nombre del restaurante/i).fill('Taberna E2E');
    await page.getByRole('button', { name: /Crear y empezar/i }).click();
    await page.getByRole('heading', { name: /Taberna E2E/ }).first().waitFor({ timeout: 20_000 });
    await shot('01-panel');
    const [settings] = await idb('__settings');
    check(settings && settings.aiEnabled !== true, 'la IA opcional debe estar desactivada por defecto');
    check(!settings?.apiKey, 'no debe haber clave de API');
    check((await idb('products')).length === 0 && (await idb('dishes')).length === 0, 'un restaurante nuevo no debe traer datos');
  },
  { critical: true },
);

await step('2. /carta: foto → OCR local → revisión (10 platos, secciones, PVP, descripciones) y edición', async () => {
  await go('#/carta');
  const body = await page.locator('main').innerText();
  check(/gratis/i.test(body) && /dispositivo/i.test(body), '/carta debe anunciar lectura gratis en el dispositivo');
  check(!/clave de api|api key/i.test(body), '/carta no debe pedir clave de API');
  const t0 = Date.now();
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles(path.join(ROOT, 'public/samples/carta-el-fogon.jpg'));
  await page.waitForURL(/#\/carta\/[^/?]+/, { timeout: 30000 });
  await shot('02a-leyendo');
  // Lectura local: termina en la revisión o en un error (p. ej. sin el motor de OCR); nunca se espera en vano.
  const ready = page.getByRole('button', { name: /^Importar \d+ plato/ });
  const failed = page.getByText('No hemos podido leer esta carta');
  await ready.or(failed).first().waitFor({ timeout: OCR_TIMEOUT });
  if (await failed.isVisible().catch(() => false)) {
    throw new Error(`la lectura local de la carta ha fallado: ${norm(await page.locator('main').innerText()).slice(0, 300)}`);
  }
  state.ocrSecs = (Date.now() - t0) / 1000;
  state.scanUrl = page.url();
  await page.waitForTimeout(600);
  await shot('02b-revision', { fullPage: true });

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('section[aria-label] li')].map((li) => ({
      group: li.closest('section')?.getAttribute('aria-label'),
      name: li.querySelector('input[aria-label="Nombre del plato"]')?.value,
      desc: li.querySelector('input[aria-label="Descripción del plato"]')?.value,
      section: li.querySelector('input[aria-label="Sección"]')?.value,
      price: li.querySelector('input[aria-label^="PVP"]')?.value,
    })),
  );
  check(rows.length === 10, `se esperaban 10 platos y hay ${rows.length}`);
  EXPECTED.forEach(([name, section, price, desc], i) => {
    const r = rows[i];
    if (!check(r, `falta el plato ${name}`)) return;
    check(r.name === name, `plato ${i + 1}: «${r.name}» ≠ «${name}»`);
    check((r.section ?? '').toLowerCase() === section && (r.group ?? '').toLowerCase() === section, `«${name}»: sección «${r.section}» ≠ «${section}»`);
    check(near(num(r.price), price), `«${name}»: PVP ${r.price} ≠ ${price}`);
    check((r.desc || undefined) === desc, `«${name}»: descripción «${r.desc}» ≠ «${desc ?? ''}»`);
  });

  // Editar un precio, deseleccionar un plato y añadir otro a mano.
  const torrija = page.getByLabel('PVP de Torrija caramelizada con helado');
  await torrija.fill('7,50');
  await torrija.blur();
  await page.getByRole('checkbox', { name: 'Importar Secreto ibérico a la brasa' }).click();
  check(
    (await page.getByRole('checkbox', { name: /toda la sección Principales/ }).getAttribute('aria-checked')) === 'mixed',
    'con un plato quitado, la casilla de la sección «Principales» debe quedar en estado parcial',
  );
  await page.getByRole('button', { name: 'Añadir plato en Postres' }).click();
  const fresh = page.locator('section[aria-label="Postres"] li').last();
  await fresh.getByLabel('Nombre del plato').fill('Flan de huevo casero');
  await fresh.getByLabel(/^PVP de/).fill('5,50');
  await fresh.getByLabel('Descripción del plato').fill('Con nata montada');
  await fresh.getByLabel(/^PVP de/).blur();
  await until(async () => (await idb('menuScans'))[0]?.entries.some((e) => e.name === 'Flan de huevo casero' && e.price === 5.5 && e.description), {
    what: 'el autoguardado de la revisión de la carta',
  });
  check(/Importar 10 platos/.test(await page.getByRole('button', { name: /^Importar \d+ plato/ }).innerText()), 'el botón debe ofrecer importar 10 platos (10 − 1 + 1)');
  const [scan] = await idb('menuScans');
  const byName = new Map(scan.entries.map((e) => [e.name, e]));
  check(byName.get('Torrija caramelizada con helado')?.price === 7.5, 'el PVP editado (7,50) debe guardarse');
  check(byName.get('Secreto ibérico a la brasa')?.selected === false, 'el plato deseleccionado debe guardarse');
  const flan = byName.get('Flan de huevo casero');
  check(flan && flan.selected && flan.price === 5.5 && /postres/i.test(flan.section ?? ''), 'el plato añadido a mano debe guardarse con PVP y sección');
  await shot('02c-revision-editada', { fullPage: true });
}, { critical: true, timeout: OCR_TIMEOUT + 2 * 60_000 });

await step('3. Importar con propuesta de ingredientes + crear los que faltan → /platos?recientes=1', async () => {
  const bar = page.locator('div.sticky').filter({ has: page.getByRole('button', { name: /^Importar \d+ plato/ }) });
  const switches = bar.getByRole('switch');
  check((await switches.count()) === 2, 'la barra de importación debe tener 2 interruptores');
  check((await switches.nth(0).getAttribute('aria-checked')) === 'true', '«Proponer ingredientes» debe venir activado');
  check((await switches.nth(1).getAttribute('aria-checked')) === 'true', '«Crear ingredientes que faltan» debe venir activado');
  await page.getByRole('button', { name: /^Importar \d+ plato/ }).click();
  const modal = page.getByRole('dialog');
  await modal.waitFor({ timeout: 5000 }).then(
    () => shot('03a-importando'),
    () => check(false, 'no se ha visto el modal de progreso'),
  );
  await page.waitForURL(/#\/platos\?.*recientes=1/, { timeout: 3 * 60_000 });
  await page.waitForTimeout(1500);
  await shot('03b-platos-recientes', { fullPage: true });
}, { critical: true });

await step('3b. Escandallos propuestos: líneas vinculadas y en violeta, precio estimado, food cost y alérgenos', async () => {
  await go('#/platos?recientes=1');
  const cards = await readCards();
  const names = Object.keys(cards);
  const expectedNames = EXPECTED.map((e) => e[0]).filter((n) => n !== 'Secreto ibérico a la brasa').concat('Flan de huevo casero');
  check(names.length === expectedNames.length, `se esperaban ${expectedNames.length} platos en /platos y hay ${names.length}`);
  for (const n of expectedNames) check(cards[n], `falta «${n}» en /platos`);
  check(!cards['Secreto ibérico a la brasa'], 'el plato deseleccionado no debe importarse');
  check(near(num(cards['Torrija caramelizada con helado']?.pvp), 7.5), `la torrija debe tener el PVP editado (7,50 €): ${cards['Torrija caramelizada con helado']?.pvp}`);
  const dishes = await idb('dishes');
  const products = new Map((await idb('products')).map((p) => [p.id, p]));
  state.estimatedBefore = [...products.values()].filter((p) => /Precio estimado/.test(p.notes ?? '')).map((p) => p.name);
  check(state.estimatedBefore.length > 10, `deben crearse ingredientes con precio estimado (hay ${state.estimatedBefore.length})`);
  for (const d of dishes) {
    check(d.items.length >= 3, `«${d.name}»: receta propuesta con ${d.items.length} líneas`);
    const unlinked = d.items.filter((i) => !i.ref);
    check(unlinked.length === 0, `«${d.name}»: líneas sin vincular: ${unlinked.map((i) => i.name).join(', ')}`);
    check(d.items.every((i) => i.suggested), `«${d.name}»: todas las líneas deben venir como propuesta (violeta)`);
    const c = cards[d.name];
    check(c && num(c.cost) > 0, `«${d.name}»: coste por ración no calculado (${c?.cost})`);
    check(c && /\d+(,\d+)? %/.test(c.text), `«${d.name}»: food cost no visible`);
    check(c && /estimad/i.test(c.text), `«${d.name}»: la tarjeta debe avisar de que hay precios estimados`);
  }
  const allergensOf = (name) => {
    const d = dishes.find((x) => x.name === name);
    const set = new Set();
    for (const it of d?.items ?? []) if (it.ref?.type === 'product') for (const a of products.get(it.ref.id)?.allergens ?? []) set.add(a);
    return set;
  };
  const expectAllergens = {
    'Gambas al ajillo': ['crustaceos'],
    'Croquetas caseras de jamón (6 uds)': ['gluten', 'lacteos', 'huevo'],
    'Tarta de queso al horno': ['lacteos', 'huevo', 'gluten'],
    'Pulpo a la gallega': ['moluscos'],
    'Merluza en salsa verde': ['pescado', 'moluscos'],
    'Arroz negro con alioli': ['moluscos', 'huevo'],
    'Torrija caramelizada con helado': ['gluten', 'huevo', 'lacteos'],
    'Flan de huevo casero': ['huevo', 'lacteos'],
  };
  for (const [name, list] of Object.entries(expectAllergens)) {
    const got = allergensOf(name);
    for (const a of list) check(got.has(a), `«${name}»: falta el alérgeno ${a} (tiene: ${[...got].join(', ')})`);
  }
  check(!allergensOf('Solomillo de ternera a la pimienta').has('gluten'), 'el solomillo a la pimienta no debe llevar gluten');
  state.cardsBefore = cards;
  await shot('03c-platos-propuestos', { fullPage: true });

  // Vista de tabla: el aviso de precios estimados también está (columna «Precios»).
  await page.getByRole('tab', { name: 'Tabla' }).click();
  const rows = page.locator('table tbody tr');
  await rows.first().waitFor({ timeout: 10_000 });
  const tableRows = (await rows.allInnerTexts()).map(norm);
  check(tableRows.length === expectedNames.length, `la tabla debe listar ${expectedNames.length} platos (${tableRows.length})`);
  check(tableRows.every((t) => /\d+ estimados?/.test(t)), `cada fila de la tabla debe indicar sus precios estimados: ${tableRows.filter((t) => !/estimad/.test(t)).join(' | ').slice(0, 300)}`);
  await shot('03d-platos-tabla', { fullPage: true });
  await page.getByRole('tab', { name: 'Tarjetas' }).click();
  await page.locator('article h3').first().waitFor({ timeout: 10_000 });
});

await step('4. Facturas (3 PDF) → confirmar → precios reales, fuera «estimado», costes y revinculación', async () => {
  // Antes: una línea escrita a mano sin producto (se vinculará cuando llegue la factura del jamón ibérico).
  const croquetas = await dishByName('Croquetas caseras de jamón (6 uds)');
  await go(`#/platos/${croquetas.id}`);
  await page.getByRole('button', { name: 'Añadir ingrediente' }).first().click();
  const n = croquetas.items.length + 1;
  const input = page.getByRole('combobox', { name: `Ingrediente ${n}`, exact: true });
  await input.fill('Jamón ibérico de bellota');
  await input.press('Escape');
  await page.getByLabel(`Cantidad del ingrediente ${n}`, { exact: true }).fill('20');
  await page.getByLabel(`Cantidad del ingrediente ${n}`, { exact: true }).blur();
  await settle();
  const after = await dishByName('Croquetas caseras de jamón (6 uds)');
  const jamon = after.items.find((i) => i.name === 'Jamón ibérico de bellota');
  check(jamon && !jamon.ref && jamon.quantity === 20 && jamon.unit === 'g', 'la línea manual sin vincular debe guardarse (20 g, sin producto)');
  check(await page.getByRole('button', { name: /Vincular 1 automáticamente/ }).isVisible(), 'debe ofrecer «Vincular 1 automáticamente»');

  const productsBefore = new Map((await idb('products')).map((p) => [p.name, p]));
  await go('#/facturas');
  const files = ['factura-fruteria-garcia.pdf', 'factura-carnes-guadarrama.pdf', 'factura-distribuciones-centro.pdf'].map((f) => path.join(ROOT, 'public/samples', f));
  await page.locator('input[type=file][accept*="pdf"]').first().setInputFiles(files);
  // Espera a que se lean las tres (quedan «por revisar»).
  const t0 = Date.now();
  let invoices = [];
  while (Date.now() - t0 < 180000) {
    invoices = await idb('invoices');
    if (invoices.length === 3 && invoices.every((i) => i.status === 'revision' || i.status === 'error' || i.status === 'confirmada')) break;
    await page.waitForTimeout(1000);
  }
  check(invoices.length === 3 && invoices.every((i) => i.status === 'revision'), `las 3 facturas deben quedar por revisar: ${invoices.map((i) => `${i.fileName}=${i.status}`).join(', ')}`);
  await shot('04a-facturas', { fullPage: true });

  // Regresión: pasar de una factura a otra sin salir de la revisión no debe copiar el borrador de la primera en la segunda.
  {
    const [a, b] = invoices;
    await go(`#/facturas/${a.id}`);
    const supplier = page.getByLabel('Proveedor').first();
    await supplier.fill(`${a.supplierName} (editado)`);
    await page.evaluate((id) => (location.hash = `#/facturas/${id}`), b.id);
    await page.waitForTimeout(2500);
    const now = new Map((await idb('invoices')).map((i) => [i.id, i]));
    check(now.get(b.id)?.supplierName === b.supplierName && now.get(b.id)?.lines.length === b.lines.length, 'cambiar de factura en la revisión ha sobrescrito la segunda con el borrador de la primera');
    check(now.get(a.id)?.supplierName === `${a.supplierName} (editado)`, 'el cambio pendiente de la primera factura debe guardarse al salir');
    check((await page.locator('h1').first().innerText()).includes(b.supplierName), 'tras cambiar de factura se debe ver la segunda');
    await go(`#/facturas/${a.id}`);
    await page.getByLabel('Proveedor').first().fill(a.supplierName);
    await go('#/facturas');
    await page.waitForTimeout(1500);
  }

  for (const inv of invoices) {
    await go(`#/facturas/${inv.id}`);
    await page.getByRole('button', { name: /Confirmar y actualizar precios/ }).click();
    const again = page.getByRole('button', { name: 'Confirmar igualmente' });
    if (await again.isVisible({ timeout: 1500 }).catch(() => false)) await again.click();
    await page.waitForFunction(async (id) => {
      const r = indexedDB.open('escandallo-meta');
      const meta = await new Promise((res) => (r.onsuccess = () => res(r.result)));
      const s = await new Promise((res) => {
        const q = meta.transaction('settings').objectStore('settings').get('app');
        q.onsuccess = () => res(q.result);
      });
      meta.close();
      const r2 = indexedDB.open(`escandallo-ws-${s.currentWorkspaceId}`);
      const db = await new Promise((res) => (r2.onsuccess = () => res(r2.result)));
      const inv = await new Promise((res) => {
        const q = db.transaction('invoices').objectStore('invoices').get(id);
        q.onsuccess = () => res(q.result);
      });
      db.close();
      return inv?.status === 'confirmada';
    }, inv.id, { timeout: 20000, polling: 500 });
    const done = page.getByRole('dialog').filter({ hasText: 'Factura confirmada' });
    await done.waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    await shot(`04b-confirmada-${(inv.fileName ?? inv.id).replace(/\.pdf$/, '')}`);
    await done.getByRole('button', { name: 'Volver a facturas' }).click();
    await page.waitForURL(/#\/facturas$/);
  }
  fs.writeFileSync(path.join(OUT, 'dump-04.json'), JSON.stringify({ invoices: await idb('invoices'), dishes: await idb('dishes'), products: await idb('products') }, null, 1));

  // Precios reales: el producto deja de ser «estimado» y toma el €/ud base de la factura.
  const products = new Map((await idb('products')).map((p) => [p.name, p]));
  const expectPrice = {
    'Solomillo de ternera': 33.5,
    Patata: 0.89,
    Cebolla: 1.15,
    Ajo: 5.9,
    'Leche entera': 0.99,
    'Harina de trigo': 0.98,
    'Arroz bomba': 3.95,
    Mantequilla: 9.8,
    'Aceite de oliva virgen extra': 8.455,
    Huevo: 0.23,
  };
  for (const [name, price] of Object.entries(expectPrice)) {
    const p = products.get(name);
    if (!check(p, `falta el producto «${name}»`)) continue;
    check(near(p.pricePerBase, price, 0.0006), `«${name}»: precio ${p.pricePerBase} €/${p.baseUnit} ≠ ${price} de la factura`);
    check(!/Precio estimado/.test(p.notes ?? ''), `«${name}»: sigue marcado como precio estimado tras la factura`);
    check(p.priceSource === 'factura', `«${name}»: origen del precio ${p.priceSource} ≠ factura`);
  }
  const creamCook = products.get('Nata para cocinar');
  check(creamCook && /Precio estimado/.test(creamCook.notes ?? '') && creamCook.pricePerBase === productsBefore.get('Nata para cocinar')?.pricePerBase, 'la nata de 35 % no debe cambiar el precio de la «Nata para cocinar»');
  const whip = [...products.values()].find((p) => /^Nata para montar/.test(p.name));
  check(whip && near(whip.pricePerBase, 3.7345, 0.0006), `la «Nata para montar» debe tomar el precio de «NATA 35% MG 1L» (3,7345 €/l): ${whip?.pricePerBase}`);
  const taquitos = products.get('Taquitos de jamón');
  check(taquitos && taquitos.pricePerBase === productsBefore.get('Taquitos de jamón')?.pricePerBase, `el jamón ibérico de bellota no debe cambiar el precio de los «Taquitos de jamón»: ${taquitos?.pricePerBase}`);
  state.estimatedAfter = [...products.values()].filter((p) => /Precio estimado/.test(p.notes ?? '')).map((p) => p.name);
  check(state.estimatedAfter.length < state.estimatedBefore.length - 8, `deben quedar menos precios estimados (${state.estimatedBefore.length} → ${state.estimatedAfter.length})`);
});

await step('4b. Escandallos tras las facturas: coste real, sin «estimado» y revinculación', async () => {
  await go('#/platos');
  const cards = await readCards();
  const before = state.cardsBefore;
  const sol = cards[SOLOMILLO];
  check(num(sol?.cost) > num(before[SOLOMILLO]?.cost), `el coste del solomillo debe subir con la factura (${before[SOLOMILLO]?.cost} → ${sol?.cost})`);
  const estCount = (c) => Number(/(\d+) estimados?/.exec(c?.text ?? '')?.[1] ?? 0);
  for (const name of Object.keys(cards)) check(estCount(cards[name]) <= estCount(before[name]), `«${name}»: no puede tener más precios estimados que antes`);
  check(estCount(cards['Arroz negro con alioli']) < estCount(before['Arroz negro con alioli']), 'el arroz negro debe tener menos precios estimados (arroz bomba, aceite, ajo, cebolla… ya son reales)');
  // Coste de la ración recalculado con los precios nuevos: se comprueba con la fórmula en el propio plato.
  const dishes = await idb('dishes');
  const products = new Map((await idb('products')).map((p) => [p.id, p]));
  const solDish = dishes.find((d) => d.name === SOLOMILLO);
  const beefLine = solDish.items.find((i) => i.name === 'Solomillo de ternera');
  const beef = products.get(beefLine.ref.id);
  check(near(beef.pricePerBase, 33.5), 'el solomillo del escandallo debe usar el precio de la factura');
  await shot('04c-platos-tras-facturas', { fullPage: true });

  // En el editor: la línea del solomillo ya no lleva la marca «estimado» y la de la nata (sin factura) sí.
  await go(`#/platos/${solDish.id}`);
  const lineRow = (name) => page.locator('tbody tr').filter({ has: page.getByRole('combobox', { name: `Ingrediente ${itemIndex(solDish, name)}`, exact: true }) });
  await lineRow('Solomillo de ternera').waitFor({ timeout: 10_000 });
  check(!/estimado/i.test(await lineRow('Solomillo de ternera').innerText()), 'la línea del solomillo no debe marcarse como «estimado» tras la factura');
  check(num(await lineRow('Solomillo de ternera').locator('td').nth(6).innerText()) === 33.5, 'la línea del solomillo debe mostrar 33,50 €/kg');
  check(/estimado/i.test(await lineRow('Nata para cocinar').innerText()), 'la nata para cocinar (sin factura) debe seguir marcada como «estimado»');

  // Revinculación: la línea «Jamón ibérico de bellota» ya tiene producto (llegó en la factura de carnes).
  const croquetas = dishes.find((d) => d.name === 'Croquetas caseras de jamón (6 uds)');
  await go(`#/platos/${croquetas.id}`);
  const relink = page.getByRole('button', { name: /Vincular 1 automáticamente/ });
  if (check(await relink.isVisible(), 'debe seguir ofreciendo «Vincular 1 automáticamente»')) {
    await relink.click();
    const line = await until(
      async () => (await dishByName('Croquetas caseras de jamón (6 uds)')).items.find((i) => i.name === 'Jamón ibérico de bellota' && i.ref),
      { timeout: 10_000, what: 'la revinculación de la línea del jamón' },
    ).catch(() => undefined);
    await page.waitForTimeout(400);
    const p = line?.ref && products.get(line.ref.id);
    check(p && /ib[eé]rico/i.test(p.name) && /bellota/i.test(p.name) && p.priceSource === 'factura', `la línea debe vincularse al jamón ibérico de la factura (${p?.name ?? 'sin vincular'})`);
    check(!(await relink.isVisible().catch(() => false)), 'tras vincular no deben quedar líneas sin vincular');
  }
  await shot('04d-croquetas-revinculadas', { fullPage: true });
});

await step('5. Editor del solomillo: aceptar, cantidad, base neta/bruta/cocinada, merma manual, PVP, «Aplicar», raciones y autoguardado', async () => {
  const dish = await dishByName(SOLOMILLO);
  state.solomilloId = dish.id;
  await go(`#/platos/${dish.id}`);
  await page.getByRole('button', { name: 'Aceptar todas' }).click();
  await settle();
  check((await dishByName(SOLOMILLO)).items.every((i) => !i.suggested), 'tras «Aceptar todas» no deben quedar líneas propuestas');
  check(!(await page.getByRole('button', { name: 'Aceptar todas' }).isVisible()), 'el aviso de líneas propuestas debe desaparecer');

  const n = itemIndex(dish, 'Solomillo de ternera');
  const qty = page.getByLabel(`Cantidad del ingrediente ${n}`, { exact: true });
  await qty.fill('180');
  await qty.blur();
  await settle();
  const data = await loadData();
  const beef = data.products.get(dish.items[n - 1].ref.id);
  const w = beef.wastePct;
  const k = beef.cookingLossPct;
  check(w > 0 && k > 0, `el solomillo debe traer merma de limpieza y de cocción (${w} %, ${k} %)`);
  const basisSel = page.getByLabel(`Peso del ingrediente ${n}`, { exact: true });
  const cases = [
    ['neta', { gross: 0.18 / (1 - w / 100), served: 0.18 * (1 - k / 100) }],
    ['bruta', { gross: 0.18, served: 0.18 * (1 - w / 100) * (1 - k / 100) }],
    ['cocinada', { gross: 0.18 / (1 - k / 100) / (1 - w / 100), served: 0.18 }],
  ];
  for (const [basis, exp] of cases) {
    await basisSel.selectOption(basis);
    await settle();
    const r = await row(n);
    check(near(r.gross, exp.gross * 1000, 0.6), `base ${basis}: bruto ${r.gross} g ≠ ${(exp.gross * 1000).toFixed(1)} g (bruto = neto/(1−merma))`);
    check(near(r.served, exp.served * 1000, 0.6), `base ${basis}: servido ${r.served} g ≠ ${(exp.served * 1000).toFixed(1)} g (servido = neto·(1−cocción))`);
    check(near(r.cost, exp.gross * beef.pricePerBase, 0.006), `base ${basis}: coste ${r.cost} € ≠ ${(exp.gross * beef.pricePerBase).toFixed(2)} € (bruto × ${beef.pricePerBase} €/kg)`);
    if (basis === 'bruta') await shot('05a-base-bruta');
  }
  await basisSel.selectOption('neta');
  // Merma manual de la línea: 10 % manda sobre la del producto.
  const wasteInput = page.getByLabel(`Merma de limpieza del ingrediente ${n} (%)`, { exact: true });
  await wasteInput.fill('10');
  await wasteInput.blur();
  await settle();
  let r = await row(n);
  check(near(r.gross, 200, 0.6) && near(r.cost, 0.2 * beef.pricePerBase, 0.006), `merma manual 10 %: bruto ${r.gross} g / coste ${r.cost} € ≠ 200 g / ${(0.2 * beef.pricePerBase).toFixed(2)} €`);
  check(await r.tr.getByRole('button', { name: /manual/ }).isVisible(), 'la merma sobrescrita debe marcarse como «manual»');

  // Coste de la ración = suma de líneas con las fórmulas (independiente de la app).
  let exp = expectedCost(dish.id, await loadData());
  check(/\d+ con precio estimado/.test((await kpi('Coste por ración'))?.hint ?? ''), 'el coste por ración debe avisar de cuántos ingredientes llevan precio estimado');
  let shown = num((await kpi('Coste por ración'))?.value);
  check(near(shown, exp.perPortion, 0.006), `coste por ración ${shown} € ≠ ${exp.perPortion.toFixed(2)} € calculado con las fórmulas`);
  const wasteShown = num((await kpi('Merma por ración'))?.value);
  check(near(wasteShown, exp.wasteKgPerPortion * 1000, 0.6), `merma por ración ${wasteShown} g ≠ ${(exp.wasteKgPerPortion * 1000).toFixed(1)} g`);

  // PVP → food cost y margen.
  const pvp = page.getByLabel('PVP de carta con IVA');
  await pvp.fill('26');
  await pvp.blur();
  await settle();
  const net = 26 / 1.1;
  const fcText = await page.locator('.no-print').getByText(/^\d+(,\d)? %$/).first().innerText();
  check(near(num(fcText), (exp.perPortion / net) * 100, 0.051), `food cost ${fcText} ≠ ${((exp.perPortion / net) * 100).toFixed(1)} % (coste / (PVP / 1,10))`);
  check(near(num((await kpi('Margen bruto'))?.value), net - exp.perPortion, 0.006), `margen ${(await kpi('Margen bruto'))?.value} ≠ ${(net - exp.perPortion).toFixed(2)} €`);
  const suggested = Math.ceil((exp.perPortion / 0.3) * 1.1 / 0.5 - 1e-9) * 0.5;
  check(near(num((await kpi('PVP sugerido'))?.value), suggested), `PVP sugerido ${(await kpi('PVP sugerido'))?.value} ≠ ${suggested} (coste / 30 % × 1,10, redondeado a 0,50)`);
  await page.getByRole('button', { name: 'Aplicar' }).first().click();
  await settle();
  check(near(num((await kpi('PVP carta (IVA incl.)'))?.value), suggested), `«Aplicar» debe poner el PVP sugerido (${suggested})`);
  check(near((await dishByName(SOLOMILLO)).menuPrice, suggested), 'el PVP aplicado debe guardarse');
  const fcAfter = num(await page.locator('.no-print').getByText(/^\d+(,\d)? %$/).first().innerText());
  check(fcAfter <= 30, `con el PVP sugerido el food cost debe quedar ≤ 30 % (${fcAfter} %)`);
  state.solomilloPvp = suggested;

  // Raciones: el coste se divide.
  const portions = page.getByLabel('Raciones de la receta');
  await portions.fill('2');
  await portions.blur();
  await settle();
  shown = num((await kpi('Coste por ración'))?.value);
  check(near(shown, exp.total / 2, 0.006), `con 2 raciones el coste por ración ${shown} € ≠ ${(exp.total / 2).toFixed(2)} €`);
  check(/2 raciones/.test((await kpi('Coste por ración'))?.hint ?? ''), 'debe indicar «Receta … · 2 raciones»');
  await shot('05b-dos-raciones', { fullPage: true });
  await portions.fill('1');
  await portions.blur();
  await settle();

  // Autoguardado: tras recargar sigue todo.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByLabel(`Cantidad del ingrediente ${n}`, { exact: true }).waitFor();
  check((await page.getByLabel(`Cantidad del ingrediente ${n}`, { exact: true }).inputValue()) === '180', 'la cantidad (180 g) debe persistir tras recargar');
  check((await page.getByLabel(`Peso del ingrediente ${n}`, { exact: true }).inputValue()) === 'neta', 'la base neta debe persistir');
  check((await page.getByLabel(`Merma de limpieza del ingrediente ${n} (%)`, { exact: true }).inputValue()) === '10', 'la merma manual debe persistir');
  check(near(num((await kpi('PVP carta (IVA incl.)'))?.value), suggested), 'el PVP debe persistir tras recargar');
  const reloaded = num((await kpi('Coste por ración'))?.value);
  check(near(reloaded, exp.perPortion, 0.006), `el coste por ración debe ser el mismo tras recargar (${reloaded} ≠ ${exp.perPortion.toFixed(2)})`);
  await shot('05c-solomillo-editado', { fullPage: true });
});

await step('6. Elaboración «Salsa de pimienta» (rinde 0,5 l) usada en el solomillo por ml', async () => {
  await go('#/platos');
  await page.getByRole('button', { name: 'Nueva elaboración' }).click();
  const modal = page.getByRole('dialog');
  await focusedName(modal);
  await modal.getByLabel('Nombre').fill('Salsa de pimienta');
  await modal.getByPlaceholder('0').last().fill('0,5');
  await modal.getByLabel('Unidad de rendimiento').selectOption('l');
  await modal.getByRole('button', { name: /Crear y proponer/ }).click();
  await page.waitForURL(/#\/platos\/[^/?]+$/, { timeout: 20000 });
  const salsa = await until(async () => {
    const d = await dishByName('Salsa de pimienta');
    return d?.items.length ? d : undefined;
  }, { what: 'la propuesta de la salsa' });
  await page.waitForTimeout(400);
  check(salsa?.kind === 'elaboracion' && salsa.yieldQty === 0.5 && salsa.yieldUnit === 'l', `la elaboración debe guardarse con rendimiento 0,5 l (${salsa?.yieldQty} ${salsa?.yieldUnit})`);
  check(salsa?.items.length >= 3, `la salsa debe traer receta propuesta (${salsa?.items.length} líneas)`);
  const salsaNames = (salsa?.items ?? []).map((i) => i.name);
  check(
    !salsaNames.some((n) => /solomillo|patata/i.test(n)) && salsaNames.includes('Nata para cocinar'),
    `la elaboración debe proponer la receta de la salsa, no la del plato que la lleva: ${salsaNames.join(', ')}`,
  );
  await shot('06a-salsa-propuesta', { fullPage: true });
  let data = await loadData();
  const salsaCost = expectedCost(salsa.id, data);
  const liquid = salsa.items.reduce((s, it) => (UNITS[it.unit]?.[0] === 'l' ? s + toBase(it.quantity, it.unit, 'l') : s), 0);
  check(liquid >= 0.35 && liquid <= 1.2, `la receta propuesta debe dar para ~0,5 l (lleva ${(liquid * 1000).toFixed(0)} ml de líquidos)`);
  check(near(num((await kpi('Coste total receta'))?.value), salsaCost.total, 0.006), `coste total de la salsa ${(await kpi('Coste total receta'))?.value} ≠ ${salsaCost.total.toFixed(2)} €`);
  const perL = salsaCost.total / 0.5;
  check(near(num((await kpi('€ por litro producido'))?.value ?? (await kpi('€ por l producido'))?.value), perL, 0.006), `€/l de la salsa ≠ ${perL.toFixed(2)}`);
  state.salsaPerL = perL;

  // En el solomillo: fuera las líneas sueltas de la salsa y dentro la elaboración (80 ml).
  await go(`#/platos/${state.solomilloId}`);
  for (const name of ['Nata para cocinar', 'Pimienta verde en grano', 'Brandy', 'Fondo oscuro']) {
    const d = await dishByName(SOLOMILLO);
    const i = itemIndex(d, name);
    if (!check(i > 0, `el solomillo debería llevar «${name}»`)) continue;
    const tr = page.locator('tbody tr').filter({ has: page.getByRole('combobox', { name: `Ingrediente ${i}`, exact: true }) });
    await tr.getByRole('button', { name: 'Más opciones de la línea' }).click();
    await page.getByRole('menuitem', { name: 'Eliminar línea' }).click();
    await settle();
  }
  await page.getByRole('button', { name: 'Añadir ingrediente' }).first().click();
  let d = await dishByName(SOLOMILLO);
  await settle();
  d = await dishByName(SOLOMILLO);
  const idx = d.items.length;
  const picker = page.getByRole('combobox', { name: `Ingrediente ${idx}`, exact: true });
  await picker.fill('Salsa de pimienta');
  const option = page.getByRole('option', { name: /Salsa de pimienta/ }).first();
  await option.waitFor({ timeout: 5000 });
  await option.click();
  await page.getByLabel(`Unidad del ingrediente ${idx}`, { exact: true }).selectOption('ml');
  await page.getByLabel(`Cantidad del ingrediente ${idx}`, { exact: true }).fill('80');
  await page.getByLabel(`Cantidad del ingrediente ${idx}`, { exact: true }).blur();
  await settle();
  d = await dishByName(SOLOMILLO);
  const line = d.items.find((i) => i.ref?.type === 'dish');
  check(line && line.ref.id === salsa.id && line.quantity === 80 && line.unit === 'ml', `el solomillo debe llevar 80 ml de la elaboración (${JSON.stringify(line)})`);
  const r = await row(idx);
  check(near(r.cost, 0.08 * perL, 0.006), `coste de 80 ml de salsa ${r.cost} € ≠ ${(0.08 * perL).toFixed(2)} € (0,08 l × ${perL.toFixed(2)} €/l)`);
  data = await loadData();
  const exp = expectedCost(state.solomilloId, data);
  check(near(num((await kpi('Coste por ración'))?.value), exp.perPortion, 0.006), `coste por ración con la elaboración ${(await kpi('Coste por ración'))?.value} ≠ ${exp.perPortion.toFixed(2)} €`);
  const allergenCard = await page.locator('.no-print').getByText('Alérgenos', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]').innerText();
  check(/L[aá]cteos/i.test(allergenCard), 'los lácteos de la salsa deben llegar al solomillo');
  await shot('06b-solomillo-con-salsa', { fullPage: true });

  // Elaboración de base sin rendimiento: la receta por lote trae el suyo (2 l de fondo oscuro), no se estima por peso.
  await go('#/platos');
  await page.getByRole('button', { name: 'Nueva elaboración' }).click();
  const modal2 = page.getByRole('dialog');
  await focusedName(modal2);
  await modal2.getByLabel('Nombre').fill('Fondo oscuro');
  await modal2.getByRole('button', { name: /Crear y proponer/ }).click();
  await page.waitForURL(/#\/platos\/[^/?]+$/, { timeout: 20_000 });
  const fondo = await until(async () => {
    const f = await dishByName('Fondo oscuro');
    return f?.items.length ? f : undefined;
  }, { what: 'la propuesta del fondo oscuro' });
  check(fondo.yieldQty === 2 && fondo.yieldUnit === 'l', `el fondo oscuro debe quedar con el rendimiento de su receta (2 l): ${fondo.yieldQty} ${fondo.yieldUnit}`);
  check(fondo.items.some((i) => i.name === 'Huesos de ternera' && i.quantity === 2 && i.unit === 'kg'), `el fondo debe llevar 2 kg de huesos: ${fondo.items.map((i) => `${i.name} ${i.quantity} ${i.unit}`).join(', ')}`);
  {
    const prods = new Map((await idb('products')).map((p) => [p.id, p]));
    const linkedTo = (n) => prods.get(fondo.items.find((i) => i.name === n)?.ref?.id)?.name;
    check(linkedTo('Vino tinto joven') === 'Vino tinto joven', `el vino tinto del fondo no debe vincularse a otro vino (${linkedTo('Vino tinto joven')})`);
    check(linkedTo('Pimienta negra en grano') === 'Pimienta negra en grano', `la pimienta negra no debe vincularse a la verde (${linkedTo('Pimienta negra en grano')})`);
  }
  await page.getByLabel('Cantidad producida').waitFor({ timeout: 10_000 });
  check(num(await page.getByLabel('Cantidad producida').inputValue()) === 2, 'el rendimiento (2) debe verse en el editor');
  const fondoCost = expectedCost(fondo.id, await loadData());
  const perLFondo = num((await kpi('€ por litro producido'))?.value ?? (await kpi('€ por l producido'))?.value);
  check(near(perLFondo, fondoCost.total / 2, 0.006) && perLFondo > 1 && perLFondo < 6, `€/l del fondo ${perLFondo} ≠ ${(fondoCost.total / 2).toFixed(2)} (coste / 2 l)`);
  await shot('06c-fondo-oscuro', { fullPage: true });
});

await step('7. Prueba de rendimiento desde plantilla para el solomillo, enlazada al producto → coste €/kg útil y merma en el plato', async () => {
  // 7a) La línea del solomillo vuelve a la merma del ingrediente: la merma manual del paso 5 mandaría sobre la prueba.
  await go(`#/platos/${state.solomilloId}`);
  let dish = await dishByName(SOLOMILLO);
  const n = itemIndex(dish, 'Solomillo de ternera');
  const beefId = dish.items[n - 1].ref.id;
  let r = await row(n);
  await r.tr.getByRole('button', { name: /manual/ }).click();
  await settle();
  dish = await dishByName(SOLOMILLO);
  check(dish.items[n - 1].wastePct == null, 'al pulsar «manual» la línea debe volver a la merma del ingrediente');
  check(await r.tr.getByText('producto', { exact: true }).first().isVisible(), 'la merma de la línea debe indicar que viene del «producto»');
  const without = expectedCost(state.solomilloId, await loadData());

  // 7b) /mermas → plantilla «Solomillo de ternera entero» → producto de la factura sugerido.
  await go('#/mermas');
  await page.getByRole('button', { name: /^Usar plantilla Solomillo de ternera entero/ }).click();
  const modal = page.getByRole('dialog');
  await modal.waitFor({ timeout: 10_000 });
  const modalText = norm(await modal.innerText());
  check(/Solomillo de ternera/.test(modalText) && /33,50/.test(modalText), `el alta debe proponer el producto «Solomillo de ternera» con su precio de factura: ${modalText.slice(0, 300)}`);
  check(num(await modal.getByLabel('Precio de compra en euros por kilo').inputValue()) === 33.5, 'el precio de compra debe venir de la factura (33,50 €/kg)');
  await shot('07a-plantilla-solomillo');
  await modal.getByRole('button', { name: 'Crear y empezar a pesar' }).click();
  await page.waitForURL(/#\/mermas\/[^/?]+$/, { timeout: 15_000 });
  const testId = decodeURIComponent(page.url().split('/mermas/')[1]);
  const test = await until(async () => (await idb('yieldTests')).find((t) => t.id === testId), { what: 'la prueba guardada' });
  check(test.productId === beefId, 'la prueba debe quedar asociada al producto del solomillo');
  const beef = (await idb('products')).find((p) => p.id === beefId);
  const y = yieldOf(test, beef.pricePerBase);
  check(near(y.wastePct, 38, 0.01), `merma total de la plantilla ${y.wastePct} % ≠ 38 %`);
  const panel = norm(await page.locator('#resultado').innerText());
  check(panel.includes(fmtE(y.costPerUsableKg)), `el resultado debe mostrar ${fmtE(y.costPerUsableKg)} / kg útil (coste − subproductos) / kg limpio: ${panel.slice(0, 300)}`);
  check(panel.includes('62,0 %') || panel.includes('62 %'), 'el resultado debe mostrar el rendimiento del 62 %');

  // 7c) Aplicarla a los escandallos.
  const toggle = page.getByRole('switch', { name: /Usar esta prueba en todos los escandallos de Solomillo de ternera/ });
  check((await toggle.getAttribute('aria-checked')) === 'false', 'la prueba nueva no debe aplicarse sola');
  await toggle.click();
  await until(async () => (await idb('products')).find((p) => p.id === beefId)?.yieldTestId === testId, { what: 'el vínculo prueba ⇄ producto' });
  const data = await loadData();
  const exp = expectedCost(state.solomilloId, data);
  const line = exp.lines.find((l) => l.name === 'Solomillo de ternera');
  check(near(line.cost, line.net * y.costPerUsableKg, 1e-9) && near(line.w, y.wastePct, 1e-9) && line.k === 18, 'verificación: la línea debe costearse con la prueba');
  const impact = page.locator('li').filter({ hasText: SOLOMILLO }).first();
  await impact.waitFor({ timeout: 10_000 });
  const impactText = norm(await impact.innerText());
  check(impactText.includes(fmtE(exp.perPortion)), `la tarjeta de vínculo debe mostrar el coste por ración con la prueba (${fmtE(exp.perPortion)}): ${impactText}`);
  check(impactText.includes(fmtE(without.perPortion)), `y el coste sin la prueba (${fmtE(without.perPortion)}): ${impactText}`);
  await shot('07b-prueba-aplicada', { fullPage: true });

  // 7d) En el escandallo: merma «prueba», coste = neto × €/kg útil, bruto = neto/(1 − merma), servido = neto·(1 − cocción).
  await go(`#/platos/${state.solomilloId}`);
  r = await row(n);
  check(await r.tr.getByRole('link', { name: 'prueba' }).isVisible(), 'la merma de la línea debe venir de la prueba («prueba»)');
  check(near(r.gross, line.gross * 1000, 0.6), `bruto ${r.gross} g ≠ ${(line.gross * 1000).toFixed(1)} g (neto / (1 − ${y.wastePct} %))`);
  check(near(r.served, line.served * 1000, 0.6), `servido ${r.served} g ≠ ${(line.served * 1000).toFixed(1)} g (neto · (1 − 18 %))`);
  check(near(r.cost, line.cost, 0.006), `coste ${r.cost} € ≠ ${line.cost.toFixed(2)} € (neto × ${y.costPerUsableKg.toFixed(2)} €/kg útil)`);
  const rowText = norm(await r.tr.innerText());
  check(rowText.includes(`${fmtE(y.costPerUsableKg)} /kg útil`), `la línea debe mostrar el ${fmtE(y.costPerUsableKg)}/kg útil con el que se costea: ${rowText}`);
  const shown = num((await kpi('Coste por ración'))?.value);
  check(near(shown, exp.perPortion, 0.006), `coste por ración ${shown} € ≠ ${exp.perPortion.toFixed(2)} € con la prueba`);
  check(Math.abs(exp.perPortion - without.perPortion) > 0.05, 'la prueba debe cambiar el coste del plato');
  const waste = num((await kpi('Merma por ración'))?.value);
  check(near(waste, exp.wasteKgPerPortion * 1000, 0.6), `merma por ración ${waste} g ≠ ${(exp.wasteKgPerPortion * 1000).toFixed(1)} g`);
  state.expFinal = exp;
  await shot('07c-solomillo-con-prueba', { fullPage: true });
  // En el listado, la tarjeta del plato muestra el mismo coste.
  await go('#/platos');
  const cards = await readCards();
  check(near(num(cards[SOLOMILLO]?.cost), exp.perPortion, 0.006), `la tarjeta del solomillo debe mostrar ${fmtE(exp.perPortion)} (${cards[SOLOMILLO]?.cost})`);
});

await step('8. Ficha técnica en modo impresión: sólo la ficha, con coste, PVP, alérgenos y elaboración', async () => {
  await go(`#/platos/${state.solomilloId}`);
  await page.getByLabel('PVP de carta con IVA').waitFor();
  await page.emulateMedia({ media: 'print' });
  try {
    await page.waitForTimeout(300);
    const vis = await page.evaluate(() => {
      const visible = (el) => {
        const st = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const sheet = document.querySelector('.print-only');
      const stray = [];
      for (const el of document.body.querySelectorAll('*')) {
        if (!sheet || sheet.contains(el) || el.contains(sheet) || !visible(el)) continue;
        const t = [...el.childNodes]
          .filter((x) => x.nodeType === 3)
          .map((x) => x.textContent.trim())
          .join('');
        if (t) stray.push(t.slice(0, 50));
      }
      return { sheet: !!sheet && visible(sheet), text: sheet?.innerText ?? '', stray: stray.slice(0, 8) };
    });
    check(vis.sheet, 'la ficha técnica debe verse al imprimir');
    check(vis.stray.length === 0, `al imprimir sólo debe verse la ficha (se ve también: ${vis.stray.join(' | ')})`);
    const t = norm(vis.text).toLowerCase(); // varios rótulos van en mayúsculas por CSS
    const exp = state.expFinal;
    for (const want of ['Ficha técnica', 'Taberna E2E', SOLOMILLO, 'Solomillo de ternera', 'Salsa de pimienta', 'Lácteos', 'Elaboración y emplatado', 'Merma por ración', '/kg útil (prueba)']) {
      check(t.includes(want.toLowerCase()), `la ficha impresa debe incluir «${want}»`);
    }
    if (exp) check(t.includes(fmtE(exp.perPortion).toLowerCase()), `la ficha debe mostrar el coste por ración ${fmtE(exp.perPortion)}`);
    if (state.solomilloPvp) check(t.includes(fmtE(state.solomilloPvp).toLowerCase()), `la ficha debe mostrar el PVP ${fmtE(state.solomilloPvp)}`);
    await shot('08-ficha-impresion', { fullPage: true });
    const pdf = await page.pdf({ path: path.join(OUT, '08-ficha-tecnica.pdf'), format: 'A4', printBackground: true });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    check(pages === 1, `la ficha de un plato debe caber en una página A4 (${pages})`);
  } finally {
    await page.emulateMedia({ media: 'screen' });
  }
});

await step('9. Móvil 390×844: /carta, revisión, /platos y editor usables y sin scroll horizontal', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    await go('#/carta');
    await page.getByText('Gratis, en tu dispositivo', { exact: false }).first().waitFor({ timeout: 10_000 });
    await noHorizontalOverflow('/carta');
    const upload = page.locator('input[type=file][accept*="pdf"]');
    check((await upload.count()) === 1, 'debe poder subirse la carta desde el móvil');
    await shot('09a-movil-carta', { fullPage: true });

    // Revisión de la carta leída (ya importada).
    await page.goto(state.scanUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('input[aria-label="Nombre del plato"]').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await noHorizontalOverflow('revisión de la carta');
    const firstName = page.locator('input[aria-label="Nombre del plato"]').first();
    check(await reachable(firstName), 'el nombre del primer plato debe poder tocarse en la revisión');
    await shot('09b-movil-revision', { fullPage: true });

    await go('#/platos');
    await page.locator('article h3').first().waitFor({ timeout: 10_000 });
    await noHorizontalOverflow('/platos');
    const cards = await readCards();
    check(Object.keys(cards).length >= 10, `en móvil deben verse las tarjetas de los platos (${Object.keys(cards).length})`);
    check(Object.values(cards).some((c) => /estimad/.test(c.text)), 'en móvil las tarjetas también avisan de los precios estimados');
    await shot('09c-movil-platos', { fullPage: true });

    await go(`#/platos/${state.solomilloId}`);
    const dish = await dishByName(SOLOMILLO);
    const n = itemIndex(dish, 'Solomillo de ternera');
    const qty = page.getByLabel(`Cantidad del ingrediente ${n}`, { exact: true });
    await qty.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await noHorizontalOverflow('editor del escandallo');
    check(
      (await page.locator('table').filter({ has: page.getByRole('combobox', { name: /^Ingrediente \d+$/ }) }).count()) === 0,
      'en móvil el escandallo debe mostrarse en tarjetas, no en tabla',
    );
    check(await reachable(qty), 'la cantidad del solomillo debe poder tocarse en móvil');
    check(await reachable(page.getByLabel('PVP de carta con IVA')), 'el PVP debe poder editarse en móvil');
    // Editar en móvil: 180 → 200 g recalcula el coste, y se deja como estaba.
    const before = num((await kpi('Coste por ración'))?.value);
    await qty.fill('200');
    await qty.blur();
    await settle();
    const after = num((await kpi('Coste por ración'))?.value);
    const data = await loadData();
    const exp = expectedCost(state.solomilloId, data);
    check(after > before && near(after, exp.perPortion, 0.006), `en móvil, al cambiar la cantidad el coste debe recalcularse (${before} → ${after}; esperado ${exp.perPortion.toFixed(2)})`);
    await shot('09d-movil-editor', { fullPage: false });
    await shot('09e-movil-editor-completo', { fullPage: true });
    // El resumen fijo aparece al bajar por el escandallo.
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(500);
    check(await page.locator('.fixed').filter({ hasText: /coste ración/i }).first().isVisible(), 'al desplazarse debe quedar visible el resumen fijo (coste, food cost y PVP)');
    await shot('09f-movil-editor-resumen-fijo', { fullPage: false });
    await noHorizontalOverflow('editor del escandallo (desplazado)');
    await qty.fill('180');
    await qty.blur();
    await settle();
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

// ───────────────────────────── Cierre ─────────────────────────────

await step('Sin errores de consola ni excepciones', async () => {
  for (const e of consoleErrors) check(false, e);
});

await browser.close().catch(() => undefined);
clearTimeout(watchdog);
const failed = results.filter((r) => !r.ok);
log(`\n${results.length - failed.length}/${results.length} pasos correctos · capturas en ${OUT}`);
fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
