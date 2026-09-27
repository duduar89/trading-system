// Cambio de unidad de compra de un ingrediente (kg ⇄ ud ⇄ l): conversión del precio y del histórico, histórico no
// convertible fuera de alertas y gráficos, pruebas de rendimiento y fusión de duplicados.
import { beforeEach, describe, expect, it } from 'vitest';
import type { PricePoint, Product, YieldTest } from '../src/types';
import { createWorkspace, db, setCurrentWorkspaceId } from '../src/db';
import { toSearchKey } from '../src/core/matching';
import { priceAlerts } from '../src/core/analytics';
import { comparablePricePoints, isInProductUnit, pointUnit } from '../src/core/pricePoints';
import { priceTrends } from '../src/components/purchases/logic';
import { uid } from '../src/lib/id';
import { mergeProducts, planBaseUnitChange, recomputeCurrentPrice, setProductPrice, strictPriceFactor, updateProduct } from '../src/services/products';

const NOW = '2026-01-01T00:00:00.000Z';

function product(p: Partial<Product> & { name: string }): Product {
  return {
    id: uid(),
    searchKey: toSearchKey(p.name),
    aliases: [],
    category: 'otros',
    baseUnit: 'kg',
    pricePerBase: 0,
    priceSource: 'factura',
    wastePct: 0,
    cookingLossPct: 0,
    allergens: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...p,
  };
}

function point(productId: string, date: string, pricePerBase: number, extra: Partial<PricePoint> = {}): PricePoint {
  return { id: `${date}-${uid()}`, productId, date, pricePerBase, source: 'factura', ...extra };
}

async function seed(p: Product, prices: [string, number][]): Promise<Product> {
  await db().products.add(p);
  await db().pricePoints.bulkAdd(prices.map(([d, v]) => point(p.id, d, v)));
  return p;
}

beforeEach(async () => {
  const ws = await createWorkspace({ name: `Unidades ${Math.random()}` });
  setCurrentWorkspaceId(ws.id);
});

describe('strictPriceFactor', () => {
  it('exige el dato real para convertir (sin suponer densidad 1)', () => {
    expect(strictPriceFactor('kg', 'ud', { unitWeightKg: 0.25 })).toEqual({ factor: 0.25 });
    expect(strictPriceFactor('ud', 'kg', { unitWeightKg: 0.25 })).toEqual({ factor: 4 });
    expect(strictPriceFactor('l', 'kg', {})).toEqual({ missing: 'densityKgPerL' });
    expect(strictPriceFactor('kg', 'ud', {})).toEqual({ missing: 'unitWeightKg' });
    expect(strictPriceFactor('ud', 'l', {})).toEqual({ missing: 'both' });
    expect(strictPriceFactor('ud', 'l', { unitWeightKg: 0.5 })).toEqual({ missing: 'densityKgPerL' });
    const oil = strictPriceFactor('l', 'kg', { densityKgPerL: 0.92 });
    expect('factor' in oil && oil.factor).toBeCloseTo(1 / 0.92);
    // 1 botella de 0,75 kg de un líquido de densidad 1,5 = 0,5 l → 6 €/ud = 12 €/l
    const bottle = strictPriceFactor('ud', 'l', { unitWeightKg: 0.75, densityKgPerL: 1.5 });
    expect('factor' in bottle && 6 * bottle.factor).toBeCloseTo(12);
  });
});

describe('planBaseUnitChange', () => {
  it('convertible: precio vigente e histórico', () => {
    const p = product({ name: 'Lomo', pricePerBase: 12, unitWeightKg: 0.25 });
    const plan = planBaseUnitChange(p, 'ud', [point(p.id, '2026-01-10', 10), point(p.id, '2026-02-10', 12)]);
    expect(plan.convertible).toBe(true);
    expect(plan.newPrice).toBe(3);
    expect(plan.convertedPoints).toBe(2);
    expect(plan.pointUpdates.map((x) => x.pricePerBase)).toEqual([2.5, 3]);
  });
  it('no convertible: sin precio y el histórico marcado con su unidad', () => {
    const p = product({ name: 'Lomo', pricePerBase: 12 });
    const plan = planBaseUnitChange(p, 'ud', [point(p.id, '2026-01-10', 12)]);
    expect(plan.convertible).toBe(false);
    expect(plan.missing).toBe('unitWeightKg');
    expect(plan.newPrice).toBe(0);
    expect(plan.keptPoints).toBe(1);
    expect(plan.pointUpdates[0].baseUnit).toBe('kg');
  });
  it('usa el peso indicado en el aviso aunque el producto aún no lo tenga', () => {
    const p = product({ name: 'Lomo', pricePerBase: 12 });
    const plan = planBaseUnitChange(p, 'ud', [], { unitWeightKg: 0.5 });
    expect(plan.convertible).toBe(true);
    expect(plan.newPrice).toBe(6);
  });
});

