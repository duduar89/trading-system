import type { ID, Product } from '../../types';
import { rankMatches } from '../../core/matching';
import { foldText, matchesQuery } from './logic';

export interface ProductHit {
  product: Product;
  /** 0–1 */
  score: number;
  /** Alias que dio la coincidencia (si no fue el nombre). */
  matchedOn?: string;
}

/** Coincidencias difusas (core/matching) de un texto de factura o receta con los productos. */
export function suggestProducts(seed: string, products: Product[], limit = 6, minScore = 0.35): ProductHit[] {
  const q = seed.trim();
  if (!q || !products.length) return [];
  try {
    return rankMatches(q, products, limit, minScore).map((m) => ({
      product: m.item,
      score: m.score,
      matchedOn: m.matchedOn && foldText(m.matchedOn) !== foldText(m.item.name) ? m.matchedOn : undefined,
    }));
  } catch {
    // El emparejamiento difuso no está disponible: sin sugerencias automáticas.
    return [];
  }
}

/**
 * Búsqueda mientras se escribe: combina el emparejamiento difuso (tolera erratas y abreviaturas de proveedor)
 * con la búsqueda literal por términos (nombre y alias), para que nunca falte un resultado evidente.
 */
export function searchProducts(query: string, products: Product[], limit = 20): ProductHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits = new Map<ID, ProductHit>();
  for (const h of suggestProducts(q, products, limit, 0.3)) hits.set(h.product.id, h);
  const fq = foldText(q);
  for (const p of products) {
    if (hits.has(p.id)) continue;
    const alias = p.aliases.find((a) => matchesQuery(q, a));
    if (matchesQuery(q, p.name) || alias) {
      const starts = foldText(p.name).startsWith(fq);
      hits.set(p.id, { product: p, score: starts ? 0.75 : 0.55, matchedOn: matchesQuery(q, p.name) ? undefined : alias });
    }
  }
  return [...hits.values()].sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'es')).slice(0, limit);
}
