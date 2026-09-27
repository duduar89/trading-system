// E2E «foto de la carta → platos → escandallo → mermas» como usuario nuevo (sin demo), 100 % local (IA desactivada).
// Uso: node e2e/carta.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] ?? 'http://localhost:4173/').replace(/\/?$/, '/');
const OUT = process.argv[3] ?? path.join(ROOT, 'e2e/screenshots/carta');
fs.mkdirSync(OUT, { recursive: true });

// ───────────────────────────── Utilidades ─────────────────────────────

const results = [];
let failures = [];
const consoleErrors = [];

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
    .replace(/ /g, ' ')
    .match(/-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?/);
  return m ? Number(m[0].replace(/\./g, '').replace(',', '.')) : undefined;
}

async function step(name, fn) {
  failures = [];
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    failures.push(`excepción: ${e?.message?.split('\n')[0] ?? e}`);
    await page
      ?.screenshot({ path: path.join(OUT, `FALLO-${name.replace(/[^\w]+/g, '-').slice(0, 40)}.png`), fullPage: true })
      .catch(() => undefined);
  }
  const ok = failures.length === 0;
  results.push({ name, ok, failures: [...failures] });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const f of failures) console.log(`      - ${f}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', timezoneId: 'Europe/Madrid' });

// Tesseract (worker, núcleo WASM y datos del español): se sirven desde node_modules si están, para que la prueba no dependa de la red.
const TESS_DATA = path.join(ROOT, 'node_modules/.cache/escandallo-bench/spa.traineddata');
await ctx.route(/cdn\.jsdelivr\.net\/npm\/(?:tesseract\.js@[^/]+\/dist\/|tesseract\.js-core@[^/]+\/|@tesseract\.js-data\/spa\/[^/]+\/)/, async (route) => {
  const url = route.request().url();
  let file;
  if (url.includes('/tesseract.js@')) file = path.join(ROOT, 'node_modules/tesseract.js/dist', url.split('/dist/')[1]);
  else if (url.includes('tesseract.js-core@')) file = path.join(ROOT, 'node_modules/tesseract.js-core', url.split('/').pop());
  else file = TESS_DATA;
  if (!fs.existsSync(file)) return route.continue();
  const type = file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
  await route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
});

const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const shot = (name, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });
const go = async (hash) => {
  await page.goto(BASE + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
};

/** Lee todos los registros de un almacén de la BD del restaurante activo (IndexedDB directo). */
async function idb(store) {
  return page.evaluate(async (store) => {
    const open = (name) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const all = (db, s) =>
      new Promise((res, rej) => {
        const r = db.transaction(s, 'readonly').objectStore(s).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const meta = await open('escandallo-meta');
    const [settings] = await all(meta, 'settings');
    meta.close();
    const db = await open(`escandallo-ws-${settings.currentWorkspaceId}`);
    const rows = await all(db, store);
    db.close();
    return rows.map((r) => {
      const { file: _f, images: _i, ...rest } = r;
      return rest;
    });
  }, store);
}

async function noHorizontalOverflow(label) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  check(o.sw <= o.w + 1, `${label}: scroll horizontal (${o.sw}px > ${o.w}px)`);
}

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

// ───────────────────────────── Pasos ─────────────────────────────

await step('1. Contexto nuevo → crear restaurante «Taberna E2E»', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Empezar con mi restaurante/i }).first().click();
  await page.getByLabel(/Nombre del restaurante/i).fill('Taberna E2E');
  await page.getByRole('button', { name: /Crear y empezar/i }).click();
  await page.waitForURL((u) => /#\/?$/.test(u.hash) || u.hash === '', { timeout: 15000 });
  await page.getByText('Taberna E2E').first().waitFor({ timeout: 10000 });
  await shot('01-panel');
  const settings = await page.evaluate(async () => {
    const r = indexedDB.open('escandallo-meta');
    const db = await new Promise((res) => (r.onsuccess = () => res(r.result)));
    const s = await new Promise((res) => {
      const q = db.transaction('settings').objectStore('settings').get('app');
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return s;
  });
  check(settings && settings.aiEnabled !== true, 'la IA opcional debe estar desactivada por defecto');
  check(!settings?.apiKey, 'no debe haber clave de API');
});

await step('2. /carta: foto → OCR local → revisión (10 platos, secciones, PVP, descripciones) y edición', async () => {
  await go('#/carta');
  const body = await page.locator('main').innerText();
  check(/gratis/i.test(body) && /dispositivo/i.test(body), '/carta debe anunciar lectura gratis en el dispositivo');
  check(!/clave de api|api key/i.test(body), '/carta no debe pedir clave de API');
  const t0 = Date.now();
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles(path.join(ROOT, 'public/samples/carta-el-fogon.jpg'));
  await page.waitForURL(/#\/carta\/[^/?]+/, { timeout: 30000 });
  await shot('02a-leyendo');
  await page.getByRole('button', { name: /^Importar \d+ plato/ }).waitFor({ timeout: 240000 });
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
  await page.getByRole('button', { name: 'Añadir plato en Postres' }).click();
  const fresh = page.locator('section[aria-label="Postres"] li').last();
  await fresh.getByLabel('Nombre del plato').fill('Flan de huevo casero');
  await fresh.getByLabel(/^PVP de/).fill('5,50');
  await fresh.getByLabel('Descripción del plato').fill('Con nata montada');
  await fresh.getByLabel(/^PVP de/).blur();
  await page.waitForTimeout(900); // autoguardado (400 ms)
  check(/Importar 10 platos/.test(await page.getByRole('button', { name: /^Importar \d+ plato/ }).innerText()), 'el botón debe ofrecer importar 10 platos (10 − 1 + 1)');
  const [scan] = await idb('menuScans');
  const byName = new Map(scan.entries.map((e) => [e.name, e]));
  check(byName.get('Torrija caramelizada con helado')?.price === 7.5, 'el PVP editado (7,50) debe guardarse');
  check(byName.get('Secreto ibérico a la brasa')?.selected === false, 'el plato deseleccionado debe guardarse');
  const flan = byName.get('Flan de huevo casero');
  check(flan && flan.selected && flan.price === 5.5 && /postres/i.test(flan.section ?? ''), 'el plato añadido a mano debe guardarse con PVP y sección');
  await shot('02c-revision-editada', { fullPage: true });
});

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
  await page.waitForURL(/#\/platos\?.*recientes=1/, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await shot('03b-platos-recientes', { fullPage: true });
});

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
  await page.getByLabel(`Cantidad del ingrediente ${n}`).fill('20');
  await page.getByLabel(`Cantidad del ingrediente ${n}`).blur();
  await page.waitForTimeout(900);
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

  // Revinculación: la línea «Jamón ibérico de bellota» ya tiene producto (llegó en la factura de carnes).
  const croquetas = dishes.find((d) => d.name === 'Croquetas caseras de jamón (6 uds)');
  await go(`#/platos/${croquetas.id}`);
  const relink = page.getByRole('button', { name: /Vincular 1 automáticamente/ });
  if (check(await relink.isVisible(), 'debe seguir ofreciendo «Vincular 1 automáticamente»')) {
    await relink.click();
    await page.waitForTimeout(900);
    const line = (await dishByName('Croquetas caseras de jamón (6 uds)')).items.find((i) => i.name === 'Jamón ibérico de bellota');
    const p = line?.ref && products.get(line.ref.id);
    check(p && /ib[eé]rico/i.test(p.name) && /bellota/i.test(p.name) && p.priceSource === 'factura', `la línea debe vincularse al jamón ibérico de la factura (${p?.name ?? 'sin vincular'})`);
    check(!(await relink.isVisible().catch(() => false)), 'tras vincular no deben quedar líneas sin vincular');
  }
  await shot('04d-croquetas-revinculadas', { fullPage: true });
});

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
const settle = () => page.waitForTimeout(800);
const itemIndex = (dish, name) => dish.items.findIndex((i) => i.name === name) + 1;

