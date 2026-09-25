import type { ID, IngredientCategory, Product, YieldOutput, YieldOutputKind, YieldTest } from '../types';
import { db } from '../db';
import { nowIso, todayIso, uid } from '../lib/id';

/**
 * Pruebas de rendimiento (despiece) sobre la BD del espacio activo.
 *
 * Una prueba describe lo que sale de una pieza tal cual se compra (peso bruto → salidas). Vinculada a un producto
 * (Product.yieldTestId) hace que TODOS los escandallos que usen ese producto calculen con su rendimiento real y con el
 * coste €/kg útil (que descuenta el valor de los subproductos), recalculado siempre con el precio vigente del producto.
 */

// ───────────────────────────── Utilidades ─────────────────────────────

/** Número finito y no negativo (o el valor por defecto). */
function nonNeg(v: unknown, def = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : def;
}

/** Porcentaje 0–99,9 (una merma del 100 % no tiene sentido en una prueba). */
function pct(v: unknown, def = 0): number {
  const n = nonNeg(v, def);
  return Math.min(99.9, n);
}

const KINDS: YieldOutputKind[] = ['principal', 'subproducto', 'desperdicio'];

/** Normaliza una salida: id garantizado, nombre recortado, peso ≥ 0, tipo válido y valor sólo en subproductos. */
export function normalizeOutput(o: Partial<YieldOutput>): YieldOutput {
  const kind: YieldOutputKind = o.kind && KINDS.includes(o.kind) ? o.kind : 'principal';
  const out: YieldOutput = {
    id: o.id || uid(),
    name: (o.name ?? '').trim(),
    weightKg: nonNeg(o.weightKg),
    kind,
  };
  if (kind === 'subproducto' && o.valuePerKg != null && Number.isFinite(o.valuePerKg) && o.valuePerKg > 0) out.valuePerKg = o.valuePerKg;
  return out;
}

/**
 * Precio €/kg de un producto para usarlo como precio de compra de la pieza.
 *  - kg → su precio vigente.
 *  - ud → precio / peso medio por unidad (si se conoce).
 *  - l  → precio / densidad (si se conoce; por defecto 1 kg/l).
 * Devuelve undefined si el producto no tiene precio o no es convertible a kg.
 */
export function productPricePerKg(product: Pick<Product, 'baseUnit' | 'pricePerBase' | 'unitWeightKg' | 'densityKgPerL'> | undefined): number | undefined {
  if (!product || !(product.pricePerBase > 0)) return undefined;
  if (product.baseUnit === 'kg') return product.pricePerBase;
  if (product.baseUnit === 'ud') return product.unitWeightKg && product.unitWeightKg > 0 ? product.pricePerBase / product.unitWeightKg : undefined;
  const density = product.densityKgPerL && product.densityKgPerL > 0 ? product.densityKgPerL : 1;
  return product.pricePerBase / density;
}

/** Limpia un parche antes de guardarlo (campos numéricos coherentes, salidas normalizadas). */
function sanitizePatch(patch: Partial<YieldTest>): Partial<YieldTest> {
  const out: Partial<YieldTest> = { ...patch };
  delete out.id;
  delete out.createdAt;
  if ('grossWeightKg' in patch) out.grossWeightKg = nonNeg(patch.grossWeightKg);
  if ('purchasePricePerKg' in patch) out.purchasePricePerKg = nonNeg(patch.purchasePricePerKg);
  if ('cookingLossPct' in patch) out.cookingLossPct = pct(patch.cookingLossPct);
  if ('thawLossPct' in patch) out.thawLossPct = patch.thawLossPct == null ? undefined : pct(patch.thawLossPct);
  if ('portionKg' in patch) out.portionKg = patch.portionKg != null && Number.isFinite(patch.portionKg) && patch.portionKg > 0 ? patch.portionKg : undefined;
  if ('outputs' in patch) out.outputs = (patch.outputs ?? []).map(normalizeOutput);
  if ('productId' in patch) out.productId = patch.productId || undefined;
  return out;
}

// ───────────────────────────── Casos de uso ─────────────────────────────

