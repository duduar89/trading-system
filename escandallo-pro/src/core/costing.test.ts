import { describe, expect, it } from 'vitest';
import type { BusinessSettings, Dish, Product, RecipeItem, YieldTest } from '../types';
import {
  applyWaste,
  buildCostingContext,
  costAllDishes,
  costDish,
  costItem,
  effectiveWaste,
  foodCostStatus,
  maxAffordablePrice,
  roundUpTo,
  suggestedMenuPrice,
} from './costing';

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
    pricePerBase: 0,
    priceSource: 'manual',
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

function dish(p: Partial<Dish> & Pick<Dish, 'id' | 'items'>): Dish {
  return {
    name: p.id,
    kind: 'plato',
    saleVatPct: 10,
    portions: 1,
    status: 'revisado',
    source: 'manual',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...p,
  };
}

const solomillo = product({ id: 'solomillo', name: 'Solomillo de ternera', pricePerBase: 32, wastePct: 15, cookingLossPct: 25, allergens: [] });
const patata = product({ id: 'patata', name: 'Patata', pricePerBase: 1, wastePct: 20 });
const nata = product({ id: 'nata', name: 'Nata', baseUnit: 'l', pricePerBase: 3.5, densityKgPerL: 1.02, allergens: ['lacteos'] });
const huevo = product({ id: 'huevo', name: 'Huevo', baseUnit: 'ud', pricePerBase: 0.2, unitWeightKg: 0.06, wastePct: 12, allergens: ['huevo'] });
const limon = product({ id: 'limon', name: 'Limón', pricePerBase: 2, unitWeightKg: 0.12 });
const salmon = product({ id: 'salmon', name: 'Salmón', pricePerBase: 12, wastePct: 40, cookingLossPct: 10, yieldTestId: 'y-salmon', allergens: ['pescado'] });
const sinPrecio = product({ id: 'sin-precio', name: 'Azafrán', pricePerBase: 0 });
const huevoSinPeso = product({ id: 'huevo-sin-peso', name: 'Huevo', baseUnit: 'ud', pricePerBase: 0.2 });
const tomate = product({ id: 'tomate', name: 'Tomate', pricePerBase: 2, wastePct: 10 });
const aceite = product({ id: 'aceite', name: 'Aceite de oliva', baseUnit: 'l', pricePerBase: 5, densityKgPerL: 0.92 });
const harina = product({ id: 'harina', name: 'Harina', pricePerBase: 0.8, allergens: ['gluten'] });

const yieldSalmon: YieldTest = {
  id: 'y-salmon',
  name: 'Salmón entero',
  productId: 'salmon',
  date: '2025-03-01',
  grossWeightKg: 5,
  purchasePricePerKg: 10, // precio antiguo: debe usarse el vigente del producto (12)
  outputs: [
    { id: 'o1', name: 'Lomos', weightKg: 3.1, kind: 'principal' },
    { id: 'o2', name: 'Recortes', weightKg: 0.4, kind: 'subproducto', valuePerKg: 4 },
    { id: 'o3', name: 'Espinas y piel', weightKg: 1.3, kind: 'desperdicio' },
  ],
  cookingLossPct: 18,
  portionKg: 0.15,
  createdAt: '2025-03-01',
  updatedAt: '2025-03-01',
};
const yieldLinea: YieldTest = {
  ...yieldSalmon,
  id: 'y-linea',
  name: 'Salmón (prueba de la línea)',
  outputs: [
    { id: 'l1', name: 'Lomos', weightKg: 2.5, kind: 'principal' },
    { id: 'l2', name: 'Resto', weightKg: 2.5, kind: 'desperdicio' },
  ],
  cookingLossPct: 20,
};

function ctxWith(dishes: Dish[] = [], extraProducts: Product[] = []) {
  return buildCostingContext(
    [solomillo, patata, nata, huevo, limon, salmon, sinPrecio, huevoSinPeso, tomate, aceite, harina, ...extraProducts],
    dishes,
    [yieldSalmon, yieldLinea],
    business,
  );
}

