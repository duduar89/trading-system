import type { Allergen, DishProposal, IngredientCategory, ProposedIngredient, QtyBasis, QtyUnit } from '../types';
import type { KbRecipe, KbRecipeItem } from './recipes';
import { KB_RECIPES } from './recipes';
import { type KbIngredient, findKbIngredient, kbIngredientIndex, scanPhrases } from './ingredients';
import { KB_PREPARATIONS, type KbPreparation } from './data/preparations';
import type { ItemTuple } from './data/build';
import {
  COOKING_METHODS,
  type CookingMethod,
  DISH_FRAMES,
  type DishFrame,
  PASTAS,
  type QtySpec,
  type RoleGroup,
  SUBSTITUTE_GROUPS,
  drinkQty,
  isMainCandidate,
  isMixer,
  isSpirit,
  mainQty,
  roleGroup,
  secondaryQty,
} from './data/roles';
import { CULINARY_WORDS, STOPWORDS, type Token, allowedTypos, contentTokens, editDistance, rawWords } from './text';

/**
 * Propuesta de escandallo 100 % local (sin IA):
 *  1. Receta tipo: emparejamiento por tokens ponderados (IDF) del nombre y la descripción con los nombres y alias
 *     de KB_RECIPES, tolerante a erratas y variantes ("Pulpo a feira", "Bravas", "Croquetas caseras de jamón ibérico").
 *     Después se ajusta a la carta: sustituye variantes ("tomate raf", "guanciale"), el ingrediente que da nombre
 *     a la receta ("croquetas de gambas" sobre croquetas de jamón), la guarnición si la carta menciona otra y añade extras.
 *  2. Heurística: detecta ingredientes y elaboraciones (n-gramas de 1–6 palabras contra nombres y alias), el tipo de plato
 *     (hamburguesa, arroz, ensalada, crema…) y el método de cocción, y asigna gramajes profesionales por rol.
 */

/** Umbral a partir del cual se usa la receta tipo. */
export const KB_TEMPLATE_THRESHOLD = 0.72;
/** Por debajo de esto findKbRecipe no devuelve nada (no hay parecido razonable). */
const RECIPE_MIN_SCORE = 0.4;

const CONNECTORS = new Set(['con', 'sobre', 'y', 'e', 'acompanado', 'acompanada', 'acompanados', 'acompanadas', 'servido', 'servida', 'junto', 'mas', 'sin']);
const UNIT_WORDS = new Set(['kg', 'kgs', 'g', 'gr', 'grs', 'gramos', 'cl', 'ml', 'l', 'litro', 'uds', 'unidades', 'piezas', 'pieza', 'pax', 'eur', 'euros']);
const SEGMENT_SPLIT = /[,;:.()[\]{}|•·\n]+|\s[-–—]\s/;

// ───────────────────────────── Tokenización de platos ─────────────────────────────

interface DishToken extends Token {
  /** Segmento (0 = primero del nombre). */
  seg: number;
  /** Parte principal del nombre (antes de "con", "sobre", "y"…). */
  head: boolean;
  /** Pertenece al nombre (true) o a la descripción (false). */
  inName: boolean;
  /** Negado con "sin". */
  negated: boolean;
}

function tokenizeDishText(text: string, inName: boolean, segOffset = 0): DishToken[] {
  const out: DishToken[] = [];
  const segments = text.split(SEGMENT_SPLIT);
  let seg = segOffset;
  for (const segment of segments) {
    const raw = rawWords(segment);
    if (!raw.length) continue;
    let connectorAt = raw.length;
    if (inName) {
      const idx = raw.findIndex((w, i) => i > 0 && CONNECTORS.has(w));
      if (idx >= 0) connectorAt = idx;
    }
    const negatedPos = new Set<number>();
    raw.forEach((w, i) => {
      if (w !== 'sin') return;
      for (let j = i + 1; j < raw.length; j++) {
        if (STOPWORDS.has(raw[j])) continue;
        negatedPos.add(j);
        // "sin gluten ni lactosa": también lo encadenado con "ni" / "y"
        if (raw[j + 1] === 'ni' || raw[j + 1] === 'y') {
          i = j + 1;
          continue;
        }
        break;
      }
    });
    for (const tk of contentTokens(segment)) {
      if (UNIT_WORDS.has(tk.raw) || tk.raw === 'ni' || tk.raw === 'sin') continue;
      out.push({
        ...tk,
        seg,
        head: inName && seg === segOffset && tk.pos < connectorAt,
        inName,
        negated: negatedPos.has(tk.pos),
      });
    }
    seg++;
  }
  return out;
}

// ───────────────────────────── Índice de recetas tipo ─────────────────────────────

interface RecipeVariant {
  recipe: number;
  tokens: string[];
  set: Set<string>;
}

interface RecipeIndex {
  variants: RecipeVariant[];
  byToken: Map<string, number[]>;
  idf: Map<string, number>;
  maxIdf: number;
  vocab: Set<string>;
  vocabByInitial: Map<string, string[]>;
  /** Tokens de nombre + alias de cada receta. */
  recipeTokens: Set<string>[];
}

let RECIPE_INDEX: RecipeIndex | undefined;

function recipeIndex(): RecipeIndex {
  if (RECIPE_INDEX) return RECIPE_INDEX;
  const variants: RecipeVariant[] = [];
  const byToken = new Map<string, number[]>();
  const df = new Map<string, number>();
  const recipeTokens: Set<string>[] = [];
  KB_RECIPES.forEach((r, ri) => {
    const all = new Set<string>();
    const seen = new Set<string>();
    for (const text of [r.name, ...(r.aliases ?? [])]) {
      const tokens = contentTokens(text)
        .map((t) => t.t)
        .filter((t) => !UNIT_WORDS.has(t));
      if (!tokens.length) continue;
      const key = [...new Set(tokens)].sort().join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      const vi = variants.length;
      variants.push({ recipe: ri, tokens: [...new Set(tokens)], set: new Set(tokens) });
      for (const t of new Set(tokens)) {
        all.add(t);
        const list = byToken.get(t) ?? [];
        list.push(vi);
        byToken.set(t, list);
      }
    }
    recipeTokens.push(all);
    for (const t of all) df.set(t, (df.get(t) ?? 0) + 1);
  });
  const n = KB_RECIPES.length;
  const idf = new Map<string, number>();
  let maxIdf = 0;
  for (const [t, d] of df) {
    const v = Math.log(1 + n / d);
    idf.set(t, v);
    if (v > maxIdf) maxIdf = v;
  }
  const vocab = new Set(df.keys());
  const vocabByInitial = new Map<string, string[]>();
  for (const t of vocab) {
    if (t.length < 5) continue;
    const b = vocabByInitial.get(t[0]) ?? [];
    b.push(t);
    vocabByInitial.set(t[0], b);
  }
  RECIPE_INDEX = { variants, byToken, idf, maxIdf, vocab, vocabByInitial, recipeTokens };
  return RECIPE_INDEX;
}

