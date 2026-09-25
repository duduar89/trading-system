import type { QtyBasis, QtyUnit } from '../types';
import { KB_RECIPES_TAPAS } from './data/recipes-tapas';
import { KB_RECIPES_PRINCIPALES } from './data/recipes-principales';
import { KB_RECIPES_VARIOS } from './data/recipes-varios';
import { KB_RECIPES_CARTA } from './data/recipes-carta';

/** Línea de una receta tipo. Los nombres de ingrediente coinciden con fichas de KB_INGREDIENTS. */
export interface KbRecipeItem {
  name: string;
  quantity: number;
  unit: QtyUnit;
  basis: QtyBasis;
  note?: string;
  /** Guarnición intercambiable: se sustituye cuando la carta menciona otra guarnición. */
  garnish?: boolean;
  /** Merma de limpieza específica de esta receta (%), si difiere de la habitual del ingrediente. */
  wastePct?: number;
  /** Merma de cocción específica de esta receta (%), p. ej. patata cocida (0 %) frente a frita. */
  cookingLossPct?: number;
}

/** Receta tipo (escandallo estándar por ración) de la base de conocimiento. */
export interface KbRecipe {
  name: string;
  aliases?: string[];
  section: string;
  /** Raciones que salen con las cantidades indicadas (normalmente 1). */
  portions: number;
  items: KbRecipeItem[];
  procedure?: string;
}

export const KB_RECIPES: KbRecipe[] = [...KB_RECIPES_TAPAS, ...KB_RECIPES_PRINCIPALES, ...KB_RECIPES_VARIOS, ...KB_RECIPES_CARTA];
