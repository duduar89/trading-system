import type { ExtractedMenu, ProgressFn } from '../types';
import type { PdfTextLine } from './pdf';
import { encodePgm, grayToRgba, rgbaToGray, stretchContrast, type GrayImage, type OcrPrepOptions } from './imageOps';
import { ocrPagesToResult, type LayoutMode, type TessPage } from './ocrLayout';
import {
  ocrInvoice,
  ocrMenu,
  preparePages,
  recognizePages,
  type InvoiceOcrOutcome,
  type MenuOcrOutcome,
  type OcrBackend,
  type OcrPass,
  type PreparedPage,
  type Psm,
} from './ocrPipeline';
import type { PrepRequest, PrepResponse } from './prep.worker';

/**
 * OCR local con tesseract.js (idioma 'spa', modelos LSTM "best_int": los más precisos que admite tesseract.js).
 * Gratis y en el dispositivo: la imagen nunca sale del navegador. Se carga bajo demanda (import dinámico) porque pesa;
 * el modelo de idioma se descarga la primera vez y el service worker lo deja en caché para trabajar sin conexión.
 *
 * Este módulo es el adaptador del navegador (canvas + worker de Tesseract). La lógica de verdad es pura y está en
 * `imageOps.ts` (preparación de la imagen), `ocrLayout.ts` (filas a partir de las palabras) y `ocrPipeline.ts`
 * (pasadas y validación), que comparte el banco de pruebas de Node. Importarlo no carga nada pesado.
 */

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Palabra reconocida con su caja (coordenadas de la imagen preparada de su página). */
export interface OcrWord {
  text: string;
  /** 0–100 */
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  page: number;
  /** Índice de línea de Tesseract (global en la página). */
  line: number;
  /** Índice de bloque de Tesseract. */
  block: number;
  /** Línea base a la altura de la palabra. */
  baselineY?: number;
  /** Altura de la línea de texto a la que pertenece. */
  lineHeight?: number;
  /** Línea base de la línea de Tesseract (mide la inclinación de la foto). */
  baseline?: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  text: string;
  /** 0–100 */
  confidence: number;
  lines: OcrLine[];
  /** Palabras con posición (si el motor las ha devuelto). */
  words?: OcrWord[];
  /** Filas reconstruidas con las posiciones X de cada celda (mismo formato que la capa de texto de un PDF). */
  rows?: PdfTextLine[];
}

// ───────────────────────────── Worker de Tesseract ─────────────────────────────

type TesseractModule = typeof import('tesseract.js');
type TesseractWorker = Awaited<ReturnType<TesseractModule['createWorker']>>;

interface LoggerMessage {
  status: string;
  progress: number;
}

const IDLE_MS = 90_000;
let workerPromise: Promise<TesseractWorker> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();
/** Destino del progreso del trabajo en curso (el logger del worker es único). */
let progressSink: ((m: LoggerMessage) => void) | undefined;

function assertBrowser(): void {
  if (typeof window === 'undefined' && typeof self === 'undefined') throw new Error('El OCR sólo está disponible en el navegador');
}

function friendlyOcrError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/fetch|network|load|traineddata|download|Failed to/i.test(msg)) {
    return new Error('No se ha podido preparar el lector de texto: la primera vez necesita conexión para descargarse (unos 5 MB). Después funciona sin conexión.');
  }
  return err instanceof Error ? err : new Error(msg || 'Error del lector de texto');
}

async function getWorker(): Promise<TesseractWorker> {
  assertBrowser();
  if (!workerPromise) {
    workerPromise = (async () => {
      const mod = await import('tesseract.js');
      const T = ((mod as unknown as { default?: TesseractModule }).default ?? mod) as TesseractModule;
      // OEM 1 = sólo LSTM (modelos best_int, los más precisos disponibles en tesseract.js)
      const worker = await T.createWorker('spa', 1, {
        logger: (m: LoggerMessage) => progressSink?.(m),
        errorHandler: () => undefined,
      });
      await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
      return worker;
    })().catch((err: unknown) => {
      workerPromise = undefined;
      throw friendlyOcrError(err);
    });
  }
  return workerPromise;
}

