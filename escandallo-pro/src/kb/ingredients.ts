import type { Allergen, BaseUnit, IngredientCategory } from '../types';
import { rankMatches } from '../core/matching';
import { KB_CARNES } from './data/ingredients-carnes';
import { KB_MAR } from './data/ingredients-mar';
import { KB_HUERTA } from './data/ingredients-huerta';
import {
  KB_ACEITES,
  KB_CEREALES,
  KB_CONDIMENTOS,
  KB_CONSERVAS,
  KB_DULCE,
  KB_FRUTOS_SECOS,
  KB_LACTEOS,
  KB_LEGUMBRES,
  KB_PANADERIA,
  KB_SALSAS,
} from './data/ingredients-despensa';
import { KB_BEBIDAS } from './data/ingredients-bebidas';
import { contentTokens, fuzzyTokenEq, phraseKey, type Token } from './text';

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

export const KB_INGREDIENTS: KbIngredient[] = [
  ...KB_CARNES,
  ...KB_MAR,
  ...KB_HUERTA,
  ...KB_LACTEOS,
  ...KB_CEREALES,
  ...KB_PANADERIA,
  ...KB_LEGUMBRES,
  ...KB_ACEITES,
  ...KB_CONDIMENTOS,
  ...KB_SALSAS,
  ...KB_CONSERVAS,
  ...KB_DULCE,
  ...KB_FRUTOS_SECOS,
  ...KB_BEBIDAS,
];

/** Índice de frases exactas de la base de ingredientes (se construye una vez, bajo demanda). */
export interface KbIngredientIndex {
  /** Clave de frase (tokens singulares sin palabras vacías) → ficha. Los nombres mandan sobre los alias. */
  byKey: Map<string, KbIngredient>;
  /** Nombre exacto de la ficha → ficha. */
  byName: Map<string, KbIngredient>;
  /** Número máximo de tokens de una clave (longitud máxima de n-grama a probar). */
  maxTokens: number;
  /** Claves de un solo token con 5+ letras, agrupadas por inicial (tolerancia a erratas). */
  singleByInitial: Map<string, { key: string; ingredient: KbIngredient }[]>;
  /** Todas las palabras (tokens) que aparecen en nombres y alias. */
  vocabulary: Set<string>;
}

let INDEX: KbIngredientIndex | undefined;

/** Índice perezoso de la base de ingredientes. */
export function kbIngredientIndex(): KbIngredientIndex {
  if (INDEX) return INDEX;
  const byKey = new Map<string, KbIngredient>();
  const byName = new Map<string, KbIngredient>();
  const vocabulary = new Set<string>();
  let maxTokens = 1;
  const add = (text: string, ingredient: KbIngredient) => {
    const toks = contentTokens(text).map((t) => t.t);
    if (!toks.length) return;
    toks.forEach((t) => vocabulary.add(t));
    const key = toks.join(' ');
    if (!byKey.has(key)) byKey.set(key, ingredient);
    if (toks.length > maxTokens) maxTokens = toks.length;
  };
  // Primero todos los nombres (prioridad), después los alias.
  for (const ing of KB_INGREDIENTS) {
    byName.set(ing.name, ing);
    add(ing.name, ing);
  }
  for (const ing of KB_INGREDIENTS) for (const a of ing.aliases) add(a, ing);

  const singleByInitial = new Map<string, { key: string; ingredient: KbIngredient }[]>();
  for (const [key, ingredient] of byKey) {
    if (key.includes(' ') || key.length < 5) continue;
    const bucket = singleByInitial.get(key[0]) ?? [];
    bucket.push({ key, ingredient });
    singleByInitial.set(key[0], bucket);
  }
  INDEX = { byKey, byName, maxTokens, singleByInitial, vocabulary };
  return INDEX;
}