/** Crea una prueba de rendimiento; si trae productId toma su precio vigente como purchasePricePerKg por defecto. */
export async function createYieldTest(data: Partial<YieldTest> & { name: string }): Promise<YieldTest> {
  const wdb = db();
  let price = data.purchasePricePerKg != null && Number.isFinite(data.purchasePricePerKg) ? data.purchasePricePerKg : undefined;
  if (price == null && data.productId) {
    const product = await wdb.products.get(data.productId);
    price = productPricePerKg(product);
  }
  const now = nowIso();
  const clean = sanitizePatch(data);
  const test: YieldTest = {
    ...clean,
    id: data.id || uid(),
    name: data.name.trim() || 'Prueba de rendimiento',
    date: data.date || todayIso(),
    grossWeightKg: nonNeg(data.grossWeightKg),
    purchasePricePerKg: nonNeg(price),
    outputs: (data.outputs ?? []).map(normalizeOutput),
    cookingLossPct: pct(data.cookingLossPct),
    createdAt: now,
    updatedAt: now,
  };
  if (test.thawLossPct == null) delete test.thawLossPct;
  if (test.portionKg == null) delete test.portionKg;
  if (!test.productId) delete test.productId;
  await wdb.yieldTests.put(test);
  return test;
}

/**
 * Actualiza campos (updatedAt siempre). Si cambia el producto de la prueba, el producto anterior deja de usarla
 * (se desvincula Product.yieldTestId) para que ningún escandallo calcule con una prueba de otra pieza.
 */
export async function updateYieldTest(id: ID, patch: Partial<YieldTest>): Promise<void> {
  const wdb = db();
  const clean = sanitizePatch(patch);
  await wdb.transaction('rw', wdb.yieldTests, wdb.products, async () => {
    const current = await wdb.yieldTests.get(id);
    if (!current) throw new Error('La prueba de rendimiento ya no existe');
    const now = nowIso();
    await wdb.yieldTests.update(id, { ...clean, updatedAt: now });
    if ('productId' in clean && clean.productId !== current.productId) {
      await wdb.products
        .filter((p) => p.yieldTestId === id && p.id !== clean.productId)
        .modify((p) => {
          delete p.yieldTestId;
          p.updatedAt = now;
        });
    }
  });
}

/** Borra; desvincula de productos y líneas de receta que la usaran. */
export async function deleteYieldTest(id: ID): Promise<void> {
  const wdb = db();
  await wdb.transaction('rw', wdb.yieldTests, wdb.products, wdb.dishes, async () => {
    const now = nowIso();
    await wdb.yieldTests.delete(id);
    await wdb.products
      .filter((p) => p.yieldTestId === id)
      .modify((p) => {
        delete p.yieldTestId;
        p.updatedAt = now;
      });
    await wdb.dishes
      .filter((d) => d.items.some((it) => it.yieldTestId === id))
      .modify((d) => {
        d.items = d.items.map((it) => {
          if (it.yieldTestId !== id) return it;
          const { yieldTestId: _removed, ...rest } = it;
          return rest;
        });
        d.updatedAt = now;
      });
  });
}

/** Vincula la prueba al producto (Product.yieldTestId) para que todos los escandallos usen su rendimiento real. */
export async function linkYieldTestToProduct(testId: ID, productId: ID | undefined): Promise<void> {
  const wdb = db();
  await wdb.transaction('rw', wdb.yieldTests, wdb.products, async () => {
    const test = await wdb.yieldTests.get(testId);
    if (!test) throw new Error('La prueba de rendimiento ya no existe');
    const now = nowIso();
    if (productId) {
      const product = await wdb.products.get(productId);
      if (!product) throw new Error('El producto ya no existe');
    }
    // Una prueba sólo manda sobre un producto: se desvincula de cualquier otro.
    await wdb.products
      .filter((p) => p.yieldTestId === testId && p.id !== productId)
      .modify((p) => {
        delete p.yieldTestId;
        p.updatedAt = now;
      });
    if (productId) {
      await wdb.products.update(productId, { yieldTestId: testId, updatedAt: now });
      if (test.productId !== productId) await wdb.yieldTests.update(testId, { productId, updatedAt: now });
    }
  });
}

