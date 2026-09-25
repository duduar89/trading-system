import { describe, expect, it } from 'vitest';
import type { BusinessSettings, Dish, DishCost, Invoice, InvoiceLine, PricePoint, Product, RecipeItem } from '../types';
import { FOOD_COST_BUCKETS, dashboardStats, dishesUsingProduct, menuEngineering, priceAlerts, simulatePriceChange } from './analytics';
import { buildCostingContext, costDish } from './costing';

const business: BusinessSettings = {
  id: 'business',
  targetFoodCostPct: 30,
  warningFoodCostPct: 35,
  defaultSaleVatPct: 10,
  priceAlertPct: 5,
  currency: 'EUR',
  priceRounding: 0.5,
};

function product(p: Partial<Product> & Pick<Product, 'id' | 'name'>): Product {
  return {
    searchKey: p.name.toLowerCase(),
    aliases: [],
    category: 'otros',
    baseUnit: 'kg',
    pricePerBase: 1,
    priceSource: 'factura',
    wastePct: 0,
    cookingLossPct: 0,
    allergens: [],
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...p,
  };
}

function item(p: Partial<RecipeItem> & Pick<RecipeItem, 'id'>): RecipeItem {
  return { name: p.id, quantity: 0, unit: 'g', basis: 'neta', ...p };
}

function dish(p: Partial<Dish> & Pick<Dish, 'id'>): Dish {
  return {
    name: p.id,
    kind: 'plato',
    saleVatPct: 10,
    portions: 1,
    items: [],
    status: 'revisado',
    source: 'manual',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...p,
  };
}

/** DishCost mínimo con los campos que usa la analítica. */
function cost(dishId: string, c: Partial<DishCost> & { costPerPortion: number }): DishCost {
  const net = c.netPrice;
  return {
    dishId,
    totalCost: c.costPerPortion,
    targetFoodCostPct: 30,
    grossKgPerPortion: 0,
    servedKgPerPortion: 0,
    wasteKgPerPortion: 0,
    wastePct: 0,
    wasteCostPerPortion: 0,
    totalWasteKg: 0,
    items: [{ itemId: 'x' } as DishCost['items'][number]],
    completeness: 1,
    allergens: [],
    warnings: [],
    ...(net ? { foodCostPct: (c.costPerPortion / net) * 100, grossMargin: net - c.costPerPortion } : {}),
    ...c,
  };
}