/** Coincidencia de una frase de la base dentro de una secuencia de tokens. */
export interface PhraseHit<T> {
  item: T;
  /** Posición (índice en la lista de tokens) y número de tokens que cubre. */
  start: number;
  length: number;
  key: string;
}

/**
 * Recorre `tokens` buscando las frases más largas presentes en `lookup` (emparejamiento voraz de izquierda a derecha).
 * `skip(i)` permite excluir posiciones (p. ej. lo negado con "sin"); `breakBefore(i)` impide que una frase de varias
 * palabras incluya el token `i` sin empezar en él (p. ej. tras "con" o "y").
 */
export function scanPhrases<T>(
  tokens: Token[],
  lookup: Map<string, T>,
  maxLen: number,
  skip?: (i: number) => boolean,
  breakBefore?: (i: number) => boolean,
): PhraseHit<T>[] {
  const hits: PhraseHit<T>[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (skip?.(i)) {
      i++;
      continue;
    }
    let found = false;
    for (let len = Math.min(maxLen, tokens.length - i); len >= 1; len--) {
      // Sólo n-gramas de palabras contiguas en el texto original (no saltar comas ni frases).
      if (len > 1 && tokens[i + len - 1].pos - tokens[i].pos > len * 3) continue;
      if (len > 1 && breakBefore) {
        let crosses = false;
        for (let k = i + 1; k < i + len && !crosses; k++) crosses = breakBefore(k);
        if (crosses) continue;
      }
      const key = tokens
        .slice(i, i + len)
        .map((t) => t.t)
        .join(' ');
      const item = lookup.get(key);
      if (item !== undefined) {
        hits.push({ item, start: i, length: len, key });
        i += len;
        found = true;
        break;
      }
    }
    if (!found) i++;
  }
  return hits;
}

export interface KbIngredientMatch {
  ingredient: KbIngredient;
  /** 0–1 */
  score: number;
  /** Nombre o alias que produjo la coincidencia. */
  matchedOn: string;
  /** Cómo se obtuvo: nombre/alias exacto, frase de la base contenida en el texto o similitud difusa (erratas, abreviaturas). */
  kind: 'exacta' | 'frase' | 'difusa';
  /**
   * Palabras del texto que contradicen la ficha y han rebajado la puntuación: otro producto ("coco" en "Aceite de coco"),
   * un alérgeno que la ficha no declara ("cacahuete" en "Mantequilla de cacahuete") o el producto real del que la ficha es
   * sólo el sabor ("crema" en "Crema de cacahuete").
   */
  conflicts?: string[];
}

const CACHE_LIMIT = 5000;
const MATCH_CACHE = new Map<string, KbIngredientMatch | null>();

/** Umbral mínimo para aceptar una ficha (contrato de findKbIngredient). */
export const KB_MIN_SCORE = 0.6;

/** Factor por cada palabra que contradice la ficha (como mucho se aplican dos). */
const CONFLICT_FACTOR = 0.6;
/** Factor por cada palabra de la ficha que no está en el texto (sólo en similitud difusa; como mucho dos). */
const EXTRA_TOKEN_FACTOR = 0.9;

/**
 * Sustantivos que, delante de otro producto, nombran un producto distinto: "Crema de cacahuete" no es cacahuete,
 * "Caldo de marisco" no es marisco, "Zumo de manzana" no es manzana.
 */
const CONTAINER_HEADS = new Set([
  'caldo', 'fondo', 'salsa', 'crema', 'pure', 'zumo', 'sopa', 'licor', 'sirope', 'jarabe', 'mermelada', 'confitura', 'compota', 'helado', 'aceite',
  'harina', 'pan', 'pasta', 'leche', 'bebida', 'polvo', 'esencia', 'aroma', 'extracto', 'concentrado', 'pate', 'mousse', 'tarta', 'galleta', 'bizcocho',
  'yogur', 'mantequilla', 'vinagre', 'gelatina', 'caramelo', 'hamburguesa', 'croqueta', 'empanadilla', 'relleno', 'praline', 'turron', 'chocolate',
  'cerveza', 'vino', 'refresco', 'infusion', 'snack', 'chip', 'alino', 'marinada', 'sazonador', 'preparado', 'base',
]);

