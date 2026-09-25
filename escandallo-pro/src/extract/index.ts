import type { AppSettings, ExtractedInvoice, ExtractedMenu, ProgressFn } from '../types';
import { todo } from '../lib/todo';

/**
 * Orquestador de extracción. Estrategia (de más a menos precisa):
 *  Facturas: IA (si hay clave, está activada y hay conexión) → texto del PDF + parser → OCR de páginas + parser.
 *            Hojas de cálculo (.xlsx/.csv) → spreadsheet (sin IA).
 *  Cartas:   IA (visión) → OCR local + parser.
 * Si la IA falla (sin conexión, error de clave, límite…), cae automáticamente al método local y lo indica en warnings.
 */

export function aiAvailable(settings: AppSettings): boolean {
  return !!(settings.aiEnabled && settings.apiKey && (typeof navigator === 'undefined' || navigator.onLine));
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

/** Extrae una o varias facturas de un archivo (un Excel puede traer muchas). */
export async function extractInvoicesFromFile(
  file: Blob & { name?: string },
  opts: { settings: AppSettings; onProgress?: ProgressFn; forceLocal?: boolean },
): Promise<ExtractedInvoice[]> {
  void file;
  void opts;
  return todo('extractInvoicesFromFile');
}

/** Extrae los platos de una o varias fotos de carta (o un PDF de carta). */
export async function extractMenuFromFiles(
  files: (Blob & { name?: string })[],
  opts: { settings: AppSettings; onProgress?: ProgressFn; forceLocal?: boolean },
): Promise<ExtractedMenu> {
  void files;
  void opts;
  return todo('extractMenuFromFiles');
}