describe('menuEngineering', () => {
  const dishes = [
    dish({ id: 'A', name: 'Solomillo', section: 'Carnes', menuPrice: 22, unitsSold: 100 }),
    dish({ id: 'B', name: 'Ensalada', section: 'Entrantes', menuPrice: 11, unitsSold: 150 }),
    dish({ id: 'C', name: 'Rodaballo', section: 'Pescados', menuPrice: 27.5, unitsSold: 20 }),
    dish({ id: 'D', name: 'Croquetas', section: 'Entrantes', menuPrice: 13.2, unitsSold: 10 }),
    dish({ id: 'E', name: 'Fondo oscuro', kind: 'elaboracion', unitsSold: 999 }),
    dish({ id: 'F', name: 'Sin PVP', unitsSold: 50 }),
    dish({ id: 'G', name: 'Sin coste', menuPrice: 10, unitsSold: 50 }),
  ];
  const costs = new Map<string, DishCost>([
    ['A', cost('A', { costPerPortion: 6, netPrice: 20 })],
    ['B', cost('B', { costPerPortion: 4, netPrice: 10 })],
    ['C', cost('C', { costPerPortion: 7, netPrice: 25 })],
    ['D', cost('D', { costPerPortion: 6, netPrice: 12 })],
    ['E', cost('E', { costPerPortion: 3 })],
    ['F', cost('F', { costPerPortion: 2 })],
    ['G', cost('G', { costPerPortion: 0, netPrice: 10 / 1.1 })],
  ]);

  it('clasifica con la matriz de Kasavana & Smith', () => {
    const r = menuEngineering(dishes, costs);
    expect(r.hasVolumeData).toBe(true);
    expect(r.popularityThresholdPct).toBeCloseTo(17.5, 10); // 70 % × 100 / 4
    expect(r.avgMargin).toBeCloseTo(2720 / 280, 10); // ponderado por ventas
    expect(r.rows.map((x) => [x.dishId, x.class])).toEqual([
      ['A', 'estrella'],
      ['B', 'caballo'],
      ['C', 'enigma'],
      ['D', 'perro'],
    ]);
    const a = r.rows[0];
    expect(a.mixPct).toBeCloseTo((100 / 280) * 100, 10);
    expect(a.contributionMargin).toBeCloseTo(14, 10);
    expect(a.totalMargin).toBeCloseTo(1400, 10);
    expect(a.popularity).toBe('alta');
    expect(a.profitability).toBe('alta');
    expect(a.foodCostPct).toBeCloseTo(30, 10);
    expect(a.section).toBe('Carnes');
    expect(r.rows.reduce((s, x) => s + x.mixPct, 0)).toBeCloseTo(100, 10);
  });

  it('sin datos de ventas: 1 venta por plato y sólo cuenta el margen', () => {
    const noSales = dishes.map((d) => ({ ...d, unitsSold: undefined }));
    const r = menuEngineering(noSales, costs);
    expect(r.hasVolumeData).toBe(false);
    expect(r.avgMargin).toBeCloseTo((14 + 6 + 18 + 6) / 4, 10);
    expect(Object.fromEntries(r.rows.map((x) => [x.dishId, x.class]))).toEqual({ A: 'estrella', B: 'caballo', C: 'estrella', D: 'caballo' });
    expect(r.rows.every((x) => x.unitsSold === 1 && x.popularity === 'alta')).toBe(true);
  });

  it('con ventas parciales, los platos sin ventas cuentan como 0', () => {
    const partial = dishes.map((d) => (d.id === 'C' ? { ...d, unitsSold: undefined } : d));
    const c = menuEngineering(partial, costs).rows.find((x) => x.dishId === 'C');
    expect(c?.unitsSold).toBe(0);
    expect(c?.popularity).toBe('baja');
    expect(c?.class).toBe('enigma');
  });

  it('calcula el PVP sin IVA si el coste no lo trae', () => {
    const d = [dish({ id: 'X', menuPrice: 11, saleVatPct: 10 })];
    const c = new Map([['X', cost('X', { costPerPortion: 3 })]]);
    const r = menuEngineering(d, c);
    expect(r.rows[0].contributionMargin).toBeCloseTo(7, 10);
    expect(r.rows[0].foodCostPct).toBeCloseTo(30, 10);
  });

  it('sin platos analizables', () => {
    expect(menuEngineering([], new Map())).toEqual({ rows: [], avgMargin: 0, popularityThresholdPct: 0, hasVolumeData: false });
  });
});

describe('priceAlerts', () => {
  const products = [
    product({ id: 'tomate', name: 'Tomate pera' }),
    product({ id: 'aceite', name: 'Aceite de oliva', baseUnit: 'l' }),
    product({ id: 'sal', name: 'Sal' }),
    product({ id: 'nata', name: 'Nata', baseUnit: 'l' }),
    product({ id: 'lomo', name: 'Lomo de cerdo' }),
  ];
  const pp = (productId: string, date: string, pricePerBase: number, id = `${productId}-${date}`): PricePoint => ({
    id,
    productId,
    date,
    pricePerBase,
    source: 'factura',
  });
  const points: PricePoint[] = [
    pp('tomate', '2025-03-10', 2.4),
    pp('tomate', '2025-01-10', 2.0),
    pp('tomate', '2025-02-10', 2.0),
    pp('aceite', '2025-01-05', 6.0),
    pp('aceite', '2025-03-01', 5.4),
    pp('sal', '2025-01-01', 0.5),
    pp('sal', '2025-02-01', 0.51),
    pp('nata', '2025-02-01', 3.2),
    pp('lomo', '2025-01-02', 6.0),
    pp('lomo', '2025-02-02', 6.6),
    pp('lomo', '2025-03-02', 6.6),
    pp('fantasma', '2025-01-01', 1),
    pp('fantasma', '2025-02-01', 9),
    pp('tomate', '2025-03-11', 0),
  ];
  const dishes = [
    dish({ id: 'ensalada', items: [item({ id: 'i', ref: { type: 'product', id: 'tomate' } }), item({ id: 'j', ref: { type: 'product', id: 'tomate' } })] }),
    dish({ id: 'gazpacho', items: [item({ id: 'k', ref: { type: 'product', id: 'tomate' } }), item({ id: 'l', ref: { type: 'product', id: 'aceite' } })] }),
    dish({ id: 'salsa', kind: 'elaboracion', items: [item({ id: 'm', ref: { type: 'dish', id: 'gazpacho' } })] }),
  ];

  it('compara el último precio con el anterior distinto y ordena por mayor subida', () => {
    const r = priceAlerts(products, points, 5, dishes);
    expect(r.map((a) => [a.productId, Math.round(a.changePct * 100) / 100])).toEqual([
      ['tomate', 20],
      ['lomo', 10],
      ['aceite', -10],
    ]);
    const t = r[0];
    expect(t).toMatchObject({ productName: 'Tomate pera', baseUnit: 'kg', previousPrice: 2, currentPrice: 2.4, previousDate: '2025-02-10', currentDate: '2025-03-10' });
    expect(t.affectedDishIds).toEqual(['ensalada', 'gazpacho']);
    const lomo = r[1];
    expect(lomo.previousDate).toBe('2025-01-02');
    expect(lomo.currentDate).toBe('2025-03-02');
    expect(r[2].affectedDishIds).toEqual(['gazpacho']);
  });

  it('el umbral es inclusivo y se aplica en valor absoluto', () => {
    expect(priceAlerts(products, points, 10).map((a) => a.productId)).toEqual(['tomate', 'lomo', 'aceite']);
    expect(priceAlerts(products, points, 10.01).map((a) => a.productId)).toEqual(['tomate']);
    expect(priceAlerts(products, points, 1).map((a) => a.productId)).toContain('sal');
  });

  it('a igualdad de fecha manda el último registrado', () => {
    const r = priceAlerts(products, [pp('sal', '2025-01-01', 0.5, 'a'), pp('sal', '2025-01-01', 0.6, 'b')], 5);
    expect(r[0]).toMatchObject({ previousPrice: 0.5, currentPrice: 0.6 });
  });

  it('sin histórico suficiente no hay alertas', () => {
    expect(priceAlerts(products, [], 5)).toEqual([]);
    expect(priceAlerts(products, [pp('tomate', '2025-01-01', 2), pp('tomate', '2025-02-01', 2)], 0)).toEqual([]);
  });
});

