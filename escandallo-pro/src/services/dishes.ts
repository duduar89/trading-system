import type { Dish, DishProposal, ID, ItemRef, Product, ProposedIngredient, QtyBasis, RecipeItem } from '../types';
import type { CatalogProduct, RecipeRequestDish } from '../ai/recipes';
import { db, getAppSettings, getBusinessSettings } from '../db';
import { SUGGEST_THRESHOLD, normalizeText, rankMatches, toSearchKey } from '../core/matching';
import { QTY_UNITS } from '../core/units';
import { aiAvailable } from '../extract/index';
import { nowIso, uid } from '../lib/id';
import { ESTIMATED_PRICE_NOTE, createProduct, loadKbFinder, type KbFinder } from './products';

/**
 * Platos, elaboraciones y propuesta semiautomática de escandallos.
 *
 * La propuesta de recetas es gratuita con la base de recetas local; si el usuario ha activado la IA opcional
 * (con su propia clave) se usa Claude y, si falla, se completa con la base local.
 */

// ───────────────────────────── Utilidades ─────────────────────────────

const BASES: QtyBasis[] = ['bruta', 'neta', 'cocinada'];

function cleanName(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function finiteOr(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}

function optionalPct(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(99, Math.max(0, v)) : undefined;
}

/**
 * Redondeo de cantidades de receta a 4 cifras significativas (máx. 6 decimales): 83,33 g, 0,0125 kg, 0,1667 ud…
 * Con decimales fijos, 0,05 kg ÷ 4 raciones quedaría en 0,013 kg (un 4 % de error en el coste).
 */
function roundQty(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 0;
  const decimals = Math.min(6, Math.max(0, 3 - Math.floor(Math.log10(v))));
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

function sanitizeItem(it: Partial<RecipeItem>): RecipeItem {
  const item: RecipeItem = {
    ...it,
    id: it.id || uid(),
    name: cleanName(it.name),
    quantity: Math.max(0, finiteOr(it.quantity, 0)),
    unit: it.unit && QTY_UNITS.includes(it.unit) ? it.unit : 'g',
    basis: it.basis && BASES.includes(it.basis) ? it.basis : 'neta',
  };
  if (it.wastePct != null) item.wastePct = optionalPct(it.wastePct);
  if (it.cookingLossPct != null) item.cookingLossPct = optionalPct(it.cookingLossPct);
  if (item.wastePct === undefined) delete item.wastePct;
  if (item.cookingLossPct === undefined) delete item.cookingLossPct;
  return item;
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return typeof err === 'string' && err.trim() ? err.trim() : 'error desconocido';
}

function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError';
}

// ───────────────────────────── CRUD ─────────────────────────────

/** Crea plato/elaboración con valores por defecto (kind 'plato', portions 1, IVA del negocio, status 'borrador'). */
export async function createDish(data: Partial<Dish> & { name: string }): Promise<Dish> {
  const name = cleanName(data.name);
  if (!name) throw new Error('El plato necesita un nombre');
  const wdb = db();
  const business = await getBusinessSettings(wdb);
  const now = nowIso();
  const dish: Dish = {
    ...data,
    id: data.id || uid(),
    name,
    kind: data.kind ?? 'plato',
    saleVatPct: finiteOr(data.saleVatPct, business.defaultSaleVatPct),
    portions: finiteOr(data.portions, 0) > 0 ? (data.portions as number) : 1,
    items: (data.items ?? []).map(sanitizeItem),
    status: data.status ?? 'borrador',
    source: data.source ?? 'manual',
    createdAt: data.createdAt ?? now,
    updatedAt: now,
  };
  if (data.menuPrice != null && !(finiteOr(data.menuPrice, 0) > 0)) delete dish.menuPrice;
  await wdb.dishes.add(dish);
  return dish;
}

export async function updateDish(id: ID, patch: Partial<Dish>): Promise<void> {
  const wdb = db();
  await wdb.transaction('rw', wdb.dishes, async () => {
    const current = await wdb.dishes.get(id);
    if (!current) throw new Error('El plato ya no existe');
    const next: Partial<Dish> = { ...patch };
    delete next.id;
    delete next.createdAt;
    if ('name' in patch) {
      const name = cleanName(patch.name);
      if (!name) throw new Error('El plato necesita un nombre');
      next.name = name;
    }
    if ('portions' in patch) next.portions = finiteOr(patch.portions, 0) > 0 ? (patch.portions as number) : current.portions || 1;
    if ('items' in patch) next.items = (patch.items ?? []).map(sanitizeItem);
    if ('menuPrice' in patch) next.menuPrice = finiteOr(patch.menuPrice, 0) > 0 ? patch.menuPrice : undefined;
    if ('saleVatPct' in patch) next.saleVatPct = finiteOr(patch.saleVatPct, current.saleVatPct);
    next.updatedAt = nowIso();
    await wdb.dishes.update(id, next);
  });
}

export async function duplicateDish(id: ID): Promise<Dish> {
  const wdb = db();
  return wdb.transaction('rw', wdb.dishes, async () => {
    const src = await wdb.dishes.get(id);
    if (!src) throw new Error('El plato ya no existe');
    const names = new Set((await wdb.dishes.toArray()).map((d) => normalizeText(d.name)));
    let name = `${src.name} (copia)`;
    for (let n = 2; names.has(normalizeText(name)); n++) name = `${src.name} (copia ${n})`;
    const now = nowIso();
    const copy: Dish = {
      ...structuredClone(src),
      id: uid(),
      name,
      items: src.items.map((it) => ({ ...it, id: uid() })),
      status: 'borrador',
      createdAt: now,
      updatedAt: now,
    };
    delete copy.unitsSold;
    delete copy.menuScanId;
    await wdb.dishes.add(copy);
    return copy;
  });
}

/** Borra; si otros platos lo usan como elaboración, esas líneas quedan sin vincular. */
export async function deleteDish(id: ID): Promise<void> {
  const wdb = db();
  await wdb.transaction('rw', wdb.dishes, wdb.menuScans, async () => {
    await wdb.dishes.delete(id);
    const now = nowIso();
    const users = await wdb.dishes.filter((d) => d.items.some((it) => it.ref?.type === 'dish' && it.ref.id === id)).toArray();
    for (const d of users) {
      d.items = d.items.map((it) => {
        if (it.ref?.type !== 'dish' || it.ref.id !== id) return it;
        const { ref: _ref, matchScore: _score, ...rest } = it;
        return rest;
      });
      d.updatedAt = now;
    }
    if (users.length) await wdb.dishes.bulkPut(users);
    const scans = await wdb.menuScans.filter((s) => s.entries.some((e) => e.dishId === id)).toArray();
    for (const s of scans) s.entries = s.entries.map((e) => (e.dishId === id ? { ...e, dishId: undefined } : e));
    if (scans.length) await wdb.menuScans.bulkPut(scans);
  });
}

/** Línea de receta vacía. */
export function newRecipeItem(partial?: Partial<RecipeItem>): RecipeItem {
  return {
    name: '',
    quantity: 0,
    unit: 'g',
    basis: 'neta',
    ...partial,
    id: partial?.id || uid(),
  };
}

// ───────────────────────────── Propuestas ─────────────────────────────

interface Candidate {
  name: string;
  aliases: string[];
  ref: ItemRef;
  category?: Product['category'];
}

function candidatesFor(products: Product[], elaborations: Dish[]): Candidate[] {
  return [
    ...products.map((p): Candidate => ({ name: p.name, aliases: p.aliases ?? [], ref: { type: 'product', id: p.id }, category: p.category })),
    ...elaborations.map((d): Candidate => ({ name: d.name, aliases: [], ref: { type: 'dish', id: d.id } })),
  ];
}

/** Mejor candidato (producto o elaboración) para un nombre de ingrediente; desempata por categoría. */
function bestCandidate(name: string, candidates: Candidate[], category?: Product['category']): { ref: ItemRef; score: number } | undefined {
  if (!cleanName(name) || !candidates.length) return undefined;
  const ranked = rankMatches(name, candidates, 5, SUGGEST_THRESHOLD);
  let best: { ref: ItemRef; score: number; rank: number } | undefined;
  for (const c of ranked) {
    const rank = c.score + (category && c.item.category === category ? 0.01 : 0);
    if (!best || rank > best.rank) best = { ref: c.item.ref, score: c.score, rank };
  }
  return best && { ref: best.ref, score: best.score };
}

/** Referencia explícita de la propuesta: id de producto o 'dish:<id>' de una elaboración. */
function explicitRef(productId: string | undefined, productIds: Set<ID>, elaborationIds: Set<ID>): ItemRef | undefined {
  if (!productId) return undefined;
  if (productId.startsWith('dish:')) {
    const id = productId.slice(5);
    return elaborationIds.has(id) ? { type: 'dish', id } : undefined;
  }
  if (productIds.has(productId)) return { type: 'product', id: productId };
  if (elaborationIds.has(productId)) return { type: 'dish', id: productId };
  return undefined;
}

/**
 * Convierte una propuesta (IA / plantilla) en líneas de escandallo, cotejando cada ingrediente con los productos
 * de las facturas: si la propuesta trae productId válido se usa; si no, rankMatches sobre productos y elaboraciones.
 * score ≥ AUTO_LINK → vinculado; entre SUGGEST y AUTO → vinculado pero marcado suggested; si no, sin ref.
 * Las líneas quedan con suggested = true hasta que el usuario las revise.
 * `opts.portions`: raciones del plato destino; las cantidades se escalan desde las raciones de la propuesta.
 */
export function proposalToItems(proposal: DishProposal, products: Product[], elaborations: Dish[], opts: { portions?: number } = {}): RecipeItem[] {
  const productIds = new Set(products.map((p) => p.id));
  const elaborationIds = new Set(elaborations.map((d) => d.id));
  const candidates = candidatesFor(products, elaborations);
  const fromPortions = finiteOr(proposal.portions, 0) > 0 ? proposal.portions : 1;
  const toPortions = finiteOr(opts.portions, 0) > 0 ? (opts.portions as number) : fromPortions;
  const factor = toPortions / fromPortions;
  const items: RecipeItem[] = [];
  for (const ing of proposal.ingredients ?? []) {
    const name = cleanName(ing.name);
    if (!name) continue;
    const item: RecipeItem = {
      id: uid(),
      name,
      quantity: roundQty(Math.max(0, finiteOr(ing.quantity, 0)) * factor),
      unit: ing.unit && QTY_UNITS.includes(ing.unit) ? ing.unit : 'g',
      basis: ing.basis && BASES.includes(ing.basis) ? ing.basis : 'neta',
      suggested: true,
    };
    const waste = optionalPct(ing.wastePct);
    if (waste !== undefined) item.wastePct = waste;
    const cooking = optionalPct(ing.cookingLossPct);
    if (cooking !== undefined) item.cookingLossPct = cooking;
    const note = cleanName(ing.note);
    if (note) item.note = note;
    const explicit = explicitRef(ing.productId, productIds, elaborationIds);
    if (explicit) {
      item.ref = explicit;
      item.matchScore = 1;
    } else {
      const best = bestCandidate(name, candidates, ing.category);
      if (best) {
        item.ref = best.ref;
        item.matchScore = Math.round(best.score * 1000) / 1000;
      }
    }
    items.push(item);
  }
  return items;
}

/** Elaboraciones que un plato puede usar como ingrediente (ni él mismo ni las que ya lo usan a él). */
function elaborationsFor(dish: Dish, all: Dish[]): Dish[] {
  return all.filter((d) => d.kind === 'elaboracion' && d.id !== dish.id && !d.items.some((it) => it.ref?.type === 'dish' && it.ref.id === dish.id));
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
  const wdb = db();
  const warnings: string[] = [];
  const unique = [...new Set(dishIds ?? [])];
  const found = (await wdb.dishes.bulkGet(unique)).filter((d): d is Dish => !!d);
  const targets = found.filter((d) => opts.replace || !d.items.length);
  const total = targets.length;
  const progress = (done: number, stage: string) => {
    try {
      opts.onProgress?.(Math.min(total, Math.max(0, Math.round(done))), total, stage);
    } catch {
      // La UI no debe interrumpir la propuesta.
    }
  };
  if (!total) return { proposed: 0, usedAI: false, warnings };

  progress(0, total === 1 ? 'Buscando la receta…' : `Buscando recetas para ${total} platos…`);
  const [settings, allDishes] = await Promise.all([getAppSettings(), wdb.dishes.toArray()]);
  let products = await wdb.products.toArray();
  const proposals = new Map<ID, DishProposal>();
  let usedAI = false;

  // 1) IA opcional (sólo si el usuario la ha activado con su clave)
  if (aiAvailable(settings) && !opts.forceLocal) {
    try {
      const { aiProposeRecipesDetailed } = await import('../ai/recipes');
      const requests: RecipeRequestDish[] = targets.map((d) => {
        const r: RecipeRequestDish = { key: d.id, name: d.name };
        if (d.description) r.description = d.description;
        if (d.section) r.section = d.section;
        if (d.menuPrice && d.menuPrice > 0) r.price = d.menuPrice;
        return r;
      });
      const catalog: CatalogProduct[] = [
        ...products.map((p) => ({ id: p.id, name: p.name, baseUnit: p.baseUnit, category: p.category, pricePerBase: p.pricePerBase > 0 ? p.pricePerBase : undefined })),
        ...allDishes
          .filter((d) => d.kind === 'elaboracion')
          .map((d): CatalogProduct => ({ id: `dish:${d.id}`, name: d.name, baseUnit: d.yieldUnit ?? 'ud', category: 'otros' })),
      ];
      const res = await aiProposeRecipesDetailed(requests, catalog, settings, (p) => progress((p.progress ?? 0) * total, p.stage));
      for (const [key, proposal] of res.proposals) if (proposal.ingredients?.length) proposals.set(key, proposal);
      warnings.push(...res.warnings);
      usedAI = proposals.size > 0;
    } catch (err) {
      if (isAbortError(err)) throw err;
      warnings.push(`No se ha podido usar la IA (${errorText(err)}): las recetas se han propuesto con la base de recetas local, gratis`);
    }
  }

  // 2) Base de recetas local (gratis) para el resto
  const pending = targets.filter((d) => !proposals.has(d.id));
  if (pending.length) {
    const failed: string[] = [];
    let failure = '';
    try {
      const { proposeDishLocal } = await import('../kb/propose');
      pending.forEach((d, i) => {
        progress(proposals.size, pending.length === 1 ? `Buscando la receta de «${d.name}»…` : `Recetario local: ${i + 1} de ${pending.length}…`);
        try {
          const proposal = proposeDishLocal(d.name, d.description);
          if (proposal?.ingredients?.length) proposals.set(d.id, proposal);
          else failed.push(d.name);
        } catch (err) {
          failed.push(d.name);
          failure ||= errorText(err);
        }
      });
    } catch (err) {
      failed.push(...pending.map((d) => d.name));
      failure = errorText(err);
    }
    if (failed.length) {
      const list = failed.length > 5 ? `${failed.slice(0, 5).join(', ')} y ${failed.length - 5} más` : failed.join(', ');
      warnings.push(`No se ha encontrado una receta para: ${list}${failure ? ` (${failure})` : ''}. Añade sus ingredientes a mano.`);
    }
  }

  // 3) Cotejo con productos (y alta de productos estimados si se pide) y guardado
  progress(proposals.size, 'Cruzando los ingredientes con tus productos…');
  const kbFind = opts.createMissing ? await loadKbFinder() : undefined;
  const createdByKb = new Map<string, Product>();
  let createdCount = 0;
  let proposed = 0;

  for (const target of targets) {
    const proposal = proposals.get(target.id);
    if (!proposal) continue;
    // La propuesta puede tardar (IA): si mientras tanto el usuario ha escrito la receta, no se pisa (salvo `replace`).
    const dish = await wdb.dishes.get(target.id);
    if (!dish || (!opts.replace && dish.items.length)) continue;
    const elaborations = elaborationsFor(dish, allDishes);
    const items = proposalToItems(proposal, products, elaborations, { portions: dish.portions });

    if (kbFind) {
      for (const item of items) {
        if (item.ref) continue;
        const ing = proposal.ingredients.find((i) => cleanName(i.name) === item.name);
        const product = await ensureEstimatedProduct(item.name, ing, products, createdByKb, kbFind);
        if (!product) continue;
        if (!products.includes(product)) {
          products = [...products, product];
          createdCount++;
        }
        item.ref = { type: 'product', id: product.id };
        item.matchScore = 1;
      }
    }

    const patch: Partial<Dish> = { items, status: 'borrador', updatedAt: nowIso() };
    const procedure = cleanName(proposal.procedure) ? proposal.procedure?.trim() : undefined;
    if (procedure && !cleanName(dish.procedure)) patch.procedure = procedure;
    await wdb.dishes.update(dish.id, patch);
    if (items.length) proposed++;
  }

  if (createdCount > 0) {
    warnings.push(
      `${createdCount} ${createdCount === 1 ? 'ingrediente nuevo creado' : 'ingredientes nuevos creados'} con precio estimado de referencia: actualízalos con tus facturas`,
    );
  }
  progress(total, 'Propuesta lista');
  return { proposed, usedAI, warnings };
}

/**
 * Producto "estimado" para un ingrediente sin coincidencia: ficha de la base de conocimiento con su precio de referencia.
 * Evita duplicados: reutiliza el creado en esta misma propuesta o uno existente con el mismo nombre de ficha.
 */
async function ensureEstimatedProduct(
  name: string,
  ing: ProposedIngredient | undefined,
  products: Product[],
  createdByKb: Map<string, Product>,
  kbFind: KbFinder,
): Promise<Product | undefined> {
  const kb = kbFind(name);
  if (!kb) return undefined;
  const key = toSearchKey(kb.name) || normalizeText(kb.name);
  const reused = createdByKb.get(key) ?? products.find((p) => p.searchKey === key);
  if (reused) {
    createdByKb.set(key, reused);
    return reused;
  }
  const refPrice = kb.refPricePerBase && kb.refPricePerBase > 0 ? kb.refPricePerBase : 0;
  const product = await createProduct(
    {
      name: kb.name,
      category: kb.category ?? ing?.category,
      baseUnit: kb.baseUnit,
      pricePerBase: refPrice,
      priceSource: 'manual',
      notes: ESTIMATED_PRICE_NOTE,
      aliases: normalizeText(name) !== normalizeText(kb.name) ? [name] : [],
    },
    // Precio orientativo: sin histórico, para que la primera factura real no cuente como "subida".
    { estimated: true },
  );
  createdByKb.set(key, product);
  return product;
}

/** Vuelve a cotejar las líneas sin vincular de un plato con los productos actuales. */
export async function rematchDish(id: ID): Promise<number> {
  const wdb = db();
  const dish = await wdb.dishes.get(id);
  if (!dish) throw new Error('El plato ya no existe');
  const [products, allDishes] = await Promise.all([wdb.products.toArray(), wdb.dishes.toArray()]);
  const productIds = new Set(products.map((p) => p.id));
  const dishIds = new Set(allDishes.map((d) => d.id));
  const candidates = candidatesFor(products, elaborationsFor(dish, allDishes));
  let relinked = 0;
  let changed = false;
  const items = dish.items.map((it) => {
    const dangling = it.ref && (it.ref.type === 'product' ? !productIds.has(it.ref.id) : !dishIds.has(it.ref.id));
    if (it.ref && !dangling) return it;
    const { ref: _ref, matchScore: _score, ...rest } = it;
    const best = bestCandidate(it.name, candidates);
    if (!best) {
      if (dangling) changed = true;
      return dangling ? rest : it;
    }
    relinked++;
    changed = true;
    return { ...rest, ref: best.ref, matchScore: Math.round(best.score * 1000) / 1000, suggested: true };
  });
  if (changed) await wdb.dishes.update(id, { items, updatedAt: nowIso() });
  return relinked;
}