/** Corrige erratas contra un vocabulario (misma inicial, distancia de edición según longitud). */
function fuzzyVocab(t: string, vocab: Set<string>, byInitial: Map<string, string[]>): string | undefined {
  if (vocab.has(t)) return t;
  const max = allowedTypos(t.length);
  if (!max) return undefined;
  let best: string | undefined;
  let bestD = max + 1;
  for (const cand of byInitial.get(t[0]) ?? []) {
    if (Math.abs(cand.length - t.length) > max) continue;
    const d = editDistance(t, cand, max);
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  return bestD <= max ? best : undefined;
}

interface QueryToken {
  t: string;
  head: boolean;
  fuzzy: boolean;
}

function normalizeQuery(tokens: DishToken[], idx: RecipeIndex): QueryToken[] {
  return tokens
    .filter((t) => !t.negated)
    .map((tk) => {
      const fixed = idx.vocab.has(tk.t) ? tk.t : fuzzyVocab(tk.t, idx.vocab, idx.vocabByInitial);
      return { t: fixed ?? tk.t, head: tk.head, fuzzy: !!fixed && fixed !== tk.t };
    });
}

/** Contexto del plato que penaliza recetas incompatibles. */
interface MatchContext {
  /** Tokens de la primera detección principal de la cabeza del nombre (p. ej. "merluza"). */
  headMain?: string[];
  /** Palabras de tipo de plato o de método "fuerte" presentes en la cabeza del nombre. */
  contextWords: Set<string>;
}

function scoreVariant(v: RecipeVariant, name: QueryToken[], desc: QueryToken[], idx: RecipeIndex, ctx: MatchContext): number {
  const idf = (t: string) => idx.idf.get(t) ?? idx.maxIdf;
  const nameMap = new Map<string, QueryToken>();
  for (const q of name) if (!nameMap.has(q.t) || !q.fuzzy) nameMap.set(q.t, q);
  const descSet = new Set(desc.map((q) => q.t));

  let total = 0;
  let got = 0;
  for (const t of v.tokens) {
    const w = idf(t);
    total += w;
    const q = nameMap.get(t);
    if (q) got += w * (q.fuzzy ? 0.9 : 1);
    else if (descSet.has(t)) got += w * 0.7;
  }
  const rc = total ? got / total : 0;

  let qTot = 0;
  let qGot = 0;
  let hasHead = false;
  let headMatched = false;
  const uniqueName = new Map<string, QueryToken>();
  for (const q of name) if (!uniqueName.has(q.t)) uniqueName.set(q.t, q);
  for (const q of uniqueName.values()) {
    const w = (q.head ? 1 : 0.35) * idf(q.t);
    qTot += w;
    if (q.head) hasHead = true;
    if (v.set.has(q.t)) {
      qGot += w;
      if (q.head) headMatched = true;
    }
  }
  const qc = qTot ? qGot / qTot : 0;

  // Coincidencia exacta del nombre con la receta o un alias
  if (uniqueName.size && uniqueName.size === v.set.size && [...uniqueName.keys()].every((t) => v.set.has(t))) {
    const anyFuzzy = [...uniqueName.values()].some((q) => q.fuzzy);
    return anyFuzzy ? 0.96 : 1;
  }
  let score = 0.7 * rc + 0.3 * qc;
  if (hasHead && !headMatched) score *= 0.75;
  if (v.tokens.length === 1) score *= 0.85 + 0.15 * qc;
  // El producto principal del nombre ("merluza" en "Merluza a la plancha con verduras") debe estar en la receta
  if (ctx.headMain && !ctx.headMain.some((t) => v.set.has(t)) && !ctx.headMain.every((t) => idx.recipeTokens[v.recipe].has(t))) score *= 0.7;
  // Tipo de plato o método que la receta no contempla ("pizza de burrata", "chipirones encebollados")
  for (const w of ctx.contextWords) {
    if (!v.set.has(w) && !idx.recipeTokens[v.recipe].has(w)) {
      score *= 0.7;
      break;
    }
  }
  return score;
}

interface RecipeMatch {
  recipe: KbRecipe;
  score: number;
  /** Tokens del nombre o alias que dio la coincidencia. */
  variant: string[];
}

const RECIPE_CACHE = new Map<string, RecipeMatch | null>();

/** Receta tipo más parecida al nombre (y descripción) del plato. */
export function findKbRecipe(name: string, description?: string): { recipe: KbRecipe; score: number } | undefined {
  const m = matchRecipe(name, description);
  return m ? { recipe: m.recipe, score: m.score } : undefined;
}

function matchRecipe(name: string, description?: string, pre?: { nameToks: DishToken[]; descToks: DishToken[]; dets: Detection[] }): RecipeMatch | undefined {
  const key = `${name}\u0000${description ?? ''}`;
  const cached = RECIPE_CACHE.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const nameToks = pre?.nameToks ?? tokenizeDishText(name, true);
  const descToks = pre?.descToks ?? (description ? tokenizeDishText(description, false, 100) : []);
  const dets = pre?.dets ?? detectAll(nameToks, descToks).found;
  const res = computeRecipeMatch(nameToks, descToks, dets);
  if (RECIPE_CACHE.size > 3000) RECIPE_CACHE.clear();
  RECIPE_CACHE.set(key, res ?? null);
  return res;
}

let CONTEXT_WORDS: Set<string> | undefined;
/** Palabras de tipo de plato y de métodos que cambian la receta (no incluye plancha/brasa/horno, compatibles con casi todo). */
function contextWordSet(): Set<string> {
  if (CONTEXT_WORDS) return CONTEXT_WORDS;
  const s = new Set<string>();
  for (const f of DISH_FRAMES) for (const tr of f.triggers) for (const t of contentTokens(tr)) s.add(t.t);
  const strong = new Set(['romana', 'tempura', 'empanado', 'frito', 'ajillo', 'escabeche', 'encebollado', 'confitado', 'guiso', 'wok']);
  for (const m of COOKING_METHODS) if (strong.has(m.id)) for (const tr of m.triggers) for (const t of contentTokens(tr)) s.add(t.t);
  for (const w of ['huevo', 'copa', 'jarra', 'botella', 'vaso', 'cana', 'tercio']) s.delete(w);
  CONTEXT_WORDS = s;
  return s;
}

function computeRecipeMatch(nameToks: DishToken[], descToks: DishToken[], dets: Detection[]): RecipeMatch | undefined {
  const idx = recipeIndex();
  const name = normalizeQuery(nameToks, idx);
  if (!name.length) return undefined;
  const desc = normalizeQuery(descToks, idx);
  const ctxWords = contextWordSet();
  const headMainDet = dets.find((d) => d.inName && d.head && d.target.kind === 'ing' && swapFamily(roleGroup(d.target.ing)) !== undefined);
  const ctx: MatchContext = {
    headMain: headMainDet?.tokens,
    contextWords: new Set(name.filter((q) => q.head && ctxWords.has(q.t)).map((q) => q.t)),
  };
  const candidates = new Set<number>();
  for (const q of [...name, ...desc]) for (const vi of idx.byToken.get(q.t) ?? []) candidates.add(vi);
  let best: { vi: number; score: number } | undefined;
  for (const vi of candidates) {
    const s = scoreVariant(idx.variants[vi], name, desc, idx, ctx);
    if (!best || s > best.score + 1e-9) best = { vi, score: s };
  }
  if (!best || best.score < RECIPE_MIN_SCORE) return undefined;
  const v = idx.variants[best.vi];
  return { recipe: KB_RECIPES[v.recipe], score: Math.round(best.score * 1000) / 1000, variant: v.tokens };
}

// ───────────────────────────── Detección de ingredientes y elaboraciones ─────────────────────────────

type DetectTarget = { kind: 'ing'; ing: KbIngredient } | { kind: 'prep'; prep: KbPreparation };

interface Detection {
  target: DetectTarget;
  key: string;
  tokens: string[];
  inName: boolean;
  head: boolean;
  /** Orden de aparición (nombre antes que descripción). */
  order: number;
}

interface DetectIndex {
  map: Map<string, DetectTarget>;
  maxLen: number;
  singleByInitial: Map<string, { key: string; target: DetectTarget }[]>;
  vocabulary: Set<string>;
}

let DETECT_INDEX: DetectIndex | undefined;

/** Palabras que nunca se detectan en texto libre (ambiguas en castellano). */
const DETECTION_BLOCKLIST = new Set(['mayo', 'te', 'fino', 'rulo', 'tinta', 'hongo', 'barbacoa', 'salsa', 'crema', 'caldo']);

function detectIndex(): DetectIndex {
  if (DETECT_INDEX) return DETECT_INDEX;
  const ingIdx = kbIngredientIndex();
  const map = new Map<string, DetectTarget>();
  let maxLen = ingIdx.maxTokens;
  for (const [key, ing] of ingIdx.byKey) {
    if (DETECTION_BLOCKLIST.has(key)) continue;
    map.set(key, { kind: 'ing', ing });
  }
  for (const prep of KB_PREPARATIONS) {
    for (const text of [prep.name, ...prep.aliases]) {
      const toks = contentTokens(text.replace(/\(.*?\)/g, '')).map((t) => t.t);
      if (!toks.length) continue;
      const key = toks.join(' ');
      if (DETECTION_BLOCKLIST.has(key)) continue;
      map.set(key, { kind: 'prep', prep });
      if (toks.length > maxLen) maxLen = toks.length;
    }
  }
  const singleByInitial = new Map<string, { key: string; target: DetectTarget }[]>();
  for (const [key, target] of map) {
    if (key.includes(' ') || key.length < 5) continue;
    const b = singleByInitial.get(key[0]) ?? [];
    b.push({ key, target });
    singleByInitial.set(key[0], b);
  }
  const vocabulary = new Set<string>([...ingIdx.vocabulary, ...recipeIndex().vocab, ...STOPWORDS, ...CULINARY_WORDS]);
  for (const k of map.keys()) for (const t of k.split(' ')) vocabulary.add(t);
  for (const f of DISH_FRAMES) for (const tr of f.triggers) for (const t of contentTokens(tr)) vocabulary.add(t.t);
  for (const m of COOKING_METHODS) for (const tr of m.triggers) for (const t of contentTokens(tr)) vocabulary.add(t.t);
  DETECT_INDEX = { map, maxLen, singleByInitial, vocabulary };
  return DETECT_INDEX;
}

interface DetectResult {
  found: Detection[];
  /** Lo mencionado con "sin" ("sin cebolla", "sin pan"): se retira de la receta tipo. */
  negated: Detection[];
}

function detectInTokens(tokens: DishToken[], orderBase: number): DetectResult {
  const idx = detectIndex();
  const found: Detection[] = [];
  const negated: Detection[] = [];
  // Por segmentos, para no unir palabras separadas por comas
  const segs = new Map<number, DishToken[]>();
  for (const t of tokens) {
    const list = segs.get(t.seg) ?? [];
    list.push(t);
    segs.set(t.seg, list);
  }
  let order = orderBase;
  for (const seg of [...segs.keys()].sort((a, b) => a - b)) {
    const list = segs.get(seg) ?? [];
    const covered = new Array<boolean>(list.length).fill(false);
    const hits = scanPhrases(list, idx.map, idx.maxLen);
    for (const h of hits) {
      for (let k = h.start; k < h.start + h.length; k++) covered[k] = true;
      const det: Detection = {
        target: h.item,
        key: h.key,
        tokens: h.key.split(' '),
        inName: list[h.start].inName,
        head: list[h.start].head,
        order: order + h.start,
      };
      if (list.slice(h.start, h.start + h.length).some((t) => t.negated)) negated.push(det);
      else found.push(det);
    }
    // Erratas (OCR): palabras desconocidas de 5+ letras contra claves de una sola palabra
    list.forEach((tk, i) => {
      if (covered[i] || tk.negated || idx.vocabulary.has(tk.t) || tk.t.length < 5) return;
      const max = allowedTypos(tk.t.length);
      let best: { key: string; target: DetectTarget } | undefined;
      let bestD = max + 1;
      for (const cand of idx.singleByInitial.get(tk.t[0]) ?? []) {
        if (Math.abs(cand.key.length - tk.t.length) > max) continue;
        const d = editDistance(tk.t, cand.key, max);
        if (d < bestD) {
          bestD = d;
          best = cand;
        }
      }
      if (best && bestD <= max) found.push({ target: best.target, key: best.key, tokens: [best.key], inName: tk.inName, head: tk.head, order: order + i });
    });
    order += list.length + 1;
  }
  found.sort((a, b) => a.order - b.order);
  return { found, negated };
}

function targetId(d: Detection): string {
  return d.target.kind === 'ing' ? `i:${d.target.ing.name}` : `p:${d.target.prep.name}`;
}

function detectAll(nameToks: DishToken[], descToks: DishToken[]): DetectResult {
  const a = detectInTokens(nameToks, 0);
  const b = detectInTokens(descToks, 10000);
  const negated = [...a.negated, ...b.negated];
  const negIds = new Set(negated.map(targetId));
  // Sin duplicados (mismo ingrediente/elaboración): se queda la primera aparición
  const seen = new Set<string>();
  const found = [...a.found, ...b.found].filter((d) => {
    const id = targetId(d);
    if (d.target.kind === 'prep' && d.target.prep.tailOnly && d.head) return false;
    if (seen.has(id) || negIds.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { found, negated };
}

// ───────────────────────────── Utilidades de propuesta ─────────────────────────────

function kbByName(name: string): KbIngredient | undefined {
  return kbIngredientIndex().byName.get(name) ?? findKbIngredient(name);
}

function roundQty(q: number, unit: QtyUnit): number {
  if (unit === 'ud' || unit === 'docena') return Math.max(0.5, Math.round(q * 2) / 2);
  if (q >= 100) return Math.round(q / 5) * 5;
  if (q >= 10) return Math.round(q);
  if (q >= 1) return Math.round(q * 2) / 2;
  return Math.round(q * 100) / 100;
}

function toProposed(name: string, quantity: number, unit: QtyUnit, basis: QtyBasis, extra: Partial<ProposedIngredient> = {}): ProposedIngredient {
  const kb = kbByName(name);
  const p: ProposedIngredient = { name, quantity, unit, basis };
  const category: IngredientCategory | undefined = kb?.category;
  if (category) p.category = category;
  if (extra.wastePct != null) p.wastePct = extra.wastePct;
  if (extra.cookingLossPct != null) p.cookingLossPct = extra.cookingLossPct;
  if (extra.note) p.note = extra.note;
  return p;
}

function fromRecipeItem(it: KbRecipeItem, factor = 1): ProposedIngredient {
  return toProposed(it.name, factor === 1 ? it.quantity : roundQty(it.quantity * factor, it.unit), it.unit, it.basis, {
    wastePct: it.wastePct,
    cookingLossPct: it.cookingLossPct,
    note: it.note,
  });
}

function fromTuple(t: ItemTuple, factor = 1): ProposedIngredient {
  const [name, q, unit] = t;
  const basis: QtyBasis = t.length >= 4 ? (t[3] as QtyBasis) : 'neta';
  const opts = t.length === 5 ? t[4] : undefined;
  return toProposed(name, factor === 1 ? q : roundQty(q * factor, unit), unit, basis, { note: opts?.note, cookingLossPct: opts?.cook, wastePct: opts?.waste });
}

function fromSpec(ing: KbIngredient, spec: QtySpec, factor = 1, extra: Partial<ProposedIngredient> = {}): ProposedIngredient {
  const [q, unit, basis] = spec;
  return toProposed(ing.name, roundQty(q * factor, unit), unit, basis ?? 'neta', extra);
}

/** Lista de ingredientes sin duplicados: si se repite un ingrediente con la misma unidad se suman cantidades. */
class ItemList {
  items: ProposedIngredient[] = [];
  has(name: string): boolean {
    return this.items.some((i) => i.name === name);
  }
  add(p: ProposedIngredient, merge = true): void {
    const same = this.items.find((i) => i.name === p.name);
    if (same) {
      if (merge && same.unit === p.unit && same.basis === p.basis) same.quantity = roundQty(same.quantity + p.quantity, same.unit);
      return;
    }
    this.items.push(p);
  }
  /** Añade sólo si no hay ya un ingrediente con ese nombre. */
  ensure(p: ProposedIngredient): void {
    if (!this.has(p.name)) this.items.push(p);
  }
}

function groupOf(name: string): string[] | undefined {
  return SUBSTITUTE_GROUPS.find((g) => g.includes(name));
}

function allergensOf(items: ProposedIngredient[]): Allergen[] {
  const set = new Set<Allergen>();
  for (const it of items) for (const a of kbByName(it.name)?.allergens ?? []) set.add(a);
  return [...set].sort();
}

/** Tokens significativos del nombre de un ingrediente de la base (nombre + alias). */
const ING_TOKENS = new Map<string, Set<string>>();
function ingredientTokens(ing: KbIngredient): Set<string> {
  let s = ING_TOKENS.get(ing.name);
  if (!s) {
    s = new Set<string>();
    for (const text of [ing.name, ...ing.aliases]) for (const t of contentTokens(text)) s.add(t.t);
    ING_TOKENS.set(ing.name, s);
  }
  return s;
}

/** Palabras genéricas de corte/formato que no identifican al producto. */
const GENERIC_TOKENS = new Set([
  'lomo', 'filete', 'carne', 'cola', 'pieza', 'loncheado', 'loncheada', 'fresco', 'fresca', 'congelado', 'congelada', 'entero', 'entera', 'crudo', 'cocido',
  'rojo', 'roja', 'blanco', 'blanca', 'verde', 'negro', 'negra', 'dulce', 'seco', 'seca', 'conserva', 'aceite', 'vinagre', 'salsa', 'pan',
]);

/** ¿Es `detected` una variante de `templateIng` (mismo grupo o misma palabra principal y categoría)? */
function isVariant(detected: KbIngredient, templateIng: KbIngredient): boolean {
  if (detected.name === templateIng.name) return false;
  const g = groupOf(detected.name);
  if (g && g.includes(templateIng.name)) return true;
  if (detected.category !== templateIng.category) return false;
  const a = contentTokens(detected.name).map((t) => t.t).filter((t) => !GENERIC_TOKENS.has(t));
  const b = new Set(contentTokens(templateIng.name).map((t) => t.t).filter((t) => !GENERIC_TOKENS.has(t)));
  return a.length > 0 && a[0] !== undefined && b.has(a[0]);
}

type SwapFamily = 'protein' | 'veg';
function swapFamily(g: RoleGroup): SwapFamily | undefined {
  if (g === 'protein' || g === 'cheese') return 'protein';
  if (g === 'veg' || g === 'legume') return 'veg';
  return undefined;
}

// ───────────────────────────── Receta tipo + ajustes a la carta ─────────────────────────────

const VEGGIE_WORDS = new Set(['vegano', 'vegana', 'veganos', 'veganas', 'vegetariano', 'vegetariana', 'vegetarianos', 'vegetarianas', 'vegan', 'veggie']);

function isVeggie(nameToks: DishToken[], descToks: DishToken[]): boolean {
  return [...nameToks, ...descToks].some((t) => VEGGIE_WORDS.has(t.raw));
}

function hasAnimalProtein(recipe: KbRecipe): boolean {
  return recipe.items.some((it) => {
    const kb = kbByName(it.name);
    return !!kb && ['carne', 'pescado', 'marisco', 'charcuteria'].includes(kb.category);
  });
}

/** "Media ración de…" = 2 medias por receta; "Tapa de…" ≈ un tercio de ración. */
function portionFactor(rawName: string[], dets: Detection[]): number {
  const first = rawName[0];
  if (first === 'media' && (rawName[1] === 'racion' || rawName[1] === 'raciones')) return 2;
  if (first === 'tapa' && !dets.some((d) => d.inName && d.tokens[0] === 'tapa')) return 3;
  return 1;
}

/**
 * Si se sustituye un ingrediente de la receta por uno mencionado en la carta, busca la forma equivalente:
 * "Taquitos de jamón" + "jamón ibérico" → "Taquitos de jamón ibérico" (y no el loncheado).
 */
function refineSubstitute(templateIng: KbIngredient, detected: KbIngredient): KbIngredient {
  const tTok = contentTokens(templateIng.name).map((t) => t.t);
  const dTok = new Set(contentTokens(detected.name).map((t) => t.t));
  let best: KbIngredient | undefined;
  for (const k of KB_INGREDIENTS_LIST()) {
    if (k.name === templateIng.name || k.name === detected.name) continue;
    const kTok = contentTokens(k.name).map((t) => t.t);
    if (!tTok.every((t) => kTok.includes(t))) continue;
    const extra = kTok.filter((t) => !tTok.includes(t));
    if (extra.length && extra.every((t) => dTok.has(t)) && (!best || kTok.length > contentTokens(best.name).length)) best = k;
  }
  return best ?? detected;
}

function KB_INGREDIENTS_LIST(): KbIngredient[] {
  return [...kbIngredientIndex().byName.values()];
}

interface TemplateItem {
  src: KbRecipeItem;
  p: ProposedIngredient;
  kb?: KbIngredient;
}

/**
 * Receta tipo ajustada a lo que dice la carta. Devuelve undefined si la receta no explica el producto principal
 * del plato (p. ej. "Ensalada de gambas" contra una ensalada mixta genérica): entonces manda la heurística.
 */
function proposeFromTemplate(name: string, match: RecipeMatch, found: Detection[], negated: Detection[], factor: number): DishProposal | undefined {
  const { recipe, score } = match;
  const nameTokens = new Set<string>();
  for (const t of contentTokens(recipe.name)) nameTokens.add(t.t);
  let items: TemplateItem[] = recipe.items.map((it) => ({ src: it, p: fromRecipeItem(it), kb: kbByName(it.name) }));
  const portions = recipe.portions;

  // "Sin cebolla", "sin pan", "sin queso": se retira de la receta
  if (negated.length) {
    const negTokens = new Set(negated.flatMap((d) => (d.target.kind === 'ing' ? d.tokens : [])));
    const negNames = new Set(negated.map((d) => (d.target.kind === 'ing' ? d.target.ing.name : '')));
    items = items.filter((it) => {
      if (!it.kb) return true;
      if (negNames.has(it.kb.name)) return false;
      const toks = ingredientTokens(it.kb);
      return ![...negTokens].some((t) => toks.has(t) && !GENERIC_TOKENS.has(t));
    });
  }

  // Ingredientes que dan nombre a la receta (p. ej. el jamón de "croquetas de jamón") y no aparecen en la carta
  const dishTokenSet = new Set(found.flatMap((d) => d.tokens));
  const swappable = new Set<number>();
  items.forEach((it, i) => {
    if (!it.kb || it.src.garnish) return;
    const toks = ingredientTokens(it.kb);
    const named = [...toks].some((t) => nameTokens.has(t) && !GENERIC_TOKENS.has(t));
    const inDish = [...toks].some((t) => dishTokenSet.has(t) && !GENERIC_TOKENS.has(t));
    if (named && !inDish && swapFamily(roleGroup(it.kb))) swappable.add(i);
  });

  const extras: ProposedIngredient[] = [];
  let replaceGarnish = false;
  const newSides: ProposedIngredient[] = [];
  let unexplainedMain = false;

  for (const d of found) {
    // Lo que ya forma parte del nombre de la receta no se toca ("queso" en "tarta de queso")
    if (d.tokens.every((t) => nameTokens.has(t))) continue;
    if (d.target.kind === 'prep') {
      const prep = d.target.prep;
      const prepItems = prep.items.map((it) => fromRecipeItem(it, portions));
      const missing = prepItems.filter((p) => !items.some((it) => it.src.name === p.name));
      if (!missing.length) continue;
      if (prep.role === 'guarnicion' && items.some((it) => it.src.garnish)) {
        replaceGarnish = true;
        newSides.push(...prepItems);
      } else extras.push(...missing);
      continue;
    }
    const ing = d.target.ing;
    if (items.some((it) => it.src.name === ing.name)) continue;
    const group = roleGroup(ing);
    // 1) Sustituye al ingrediente "de nombre" de la receta (croquetas de jamón → croquetas de gambas)
    const fam = swapFamily(group);
    if (fam) {
      const si = [...swappable].find((i) => {
        const kb = items[i].kb;
        return kb && swapFamily(roleGroup(kb)) === fam;
      });
      if (si != null) {
        const old = items[si];
        const target = old.kb ? refineSubstitute(old.kb, ing) : ing;
        let p: ProposedIngredient;
        if (old.p.unit === 'ud' && target.baseUnit !== 'ud') {
          p = toProposed(target.name, roundQty(old.p.quantity * (old.kb?.unitWeightKg ?? 0.05) * 1000, 'g'), 'g', 'neta');
        } else p = toProposed(target.name, old.p.quantity, old.p.unit, old.p.basis);
        items[si] = { src: { ...old.src, name: target.name }, p, kb: target };
        swappable.delete(si);
        continue;
      }
    }
    // 2) Variante de un ingrediente de la receta (tomate → tomate raf, bacon → guanciale)
    const variants = items.map((it, i) => ({ it, i })).filter(({ it }) => it.kb && isVariant(ing, it.kb));
    if (variants.length === 1) {
      const { it, i } = variants[0];
      const target = it.kb ? refineSubstitute(it.kb, ing) : ing;
      items[i] = { src: { ...it.src, name: target.name }, p: { ...it.p, name: target.name, category: target.category }, kb: target };
      continue;
    }
    if (variants.length > 1) continue;
    // 3) Guarnición distinta mencionada en la carta
    if ((group === 'veg' || group === 'legume' || group === 'starch') && !d.head && items.some((it) => it.src.garnish)) {
      replaceGarnish = true;
      newSides.push(fromSpec(ing, secondaryQty(ing, group), portions));
      continue;
    }
    if (d.inName && d.head && fam === 'protein') unexplainedMain = true;
    // 4) Extra
    if (ing.name === 'Sal') continue;
    extras.push(fromSpec(ing, secondaryQty(ing, group), portions));
  }

  // Una receta genérica de una sola palabra ("ensalada", "hamburguesa") no explica "de gambas": mejor la heurística
  if (unexplainedMain && match.variant.length === 1) return undefined;

  if (replaceGarnish) items = items.filter((it) => !it.src.garnish);
  const list = new ItemList();
  for (const it of items) list.add(it.p);
  for (const p of newSides) list.add(p);
  for (const p of extras.slice(0, 8)) list.add(p);

  const proposal: DishProposal = {
    dishName: name.trim(),
    portions: portions * factor,
    ingredients: list.items,
    allergens: allergensOf(list.items),
    source: 'plantilla',
    templateName: recipe.name,
    confidence: Math.min(1, Math.round(score * 100) / 100),
  };
  if (recipe.procedure) proposal.procedure = recipe.procedure;
  return proposal;
}

// ───────────────────────────── Heurística ─────────────────────────────

function detectFrame(nameToks: DishToken[]): DishFrame | undefined {
  let best: { frame: DishFrame; pos: number; len: number } | undefined;
  const toks = nameToks.filter((t) => !t.negated).map((t) => t.t);
  for (const frame of DISH_FRAMES) {
    for (const trig of frame.triggers) {
      const tt = contentTokens(trig).map((t) => t.t);
      if (!tt.length) continue;
      for (let i = 0; i + tt.length <= toks.length; i++) {
        if (tt.every((t, k) => toks[i + k] === t)) {
          if (!best || i < best.pos || (i === best.pos && tt.length > best.len)) best = { frame, pos: i, len: tt.length };
          break;
        }
      }
    }
  }
  return best?.frame;
}

function detectMethods(tokens: DishToken[]): CookingMethod[] {
  const toks = tokens.filter((t) => !t.negated).map((t) => t.t);
  const joined = ` ${toks.join(' ')} `;
  return COOKING_METHODS.filter((m) => m.triggers.some((tr) => joined.includes(` ${contentTokens(tr).map((t) => t.t).join(' ')} `)));
}

function lower(s: string): string {
  return s.charAt(0).toLocaleLowerCase('es-ES') + s.slice(1);
}

function formatQty(p: ProposedIngredient): string {
  const q = String(p.quantity).replace('.', ',');
  return `${q} ${p.unit}`;
}

function proposeHeuristic(name: string, nameToks: DishToken[], descToks: DishToken[], dets: Detection[]): DishProposal {
  const frame = detectFrame(nameToks);
  const methods = detectMethods([...nameToks, ...descToks]);
  const kind = frame?.kind ?? 'salado';
  const list = new ItemList();
  const sides: string[] = [];

  const ingDets = dets.filter((d): d is Detection & { target: { kind: 'ing'; ing: KbIngredient } } => d.target.kind === 'ing');
  const firstDrink = ingDets.find((d) => roleGroup(d.target.ing) === 'drink');
  const hasFood = ingDets.some((d) => ['protein', 'cheese', 'veg', 'starch', 'legume'].includes(roleGroup(d.target.ing)));
  const isDrink = kind === 'bebida' || (!!firstDrink && !hasFood && firstDrink.inName);

  // ── Bebidas ──
  if (isDrink) {
    let spirit = false;
    let mixer = false;
    for (const d of ingDets) {
      const ing = d.target.ing;
      if (roleGroup(ing) !== 'drink' && ing.name !== 'Lima' && ing.name !== 'Limón' && ing.name !== 'Hierbabuena') continue;
      if (roleGroup(ing) === 'drink') {
        list.add(fromSpec(ing, drinkQty(ing)));
        if (isSpirit(ing)) spirit = true;
        if (isMixer(ing)) mixer = true;
      } else list.add(fromSpec(ing, secondaryQty(ing, roleGroup(ing))));
    }
    const hielo = kbByName('Hielo');
    if ((spirit || mixer) && hielo) list.ensure(fromSpec(hielo, [150, 'g', 'bruta']));
    if (!list.items.length) return minimalProposal(name);
    return {
      dishName: name.trim(),
      portions: 1,
      ingredients: list.items,
      allergens: allergensOf(list.items),
      source: 'heuristica',
      confidence: clampConfidence(0.4 + 0.05 * list.items.length),
    };
  }

  // ── Principal ──
  const mainPick =
    ingDets.find((d) => d.inName && isMainCandidate(roleGroup(d.target.ing)) && d.head) ??
    ingDets.find((d) => d.inName && isMainCandidate(roleGroup(d.target.ing))) ??
    (kind === 'postre'
      ? ingDets.find((d) => d.inName && ['veg', 'sweet', 'nut', 'cheese', 'dairy'].includes(roleGroup(d.target.ing)))
      : ingDets.find((d) => d.inName && d.head && ['veg', 'legume'].includes(roleGroup(d.target.ing)) && !(frame && frame.id === 'crema'))) ??
    ingDets.find((d) => isMainCandidate(roleGroup(d.target.ing)));
  const main = mainPick?.target.ing;
  const scale = frame?.mainScale ?? 1;
  const sideScale = frame?.sideScale ?? 1;

  if (main) {
    const g = roleGroup(main);
    const spec = kind === 'postre' && g !== 'cheese' ? secondaryQty(main, g) : mainQty(main, g);
    const f = kind === 'postre' ? Math.max(1, scale * 3) : scale;
    list.add(fromSpec(main, spec, f));
  } else if (frame?.defaultMain) {
    const dm = kbByName(frame.defaultMain);
    if (dm && !nameToks.some((t) => ['vegana', 'vegano', 'vegetal', 'vegetariana', 'vegetariano'].includes(t.raw))) list.add(fromSpec(dm, mainQty(dm, roleGroup(dm))));
  }

  // ── Resto de ingredientes y elaboraciones detectados ──
  for (const d of dets) {
    if (d.target.kind === 'prep') {
      const prep = d.target.prep;
      const f = prep.role === 'guarnicion' ? sideScale : 1;
      for (const it of prep.items) list.add(fromRecipeItem(it, f));
      if (prep.role !== 'base') sides.push(lower(prep.name.replace(/\s*\(.*?\)\s*/g, '')));
      continue;
    }
    const ing = d.target.ing;
    if (main && ing.name === main.name) continue;
    const g = roleGroup(ing);
    if (frame?.id === 'pasta' && PASTAS.has(ing.name)) {
      list.add(fromSpec(ing, [ing.name === 'Raviolis rellenos' || ing.name === 'Gnocchi' ? 180 : 110, 'g']));
      continue;
    }
    let f = 1;
    if (g === 'veg' || g === 'legume' || g === 'starch') f = sideScale;
    if (frame?.id === 'crema' && (g === 'veg' || g === 'legume') && !list.items.some((i) => roleGroup(kbByName(i.name) ?? ing) === 'veg')) f = 2;
    if ((g === 'protein' || g === 'cheese') && main) f = Math.min(1, scale * 1.5);
    list.add(fromSpec(ing, secondaryQty(ing, g), f));
    if (g === 'veg' || g === 'legume' || g === 'starch' || g === 'sauce') sides.push(lower(ing.name));
  }

  // ── Base del tipo de plato ──
  if (frame) {
    for (const t of frame.base) {
      const p = fromTuple(t);
      const grp = groupOf(p.name);
      const kb = kbByName(p.name);
      const exclusive = grp && kb && roleGroup(kb) !== 'cheese' && list.items.some((i) => grp.includes(i.name));
      if (!exclusive) list.ensure(p);
    }
  }

  // ── Caldo y vino según el principal ──
  const seafood = list.items.some((i) => {
    const kb = kbByName(i.name);
    return !!kb && roleGroup(kb) === 'protein' && kb.allergens.some((a) => a === 'pescado' || a === 'crustaceos' || a === 'moluscos');
  });
  const meat = !!main && (main.category === 'carne' || main.category === 'charcuteria');
  const rawAll = [...nameToks, ...descToks].map((t) => t.raw);
  const brothy = rawAll.includes('caldoso') || rawAll.includes('meloso');
  if (frame?.id === 'arroz') {
    const stock = seafood ? 'Fumet de pescado' : meat ? 'Caldo de pollo' : 'Caldo de verduras';
    if (!list.items.some((i) => ['Fumet de pescado', 'Caldo de pollo', 'Caldo de verduras', 'Fondo oscuro'].includes(i.name))) {
      list.add(toProposed(stock, brothy ? 450 : 350, 'ml', 'neta'));
    }
  }
  if (frame?.id === 'risotto' && (seafood || meat)) {
    const idxStock = list.items.findIndex((i) => i.name === 'Caldo de verduras');
    if (idxStock >= 0) list.items[idxStock] = toProposed(seafood ? 'Fumet de pescado' : 'Caldo de pollo', 350, 'ml', 'neta');
  }
  const stew = frame?.id === 'guiso' || methods.some((m) => m.id === 'guiso');
  if (stew) {
    if (seafood) {
      list.ensure(toProposed('Vino blanco', 40, 'ml', 'neta'));
      list.ensure(toProposed('Fumet de pescado', 150, 'ml', 'neta'));
    } else if (meat) {
      list.ensure(toProposed('Vino tinto joven', 50, 'ml', 'neta'));
      list.ensure(toProposed('Fondo oscuro', 120, 'ml', 'neta'));
    } else list.ensure(toProposed('Caldo de verduras', 150, 'ml', 'neta'));
    if (frame?.id !== 'guiso') {
      list.ensure(toProposed('Cebolla', 60, 'g', 'neta'));
      list.ensure(toProposed('Ajo', 3, 'g', 'neta'));
      list.ensure(toProposed('Tomate triturado', 30, 'g', 'neta'));
    }
  }

  // ── Método de cocción ──
  const fry = methods.find((m) => ['romana', 'tempura', 'empanado', 'frito'].includes(m.id));
  for (const m of methods) {
    if (['romana', 'tempura', 'empanado', 'frito'].includes(m.id) && m !== fry) continue;
    for (const t of m.add) list.add(fromTuple(t));
  }
  const coating = list.items.some((i) => {
    const kb = kbByName(i.name);
    return !!kb && roleGroup(kb) === 'coating' && ['Pan rallado', 'Panko', 'Harina de tempura', 'Harina para freír'].includes(kb.name);
  });
  if (coating && !fry) list.ensure(toProposed('Aceite de girasol', 40, 'ml', 'neta', { note: 'Fritura' }));

  // ── Básicos ──
  const detectedCount = new Set(dets.map((d) => (d.target.kind === 'ing' ? d.target.ing.name : d.target.prep.name))).size;
  if (!detectedCount && !frame) return minimalProposal(name);
  if (kind === 'salado') {
    if (!list.items.some((i) => i.name.startsWith('Aceite de oliva'))) list.add(toProposed('Aceite de oliva virgen extra', 10, 'ml', 'neta'));
    if (!list.items.some((i) => i.name === 'Sal' || i.name === 'Sal en escamas' || i.name === 'Sal gruesa')) list.add(toProposed('Sal', 1, 'g', 'neta'));
  }

  let confidence = 0.35 + Math.min(0.15, 0.05 * detectedCount);
  if (main) confidence += 0.05;
  if (frame) confidence += 0.05;

  const proposal: DishProposal = {
    dishName: name.trim(),
    portions: 1,
    ingredients: list.items,
    allergens: allergensOf(list.items),
    source: 'heuristica',
    confidence: clampConfidence(confidence),
  };
  const procedure = buildProcedure(main, list.items, frame, methods, sides);
  if (procedure) proposal.procedure = procedure;
  return proposal;
}

const FRAME_STEPS: Record<string, string> = {
  hamburguesa: 'Formar la hamburguesa sin apretar, marcar a la plancha muy caliente y montar en el pan tostado con los acompañamientos.',
  bocadillo: 'Abrir el pan, rellenar con el principal recién hecho y el resto de ingredientes.',
  sandwich: 'Montar el sándwich y tostar en plancha por ambos lados.',
  tosta: 'Tostar el pan y cubrir con el resto de ingredientes justo antes de servir.',
  wrap: 'Calentar la tortilla, rellenar con el principal y las verduras y enrollar.',
  pizza: 'Estirar la masa, cubrir con tomate, mozzarella y el resto de ingredientes y hornear a máxima temperatura.',
  ensalada: 'Lavar y trocear las hojas, montar con el resto de ingredientes y aliñar al servir.',
  risotto: 'Nacarar el arroz, mojar con el caldo caliente poco a poco (16–18 min) y mantecar con mantequilla y parmesano.',
  arroz: 'Sofreír el principal, añadir el sofrito y el arroz, mojar con el caldo caliente y cocer 18 min sin remover.',
  fideua: 'Tostar los fideos, añadir el sofrito y el fumet y cocer hasta que se levanten; servir con alioli.',
  pasta: 'Cocer la pasta al dente y saltear con la salsa y el resto de ingredientes.',
  crema: 'Pochar las verduras, mojar con el caldo, cocer 25 min y triturar con la nata.',
  crudo: 'Cortar el principal muy frío (el pescado crudo, previamente congelado) y aliñar al momento.',
  croquetas: 'Hacer una bechamel espesa con el relleno, enfriar, formar, empanar y freír a 180 °C.',
  revuelto: 'Cuajar los huevos a fuego suave con el resto de ingredientes, dejándolos jugosos.',
  guiso: 'Dorar el principal, añadir el sofrito, mojar con el vino y el caldo y guisar a fuego suave hasta que esté tierno.',
  brocheta: 'Ensartar el principal marinado y asar a la brasa o plancha.',
  tarta: 'Mezclar la masa con el ingrediente principal, hornear y enfriar antes de porcionar.',
  mousse: 'Mezclar la base con la nata semimontada y las claras montadas; enfriar 4 h.',
  helado: 'Servir en copa fría con el acompañamiento.',
  crepe: 'Preparar la masa, cuajar en sartén y rellenar o cubrir al servir.',
  postre: 'Elaborar la base y terminar con el acompañamiento al servir.',
};

function buildProcedure(
  main: KbIngredient | undefined,
  items: ProposedIngredient[],
  frame: DishFrame | undefined,
  methods: CookingMethod[],
  sides: string[],
): string | undefined {
  const steps: string[] = [];
  const mainItem = main ? items.find((i) => i.name === main.name) : undefined;
  if (main && mainItem && frame?.kind !== 'postre') {
    const qty = mainItem.basis === 'bruta' ? `${formatQty(mainItem)} en bruto` : `${formatQty(mainItem)} netos`;
    steps.push(`Limpiar y porcionar ${lower(main.name)} (${qty} por ración).`);
  }
  const method = methods.find((m) => !['brasa', 'plancha', 'horno', 'vapor'].includes(m.id)) ?? methods[0];
  if (frame && FRAME_STEPS[frame.id]) steps.push(FRAME_STEPS[frame.id]);
  if (method && (!frame || ['plato', 'brocheta', 'crudo'].includes(frame.id) || !FRAME_STEPS[frame.id])) steps.push(method.step);
  else if (method && frame && method.add.length) steps.push(method.step);
  const uniqSides = [...new Set(sides)].slice(0, 4);
  if (uniqSides.length) steps.push(`Emplatar con ${joinEs(uniqSides)}.`);
  if (!steps.length) return undefined;
  return steps
    .slice(0, 4)
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');
}

function joinEs(list: string[]): string {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
}

function clampConfidence(c: number): number {
  return Math.round(Math.min(0.6, Math.max(0.35, c)) * 100) / 100;
}

function minimalProposal(name: string): DishProposal {
  const ingredients = [toProposed('Aceite de oliva virgen extra', 10, 'ml', 'neta'), toProposed('Sal', 1, 'g', 'neta')];
  return { dishName: name.trim(), portions: 1, ingredients, allergens: [], source: 'heuristica', confidence: 0.1 };
}

// ───────────────────────────── API pública ─────────────────────────────

const PROPOSAL_CACHE = new Map<string, DishProposal>();

function cloneProposal(p: DishProposal): DishProposal {
  return { ...p, ingredients: p.ingredients.map((i) => ({ ...i })), allergens: p.allergens ? [...p.allergens] : undefined };
}

/**
 * Propuesta de escandallo sin IA: usa la receta tipo si el parecido es alto (source 'plantilla');
 * si no, detecta ingredientes mencionados en nombre y descripción ("con", "y", "de", "al", "sobre"…) y
 * asigna gramajes por categoría/rol (proteína principal ~180 g neto, guarnición ~100 g, salsa ~40 ml…) más
 * básicos (aceite, sal) → source 'heuristica'. Siempre devuelve algo (aunque sea con confidence baja).
 */
export function proposeDishLocal(name: string, description?: string): DishProposal {
  const key = `${name}\u0000${description ?? ''}`;
  const cached = PROPOSAL_CACHE.get(key);
  if (cached) return cloneProposal(cached);

  const nameToks = tokenizeDishText(name, true);
  const descToks = description ? tokenizeDishText(description, false, 100) : [];
  const { found, negated } = detectAll(nameToks, descToks);
  let proposal: DishProposal | undefined;
  const match = nameToks.length ? matchRecipe(name, description, { nameToks, descToks, dets: found }) : undefined;
  if (match && match.score >= KB_TEMPLATE_THRESHOLD && !(isVeggie(nameToks, descToks) && hasAnimalProtein(match.recipe))) {
    proposal = proposeFromTemplate(name, match, found, negated, portionFactor(rawWords(name), found));
  }
  if (!proposal) {
    proposal = nameToks.length || descToks.length ? proposeHeuristic(name, nameToks, descToks, found) : minimalProposal(name);
  }
  if (PROPOSAL_CACHE.size > 2000) PROPOSAL_CACHE.clear();
  PROPOSAL_CACHE.set(key, proposal);
  return cloneProposal(proposal);
}