describe('dashboardStats', () => {
  const dishes = [
    dish({ id: 'P1', menuPrice: 22, unitsSold: 10 }),
    dish({ id: 'P2', menuPrice: 11, unitsSold: 30 }),
    dish({ id: 'P3', menuPrice: 16.5, unitsSold: 0 }),
    dish({ id: 'P4' }),
    dish({ id: 'E', kind: 'elaboracion' }),
  ];
  const costs = new Map<string, DishCost>([
    ['P1', cost('P1', { costPerPortion: 5, netPrice: 20, grossKgPerPortion: 0.4, wastePct: 20 })],
    ['P2', cost('P2', { costPerPortion: 3.3, netPrice: 10, grossKgPerPortion: 0.3, wastePct: 10 })],
    ['P3', cost('P3', { costPerPortion: 6, netPrice: 15, completeness: 0.5 })],
    ['P4', cost('P4', { costPerPortion: 2, grossKgPerPortion: 0.2, wastePct: 30 })],
    ['E', cost('E', { costPerPortion: 1, grossKgPerPortion: 1, wastePct: 90 })],
  ]);
  const products = [
    product({ id: 'tomate', name: 'Tomate', category: 'verdura' }),
    product({ id: 'aceite', name: 'Aceite de oliva', category: 'aceite', baseUnit: 'l' }),
    product({ id: 'sin', name: 'Sin precio', pricePerBase: 0 }),
  ];
  const line = (p: Partial<InvoiceLine> & { total: number }): InvoiceLine => ({
    id: Math.random().toString(36).slice(2),
    description: 'x',
    quantity: 1,
    unit: 'ud',
    unitPrice: p.total,
    matchStatus: 'vinculado',
    ...p,
  });
  const invoice = (p: Partial<Invoice> & Pick<Invoice, 'id' | 'status' | 'date'>): Invoice => ({
    supplierName: 'Proveedor',
    lines: [],
    createdAt: '2025-01-01',
    ...p,
  });
  const invoices: Invoice[] = [
    invoice({
      id: 'I1',
      status: 'confirmada',
      date: '2025-01-15',
      supplierName: 'Frutas Paco',
      subtotal: 100,
      lines: [line({ productId: 'tomate', total: 60 }), line({ productId: 'aceite', total: 40 })],
    }),
    invoice({
      id: 'I2',
      status: 'confirmada',
      date: '2025-02-03',
      supplierName: ' Makro ',
      lines: [
        line({ productId: 'tomate', total: 30 }),
        line({ suggestedCategory: 'lacteo', total: 0, quantity: 4, unitPrice: 5 }),
        line({ total: 5, matchStatus: 'ignorado' }),
      ],
    }),
    invoice({ id: 'I3', status: 'revision', date: '2025-02-10', supplierName: 'Frutas Paco', subtotal: 999, lines: [line({ productId: 'tomate', total: 999 })] }),
    invoice({ id: 'I4', status: 'pendiente', date: '2025-02-11' }),
    invoice({ id: 'I5', status: 'error', date: '2025-02-12' }),
    invoice({ id: 'I6', status: 'confirmada', date: '2024-12-20', supplierName: '', subtotal: 10, lines: [line({ productId: 'borrado', total: 10 })] }),
  ];
  const s = dashboardStats({ dishes, costs, products, invoices, business });

  it('KPIs de platos', () => {
    expect(s.dishCount).toBe(4);
    expect(s.avgFoodCostPct).toBeCloseTo((25 + 33 + 40) / 3, 10);
    // Ponderado por ventas: Σ coste·u / Σ PVP neto·u
    expect(s.weightedFoodCostPct).toBeCloseTo(29.8, 10);
    expect(s.avgMarginEur).toBeCloseTo((15 + 6.7 + 9) / 3, 10);
    expect([s.dishesOk, s.dishesWarn, s.dishesBad, s.dishesNoData]).toEqual([1, 1, 1, 1]);
    expect(s.incompleteDishes).toBe(1);
    expect(s.avgWastePct).toBeCloseTo(20, 10);
    expect(s.foodCostBuckets).toEqual([
      { label: '≤ 25 %', count: 1 },
      { label: '25–30 %', count: 0 },
      { label: '30–35 %', count: 1 },
      { label: '35–40 %', count: 1 },
      { label: '> 40 %', count: 0 },
    ]);
    expect(FOOD_COST_BUCKETS).toHaveLength(5);
  });

  it('productos y facturas', () => {
    expect(s.productCount).toBe(3);
    expect(s.productsWithoutPrice).toBe(1);
    expect(s.invoiceCount).toBe(6);
    expect(s.pendingInvoices).toBe(2);
  });

  it('gasto por mes, categoría, proveedor y producto (sólo confirmadas, sin IVA)', () => {
    expect(s.monthlySpend).toEqual([
      { month: '2024-12', total: 10 },
      { month: '2025-01', total: 100 },
      { month: '2025-02', total: 50 },
    ]);
    expect(s.spendByCategory).toEqual([
      { category: 'verdura', total: 90 },
      { category: 'aceite', total: 40 },
      { category: 'lacteo', total: 20 },
      { category: 'otros', total: 10 },
    ]);
    expect(s.spendBySupplier).toEqual([
      { supplier: 'Frutas Paco', total: 100 },
      { supplier: 'Makro', total: 50 },
      { supplier: 'Sin proveedor', total: 10 },
    ]);
    expect(s.topProductsBySpend).toEqual([
      { productId: 'tomate', name: 'Tomate', total: 90 },
      { productId: 'aceite', name: 'Aceite de oliva', total: 40 },
    ]);
  });

  it('últimos 12 meses con datos y media simple si no hay ventas', () => {
    const many: Invoice[] = Array.from({ length: 14 }, (_, i) =>
      invoice({ id: `M${i}`, status: 'confirmada', date: `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-05`, subtotal: i + 1 }),
    );
    const r = dashboardStats({ dishes: dishes.map((d) => ({ ...d, unitsSold: undefined })), costs, products, invoices: many, business });
    expect(r.monthlySpend).toHaveLength(12);
    expect(r.monthlySpend[0]).toEqual({ month: '2024-03', total: 3 });
    expect(r.monthlySpend[11]).toEqual({ month: '2025-02', total: 14 });
    expect(r.weightedFoodCostPct).toBeCloseTo(r.avgFoodCostPct ?? NaN, 10);
  });

  it('sin datos', () => {
    const r = dashboardStats({ dishes: [], costs: new Map(), products: [], invoices: [], business });
    expect(r.avgFoodCostPct).toBeUndefined();
    expect(r.weightedFoodCostPct).toBeUndefined();
    expect(r.avgWastePct).toBeUndefined();
    expect(r.monthlySpend).toEqual([]);
    expect(r.foodCostBuckets.every((b) => b.count === 0)).toBe(true);
  });
});

