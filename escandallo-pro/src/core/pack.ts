import type { InvoiceLine, PackSize } from '../types';
import { todo } from '../lib/todo';

/**
 * Formatos de envase y normalización de líneas de factura a precio por unidad base.
 */

/**
 * Detecta el formato de envase en una descripción de factura. Ejemplos:
 *  "ACEITE OLIVA V.E. GARRAFA 5L"      → { count: 1, size: 5, unit: 'l' }
 *  "LECHE ENTERA 6X1L" / "6 x 1 l"     → { count: 6, size: 1, unit: 'l' }
 *  "TOMATE PERA CAJA 6KG"              → { count: 1, size: 6, unit: 'kg' }
 *  "NATA 35% 1L BRIK 12UD" (12 x 1 l)  → { count: 12, size: 1, unit: 'l' }
 *  "BANDEJA 500GR" / "500 g"           → { count: 1, size: 500, unit: 'g' }
 *  "CERVEZA 1/3 PACK 24"               → { count: 24, size: 33.3, unit: 'cl' }
 *  "VINO TINTO 75CL"                   → { count: 1, size: 75, unit: 'cl' }
 *  "HUEVOS M 30 UDS" / "DOCENA HUEVOS" → { count: 30, size: 1, unit: 'ud' } / { count: 12, size: 1, unit: 'ud' }
 *  "LATA 2,5 KG"                       → { count: 1, size: 2.5, unit: 'kg' }
 * Devuelve undefined si no hay formato reconocible. No confundir porcentajes ("35%") ni calibres ("CAT.I", "T-3").
 */
export function parsePackSize(description: string): PackSize | undefined {
  void description;
  return todo('parsePackSize');
}

/** Cantidad total en unidad base de un formato: 6x1L → { unit: 'l', qty: 6 }. */
export function packToBase(pack: PackSize): { unit: 'kg' | 'l' | 'ud'; qty: number } {
  void pack;
  return todo('packToBase');
}

type LineInput = Pick<InvoiceLine, 'description' | 'quantity' | 'unit' | 'unitPrice' | 'total'> & Partial<Pick<InvoiceLine, 'discountPct' | 'packSize'>>;

/**
 * Calcula baseUnit, baseQuantity y pricePerBase (€/kg, €/l o €/ud, sin IVA, con descuento) de una línea.
 * Reglas:
 *  1. Importe efectivo = total si > 0; si no, quantity × unitPrice × (1 − descuento).
 *  2. Si la unidad facturada es de masa/volumen (kg, g, l, ml…) → base = kg/l, baseQuantity = cantidad convertida.
 *  3. Si es por unidad/caja/bot/paquete o desconocida y hay formato → baseQuantity = quantity × formato en base.
 *  4. Si no hay formato → base 'ud' (docena = 12 ud).
 *  pricePerBase = importe efectivo / baseQuantity.
 * Añade warnings en español si quantity × unitPrice × (1 − dto) no cuadra con total (tolerancia 2 cts o 1 %),
 * si la cantidad es ≤ 0, o si no se puede calcular el precio.
 */
export function normalizeInvoiceLine<T extends LineInput>(line: T): T & Pick<InvoiceLine, 'baseUnit' | 'baseQuantity' | 'pricePerBase' | 'warnings' | 'packSize'> {
  void line;
  return todo('normalizeInvoiceLine');
}
