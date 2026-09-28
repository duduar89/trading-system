import type { AppSettings } from '../types';

/**
 * Utilidades ligeras de la extracción (sin parsers ni motores OCR): las pantallas y servicios las importan de aquí
 * para que el código pesado de lectura (extract/index) sólo se descargue cuando de verdad se lee un documento.
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