describe('applyWaste', () => {
  it('neta: bruto = neto / (1 − w), servido = neto · (1 − k)', () => {
    const q = applyWaste(0.2, 'neta', 15, 25);
    expect(q.gross).toBeCloseTo(0.235294, 6);
    expect(q.net).toBe(0.2);
    expect(q.served).toBeCloseTo(0.15, 10);
  });
  it('bruta y cocinada', () => {
    const b = applyWaste(0.2, 'bruta', 15, 25);
    expect(b).toEqual({ gross: 0.2, net: expect.closeTo(0.17, 10), served: expect.closeTo(0.1275, 10) });
    const c = applyWaste(0.15, 'cocinada', 15, 25);
    expect(c.net).toBeCloseTo(0.2, 10);
    expect(c.gross).toBeCloseTo(0.235294, 6);
    expect(c.served).toBe(0.15);
  });
  it('acota mermas absurdas (≥ 100 % o negativas)', () => {
    const q = applyWaste(1, 'neta', 150, -10);
    expect(q.gross).toBeCloseTo(100, 6); // merma acotada al 99 %
    expect(q.served).toBe(1);
  });
});

describe('costItem: producto de compra', () => {
  it('solomillo 200 g neto, merma 15 %, cocción 25 %, 32 €/kg', () => {
    const r = costItem(item({ id: 'i1', ref: { type: 'product', id: 'solomillo' }, quantity: 200, unit: 'g', basis: 'neta' }), ctxWith());
    expect(r.resolved).toBe(true);
    expect(r.baseUnit).toBe('kg');
    expect(r.pricePerBase).toBe(32);
    expect(r.grossQty).toBeCloseTo(0.23529, 5);
    expect(r.netQty).toBeCloseTo(0.2, 10);
    expect(r.servedQty).toBeCloseTo(0.15, 10);
    expect(r.cost).toBeCloseTo(7.529, 3);
    expect(r.cleaningWasteQty).toBeCloseTo(0.035294, 6);
    expect(r.cookingWasteQty).toBeCloseTo(0.05, 10);
    expect(r.totalWasteQty).toBeCloseTo(0.08529, 5);
    expect(r.totalWastePct).toBeCloseTo(36.25, 6);
    expect(r.wasteCost).toBeCloseTo(2.729, 3); // 7,529 − 0,150 × 32
    expect(r.grossKg).toBeCloseTo(0.23529, 5);
    expect(r.servedKg).toBeCloseTo(0.15, 10);
    expect(r.appliedWastePct).toBe(15);
    expect(r.appliedCookingLossPct).toBe(25);
    expect(r.wasteSource).toBe('producto');
    expect(r.warnings).toEqual([]);
  });

  it('base bruta: 200 g tal cual se compran', () => {
    const r = costItem(item({ id: 'i1', ref: { type: 'product', id: 'solomillo' }, quantity: 200, unit: 'g', basis: 'bruta' }), ctxWith());
    expect(r.grossQty).toBeCloseTo(0.2, 10);
    expect(r.netQty).toBeCloseTo(0.17, 10);
    expect(r.servedQty).toBeCloseTo(0.1275, 10);
    expect(r.cost).toBeCloseTo(6.4, 10);
    expect(r.wasteCost).toBeCloseTo(6.4 - 0.1275 * 32, 10);
  });

  it('base cocinada: 150 g servidos = 200 g netos', () => {
    const r = costItem(item({ id: 'i1', ref: { type: 'product', id: 'solomillo' }, quantity: 150, unit: 'g', basis: 'cocinada' }), ctxWith());
    expect(r.netQty).toBeCloseTo(0.2, 10);
    expect(r.grossQty).toBeCloseTo(0.23529, 5);
    expect(r.cost).toBeCloseTo(7.529, 3);
  });

  it('ud → kg con el peso por unidad del producto', () => {
    const r = costItem(item({ id: 'i1', ref: { type: 'product', id: 'limon' }, quantity: 1, unit: 'ud', basis: 'bruta' }), ctxWith());
    expect(r.grossQty).toBeCloseTo(0.12, 10);
    expect(r.cost).toBeCloseTo(0.24, 10);
  });

  it('producto por unidades: g → ud y kg agregados con el peso por unidad', () => {
    const r = costItem(item({ id: 'i1', ref: { type: 'product', id: 'huevo' }, quantity: 2, unit: 'ud', basis: 'neta' }), ctxWith());
    expect(r.baseUnit).toBe('ud');
    expect(r.grossQty).toBeCloseTo(2 / 0.88, 10);
    expect(r.cost).toBeCloseTo((2 / 0.88) * 0.2, 10);
    expect(r.grossKg).toBeCloseTo((2 / 0.88) * 0.06, 10);
    expect(r.servedKg).toBeCloseTo(0.12, 10);
    const g = costItem(item({ id: 'i2', ref: { type: 'product', id: 'huevo' }, quantity: 120, unit: 'g', basis: 'bruta' }), ctxWith());
    expect(g.grossQty).toBeCloseTo(2, 10);
    expect(g.cost).toBeCloseTo(0.4, 10);
  });

  it('volumen: ml → l y kg con densidad', () => {
    const r = costItem(item({ id: 'i1', ref: { type: 'product', id: 'nata' }, quantity: 200, unit: 'ml', basis: 'neta' }), ctxWith());
    expect(r.baseUnit).toBe('l');
    expect(r.grossQty).toBeCloseTo(0.2, 10);
    expect(r.cost).toBeCloseTo(0.7, 10);
    expect(r.grossKg).toBeCloseTo(0.204, 10);
    expect(r.warnings).toEqual([]);
  });

  it('unidad incompatible → sin resolver y con el motivo', () => {
    const r = costItem(item({ id: 'i1', ref: { type: 'product', id: 'huevo-sin-peso' }, quantity: 100, unit: 'g' }), ctxWith());
    expect(r.resolved).toBe(false);
    expect(r.cost).toBe(0);
    expect(r.warnings).toEqual(['Falta el peso por unidad del producto']);
  });

  it('líneas sin vincular, sin cantidad, con producto borrado o sin precio', () => {
    const ctx = ctxWith();
    expect(costItem(item({ id: 'a', quantity: 100 }), ctx)).toMatchObject({ resolved: false, cost: 0, warnings: ['Sin producto vinculado'] });
    expect(costItem(item({ id: 'b', ref: { type: 'product', id: 'patata' }, quantity: 0 }), ctx).warnings).toEqual(['Cantidad no indicada']);
    expect(costItem(item({ id: 'c', ref: { type: 'product', id: 'no-existe' }, quantity: 10 }), ctx).warnings).toEqual(['El producto vinculado ya no existe']);
    const sp = costItem(item({ id: 'd', ref: { type: 'product', id: 'sin-precio' }, quantity: 1 }), ctx);
    expect(sp.resolved).toBe(false);
    expect(sp.warnings).toEqual(['Producto sin precio: sube una factura o indícalo a mano']);
  });

  it('avisa cuando asume densidad 1 kg/l', () => {
    const r = costItem(item({ id: 'i1', ref: { type: 'product', id: 'patata' }, quantity: 100, unit: 'ml', basis: 'bruta' }), ctxWith());
    expect(r.cost).toBeCloseTo(0.1, 10);
    expect(r.warnings).toEqual(['Se asume densidad 1 kg/l']);
  });
});

