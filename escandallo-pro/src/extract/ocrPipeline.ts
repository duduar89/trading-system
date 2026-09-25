import type { ExtractedInvoice, ExtractedMenu, ProgressFn } from '../types';
import { approxEqual } from '../core/numbers';
import { prepareForOcr, resample, sauvola, type GrayImage, type OcrPrepInfo, type OcrPrepOptions } from './imageOps';
import { ocrPagesToResult, type LayoutMode, type TessPage } from './ocrLayout';
import { invoiceQuality, mergeInvoiceReadings, parseInvoiceReading, type InvoiceReading } from './invoiceParser';
import type { OcrResult } from './ocr';

/**
 * Orquestación del OCR local (lógica pura con el motor inyectado): la usan el navegador (tesseract.js en un worker)
 * y el banco de pruebas en Node (tesseract.js de Node), para que la calidad medida sea la que obtiene el usuario.
 *
 * Facturas: primera lectura con PSM 6 (bloque uniforme, ideal para tablas) sobre la imagen normalizada; si la
 * validación aritmética no cuadra (líneas sin validar o suma ≠ base imponible), segunda lectura con PSM 4 sobre la
 * imagen binarizada con Sauvola y, si aún hace falta, tercera con segmentación automática (PSM 3). Se combinan las
 * lecturas línea a línea quedándose con las que la aritmética valida.
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
    const page = await backend.recognize(imageFor(pages[i], pass), pass.psm, (f) => onFraction?.((i + Math.min(1, Math.max(0, f))) / pages.length));
    results.push({ page, pageNo: i + 1 });
    onFraction?.((i + 1) / pages.length);
  }
  return ocrPagesToResult(results, mode);
}

function validatedCount(inv: ExtractedInvoice): number {
  return inv.lines.filter((l) => (l.confidence ?? 0) >= 0.8).length;
}

/** ¿La lectura cuadra? Todas las líneas validadas y, si hay base imponible, la suma coincide. */
export function invoiceLooksComplete(inv: ExtractedInvoice): boolean {
  if (!inv.lines.length) return false;
  if (validatedCount(inv) < inv.lines.length) return false;
  if (inv.subtotal === undefined) return inv.total !== undefined;
  const sum = inv.lines.reduce((s, l) => s + l.total, 0);
  return approxEqual(sum, inv.subtotal, 0.05, 0.002) || (inv.total !== undefined && approxEqual(sum, inv.total, 0.05, 0.002));
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

/** OCR de una factura con reintentos guiados por la validación aritmética. */
export async function ocrInvoice(pages: PreparedPage[], backend: OcrBackend, opts: PipelineOptions = {}): Promise<InvoiceOcrOutcome> {
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
  parse: (text: string) => ExtractedMenu,
  opts: PipelineOptions & { minEntries?: number } = {},
): Promise<MenuOcrOutcome> {
  const passes = (opts.passes ?? MENU_PASSES).slice(0, Math.max(1, opts.maxPasses ?? Infinity));
  const now = opts.now ?? (() => Date.now());
  const base = opts.stage ?? 'Leyendo texto (OCR)…';
  const minEntries = opts.minEntries ?? 4;
  const reports: PassReport[] = [];
  let best: { menu: ExtractedMenu; ocr: OcrResult; q: number } | undefined;
  for (let k = 0; k < passes.length; k++) {
    const pass = passes[k];
    const t0 = now();
    const stage = k === 0 ? base : 'Segunda lectura de la carta…';
    const from = k === 0 ? 0 : 0.8 + (0.2 * (k - 1)) / Math.max(1, passes.length - 1);
    const to = k === 0 ? 0.8 : 0.8 + (0.2 * k) / Math.max(1, passes.length - 1);
    const ocr = await recognizePages(pages, backend, pass, 'columns', (f) => opts.onProgress?.({ stage, progress: from + (to - from) * f }));
    const menu = parse(ocr.text);
    const q = menuQuality(menu);
    const priced = menu.entries.filter((e) => e.price !== undefined && e.price > 0);
    reports.push({ id: pass.id, psm: pass.psm, binarize: pass.binarize, lines: menu.entries.length, validated: priced.length, quality: q, ms: now() - t0 });
    if (!best || q > best.q) best = { menu, ocr, q };
    const avgConf = priced.length ? priced.reduce((s, e) => s + (e.confidence ?? 0.7), 0) / priced.length : 0;
    if (priced.length >= minEntries && avgConf >= 0.6) break;
  }
  if (!best) throw new Error('No se ha podido leer la carta');
  return { menu: { ...best.menu, method: 'ocr', rawText: best.ocr.text }, ocr: best.ocr, passes: reports };
}
