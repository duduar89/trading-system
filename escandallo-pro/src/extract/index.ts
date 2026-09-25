import type { AppSettings, ExtractedInvoice, ExtractedMenu, ProgressFn } from '../types';
import { normalizeText } from '../core/matching';
import { extractPdfText, pdfToImages, type PdfTextLine } from './pdf';
import { ocrInvoiceImages, ocrMenuImages, preprocessImage, type OcrResult } from './ocr';
import { invoiceQuality, parseInvoiceText } from './invoiceParser';
import { menuQuality, mergeMenuPasses, parseMenuText } from './menuParser';
import { guessColumnMapping, readSpreadsheet, sheetToInvoices } from './spreadsheet';
import { columnsReadingOrder, menuBoxesFromOcr } from './ocrLayout';
import { linesToText } from './layout';

/**
 * Orquestador de extracción. Estrategia (de más a menos precisa):
 *  Facturas: IA (si hay clave, está activada y hay conexión) → texto del PDF + parser → OCR de páginas + parser.
 *            Hojas de cálculo (.xlsx/.csv) → spreadsheet (sin IA).
 *  Cartas:   IA (visión) → OCR local + parser.
 * Si la IA falla (sin conexión, error de clave, límite…), cae automáticamente al método local y lo indica en warnings.
 *
 * La lectura local es gratuita y se hace en el dispositivo: el documento no se envía a ningún sitio.
 * La IA (opcional, desactivada por defecto) se carga bajo demanda sólo si el usuario la ha activado con su clave.
 */

export function aiAvailable(settings: AppSettings): boolean {
  // navigator.onLine sólo es fiable cuando vale false (sin conexión); fuera del navegador puede no existir
  return !!(settings.aiEnabled && settings.apiKey && (typeof navigator === 'undefined' || navigator.onLine !== false));
}

export type FileKind = 'pdf' | 'image' | 'sheet' | 'unknown';