describe('mermas: prueba de rendimiento y prioridades', () => {
  it('la prueba vinculada al producto usa el precio VIGENTE del producto', () => {
    const ctx = ctxWith();
    const r = costItem(item({ id: 'i1', ref: { type: 'product', id: 'salmon' }, quantity: 150, unit: 'g', basis: 'cocinada' }), ctx);
    expect(r.wasteSource).toBe('prueba');
    expect(r.appliedWastePct).toBeCloseTo(38, 10);
    expect(r.appliedCookingLossPct).toBe(18);
    expect(r.netQty).toBeCloseTo(0.15 / 0.82, 10);
    expect(r.grossQty).toBeCloseTo(0.295043, 6);
    // neto × coste €/kg útil con precio 12: (5 × 12 − 1,6) / 3,1 = 18,8387
    expect(r.cost).toBeCloseTo(3.446105, 6);
    expect(r.wasteCost).toBeCloseTo(3.446105 - 0.15 * 12, 6);
  });

  it('una subida del producto se propaga a través de la prueba', () => {
    const caro = { ...salmon, pricePerBase: 15 };
    const ctx = buildCostingContext([caro], [], [yieldSalmon], business);
    const r = costItem(item({ id: 'i1', ref: { type: 'product', id: 'salmon' }, quantity: 100, unit: 'g', basis: 'neta' }), ctx);
    expect(r.cost).toBeCloseTo(0.1 * ((5 * 15 - 1.6) / 3.1), 10);
  });

  it('prioridad: % de la línea > prueba del producto', () => {
    const r = costItem(item({ id: 'i1', ref: { type: 'product', id: 'salmon' }, quantity: 100, unit: 'g', basis: 'neta', wastePct: 10 }), ctxWith());
    expect(r.wasteSource).toBe('linea');
    expect(r.appliedWastePct).toBe(10);
    expect(r.appliedCookingLossPct).toBe(10); // la del producto
    expect(r.cost).toBeCloseTo((0.1 / 0.9) * 12, 10);
  });

  it('prioridad: prueba de la línea > % de la línea > prueba del producto', () => {
    const r = costItem(
      item({ id: 'i1', ref: { type: 'product', id: 'salmon' }, quantity: 100, unit: 'g', basis: 'neta', wastePct: 10, yieldTestId: 'y-linea' }),
      ctxWith(),
    );
    expect(r.wasteSource).toBe('prueba');
    expect(r.appliedWastePct).toBeCloseTo(50, 10);
    expect(r.appliedCookingLossPct).toBe(20);
    expect(r.cost).toBeCloseTo(0.1 * ((5 * 12) / 2.5), 10);
  });

  it('la cocción de la línea sobrescribe la de la prueba', () => {
    const w = effectiveWaste(item({ id: 'i1', ref: { type: 'product', id: 'salmon' }, quantity: 1, cookingLossPct: 5 }), salmon, ctxWith());
    expect(w.source).toBe('prueba');
    expect(w.cookingLossPct).toBe(5);
    expect(w.yieldResult?.costPerUsableKg).toBeCloseTo(58.4 / 3.1, 10);
  });

  it('sin merma en ningún sitio → fuente "ninguna"', () => {
    const w = effectiveWaste(item({ id: 'i1', quantity: 1 }), aceite, ctxWith());
    expect(w).toMatchObject({ wastePct: 0, cookingLossPct: 0, source: 'ninguna' });
  });

  it('una prueba inexistente o sin parte principal se ignora', () => {
    const vacia: YieldTest = { ...yieldSalmon, id: 'y-vacia', outputs: [] };
    const ctx = buildCostingContext([{ ...salmon, yieldTestId: 'y-vacia' }], [], [vacia], business);
    const w = effectiveWaste(item({ id: 'i', quantity: 1, yieldTestId: 'no-existe' }), ctx.products.get('salmon'), ctx);
    expect(w.source).toBe('producto');
    expect(w.wastePct).toBe(40);
  });
});

