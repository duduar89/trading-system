import type { BaseUnit, ID, Invoice, PricePoint, Product, Supplier } from '../types';
import type { KbIngredient } from '../kb/ingredients';
import { db, type WorkspaceDB } from '../db';
import { normalizeText, toSearchKey } from '../core/matching';
import { convertToBase } from '../core/units';
import { nowIso, todayIso, uid } from '../lib/id';

/**
 * Operaciones sobre productos (ingredientes de compra), proveedores e histórico de precios.
 * Todas trabajan sobre la BD del espacio activo (db()).
 *
 * Las variantes internas `…In(wdb, …)` sólo hacen operaciones de Dexie (sin esperas ajenas a la BD), de modo que
 * pueden ejecutarse dentro de una transacción de otro servicio (p. ej. confirmar una factura de forma atómica).
 */

// ───────────────────────────── Base de conocimiento (carga diferida) ─────────────────────────────

/** Búsqueda síncrona de una ficha de la base de conocimiento (nunca lanza). */
export type KbFinder = (name: string) => KbIngredient | undefined;

let kbFinderPromise: Promise<KbFinder> | undefined;

/**
 * Carga (una vez) la base de ingredientes con import dinámico y devuelve una búsqueda segura: si la base aún no está
 * disponible o falla, devuelve undefined y el producto se crea con valores neutros. Si la carga falla (p. ej. sin
 * conexión antes de que el service worker la tenga en caché) no se memoriza el fallo: se reintenta en la siguiente llamada.
 */
export function loadKbFinder(): Promise<KbFinder> {
  kbFinderPromise ??= import('../kb/ingredients')
    .then((mod): KbFinder => (name) => {
      try {
        return name.trim() ? mod.findKbIngredient(name) : undefined;
      } catch {
        return undefined;
      }
    })
    .catch((): KbFinder => {
      kbFinderPromise = undefined;
      return () => undefined;
    });
  return kbFinderPromise;
}

// ───────────────────────────── Utilidades ─────────────────────────────

/** Clave para comparar alias y nombres: sin tildes, mayúsculas, signos ni espacios. */
export function aliasKey(s: string): string {
  return normalizeText(s).replace(/ /g, '');
}

/** Máximo de alias guardados por producto (se descartan los más antiguos). */
const MAX_ALIASES = 60;

/** Alias limpios y sin duplicados (ignorando mayúsculas, tildes y signos); excluye el propio nombre. */
export function dedupeAliases(aliases: readonly (string | undefined | null)[], name: string): string[] {
  const nameKey = aliasKey(name);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of aliases) {
    const a = (raw ?? '').replace(/\s+/g, ' ').trim();
    const k = aliasKey(a);
    if (!k || k === nameKey || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out.length > MAX_ALIASES ? out.slice(out.length - MAX_ALIASES) : out;
}

let lastPointId = '';

/** Suma 1 al último carácter base 36 de un id (con acarreo), conservando su longitud. */
function bumpId(id: string): string {
  const chars = id.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    const v = parseInt(chars[i], 36);
    if (v < 35) {
      chars[i] = (v + 1).toString(36);
      return chars.join('');
    }
    chars[i] = '0';
  }
  return `${id}0`;
}

/**
 * Id de PricePoint estrictamente creciente en esta sesión. Los ids son ordenables por tiempo al milisegundo; así, dos
 * precios del mismo día registrados en el mismo milisegundo (p. ej. dos líneas del mismo producto en una factura) se
 * ordenan por orden de registro y el precio vigente es siempre el de la última línea, no uno al azar.
 */
export function nextPricePointId(): string {
  const id = uid();
  lastPointId = id > lastPointId ? id : bumpId(lastPointId);
  return lastPointId;
}

