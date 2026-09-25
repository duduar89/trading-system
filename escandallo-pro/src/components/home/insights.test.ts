import { describe, expect, it } from 'vitest';
import type { BusinessSettings, Dish, DishCost, Invoice, MenuScan, PricePoint, Product, RecipeItem, YieldTest } from '../../types';
import { DEFAULT_BUSINESS_SETTINGS } from '../../db';
import { buildCostingContext, costAllDishes } from '../../core/costing';
import {
  bucketStatus,
  countByStatus,
  dishFoodCostRows,
  dishStatus,
  dishWasteRows,
  dishesNeedingAttention,
  fillMonths,
  foodCostScale,
  lastMonthSpend,
  onboardingSteps,
  parseBucketLabel,
  prettyBucketLabel,
  priceSeries,
  priceSummary,
  productWasteRows,
  productsInUse,
  reviewQueue,
  simulationRows,
  simulationSummary,
  topWithOther,
} from './insights';

const business: BusinessSettings = { ...DEFAULT_BUSINESS_SETTINGS, targetFoodCostPct: 30, warningFoodCostPct: 35, defaultSaleVatPct: 10, priceRounding: 0.5 };
const T = '2026-09-01T10:00:00.000Z';

function product(p: Partial<Product> & { id: string; name: string }): Product {
  return {
    searchKey: p.name.toLowerCase(),
    aliases: [],
    category: 'otros',
    baseUnit: 'kg',
    pricePerBase: 10,
    priceSource: 'manual',
    wastePct: 0,
    cookingLossPct: 0,
    allergens: [],
    createdAt: T,
    updatedAt: T,
    ...p,
  };
}

function item(productId: string, quantity: number, extra: Partial<RecipeItem> = {}): RecipeItem {
  return { id: `${productId}-${quantity}`, name: productId, ref: { type: 'product', id: productId }, quantity, unit: 'kg', basis: 'neta', ...extra };
}

function dish(d: Partial<Dish> & { id: string; name: string }): Dish {
  return { kind: 'plato', saleVatPct: 10, portions: 1, items: [], status: 'revisado', source: 'manual', createdAt: T, updatedAt: T, ...d };
}

const products = [
  product({ id: 'solomillo', name: 'Solomillo', pricePerBase: 30, wastePct: 20, cookingLossPct: 25, category: 'carne' }),
  product({ id: 'patata', name: 'Patata', pricePerBase: 1, wastePct: 15, category: 'verdura' }),
  product({ id: 'aceite', name: 'Aceite', baseUnit: 'l', pricePerBase: 5, category: 'aceite' }),
  product({ id: 'rape', name: 'Rape', pricePerBase: 20, wastePct: 0, category: 'pescado', yieldTestId: 'yt1' }),
];
const yieldTests: YieldTest[] = [
  {
    id: 'yt1',
    name: 'Rape',
    date: '2026-09-01',
    grossWeightKg: 10,
    purchasePricePerKg: 18,
    outputs: [
      { id: 'o1', name: 'Lomos', weightKg: 5, kind: 'principal' },
      { id: 'o2', name: 'Espinas', weightKg: 2, kind: 'subproducto', valuePerKg: 2 },
      { id: 'o3', name: 'Piel', weightKg: 3, kind: 'desperdicio' },
    ],
    cookingLossPct: 10,
    createdAt: T,
    updatedAt: T,
  },
];
const dishes: Dish[] = [
  // Coste 0,2 kg neto / 0,8 · 30 = 7,50 € → PVP 22 € (20 € sin IVA) → FC 37,5 % (rojo)
  dish({ id: 'd-solomillo', name: 'Solomillo', menuPrice: 22, items: [item('solomillo', 0.2)], unitsSold: 40 }),
  // Coste 0,15 · 30 / 0,8 = 5,625 € → PVP 19,8 € (18 sin IVA) → FC 31,25 % (ámbar)
  dish({ id: 'd-tapa', name: 'Tapa de solomillo', menuPrice: 19.8, items: [item('solomillo', 0.15)] }),
  // Coste 0,3/0,85 · 1 + 0,05 · 5 = 0,6029 € → PVP 6,6 (6 sin IVA) → FC ≈ 10 % (verde)
  dish({ id: 'd-bravas', name: 'Bravas', menuPrice: 6.6, items: [item('patata', 0.3), item('aceite', 0.05, { unit: 'l' })], unitsSold: 120 }),
  // Sin PVP: no entra en el ranking de food cost
  dish({ id: 'd-sinpvp', name: 'Sin PVP', items: [item('patata', 0.2)] }),
  // Elaboración: no es plato de carta
  dish({ id: 'd-fondo', name: 'Fondo', kind: 'elaboracion', items: [item('patata', 1)], status: 'borrador' }),
  // Borrador con líneas propuestas
  dish({ id: 'd-borrador', name: 'Croquetas', menuPrice: 9, status: 'borrador', items: [item('patata', 0.1, { suggested: true }), item('aceite', 0.02, { unit: 'l', suggested: true })] }),
];

