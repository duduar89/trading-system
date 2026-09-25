import type { Allergen, BaseUnit, IngredientCategory } from '../types';
import { todo } from '../lib/todo';

/** Ficha de ingrediente de la base de conocimiento (datos culinarios estándar de hostelería en España). */
export interface KbIngredient {
  name: string;
  aliases: string[];
  category: IngredientCategory;
  baseUnit: BaseUnit;
  /** Merma de limpieza típica (%). */
  wastePct: number;
  /** Merma de cocción típica (%) en su uso más habitual. */
  cookingLossPct: number;
  unitWeightKg?: number;
  densityKgPerL?: number;
  allergens: Allergen[];
  /** Precio orientativo mayorista en España (€/unidad base, sin IVA) para estimaciones cuando no hay factura. */
  refPricePerBase?: number;
}

export const KB_INGREDIENTS: KbIngredient[] = [];

/** Busca la ficha que mejor encaja con un nombre (usa core/matching). undefined si score < 0.6. */
export function findKbIngredient(name: string): KbIngredient | undefined {
  void name;
  return todo('findKbIngredient');
}
