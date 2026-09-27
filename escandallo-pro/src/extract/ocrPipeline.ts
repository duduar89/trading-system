import type { ExtractedInvoice, ExtractedMenu, ProgressFn } from '../types';
import { crop, invertDarkRegions, prepareForOcr, removeRules, resample, sauvola, type GrayImage, type OcrPrepInfo, type OcrPrepOptions, type Rect } from './imageOps';
import { ocrPagesToResult, type LayoutMode, type OcrBox, type TessLine, type TessPage } from './ocrLayout';
import { invoiceQuality, mergeInvoiceReadings, parseInvoiceReading, sumMatches, type InvoiceReading } from './invoiceParser';
import type { OcrResult } from './ocr';

/**
 * Orquestación del OCR local (lógica pura con el motor inyectado): la usan el navegador (tesseract.js en un worker)
 * y el banco de pruebas en Node (tesseract.js de Node), para que la calidad medida sea la que obtiene el usuario.
 *
 * Facturas: primera lectura con PSM 6 (bloque uniforme, ideal para tablas) sobre la imagen normalizada. Si la
 * validación aritmética no cuadra (líneas sin validar o suma ≠ base imponible) se hacen lecturas de rescate que dan
 * errores DISTINTOS: la misma imagen reducida al 80 % (el modelo LSTM es sensible al tamaño), PSM 4 sobre la imagen
 * binarizada con Sauvola y segmentación automática (PSM 3) ampliada. Tras cada pasada se combinan todas las lecturas
 * (`mergeInvoiceReadings`): línea a línea gana la que valida la aritmética y, si la suma no cuadra, las lecturas
 * alternativas que la hacen cuadrar con la base imponible. Se para en cuanto la factura cuadra.
 * Cartas: PSM 3 (cartas a varias columnas) y, si se leen pocos platos, PSM 4 binarizada y PSM 11 (texto disperso).
 */

export type Psm = '3' | '4' | '6' | '11';

export interface OcrPass {
  id: string;
  psm: Psm;
  binarize: boolean;
  /** Reescalado relativo de la imagen preparada (el modelo LSTM es sensible al tamaño: variar la escala da lecturas distintas). */
  scale?: number;
}

/** Motor de OCR: reconoce una imagen en escala de grises con el modo de segmentación indicado. */
export interface OcrBackend {
  recognize(image: GrayImage, psm: Psm, onProgress?: (fraction: number) => void): Promise<TessPage>;
}

export const INVOICE_PASSES: readonly OcrPass[] = [
  { id: 'tabla', psm: '6', binarize: false },
  { id: 'tabla-reducida', psm: '6', binarize: false, scale: 0.8 },
  { id: 'columna-binarizada', psm: '4', binarize: true },
  { id: 'automatica-ampliada', psm: '3', binarize: false, scale: 1.2 },
];

export const MENU_PASSES: readonly OcrPass[] = [
  { id: 'automatica', psm: '3', binarize: false },
  { id: 'columna-binarizada', psm: '4', binarize: true },
  { id: 'dispersa', psm: '11', binarize: false },
];

export interface PreparedPage {
  image: GrayImage;
  info: OcrPrepInfo;
  /** Variantes (binarizada, reescalada) calculadas bajo demanda para las lecturas de rescate. */
  variants?: Map<string, GrayImage>;
  /** Zonas de fondo oscuro (texto claro): se leen aparte, invertidas (ver `prepareInvoicePage`). */
  dark?: { rect: Rect; image: GrayImage; lines?: TessLine[] }[];
}

/** Prepara las páginas para OCR (recorte, ruido, fondo, contraste, enderezado y escala). */
export function preparePages(sources: GrayImage[], opts: OcrPrepOptions = {}): PreparedPage[] {
  return sources.map((src) => {
    const { image, info } = prepareForOcr(src, { ...opts, binarize: false });
    return { image, info };
  });
}

