import type { ID, Invoice, InvoiceLine, Product } from '../types';
import { todo } from '../lib/todo';

/**
 * Flujo de facturas: subir → procesar (extraer + emparejar) → revisar → confirmar (actualiza precios).
 */

/**
 * Crea facturas 'pendiente' con el archivo original y lanza su procesado en segundo plano (secuencial, en cola).
 * Un Excel/CSV con muchas facturas genera varias. Devuelve los ids creados (al menos uno por archivo).
 */
export async function addInvoiceFiles(files: File[]): Promise<ID[]> {
  void files;
  return todo('addInvoiceFiles');
}

/**
 * Procesa una factura: status 'procesando' → extracción (extract/index) → líneas emparejadas con productos
 * (matchInvoiceLines) → status 'revision'. En error: status 'error' y mensaje legible.
 * `forceLocal` obliga a no usar IA.
 */
export async function processInvoice(id: ID, opts?: { forceLocal?: boolean }): Promise<void> {
  void id;
  void opts;
  return todo('processInvoice');
}

/** Estado de la cola de procesado (para mostrar progreso en la UI). Suscribible. */
export interface QueueState {
  running: ID | null;
  queued: ID[];
  stage?: string;
  progress?: number;
}
export function subscribeInvoiceQueue(fn: (s: QueueState) => void): () => void {
  void fn;
  return todo('subscribeInvoiceQueue');
}

/**
 * Empareja líneas con productos existentes (core/matching.rankMatches sobre nombre + alias, usando suggestedName y description).
 * score ≥ AUTO_LINK → 'vinculado'; ≥ SUGGEST → 'sugerido'; si no → 'nuevo'. No toca líneas 'ignorado' ni ya 'vinculado' manualmente.
 */
export function matchInvoiceLines(lines: InvoiceLine[], products: Product[]): InvoiceLine[] {
  void lines;
  void products;
  return todo('matchInvoiceLines');
}

/** Guarda cambios de la revisión (cabecera y/o líneas). Re-normaliza las líneas modificadas (core/pack). */
export async function updateInvoice(id: ID, patch: Partial<Invoice>): Promise<void> {
  void id;
  void patch;
  return todo('updateInvoice');
}

/**
 * Confirma la factura: proveedor (findOrCreateSupplier); por cada línea no ignorada con pricePerBase > 0:
 * 'nuevo' → crea producto (nombre = suggestedName, categoría sugerida) ; 'sugerido'/'vinculado' → usa productId.
 * Registra precio (setProductPrice con fecha de factura) y aprende alias (descripción original).
 * Marca status 'confirmada'. Idempotente: re-confirmar no duplica PricePoints de la misma factura.
 */
export async function confirmInvoice(id: ID): Promise<{ created: number; updated: number; skipped: number }> {
  void id;
  return todo('confirmInvoice');
}

/** Crea una factura vacía para introducir a mano. */
export async function createManualInvoice(): Promise<ID> {
  return todo('createManualInvoice');
}

/** Borra la factura. Si estaba confirmada, elimina sus PricePoints y recalcula el precio vigente de los productos afectados. */
export async function deleteInvoice(id: ID): Promise<void> {
  void id;
  return todo('deleteInvoice');
}

/** Línea vacía lista para añadir en la revisión. */
export function newInvoiceLine(partial?: Partial<InvoiceLine>): InvoiceLine {
  void partial;
  return todo('newInvoiceLine');
}