function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void terminateOcr(), IDLE_MS);
}

/** Libera el worker de Tesseract (memoria). Se vuelve a crear solo cuando haga falta. */
export async function terminateOcr(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
  const p = workerPromise;
  workerPromise = undefined;
  if (!p) return;
  try {
    const w = await p;
    await w.terminate();
  } catch {
    // Ya estaba roto: nada que liberar
  }
}

/** Ejecuta trabajos de OCR de uno en uno (un solo worker y un solo logger). */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

const LOAD_STAGES: Record<string, string> = {
  'loading tesseract core': 'Preparando el lector de texto (sólo la primera vez)…',
  'initializing tesseract': 'Preparando el lector de texto…',
  'loading language traineddata': 'Descargando el idioma español (sólo la primera vez)…',
  'loading language traineddata (from cache)': 'Preparando el lector de texto…',
  'initializing api': 'Preparando el lector de texto…',
};

/** Motor del navegador: imagen en escala de grises → PGM → Tesseract (salida por bloques con cajas). */
function browserBackend(onLoad?: ProgressFn): OcrBackend {
  return {
    async recognize(image: GrayImage, psm: Psm, onProgress?: (fraction: number) => void): Promise<TessPage> {
      progressSink = (m) => {
        if (m.status === 'recognizing text') onProgress?.(m.progress);
        // Carga del motor: sólo el texto de la etapa (la barra sigue donde estaba)
        else if (LOAD_STAGES[m.status]) onLoad?.({ stage: LOAD_STAGES[m.status] });
      };
      try {
        const worker = await getWorker();
        const blob = new Blob([encodePgm(image)], { type: 'image/x-portable-graymap' });
        const options = { tessedit_pageseg_mode: psm } as unknown as Parameters<TesseractWorker['recognize']>[1];
        const res = await worker.recognize(blob, options, { text: true, blocks: true });
        return res.data as unknown as TessPage;
      } catch (err) {
        throw friendlyOcrError(err);
      } finally {
        progressSink = undefined;
        scheduleIdle();
      }
    },
  };
}

// ───────────────────────────── Decodificación de imágenes ─────────────────────────────

interface Surface {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function surface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) return { canvas, ctx };
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) return { canvas, ctx };
  }
  throw new Error('Este navegador no permite procesar imágenes');
}

async function toBlob(s: Surface, mime: string, quality?: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && s.canvas instanceof OffscreenCanvas) return s.canvas.convertToBlob({ type: mime, quality });
  const canvas = s.canvas as HTMLCanvasElement;
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se ha podido convertir la imagen'))), mime, quality));
}

function isHeic(blob: Blob & { name?: string }): boolean {
  return /hei[cf]/i.test(blob.type || '') || /\.hei[cf]$/i.test(blob.name ?? '');
}

/** Decodifica con la orientación EXIF aplicada. Errores con mensaje claro (HEIC en navegadores que no lo leen). */
async function decode(blob: Blob & { name?: string }): Promise<ImageBitmap | HTMLImageElement> {
  assertBrowser();
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // Algunos Safari antiguos no aceptan opciones: se reintenta con <img>
    }
  }
  if (typeof Image !== 'undefined' && typeof URL !== 'undefined') {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } catch {
      // se informa abajo
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (isHeic(blob)) throw new Error('Formato HEIC no compatible en este navegador: expórtala como JPG');
  throw new Error('No se ha podido abrir la imagen: comprueba que es una foto válida (JPG, PNG o WebP)');
}

function sizeOf(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return 'naturalWidth' in src ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height };
}

