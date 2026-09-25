import type { AppSettings, ExtractedMenu, ProgressFn } from '../types';
import { todo } from '../lib/todo';

/** Lectura de cartas con visión: una o varias fotos (o páginas de PDF renderizadas) → secciones, platos, descripciones y PVP. */
export async function aiExtractMenu(images: Blob[], settings: AppSettings, onProgress?: ProgressFn): Promise<ExtractedMenu> {
  void images;
  void settings;
  void onProgress;
  return todo('aiExtractMenu');
}