function costs(): Map<string, DishCost> {
  return costAllDishes(buildCostingContext(products, dishes, yieldTests, business));
}

describe('semáforo', () => {
  it('dishStatus respeta el objetivo propio del plato desplazando el umbral', () => {
    expect(dishStatus({ foodCostPct: 33, targetFoodCostPct: 30 }, business)).toBe('warn');
    expect(dishStatus({ foodCostPct: 36, targetFoodCostPct: 30 }, business)).toBe('bad');
    // Objetivo propio 25 % → ámbar hasta 30 %
    expect(dishStatus({ foodCostPct: 29, targetFoodCostPct: 25 }, business)).toBe('warn');
    expect(dishStatus({ foodCostPct: 31, targetFoodCostPct: 25 }, business)).toBe('bad');
    expect(dishStatus({ foodCostPct: undefined, targetFoodCostPct: 30 }, business)).toBe('none');
  });
  it('foodCostScale deja aire y sitúa objetivo y umbral', () => {
    const s = foodCostScale(28, business);
    expect(s.max).toBe(60);
    expect(s.targetPos).toBeCloseTo(0.5);
    expect(s.warnPos).toBeCloseTo(35 / 60);
    expect(s.pos).toBeCloseTo(28 / 60);
    expect(foodCostScale(90, business).max).toBe(95);
    expect(foodCostScale(undefined, business).pos).toBe(0);
  });
});

describe('dishFoodCostRows', () => {
  it('solo platos con PVP y coste, ordenados de mayor a menor food cost', () => {
    const rows = dishFoodCostRows(dishes, costs(), business);
    expect(rows.map((r) => r.id)).toEqual(['d-solomillo', 'd-tapa', 'd-bravas', 'd-borrador']);
    const sol = rows[0]!;
    expect(sol.foodCostPct).toBeCloseTo(37.5, 5);
    expect(sol.status).toBe('bad');
    // Permitido: 20 € · 30 % = 6 € → exceso 1,50 €
    expect(sol.excessCost).toBeCloseTo(1.5, 5);
    expect(rows[1]!.status).toBe('warn');
    expect(rows[3]!.status).toBe('ok');
    expect(rows[3]!.excessCost).toBe(0);
  });
  it('cuenta por semáforo y prioriza los rojos', () => {
    const rows = dishFoodCostRows(dishes, costs(), business);
    expect(countByStatus(rows)).toEqual({ ok: 2, warn: 1, bad: 1, total: 4 });
    expect(dishesNeedingAttention(rows).map((r) => r.id)).toEqual(['d-solomillo', 'd-tapa']);
  });
});

describe('tramos', () => {
  it('interpreta etiquetas en varios formatos', () => {
    expect(parseBucketLabel('<25')).toEqual({ min: 0, max: 25 });
    expect(parseBucketLabel('25-30')).toEqual({ min: 25, max: 30 });
    expect(parseBucketLabel('30–35 %')).toEqual({ min: 30, max: 35 });
    expect(parseBucketLabel('>40')).toEqual({ min: 40, max: 50 });
    expect(parseBucketLabel('sin datos')).toBeUndefined();
  });
  it('etiquetas legibles', () => {
    expect(prettyBucketLabel('<25')).toBe('< 25 %');
    expect(prettyBucketLabel('25-30')).toBe('25–30 %');
    expect(prettyBucketLabel('>40')).toBe('> 40 %');
    expect(prettyBucketLabel('otro')).toBe('otro');
  });
  it('colorea según el punto medio', () => {
    expect(bucketStatus('<25', business)).toBe('ok');
    expect(bucketStatus('25-30', business)).toBe('ok');
    expect(bucketStatus('30-35', business)).toBe('warn');
    expect(bucketStatus('35-40', business)).toBe('bad');
    expect(bucketStatus('>40', business)).toBe('bad');
    expect(bucketStatus('?', business)).toBe('none');
  });
});

