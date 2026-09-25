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
import { contentTokens, phraseKey, type Token } from './text';

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
 * `skip(i)` permite excluir posiciones (p. ej. lo negado con "sin").
 */
export function scanPhrases<T>(tokens: Token[], lookup: Map<string, T>, maxLen: number, skip?: (i: number) => boolean): PhraseHit<T>[] {
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
}

const CACHE_LIMIT = 5000;
const MATCH_CACHE = new Map<string, KbIngredientMatch | null>();

/** Umbral mínimo para aceptar una ficha (contrato de findKbIngredient). */
export const KB_MIN_SCORE = 0.6;

/**
 * Como findKbIngredient pero devuelve también la puntuación y el texto que coincidió.
 * Orden: frase exacta (1) → frase exacta sin formatos de envase (0,97) → frase de la base contenida en el nombre
 * (0,6–0,95 según cobertura y posición) → similitud difusa de core/matching (erratas, abreviaturas).
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
  if (direct) return { ingredient: direct, score: 1, matchedOn: direct.name };

  const key = phraseKey(name);
  if (!key) return undefined;
  const exact = idx.byKey.get(key);
  if (exact) return { ingredient: exact, score: 1, matchedOn: key };

  const toks = contentTokens(name, { dropFormats: true });
  const key2 = toks.map((t) => t.t).join(' ');
  const exact2 = key2 ? idx.byKey.get(key2) : undefined;
  if (exact2) return { ingredient: exact2, score: 0.97, matchedOn: key2 };

  let best: KbIngredientMatch | undefined;
  if (toks.length) {
    const hits = scanPhrases(toks, idx.byKey, idx.maxTokens);
    for (const h of hits) {
      const coverage = h.length / toks.length;
      const score = h.start === 0 ? 0.72 + 0.23 * coverage : 0.6 + 0.25 * coverage;
      const better = !best || score > best.score + 1e-9;
      if (better) best = { ingredient: h.item, score: Math.min(0.95, score), matchedOn: h.key };
    }
  }

  const fuzzy = rankMatches(name, KB_INGREDIENTS, 1, KB_MIN_SCORE)[0];
  if (fuzzy && (!best || fuzzy.score > best.score)) best = { ingredient: fuzzy.item, score: fuzzy.score, matchedOn: fuzzy.matchedOn };
  return best && best.score >= KB_MIN_SCORE ? best : undefined;
}

/** Busca la ficha que mejor encaja con un nombre (usa core/matching). undefined si score < 0.6. */
export function findKbIngredient(name: string): KbIngredient | undefined {
  return matchKbIngredient(name)?.ingredient;
}
