import type { Product, YieldOutput, YieldOutputKind, YieldResult, YieldTest } from '../../types';
import { computeYield } from '../../core/yield';

/**
 * Lógica de presentación de las pruebas de rendimiento (sin React): precios efectivos, tramos de la pieza,
 * cascada bruto → ración y atajos de salidas.
 */

/**
 * Precio €/kg con el que los escandallos calculan la prueba: el vigente del producto si se compra por kg
 * (igual que `core/costing`), si no el guardado en la prueba.
 */
export function effectivePurchasePrice(test: Pick<YieldTest, 'purchasePricePerKg'>, product: Product | undefined): number {
  if (product && product.baseUnit === 'kg' && product.pricePerBase > 0) return product.pricePerBase;
  return test.purchasePricePerKg;
}

/** Resultado de la prueba con el precio vigente (el que ven los escandallos). */
export function computeWithCurrentPrice(test: YieldTest, product: Product | undefined): YieldResult {
  return computeYield({ ...test, purchasePricePerKg: effectivePurchasePrice(test, product) });
}

/** Peso que queda por asignar tras descongelar (kg; negativo si las salidas pesan más que la pieza). */
export function remainingKg(test: Pick<YieldTest, 'grossWeightKg' | 'thawLossPct' | 'outputs'>): number {
  const g = Math.max(0, test.grossWeightKg || 0);
  const thaw = Math.min(99.9, Math.max(0, test.thawLossPct ?? 0));
  const used = test.outputs.reduce((s, o) => s + Math.max(0, o.weightKg || 0), 0);
  return g * (1 - thaw / 100) - used;
}

export type SegmentKey = 'principal' | 'subproducto' | 'desperdicio' | 'noRegistrado' | 'descongelacion';

export interface PieceSegment {
  key: SegmentKey;
  label: string;
  hint: string;
  kg: number;
  /** Fracción del total de la barra (0–1). */
  share: number;
  /** Salidas que forman el tramo (para el detalle). */
  outputs: YieldOutput[];
}

export const SEGMENT_META: Record<SegmentKey, { label: string; hint: string }> = {
  principal: { label: 'Parte aprovechable', hint: 'Lo que va al plato' },
  subproducto: { label: 'Subproductos', hint: 'Se aprovechan en otras elaboraciones (fondos, croquetas…)' },
  desperdicio: { label: 'Desperdicio', hint: 'Se tira' },
  noRegistrado: { label: 'No registrado', hint: 'Goteo, evaporación o diferencia de báscula' },
  descongelacion: { label: 'Descongelación', hint: 'Agua que suelta al descongelar' },
};

/** Tramos de la barra 100 % de la pieza (en el orden en que se dibujan). */
export function pieceSegments(test: Pick<YieldTest, 'grossWeightKg' | 'thawLossPct' | 'outputs'>, result: YieldResult): PieceSegment[] {
  const thawKg = result.grossWeightKg * (Math.min(99.9, Math.max(0, test.thawLossPct ?? 0)) / 100);
  const byKind = (k: YieldOutputKind) => test.outputs.filter((o) => o.kind === k && o.weightKg > 0);
  const raw: Omit<PieceSegment, 'share'>[] = [
    { key: 'principal', ...SEGMENT_META.principal, kg: result.principalKg, outputs: byKind('principal') },
    { key: 'subproducto', ...SEGMENT_META.subproducto, kg: result.byproductKg, outputs: byKind('subproducto') },
    { key: 'desperdicio', ...SEGMENT_META.desperdicio, kg: result.wasteKg, outputs: byKind('desperdicio') },
    { key: 'noRegistrado', ...SEGMENT_META.noRegistrado, kg: result.unaccountedKg, outputs: [] },
    { key: 'descongelacion', ...SEGMENT_META.descongelacion, kg: thawKg, outputs: [] },
  ];
  const total = Math.max(result.grossWeightKg, raw.reduce((s, r) => s + r.kg, 0));
  return raw.map((r) => ({ ...r, share: total > 0 ? r.kg / total : 0 }));
}

export type CascadeKind = 'total' | 'loss' | 'aside' | 'final';

export interface CascadeStep {
  key: string;
  label: string;
  hint?: string;
  kind: CascadeKind;
  /** Tramo del paso en kg: de `from` a `to` (from ≤ to). */
  from: number;
  to: number;
  /** Peso del paso (kg, positivo). */
  kg: number;
  tone: SegmentKey | 'bruto' | 'coccion' | 'sobrante';
}