/**
 * Categorías compatibles como calificativo: la especie de un embutido ("chorizo de cerdo"), el sabor de un yogur o un helado
 * ("yogur de fresa"), el pescado de una conserva… Dos cereales distintos nunca lo son ("harina de arroz" ≠ harina de trigo).
 */
const RELATED_CATEGORIES = new Set(
  [
    ['carne', 'charcuteria'],
    ['pescado', 'marisco'],
    ['pescado', 'conserva'],
    ['pescado', 'congelado'],
    ['marisco', 'conserva'],
    ['marisco', 'congelado'],
    ['verdura', 'conserva'],
    ['verdura', 'congelado'],
    ['verdura', 'fruta'],
    ['fruta', 'conserva'],
    ['fruta', 'congelado'],
    ['fruta', 'lacteo'],
    ['fruta', 'bebida'],
    ['fruta', 'dulce'],
    ['legumbre', 'conserva'],
    ['legumbre', 'congelado'],
    ['dulce', 'panaderia'],
    ['lacteo', 'dulce'],
  ].flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]),
);

function relatedCategories(a: IngredientCategory, b: IngredientCategory): boolean {
  if (a === b) return a !== 'cereal';
  return RELATED_CATEGORIES.has(`${a}|${b}`);
}

/** ¿Cubre la palabra `m` de la ficha a la palabra `q` del texto? (igual, errata tolerada o abreviatura de proveedor) */
function covers(m: string, q: string, vocabulary: Set<string>): boolean {
  if (fuzzyTokenEq(m, q)) return true;
  // Abreviaturas ("tom" → tomate, "aceit" → aceite): sólo si la palabra del texto no es ya una palabra conocida ("leche" ≠ "lechera")
  return q.length >= 3 && m.length > q.length && m.startsWith(q) && !vocabulary.has(q);
}

interface PenaltyResult {
  factor: number;
  conflicts: string[];
}

/**
 * Penalizaciones de una coincidencia parcial o difusa.
 * @param toks tokens de contenido del texto (sin formatos)
 * @param matched tokens del nombre/alias de la ficha que coincidió
 * @param kind 'frase' (la frase está contenida en el texto, en `hitStart`) o 'difusa'
 */
function penalties(toks: Token[], matched: string[], ingredient: KbIngredient, kind: 'frase' | 'difusa', idx: KbIngredientIndex, hitStart = 0): PenaltyResult {
  const covered = toks.map((t) => matched.some((m) => covers(m, t.t, idx.vocabulary)));
  const firstCovered = covered.indexOf(true);
  const conflicts: string[] = [];
  toks.forEach((tk, i) => {
    if (covered[i]) return;
    const before = kind === 'frase' ? i < hitStart : firstCovered < 0 || i < firstCovered;
    if (before && CONTAINER_HEADS.has(tk.t)) {
      conflicts.push(tk.raw);
      return;
    }
    const other = idx.byKey.get(tk.t);
    if (!other || other === ingredient) return;
    // Un alérgeno mencionado que la ficha no declara nunca se pasa por alto
    if (other.allergens.some((a) => !ingredient.allergens.includes(a))) {
      conflicts.push(tk.raw);
      return;
    }
    // Otro producto de una categoría incompatible junto a un nombre genérico ("aceite" + "coco", "pasta" + "curry")
    const generic = kind === 'difusa' || matched.length === 1;
    if (generic && !relatedCategories(other.category, ingredient.category)) conflicts.push(tk.raw);
  });
  let factor = CONFLICT_FACTOR ** Math.min(2, conflicts.length);
  if (kind === 'difusa') {
    const extra = matched.filter((m) => !toks.some((t) => covers(m, t.t, idx.vocabulary))).length;
    factor *= EXTRA_TOKEN_FACTOR ** Math.min(2, extra);
  }
  return { factor, conflicts };
}

