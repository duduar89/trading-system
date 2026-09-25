import type { Dish, DishProposal, ID, Product, RecipeItem } from '../types';
import { todo } from '../lib/todo';

/**
 * Platos, elaboraciones y propuesta semiautomática de escandallos.
 */

/** Crea plato/elaboración con valores por defecto (kind 'plato', portions 1, IVA del negocio, status 'borrador'). */
export async function createDish(data: Partial<Dish> & { name: string }): Promise<Dish> {
  void data;
  return todo('createDish');
}

export async function updateDish(id: ID, patch: Partial<Dish>): Promise<void> {
  void id;
  void patch;
  return todo('updateDish');
}

export async function duplicateDish(id: ID): Promise<Dish> {
  void id;
  return todo('duplicateDish');
}

/** Borra; si otros platos lo usan como elaboración, esas líneas quedan sin vincular. */
export async function deleteDish(id: ID): Promise<void> {
  void id;
  return todo('deleteDish');
}

/** Línea de receta vacía. */
export function newRecipeItem(partial?: Partial<RecipeItem>): RecipeItem {
  void partial;
  return todo('newRecipeItem');
}

/**
 * Convierte una propuesta (IA / plantilla) en líneas de escandallo, cotejando cada ingrediente con los productos
 * de las facturas: si la propuesta trae productId válido se usa; si no, rankMatches sobre productos y elaboraciones.
 * score ≥ AUTO_LINK → vinculado; entre SUGGEST y AUTO → vinculado pero marcado suggested; si no, sin ref.
 * Las líneas quedan con suggested = true hasta que el usuario las revise.
 */
export function proposalToItems(proposal: DishProposal, products: Product[], elaborations: Dish[]): RecipeItem[] {
  void proposal;
  void products;
  void elaborations;
  return todo('proposalToItems');
}

/**
 * Propone ingredientes para varios platos: IA (ai/recipes, en lotes, con el catálogo de productos) si está disponible;
 * si no o si falla, base de conocimiento local (kb/propose). Sustituye sólo los platos sin líneas o si `replace`.
 * Crea automáticamente productos "estimados" para ingredientes sin coincidencia SOLO si `createMissing`
 * (con precio de referencia de la KB, priceSource 'manual' y nota "Precio estimado"), para que el escandallo salga completo.
 */
export async function proposeForDishes(
  dishIds: ID[],
  opts: { replace?: boolean; createMissing?: boolean; forceLocal?: boolean; onProgress?: (done: number, total: number, stage: string) => void },
): Promise<{ proposed: number; usedAI: boolean; warnings: string[] }> {
  void dishIds;
  void opts;
  return todo('proposeForDishes');
}

/** Vuelve a cotejar las líneas sin vincular de un plato con los productos actuales. */
export async function rematchDish(id: ID): Promise<number> {
  void id;
  return todo('rematchDish');
}