describe('updateProduct: cambio de unidad', () => {
  it('kg → ud con peso por unidad convierte precio e histórico', async () => {
    const p = await seed(product({ name: 'Aguacate', pricePerBase: 4, unitWeightKg: 0.2 }), [
      ['2026-01-05', 3.5],
      ['2026-02-05', 4],
    ]);
    await updateProduct(p.id, { baseUnit: 'ud' });
    const after = (await db().products.get(p.id))!;
    expect(after.baseUnit).toBe('ud');
    expect(after.pricePerBase).toBeCloseTo(0.8);
    expect(after.priceSource).toBe('factura');
    const pts = await db().pricePoints.where('productId').equals(p.id).sortBy('date');
    expect(pts.map((x) => x.pricePerBase)).toEqual([0.7, 0.8]);
    expect(pts.every((x) => !x.baseUnit)).toBe(true);
  });

  it('l → kg con densidad y ud → l con peso y densidad', async () => {
    const oil = await seed(product({ name: 'Aceite de oliva', baseUnit: 'l', pricePerBase: 4.6, densityKgPerL: 0.92 }), [['2026-02-01', 4.6]]);
    await updateProduct(oil.id, { baseUnit: 'kg' });
    expect((await db().products.get(oil.id))!.pricePerBase).toBeCloseTo(5);
    const wine = await seed(product({ name: 'Vino', baseUnit: 'ud', pricePerBase: 6, unitWeightKg: 0.75, densityKgPerL: 1 }), [['2026-02-01', 6]]);
    await updateProduct(wine.id, { baseUnit: 'l' });
    expect((await db().products.get(wine.id))!.pricePerBase).toBeCloseTo(8);
  });

  it('el peso que llega en el mismo cambio sirve para convertir', async () => {
    const p = await seed(product({ name: 'Lechuga', pricePerBase: 2.4 }), [['2026-02-01', 2.4]]);
    await updateProduct(p.id, { baseUnit: 'ud', unitWeightKg: 0.5 });
    const after = (await db().products.get(p.id))!;
    expect(after.unitWeightKg).toBe(0.5);
    expect(after.pricePerBase).toBeCloseTo(1.2);
  });

  it('sin dato para convertir: se queda sin precio y el histórico en kg no entra en alertas ni tendencias', async () => {
    const p = await seed(product({ name: 'Piña', pricePerBase: 2, lastPurchaseDate: '2026-02-01' }), [
      ['2026-01-01', 1.8],
      ['2026-02-01', 2],
    ]);
    await updateProduct(p.id, { baseUnit: 'ud' });
    let after = (await db().products.get(p.id))!;
    expect(after.pricePerBase).toBe(0);
    expect(after.priceSource).toBe('manual');
    expect(after.lastPurchaseDate).toBeUndefined();
    let pts = await db().pricePoints.where('productId').equals(p.id).toArray();
    expect(pts).toHaveLength(2);
    expect(pts.every((x) => x.baseUnit === 'kg' && !isInProductUnit(x, after))).toBe(true);
    // Primer precio por unidad: 3 €/ud. Sin la marca sería una «subida» del 50 % frente a 2 €/kg.
    await setProductPrice(p.id, 3, 'manual', { date: '2026-03-01' });
    after = (await db().products.get(p.id))!;
    pts = await db().pricePoints.where('productId').equals(p.id).toArray();
    expect(after.pricePerBase).toBe(3);
    expect(priceAlerts([after], pts, 5)).toHaveLength(0);
    const comparable = comparablePricePoints(pts, [after]);
    expect(comparable).toHaveLength(1);
    expect(priceTrends(comparable).get(p.id)?.changePct).toBeUndefined();
    // Al borrar ese precio, el vigente no vuelve a ser el de 2 €/kg
    await db().pricePoints.where('productId').equals(p.id).and((x) => !x.baseUnit).delete();
    await recomputeCurrentPrice(p.id);
    expect((await db().products.get(p.id))!.pricePerBase).toBe(3);
  });

  it('volver a la unidad anterior recupera el histórico marcado y su último precio', async () => {
    const p = await seed(product({ name: 'Piña', pricePerBase: 2 }), [['2026-02-01', 2]]);
    await updateProduct(p.id, { baseUnit: 'ud' });
    await setProductPrice(p.id, 3, 'manual', { date: '2026-03-01' });
    await updateProduct(p.id, { baseUnit: 'kg' });
    const after = (await db().products.get(p.id))!;
    expect(after.baseUnit).toBe('kg');
    expect(after.pricePerBase).toBe(2);
    expect(after.lastPurchaseDate).toBe('2026-02-01');
    const pts = await db().pricePoints.where('productId').equals(p.id).toArray();
    const kg = pts.find((x) => x.date === '2026-02-01')!;
    const ud = pts.find((x) => x.date === '2026-03-01')!;
    expect(kg.baseUnit).toBeUndefined();
    expect(ud.baseUnit).toBe('ud');
    expect(pointUnit(ud, 'kg')).toBe('ud');
  });

  it('un precio explícito en el mismo cambio manda sobre el convertido', async () => {
    const p = await seed(product({ name: 'Huevo', pricePerBase: 3, unitWeightKg: 0.06 }), [['2026-02-01', 3]]);
    await updateProduct(p.id, { baseUnit: 'ud', pricePerBase: 0.2 });
    expect((await db().products.get(p.id))!.pricePerBase).toBe(0.2);
  });

  it('las pruebas de rendimiento fijan el último €/kg al dejar de comprarse por kg', async () => {
    const p = await seed(product({ name: 'Merluza', pricePerBase: 9.5 }), [['2026-02-01', 9.5]]);
    const test: YieldTest = {
      id: uid(),
      name: 'Merluza entera',
      productId: p.id,
      date: '2026-02-02',
      grossWeightKg: 2,
      purchasePricePerKg: 8,
      outputs: [],
      cookingLossPct: 0,
      notes: 'Pieza de 2 kg',
      createdAt: NOW,
      updatedAt: NOW,
    };
    await db().yieldTests.add(test);
    await db().products.update(p.id, { yieldTestId: test.id, unitWeightKg: 2 });
    await updateProduct(p.id, { baseUnit: 'ud' });
    const t = (await db().yieldTests.get(test.id))!;
    expect(t.purchasePricePerKg).toBe(9.5);
    expect(t.notes).toContain('Pieza de 2 kg');
    expect(t.notes).toContain('pasa a comprarse por unidad');
    expect((await db().products.get(p.id))!.pricePerBase).toBeCloseTo(19);
  });

  it('sin cambio real de unidad no toca nada', async () => {
    const p = await seed(product({ name: 'Sal', pricePerBase: 0.6 }), [['2026-02-01', 0.6]]);
    await updateProduct(p.id, { baseUnit: 'kg', wastePct: 0 });
    const pts = await db().pricePoints.where('productId').equals(p.id).toArray();
    expect(pts[0].pricePerBase).toBe(0.6);
    expect((await db().products.get(p.id))!.pricePerBase).toBe(0.6);
  });
});