function withPenalties(base: Omit<KbIngredientMatch, 'conflicts'>, p: PenaltyResult): KbIngredientMatch {
  const m: KbIngredientMatch = { ...base, score: Math.round(base.score * p.factor * 1000) / 1000 };
  if (p.conflicts.length) m.conflicts = p.conflicts;
  return m;
}

/**
 * Como findKbIngredient pero devuelve también la puntuación, el texto que coincidió y cómo.
 * Orden: nombre exacto (1) → frase exacta de nombre o alias (1) → frase exacta sin formatos de envase (0,97) →
 * frase de la base contenida en el texto (0,6–0,95 según cobertura y posición) → similitud difusa de core/matching
 * (erratas, abreviaturas). Las coincidencias parciales y difusas se penalizan si el texto contradice la ficha
 * ("Aceite de coco" no es aceite de oliva; "Mantequilla de cacahuete" no es mantequilla), y por debajo de 0,6 no hay ficha.
 */
export function matchKbIngredient(name: string): KbIngredientMatch | undefined {
  const cacheKey = name.trim().toLowerCase();
  if (!cacheKey) return undefined;
  const cached = MATCH_CACHE.get(cacheKey);
  if (cached !== undefined) return cached ?? undefined;
  const result = computeMatch(name);
  if (MATCH_CACHE.size >= CACHE_LIMIT) MATCH_CACHE.clear();
  MATCH_CACHE.set(cacheKey, result ?? null);
  return result;
}

function computeMatch(name: string): KbIngredientMatch | undefined {
  const idx = kbIngredientIndex();
  const direct = idx.byName.get(name.trim());
  if (direct) return { ingredient: direct, score: 1, matchedOn: direct.name, kind: 'exacta' };

  const key = phraseKey(name);
  if (!key) return undefined;
  const exact = idx.byKey.get(key);
  if (exact) return { ingredient: exact, score: 1, matchedOn: key, kind: 'exacta' };

  const toks = contentTokens(name, { dropFormats: true });
  const key2 = toks.map((t) => t.t).join(' ');
  const exact2 = key2 ? idx.byKey.get(key2) : undefined;
  if (exact2) return { ingredient: exact2, score: 0.97, matchedOn: key2, kind: 'exacta' };

  let best: KbIngredientMatch | undefined;
  const consider = (m: KbIngredientMatch) => {
    if (!best || m.score > best.score + 1e-9) best = m;
  };
  if (toks.length) {
    for (const h of scanPhrases(toks, idx.byKey, idx.maxTokens)) {
      const coverage = h.length / toks.length;
      const raw = h.start === 0 ? 0.72 + 0.23 * coverage : 0.6 + 0.25 * coverage;
      const matched = h.key.split(' ');
      consider(withPenalties({ ingredient: h.item, score: Math.min(0.95, raw), matchedOn: h.key, kind: 'frase' }, penalties(toks, matched, h.item, 'frase', idx, h.start)));
    }
  }

  for (const f of rankMatches(name, KB_INGREDIENTS, 3, KB_MIN_SCORE)) {
    const matched = contentTokens(f.matchedOn, { dropFormats: true }).map((t) => t.t);
    const p = toks.length && matched.length ? penalties(toks, matched, f.item, 'difusa', idx) : { factor: 1, conflicts: [] };
    consider(withPenalties({ ingredient: f.item, score: f.score, matchedOn: f.matchedOn, kind: 'difusa' }, p));
  }
  return best && best.score >= KB_MIN_SCORE ? best : undefined;
}

/** Busca la ficha que mejor encaja con un nombre (usa core/matching). undefined si score < 0.6. */
export function findKbIngredient(name: string): KbIngredient | undefined {
  return matchKbIngredient(name)?.ingredient;
}
