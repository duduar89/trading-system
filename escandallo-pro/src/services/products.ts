import type { ID, PricePoint, Product, Supplier } from '../types';
import { todo } from '../lib/todo';

/**
 * Operaciones sobre productos (ingredientes de compra), proveedores e histórico de precios.
 * Todas trabajan sobre la BD del espacio activo (db()).
 */

/**
 * Crea un producto. Completa lo que falte con la base de conocimiento (kb/findKbIngredient): categoría, unidad base,
 * mermas por defecto, peso por unidad, densidad y alérgenos. Calcula searchKey. Si trae pricePerBase > 0 registra
 * también el primer PricePoint.
 */
export async function createProduct(data: Partial<Product> & { name: string }): Promise<Product> {
  void data;
  return todo('createProduct');
}

/** Actualiza campos (recalcula searchKey si cambia el nombre; updatedAt siempre). */
export async function updateProduct(id: ID, patch: Partial<Product>): Promise<void> {
  void id;
  void patch;
  return todo('updateProduct');
}

/**
 * Registra un nuevo precio. Añade PricePoint y, si la fecha es ≥ lastPurchaseDate (o no hay), actualiza
 * pricePerBase, priceSource, lastPurchaseDate y supplierId del producto.
 */
export async function setProductPrice(
  id: ID,
  pricePerBase: number,
  source: PricePoint['source'],
  opts?: { date?: string; supplierId?: ID; invoiceId?: ID; rawDescription?: string },
): Promise<void> {
  void id;
  void pricePerBase;
  void source;
  void opts;
  return todo('setProductPrice');
}

/** Borra el producto y su histórico; las líneas de receta que lo usaban quedan sin vincular (conservan el nombre). */
export async function deleteProduct(id: ID): Promise<void> {
  void id;
  return todo('deleteProduct');
}

/** Fusiona duplicados: mueve histórico, alias y vínculos de recetas/facturas de `removeId` a `keepId`, y borra `removeId`. */
export async function mergeProducts(keepId: ID, removeId: ID): Promise<void> {
  void keepId;
  void removeId;
  return todo('mergeProducts');
}

/** Añade un alias aprendido (sin duplicados, ignorando mayúsculas/tildes). */
export async function addProductAlias(id: ID, alias: string): Promise<void> {
  void id;
  void alias;
  return todo('addProductAlias');
}

/** Busca proveedor por CIF o por nombre normalizado; si no existe lo crea. */
export async function findOrCreateSupplier(name: string, taxId?: string): Promise<Supplier> {
  void name;
  void taxId;
  return todo('findOrCreateSupplier');
}