await step('5. Editor del solomillo: aceptar, cantidad, base neta/bruta/cocinada, merma manual, PVP, «Aplicar», raciones y autoguardado', async () => {
  const dish = await dishByName(SOLOMILLO);
  state.solomilloId = dish.id;
  await go(`#/platos/${dish.id}`);
  await page.getByRole('button', { name: 'Aceptar todas' }).click();
  await settle();
  check((await dishByName(SOLOMILLO)).items.every((i) => !i.suggested), 'tras «Aceptar todas» no deben quedar líneas propuestas');
  check(!(await page.getByRole('button', { name: 'Aceptar todas' }).isVisible()), 'el aviso de líneas propuestas debe desaparecer');

  const n = itemIndex(dish, 'Solomillo de ternera');
  const qty = page.getByLabel(`Cantidad del ingrediente ${n}`);
  await qty.fill('180');
  await qty.blur();
  await settle();
  const data = await loadData();
  const beef = data.products.get(dish.items[n - 1].ref.id);
  const w = beef.wastePct;
  const k = beef.cookingLossPct;
  check(w > 0 && k > 0, `el solomillo debe traer merma de limpieza y de cocción (${w} %, ${k} %)`);
  const basisSel = page.getByLabel(`Peso del ingrediente ${n}`);
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
  const wasteInput = page.getByLabel(`Merma de limpieza del ingrediente ${n} (%)`);
  await wasteInput.fill('10');
  await wasteInput.blur();
  await settle();
  let r = await row(n);
  check(near(r.gross, 200, 0.6) && near(r.cost, 0.2 * beef.pricePerBase, 0.006), `merma manual 10 %: bruto ${r.gross} g / coste ${r.cost} € ≠ 200 g / ${(0.2 * beef.pricePerBase).toFixed(2)} €`);
  check(await r.tr.getByRole('button', { name: /manual/ }).isVisible(), 'la merma sobrescrita debe marcarse como «manual»');

  // Coste de la ración = suma de líneas con las fórmulas (independiente de la app).
  let exp = expectedCost(dish.id, await loadData());
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
  await page.getByLabel(`Cantidad del ingrediente ${n}`).waitFor();
  check((await page.getByLabel(`Cantidad del ingrediente ${n}`).inputValue()) === '180', 'la cantidad (180 g) debe persistir tras recargar');
  check((await page.getByLabel(`Peso del ingrediente ${n}`).inputValue()) === 'neta', 'la base neta debe persistir');
  check((await page.getByLabel(`Merma de limpieza del ingrediente ${n} (%)`).inputValue()) === '10', 'la merma manual debe persistir');
  check(near(num((await kpi('PVP carta (IVA incl.)'))?.value), suggested), 'el PVP debe persistir tras recargar');
  check(num((await kpi('Coste por ración'))?.value) === near(1, 1) * num((await kpi('Coste por ración'))?.value) && near(num((await kpi('Coste por ración'))?.value), exp.perPortion, 0.006), 'el coste por ración debe ser el mismo tras recargar');
  await shot('05c-solomillo-editado', { fullPage: true });
});

