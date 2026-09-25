import type { ID, YieldTest } from '../types';
import { todo } from '../lib/todo';

/** Crea una prueba de rendimiento; si trae productId toma su precio vigente como purchasePricePerKg por defecto. */
export async function createYieldTest(data: Partial<YieldTest> & { name: string }): Promise<YieldTest> {
  void data;
  return todo('createYieldTest');
}

export async function updateYieldTest(id: ID, patch: Partial<YieldTest>): Promise<void> {
  void id;
  void patch;
  return todo('updateYieldTest');
}

/** Borra; desvincula de productos y líneas de receta que la usaran. */
export async function deleteYieldTest(id: ID): Promise<void> {
  void id;
  return todo('deleteYieldTest');
}

/** Vincula la prueba al producto (Product.yieldTestId) para que todos los escandallos usen su rendimiento real. */
export async function linkYieldTestToProduct(testId: ID, productId: ID | undefined): Promise<void> {
  void testId;
  void productId;
  return todo('linkYieldTestToProduct');
}

/** Plantillas de despiece habituales (salmón entero, solomillo, pulpo, merluza, cordero, pollo…) con salidas y % típicos. */
export interface YieldTemplate {
  name: string;
  productHint: string;
  cookingLossPct: number;
  portionKg: number;
  /** Salidas como fracción del peso bruto (0–1). */
  outputs: { name: string; kind: 'principal' | 'subproducto' | 'desperdicio'; fraction: number; valuePerKg?: number }[];
}
export const YIELD_TEMPLATES: YieldTemplate[] = [];