function positive(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

function pctOr(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(99, Math.max(0, v)) : def;
}

/** Nota de los productos creados con el precio orientativo de la base de conocimiento (se retira al registrar un precio real). */
export const ESTIMATED_PRICE_NOTE = 'Precio estimado de referencia: actualízalo con una factura';

/** Datos del primer precio al crear un producto (factura de origen, descripción original…). */
export interface FirstPriceInfo {
  date?: string;
  invoiceId?: ID;
  rawDescription?: string;
  /**
   * Precio orientativo (no observado en una compra): no se registra en el histórico ni fija fecha de compra, para que la
   * primera factura real no dispare una alerta de subida falsa.
   */
  estimated?: boolean;
}

/**
 * Construye un producto completo (sin guardarlo) completando lo que falte con la ficha de la base de conocimiento.
 * Función pura: sirve para crear productos dentro de transacciones.
 */
export function buildProduct(data: Partial<Product> & { name: string }, kbFind: KbFinder, firstPrice?: FirstPriceInfo): Product {
  const name = (data.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('El producto necesita un nombre');
  const kb = kbFind(name);
  const now = nowIso();
  const baseUnit: BaseUnit = data.baseUnit ?? kb?.baseUnit ?? 'kg';
  const pricePerBase = positive(data.pricePerBase) ?? 0;
  const product: Product = {
    id: data.id || uid(),
    name,
    searchKey: toSearchKey(name),
    aliases: dedupeAliases(data.aliases ?? [], name),
    category: data.category ?? kb?.category ?? 'otros',
    baseUnit,
    pricePerBase,
    priceSource: data.priceSource ?? 'manual',
    wastePct: pctOr(data.wastePct, kb?.wastePct ?? 0),
    cookingLossPct: pctOr(data.cookingLossPct, kb?.cookingLossPct ?? 0),
    allergens: [...new Set(data.allergens ?? kb?.allergens ?? [])],
    createdAt: data.createdAt ?? now,
    updatedAt: now,
  };
  const unitWeightKg = positive(data.unitWeightKg) ?? positive(kb?.unitWeightKg);
  if (unitWeightKg) product.unitWeightKg = unitWeightKg;
  const densityKgPerL = positive(data.densityKgPerL) ?? positive(kb?.densityKgPerL);
  if (densityKgPerL) product.densityKgPerL = densityKgPerL;
  if (data.supplierId) product.supplierId = data.supplierId;
  if (data.purchaseVatPct != null && Number.isFinite(data.purchaseVatPct)) product.purchaseVatPct = data.purchaseVatPct;
  if (data.yieldTestId) product.yieldTestId = data.yieldTestId;
  const notes = data.notes?.trim();
  if (notes) product.notes = notes;
  const date = data.lastPurchaseDate ?? (pricePerBase > 0 && !firstPrice?.estimated ? (firstPrice?.date ?? todayIso()) : undefined);
  if (date) product.lastPurchaseDate = date;
  return product;
}

/** Guarda un producto ya construido y, si tiene precio (no estimado), su primer PricePoint. */
export async function insertProductIn(wdb: WorkspaceDB, product: Product, firstPrice?: FirstPriceInfo): Promise<Product> {
  await wdb.products.add(product);
  if (product.pricePerBase > 0 && !firstPrice?.estimated) {
    const point: PricePoint = {
      id: nextPricePointId(),
      productId: product.id,
      date: product.lastPurchaseDate ?? firstPrice?.date ?? todayIso(),
      pricePerBase: product.pricePerBase,
      source: product.priceSource,
    };
    if (product.supplierId) point.supplierId = product.supplierId;
    if (firstPrice?.invoiceId) point.invoiceId = firstPrice.invoiceId;
    if (firstPrice?.rawDescription) point.rawDescription = firstPrice.rawDescription;
    await wdb.pricePoints.add(point);
  }
  return product;
}

/** Orden cronológico de precios: fecha y, a igualdad, orden de alta (los ids son crecientes en el tiempo). */
function comparePoints(a: PricePoint, b: PricePoint): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Recalcula el precio vigente de un producto a partir de su PricePoint más reciente (por fecha).
 * Si no le queda histórico conserva el último precio conocido; si venía de una compra (factura o tarifa) deja de
 * atribuírselo (priceSource 'manual' y sin fecha de compra). Devuelve el precio vigente o undefined si el producto no existe.
 */
export async function recomputeCurrentPrice(productId: ID, wdb: WorkspaceDB = db()): Promise<number | undefined> {
  return wdb.transaction('rw', wdb.products, wdb.pricePoints, async () => {
    const product = await wdb.products.get(productId);
    if (!product) return undefined;
    const points = await wdb.pricePoints.where('productId').equals(productId).toArray();
    const valid = points.filter((p) => p.pricePerBase > 0 && Number.isFinite(p.pricePerBase));
    if (!valid.length) {
      if (product.priceSource === 'factura' || product.priceSource === 'hoja') {
        await wdb.products.update(productId, { priceSource: 'manual', lastPurchaseDate: undefined, updatedAt: nowIso() });
      }
      return product.pricePerBase;
    }
    valid.sort(comparePoints);
    const latest = valid[valid.length - 1];
    const patch: Partial<Product> = {
      pricePerBase: latest.pricePerBase,
      priceSource: latest.source,
      lastPurchaseDate: latest.date,
    };
    if (latest.supplierId) patch.supplierId = latest.supplierId;
    // Con un precio real registrado, la nota de "precio estimado" deja de ser cierta.
    if (product.notes === ESTIMATED_PRICE_NOTE) patch.notes = undefined;
    const changed =
      product.pricePerBase !== patch.pricePerBase ||
      product.priceSource !== patch.priceSource ||
      product.lastPurchaseDate !== patch.lastPurchaseDate ||
      'notes' in patch ||
      (patch.supplierId !== undefined && product.supplierId !== patch.supplierId);
    if (changed) await wdb.products.update(productId, { ...patch, updatedAt: nowIso() });
    return latest.pricePerBase;
  });
}

// ───────────────────────────── Productos ─────────────────────────────

/**
 * Crea un producto. Completa lo que falte con la base de conocimiento (kb/findKbIngredient): categoría, unidad base,
 * mermas por defecto, peso por unidad, densidad y alérgenos. Calcula searchKey. Si trae pricePerBase > 0 registra
 * también el primer PricePoint (con los datos opcionales de `firstPrice`: fecha, factura de origen, descripción),
 * salvo que sea un precio orientativo (`firstPrice.estimated`).
 */
export async function createProduct(data: Partial<Product> & { name: string }, firstPrice?: FirstPriceInfo): Promise<Product> {
  const kbFind = await loadKbFinder();
  const product = buildProduct(data, kbFind, firstPrice);
  const wdb = db();
  return wdb.transaction('rw', wdb.products, wdb.pricePoints, () => insertProductIn(wdb, product, firstPrice));
}

/** Actualiza campos (recalcula searchKey si cambia el nombre; updatedAt siempre). */
export async function updateProduct(id: ID, patch: Partial<Product>): Promise<void> {
  const wdb = db();
  await wdb.transaction('rw', wdb.products, async () => {
    const current = await wdb.products.get(id);
    if (!current) throw new Error('El producto ya no existe');
    const next: Partial<Product> = { ...patch };
    delete next.id;
    delete next.createdAt;
    if ('name' in patch) {
      const name = (patch.name ?? '').replace(/\s+/g, ' ').trim();
      if (!name) throw new Error('El producto necesita un nombre');
      next.name = name;
      next.searchKey = toSearchKey(name);
    }
    const finalName = next.name ?? current.name;
    if ('aliases' in patch || 'name' in patch) next.aliases = dedupeAliases(patch.aliases ?? current.aliases ?? [], finalName);
    if ('wastePct' in patch) next.wastePct = pctOr(patch.wastePct, current.wastePct);
    if ('cookingLossPct' in patch) next.cookingLossPct = pctOr(patch.cookingLossPct, current.cookingLossPct);
    if ('pricePerBase' in patch) next.pricePerBase = positive(patch.pricePerBase) ?? 0;
    if ('allergens' in patch) next.allergens = [...new Set(patch.allergens ?? [])];
    if ('unitWeightKg' in patch) next.unitWeightKg = positive(patch.unitWeightKg);
    if ('densityKgPerL' in patch) next.densityKgPerL = positive(patch.densityKgPerL);
    next.updatedAt = nowIso();
    await wdb.products.update(id, next);
  });
}

/** Registra un precio dentro de una transacción ya abierta (ver setProductPrice). */
export async function setProductPriceIn(
  wdb: WorkspaceDB,
  id: ID,
  pricePerBase: number,
  source: PricePoint['source'],
  opts: { date?: string; supplierId?: ID; invoiceId?: ID; rawDescription?: string } = {},
): Promise<void> {
  if (!(Number.isFinite(pricePerBase) && pricePerBase > 0)) throw new Error('El precio debe ser mayor que 0');
  const product = await wdb.products.get(id);
  if (!product) throw new Error('El producto ya no existe');
  const date = opts.date || todayIso();
  const point: PricePoint = { id: nextPricePointId(), productId: id, date, pricePerBase, source };
  if (opts.supplierId) point.supplierId = opts.supplierId;
  if (opts.invoiceId) point.invoiceId = opts.invoiceId;
  if (opts.rawDescription) point.rawDescription = opts.rawDescription;
  await wdb.pricePoints.add(point);
  if (!product.lastPurchaseDate || date >= product.lastPurchaseDate) {
    const patch: Partial<Product> = { pricePerBase, priceSource: source, lastPurchaseDate: date, updatedAt: nowIso() };
    if (opts.supplierId) patch.supplierId = opts.supplierId;
    if (product.notes === ESTIMATED_PRICE_NOTE) patch.notes = undefined;
    await wdb.products.update(id, patch);
  } else if (product.notes === ESTIMATED_PRICE_NOTE) {
    await wdb.products.update(id, { notes: undefined, updatedAt: nowIso() });
  }
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
  const wdb = db();
  await wdb.transaction('rw', wdb.products, wdb.pricePoints, () => setProductPriceIn(wdb, id, pricePerBase, source, opts));
}

/** Borra el producto y su histórico; las líneas de receta que lo usaban quedan sin vincular (conservan el nombre). */
export async function deleteProduct(id: ID): Promise<void> {
  const wdb = db();
  await wdb.transaction('rw', [wdb.products, wdb.pricePoints, wdb.dishes, wdb.invoices, wdb.yieldTests], async () => {
    await wdb.pricePoints.where('productId').equals(id).delete();
    await wdb.products.delete(id);
    const now = nowIso();

    const dishes = await wdb.dishes.filter((d) => d.items.some((it) => it.ref?.type === 'product' && it.ref.id === id)).toArray();
    for (const d of dishes) {
      d.items = d.items.map((it) => {
        if (it.ref?.type !== 'product' || it.ref.id !== id) return it;
        const { ref: _ref, matchScore: _score, ...rest } = it;
        return rest;
      });
      d.updatedAt = now;
    }
    if (dishes.length) await wdb.dishes.bulkPut(dishes);

    const invoices = await wdb.invoices.filter((inv) => inv.lines.some((l) => l.productId === id)).toArray();
    for (const inv of invoices) {
      inv.lines = inv.lines.map((l) => {
        if (l.productId !== id) return l;
        const { productId: _pid, matchScore: _score, ...rest } = l;
        return { ...rest, matchStatus: l.matchStatus === 'ignorado' ? 'ignorado' : 'nuevo' };
      });
    }
    if (invoices.length) await wdb.invoices.bulkPut(invoices);

    await wdb.yieldTests.where('productId').equals(id).modify((t) => {
      delete t.productId;
      t.updatedAt = now;
    });
  });
}

/**
 * Factor para pasar un precio €/ud base de `from` a €/ud base de `to` (precio_to = precio_from × factor).
 * undefined si no se puede convertir (p. ej. ud ⇄ kg sin peso por unidad).
 */
export function priceConversionFactor(
  from: BaseUnit,
  to: BaseUnit,
  props: { unitWeightKg?: number; densityKgPerL?: number },
): { factor: number; assumption?: string } | undefined {
  if (from === to) return { factor: 1 };
  // 1 ud de `to` equivale a `factor` ud de `from`.
  const conv = convertToBase(1, to, from, props);
  if (!conv.ok || !(conv.value > 0) || !Number.isFinite(conv.value)) return undefined;
  return { factor: conv.value, assumption: conv.assumption };
}

const UNIT_NAMES: Record<BaseUnit, string> = { kg: 'kg', l: 'litros', ud: 'unidades' };

/** Fusiona duplicados: mueve histórico, alias y vínculos de recetas/facturas de `removeId` a `keepId`, y borra `removeId`. */
export async function mergeProducts(keepId: ID, removeId: ID): Promise<void> {
  if (!keepId || !removeId || keepId === removeId) throw new Error('Elige dos productos distintos para fusionar');
  const wdb = db();
  await wdb.transaction('rw', [wdb.products, wdb.pricePoints, wdb.dishes, wdb.invoices, wdb.yieldTests], async () => {
    const [keep, remove] = await Promise.all([wdb.products.get(keepId), wdb.products.get(removeId)]);
    if (!keep || !remove) throw new Error('Uno de los productos ya no existe');
    const props = {
      unitWeightKg: keep.unitWeightKg ?? remove.unitWeightKg,
      densityKgPerL: keep.densityKgPerL ?? remove.densityKgPerL,
    };
    const conv = priceConversionFactor(remove.baseUnit, keep.baseUnit, props);
    if (!conv) {
      throw new Error(
        `No se pueden fusionar: «${remove.name}» se compra en ${UNIT_NAMES[remove.baseUnit]} y «${keep.name}» en ${UNIT_NAMES[keep.baseUnit]}. ` +
          'Indica el peso por unidad en uno de los dos y vuelve a intentarlo.',
      );
    }
    const now = nowIso();

    // Histórico de precios (convertido a la unidad del producto que se conserva)
    const points = await wdb.pricePoints.where('productId').equals(removeId).toArray();
    if (points.length) {
      await wdb.pricePoints.bulkPut(
        points.map((p) => ({ ...p, productId: keepId, pricePerBase: Math.round(p.pricePerBase * conv.factor * 1e6) / 1e6 })),
      );
    }

    // Recetas
    const dishes = await wdb.dishes.filter((d) => d.items.some((it) => it.ref?.type === 'product' && it.ref.id === removeId)).toArray();
    for (const d of dishes) {
      d.items = d.items.map((it) => (it.ref?.type === 'product' && it.ref.id === removeId ? { ...it, ref: { type: 'product', id: keepId } } : it));
      d.updatedAt = now;
    }
    if (dishes.length) await wdb.dishes.bulkPut(dishes);

    // Facturas
    const invoices: Invoice[] = await wdb.invoices.filter((inv) => inv.lines.some((l) => l.productId === removeId)).toArray();
    for (const inv of invoices) inv.lines = inv.lines.map((l) => (l.productId === removeId ? { ...l, productId: keepId } : l));
    if (invoices.length) await wdb.invoices.bulkPut(invoices);

    // Pruebas de rendimiento
    await wdb.yieldTests.where('productId').equals(removeId).modify((t) => {
      t.productId = keepId;
      t.updatedAt = now;
    });

    // Datos del producto que se conserva: se completan los huecos con los del duplicado
    const patch: Partial<Product> = {
      aliases: dedupeAliases([...keep.aliases, remove.name, ...remove.aliases], keep.name),
      allergens: [...new Set([...keep.allergens, ...remove.allergens])],
      updatedAt: now,
    };
    if (!keep.supplierId && remove.supplierId) patch.supplierId = remove.supplierId;
    if (!keep.unitWeightKg && remove.unitWeightKg) patch.unitWeightKg = remove.unitWeightKg;
    if (!keep.densityKgPerL && remove.densityKgPerL) patch.densityKgPerL = remove.densityKgPerL;
    if (!keep.yieldTestId && remove.yieldTestId) patch.yieldTestId = remove.yieldTestId;
    if (keep.purchaseVatPct == null && remove.purchaseVatPct != null) patch.purchaseVatPct = remove.purchaseVatPct;
    if (!keep.notes && remove.notes) patch.notes = remove.notes;
    if (!(keep.pricePerBase > 0) && remove.pricePerBase > 0) {
      patch.pricePerBase = Math.round(remove.pricePerBase * conv.factor * 1e6) / 1e6;
      patch.priceSource = remove.priceSource;
      if (remove.lastPurchaseDate) patch.lastPurchaseDate = remove.lastPurchaseDate;
    }
    await wdb.products.update(keepId, patch);
    await wdb.products.delete(removeId);
    await recomputeCurrentPrice(keepId, wdb);
  });
}

/** Añade un alias dentro de una transacción ya abierta (ver addProductAlias). */
export async function addProductAliasIn(wdb: WorkspaceDB, id: ID, alias: string): Promise<boolean> {
  const clean = (alias ?? '').replace(/\s+/g, ' ').trim();
  if (!aliasKey(clean)) return false;
  const product = await wdb.products.get(id);
  if (!product) throw new Error('El producto ya no existe');
  const key = aliasKey(clean);
  if (key === aliasKey(product.name) || product.aliases.some((a) => aliasKey(a) === key)) return false;
  await wdb.products.update(id, { aliases: dedupeAliases([...product.aliases, clean], product.name), updatedAt: nowIso() });
  return true;
}

/** Añade un alias aprendido (sin duplicados, ignorando mayúsculas/tildes). */
export async function addProductAlias(id: ID, alias: string): Promise<void> {
  const wdb = db();
  await wdb.transaction('rw', wdb.products, () => addProductAliasIn(wdb, id, alias));
}

// ───────────────────────────── Proveedores ─────────────────────────────

const LEGAL_FORMS = new Set([
  'sl', 'sa', 'slu', 'sau', 'sll', 'slne', 'slp', 'cb', 'scp', 'sc', 'sat', 'scoop', 'coop', 'sociedad', 'limitada', 'anonima', 'unipersonal',
  'cooperativa', 'ltd', 'ltda', 'inc', 'gmbh', 'srl', 'spa',
]);

/** Nombre de proveedor comparable: sin tildes, signos ni forma jurídica ("Frutas García, S.L." → "frutas garcia"). */
export function supplierKey(name: string): string {
  const tokens = normalizeText(name).split(' ').filter(Boolean);
  // Las iniciales sueltas se unen: "s l u" → "slu", "s a" → "sa"
  const merged: string[] = [];
  let run = '';
  for (const w of tokens) {
    if (w.length === 1 && /[a-z]/.test(w)) {
      run += w;
      continue;
    }
    if (run) merged.push(run);
    run = '';
    merged.push(w);
  }
  if (run) merged.push(run);
  const words = merged.filter((w) => !LEGAL_FORMS.has(w));
  return (words.length ? words : merged).join(' ');
}

/** CIF/NIF comparable: mayúsculas, sin signos y sin el prefijo de país "ES". */
export function taxIdKey(taxId: string | undefined): string {
  if (!taxId) return '';
  const k = taxId.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return k.length > 9 && k.startsWith('ES') ? k.slice(2) : k;
}

/** Busca un proveedor existente por CIF (prioritario) o por nombre normalizado. No crea nada. */
export function matchSupplier(suppliers: Supplier[], name: string | undefined, taxId?: string): Supplier | undefined {
  const tk = taxIdKey(taxId);
  if (tk) {
    const byTax = suppliers.find((s) => taxIdKey(s.taxId) === tk);
    if (byTax) return byTax;
  }
  const nk = name ? supplierKey(name) : '';
  if (!nk) return undefined;
  return suppliers.find((s) => supplierKey(s.name) === nk && !(tk && s.taxId && taxIdKey(s.taxId) !== tk));
}

/** Busca o crea un proveedor dentro de una transacción ya abierta (ver findOrCreateSupplier). */
export async function findOrCreateSupplierIn(wdb: WorkspaceDB, name: string, taxId?: string): Promise<Supplier> {
  const cleanName = (name ?? '').replace(/\s+/g, ' ').trim();
  const cleanTax = taxId?.replace(/\s+/g, '').trim() || undefined;
  if (!cleanName && !cleanTax) throw new Error('Falta el nombre del proveedor');
  const suppliers = await wdb.suppliers.toArray();
  const found = matchSupplier(suppliers, cleanName, cleanTax);
  if (found) {
    if (cleanTax && !found.taxId) {
      await wdb.suppliers.update(found.id, { taxId: cleanTax });
      return { ...found, taxId: cleanTax };
    }
    return found;
  }
  const supplier: Supplier = { id: uid(), name: cleanName || `Proveedor ${cleanTax}`, createdAt: nowIso() };
  if (cleanTax) supplier.taxId = cleanTax;
  await wdb.suppliers.add(supplier);
  return supplier;
}

/** Busca proveedor por CIF o por nombre normalizado; si no existe lo crea. */
export async function findOrCreateSupplier(name: string, taxId?: string): Promise<Supplier> {
  const wdb = db();
  return wdb.transaction('rw', wdb.suppliers, () => findOrCreateSupplierIn(wdb, name, taxId));
}