function imageFor(page: PreparedPage, pass: OcrPass): GrayImage {
  const scale = pass.scale && Math.abs(pass.scale - 1) > 0.01 ? pass.scale : 1;
  if (!pass.binarize && scale === 1) return page.image;
  const key = `${pass.binarize ? 'b' : 'g'}${scale}`;
  page.variants ??= new Map();
  const cached = page.variants.get(key);
  if (cached) return cached;
  let img = scale === 1 ? page.image : resample(page.image, { scale, background: 255 });
  if (pass.binarize) {
    const lh = (page.info.lineHeight ?? 36) * page.info.scale * scale;
    img = sauvola(img, { window: Math.max(24, Math.round(lh * 2.5)), k: 0.25 });
  }
  page.variants.set(key, img);
  return img;
}

export interface PassReport {
  id: string;
  psm: Psm;
  binarize: boolean;
  lines: number;
  validated: number;
  quality: number;
  ms: number;
}

/** Reconoce todas las páginas con una pasada y reconstruye las filas. */
export async function recognizePages(
  pages: PreparedPage[],
  backend: OcrBackend,
  pass: OcrPass,
  mode: LayoutMode,
  onFraction?: (fraction: number) => void,
): Promise<OcrResult> {
  const results: { page: TessPage; pageNo: number }[] = [];
  for (let i = 0; i < pages.length; i++) {
    const read = await backend.recognize(imageFor(pages[i], pass), pass.psm, (f) => onFraction?.((i + Math.min(1, Math.max(0, f))) / pages.length));
    const scale = pass.scale && Math.abs(pass.scale - 1) > 0.01 ? pass.scale : 1;
    const page = await withDarkRegions(read, pages[i], backend, scale);
    results.push({ page, pageNo: i + 1 });
    onFraction?.((i + 1) / pages.length);
  }
  return ocrPagesToResult(results, mode);
}

function validatedCount(inv: ExtractedInvoice): number {
  return inv.lines.filter((l) => (l.confidence ?? 0) >= 0.8).length;
}

/**
 * ¿La lectura cuadra? Todas las líneas validadas y, si hay base imponible, la suma coincide. Sin base imponible
 * (albaranes sin totales) basta con que todas las líneas estén validadas: otra pasada no aportaría más comprobación.
 */
export function invoiceLooksComplete(inv: ExtractedInvoice): boolean {
  if (!inv.lines.length) return false;
  if (validatedCount(inv) < inv.lines.length) return false;
  if (inv.subtotal === undefined) return true;
  const sum = inv.lines.reduce((s, l) => s + l.total, 0);
  return sumMatches(sum, inv.subtotal) || (inv.total !== undefined && sumMatches(sum, inv.total));
}

export interface InvoiceOcrOutcome {
  invoice: ExtractedInvoice;
  ocr: OcrResult;
  passes: PassReport[];
}

export interface PipelineOptions {
  onProgress?: ProgressFn;
  /** Texto de la etapa (por defecto 'Leyendo texto (OCR)…'). */
  stage?: string;
  /** Máximo de pasadas (por defecto todas). */
  maxPasses?: number;
  passes?: readonly OcrPass[];
  now?: () => number;
}

function stageFor(base: string, passIndex: number): string {
  if (passIndex === 0) return base;
  return passIndex === 1 ? 'Segunda lectura para cuadrar importes…' : 'Última lectura de comprobación…';
}

/**
 * Página de factura lista para las tablas, sobre una copia (la original no se toca):
 *  - se borran los filetes de la tabla: Tesseract lee los bordes verticales pegados a las cifras como "|", "!", "/" o
 *    "1" ("4,25|" → 4,251) y los horizontales tapan decimales;
 *  - las zonas de fondo oscuro (banda con la razón social, cabecera de la tabla en negativo) se recortan invertidas
 *    para leerlas aparte: Tesseract no lee texto claro sobre oscuro, y si se invierten en la propia página cambia
 *    cómo segmenta las filas de la tabla de debajo (celdas de dos filas).
 */
export function prepareInvoicePage(page: PreparedPage): PreparedPage {
  const image: GrayImage = { width: page.image.width, height: page.image.height, data: page.image.data.slice() };
  const lineHeight = (page.info.lineHeight ?? 36) * page.info.scale;
  removeRules(image, lineHeight);
  const inverted: GrayImage = { width: image.width, height: image.height, data: image.data.slice() };
  const rects: Rect[] = [];
  invertDarkRegions(inverted, lineHeight, rects);
  const pad = Math.round(lineHeight * 0.3);
  const dark = rects.map((r) => {
    const rect = { x0: Math.max(0, r.x0 - pad), y0: Math.max(0, r.y0 - pad), x1: Math.min(image.width, r.x1 + pad), y1: Math.min(image.height, r.y1 + pad) };
    return { rect, image: crop(inverted, rect) };
  });
  return { image, info: page.info, dark: dark.length ? dark : undefined };
}