describe('gasto', () => {
  it('lastMonthSpend compara con el mes natural anterior', () => {
    const t = lastMonthSpend(
      [
        { month: '2026-07', total: 1000 },
        { month: '2026-09', total: 1200 },
        { month: '2026-08', total: 800 },
      ],
      '2026-09',
    )!;
    expect(t.month).toBe('2026-09');
    expect(t.previousTotal).toBe(800);
    expect(t.changePct).toBeCloseTo(50);
    expect(t.inProgress).toBe(true);
  });
  it('sin mes anterior no hay tendencia', () => {
    const t = lastMonthSpend([
      { month: '2026-05', total: 500 },
      { month: '2026-07', total: 900 },
    ])!;
    expect(t.previousMonth).toBe('2026-06');
    expect(t.changePct).toBeUndefined();
    expect(t.inProgress).toBe(false);
    expect(lastMonthSpend([])).toBeUndefined();
    expect(lastMonthSpend([{ month: '2026-05', total: 0 }])).toBeUndefined();
  });
  it('fillMonths rellena huecos', () => {
    expect(
      fillMonths([
        { month: '2026-11', total: 5 },
        { month: '2027-02', total: 7 },
      ]).map((m) => `${m.month}:${m.total}`),
    ).toEqual(['2026-11:5', '2026-12:0', '2027-01:0', '2027-02:7']);
    expect(fillMonths([{ month: '2026-01', total: 3 }])).toHaveLength(1);
  });
  it('topWithOther agrupa la cola', () => {
    const items = [5, 1, 9, 3, 7].map((total, i) => ({ label: `c${i}`, total }));
    const out = topWithOther(items, 3, (total, count) => ({ label: `Otros (${count})`, total }));
    expect(out.map((o) => o.label)).toEqual(['c2', 'c4', 'Otros (3)']);
    expect(out[2]!.total).toBe(9);
    expect(topWithOther(items, 10, (total) => ({ label: 'x', total }))).toHaveLength(5);
  });
});

describe('onboardingSteps', () => {
  it('marca pasos y sugiere el siguiente', () => {
    const empty = onboardingSteps({ invoiceCount: 0, productCount: 0, menuScanCount: 0, dishCount: 0, reviewedDishCount: 0 });
    expect(empty.doneCount).toBe(0);
    expect(empty.next?.key).toBe('facturas');
    expect(empty.steps[0]!.to).toBe('/facturas?nuevo=1');
    const half = onboardingSteps({ invoiceCount: 2, productCount: 0, menuScanCount: 0, dishCount: 3, reviewedDishCount: 0 });
    expect(half.doneCount).toBe(2);
    expect(half.progress).toBeCloseTo(2 / 3);
    expect(half.next?.key).toBe('escandallos');
    const all = onboardingSteps({ invoiceCount: 0, productCount: 5, menuScanCount: 1, dishCount: 3, reviewedDishCount: 1 });
    expect(all.next).toBeUndefined();
  });
});

describe('reviewQueue', () => {
  it('agrupa facturas, cartas y platos pendientes con prioridad', () => {
    const invoices = [
      { id: 'i1', supplierName: 'Makro', date: '2026-09-20', status: 'revision', lines: [{ id: 'l1', matchStatus: 'nuevo' }, { id: 'l2', matchStatus: 'vinculado' }], createdAt: T },
      { id: 'i2', supplierName: '', fileName: 'foto.jpg', date: '2026-09-21', status: 'error', error: 'imagen ilegible', lines: [], createdAt: T },
      { id: 'i3', supplierName: 'Otro', date: '2026-09-22', status: 'confirmada', lines: [], createdAt: T },
    ] as unknown as Invoice[];
    const scans = [{ id: 's1', name: 'Carta verano', images: [], status: 'revision', entries: [{ id: 'e1' }, { id: 'e2' }], createdAt: T }] as unknown as MenuScan[];
    const q = reviewQueue(invoices, dishes, scans);
    expect(q.map((r) => `${r.kind}:${r.id}`)).toEqual(['factura:i2', 'factura:i1', 'carta:s1', 'plato:d-borrador']);
    expect(q[0]!.subtitle).toContain('imagen ilegible');
    expect(q[0]!.title).toBe('foto.jpg');
    expect(q[1]!.subtitle).toBe('2 líneas · 1 por confirmar');
    expect(q[2]!.subtitle).toBe('2 platos detectados por importar');
    expect(q[3]!.subtitle).toBe('2 ingredientes propuestos sin revisar');
    expect(q[3]!.to).toBe('/platos/d-borrador');
  });
});

