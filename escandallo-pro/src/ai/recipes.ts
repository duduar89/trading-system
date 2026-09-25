import type { AppSettings, BaseUnit, DishProposal, ID, IngredientCategory, ProgressFn } from '../types';
import { fmtEur } from '../lib/format';
import { type AISystemBlock, callStructuredDetailed, isAbortError, toAIError } from './client';
import { cleanText, compareKey, mapRecipeBatch } from './normalize';
import { RECIPES_CATALOG_HEADER, RECIPES_NO_CATALOG, RECIPES_SYSTEM } from './prompts';
import { CATEGORY_VALUES, recipesParseSchema, recipesWireJsonSchema } from './schemas';

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

/** Platos por petición: equilibrio entre coste (el catálogo se cachea) y respuestas manejables. */
export const RECIPE_BATCH_SIZE = 6;
/** Máximo de productos del catálogo que se envían por petición. */
export const CATALOG_CAP = 1500;

// ───────────────────────────── Catálogo compacto ─────────────────────────────

const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'con', 'al', 'en', 'y', 'o', 'sin', 'para', 'por', 'su', 'sus', 'un', 'una', 'casa', 'estilo', 'nuestro', 'nuestra',
  'casero', 'casera', 'caseros', 'caseras', 'media', 'racion', 'tapa', 'plato', 'fresco', 'fresca', 'frescos', 'frescas', 'sobre', 'tipo', 'extra',
]);
/** Básicos que casi cualquier plato usa: se priorizan al recortar un catálogo muy grande. */
const STAPLES = new Set([
  'sal', 'aceite', 'oliva', 'ajo', 'cebolla', 'pimienta', 'perejil', 'huevo', 'harina', 'mantequilla', 'leche', 'nata', 'limon', 'azucar', 'pan', 'vinagre',
  'tomate', 'patata', 'pimenton', 'laurel', 'vino', 'caldo',
]);

