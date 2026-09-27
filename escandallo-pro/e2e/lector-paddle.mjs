// E2E del lector PaddleOCR en la PWA compilada (gratis, en el dispositivo):
//  1. Primera visita (service worker activo) → restaurante nuevo.
//  2. /carta: foto de muestra (public/samples/carta-el-fogon.jpg) → aviso «Descargando el modelo de lectura (solo la
//     primera vez)…» → revisión con los 10 platos, leída con Paddle (worker del lector + modelos en caché).
//  3. /carta: pizarra oscura con letra manuscrita (tests/fixtures/unseen/menus/m04) → revisión.
//  4. Sin conexión tras la primera carga: la app abre, el lector carga de la caché y vuelve a leer la carta.
//  5. Móvil 390×844: /carta y la revisión, sin scroll horizontal.
//  6. Foto de móvil de una factura (render de public/samples/factura-carnes-guadarrama.pdf, girada, con sombra) →
//     lector PaddleOCR y validación aritmética → las 6 líneas y los totales exactos.
//
// Uso: node e2e/lector-paddle.mjs [baseUrl] [outDir]   (contra `vite preview` de un build de producción)
// Como en carta.mjs, los archivos de la CDN (motor WebAssembly de ONNX Runtime y Tesseract) se sirven desde node_modules
// para no depender de la red (E2E_OCR_NETWORK=1 los descarga de verdad). Termina con código ≠ 0 si algo falla.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] ?? 'http://localhost:4173/').replace(/#.*$/, '').replace(/\/?$/, '/');
const OUT = path.resolve(process.argv[3] ?? path.join(ROOT, 'e2e/screenshots/lector-paddle'));
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.rmSync(path.join(OUT, f)); // capturas de otra ejecución
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
// Con el service worker activo, las peticiones a la CDN las hace él: así Playwright también las intercepta
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';

const OCR_TIMEOUT = 4 * 60_000;
const results = [];
const log = (m) => process.stdout.write(`${m}\n`);
let failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  return !!cond;
};

async function step(name, fn) {
  failures = [];
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    failures.push(`excepción: ${e?.message?.split('\n')[0] ?? e}`);
  }
  const ok = failures.length === 0;
  if (!ok) await page?.screenshot({ path: path.join(OUT, `FALLO-${name.replace(/[^\w]+/g, '-').slice(0, 40)}.png`), fullPage: true }).catch(() => undefined);
  results.push({ name, ok, failures: [...failures] });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const f of failures) log(`      - ${f}`);
  return ok;
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
const price = (s) => Number(String(s ?? '').replace(/[^\d,.-]/g, '').replace(',', '.'));

const browser = await chromium.launch({ headless: !process.env.E2E_HEADED });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
ctx.setDefaultTimeout(15_000);

// Archivos de la CDN desde node_modules (misma versión que la app) y registro de lo que se pide a la red
const network = [];
if (process.env.E2E_OCR_NETWORK !== '1') {
  const nm = path.join(ROOT, 'node_modules');
  const lang = [path.join(nm, '.cache/escandallo-tessdata/spa.traineddata'), path.join(nm, '.cache/escandallo-bench/spa.traineddata')].find((f) => fs.existsSync(f));
  const types = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm' };
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\//, async (route) => {
    const url = new URL(route.request().url());
    let file;
    let m;
    if ((m = /^\/npm\/onnxruntime-web@[^/]+\/dist\/(.+)$/.exec(url.pathname))) file = path.join(nm, 'onnxruntime-web/dist', m[1]);
    else if ((m = /^\/npm\/tesseract\.js@[^/]+\/dist\/(.+)$/.exec(url.pathname))) file = path.join(nm, 'tesseract.js/dist', m[1]);
    else if ((m = /^\/npm\/tesseract\.js-core@[^/]+\/(.+)$/.exec(url.pathname))) file = path.join(nm, 'tesseract.js-core', m[1]);
    else if (/^\/npm\/@tesseract\.js-data\/spa\/[^/]+\/spa\.traineddata(\.gz)?$/.test(url.pathname)) file = lang;
    if (!file || !fs.existsSync(file)) return route.abort();
    network.push(url.pathname);
    await route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'content-type': types[file.split('.').pop()] ?? 'application/octet-stream', 'access-control-allow-origin': '*' } });
  });
}

