import type { ExtractedInvoice } from '../types';
import { todo } from '../lib/todo';

/**
 * Parser heurístico de facturas de proveedor (texto de PDF o de OCR) — funciona sin IA.
 *
 * Debe detectar: proveedor (primeras líneas / razón social / CIF-NIF "B12345678"), número de factura,
 * fecha, base imponible, IVA, total; y las LÍNEAS de producto. Para cada línea, prueba combinaciones de los
 * números encontrados para hallar (cantidad, precio, [dto %], importe) que cumplan
 * cantidad × precio × (1 − dto) ≈ importe; esa validación cruzada es la clave de la precisión.
 * Ignora cabeceras, subtotales, portes, líneas de IVA, "Suma y sigue", etc.
 * Cada línea sale normalizada con core/pack.normalizeInvoiceLine y con suggestedName = core/matching.cleanProductName.
 */
export function parseInvoiceText(input: { text: string; lines?: string[] }, method: 'pdf-texto' | 'ocr'): ExtractedInvoice {
  void input;
  void method;
  return todo('parseInvoiceText');
}