function singular(t: string): string {
  if (t.length > 4 && /[^aeiou]es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

/** Tokens significativos (sin tildes, stopwords ni números), en singular. */
export function tokens(s: string): string[] {
  return compareKey(s)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d/.test(t))
    .map(singular);
}

const CATEGORY_ORDER = new Map<string, number>(CATEGORY_VALUES.map((c, i) => [c, i]));

function formatPrice(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return '-';
  return (v < 1 ? v.toFixed(4) : v.toFixed(2)).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

export interface CatalogBlock {
  text: string;
  /** P1… → id real */
  refs: Map<string, string>;
  ids: Set<string>;
  /** Productos que no se enviaron por superar el límite. */
  omitted: number;
}

/**
 * Catálogo compacto «ref|nombre|unidad|categoría|€» con referencias cortas (P1, P2…) que luego se traducen al id real
 * (menos tokens y ninguna errata al copiar ids largos). El orden es estable, para que el bloque sea idéntico entre
 * lotes y la caché de prompts lo reutilice. Si hay más de `cap` productos se priorizan los que comparten palabras con
 * los platos del lote y los básicos de cocina.
 */
export function buildCatalogBlock(catalog: CatalogProduct[], focus: RecipeRequestDish[], cap = CATALOG_CAP): CatalogBlock {
  const seen = new Set<string>();
  let products = catalog.filter((p) => {
    if (!p?.id || !cleanText(p.name) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  let omitted = 0;
  if (products.length > cap) {
    const focusTokens = new Set(focus.flatMap((d) => tokens(`${d.name} ${d.description ?? ''}`)));
    const focusPrefixes = new Set([...focusTokens].filter((t) => t.length >= 5).map((t) => t.slice(0, 5)));
    const scored = products.map((p, i) => {
      const pt = tokens(p.name);
      let score = 0;
      for (const t of pt) {
        if (focusTokens.has(t)) score += 3;
        else if (t.length >= 5 && focusPrefixes.has(t.slice(0, 5))) score += 1.5;
        if (STAPLES.has(t)) score += 1;
      }
      if (p.category === 'aceite' || p.category === 'condimento') score += 0.5;
      return { p, i, score };
    });
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    omitted = products.length - cap;
    products = scored.slice(0, cap).map((s) => s.p);
  }
  products.sort(
    (a, b) =>
      (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99) ||
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const refs = new Map<string, string>();
  const lines = products.map((p, i) => {
    const ref = `P${i + 1}`;
    refs.set(ref, p.id);
    const name = cleanText(p.name).replace(/\|/g, '/');
    return `${ref}|${name}|${p.baseUnit}|${p.category}|${formatPrice(p.pricePerBase)}`;
  });
  const text = lines.length ? `${RECIPES_CATALOG_HEADER}\n${lines.join('\n')}` : RECIPES_NO_CATALOG;
  return { text, refs, ids: new Set(products.map((p) => p.id)), omitted };
}

function dishLine(d: RecipeRequestDish, ref: string): string {
  const parts = [`${ref} · ${cleanText(d.name)}`];
  const section = cleanText(d.section);
  if (section) parts.push(`Sección: ${section}`);
  if (d.price !== undefined && Number.isFinite(d.price) && d.price > 0) parts.push(`PVP ${fmtEur(d.price)} (IVA incluido)`);
  const description = cleanText(d.description);
  if (description) parts.push(`Descripción: ${description}`);
  return parts.join(' · ');
}

// ───────────────────────────── Lotes ─────────────────────────────

export interface RecipeProposalResult {
  proposals: Map<string, DishProposal>;
  /** Avisos para el usuario (lotes fallidos, catálogo recortado…). */
  warnings: string[];
  /** Claves de los platos sin propuesta de la IA (el llamador puede usar la base de recetas local). */
  failed: string[];
}

interface BatchCtx {
  settings: AppSettings;
  catalog: CatalogProduct[];
  signal?: AbortSignal;
  onProgress?: ProgressFn;
  range: [number, number];
  stage: string;
}

async function runBatch(batch: RecipeRequestDish[], ctx: BatchCtx): Promise<{ proposals: Map<string, DishProposal>; omitted: number }> {
  const dishes = batch.map((d, i) => ({ ref: `D${i + 1}`, key: d.key, name: cleanText(d.name) }));
  const catalog = buildCatalogBlock(ctx.catalog, batch);
  // Instrucciones estables + catálogo (marcado para caché): los lotes siguientes reutilizan este prefijo.
  const system: AISystemBlock[] = [{ text: RECIPES_SYSTEM }, { text: catalog.text, cache: true }];
  const text = [
    'Escandalla estos platos (cantidades para UNA ración, tal y como se sirve por su PVP):',
    ...batch.map((d, i) => dishLine(d, dishes[i].ref)),
    '',
    `Devuelve exactamente ${batch.length} ${batch.length === 1 ? 'plato' : 'platos'}, cada uno con su referencia (${dishes.map((d) => d.ref).join(', ')}).`,
  ].join('\n');
  const result = await callStructuredDetailed({
    settings: ctx.settings,
    system,
    content: [{ type: 'text', text }],
    schema: recipesParseSchema,
    jsonSchema: recipesWireJsonSchema(),
    maxTokens: 32_000,
    onProgress: ctx.onProgress,
    signal: ctx.signal,
    stage: ctx.stage,
    progressRange: ctx.range,
    expectedChars: 1600 * batch.length,
  });
  return { proposals: mapRecipeBatch(result.data, { dishes, productRefs: catalog.refs, productIds: catalog.ids }), omitted: catalog.omitted };
}

/**
 * Igual que aiProposeRecipes pero devuelve también avisos y los platos que no se han podido proponer.
 * Política de errores: si un lote es demasiado grande se divide; si falla por formato o negativa se salta ese lote;
 * si falla por clave, límite, red o saturación se detiene (el resto fallaría igual). Si no sale ninguna propuesta,
 * se lanza el primer error para que el llamador pueda usar la base local e informar.
 */
export async function aiProposeRecipesDetailed(
  dishes: RecipeRequestDish[],
  catalog: CatalogProduct[],
  settings: AppSettings,
  onProgress?: ProgressFn,
  opts: { signal?: AbortSignal; batchSize?: number } = {},
): Promise<RecipeProposalResult> {
  const seenKeys = new Set<string>();
  const valid = dishes.filter((d) => {
    if (!d?.key || !cleanText(d.name) || seenKeys.has(d.key)) return false;
    seenKeys.add(d.key);
    return true;
  });
  const proposals = new Map<string, DishProposal>();
  const warnings: string[] = [];
  const failed: string[] = [];
  const total = valid.length;
  if (!total) return { proposals, warnings, failed };

  const size = Math.max(1, Math.min(12, Math.round(opts.batchSize ?? RECIPE_BATCH_SIZE)));
  const queue: RecipeRequestDish[][] = [];
  for (let i = 0; i < valid.length; i += size) queue.push(valid.slice(i, i + size));
  const batchCount = queue.length;

  let done = 0;
  let firstError: unknown;
  let omittedWarned = false;
  onProgress?.({ stage: total === 1 ? 'Preparando el plato…' : `Preparando ${total} platos…`, progress: 0.01 });

  while (queue.length) {
    const batch = queue.shift() as RecipeRequestDish[];
    const from = done / total;
    const to = (done + batch.length) / total;
    const stage =
      total === 1
        ? 'Claude está escandallando el plato…'
        : batchCount === 1
          ? `Claude está escandallando ${total} platos…`
          : `Claude está escandallando los platos ${done + 1}–${done + batch.length} de ${total}…`;
    try {
      const { proposals: got, omitted } = await runBatch(batch, { settings, catalog, signal: opts.signal, onProgress, range: [from, to], stage });
      for (const [k, v] of got) proposals.set(k, v);
      for (const d of batch) if (!got.has(d.key)) failed.push(d.key);
      if (omitted > 0 && !omittedWarned) {
        omittedWarned = true;
        warnings.push(`El catálogo tiene más de ${CATALOG_CAP} productos: para cada lote se han enviado los ${CATALOG_CAP} más relacionados con sus platos`);
      }
    } catch (err) {
      if (isAbortError(err) || opts.signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
      const e = toAIError(err);
      firstError ??= e;
      if (e.kind === 'too_large' && batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        queue.unshift(batch.slice(0, half), batch.slice(half));
        continue;
      }
      if (e.kind === 'auth' || e.kind === 'rate' || e.kind === 'network' || e.kind === 'overloaded') {
        const pending = [batch, ...queue].flat();
        failed.push(...pending.map((d) => d.key));
        queue.length = 0;
        if (!proposals.size) throw e;
        warnings.push(`${e.message} Se han propuesto ${proposals.size} de ${total} platos con IA; el resto se completa con la base de recetas local`);
        break;
      }
      failed.push(...batch.map((d) => d.key));
      const names = batch.map((d) => cleanText(d.name)).join(', ');
      warnings.push(`No se han podido proponer con IA: ${names} (${e.message})`);
    }
    done += batch.length;
    onProgress?.({ stage: `Escandallos propuestos: ${proposals.size} de ${total}`, progress: Math.min(1, done / total) });
  }

  if (!proposals.size && firstError) throw firstError;
  return { proposals, warnings, failed };
}

/**
 * Propone el escandallo de cada plato: ingredientes con cantidad POR RACIÓN, unidad, base (bruta/neta/cocinada),
 * mermas estimadas y, cuando exista, el producto del catálogo (facturas) que corresponde a cada ingrediente
 * (campo productId, SÓLO ids del catálogo dado). Procesa en lotes de 6 platos por llamada (secuenciales, con el catálogo en caché) y reporta progreso.
 * Los platos que la IA no haya podido proponer no aparecen en el mapa (el llamador usa la base de recetas local).
 */
export async function aiProposeRecipes(
  dishes: RecipeRequestDish[],
  catalog: CatalogProduct[],
  settings: AppSettings,
  onProgress?: ProgressFn,
  opts: { signal?: AbortSignal; batchSize?: number } = {},
): Promise<Map<string, DishProposal>> {
  return (await aiProposeRecipesDetailed(dishes, catalog, settings, onProgress, opts)).proposals;
}