describe('costDish', () => {
  const plato = dish({
    id: 'solomillo-plato',
    name: 'Solomillo con patatas',
    menuPrice: 22,
    items: [
      item({ id: 's', ref: { type: 'product', id: 'solomillo' }, quantity: 200, unit: 'g', basis: 'neta' }),
      item({ id: 'p', ref: { type: 'product', id: 'patata' }, quantity: 200, unit: 'g', basis: 'neta' }),
    ],
  });

  it('coste, food cost, margen, multiplicador y PVP sugerido', () => {
    const c = costDish(plato, ctxWith([plato]));
    const total = 0.2 / 0.85 * 32 + 0.25;
    expect(c.totalCost).toBeCloseTo(total, 10);
    expect(c.costPerPortion).toBeCloseTo(total, 10);
    expect(c.netPrice).toBeCloseTo(20, 10);
    expect(c.foodCostPct).toBeCloseTo((total / 20) * 100, 10);
    expect(c.grossMargin).toBeCloseTo(20 - total, 10);
    expect(c.grossMarginPct).toBeCloseTo(((20 - total) / 20) * 100, 10);
    expect(c.multiplier).toBeCloseTo(20 / total, 10);
    // 7,779 / 0,30 × 1,10 = 28,52 → múltiplo de 0,50 hacia arriba
    expect(c.suggestedPrice).toBe(29);
    expect(c.targetFoodCostPct).toBe(30);
    expect(c.completeness).toBe(1);
    expect(c.items.map((i) => Math.round(i.costSharePct * 100) / 100)).toEqual([96.79, 3.21]);
    expect(c.warnings).toEqual([]);
  });

  it('mermas del plato en peso y en euros', () => {
    const c = costDish(plato, ctxWith([plato]));
    const gross = 0.2 / 0.85 + 0.25;
    const served = 0.15 + 0.2;
    expect(c.grossKgPerPortion).toBeCloseTo(gross, 10);
    expect(c.servedKgPerPortion).toBeCloseTo(served, 10);
    expect(c.wasteKgPerPortion).toBeCloseTo(gross - served, 10);
    expect(c.wastePct).toBeCloseTo(((gross - served) / gross) * 100, 10);
    expect(c.wasteCostPerPortion).toBeCloseTo(0.2 / 0.85 * 32 - 0.15 * 32 + (0.25 - 0.2), 10);
    expect(c.totalWasteKg).toBeCloseTo(gross - served, 10);
  });

  it('divide entre raciones y usa el objetivo propio del plato', () => {
    const d = dish({ ...plato, id: 'x4', portions: 4, menuPrice: 11, targetFoodCostPct: 25 });
    const c = costDish(d, ctxWith([d]));
    const total = 0.2 / 0.85 * 32 + 0.25;
    expect(c.costPerPortion).toBeCloseTo(total / 4, 10);
    expect(c.targetFoodCostPct).toBe(25);
    expect(c.grossKgPerPortion).toBeCloseTo((0.2 / 0.85 + 0.25) / 4, 10);
  });

  it('platos incompletos, sin PVP o vacíos', () => {
    const d = dish({
      id: 'incompleto',
      items: [item({ id: 'a', ref: { type: 'product', id: 'patata' }, quantity: 100 }), item({ id: 'b', quantity: 5 })],
    });
    const c = costDish(d, ctxWith([d]));
    expect(c.completeness).toBe(0.5);
    expect(c.warnings).toEqual(['Falta el PVP de carta', '1 ingrediente sin precio o sin vincular']);
    expect(c.foodCostPct).toBeUndefined();
    const vacio = dish({ id: 'vacio', items: [], menuPrice: 10 });
    const cv = costDish(vacio, ctxWith([vacio]));
    expect(cv.completeness).toBe(0);
    expect(cv.warnings).toEqual(['La receta no tiene ingredientes']);
    expect(cv.suggestedPrice).toBeUndefined();
  });

  it('agrega alérgenos de productos y elaboraciones anidadas', () => {
    const bechamel = dish({
      id: 'bechamel',
      kind: 'elaboracion',
      items: [
        item({ id: 'n', ref: { type: 'product', id: 'nata' }, quantity: 500, unit: 'ml' }),
        item({ id: 'h', ref: { type: 'product', id: 'harina' }, quantity: 50, unit: 'g' }),
      ],
      yieldQty: 0.5,
      yieldUnit: 'kg',
    });
    const canelones = dish({
      id: 'canelones',
      menuPrice: 14,
      items: [
        item({ id: 'b', ref: { type: 'dish', id: 'bechamel' }, quantity: 150, unit: 'g' }),
        item({ id: 'h', ref: { type: 'product', id: 'huevo' }, quantity: 1, unit: 'ud' }),
      ],
    });
    const c = costDish(canelones, ctxWith([bechamel, canelones]));
    expect(new Set(c.allergens)).toEqual(new Set(['lacteos', 'gluten', 'huevo']));
  });

  it('usa la caché del contexto', () => {
    const ctx = ctxWith([plato]);
    const a = costDish(plato, ctx);
    expect(costDish(plato, ctx)).toBe(a);
    expect(ctx.cache.get(plato.id)).toBe(a);
  });
});