await step('6. Elaboración «Salsa de pimienta» (rinde 0,5 l) usada en el solomillo por ml', async () => {
  await go('#/platos');
  await page.getByRole('button', { name: 'Nueva elaboración' }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Nombre').fill('Salsa de pimienta');
  await modal.getByPlaceholder('0').last().fill('0,5');
  await modal.getByLabel('Unidad de rendimiento').selectOption('l');
  await modal.getByRole('button', { name: /Crear y proponer/ }).click();
  await page.waitForURL(/#\/platos\/[^/?]+$/, { timeout: 20000 });
  await page.waitForTimeout(1200);
  const salsa = await dishByName('Salsa de pimienta');
  check(salsa?.kind === 'elaboracion' && salsa.yieldQty === 0.5 && salsa.yieldUnit === 'l', `la elaboración debe guardarse con rendimiento 0,5 l (${salsa?.yieldQty} ${salsa?.yieldUnit})`);
  check(salsa?.items.length >= 3, `la salsa debe traer receta propuesta (${salsa?.items.length} líneas)`);
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
  await page.getByLabel(`Unidad del ingrediente ${idx}`).selectOption('ml');
  await page.getByLabel(`Cantidad del ingrediente ${idx}`).fill('80');
  await page.getByLabel(`Cantidad del ingrediente ${idx}`).blur();
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
});