/** Duplica una prueba (p. ej. para repetirla con una pieza nueva) sin vincular la copia a ningún producto. */
export async function duplicateYieldTest(id: ID, overrides?: Partial<YieldTest>): Promise<YieldTest> {
  const src = await db().yieldTests.get(id);
  if (!src) throw new Error('La prueba de rendimiento ya no existe');
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src;
  return createYieldTest({
    ...rest,
    name: `${src.name} (copia)`,
    date: todayIso(),
    outputs: src.outputs.map((o) => ({ ...o, id: uid() })),
    ...overrides,
  });
}

// ───────────────────────────── Plantillas ─────────────────────────────

/** Plantillas de despiece habituales (salmón entero, solomillo, pulpo, merluza, cordero, pollo…) con salidas y % típicos. */
export interface YieldTemplate {
  name: string;
  productHint: string;
  cookingLossPct: number;
  portionKg: number;
  /** Salidas como fracción del peso bruto (0–1). */
  outputs: { name: string; kind: 'principal' | 'subproducto' | 'desperdicio'; fraction: number; valuePerKg?: number }[];
  /** Emoji para la galería. */
  emoji?: string;
  /** Familia de producto (para agrupar la galería). */
  category?: IngredientCategory;
  /** Peso bruto típico de la pieza o del lote que se suele pesar (kg). */
  typicalGrossKg?: number;
  /** Merma de descongelación típica (%) si la pieza se compra congelada. */
  thawLossPct?: number;
  /** Consejo práctico para hacer la prueba. */
  tip?: string;
}