describe('elaboraciones (sub-recetas)', () => {
  const salsa = dish({
    id: 'salsa',
    name: 'Salsa de tomate',
    kind: 'elaboracion',
    portions: 1,
    items: [
      item({ id: 't', ref: { type: 'product', id: 'tomate' }, quantity: 1, unit: 'kg', basis: 'bruta' }),
      item({ id: 'a', ref: { type: 'product', id: 'aceite' }, quantity: 100, unit: 'ml', basis: 'neta' }),
    ],
    yieldQty: 0.8,
    yieldUnit: 'kg',
  });

  it('usada por peso con rendimiento declarado: coste total / rendimiento', () => {
    const plato = dish({ id: 'pasta', menuPrice: 12, items: [item({ id: 's', ref: { type: 'dish', id: 'salsa' }, quantity: 100, unit: 'g', basis: 'neta' })] });
    const ctx = ctxWith([salsa, plato]);
    const cs = costDish(salsa, ctx);
    expect(cs.totalCost).toBeCloseTo(2.5, 10);
    expect(cs.pricePerYieldUnit).toBeCloseTo(3.125, 10);
    const r = costDish(plato, ctx).items[0];
    expect(r.resolved).toBe(true);
    expect(r.baseUnit).toBe('kg');
    expect(r.pricePerBase).toBeCloseTo(3.125, 10);
    expect(r.cost).toBeCloseTo(0.3125, 10);
    expect(r.grossKg).toBeCloseTo(0.1, 10);
    expect(r.wasteSource).toBe('ninguna');
    expect(r.warnings).toEqual([]);
  });

  it('sin rendimiento declarado y pedida por peso: estima por lo servido y avisa', () => {
    const sinRend = { ...salsa, id: 'salsa2', yieldQty: undefined, yieldUnit: undefined };
    const plato = dish({ id: 'p2', items: [item({ id: 's', ref: { type: 'dish', id: 'salsa2' }, quantity: 100, unit: 'g' })] });
    const r = costDish(plato, ctxWith([sinRend, plato])).items[0];
    const servedKg = 0.9 + 0.1 * 0.92; // tomate limpio + aceite con densidad
    expect(r.pricePerBase).toBeCloseTo(2.5 / servedKg, 10);
    expect(r.cost).toBeCloseTo((0.1 * 2.5) / servedKg, 10);
    expect(r.warnings).toContain('Rendimiento de la elaboración estimado por suma de ingredientes: indícalo para mayor precisión');
  });

  it('sin rendimiento y pedida en unidades: 1 ud = 1 ración de la elaboración', () => {
    const fondo = { ...salsa, id: 'fondo', portions: 4, yieldQty: undefined, yieldUnit: undefined };
    const plato = dish({ id: 'p3', items: [item({ id: 'f', ref: { type: 'dish', id: 'fondo' }, quantity: 2, unit: 'ud' })] });
    const r = costDish(plato, ctxWith([fondo, plato])).items[0];
    expect(r.baseUnit).toBe('ud');
    expect(r.pricePerBase).toBeCloseTo(2.5 / 4, 10);
    expect(r.cost).toBeCloseTo(1.25, 10);
  });

  it('raciones fraccionarias: el rendimiento estimado no se duplica', () => {
    const media = { ...salsa, id: 'media', portions: 0.5, yieldQty: undefined, yieldUnit: undefined };
    const plato = dish({ id: 'p4', items: [item({ id: 'm', ref: { type: 'dish', id: 'media' }, quantity: 100, unit: 'g' })] });
    const r = costDish(plato, ctxWith([media, plato])).items[0];
    const servedKg = 0.9 + 0.1 * 0.92;
    expect(r.pricePerBase).toBeCloseTo(2.5 / servedKg, 10);
  });

  it('merma de la línea sobre una elaboración', () => {
    const plato = dish({ id: 'p5', items: [item({ id: 's', ref: { type: 'dish', id: 'salsa' }, quantity: 100, unit: 'g', basis: 'neta', wastePct: 20 })] });
    const r = costDish(plato, ctxWith([salsa, plato])).items[0];
    expect(r.grossQty).toBeCloseTo(0.125, 10);
    expect(r.cost).toBeCloseTo(0.125 * 3.125, 10);
    expect(r.wasteSource).toBe('linea');
  });

  it('elaboración con ingredientes sin precio o borrada', () => {
    const rota = dish({ id: 'rota', kind: 'elaboracion', items: [item({ id: 'x', ref: { type: 'product', id: 'sin-precio' }, quantity: 10 })], yieldQty: 1, yieldUnit: 'kg' });
    const plato = dish({
      id: 'p6',
      items: [
        item({ id: 'r', ref: { type: 'dish', id: 'rota' }, quantity: 100 }),
        item({ id: 'z', ref: { type: 'dish', id: 'borrada' }, quantity: 100 }),
      ],
    });
    const c = costDish(plato, ctxWith([rota, plato]));
    expect(c.items[0].resolved).toBe(false);
    expect(c.items[0].warnings).toEqual(['La elaboración tiene ingredientes sin precio', 'La elaboración no tiene coste']);
    expect(c.items[1].warnings).toEqual(['La elaboración vinculada ya no existe']);
  });

  it('detecta referencias circulares sin bucles infinitos', () => {
    const a = dish({ id: 'A', kind: 'elaboracion', items: [item({ id: 'ab', ref: { type: 'dish', id: 'B' }, quantity: 1, unit: 'ud' })] });
    const b = dish({
      id: 'B',
      kind: 'elaboracion',
      items: [
        item({ id: 'ba', ref: { type: 'dish', id: 'A' }, quantity: 1, unit: 'ud' }),
        item({ id: 'bp', ref: { type: 'product', id: 'patata' }, quantity: 1, unit: 'kg', basis: 'bruta' }),
      ],
    });
    const ctx = ctxWith([a, b]);
    const all = costAllDishes(ctx);
    const cb = all.get('B');
    expect(cb?.items.find((i) => i.itemId === 'ba')?.warnings).toEqual(['Referencia circular entre elaboraciones']);
    expect(all.get('A')?.totalCost).toBeCloseTo(1, 10);
  });
});

