import type { ProgressFn } from '../types';
import { todo } from '../lib/todo';

/**
 * Lectura de PDF con pdf.js (pdfjs-dist) en el navegador. El worker se carga con
 * `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` (Vite) y `GlobalWorkerOptions.workerSrc`.
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

/** Extrae el texto con posiciones y reconstruye filas (agrupa ítems por Y con tolerancia, ordena por X). */
export async function extractPdfText(file: Blob, onProgress?: ProgressFn): Promise<PdfTextResult> {
  void file;
  void onProgress;
  return todo('extractPdfText');
}

/** Renderiza páginas a imágenes PNG (para OCR o para enviarlas a la IA). */
export async function pdfToImages(file: Blob, opts: { scale?: number; maxPages?: number } = {}, onProgress?: ProgressFn): Promise<Blob[]> {
  void file;
  void opts;
  void onProgress;
  return todo('pdfToImages');
}

export async function pdfPageCount(file: Blob): Promise<number> {
  void file;
  return todo('pdfPageCount');
}