export function fileKind(file: { name?: string; type?: string }): FileKind {
  const name = (file.name ?? '').toLowerCase();
  const type = (file.type ?? '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(name)) return 'image';
  if (/\.(xlsx|xlsm|csv|tsv|txt)$/.test(name) || type.includes('spreadsheet') || type.includes('csv')) return 'sheet';
  return 'unknown';
}

/** Tipo real por la firma de los primeros bytes (archivos sin nombre ni tipo, o con extensión equivocada). */
async function sniffKind(file: Blob): Promise<FileKind> {
  try {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'; // %PDF
    if (b[0] === 0xff && b[1] === 0xd8) return 'image'; // JPEG
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image'; // PNG
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image'; // WEBP
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image'; // HEIC/AVIF (ftyp)
    if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'sheet'; // ZIP (xlsx)
  } catch {
    // Archivo ilegible: se informa como no admitido
  }
  return 'unknown';
}

async function resolveKind(file: Blob & { name?: string }): Promise<FileKind> {
  const kind = fileKind(file);
  return kind === 'unknown' ? sniffKind(file) : kind;
}

const UNSUPPORTED = 'Formato no admitido: sube un PDF, una foto (JPG, PNG, WebP o HEIC) o un Excel/CSV';

// ───────────────────────────── Utilidades ─────────────────────────────

/** Progreso de una fase dentro del tramo [a, b] de la barra global. */
function scoped(onProgress: ProgressFn | undefined, a: number, b: number): ProgressFn | undefined {
  if (!onProgress) return undefined;
  return (p) => onProgress({ stage: p.stage, progress: p.progress === undefined ? undefined : a + (b - a) * Math.min(1, Math.max(0, p.progress)) });
}

function isAbort(err: unknown): boolean {
  return (err as { name?: string } | undefined)?.name === 'AbortError';
}

function reasonOf(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return msg.trim().replace(/[.\s]+$/, '') || 'error desconocido';
}

function aiFallbackWarning(err: unknown): string {
  return `La IA no estaba disponible (${reasonOf(err)}); se ha usado lectura local`;
}

function withWarnings<T extends { warnings: string[] }>(item: T, extra: string[]): T {
  if (!extra.length) return item;
  return { ...item, warnings: [...new Set([...extra, ...item.warnings])] };
}

const LOW_CONFIDENCE_WARNING = 'La imagen se lee con dificultad: revisa los datos o sube una foto más nítida, de frente y con buena luz';

// ───────────────────────────── Facturas ─────────────────────────────

/**
 * Un PDF puede traer varias facturas seguidas (p. ej. todas las del mes de un distribuidor). Se agrupan las páginas
 * consecutivas por número de factura: si salen al menos dos grupos distintos y todos tienen líneas, se devuelve una
 * factura por grupo. Si no, una sola con todas las páginas.
 */
export function parseInvoicePages(lines: PdfTextLine[], method: 'pdf-texto' | 'ocr'): ExtractedInvoice[] {
  const whole = parseInvoiceText({ text: linesToText(lines) }, method, lines);
  const pages = [...new Set(lines.map((l) => l.page))].sort((a, b) => a - b);
  if (pages.length < 2) return [whole];
  const groups: { number?: string; pages: number[] }[] = [];
  for (const p of pages) {
    const pl = lines.filter((l) => l.page === p);
    const inv = parseInvoiceText({ text: linesToText(pl) }, method, pl);
    const last = groups[groups.length - 1];
    if (last && (!inv.number || !last.number || inv.number === last.number)) {
      last.pages.push(p);
      last.number ??= inv.number;
    } else {
      groups.push({ number: inv.number, pages: [p] });
    }
  }
  if (groups.length < 2) return [whole];
  const parsed = groups.map((g) => {
    const gl = lines.filter((l) => g.pages.includes(l.page));
    return parseInvoiceText({ text: linesToText(gl) }, method, gl);
  });
  if (parsed.some((inv) => !inv.lines.length)) return [whole];
  return parsed;
}

async function invoicesFromSheet(file: Blob & { name?: string }, onProgress?: ProgressFn): Promise<ExtractedInvoice[]> {
  onProgress?.({ stage: 'Leyendo la hoja de cálculo…', progress: 0.1 });
  const sheets = await readSpreadsheet(file, file.name ?? 'facturas.csv');
  onProgress?.({ stage: 'Interpretando líneas…', progress: 0.6 });
  const out: ExtractedInvoice[] = [];
  for (const sheet of sheets) {
    if (!sheet.rows.some((r) => r.some((c) => c !== null && String(c).trim() !== ''))) continue;
    const { headerRow, mapping } = guessColumnMapping(sheet.rows);
    if (mapping.description === undefined || mapping.description < 0) continue;
    const invoices = sheetToInvoices(sheet.rows, mapping, headerRow);
    for (const inv of invoices) if (inv.lines.length) out.push(inv);
  }
  onProgress?.({ stage: 'Hoja leída', progress: 1 });
  if (!out.length) {
    throw new Error('No se han encontrado líneas de factura en la hoja: comprueba que tiene columnas de descripción, cantidad y precio o importe');
  }
  return out;
}

async function aiInvoice(file: Blob, mediaType: string, settings: AppSettings, onProgress: ProgressFn | undefined, warnings: string[]): Promise<ExtractedInvoice | undefined> {
  onProgress?.({ stage: 'Analizando con IA…', progress: 0 });
  try {
    // Import dinámico: el SDK y los esquemas de la IA sólo se cargan si el usuario la ha activado
    const { aiExtractInvoice } = await import('../ai/invoice');
    const inv = await aiExtractInvoice(file, mediaType, settings, onProgress);
    if (inv.lines.length) return inv;
    warnings.push('La IA no ha encontrado líneas de producto; se ha usado lectura local');
  } catch (err) {
    if (isAbort(err)) throw err;
    warnings.push(aiFallbackWarning(err));
  }
  return undefined;
}

async function ocrInvoiceFrom(images: Blob[], onProgress: ProgressFn | undefined): Promise<ExtractedInvoice[]> {
  const outcome = await ocrInvoiceImages(images, onProgress);
  const extra: string[] = [];
  if (outcome.ocr.confidence > 0 && outcome.ocr.confidence < 60) extra.push(LOW_CONFIDENCE_WARNING);
  // Varias facturas en un mismo PDF escaneado
  if (images.length > 1 && outcome.ocr.rows?.length) {
    const split = parseInvoicePages(outcome.ocr.rows, 'ocr');
    if (split.length > 1) return split.map((inv) => withWarnings(inv, extra));
  }
  return [withWarnings(outcome.invoice, extra)];
}

/** Extrae una o varias facturas de un archivo (un Excel puede traer muchas). */
export async function extractInvoicesFromFile(
  file: Blob & { name?: string },
  opts: { settings: AppSettings; onProgress?: ProgressFn; forceLocal?: boolean },
): Promise<ExtractedInvoice[]> {
  const { settings, onProgress } = opts;
  if (!file || !file.size) throw new Error('El archivo está vacío');
  const kind = await resolveKind(file);
  if (kind === 'unknown') throw new Error(UNSUPPORTED);
  if (kind === 'sheet') return invoicesFromSheet(file, onProgress);

  const useAi = !opts.forceLocal && aiAvailable(settings);
  const warnings: string[] = [];

  if (kind === 'pdf') {
    if (useAi) {
      const inv = await aiInvoice(file, 'application/pdf', settings, scoped(onProgress, 0, 0.5), warnings);
      if (inv) return [inv];
    }
    const base = useAi ? 0.5 : 0;
    const span = 1 - base;
    const text = await extractPdfText(file, scoped(onProgress, base, base + span * 0.1));
    let textResult: ExtractedInvoice[] | undefined;
    if (text.hasText) {
      onProgress?.({ stage: 'Interpretando líneas…', progress: base + span * 0.12 });
      textResult = parseInvoicePages(text.lines, 'pdf-texto');
      if (textResult.some((inv) => inv.lines.length)) {
        onProgress?.({ stage: 'Factura leída', progress: 1 });
        return textResult.map((inv) => withWarnings(inv, warnings));
      }
    }
    // PDF escaneado (o capa de texto sin tabla): OCR de las páginas renderizadas a ~300 ppp
    onProgress?.({ stage: 'Reconociendo texto…', progress: base + span * 0.15 });
    try {
      const images = await pdfToImages(file, { scale: 300 / 72, maxSide: 3300, maxPages: 20 }, scoped(onProgress, base + span * 0.15, base + span * 0.25));
      const ocr = await ocrInvoiceFrom(images, scoped(onProgress, base + span * 0.25, 1));
      if (textResult && invoiceQuality(textResult[0]) >= invoiceQuality(ocr[0])) return textResult.map((inv) => withWarnings(inv, warnings));
      onProgress?.({ stage: 'Factura leída', progress: 1 });
      return ocr.map((inv) => withWarnings(inv, warnings));
    } catch (err) {
      if (isAbort(err) || !textResult) throw err;
      return textResult.map((inv) => withWarnings(inv, [...warnings, `No se ha podido leer el PDF como imagen (${reasonOf(err)})`]));
    }
  }

  // Foto
  if (useAi) {
    // Enderezada (EXIF) y reducida: la petición es más rápida y barata. Si no se puede abrir, el error es claro (HEIC).
    let prepared: Blob | undefined;
    try {
      prepared = await preprocessImage(file, { maxSide: 2000, mime: 'image/jpeg' });
    } catch (err) {
      if (/HEIC/i.test(reasonOf(err))) throw err;
      warnings.push(aiFallbackWarning(err));
    }
    if (prepared) {
      const inv = await aiInvoice(prepared, 'image/jpeg', settings, scoped(onProgress, 0, 0.5), warnings);
      if (inv) return [inv];
    }
  }
  onProgress?.({ stage: 'Reconociendo texto…', progress: useAi ? 0.5 : 0 });
  const ocr = await ocrInvoiceFrom([file], scoped(onProgress, useAi ? 0.5 : 0, 1));
  onProgress?.({ stage: 'Factura leída', progress: 1 });
  return ocr.map((inv) => withWarnings(inv, warnings));
}

// ───────────────────────────── Cartas ─────────────────────────────

type MenuEntryOut = ExtractedMenu['entries'][number];

/** Quita platos repetidos (misma carta en dos fotos que se solapan): se queda con el más completo. */
export function dedupeMenuEntries(entries: MenuEntryOut[]): MenuEntryOut[] {
  const out: MenuEntryOut[] = [];
  const index = new Map<string, number>();
  const score = (e: MenuEntryOut) => (e.price !== undefined ? 2 : 0) + (e.description ? 1 : 0) + (e.confidence ?? 0) + (e.section ? 0.5 : 0);
  for (const e of entries) {
    const key = normalizeText(e.name ?? '');
    if (!key) continue;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, out.length);
      out.push(e);
    } else if (score(e) > score(out[at])) {
      out[at] = { ...e, section: e.section ?? out[at].section, description: e.description ?? out[at].description };
    }
  }
  return out;
}