describe('costAllDishes', () => {
  it('calcula todos los platos del contexto', () => {
    const d1 = dish({ id: 'd1', items: [item({ id: 'a', ref: { type: 'product', id: 'patata' }, quantity: 1, unit: 'kg', basis: 'bruta' })] });
    const d2 = dish({ id: 'd2', items: [] });
    const all = costAllDishes(ctxWith([d1, d2]));
    expect([...all.keys()]).toEqual(['d1', 'd2']);
    expect(all.get('d1')?.totalCost).toBe(1);
  });
});

describe('suggestedMenuPrice y roundUpTo', () => {
  it('coste 3,20 €, objetivo 30 %, IVA 10 %, redondeo 0,50 → 11,73 → 12,00', () => {
    expect(suggestedMenuPrice(3.2, 30, 10, 0.5)).toBe(12);
  });
  it('otros redondeos', () => {
    expect(suggestedMenuPrice(3.2, 30, 10, 0.1)).toBe(11.8);
    expect(suggestedMenuPrice(3.2, 30, 10, 0)).toBe(11.73);
    expect(suggestedMenuPrice(3, 30, 0, 1)).toBe(10);
    expect(suggestedMenuPrice(0, 30, 10, 0.5)).toBeUndefined();
    expect(suggestedMenuPrice(3, 0, 10, 0.5)).toBeUndefined();
  });
  it('roundUpTo no sube un valor que ya es múltiplo', () => {
    expect(roundUpTo(12, 0.5)).toBe(12);
    expect(roundUpTo(11.7, 0.1)).toBe(11.7);
    expect(roundUpTo(11.71, 0.1)).toBe(11.8);
    expect(roundUpTo(11.733, 0.05)).toBe(11.75);
    expect(roundUpTo(11.736, -1)).toBe(11.74);
  });
});

