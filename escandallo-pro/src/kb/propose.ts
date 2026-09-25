import type { DishProposal } from '../types';
import type { KbRecipe } from './recipes';
import { todo } from '../lib/todo';

/** Receta tipo más parecida al nombre (y descripción) del plato. */
export function findKbRecipe(name: string, description?: string): { recipe: KbRecipe; score: number } | undefined {
  void name;
  void description;
  return todo('findKbRecipe');
}

/**
 * Propuesta de escandallo sin IA: usa la receta tipo si el parecido es alto (source 'plantilla');
 * si no, detecta ingredientes mencionados en nombre y descripción ("con", "y", "de", "al", "sobre"…) y
 * asigna gramajes por categoría/rol (proteína principal ~180 g neto, guarnición ~100 g, salsa ~40 ml…) más
 * básicos (aceite, sal) → source 'heuristica'. Siempre devuelve algo (aunque sea con confidence baja).
 */
export function proposeDishLocal(name: string, description?: string): DishProposal {
  void name;
  void description;
  return todo('proposeDishLocal');
}