/** Cascada bruto → limpio → cocinado → raciones (en kg, sobre el peso bruto). */
export function cascadeSteps(test: Pick<YieldTest, 'thawLossPct' | 'portionKg' | 'cookingLossPct'>, result: YieldResult): CascadeStep[] {
  const G = result.grossWeightKg;
  if (!(G > 0)) return [];
  const steps: CascadeStep[] = [{ key: 'bruto', label: 'Pieza bruta', hint: 'Tal cual la compras', kind: 'total', from: 0, to: G, kg: G, tone: 'bruto' }];
  let level = G;
  const thawKg = G * (Math.min(99.9, Math.max(0, test.thawLossPct ?? 0)) / 100);
  const minus = (key: string, label: string, kg: number, kind: CascadeKind, tone: CascadeStep['tone'], hint?: string) => {
    if (!(kg > 1e-6)) return;
    const from = Math.max(0, level - kg);
    steps.push({ key, label, hint, kind, from, to: level, kg, tone });
    level = from;
  };
  minus('descongelacion', 'Descongelación', thawKg, 'loss', 'descongelacion', 'Agua al descongelar');
  minus('desperdicio', 'Desperdicio', result.wasteKg, 'loss', 'desperdicio', 'Se tira');
  minus('noRegistrado', 'No registrado', result.unaccountedKg, 'loss', 'noRegistrado', 'Goteo o báscula');
  minus('subproducto', 'Subproductos', result.byproductKg, 'aside', 'subproducto', 'Se aprovechan aparte');
  // Si las salidas pesan más que la pieza, el nivel no cuadra: forzamos la parte limpia real.
  const P = result.principalKg;
  steps.push({ key: 'limpio', label: 'Limpio en crudo', hint: 'Parte aprovechable', kind: 'total', from: 0, to: P, kg: P, tone: 'principal' });
  level = P;
  if (P > 0) {
    const cookPct = Math.round(Math.min(99.9, Math.max(0, test.cookingLossPct || 0)) * 10) / 10;
    minus('coccion', 'Cocción', P - result.cookedKg, 'loss', 'coccion', `Pierde el ${String(cookPct).replace('.', ',')} % al cocinar`);
    if (result.cookedKg < P - 1e-6) {
      steps.push({ key: 'cocinado', label: 'Cocinado', hint: 'Peso de servicio', kind: 'total', from: 0, to: result.cookedKg, kg: result.cookedKg, tone: 'principal' });
    }
    const r = test.portionKg;
    if (r && r > 0 && result.portions != null) {
      const served = result.portions * r;
      const leftover = result.cookedKg - served;
      level = result.cookedKg;
      minus('sobrante', 'Sobrante', leftover, 'aside', 'sobrante', 'No llega a ración completa');
      steps.push({
        key: 'raciones',
        label: `${result.portions} ${result.portions === 1 ? 'ración' : 'raciones'}`,
        hint: 'Servido en plato',
        kind: 'final',
        from: 0,
        to: served,
        kg: served,
        tone: 'principal',
      });
    }
  }
  return steps;
}

/** Atajos para añadir salidas habituales. */
export const QUICK_OUTPUTS: { label: string; name: string; kind: YieldOutputKind; valuePerKg?: number }[] = [
  { label: 'Lomos / parte limpia', name: 'Parte limpia', kind: 'principal' },
  { label: 'Recortes', name: 'Recortes', kind: 'subproducto' },
  { label: 'Espinas / huesos', name: 'Espinas y huesos (fondo)', kind: 'subproducto', valuePerKg: 1 },
  { label: 'Piel', name: 'Piel', kind: 'desperdicio' },
  { label: 'Grasa', name: 'Grasa', kind: 'desperdicio' },
];

/** Mermas de cocción orientativas (%). */
export const COOKING_PRESETS: { label: string; pct: number }[] = [
  { label: 'En crudo', pct: 0 },
  { label: 'Plancha', pct: 15 },
  { label: 'Horno', pct: 22 },
  { label: 'Fritura', pct: 30 },
  { label: 'Guiso', pct: 35 },
  { label: 'Cocción larga', pct: 45 },
];

/** Nombre para las salidas sin identificar que se asignan como desperdicio. */
export const UNASSIGNED_OUTPUT_NAME = 'Merma sin identificar';