describe('foodCostStatus', () => {
  it.each<[number | undefined, string]>([
    [undefined, 'none'],
    [Number.NaN, 'none'],
    [22, 'ok'],
    [30, 'ok'],
    [30.01, 'warn'],
    [35, 'warn'],
    [35.5, 'bad'],
  ])('%s → %s', (pct, expected) => {
    expect(foodCostStatus(pct, 30, 35)).toBe(expected);
  });
});

describe('maxAffordablePrice', () => {
  const plato = dish({
    id: 'mp',
    menuPrice: 22,
    items: [
      item({ id: 's', ref: { type: 'product', id: 'solomillo' }, quantity: 200, unit: 'g', basis: 'neta' }),
      item({ id: 'p', ref: { type: 'product', id: 'patata' }, quantity: 200, unit: 'g', basis: 'neta' }),
    ],
  });

  it('precio máximo de compra para cumplir el objetivo', () => {
    const ctx = ctxWith([plato]);
    const c = costDish(plato, ctx);
    // Permitido: 20 € × 30 % = 6 €; resto 0,25 € → 5,75 € / 0,23529 kg brutos
    const max = maxAffordablePrice(c, 's', plato, business);
    expect(max).toBeCloseTo(5.75 / (0.2 / 0.85), 6);
    // Comprobación: con ese precio el plato queda justo en el 30 %
    const ajustado = buildCostingContext([{ ...solomillo, pricePerBase: max ?? 0 }, patata], [plato], [], business);
    expect(costDish(plato, ajustado).foodCostPct).toBeCloseTo(30, 6);
  });

  it('con prueba de rendimiento y subproductos también deja el plato justo en el objetivo', () => {
    const d = dish({ id: 'ms', menuPrice: 16.5, items: [item({ id: 'x', ref: { type: 'product', id: 'salmon' }, quantity: 150, unit: 'g', basis: 'cocinada' })] });
    const ctx = ctxWith([d]);
    const max = maxAffordablePrice(costDish(d, ctx), 'x', d, business);
    expect(max).toBeGreaterThan(0);
    const ajustado = buildCostingContext([{ ...salmon, pricePerBase: max ?? 0 }], [d], [yieldSalmon], business);
    expect(costDish(d, ajustado).foodCostPct).toBeCloseTo(30, 6);
  });

  it('0 si el resto ya supera el objetivo; undefined sin PVP o línea desconocida', () => {
    const caro = dish({ ...plato, id: 'caro', menuPrice: 3 });
    const ctx = ctxWith([caro]);
    expect(maxAffordablePrice(costDish(caro, ctx), 'p', caro, business)).toBe(0);
    const sinPvp = dish({ ...plato, id: 'sinpvp', menuPrice: undefined });
    const ctx2 = ctxWith([sinPvp]);
    expect(maxAffordablePrice(costDish(sinPvp, ctx2), 's', sinPvp, business)).toBeUndefined();
    expect(maxAffordablePrice(costDish(caro, ctx), 'no-existe', caro, business)).toBeUndefined();
  });
});