describe('simulatePriceChange', () => {
  const products = [
    product({ id: 'tomate', name: 'Tomate', pricePerBase: 2 }),
    product({ id: 'aceite', name: 'Aceite', baseUnit: 'l', pricePerBase: 5, densityKgPerL: 0.92 }),
    product({ id: 'patata', name: 'Patata', pricePerBase: 1 }),
    product({ id: 'sal', name: 'Sal', pricePerBase: 0.4 }),
  ];
  const salsa = dish({
    id: 'salsa',
    name: 'Salsa de tomate',
    kind: 'elaboracion',
    items: [
      item({ id: 't', ref: { type: 'product', id: 'tomate' }, quantity: 1, unit: 'kg', basis: 'bruta' }),
      item({ id: 'a', ref: { type: 'product', id: 'aceite' }, quantity: 100, unit: 'ml' }),
    ],
    yieldQty: 0.8,
    yieldUnit: 'kg',
  });
  const pasta = dish({
    id: 'pasta',
    name: 'Pasta con tomate',
    menuPrice: 11,
    items: [
      item({ id: 's', ref: { type: 'dish', id: 'salsa' }, quantity: 200, unit: 'g' }),
      item({ id: 'p', ref: { type: 'product', id: 'patata' }, quantity: 100, unit: 'g', basis: 'bruta' }),
    ],
  });
  const ensalada = dish({ id: 'ensalada', name: 'Ensalada de tomate', menuPrice: 5.5, items: [item({ id: 't', ref: { type: 'product', id: 'tomate' }, quantity: 300, unit: 'g', basis: 'bruta' })] });
  const bravas = dish({ id: 'bravas', name: 'Patatas bravas', menuPrice: 6.6, items: [item({ id: 'p', ref: { type: 'product', id: 'patata' }, quantity: 250, unit: 'g', basis: 'bruta' })] });

  it('recalcula los platos afectados (también a través de elaboraciones) y ordena por subida de food cost', () => {
    const ctx = buildCostingContext(products, [salsa, pasta, ensalada, bravas], [], business);
    costDish(pasta, ctx); // caché ya poblada: no debe alterarse
    const cacheSize = ctx.cache.size;
    const rows = simulatePriceChange(ctx, 'tomate', 3);
    expect(rows.map((r) => r.dishId)).toEqual(['ensalada', 'pasta', 'salsa']);
    const [ens, pas, sal] = rows;
    expect(ens.name).toBe('Ensalada de tomate');
    expect(ens.before.foodCostPct).toBeCloseTo(12, 10);
    expect(ens.after.foodCostPct).toBeCloseTo(18, 10);
    expect(pas.before.costPerPortion).toBeCloseTo(0.725, 10);
    expect(pas.after.costPerPortion).toBeCloseTo(0.975, 10);
    expect(pas.after.foodCostPct).toBeCloseTo(9.75, 10);
    expect(sal.after.pricePerYieldUnit).toBeCloseTo(4.375, 10);
    // El contexto original no cambia
    expect(ctx.products.get('tomate')?.pricePerBase).toBe(2);
    expect(ctx.cache.size).toBe(cacheSize);
    expect(costDish(ensalada, ctx).costPerPortion).toBeCloseTo(0.6, 10);
  });

  it('una bajada ordena primero lo que menos baja; productos sin uso o inexistentes → []', () => {
    const ctx = buildCostingContext(products, [salsa, pasta, ensalada, bravas], [], business);
    const rows = simulatePriceChange(ctx, 'tomate', 1);
    expect(rows.map((r) => r.dishId)).toEqual(['pasta', 'ensalada', 'salsa']);
    expect(simulatePriceChange(ctx, 'sal', 10)).toEqual([]);
    expect(simulatePriceChange(ctx, 'no-existe', 10)).toEqual([]);
    expect(simulatePriceChange(ctx, 'tomate', Number.NaN)).toEqual([]);
  });

  it('dishesUsingProduct sigue la cadena de elaboraciones y tolera ciclos', () => {
    const a = dish({ id: 'a', kind: 'elaboracion', items: [item({ id: 'x', ref: { type: 'dish', id: 'b' } }), item({ id: 'y', ref: { type: 'product', id: 'sal' } })] });
    const b = dish({ id: 'b', kind: 'elaboracion', items: [item({ id: 'z', ref: { type: 'dish', id: 'a' } })] });
    const c = dish({ id: 'c', items: [item({ id: 'w', ref: { type: 'dish', id: 'b' } })] });
    expect([...dishesUsingProduct([a, b, c, bravas], 'sal')].sort()).toEqual(['a', 'b', 'c']);
    expect(dishesUsingProduct([a, b, c], 'tomate').size).toBe(0);
  });
});
