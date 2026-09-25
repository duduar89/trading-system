import type { ProgressFn } from '../types';
import { buildLines, linesToText, looksLikeText, type PositionedText } from './layout';

/**
 * Lectura de PDF con pdf.js (pdfjs-dist) en el navegador. El worker se carga con
 * `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` (Vite) y `GlobalWorkerOptions.workerSrc`.
 *
 * Todo se importa bajo demanda: importar este módulo no carga pdf.js (los tests de Node pueden importar los parsers).
 * La reconstrucción de filas es lógica pura compartida (`layout.ts`) para que el banco de pruebas de Node use
 * exactamente el mismo algoritmo con el build "legacy" de pdf.js.
 */

export interface PdfTextItem {
  x: number;
  width: number;
  str: string;
}

export interface PdfTextLine {
  page: number;
  /** Coordenada vertical (de arriba a abajo). */
  y: number;
  /** Texto de la línea reconstruido con separadores: 2+ espacios o "\t" entre columnas separadas. */
  text: string;
  items: PdfTextItem[];
}

export interface PdfTextResult {
  pageCount: number;
  lines: PdfTextLine[];
  /** Texto completo (líneas unidas por \n, páginas separadas por \n\n). */
  text: string;
  /** false si el PDF parece escaneado (casi sin texto): habrá que usar OCR o IA. */
  hasText: boolean;
}

type PdfJs = typeof import('pdfjs-dist');
type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

interface PdfJsBundle {
  pdfjs: PdfJs;
  /** Decodificadores wasm de imágenes JBIG2 / JPEG 2000 (habituales en PDF escaneados por fotocopiadoras). */
  wasm: Record<string, string>;
}

let pdfjsPromise: Promise<PdfJsBundle> | undefined;

async function loadPdfJs(): Promise<PdfJsBundle> {
  if (typeof window === 'undefined' && typeof self === 'undefined') {
    throw new Error('La lectura de PDF sólo está disponible en el navegador');
  }
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, worker, jbig2, openjpeg] = await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        import('pdfjs-dist/wasm/jbig2.wasm?url'),
        import('pdfjs-dist/wasm/openjpeg.wasm?url'),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return { pdfjs, wasm: { 'jbig2.wasm': jbig2.default, 'openjpeg.wasm': openjpeg.default } };
    })().catch((err: unknown) => {
      pdfjsPromise = undefined;
      throw err;
    });
  }
  return pdfjsPromise;
}

/**
 * Fábrica de datos binarios para pdf.js: sirve los wasm empaquetados por Vite (nombres con hash) en lugar de
 * buscarlos en un directorio fijo. Sin ellos, las páginas escaneadas en JBIG2/JPX saldrían en blanco.
 */
function binaryDataFactory(wasm: Record<string, string>) {
  return class {
    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
      const url = kind === 'wasmUrl' ? wasm[filename] : undefined;
      if (!url) throw new Error(`Recurso de pdf.js no disponible: ${filename}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`No se ha podido cargar ${filename} (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    }
  };
}

function friendlyPdfError(err: unknown): Error {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'PasswordException') return new Error('El PDF está protegido con contraseña: quítasela o sube una captura de la factura');
  if (name === 'InvalidPDFException' || name === 'FormatError') return new Error('El archivo no es un PDF válido o está dañado');
  if (name === 'AbortError') return err as Error;
  return err instanceof Error ? err : new Error(String(err));
}

async function openPdf(file: Blob): Promise<{ pdfjs: PdfJs; doc: PdfDocument }> {
  const { pdfjs, wasm } = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, BinaryDataFactory: binaryDataFactory(wasm) }).promise;
    return { pdfjs, doc };
  } catch (err) {
    throw friendlyPdfError(err);
  }
}

interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/**
 * Convierte los ítems de texto de pdf.js (coordenadas PDF, origen abajo) a fragmentos posicionados de arriba a abajo.
 * Descarta textos girados (sellos, textos verticales del margen) que desordenarían las filas.
 * Exportado para el banco de pruebas en Node.
 */