let page = await ctx.newPage();
const consoleErrors = [];
const workers = [];
const watch = (p) => {
  p.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) consoleErrors.push(m.text().slice(0, 240));
  });
  p.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 240)}`));
  p.on('worker', (w) => workers.push(w.url()));
  p.on('request', (r) => {
    if (/ocr-models\//.test(r.url())) network.push(new URL(r.url()).pathname);
  });
};
watch(page);

const shot = (name, opts = {}) => page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', ...opts });
const go = async (hash) => {
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
};

/** Sube una foto en /carta, sigue las etapas del progreso y devuelve las filas de la revisión. */
async function readMenu(file, label) {
  await go('#/carta');
  const stages = new Set();
  const t0 = Date.now();
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles(file);
  await page.waitForURL(/#\/carta\/[^/?]+/, { timeout: 30_000 });
  const ready = page.getByRole('button', { name: /^Importar \d+ plato/ });
  const failed = page.getByText('No hemos podido leer esta carta');
  let downloadShot = false;
  while (Date.now() - t0 < OCR_TIMEOUT) {
    if ((await ready.count()) || (await failed.count())) break;
    const text = await page
      .locator('main')
      .innerText()
      .catch(() => '');
    for (const m of text.matchAll(/(Descargando el modelo de lectura[^\n]*|Preparando el lector[^\n]*|Leyendo texto[^\n]*|Segunda lectura[^\n]*)/g)) stages.add(m[1].replace(/\s*\d+\s*%$/, ''));
    if (!downloadShot && /Descargando el modelo de lectura/.test(text)) {
      downloadShot = true;
      await shot(`${label}-descargando`);
    }
    await page.waitForTimeout(250);
  }
  if (await failed.count()) throw new Error(`no se ha podido leer ${path.basename(file)}: ${(await page.locator('main').innerText()).slice(0, 200)}`);
  await ready.first().waitFor({ timeout: 5_000 });
  const secs = (Date.now() - t0) / 1000;
  await page.waitForTimeout(500);
  await shot(`${label}-revision`, { fullPage: true });
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('section[aria-label] li')].map((li) => ({
      name: li.querySelector('input[aria-label="Nombre del plato"]')?.value,
      price: li.querySelector('input[aria-label^="PVP"]')?.value,
      section: li.querySelector('input[aria-label="Sección"]')?.value,
    })),
  );
  return { rows, stages: [...stages], secs };
}

function score(rows, expected) {
  const used = new Set();
  let exact = 0;
  const missing = [];
  for (const e of expected) {
    const i = rows.findIndex((r, k) => !used.has(k) && norm(r.name) === norm(e.name) && Math.abs(price(r.price) - e.price) < 0.005);
    if (i >= 0) {
      used.add(i);
      exact++;
    } else missing.push(`${e.name} ${e.price}`);
  }
  return { exact, missing, extra: rows.length - used.size };
}

/** Registros de un almacén de la BD del restaurante activo (IndexedDB), sin los archivos. */
async function idb(store) {
  return page.evaluate(async (store) => {
    const open = (name) =>
      new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
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
    const app = (await all(meta, 'settings')).find((x) => x.id === 'app');
    meta.close();
    if (!app?.currentWorkspaceId) return [];
    const db = await open(`escandallo-ws-${app.currentWorkspaceId}`);
    const rows = await all(db, store);
    db.close();
    return rows.map(({ file: _f, images: _i, ...rest }) => rest);
  }, store);
}

/** Foto de móvil de una factura en PDF: render con pdf.js, papel girado y en perspectiva sobre una mesa, en JPEG. */
async function invoicePhoto(pdfFile, out) {
  const p = await ctx.newPage();
  try {
    await p.route('http://e2e.local/**', async (route) => {
      const map = {
        '/pdf.mjs': [path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.min.mjs'), 'text/javascript'],
        '/pdf.worker.mjs': [path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'), 'text/javascript'],
        '/doc.pdf': [pdfFile, 'application/pdf'],
      };
      const url = new URL(route.request().url()).pathname;
      if (url === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
      const hit = map[url];
      return hit ? route.fulfill({ status: 200, contentType: hit[1], body: fs.readFileSync(hit[0]) }) : route.fulfill({ status: 404, body: '' });
    });
    await p.setViewportSize({ width: 900, height: 1250 });
    await p.goto('http://e2e.local/');
    await p.evaluate(async () => {
      const pdfjs = await import('http://e2e.local/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = 'http://e2e.local/pdf.worker.mjs';
      const doc = await pdfjs.getDocument({ url: 'http://e2e.local/doc.pdf' }).promise;
      const pg = await doc.getPage(1);
      const vp = pg.getViewport({ scale: 2.2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
      document.body.style.cssText = 'margin:0;width:900px;height:1250px;overflow:hidden;background:radial-gradient(circle at 30% 20%,#7d6450,#4a3627 70%);';
      const paper = document.createElement('div');
      paper.style.cssText =
        'position:absolute;left:70px;top:60px;width:760px;transform:perspective(2200px) rotateZ(1.8deg) rotateX(3deg);box-shadow:0 30px 60px rgba(0,0,0,.5);background:#fbfaf6;';
      canvas.style.cssText = 'display:block;width:760px;height:auto;filter:contrast(.93) brightness(.97);';
      paper.append(canvas);
      document.body.append(paper);
    });
    await p.screenshot({ path: out, type: 'jpeg', quality: 82 });
  } finally {
    await p.close();
  }
}

const SAMPLE = path.join(ROOT, 'public/samples/carta-el-fogon.jpg');
const SAMPLE_EXPECTED = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/menus/bench-el-fogon.expected.json'), 'utf8')).entries;
const BOARD = path.join(ROOT, 'tests/fixtures/unseen/menus/m04-pizarra-manuscrita.jpg');
const BOARD_EXPECTED = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/unseen/menus/m04-pizarra-manuscrita.expected.json'), 'utf8')).entries;
const state = {};

try {
  await step('1. Primera visita: service worker activo y restaurante nuevo', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30_000 });
    const sw = await page.evaluate(async () => {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 20_000))]);
      return !!reg;
    });
    check(sw, 'el service worker debe activarse');
    await page.reload({ waitUntil: 'networkidle' });
    check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'la página debe quedar controlada por el service worker');
    const start = page.getByRole('button', { name: /Empezar con mi restaurante/i }).first();
    await start.waitFor({ timeout: 30_000 });
    await start.click();
    await page.getByLabel(/Nombre del restaurante/i).fill('Lector E2E');
    await page.getByRole('button', { name: /Crear y empezar/i }).click();
    await page.getByRole('heading', { name: /Lector E2E/ }).first().waitFor({ timeout: 20_000 });
  });

  await step('2. Carta de muestra: descarga del modelo la primera vez y 10 platos exactos leídos con Paddle', async () => {
    const r = await readMenu(SAMPLE, '02-muestra');
    state.sampleSecs = r.secs;
    const s = score(r.rows, SAMPLE_EXPECTED);
    log(`      lectura ${r.secs.toFixed(1)} s · ${s.exact}/${SAMPLE_EXPECTED.length} exactos · etapas: ${r.stages.join(' → ')}`);
    check(s.exact === SAMPLE_EXPECTED.length && s.extra === 0, `se esperaban los ${SAMPLE_EXPECTED.length} platos exactos (${s.exact}; faltan ${s.missing.join(', ')}; sobran ${s.extra})`);
    check(r.stages.some((x) => /Descargando el modelo de lectura \(solo la primera vez\)/.test(x)), 'la primera vez debe anunciarse la descarga del modelo de lectura');
    check(workers.some((u) => /paddle\.worker/.test(u)), `debe arrancar el worker del lector PaddleOCR (workers: ${workers.join(', ')})`);
    const cached = await page.evaluate(async () => {
      const out = [];
      for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(req.url);
      return out;
    });
    for (const f of ['ppocrv5-mobile-det.onnx', 'ppocrv5-latin-mobile-rec.onnx', 'ppocrv5-latin-dict.txt', 'ort-wasm-simd-threaded.wasm']) {
      check(cached.some((u) => u.endsWith(f)), `${f} debe quedar en caché para trabajar sin conexión`);
    }
  });

  await step('3. Pizarra oscura con letra manuscrita → revisión', async () => {
    const before = network.length;
    const r = await readMenu(BOARD, '03-pizarra');
    const s = score(r.rows, BOARD_EXPECTED);
    log(`      lectura ${r.secs.toFixed(1)} s · ${s.exact}/${BOARD_EXPECTED.length} exactos (faltan: ${s.missing.join(', ') || 'ninguno'}; sobran ${s.extra})`);
    check(r.rows.length >= BOARD_EXPECTED.length - 1, `la revisión debe listar los platos de la pizarra (${r.rows.length})`);
    check(s.exact >= BOARD_EXPECTED.length - 2, `platos exactos de la pizarra: ${s.exact}/${BOARD_EXPECTED.length}`);
    check(!r.stages.some((x) => /Descargando el modelo/.test(x)), 'la segunda lectura no debe volver a descargar el modelo');
    check(!network.slice(before).some((p) => /ocr-models|onnxruntime-web/.test(p)), `la segunda lectura no debe pedir los modelos a la red (${network.slice(before).join(', ')})`);
  });

  await step('4. Sin conexión: la app abre y el lector vuelve a leer la carta desde la caché', async () => {
    // Página nueva (worker del lector nuevo): todo tiene que salir de las cachés
    await page.close();
    page = await ctx.newPage();
    watch(page);
    await ctx.setOffline(true);
    const before = network.length;
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(1500);
      check((await page.getByText(/Sin conexión/i).count()) > 0, 'debe avisar de que no hay conexión');
      const r = await readMenu(SAMPLE, '04-sin-conexion');
      const s = score(r.rows, SAMPLE_EXPECTED);
      log(`      lectura sin conexión ${r.secs.toFixed(1)} s · ${s.exact}/${SAMPLE_EXPECTED.length} exactos`);
      check(s.exact === SAMPLE_EXPECTED.length, `sin conexión se esperaban los ${SAMPLE_EXPECTED.length} platos (${s.exact}; faltan ${s.missing.join(', ')})`);
      check(!network.slice(before).some((p) => /ocr-models|onnxruntime-web/.test(p)), 'sin conexión no debe pedirse nada del lector a la red');
    } finally {
      await ctx.setOffline(false);
    }
  });

  await step('5. Móvil 390×844: /carta y revisión usables, sin scroll horizontal', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const r = await readMenu(SAMPLE, '05-movil');
    check(r.rows.length === SAMPLE_EXPECTED.length, `en móvil la revisión debe listar los ${SAMPLE_EXPECTED.length} platos (${r.rows.length})`);
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: document.documentElement.clientWidth }));
    check(o.sw <= o.w + 1, `sin scroll horizontal (${o.sw}px > ${o.w}px)`);
    const first = page.locator('input[aria-label="Nombre del plato"]').first();
    await first.scrollIntoViewIfNeeded();
    const box = await first.boundingBox();
    check(box && box.x >= 0 && box.x + box.width <= 391, 'el nombre del primer plato debe caber en la pantalla');
    await shot('05-movil-revision-pantalla');
  });

  await step('6. Foto de móvil de una factura → lector PaddleOCR + validación aritmética → líneas y totales exactos', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const pdf = path.join(ROOT, 'public/samples/factura-carnes-guadarrama.pdf');
    const exp = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/bench/expected.json'), 'utf8')).invoices['factura-carnes-guadarrama.pdf'];
    const photo = path.join(OUT, 'foto-factura-carnes.jpg');
    await invoicePhoto(pdf, photo);
    await go('#/facturas');
    const t0 = Date.now();
    await page.locator('input[type=file][capture]').first().setInputFiles(photo);
    let inv;
    while (Date.now() - t0 < OCR_TIMEOUT) {
      inv = (await idb('invoices')).find((i) => i.fileName === 'foto-factura-carnes.jpg');
      if (inv && inv.status !== 'pendiente' && inv.status !== 'procesando') break;
      await page.waitForTimeout(1000);
    }
    await shot('06-factura-foto', { fullPage: false });
    if (!check(inv && !inv.error, `la foto de la factura no se ha leído (${inv?.status} ${inv?.error ?? ''})`)) return;
    log(`      lectura ${((Date.now() - t0) / 1000).toFixed(1)} s · ${inv.method} · ${inv.lines.length} líneas`);
    check(inv.method === 'ocr', `método ${inv.method}`);
    check(inv.lines.length === exp.lines.length, `${inv.lines.length} líneas (se esperaban ${exp.lines.length})`);
    const fold = (t) => norm(t).replace(/\s+/g, ' ');
    for (const e of exp.lines) {
      const l = inv.lines.find((x) => fold(x.description) === fold(e.description));
      if (!check(l, `falta «${e.description}» (leídas: ${inv.lines.map((x) => x.description).join(' | ')})`)) continue;
      check(Math.abs(l.total - e.total) < 0.006 && Math.abs(l.quantity - e.quantity) < 0.0006 && Math.abs(l.unitPrice - e.unitPrice) < 0.0006, `«${e.description}»: ${l.quantity} × ${l.unitPrice} = ${l.total}`);
    }
    check(inv.number === exp.header.number, `número ${inv.number} ≠ ${exp.header.number}`);
    check(Math.abs((inv.total ?? 0) - exp.header.total) < 0.006, `total ${inv.total} ≠ ${exp.header.total}`);
  });

  await step('Sin errores de consola ni excepciones', async () => {
    for (const e of consoleErrors) check(false, e);
  });
} finally {
  await browser.close().catch(() => undefined);
}
const failed = results.filter((r) => !r.ok);
log(`\n${results.length - failed.length}/${results.length} pasos correctos · capturas en ${OUT}`);
fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify({ results, state }, null, 2));
process.exit(failed.length ? 1 : 0);
