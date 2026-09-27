/**
 * Histórico de precios y unidad de compra.
 *
 * Si un ingrediente cambia de unidad (kg → ud, l → kg…) y el precio no se puede convertir, los precios anteriores se
 * conservan marcados con su unidad (`PricePoint.baseUnit`). Mezclarlos con los nuevos daría alertas y gráficos sin
 * sentido («▲ 300 %» al pasar de 12 €/kg a 3 €/ud), así que sólo se comparan los que están en la unidad actual.
 */
import type { BaseUnit, ID, PricePoint, Product } from '../types';

/** Unidad en la que está expresado un precio del histórico (si no consta, la del producto). */
export function pointUnit(point: Pick<PricePoint, 'baseUnit'>, productUnit: BaseUnit): BaseUnit {
  return point.baseUnit ?? productUnit;
}

/** true si el precio está en la unidad actual del producto (sin producto no se puede saber: se da por bueno). */
export function isInProductUnit(point: Pick<PricePoint, 'baseUnit'>, product: Pick<Product, 'baseUnit'> | undefined): boolean {
  return !point.baseUnit || !product || point.baseUnit === product.baseUnit;
}

/**
 * Precios comparables: los que están en la unidad actual de su producto. Devuelve el mismo array si no hay ninguno en
 * otra unidad (lo habitual), para no romper memoizaciones.
 */
export function comparablePricePoints<T extends Pick<PricePoint, 'productId' | 'baseUnit'>>(
  points: T[],
  products: Iterable<Pick<Product, 'id' | 'baseUnit'>> | Map<ID, Pick<Product, 'baseUnit'>>,
): T[] {
  if (!points.some((p) => p.baseUnit)) return points;
  const units = new Map<ID, BaseUnit>();
  if (products instanceof Map) for (const [id, p] of products) units.set(id, p.baseUnit);
  else for (const p of products) units.set(p.id, p.baseUnit);
  return points.filter((p) => !p.baseUnit || !units.has(p.productId) || units.get(p.productId) === p.baseUnit);
}