/** Dibuja la imagen reducida (lado mayor ≤ maxSide) y devuelve la superficie. */
async function draw(blob: Blob & { name?: string }, maxSide: number): Promise<Surface> {
  const src = await decode(blob);
  try {
    const { w, h } = sizeOf(src);
    if (!w || !h) throw new Error('La imagen está vacía');
    const s = Math.min(1, maxSide / Math.max(w, h));
    const W = Math.max(1, Math.round(w * s));
    const H = Math.max(1, Math.round(h * s));
    const surf = surface(W, H);
    surf.ctx.imageSmoothingEnabled = true;
    surf.ctx.imageSmoothingQuality = 'high';
    surf.ctx.fillStyle = '#ffffff';
    surf.ctx.fillRect(0, 0, W, H);
    surf.ctx.drawImage(src, 0, 0, W, H);
    return surf;
  } finally {
    if ('close' in src) src.close();
  }
}

/** Decodifica una foto o página a escala de grises (lado mayor ≤ maxSide, 3200 px por defecto). */
export async function loadGrayImage(blob: Blob & { name?: string }, maxSide = 3200): Promise<GrayImage> {
  const surf = await draw(blob, maxSide);
  const { width, height } = surf.canvas;
  const data = surf.ctx.getImageData(0, 0, width, height).data;
  return rgbaToGray(data, width, height);
}

/**
 * Prepara una foto para OCR/IA: corrige orientación EXIF, reduce al lado máximo indicado (por defecto 2200 px),
 * y opcionalmente pasa a escala de grises con algo de contraste. Devuelve JPEG/PNG.
 */
export async function preprocessImage(blob: Blob, opts: { maxSide?: number; grayscale?: boolean; mime?: 'image/jpeg' | 'image/png'; quality?: number } = {}): Promise<Blob> {
  const surf = await draw(blob, opts.maxSide ?? 2200);
  const { width, height } = surf.canvas;
  if (opts.grayscale) {
    const img = surf.ctx.getImageData(0, 0, width, height);
    const gray = rgbaToGray(img.data, width, height);
    stretchContrast(gray);
    img.data.set(grayToRgba(gray));
    surf.ctx.putImageData(img, 0, 0);
  }
  const mime = opts.mime ?? 'image/jpeg';
  return toBlob(surf, mime, mime === 'image/jpeg' ? (opts.quality ?? 0.9) : undefined);
}

// ───────────────────────────── API ─────────────────────────────

export interface OcrOptions {
  /** 'table' (facturas, por defecto) o 'columns' (cartas a varias columnas). */
  mode?: LayoutMode;
  psm?: Psm;
  binarize?: boolean;
  prep?: OcrPrepOptions;
}

const DECODE_MAX_SIDE = 3200;

/** Preparación en un Web Worker (no congela la interfaz). undefined si el navegador no lo permite o falla. */
async function prepareInWorker(images: Blob[], prep: OcrPrepOptions): Promise<PreparedPage[] | undefined> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return undefined;
  let worker: Worker | undefined;
  try {
    const w = new Worker(new URL('./prep.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    const res = await new Promise<PrepResponse>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<PrepResponse>) => resolve(e.data);
      w.onerror = (e) => reject(new Error(e.message || 'Error al preparar la imagen'));
      const req: PrepRequest = { id: 1, blobs: images, maxSide: DECODE_MAX_SIDE, prep };
      w.postMessage(req);
    });
    if (!res.ok) return undefined;
    return res.pages.map((p) => ({ image: { width: p.width, height: p.height, data: p.data }, info: p.info }));
  } catch {
    return undefined;
  } finally {
    worker?.terminate();
  }
}