describe('mermas', () => {
  it('dishWasteRows ordena por coste de merma por ración', () => {
    const rows = dishWasteRows(dishes, costs());
    expect(rows[0]!.id).toBe('d-solomillo');
    // Bruto 0,25 kg, servido 0,15 kg → 40 % de merma en peso
    expect(rows[0]!.wastePct).toBeCloseTo(40, 5);
    expect(rows[0]!.periodWasteCost).toBeCloseTo(rows[0]!.wasteCostPerPortion * 40, 5);
    expect(rows.find((r) => r.id === 'd-fondo')).toBeUndefined();
    expect(dishWasteRows(dishes, costs(), ['elaboracion']).map((r) => r.id)).toEqual(['d-fondo']);
  });
  it('productWasteRows usa la prueba de rendimiento cuando existe', () => {
    const rows = productWasteRows(products, yieldTests, dishes);
    const rape = rows.find((r) => r.id === 'rape')!;
    expect(rape.source).toBe('prueba');
    expect(rape.cleaningPct).toBeCloseTo(50, 5);
    // (10 kg · 20 € − 2 kg · 2 €) / 5 kg = 39,2 €/kg útil
    expect(rape.realPricePerUsable).toBeCloseTo(39.2, 5);
    expect(rape.totalLossPct).toBeCloseTo(55, 5);
    const sol = rows.find((r) => r.id === 'solomillo')!;
    expect(sol.source).toBe('producto');
    expect(sol.lossPerBase).toBeCloseTo(6, 5);
    expect(sol.realPricePerUsable).toBeCloseTo(37.5, 5);
    expect(sol.usedInDishes).toBe(2);
    expect(rows.find((r) => r.id === 'aceite')).toBeUndefined();
    expect(rows[0]!.id).toBe('rape');
  });
});

describe('precios', () => {
  const pts: PricePoint[] = [
    { id: 'b', productId: 'x', date: '2026-08-01', pricePerBase: 10, source: 'factura' },
    { id: 'a', productId: 'x', date: '2026-07-01', pricePerBase: 8, source: 'factura' },
    { id: 'c1', productId: 'x', date: '2026-09-01', pricePerBase: 11, source: 'factura' },
    { id: 'c2', productId: 'x', date: '2026-09-01', pricePerBase: 12, source: 'manual' },
    { id: 'z', productId: 'x', date: '2026-09-02', pricePerBase: 0, source: 'manual' },
  ];
  it('priceSeries ordena, ignora precios nulos y deja el último del día', () => {
    expect(priceSeries(pts).map((p) => `${p.date}:${p.price}`)).toEqual(['2026-07-01:8', '2026-08-01:10', '2026-09-01:12']);
  });
  it('priceSummary', () => {
    const s = priceSummary(priceSeries(pts))!;
    expect(s.min).toBe(8);
    expect(s.max).toBe(12);
    expect(s.avg).toBeCloseTo(10);
    expect(s.changePct).toBeCloseTo(50);
    expect(s.changeAbs).toBe(4);
    expect(priceSummary([])).toBeUndefined();
  });
});

describe('simulador', () => {
  it('ordena por impacto y resume cambios de semáforo', () => {
    const before = costs();
    const expensive = products.map((p) => (p.id === 'solomillo' ? { ...p, pricePerBase: 24 } : p));
    const after = costAllDishes(buildCostingContext(expensive, dishes, yieldTests, business));
    const sim = ['d-solomillo', 'd-tapa'].map((id) => ({ dishId: id, name: dishes.find((d) => d.id === id)!.name, before: before.get(id)!, after: after.get(id)! }));
    const rows = simulationRows(sim, dishes, business);
    expect(rows[0]!.dishId).toBe('d-solomillo');
    expect(rows[0]!.deltaCost).toBeCloseTo(-1.5, 5);
    expect(rows[0]!.statusBefore).toBe('bad');
    expect(rows[0]!.statusAfter).toBe('ok');
    expect(rows[1]!.statusAfter).toBe('ok');
    const sum = simulationSummary(rows);
    expect(sum).toMatchObject({ affected: 2, improved: 2, worsened: 0 });
    expect(sum.avgDeltaFc).toBeLessThan(0);
  });
  it('productsInUse cuenta platos distintos que usan cada producto', () => {
    const used = productsInUse(products, dishes);
    expect(used[0]!.product.id).toBe('patata');
    expect(used[0]!.uses).toBe(4);
    expect(used.find((u) => u.product.id === 'rape')).toBeUndefined();
  });
});