const shift = (b: OcrBox, dx: number, dy: number, k: number): OcrBox => ({ x0: (b.x0 + dx) * k, y0: (b.y0 + dy) * k, x1: (b.x1 + dx) * k, y1: (b.y1 + dy) * k });

/**
 * Sustituye en una lectura lo leído dentro de las zonas oscuras (restos sin sentido) por la lectura aparte de cada
 * zona invertida, en las coordenadas de la página (con la escala de la pasada).
 */
async function withDarkRegions(read: TessPage, page: PreparedPage, backend: OcrBackend, scale: number): Promise<TessPage> {
  if (!page.dark?.length) return read;
  for (const d of page.dark) d.lines ??= ((await backend.recognize(d.image, '6')).blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  const inside = (b: OcrBox) => {
    const cx = (b.x0 + b.x1) / 2 / scale;
    const cy = (b.y0 + b.y1) / 2 / scale;
    return page.dark?.some((d) => cx >= d.rect.x0 && cx <= d.rect.x1 && cy >= d.rect.y0 && cy <= d.rect.y1) ?? false;
  };
  const blocks = (read.blocks ?? []).map((b) => ({
    ...b,
    paragraphs: b.paragraphs.map((p) => ({ lines: p.lines.map((l) => ({ ...l, words: l.words.filter((w) => !inside(w.bbox)) })).filter((l) => l.words.length) })),
  }));
  for (const d of page.dark) {
    const lines: TessLine[] = (d.lines ?? []).map((l) => ({
      ...l,
      bbox: shift(l.bbox, d.rect.x0, d.rect.y0, scale),
      baseline: l.baseline ? shift(l.baseline, d.rect.x0, d.rect.y0, scale) : undefined,
      rowAttributes: l.rowAttributes?.rowHeight ? { rowHeight: l.rowAttributes.rowHeight * scale } : undefined,
      words: l.words.map((w) => ({ ...w, bbox: shift(w.bbox, d.rect.x0, d.rect.y0, scale) })),
    }));
    if (lines.length) blocks.push({ bbox: shift(d.rect, 0, 0, scale), paragraphs: [{ lines }] });
  }
  return { ...read, blocks };
}

/** OCR de una factura con reintentos guiados por la validación aritmética. */
export async function ocrInvoice(pagesIn: PreparedPage[], backend: OcrBackend, opts: PipelineOptions = {}): Promise<InvoiceOcrOutcome> {
  const pages = pagesIn.map(prepareInvoicePage);
  const passes = (opts.passes ?? INVOICE_PASSES).slice(0, Math.max(1, opts.maxPasses ?? Infinity));
  const now = opts.now ?? (() => Date.now());
  const base = opts.stage ?? 'Leyendo texto (OCR)…';
  const readings: { reading: InvoiceReading; ocr: OcrResult }[] = [];
  const reports: PassReport[] = [];
  let best: { inv: ExtractedInvoice; ocr: OcrResult } | undefined;
  for (let k = 0; k < passes.length; k++) {
    const pass = passes[k];
    const t0 = now();
    const stage = stageFor(base, k);
    // La primera pasada ocupa la mayor parte de la barra; las de rescate, el resto
    const from = k === 0 ? 0 : 0.8 + (0.2 * (k - 1)) / Math.max(1, passes.length - 1);
    const to = k === 0 ? 0.8 : 0.8 + (0.2 * k) / Math.max(1, passes.length - 1);
    const ocr = await recognizePages(pages, backend, pass, 'table', (f) => opts.onProgress?.({ stage, progress: from + (to - from) * f }));
    const reading = parseInvoiceReading({ text: ocr.text }, 'ocr', ocr.rows);
    const inv = reading.invoice;
    readings.push({ reading, ocr });
    reports.push({ id: pass.id, psm: pass.psm, binarize: pass.binarize, lines: inv.lines.length, validated: validatedCount(inv), quality: invoiceQuality(inv), ms: now() - t0 });
    // Combinación de todas las lecturas hasta ahora (la mejor como base)
    const ordered = [...readings].sort((a, b) => invoiceQuality(b.reading.invoice) - invoiceQuality(a.reading.invoice));
    const merged = ordered.length > 1 ? mergeInvoiceReadings(ordered.map((r) => r.reading)).invoice : ordered[0].reading.invoice;
    best = { inv: merged, ocr: ordered[0].ocr };
    if (invoiceLooksComplete(merged)) break;
  }
  if (!best) throw new Error('No se ha podido leer el documento');
  return { invoice: { ...best.inv, method: 'ocr', rawText: best.ocr.text }, ocr: best.ocr, passes: reports };
}

export interface MenuOcrOutcome {
  menu: ExtractedMenu;
  ocr: OcrResult;
  passes: PassReport[];
}

/** Puntuación de una lectura de carta: platos con precio, ponderados por su confianza. */
export function menuQuality(menu: ExtractedMenu): number {
  let s = 0;
  for (const e of menu.entries) {
    if (e.price === undefined || !(e.price > 0)) continue;
    s += 0.5 + 0.5 * Math.min(1, Math.max(0, e.confidence ?? 0.7));
    if (e.name && /\p{L}{3}/u.test(e.name)) s += 0.25;
  }
  return s;
}

/** OCR de una carta: se repite con otra segmentación si se han leído pocos platos. */
export async function ocrMenu(
  pages: PreparedPage[],
  backend: OcrBackend,
  parse: (text: string, ocr: OcrResult) => ExtractedMenu,
  opts: PipelineOptions & {
    minEntries?: number;
    /** Combina las lecturas de varias pasadas (p. ej. `mergeMenuPasses` del parser de cartas). */
    merge?: (menus: ExtractedMenu[]) => ExtractedMenu;
    /** Calidad de una lectura (por defecto `menuQuality` de este módulo). */
    quality?: (menu: ExtractedMenu) => number;
  } = {},
): Promise<MenuOcrOutcome> {
  const passes = (opts.passes ?? MENU_PASSES).slice(0, Math.max(1, opts.maxPasses ?? Infinity));
  const now = opts.now ?? (() => Date.now());
  const base = opts.stage ?? 'Leyendo texto (OCR)…';
  const minEntries = opts.minEntries ?? 4;
  const quality = opts.quality ?? menuQuality;
  const reports: PassReport[] = [];
  const menus: ExtractedMenu[] = [];
  let best: { menu: ExtractedMenu; ocr: OcrResult; q: number } | undefined;
  let result: ExtractedMenu | undefined;
  for (let k = 0; k < passes.length; k++) {
    const pass = passes[k];
    const t0 = now();
    const stage = k === 0 ? base : 'Segunda lectura de la carta…';
    const from = k === 0 ? 0 : 0.8 + (0.2 * (k - 1)) / Math.max(1, passes.length - 1);
    const to = k === 0 ? 0.8 : 0.8 + (0.2 * k) / Math.max(1, passes.length - 1);
    const ocr = await recognizePages(pages, backend, pass, 'columns', (f) => opts.onProgress?.({ stage, progress: from + (to - from) * f }));
    const menu = parse(ocr.text, ocr);
    menus.push(menu);
    const q = quality(menu);
    const priced = menu.entries.filter((e) => e.price !== undefined && e.price > 0);
    reports.push({ id: pass.id, psm: pass.psm, binarize: pass.binarize, lines: menu.entries.length, validated: priced.length, quality: q, ms: now() - t0 });
    if (!best || q > best.q) best = { menu, ocr, q };
    result = opts.merge && menus.length > 1 ? opts.merge(menus) : best.menu;
    const pricedAll = result.entries.filter((e) => e.price !== undefined && e.price > 0);
    const avgConf = pricedAll.length ? pricedAll.reduce((s, e) => s + (e.confidence ?? 0.7), 0) / pricedAll.length : 0;
    if (pricedAll.length >= minEntries && avgConf >= 0.6) break;
  }
  if (!best || !result) throw new Error('No se ha podido leer la carta');
  return { menu: { ...result, method: 'ocr', rawText: best.ocr.text }, ocr: best.ocr, passes: reports };
}