/**
 * Interpreta una lectura OCR de carta: el texto ya ordenado por columnas y las cajas de las palabras, con las que el
 * parser de cartas empareja cada precio con el plato de su misma fila aunque la foto esté algo girada.
 */
export function parseMenuOcr(text: string, ocr: OcrResult): ExtractedMenu {
  return parseMenuText(text, 'ocr', menuBoxesFromOcr(ocr));
}

/** Extrae los platos de una o varias fotos de carta (o un PDF de carta). */
export async function extractMenuFromFiles(
  files: (Blob & { name?: string })[],
  opts: { settings: AppSettings; onProgress?: ProgressFn; forceLocal?: boolean },
): Promise<ExtractedMenu> {
  const { settings, onProgress } = opts;
  const valid = (files ?? []).filter((f) => f && f.size > 0);
  if (!valid.length) throw new Error('Añade al menos una foto de la carta');
  const kinds = await Promise.all(valid.map((f) => resolveKind(f)));
  if (kinds.some((k) => k !== 'pdf' && k !== 'image')) throw new Error('Formato no admitido: sube fotos de la carta (JPG, PNG, WebP o HEIC) o un PDF');
  const warnings: string[] = [];
  const useAi = !opts.forceLocal && aiAvailable(settings);

  if (useAi) {
    onProgress?.({ stage: 'Analizando con IA…', progress: 0 });
    try {
      const { aiExtractMenu } = await import('../ai/menu');
      const menu = await aiExtractMenu(valid, settings, scoped(onProgress, 0, 0.5));
      if (menu.entries.length) return { ...menu, entries: dedupeMenuEntries(menu.entries) };
      warnings.push('La IA no ha encontrado platos; se ha usado lectura local');
    } catch (err) {
      if (isAbort(err)) throw err;
      warnings.push(aiFallbackWarning(err));
    }
  }

  const base = useAi ? 0.5 : 0;
  const span = 1 - base;
  const texts: string[] = [];
  const images: Blob[] = [];
  let usedOcr = false;
  // PDF con texto (carta digital): se lee directamente y en orden de columnas; si es escaneado, se renderiza para OCR
  for (let i = 0; i < valid.length; i++) {
    const f = valid[i];
    if (kinds[i] !== 'pdf') {
      images.push(f);
      continue;
    }
    const pdfText = await extractPdfText(f, scoped(onProgress, base, base + span * 0.1));
    if (pdfText.hasText) {
      texts.push(linesToText(columnsReadingOrder(pdfText.lines)));
    } else {
      onProgress?.({ stage: 'Reconociendo texto…', progress: base + span * 0.1 });
      images.push(...(await pdfToImages(f, { scale: 300 / 72, maxSide: 3300, maxPages: 12 }, scoped(onProgress, base + span * 0.1, base + span * 0.2))));
    }
  }

  const entries: MenuEntryOut[] = [];
  const rawTexts: string[] = [];
  if (texts.length) {
    onProgress?.({ stage: 'Interpretando la carta…', progress: base + span * 0.2 });
    const menu = parseMenuText(texts.join('\n\n'), 'pdf-texto');
    entries.push(...menu.entries);
    warnings.push(...menu.warnings);
    rawTexts.push(menu.rawText ?? texts.join('\n\n'));
  }
  if (images.length) {
    usedOcr = true;
    onProgress?.({ stage: 'Reconociendo texto…', progress: base + span * 0.2 });
    const outcome = await ocrMenuImages(images, parseMenuOcr, scoped(onProgress, base + span * 0.2, 1), { merge: mergeMenuPasses, quality: menuQuality });
    entries.push(...outcome.menu.entries);
    warnings.push(...outcome.menu.warnings);
    rawTexts.push(outcome.ocr.text);
    if (outcome.ocr.confidence > 0 && outcome.ocr.confidence < 60) warnings.push(LOW_CONFIDENCE_WARNING);
  }
  onProgress?.({ stage: 'Carta leída', progress: 1 });
  return {
    entries: dedupeMenuEntries(entries),
    method: usedOcr ? 'ocr' : 'pdf-texto',
    rawText: rawTexts.join('\n\n'),
    warnings: [...new Set(warnings)],
  };
}