describe('mergeProducts con histórico en otra unidad', () => {
  it('convierte desde la unidad de cada precio o lo conserva marcado', async () => {
    const keep = await seed(product({ name: 'Limón', pricePerBase: 2 }), [['2026-02-01', 2]]);
    const remove = product({ name: 'Limones malla', baseUnit: 'ud', pricePerBase: 0.3, unitWeightKg: 0.15 });
    await db().products.add(remove);
    await db().pricePoints.bulkAdd([
      point(remove.id, '2026-01-01', 0.3),
      point(remove.id, '2025-12-01', 1.9, { baseUnit: 'kg' }),
      point(remove.id, '2025-11-01', 1.5, { baseUnit: 'l' }),
    ]);
    await mergeProducts(keep.id, remove.id);
    const pts = await db().pricePoints.where('productId').equals(keep.id).sortBy('date');
    const byDate = new Map(pts.map((x) => [x.date, x]));
    expect(byDate.get('2026-01-01')!.pricePerBase).toBeCloseTo(2);
    expect(byDate.get('2025-12-01')!.pricePerBase).toBe(1.9);
    expect(byDate.get('2025-12-01')!.baseUnit).toBeUndefined();
    // l → kg sin densidad del producto: la conversión laxa de la fusión supone 1 kg/l
    expect(byDate.get('2025-11-01')!.baseUnit).toBeUndefined();
  });
});
