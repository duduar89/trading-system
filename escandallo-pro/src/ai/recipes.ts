import type { AppSettings, BaseUnit, DishProposal, ID, IngredientCategory, ProgressFn } from '../types';
import { todo } from '../lib/todo';

export interface RecipeRequestDish {
  /** Clave para devolver el resultado (p. ej. id del plato). */
  key: string;
  name: string;
  description?: string;
  section?: string;
  /** PVP con IVA, ayuda a estimar gramajes coherentes con el nivel del local. */
  price?: number;
}

export interface CatalogProduct {
  id: ID;
  name: string;
  baseUnit: BaseUnit;
  category: IngredientCategory;
  pricePerBase?: number;
}

/**
 * Propone el escandallo de cada plato: ingredientes con cantidad POR RACIÓN, unidad, base (bruta/neta/cocinada),
 * mermas estimadas y, cuando exista, el producto del catálogo (facturas) que corresponde a cada ingrediente
 * (campo productId, SÓLO ids del catálogo dado). Procesa en lotes (p. ej. 8 platos por llamada) y reporta progreso.
 */
export async function aiProposeRecipes(
  dishes: RecipeRequestDish[],
  catalog: CatalogProduct[],
  settings: AppSettings,
  onProgress?: ProgressFn,
): Promise<Map<string, DishProposal>> {
  void dishes;
  void catalog;
  void settings;
  void onProgress;
  return todo('aiProposeRecipes');
}
