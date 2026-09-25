import type { ExtractedMenu } from '../types';
import { todo } from '../lib/todo';

/**
 * Parser heurístico de cartas de restaurante (texto OCR) — funciona sin IA.
 * Detecta secciones (ENTRANTES, PRINCIPALES, CARNES, PESCADOS, POSTRES, PARA COMPARTIR…, líneas en mayúsculas sin precio),
 * platos con su precio ("Croquetas de jamón ........ 9,50 €", "Pulpo a la gallega 18", "Tataki de atún  16,90"),
 * descripciones en la línea siguiente sin precio, precios de media ración / ración (usa el de ración completa),
 * y descarta ruido (teléfonos, horarios, "IVA incluido", alérgenos, direcciones).
 */
export function parseMenuText(text: string, method: 'ocr' | 'pdf-texto'): ExtractedMenu {
  void text;
  void method;
  return todo('parseMenuText');
}
