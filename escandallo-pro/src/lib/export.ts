import type { Dish, DishCost, Product, Supplier, BusinessSettings, Workspace } from '../types';
import type { CostingContext } from '../core/costing';
import { todo } from './todo';

/** Descarga un Blob como archivo. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV con ; y coma decimal (abre bien en Excel ES). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  void rows;
  return todo('toCsv');
}

/**
 * Excel profesional con: hoja "Resumen" (todos los platos: sección, PVP, coste, FC %, margen, merma %, sugerido),
 * una hoja por plato (ficha técnica con líneas: ingrediente, bruto, neto, merma %, precio, coste, % coste) y hoja "Ingredientes".
 * Formatos €, %, cabeceras con color de marca, anchos ajustados, filtros.
 */
export async function exportEscandallosXlsx(args: {
  workspace: Workspace;
  dishes: Dish[];
  costs: Map<string, DishCost>;
  ctx: CostingContext;
  business: BusinessSettings;
}): Promise<Blob> {
  void args;
  return todo('exportEscandallosXlsx');
}

export async function exportProductsXlsx(products: Product[], suppliers: Supplier[]): Promise<Blob> {
  void products;
  void suppliers;
  return todo('exportProductsXlsx');
}