export function pdfItemsToFragments(items: readonly unknown[], viewportTransform: number[]): PositionedText[] {
  const [va, vb, vc, vd, ve, vf] = viewportTransform;
  const out: PositionedText[] = [];
  for (const raw of items) {
    const it = raw as Partial<RawTextItem>;
    if (typeof it.str !== 'string' || !Array.isArray(it.transform) || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    // Matriz del texto en coordenadas de pantalla (viewport × texto)
    const ta = va * a + vc * b;
    const tb = vb * a + vd * b;
    const tc = va * c + vc * d;
    const td = vb * c + vd * d;
    const tx = va * e + vc * f + ve;
    const ty = vb * e + vd * f + vf;
    // Sólo texto horizontal
    if (Math.abs(tb) > Math.abs(ta) * 0.2) continue;
    const scaleX = Math.hypot(ta, tb) / (Math.hypot(a, b) || 1);
    const fontHeight = Math.hypot(tc, td) || Math.abs(it.height ?? 0);
    const width = Math.abs((it.width ?? 0) * scaleX);
    out.push({ str: it.str, x: ta >= 0 ? tx : tx - width, width, y: ty, height: fontHeight });
  }
  return out;
}

/** Extrae el texto con posiciones y reconstruye filas (agrupa ítems por Y con tolerancia, ordena por X). */
export async function extractPdfText(file: Blob, onProgress?: ProgressFn): Promise<PdfTextResult> {
  onProgress?.({ stage: 'Leyendo PDF…', progress: 0 });
  const { doc } = await openPdf(file);
  try {
    const lines: PdfTextLine[] = [];
    const pageCount = doc.numPages;
    for (let p = 1; p <= pageCount; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const fragments = pdfItemsToFragments(content.items, viewport.transform);
      for (const l of buildLines(fragments, p)) lines.push({ page: l.page, y: l.y, text: l.text, items: l.items });
      page.cleanup();
      onProgress?.({ stage: 'Leyendo PDF…', progress: p / pageCount });
    }
    return { pageCount, lines, text: linesToText(lines), hasText: looksLikeText(lines, pageCount) };
  } finally {
    void doc.destroy();
  }
}

interface RenderTarget {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  toBlob: () => Promise<Blob>;
}

function createTarget(width: number, height: number): RenderTarget {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('No se ha podido crear el lienzo para renderizar el PDF');
    return {
      canvas,
      ctx,
      toBlob: () =>
        new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se ha podido convertir la página a imagen'))), 'image/png'),
        ),
    };
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('No se ha podido crear el lienzo para renderizar el PDF');
    return { canvas, ctx, toBlob: () => canvas.convertToBlob({ type: 'image/png' }) };
  }
  throw new Error('Este navegador no permite renderizar PDF a imagen');
}

/** Renderiza páginas a imágenes PNG (para OCR o para enviarlas a la IA). */
export async function pdfToImages(
  file: Blob,
  opts: { scale?: number; maxPages?: number; maxSide?: number } = {},
  onProgress?: ProgressFn,
): Promise<Blob[]> {
  const scale = opts.scale ?? 2;
  const maxSide = opts.maxSide ?? 2400;
  onProgress?.({ stage: 'Preparando páginas…', progress: 0 });
  const { doc } = await openPdf(file);
  try {
    const count = Math.min(doc.numPages, opts.maxPages ?? doc.numPages);
    const out: Blob[] = [];
    for (let p = 1; p <= count; p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const s = Math.min(scale, maxSide / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale: s });
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      const target = createTarget(width, height);
      target.ctx.fillStyle = '#ffffff';
      target.ctx.fillRect(0, 0, width, height);
      const params =
        typeof HTMLCanvasElement !== 'undefined' && target.canvas instanceof HTMLCanvasElement
          ? { canvas: target.canvas, viewport }
          : { canvas: null, canvasContext: target.ctx as unknown as CanvasRenderingContext2D, viewport };
      await page.render(params).promise;
      out.push(await target.toBlob());
      page.cleanup();
      onProgress?.({ stage: 'Preparando páginas…', progress: p / count });
    }
    return out;
  } finally {
    void doc.destroy();
  }
}

export async function pdfPageCount(file: Blob): Promise<number> {
  const { doc } = await openPdf(file);
  try {
    return doc.numPages;
  } finally {
    void doc.destroy();
  }
}
