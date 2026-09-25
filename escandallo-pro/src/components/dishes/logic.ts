/**
 * Lógica pura del flujo carta → platos → escandallo (sin React ni BD), para poder probarla a fondo.
 */
import type { BaseUnit, BusinessSettings, Dish, DishCost, ID, MenuEntry, Product, RecipeItem } from '../../types';
import { costDish, foodCostStatus, type CostingContext, type FoodCostStatus } from '../../core/costing';
import { rankMatches } from '../../core/matching';
import { fmtEur, fmtEurPrecise, fmtPct } from '../../lib/format';

// ───────────────────────────── Texto ─────────────────────────────

/** minúsculas, sin tildes ni signos, espacios colapsados (para búsquedas instantáneas en la UI). */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Precio unitario legible: 2 decimales desde 1 € (12,03 €) y hasta 4 por debajo (0,0385 €). */
export function fmtPrice(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.abs(v) >= 1 ? fmtEur(v) : fmtEurPrecise(v);
}

/** Porcentaje con espacio duro ("30 %") para que el símbolo no salte solo a la línea siguiente. */
export function fmtPctNb(v: number | undefined | null, decimals = 1): string {
  return fmtPct(v, decimals).replace(' ', '\u00a0');
}

// ───────────────────────────── Costes en vivo ─────────────────────────────

/**
 * Escandallo calculado a partir del BORRADOR del plato (lo que el usuario está escribiendo), sin esperar a la BD.
 * Usa un contexto derivado con el plato sustituido y una caché nueva, para que ni el propio plato
 * ni las elaboraciones que dependan de él arrastren costes antiguos.
 */
export function costDraft(ctx: CostingContext, draft: Dish): DishCost {
  const dishes = new Map(ctx.dishes);
  dishes.set(draft.id, draft);
  return costDish(draft, { ...ctx, dishes, cache: new Map() });
}

/**
 * Food cost y margen que tiene sentido enseñar: sin coste (receta vacía o sin precios) el food cost sería 0 %
 * y el margen todo el PVP, lo que se leería como un plato "en verde" cuando en realidad falta información.
 */
export function shownFoodCost(c: DishCost | undefined): number | undefined {
  return c && c.costPerPortion > 0 ? c.foodCostPct : undefined;
}
export function shownMargin(c: DishCost | undefined): number | undefined {
  return c && c.costPerPortion > 0 ? c.grossMargin : undefined;
}

/** Food cost objetivo efectivo de un plato. */
export function targetOf(dish: Pick<Dish, 'targetFoodCostPct'>, business: BusinessSettings): number {
  return dish.targetFoodCostPct != null && dish.targetFoodCostPct > 0 ? dish.targetFoodCostPct : business.targetFoodCostPct;
}

/**
 * Semáforo de food cost respetando el objetivo específico del plato: el margen "ámbar" del negocio
 * (umbral de atención − objetivo) se desplaza con el objetivo del plato.
 */
export function dishFoodCostStatus(pct: number | undefined, dish: Pick<Dish, 'targetFoodCostPct'>, business: BusinessSettings): FoodCostStatus {
  const target = targetOf(dish, business);
  const band = Math.max(0, business.warningFoodCostPct - business.targetFoodCostPct);
  return foodCostStatus(pct, target, target + band);
}

// ───────────────────────────── Mermas ─────────────────────────────

export interface WasteRow {
  itemId: ID;
  name: string;
  /** Todas las magnitudes son POR RACIÓN y en kg. */
  grossKg: number;
  servedKg: number;
  cleaningKg: number;
  cookingKg: number;
  totalKg: number;
  /** % de merma sobre el bruto de la línea. */
  wastePct: number;
  /** Coste de la merma por ración (€). */
  wasteCost: number;
}

export interface WasteSummary {
  rows: WasteRow[];
  /** Líneas con merma que no se pueden expresar en peso (unidades sin peso por unidad). */
  notWeighable: number;
  portions: number;
}

/** Desglose de merma por ingrediente (por ración), ordenado de mayor a menor merma. */
export function wasteBreakdown(cost: DishCost, portions: number): WasteSummary {
  const p = portions > 0 ? portions : 1;
  const rows: WasteRow[] = [];
  let notWeighable = 0;
  for (const it of cost.items) {
    if (!(it.grossQty > 0)) continue;
    if (it.grossKg == null || it.servedKg == null) {
      if (it.totalWasteQty > 0) notWeighable++;
      continue;
    }
    const kgPerBase = it.grossKg / it.grossQty;
    const cleaningKg = Math.max(0, it.cleaningWasteQty * kgPerBase) / p;
    const cookingKg = Math.max(0, it.cookingWasteQty * kgPerBase) / p;
    const totalKg = cleaningKg + cookingKg;
    rows.push({
      itemId: it.itemId,
      name: it.name,
      grossKg: it.grossKg / p,
      servedKg: it.servedKg / p,
      cleaningKg,
      cookingKg,
      totalKg,
      wastePct: it.totalWastePct,
      wasteCost: it.wasteCost / p,
    });
  }
  rows.sort((a, b) => b.totalKg - a.totalKg || b.wasteCost - a.wasteCost);
  return { rows, notWeighable, portions: p };
}

