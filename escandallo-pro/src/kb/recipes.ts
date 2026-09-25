import type { QtyBasis, QtyUnit } from '../types';

/** Receta tipo (escandallo estándar por ración) de la base de conocimiento. */
export interface KbRecipe {
  name: string;
  aliases?: string[];
  section: string;
  /** Raciones que salen con las cantidades indicadas (normalmente 1). */
  portions: number;
  items: { name: string; quantity: number; unit: QtyUnit; basis: QtyBasis; note?: string }[];
  procedure?: string;
}

export const KB_RECIPES: KbRecipe[] = [];
