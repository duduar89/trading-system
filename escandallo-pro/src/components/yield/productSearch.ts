import type { Product } from '../../types';
import { rankMatches } from '../../core/matching';
import { YIELD_TEMPLATES, type YieldTemplate } from '../../services/yieldTests';

/**
 * Búsqueda de productos para las pruebas de rendimiento.
 * Usa el emparejamiento difuso de `core/matching` y lo combina con coincidencia literal (lo que el usuario teclea
 * debe aparecer siempre, aunque sea un prefijo como "salm"). Si el motor difuso fallara, se usa un comparador
 * local por palabras para que la búsqueda nunca deje de funcionar.
 */

const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'y', 'en', 'a', 'al', 'para', 'kg', 'ud', 'entero', 'entera']);

/** minúsculas, sin tildes ni signos, espacios colapsados. */
export function normalizeQuery(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

function words(s: string): string[] {
  return normalizeQuery(s)
    .split(' ')
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}

/** Similitud local 0–1 por palabras (prefijos incluidos) con peso extra a la primera palabra. */
function localSimilarity(query: string, name: string): number {
  const q = words(query);
  const n = words(name);
  if (!q.length || !n.length) return 0;
  let hits = 0;
  for (const w of q) if (n.some((x) => x === w || (w.length >= 3 && x.startsWith(w)) || (x.length >= 3 && w.startsWith(x)))) hits++;
  let score = hits / Math.max(q.length, Math.min(n.length, q.length + 1));
  if (n[0] === q[0] || n[0].startsWith(q[0]) || q[0].startsWith(n[0])) score = Math.min(1, score + 0.2);
  else score *= 0.75;
  return score;
}

function fuzzyRank<T extends { name: string; aliases?: string[] }>(query: string, items: T[], limit: number, minScore: number): { item: T; score: number }[] {
  try {
    return rankMatches(query, items, limit, minScore).map((m) => ({ item: m.item, score: m.score }));
  } catch {
    // Motor difuso no disponible: comparador local.
    return items
      .map((item) => ({ item, score: Math.max(localSimilarity(query, item.name), ...(item.aliases ?? []).map((a) => localSimilarity(query, a))) }))
      .filter((m) => m.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

/** Productos que encajan con lo tecleado: primero coincidencias literales, luego las difusas. */
export function searchProducts(query: string, products: Product[], limit = 8): Product[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const literal = products
    .filter((p) => normalizeQuery(p.name).includes(q) || p.aliases.some((a) => normalizeQuery(a).includes(q)))
    .sort((a, b) => {
      const an = normalizeQuery(a.name).startsWith(q) ? 0 : 1;
      const bn = normalizeQuery(b.name).startsWith(q) ? 0 : 1;
      return an - bn || a.name.localeCompare(b.name, 'es');
    });
  const seen = new Set(literal.map((p) => p.id));
  const fuzzy = fuzzyRank(query, products, limit, 0.45)
    .map((m) => m.item)
    .filter((p) => !seen.has(p.id));
  return [...literal, ...fuzzy].slice(0, limit);
}

/** Mejor producto para la pista de una plantilla (p. ej. "salmón"); undefined si ninguno se parece lo suficiente. */
export function bestProductForHint(hint: string, products: Product[], minScore = 0.55): Product | undefined {
  if (!hint.trim() || !products.length) return undefined;
  const q = normalizeQuery(hint);
  const literal = products.filter((p) => normalizeQuery(p.name).includes(q));
  if (literal.length) return literal.sort((a, b) => a.name.length - b.name.length)[0];
  return fuzzyRank(hint, products, 1, minScore)[0]?.item;
}

/** Productos sugeridos para una pista (varios, para mostrarlos antes de que el usuario teclee). */
export function suggestProductsForHint(hint: string, products: Product[], limit = 5): Product[] {
  if (!hint.trim()) return [];
  return searchProducts(hint, products, limit);
}

/** Plantilla que mejor encaja con el nombre de un producto (para proponerla al crear desde un ingrediente). */
export function bestTemplateForProduct(productName: string, minScore = 0.55): YieldTemplate | undefined {
  const q = normalizeQuery(productName);
  if (!q) return undefined;
  const items = YIELD_TEMPLATES.map((t) => ({ name: t.productHint, aliases: [t.name], tpl: t }));
  const literal = items.find((i) => q.includes(normalizeQuery(i.name)));
  if (literal) return literal.tpl;
  return fuzzyRank(productName, items, 1, minScore)[0]?.item.tpl;
}
