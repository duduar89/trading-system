import type { ProgressFn } from '../types';
import { todo } from '../lib/todo';

/**
 * OCR local con tesseract.js (idioma 'spa'). Se carga bajo demanda (import dinámico) porque pesa.
 */

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  text: string;
  /** 0–100 */
  confidence: number;
  lines: OcrLine[];
}

/** Reconoce el texto de una o varias imágenes (páginas) y concatena resultados. */
export async function ocrImages(images: Blob[], onProgress?: ProgressFn): Promise<OcrResult> {
  void images;
  void onProgress;
  return todo('ocrImages');
}

/**
 * Prepara una foto para OCR/IA: corrige orientación EXIF, reduce al lado máximo indicado (por defecto 2200 px),
 * y opcionalmente pasa a escala de grises con algo de contraste. Devuelve JPEG/PNG.
 */
export async function preprocessImage(blob: Blob, opts: { maxSide?: number; grayscale?: boolean; mime?: 'image/jpeg' | 'image/png'; quality?: number } = {}): Promise<Blob> {
  void blob;
  void opts;
  return todo('preprocessImage');
}