async function preparedFrom(images: Blob[], onProgress: ProgressFn | undefined, prep: OcrPrepOptions = {}): Promise<PreparedPage[]> {
  onProgress?.({ stage: images.length > 1 ? `Preparando ${images.length} imágenes…` : 'Preparando la imagen…', progress: 0 });
  const viaWorker = await prepareInWorker(images, prep);
  if (viaWorker) {
    onProgress?.({ stage: 'Preparando la imagen…', progress: 1 });
    return viaWorker;
  }
  // Hilo principal (navegadores sin OffscreenCanvas o formatos que sólo abre <img>, con mensajes de error claros)
  const grays: GrayImage[] = [];
  for (let i = 0; i < images.length; i++) {
    onProgress?.({ stage: images.length > 1 ? `Preparando la imagen ${i + 1} de ${images.length}…` : 'Preparando la imagen…', progress: i / images.length });
    grays.push(await loadGrayImage(images[i] as Blob & { name?: string }, DECODE_MAX_SIDE));
    // Cede el hilo entre páginas para que la interfaz siga respondiendo
    await new Promise((r) => setTimeout(r, 0));
  }
  const pages = preparePages(grays, prep);
  onProgress?.({ stage: 'Preparando la imagen…', progress: 1 });
  return pages;
}

/** Reparte el progreso en tramos [a, b] de la barra global. */
function slice(onProgress: ProgressFn | undefined, a: number, b: number): ProgressFn | undefined {
  if (!onProgress) return undefined;
  return (p) => onProgress({ stage: p.stage, progress: p.progress === undefined ? undefined : a + (b - a) * Math.min(1, Math.max(0, p.progress)) });
}

/** Reconoce el texto de una o varias imágenes (páginas) y concatena resultados. */
export async function ocrImages(images: Blob[], onProgress?: ProgressFn, opts: OcrOptions = {}): Promise<OcrResult> {
  if (!images.length) return { text: '', confidence: 0, lines: [] };
  const pages = await preparedFrom(images, slice(onProgress, 0, 0.1), opts.prep);
  const pass: OcrPass = { id: 'unica', psm: opts.psm ?? (opts.mode === 'columns' ? '3' : '6'), binarize: !!opts.binarize };
  const stage = 'Leyendo texto (OCR)…';
  const p = slice(onProgress, 0.1, 1);
  return enqueue(() => recognizePages(pages, browserBackend(p), pass, opts.mode ?? 'table', (f) => p?.({ stage, progress: f })));
}

/**
 * OCR de una factura (fotos o páginas renderizadas) con reintentos guiados por la validación aritmética.
 * Devuelve la factura interpretada y el OCR de la mejor lectura.
 */
export async function ocrInvoiceImages(images: Blob[], onProgress?: ProgressFn, opts: { maxPasses?: number; prep?: OcrPrepOptions } = {}): Promise<InvoiceOcrOutcome> {
  if (!images.length) throw new Error('No hay imágenes que leer');
  const pages = await preparedFrom(images, slice(onProgress, 0, 0.1), opts.prep);
  const p = slice(onProgress, 0.1, 1);
  return enqueue(() => ocrInvoice(pages, browserBackend(p), { onProgress: p, maxPasses: opts.maxPasses }));
}

/** OCR de una carta con detección de columnas; `parse` interpreta el texto y las cajas (parser de cartas). */
export async function ocrMenuImages(
  images: Blob[],
  parse: (text: string, ocr: OcrResult) => ExtractedMenu,
  onProgress?: ProgressFn,
  opts: { maxPasses?: number; prep?: OcrPrepOptions; merge?: (menus: ExtractedMenu[]) => ExtractedMenu; quality?: (menu: ExtractedMenu) => number } = {},
): Promise<MenuOcrOutcome> {
  if (!images.length) throw new Error('No hay imágenes que leer');
  const pages = await preparedFrom(images, slice(onProgress, 0, 0.1), opts.prep);
  const p = slice(onProgress, 0.1, 1);
  return enqueue(() => ocrMenu(pages, browserBackend(p), parse, { onProgress: p, maxPasses: opts.maxPasses, merge: opts.merge, quality: opts.quality }));
}

/** Convierte una salida de Tesseract ya obtenida en OcrResult (útil para reprocesar sin volver a reconocer). */
export function ocrResultFromPages(pages: TessPage[], mode: LayoutMode = 'table'): OcrResult {
  return ocrPagesToResult(pages.map((page, i) => ({ page, pageNo: i + 1 })), mode);
}
