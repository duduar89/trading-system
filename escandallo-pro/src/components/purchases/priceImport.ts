import type { BaseUnit, InvoiceLine, Product } from '../../types';
import { normalizeInvoiceLine } from '../../core/pack';
import { AUTO_LINK_THRESHOLD, SUGGEST_THRESHOLD, cleanProductName, rankMatches } from '../../core/matching';
import { priceConversionFactor } from '../../services/products';
import { foldText, type PriceRow } from './logic';

export interface ImportPlanRow {
  row: PriceRow;
  /** Nombre limpio para el ingrediente (si hay que crearlo). */
  name: string;
  baseUnit?: BaseUnit;
  pricePerBase?: number;
  warnings: string[];
  action: 'update' | 'create' | 'skip';
  /** Producto existente que se actualizará (o el más parecido, como pista, si se crea uno nuevo). */
  product?: Product;
  score?: number;
  /** Motivo si se omite. */
  reason?: string;
}

export interface ImportPlan {
  rows: ImportPlanRow[];
  updates: number;
  creates: number;
  skips: number;
}

/**
 * Plan de importación de una tarifa: normaliza cada fila a €/ud base y la empareja con la base de precios.
 *  - score ≥ AUTO_LINK → actualiza ese producto (y aprende la descripción como alias);
 *  - si no, crea un ingrediente nuevo (si `createMissing`), indicando el más parecido como pista;
 *  - filas sin precio calculable se omiten.
 * Si dos filas crean el mismo nombre, sólo se crea una vez (la segunda actualiza el precio).
 */
export function planPriceImport(rows: PriceRow[], products: Product[], createMissing: boolean): ImportPlan {
  const out: ImportPlanRow[] = [];
  const plannedNames = new Set<string>();
  for (const row of rows) {
    const line: Pick<InvoiceLine, 'description' | 'quantity' | 'unit' | 'unitPrice' | 'total' | 'discountPct'> = {
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      unitPrice: row.unitPrice,
      total: row.total,
      discountPct: row.discountPct,
    };
    let baseUnit: BaseUnit | undefined;
    let pricePerBase: number | undefined;
    let warnings: string[] = [];
    try {
      const n = normalizeInvoiceLine(line);
      baseUnit = n.baseUnit;
      pricePerBase = n.pricePerBase;
      warnings = n.warnings ?? [];
    } catch (e) {
      warnings = [e instanceof Error ? e.message : 'No se pudo calcular el precio'];
    }
    let name = row.description;
    try {
      name = cleanProductName(row.description) || row.description;
    } catch {
      name = row.description;
    }
    if (!(pricePerBase && pricePerBase > 0) || !baseUnit) {
      out.push({ row, name, baseUnit, pricePerBase, warnings, action: 'skip', reason: 'Sin precio calculable' });
      continue;
    }
    let best: { item: Product; score: number } | undefined;
    try {
      best = rankMatches(row.description, products, 1, SUGGEST_THRESHOLD)[0];
    } catch {
      best = undefined;
    }
    if (best && best.score >= AUTO_LINK_THRESHOLD) {
      const conv = priceConversionFactor(baseUnit, best.item.baseUnit, best.item);
      if (conv) {
        const converted = pricePerBase * conv.factor;
        const note = conv.factor !== 1 ? [`Convertido a €/${best.item.baseUnit}${conv.assumption ? ` (${conv.assumption})` : ''}`] : [];
        out.push({
          row,
          name,
          baseUnit: best.item.baseUnit,
          pricePerBase: converted,
          warnings: [...warnings, ...note],
          action: 'update',
          product: best.item,
          score: best.score,
        });
        continue;
      }
      warnings = [...warnings, `«${best.item.name}» tiene el precio en €/${best.item.baseUnit}; esta fila sale en €/${baseUnit} y no se puede convertir.`];
    }
    if (!createMissing) {
      out.push({
        row,
        name,
        baseUnit,
        pricePerBase,
        warnings,
        action: 'skip',
        product: best?.item,
        score: best?.score,
        reason: 'No está en tu base de precios',
      });
      continue;
    }
    const key = foldText(name);
    out.push({
      row,
      name,
      baseUnit,
      pricePerBase,
      warnings,
      action: 'create',
      product: best?.item,
      score: best?.score,
      reason: plannedNames.has(key) ? 'Repetido en la tarifa' : undefined,
    });
    plannedNames.add(key);
  }
  return {
    rows: out,
    updates: out.filter((r) => r.action === 'update').length,
    creates: new Set(out.filter((r) => r.action === 'create').map((r) => foldText(r.name))).size,
    skips: out.filter((r) => r.action === 'skip').length,
  };
}
