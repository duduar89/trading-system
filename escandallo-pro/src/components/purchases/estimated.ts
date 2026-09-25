import type { Product } from '../../types';
import { ESTIMATED_PRICE_NOTE } from '../../services/products';

/**
 * true si el precio vigente es el orientativo de la base de conocimiento (ingrediente creado al importar una carta o
 * proponer una receta) y todavía no se ha visto en ninguna compra. Deja de serlo al confirmar una factura o fijar el precio.
 */
export function isEstimatedPrice(p: Pick<Product, 'notes' | 'pricePerBase'> | undefined | null): boolean {
  return !!p && p.pricePerBase > 0 && p.notes === ESTIMATED_PRICE_NOTE;
}

/** Notas visibles para el usuario (sin la marca interna de precio estimado). */
export function userNotes(p: Pick<Product, 'notes'>): string | undefined {
  return p.notes === ESTIMATED_PRICE_NOTE ? undefined : p.notes;
}

export const ESTIMATED_PRICE_HINT = 'Precio de referencia orientativo: sube una factura de este ingrediente y tendrás su precio real.';