// ───────────────────────────── Listado de platos ─────────────────────────────

export type KindFilter = 'plato' | 'elaboracion' | 'todos';
export type StatusFilter = 'todos' | 'borrador' | 'revisado';
export type DishSort = 'foodcost' | 'margen' | 'merma' | 'nombre' | 'seccion' | 'recientes' | 'coste' | 'pvp';

export interface DishFilters {
  query: string;
  kind: KindFilter;
  status: StatusFilter;
  /** Sección elegida (undefined = todas; '' = sin sección). */
  section?: string;
}

export function filterDishes(dishes: Dish[], f: DishFilters): Dish[] {
  const q = normalize(f.query);
  const terms = q ? q.split(' ') : [];
  return dishes.filter((d) => {
    if (f.kind !== 'todos' && d.kind !== f.kind) return false;
    if (f.status !== 'todos' && d.status !== f.status) return false;
    if (f.section !== undefined && (d.section ?? '') !== f.section) return false;
    if (terms.length) {
      const hay = normalize(`${d.name} ${d.section ?? ''} ${d.description ?? ''} ${d.items.map((i) => i.name).join(' ')}`);
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

// ───────────────────────────── Semáforo de food cost ─────────────────────────────

/** Filtro por semáforo: 'sin' = platos sin food cost calculable (sin PVP o sin ingredientes con precio). */
export type FoodCostFilter = 'bad' | 'warn' | 'ok' | 'sin';
const FC_FILTERS: readonly FoodCostFilter[] = ['bad', 'warn', 'ok', 'sin'];

/** Lee el filtro de la URL (`?fc=bad|warn|ok|sin`, p. ej. los enlaces del panel). Valores desconocidos se ignoran. */
export function parseFoodCostFilter(v: string | null | undefined): FoodCostFilter | undefined {
  const s = v?.trim().toLowerCase();
  return s && (FC_FILTERS as readonly string[]).includes(s) ? (s as FoodCostFilter) : undefined;
}

/** Semáforo con el que se clasifica un plato en los filtros (las elaboraciones no tienen food cost). */
export function dishFcBucket(dish: Dish, cost: DishCost | undefined, business: BusinessSettings): FoodCostFilter | undefined {
  if (dish.kind !== 'plato') return undefined;
  const st = dishFoodCostStatus(shownFoodCost(cost), dish, business);
  return st === 'none' ? 'sin' : st;
}

/** Platos que cumplen el filtro de semáforo (sin filtro devuelve la misma lista). */
export function filterByFoodCost(dishes: Dish[], costs: Map<ID, DishCost>, business: BusinessSettings, fc: FoodCostFilter | undefined): Dish[] {
  if (!fc) return dishes;
  return dishes.filter((d) => dishFcBucket(d, costs.get(d.id), business) === fc);
}

/** Recuento de platos de carta por semáforo (para los chips del listado). */
export function foodCostCounts(dishes: Dish[], costs: Map<ID, DishCost>, business: BusinessSettings): Record<FoodCostFilter, number> {
  const out: Record<FoodCostFilter, number> = { bad: 0, warn: 0, ok: 0, sin: 0 };
  for (const d of dishes) {
    const b = dishFcBucket(d, costs.get(d.id), business);
    if (b) out[b]++;
  }
  return out;
}

/** Ordena (copia). `dir` = 'desc' pone primero los valores mayores; los platos sin dato siempre al final. */
export function sortDishes(dishes: Dish[], costs: Map<ID, DishCost>, sort: DishSort, dir: 'asc' | 'desc' = defaultDir(sort)): Dish[] {
  const sign = dir === 'desc' ? -1 : 1;
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const metric = (d: Dish): number | undefined => {
    const c = costs.get(d.id);
    switch (sort) {
      case 'foodcost':
        return shownFoodCost(c);
      case 'margen':
        return shownMargin(c);
      case 'merma':
        return c && c.grossKgPerPortion > 0 ? c.wastePct : undefined;
      case 'coste':
        return c?.costPerPortion;
      case 'pvp':
        return d.menuPrice;
      case 'recientes':
        return Date.parse(d.createdAt) || 0;
      default:
        return undefined;
    }
  };
  const byName = (a: Dish, b: Dish) => collator.compare(a.name, b.name);
  return [...dishes].sort((a, b) => {
    if (sort === 'nombre') return sign * byName(a, b);
    if (sort === 'seccion') {
      const sa = a.section ?? '';
      const sb = b.section ?? '';
      if (!sa !== !sb) return sa ? -1 : 1;
      return sign * collator.compare(sa, sb) || byName(a, b);
    }
    const ma = metric(a);
    const mb = metric(b);
    const va = ma != null && Number.isFinite(ma);
    const vb = mb != null && Number.isFinite(mb);
    if (va !== vb) return va ? -1 : 1;
    if (!va || !vb) return byName(a, b);
    return sign * ((ma as number) - (mb as number)) || byName(a, b);
  });
}

export function defaultDir(sort: DishSort): 'asc' | 'desc' {
  return sort === 'nombre' || sort === 'seccion' ? 'asc' : 'desc';
}

export interface DishListStats {
  dishes: number;
  elaborations: number;
  avgFoodCost?: number;
  red: number;
  warn: number;
  noPrice: number;
  incomplete: number;
  suggestedLines: number;
}

/** KPIs de cabecera del listado (sólo platos de carta para food cost / PVP). */
export function dishListStats(dishes: Dish[], costs: Map<ID, DishCost>, business: BusinessSettings): DishListStats {
  let n = 0;
  let el = 0;
  let sum = 0;
  let withFc = 0;
  let red = 0;
  let warn = 0;
  let noPrice = 0;
  let incomplete = 0;
  let suggestedLines = 0;
  for (const d of dishes) {
    suggestedLines += d.items.filter((i) => i.suggested).length;
    if (d.kind === 'elaboracion') {
      el++;
      continue;
    }
    n++;
    const c = costs.get(d.id);
    if (!(d.menuPrice && d.menuPrice > 0)) noPrice++;
    if (c && d.items.length && c.completeness < 1) incomplete++;
    if (c?.foodCostPct != null && Number.isFinite(c.foodCostPct) && c.costPerPortion > 0) {
      sum += c.foodCostPct;
      withFc++;
      const st = dishFoodCostStatus(c.foodCostPct, d, business);
      if (st === 'bad') red++;
      else if (st === 'warn') warn++;
    }
  }
  return { dishes: n, elaborations: el, avgFoodCost: withFc ? sum / withFc : undefined, red, warn, noPrice, incomplete, suggestedLines };
}

/** Secciones existentes, en orden alfabético y sin duplicados (ignorando mayúsculas/tildes). */
export function sectionsOf(list: { section?: string }[]): string[] {
  const seen = new Map<string, string>();
  for (const d of list) {
    const s = d.section?.trim();
    if (s && !seen.has(normalize(s))) seen.set(normalize(s), s);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

/** Platos que usan `dishId` como elaboración. */
export function usedIn(dishId: ID, dishes: Iterable<Dish>): Dish[] {
  const out: Dish[] = [];
  for (const d of dishes) if (d.id !== dishId && d.items.some((i) => i.ref?.type === 'dish' && i.ref.id === dishId)) out.push(d);
  return out;
}

// ───────────────────────────── Buscador de ingredientes ─────────────────────────────

export interface IngredientOption {
  kind: 'product' | 'dish';
  id: ID;
  name: string;
  score: number;
  /** Nombre (o alias) que ha dado la coincidencia, si no es el principal. */
  matchedOn?: string;
  product?: Product;
  dish?: Dish;
}

/**
 * Busca ingredientes (productos de compra y elaboraciones) para el selector del escandallo.
 * Combina coincidencia literal (prefijo / contiene, ideal mientras se teclea) con el emparejamiento difuso
 * de `core/matching` (erratas, abreviaturas de proveedor, sinónimos). Sin consulta devuelve los primeros por nombre.
 */
export function searchIngredients(query: string, products: Product[], elaborations: Dish[], limit = 8, excludeDishId?: ID): IngredientOption[] {
  const els = elaborations.filter((d) => d.id !== excludeDishId);
  const q = normalize(query);
  const out = new Map<string, IngredientOption>();
  const key = (o: { kind: string; id: ID }) => `${o.kind}:${o.id}`;
  const push = (o: IngredientOption) => {
    const k = key(o);
    const prev = out.get(k);
    if (!prev || prev.score < o.score) out.set(k, o);
  };

  if (!q) {
    return [
      ...els.slice(0, 3).map<IngredientOption>((d) => ({ kind: 'dish', id: d.id, name: d.name, score: 0, dish: d })),
      ...products.slice(0, limit).map<IngredientOption>((p) => ({ kind: 'product', id: p.id, name: p.name, score: 0, product: p })),
    ].slice(0, limit);
  }

  const literal = (name: string): number => {
    const n = normalize(name);
    if (!n) return 0;
    if (n === q) return 1;
    if (n.startsWith(q)) return 0.95 - Math.min(0.1, (n.length - q.length) / 200);
    if (n.split(' ').some((w) => w.startsWith(q))) return 0.88;
    if (n.includes(q)) return 0.8;
    const terms = q.split(' ');
    if (terms.length > 1 && terms.every((t) => n.includes(t))) return 0.78;
    return 0;
  };

  for (const p of products) {
    let best = literal(p.name);
    let on: string | undefined;
    for (const a of p.aliases ?? []) {
      const s = literal(a) * 0.97;
      if (s > best) {
        best = s;
        on = a;
      }
    }
    if (best > 0) push({ kind: 'product', id: p.id, name: p.name, score: best, matchedOn: on, product: p });
  }
  for (const d of els) {
    const s = literal(d.name);
    if (s > 0) push({ kind: 'dish', id: d.id, name: d.name, score: s, dish: d });
  }

  // Coincidencia difusa (si el módulo de emparejamiento está disponible).
  if (q.length >= 3) {
    try {
      for (const m of rankMatches(query, products, limit * 2, 0.45)) {
        push({
          kind: 'product',
          id: m.item.id,
          name: m.item.name,
          score: m.score * 0.9,
          matchedOn: normalize(m.matchedOn) !== normalize(m.item.name) ? m.matchedOn : undefined,
          product: m.item,
        });
      }
      for (const m of rankMatches(query, els, limit, 0.45)) {
        push({ kind: 'dish', id: m.item.id, name: m.item.name, score: m.score * 0.9, dish: m.item });
      }
    } catch {
      // Sin emparejamiento difuso: la coincidencia literal sigue funcionando.
    }
  }

  return [...out.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'es')).slice(0, limit);
}

/**
 * true si lo escrito en la línea es sólo el texto de búsqueda con el que se ha encontrado el ingrediente
 * ("calabac" → «Calabacín», "aceite gir" → «Aceite de girasol»): al elegirlo se sustituye por el nombre completo y
 * no se aprende como alias. Un nombre de receta distinto ("Pimientos de Padrón (fritos)") se conserva.
 */
export function isSearchFragment(typed: string, name: string): boolean {
  const t = normalize(typed);
  const n = normalize(name);
  if (!t) return true;
  if (t === n || t.length >= n.length) return false;
  const words = n.split(' ');
  return t.split(' ').every((tok) => words.some((w) => w.startsWith(tok)));
}

// ───────────────────────────── Edición de líneas ─────────────────────────────

/** Sustituye una línea por id (inmutable). */
export function patchItem(items: RecipeItem[], id: ID, patch: Partial<RecipeItem>): RecipeItem[] {
  return items.map((it) => (it.id === id ? { ...it, ...patch } : it));
}

/** Mueve una línea `delta` posiciones (−1 arriba, +1 abajo). */
export function moveItem(items: RecipeItem[], id: ID, delta: number): RecipeItem[] {
  const i = items.findIndex((it) => it.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= items.length) return items;
  const next = [...items];
  const [it] = next.splice(i, 1);
  next.splice(j, 0, it);
  return next;
}

/** Campos editables de un plato que se guardan desde el editor. */
export function editablePatch(d: Dish): Partial<Dish> {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = d;
  return rest;
}

/** Etiqueta de rendimiento de una elaboración: "€/kg producido". */
export function yieldUnitLabel(u: BaseUnit | undefined): string {
  return u === 'l' ? 'litro' : u === 'ud' ? 'unidad' : 'kg';
}

// ───────────────────────────── Carta ─────────────────────────────

export interface EntryGroup {
  section: string;
  entries: MenuEntry[];
}

/** Agrupa las entradas por sección conservando el orden de aparición en la carta. */
export function groupEntries(entries: MenuEntry[], fallback = 'Sin sección'): EntryGroup[] {
  const groups = new Map<string, EntryGroup>();
  for (const e of entries) {
    const label = e.section?.trim() || fallback;
    const k = normalize(label);
    let g = groups.get(k);
    if (!g) {
      g = { section: label, entries: [] };
      groups.set(k, g);
    }
    g.entries.push(e);
  }
  return [...groups.values()];
}

/** Resumen de la revisión de la carta. */
export function entriesSummary(entries: MenuEntry[]): { total: number; selected: number; withoutPrice: number; lowConfidence: number; imported: number } {
  let selected = 0;
  let withoutPrice = 0;
  let lowConfidence = 0;
  let imported = 0;
  for (const e of entries) {
    if (e.selected) selected++;
    if (e.selected && !(e.price && e.price > 0)) withoutPrice++;
    if (e.confidence != null && e.confidence < 0.6) lowConfidence++;
    if (e.dishId) imported++;
  }
  return { total: entries.length, selected, withoutPrice, lowConfidence, imported };
}