export const YIELD_TEMPLATES: YieldTemplate[] = [
  // ── Pescado ──
  {
    name: 'Salmón entero',
    productHint: 'salmón',
    emoji: '🐟',
    category: 'pescado',
    typicalGrossKg: 5.5,
    cookingLossPct: 15,
    portionKg: 0.15,
    tip: 'Pesa el salmón eviscerado con cabeza. Separa los lomos sin piel ni espinas; la ventresca y los recortes tienen salida (tartar, ahumados).',
    outputs: [
      { name: 'Lomos limpios sin piel ni espinas', kind: 'principal', fraction: 0.55 },
      { name: 'Ventresca', kind: 'subproducto', fraction: 0.05, valuePerKg: 16 },
      { name: 'Recortes para tartar', kind: 'subproducto', fraction: 0.05, valuePerKg: 8 },
      { name: 'Cabeza y espinas (fumet)', kind: 'subproducto', fraction: 0.19, valuePerKg: 1.5 },
      { name: 'Piel, aletas y sangre', kind: 'desperdicio', fraction: 0.09 },
    ],
  },
  {
    name: 'Merluza entera',
    productHint: 'merluza',
    emoji: '🐟',
    category: 'pescado',
    typicalGrossKg: 2.5,
    cookingLossPct: 12,
    portionKg: 0.16,
    tip: 'Pesa la merluza entera con cabeza. Las cocochas y la cabeza para salsa verde o fumet cuentan como subproducto.',
    outputs: [
      { name: 'Lomos y rodajas limpias', kind: 'principal', fraction: 0.52 },
      { name: 'Cocochas', kind: 'subproducto', fraction: 0.01, valuePerKg: 25 },
      { name: 'Cabeza y espinas (fumet)', kind: 'subproducto', fraction: 0.25, valuePerKg: 1.5 },
      { name: 'Piel, aletas y vísceras', kind: 'desperdicio', fraction: 0.15 },
    ],
  },
  {
    name: 'Lubina / dorada de ración (fileteada)',
    productHint: 'lubina',
    emoji: '🐠',
    category: 'pescado',
    typicalGrossKg: 3,
    cookingLossPct: 12,
    portionKg: 0.18,
    tip: 'Pesa varias piezas de ración juntas (400–600 g cada una) y saca dos lomos con piel por pieza.',
    outputs: [
      { name: 'Lomos con piel', kind: 'principal', fraction: 0.45 },
      { name: 'Cabezas y espinas (fumet)', kind: 'subproducto', fraction: 0.3, valuePerKg: 1 },
      { name: 'Escamas, vísceras y aletas', kind: 'desperdicio', fraction: 0.18 },
    ],
  },
  {
    name: 'Rape entero (cola limpia)',
    productHint: 'rape',
    emoji: '🐡',
    category: 'pescado',
    typicalGrossKg: 4,
    cookingLossPct: 15,
    portionKg: 0.15,
    tip: 'La cabeza del rape es casi la mitad del peso: guárdala para caldos y arroces. Quita piel y telillas de la cola.',
    outputs: [
      { name: 'Cola limpia (lomos sin piel ni telilla)', kind: 'principal', fraction: 0.33 },
      { name: 'Cabeza (caldos y arroces)', kind: 'subproducto', fraction: 0.45, valuePerKg: 2 },
      { name: 'Carrilleras y kokotxas', kind: 'subproducto', fraction: 0.02, valuePerKg: 18 },
      { name: 'Piel, telillas y vísceras', kind: 'desperdicio', fraction: 0.14 },
    ],
  },
  {
    name: 'Bacalao salado (desalado + limpieza)',
    productHint: 'bacalao salado',
    emoji: '🐟',
    category: 'pescado',
    typicalGrossKg: 3,
    cookingLossPct: 10,
    portionKg: 0.18,
    tip: 'Pesa las salidas ya desaladas: el bacalao gana agua al desalar, por eso el rendimiento puede parecer alto. Las migas van a croquetas y buñuelos.',
    outputs: [
      { name: 'Lomos desalados limpios', kind: 'principal', fraction: 0.62 },
      { name: 'Migas (croquetas, buñuelos, brandada)', kind: 'subproducto', fraction: 0.14, valuePerKg: 8 },
      { name: 'Piel y espinas', kind: 'desperdicio', fraction: 0.18 },
    ],
  },
  {
    name: 'Rodaballo salvaje',
    productHint: 'rodaballo',
    emoji: '🐟',
    category: 'pescado',
    typicalGrossKg: 3,
    cookingLossPct: 12,
    portionKg: 0.16,
    tip: 'Pescado plano: sale poco lomo pero mucha gelatina. Las espinas y la cabeza dan un fumet excelente.',
    outputs: [
      { name: 'Cuatro lomos limpios', kind: 'principal', fraction: 0.42 },
      { name: 'Cabeza y espinas (fumet)', kind: 'subproducto', fraction: 0.32, valuePerKg: 2 },
      { name: 'Piel, aletas y vísceras', kind: 'desperdicio', fraction: 0.2 },
    ],
  },
  {
    name: 'Atún rojo (lomo)',
    productHint: 'atún rojo',
    emoji: '🐟',
    category: 'pescado',
    typicalGrossKg: 4,
    cookingLossPct: 0,
    portionKg: 0.12,
    tip: 'Pesa el lomo con piel. Quita piel y sangacho; los recortes limpios van a tartar. Para tataki o marcado, pon un 8–10 % de cocción.',
    outputs: [
      { name: 'Lomo limpio (tacos para tataki y sashimi)', kind: 'principal', fraction: 0.74 },
      { name: 'Recortes para tartar', kind: 'subproducto', fraction: 0.06, valuePerKg: 15 },
      { name: 'Sangacho', kind: 'desperdicio', fraction: 0.09 },
      { name: 'Piel y nervios', kind: 'desperdicio', fraction: 0.08 },
    ],
  },
  // ── Marisco y cefalópodos ──
  {
    name: 'Pulpo crudo congelado',
    productHint: 'pulpo',
    emoji: '🐙',
    category: 'marisco',
    typicalGrossKg: 2.5,
    thawLossPct: 10,
    cookingLossPct: 45,
    portionKg: 0.18,
    tip: 'Descongela en cámara 24–48 h y pesa escurrido. Al cocerlo pierde casi la mitad: por eso el kilo cocido cuesta más del doble.',
    outputs: [
      { name: 'Patas y cuerpo limpios', kind: 'principal', fraction: 0.82 },
      { name: 'Cabeza, boca, ojos y vísceras', kind: 'desperdicio', fraction: 0.06 },
    ],
  },
  {
    name: 'Calamar',
    productHint: 'calamar',
    emoji: '🦑',
    category: 'marisco',
    typicalGrossKg: 3,
    cookingLossPct: 25,
    portionKg: 0.15,
    tip: 'Limpia tubo, aletas y tentáculos. Guarda la tinta para arroz negro.',
    outputs: [
      { name: 'Tubo, aletas y tentáculos limpios', kind: 'principal', fraction: 0.7 },
      { name: 'Tinta', kind: 'subproducto', fraction: 0.01, valuePerKg: 20 },
      { name: 'Pluma, piel, ojos y vísceras', kind: 'desperdicio', fraction: 0.24 },
    ],
  },
  {
    name: 'Sepia',
    productHint: 'sepia',
    emoji: '🦑',
    category: 'marisco',
    typicalGrossKg: 2,
    cookingLossPct: 30,
    portionKg: 0.15,
    tip: 'Quita el hueso (jibión), la piel y las vísceras. La tinta y las huevas tienen salida en arroces.',
    outputs: [
      { name: 'Sepia limpia', kind: 'principal', fraction: 0.62 },
      { name: 'Tinta y huevas', kind: 'subproducto', fraction: 0.02, valuePerKg: 10 },
      { name: 'Hueso, piel y vísceras', kind: 'desperdicio', fraction: 0.3 },
    ],
  },
  {
    name: 'Langostino (pelado)',
    productHint: 'langostino',
    emoji: '🦐',
    category: 'marisco',
    typicalGrossKg: 2,
    cookingLossPct: 15,
    portionKg: 0.12,
    tip: 'Si es congelado, añade la merma de descongelación (el glaseado puede ser del 10–20 %). Cabezas y cáscaras para fumet o bisque.',
    outputs: [
      { name: 'Colas peladas', kind: 'principal', fraction: 0.46 },
      { name: 'Cabezas y cáscaras (fumet, bisque)', kind: 'subproducto', fraction: 0.48, valuePerKg: 2.5 },
    ],
  },
  // ── Carne ──
  {
    name: 'Solomillo de ternera entero',
    productHint: 'solomillo de ternera',
    emoji: '🥩',
    category: 'carne',
    typicalGrossKg: 2.5,
    cookingLossPct: 18,
    portionKg: 0.18,
    tip: 'Separa el cordón (salteados, fondos) y las puntas (steak tartar, brochetas). Quita grasa y nervio plateado.',
    outputs: [
      { name: 'Corazón y cabeza limpios (medallones)', kind: 'principal', fraction: 0.62 },
      { name: 'Cordón (salteados, fondo)', kind: 'subproducto', fraction: 0.13, valuePerKg: 9 },
      { name: 'Puntas y recortes (tartar, brochetas)', kind: 'subproducto', fraction: 0.07, valuePerKg: 14 },
      { name: 'Grasa y nervio plateado', kind: 'desperdicio', fraction: 0.15 },
    ],
  },
  {
    name: 'Lomo alto de vaca (chuletón / entrecot)',
    productHint: 'lomo alto de vaca',
    emoji: '🥩',
    category: 'carne',
    typicalGrossKg: 7,
    cookingLossPct: 20,
    portionKg: 0.3,
    tip: 'Pesa la pieza entera antes de racionar. Los recortes magros van a hamburguesa; huesos y cartílagos, a fondo oscuro.',
    outputs: [
      { name: 'Chuletones / entrecots listos', kind: 'principal', fraction: 0.7 },
      { name: 'Recortes para hamburguesa o picada', kind: 'subproducto', fraction: 0.08, valuePerKg: 9 },
      { name: 'Huesos y cartílagos (fondo oscuro)', kind: 'subproducto', fraction: 0.08, valuePerKg: 0.6 },
      { name: 'Grasa exterior y nervios', kind: 'desperdicio', fraction: 0.11 },
    ],
  },
  {
    name: 'Paletilla de cordero lechal',
    productHint: 'paletilla de cordero lechal',
    emoji: '🍖',
    category: 'carne',
    typicalGrossKg: 4,
    cookingLossPct: 32,
    portionKg: 0.55,
    tip: 'Se asa y se sirve con hueso: el gramaje por ración es la paletilla asada entera. Pesa varias juntas.',
    outputs: [
      { name: 'Paletillas listas para asar', kind: 'principal', fraction: 0.94 },
      { name: 'Grasa sobrante y recortes', kind: 'desperdicio', fraction: 0.04 },
    ],
  },
  {
    name: 'Pollo entero (despiece)',
    productHint: 'pollo entero',
    emoji: '🍗',
    category: 'carne',
    typicalGrossKg: 2.2,
    cookingLossPct: 25,
    portionKg: 0.18,
    tip: 'Despieza en pechugas y muslos (van al plato), alas y carcasa para fondo. La piel y la grasa suelen desecharse.',
    outputs: [
      { name: 'Pechugas', kind: 'principal', fraction: 0.26 },
      { name: 'Muslos y contramuslos', kind: 'principal', fraction: 0.32 },
      { name: 'Alas', kind: 'subproducto', fraction: 0.09, valuePerKg: 3.5 },
      { name: 'Carcasa y cuello (fondo)', kind: 'subproducto', fraction: 0.2, valuePerKg: 0.8 },
      { name: 'Piel, grasa y menudillos', kind: 'desperdicio', fraction: 0.08 },
    ],
  },
  {
    name: 'Carrillera de ternera',
    productHint: 'carrillera de ternera',
    emoji: '🥩',
    category: 'carne',
    typicalGrossKg: 3,
    cookingLossPct: 40,
    portionKg: 0.18,
    tip: 'Limpia la grasa y la telilla exterior antes de guisar. En un guiso largo pierde en torno al 40 % del peso.',
    outputs: [
      { name: 'Carrilleras limpias', kind: 'principal', fraction: 0.82 },
      { name: 'Grasa y telilla', kind: 'desperdicio', fraction: 0.16 },
    ],
  },
  {
    name: 'Jamón ibérico con hueso (loncheado a cuchillo)',
    productHint: 'jamón ibérico',
    emoji: '🐖',
    category: 'charcuteria',
    typicalGrossKg: 8,
    cookingLossPct: 0,
    portionKg: 0.08,
    tip: 'Pesa el jamón entero antes de empezar y cada salida al terminarlo. La diferencia es la pérdida por oreo mientras se lonchea.',
    outputs: [
      { name: 'Lonchas a cuchillo', kind: 'principal', fraction: 0.48 },
      { name: 'Tacos y virutas (croquetas, salmorejo)', kind: 'subproducto', fraction: 0.07, valuePerKg: 20 },
      { name: 'Hueso (caldos)', kind: 'subproducto', fraction: 0.12, valuePerKg: 1 },
      { name: 'Corteza y grasa exterior', kind: 'desperdicio', fraction: 0.25 },
    ],
  },
  // ── Verdura y fruta ──
  {
    name: 'Alcachofa (corazones)',
    productHint: 'alcachofa',
    emoji: '🥬',
    category: 'verdura',
    typicalGrossKg: 5,
    cookingLossPct: 10,
    portionKg: 0.15,
    tip: 'Deshoja hasta llegar a las hojas tiernas, tornea y pesa los corazones (en agua con limón o perejil).',
    outputs: [
      { name: 'Corazones limpios', kind: 'principal', fraction: 0.35 },
      { name: 'Hojas exteriores y tallo', kind: 'desperdicio', fraction: 0.62 },
    ],
  },
  {
    name: 'Espárrago verde',
    productHint: 'espárrago verde',
    emoji: '🌱',
    category: 'verdura',
    typicalGrossKg: 2,
    cookingLossPct: 10,
    portionKg: 0.12,
    tip: 'Corta la parte leñosa (sirve para cremas) y pela el tallo si es grueso.',
    outputs: [
      { name: 'Yemas y tallos tiernos', kind: 'principal', fraction: 0.7 },
      { name: 'Parte leñosa (cremas)', kind: 'subproducto', fraction: 0.22, valuePerKg: 1 },
      { name: 'Pieles', kind: 'desperdicio', fraction: 0.05 },
    ],
  },
  {
    name: 'Patata (pelada)',
    productHint: 'patata',
    emoji: '🥔',
    category: 'verdura',
    typicalGrossKg: 10,
    cookingLossPct: 35,
    portionKg: 0.15,
    tip: 'Pesa un saco o una caja entera y lo que queda pelado. Para fritas, la cocción (fritura) quita en torno a un tercio del peso.',
    outputs: [
      { name: 'Patata pelada', kind: 'principal', fraction: 0.8 },
      { name: 'Piel y ojos', kind: 'desperdicio', fraction: 0.17 },
    ],
  },
  {
    name: 'Cebolla (pelada)',
    productHint: 'cebolla',
    emoji: '🧅',
    category: 'verdura',
    typicalGrossKg: 10,
    cookingLossPct: 45,
    portionKg: 0.05,
    tip: 'Pesa un saco y lo que queda pelado. Pochada o caramelizada pierde casi la mitad del peso.',
    outputs: [
      { name: 'Cebolla pelada', kind: 'principal', fraction: 0.88 },
      { name: 'Piel, raíz y capas secas', kind: 'desperdicio', fraction: 0.1 },
    ],
  },
  {
    name: 'Piña',
    productHint: 'piña',
    emoji: '🍍',
    category: 'fruta',
    typicalGrossKg: 1.6,
    cookingLossPct: 0,
    portionKg: 0.15,
    tip: 'Quita corona, corteza y ojos. El corazón sirve para zumos o agua de piña.',
    outputs: [
      { name: 'Pulpa limpia', kind: 'principal', fraction: 0.52 },
      { name: 'Corazón (zumos)', kind: 'subproducto', fraction: 0.08, valuePerKg: 0.5 },
      { name: 'Corteza y corona', kind: 'desperdicio', fraction: 0.37 },
    ],
  },
  {
    name: 'Melón',
    productHint: 'melón',
    emoji: '🍈',
    category: 'fruta',
    typicalGrossKg: 2.5,
    cookingLossPct: 0,
    portionKg: 0.2,
    tip: 'Pesa la pieza entera y la pulpa sin corteza ni pepitas.',
    outputs: [
      { name: 'Pulpa', kind: 'principal', fraction: 0.58 },
      { name: 'Corteza', kind: 'desperdicio', fraction: 0.3 },
      { name: 'Pepitas y fibra', kind: 'desperdicio', fraction: 0.09 },
    ],
  },
  {
    name: 'Aguacate',
    productHint: 'aguacate',
    emoji: '🥑',
    category: 'fruta',
    typicalGrossKg: 2,
    cookingLossPct: 0,
    portionKg: 0.08,
    tip: 'Pesa las piezas en su punto; si alguna sale negra por dentro, anótala como desperdicio: es merma real.',
    outputs: [
      { name: 'Pulpa', kind: 'principal', fraction: 0.66 },
      { name: 'Hueso y piel', kind: 'desperdicio', fraction: 0.31 },
    ],
  },
];

