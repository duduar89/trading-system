import type { AppSettings, ExtractedInvoice, ProgressFn } from '../types';
import { todo } from '../lib/todo';

/**
 * Extracción de facturas con Claude: PDF (bloque `document` base64) o imagen (bloque `image` base64).
 * Devuelve líneas con cantidad, unidad, formato, precio, dto, importe, IVA, nombre genérico sugerido y categoría,
 * más cabecera (proveedor, CIF, nº, fecha, base, IVA, total). Normaliza cada línea con core/pack.normalizeInvoiceLine.
 */
export async function aiExtractInvoice(file: Blob, mediaType: string, settings: AppSettings, onProgress?: ProgressFn): Promise<ExtractedInvoice> {
  void file;
  void mediaType;
  void settings;
  void onProgress;
  return todo('aiExtractInvoice');
}
