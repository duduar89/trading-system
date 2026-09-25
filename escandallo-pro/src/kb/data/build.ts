import type { Allergen, BaseUnit, IngredientCategory, QtyBasis, QtyUnit } from '../../types';
import type { KbIngredient } from '../ingredients';
import type { KbRecipe, KbRecipeItem } from '../recipes';
import { phraseKey } from '../text';

/** Datos opcionales de una ficha de ingrediente (formato compacto para las tablas de datos). */
export interface IngExtra {
  /** Alias: variantes, denominaciones de proveedor y de Latinoamérica. */
  aka?: string[];
  /** Alérgenos (Reglamento UE 1169/2011). */
  alg?: Allergen[];
  /** Peso medio de 1 ud (kg). */
  uw?: number;
  /** Densidad (kg/l) para líquidos. */
  dens?: number;
}

/**
 * Construye una ficha de ingrediente.
 * @param waste merma de limpieza típica (%)
 * @param cook merma de cocción típica (%) en su uso más habitual
 * @param price precio orientativo mayorista en España, € por unidad base sin IVA
 */
export function ing(
  name: string,
  category: IngredientCategory,
  baseUnit: BaseUnit,
  waste: number,
  cook: number,
  price: number,
  extra: IngExtra = {},
): KbIngredient {
  // Alias sin redundancias: se descartan los que normalizan igual que el nombre u otro alias (plurales, tildes).
  const seen = new Set([phraseKey(name)]);
  const aliases = (extra.aka ?? []).filter((a) => {
    const k = phraseKey(a);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const item: KbIngredient = {
    name,
    aliases,
    category,
    baseUnit,
    wastePct: waste,
    cookingLossPct: cook,
    allergens: extra.alg ?? [],
    refPricePerBase: price,
  };
  if (extra.uw != null) item.unitWeightKg = extra.uw;
  if (extra.dens != null) item.densityKgPerL = extra.dens;
  return item;
}

/**
 * Línea compacta de receta: [ingrediente, cantidad, unidad, base?, opciones?].
 * La base por defecto es 'neta' (peso limpio en crudo).
 */
export type ItemTuple =
  | [name: string, quantity: number, unit: QtyUnit]
  | [name: string, quantity: number, unit: QtyUnit, basis: QtyBasis]
  | [name: string, quantity: number, unit: QtyUnit, basis: QtyBasis, opts: ItemOpts];

export interface ItemOpts {
  note?: string;
  /** Guarnición intercambiable (se sustituye si la carta menciona otra). */
  garnish?: boolean;
  /** Merma de cocción específica de esta receta (%), si difiere de la habitual del ingrediente. */
  cook?: number;
  /** Merma de limpieza específica de esta receta (%). */
  waste?: number;
}

/** Guarnición: atajo para marcar líneas intercambiables. */
export const G: ItemOpts = { garnish: true };

export interface RecipeExtra {
  aka?: string[];
  /** Pasos de elaboración (2–4), se numeran automáticamente. */
  proc?: string[];
}

/** Construye una receta tipo. */
export function rec(name: string, section: string, portions: number, items: ItemTuple[], extra: RecipeExtra = {}): KbRecipe {
  const r: KbRecipe = {
    name,
    section,
    portions,
    items: items.map(toItem),
  };
  if (extra.aka?.length) r.aliases = extra.aka;
  if (extra.proc?.length) r.procedure = extra.proc.map((step, i) => `${i + 1}. ${step}`).join('\n');
  return r;
}

function toItem(t: ItemTuple): KbRecipeItem {
  const [name, quantity, unit] = t;
  const basis: QtyBasis = t.length >= 4 ? (t[3] as QtyBasis) : 'neta';
  const opts: ItemOpts | undefined = t.length === 5 ? t[4] : undefined;
  const item: KbRecipeItem = { name, quantity, unit, basis };
  if (opts?.note) item.note = opts.note;
  if (opts?.garnish) item.garnish = true;
  if (opts?.cook != null) item.cookingLossPct = opts.cook;
  if (opts?.waste != null) item.wastePct = opts.waste;
  return item;
}