/** Rendimiento típico (0–100) de una plantilla: suma de las salidas principales. */
export function templateYieldPct(tpl: YieldTemplate): number {
  return tpl.outputs.filter((o) => o.kind === 'principal').reduce((s, o) => s + o.fraction, 0) * 100;
}

/** Salidas de una plantilla escaladas al peso bruto indicado (kg, redondeadas al gramo). */
export function outputsFromTemplate(tpl: YieldTemplate, grossWeightKg: number): YieldOutput[] {
  const g = nonNeg(grossWeightKg);
  return tpl.outputs.map((o) =>
    normalizeOutput({
      id: uid(),
      name: o.name,
      kind: o.kind,
      weightKg: Math.round(o.fraction * g * 1000) / 1000,
      valuePerKg: o.valuePerKg,
    }),
  );
}

/** Crea una prueba a partir de una plantilla (peso bruto por defecto: el típico de la plantilla o 5 kg). */
export async function createYieldTestFromTemplate(
  tpl: YieldTemplate,
  opts: { productId?: ID; grossWeightKg?: number; purchasePricePerKg?: number; name?: string; date?: string } = {},
): Promise<YieldTest> {
  const gross = opts.grossWeightKg != null && opts.grossWeightKg > 0 ? opts.grossWeightKg : (tpl.typicalGrossKg ?? 5);
  return createYieldTest({
    name: opts.name?.trim() || tpl.name,
    productId: opts.productId,
    date: opts.date,
    grossWeightKg: gross,
    purchasePricePerKg: opts.purchasePricePerKg,
    thawLossPct: tpl.thawLossPct,
    cookingLossPct: tpl.cookingLossPct,
    portionKg: tpl.portionKg,
    outputs: outputsFromTemplate(tpl, gross),
  });
}
