import type { Allergen, BaseUnit, DishKind, ExtractionMethod, IngredientCategory, PackSize, QtyBasis, QtyUnit, YieldOutputKind } from '../types';

/**
 * Tipos de las fichas de datos de la demo. Los datos se escriben con claves legibles (p. ej. 'aove')
 * y `services/demo.ts` los convierte en registros reales con ids únicos, fechas relativas a hoy
 * e importes calculados (nunca se escriben a mano importes derivados).
 */

export type SupplierKey = 'garcia' | 'guadarrama' | 'cantabrico' | 'centro' | 'sierra';

export interface DemoSupplier {
  key: SupplierKey;
  name: string;
  taxId: string;
  notes: string;
}

export interface DemoProduct {
  key: string;
  name: string;
  category: IngredientCategory;
  baseUnit: BaseUnit;
  wastePct: number;
  cookingLossPct: number;
  unitWeightKg?: number;
  densityKgPerL?: number;
  allergens: Allergen[];
  supplier: SupplierKey;
  /** IVA de compra (%): 4 superreducido, 10 reducido, 21 general. */
  vatPct: 4 | 10 | 21;
  /** Otros nombres con los que se conoce (además de las descripciones de factura, que se añaden solas). */
  aliases?: string[];
  notes?: string;
}

/**
 * Línea de factura: [clave de producto, descripción del proveedor, código, cantidad, unidad de facturación,
 * precio unitario sin IVA, formato de envase (opcional), descuento % (opcional)].
 */
export type DemoInvoiceLine = [
  product: string,
  description: string,
  code: string,
  quantity: number,
  unit: string,
  unitPrice: number,
  pack?: PackSize,
  discountPct?: number,
];

export interface DemoInvoice {
  supplier: SupplierKey;
  /** Número de factura a partir del año de su fecha. */
  number: (year: number) => string;
  daysAgo: number;
  method: ExtractionMethod;
  /** Confianza media de la lectura (0–1). */
  confidence: number;
  lines: DemoInvoiceLine[];
}

/** Referencia de una línea de receta: 'p:clave' (producto) o 'd:clave' (elaboración). */
export type DemoRef = `p:${string}` | `d:${string}`;

export interface DemoRecipeItem {
  name: string;
  ref: DemoRef;
  quantity: number;
  unit: QtyUnit;
  basis: QtyBasis;
  wastePct?: number;
  cookingLossPct?: number;
  note?: string;
  /** Sólo en borradores: puntuación del emparejamiento propuesto. */
  matchScore?: number;
}

export interface DemoDish {
  key: string;
  name: string;
  kind: DishKind;
  section: string;
  description?: string;
  menuPrice?: number;
  portions: number;
  yieldQty?: number;
  yieldUnit?: BaseUnit;
  unitsSold?: number;
  status: 'borrador' | 'revisado';
  tags?: string[];
  notes?: string;
  procedure?: string;
  /** Días desde el alta del plato (para createdAt/updatedAt). */
  createdDaysAgo: number;
  items: DemoRecipeItem[];
}

export interface DemoYieldTest {
  key: string;
  name: string;
  product: string;
  daysAgo: number;
  grossWeightKg: number;
  thawLossPct?: number;
  cookingLossPct: number;
  portionKg: number;
  outputs: { name: string; weightKg: number; kind: YieldOutputKind; valuePerKg?: number }[];
  notes?: string;
}
