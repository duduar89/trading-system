/**
 * Auditoría adversarial de las cifras del escandallo: casos límite reales (unidades culinarias, elaboraciones
 * anidadas, pruebas de rendimiento extremas, IVA, raciones) con el resultado calculado a mano.
 */
import { describe, expect, it } from 'vitest';
import type { BusinessSettings, Dish, Product, RecipeItem, YieldTest } from '../types';
import { buildCostingContext, costDish, foodCostStatus } from './costing';

const business: BusinessSettings = {
  id: 'business',
  targetFoodCostPct: 30,
  warningFoodCostPct: 35,
  defaultSaleVatPct: 10,
  priceAlertPct: 5,
  currency: 'EUR',
  priceRounding: 0.5,
};

function product(p: Partial<Product> & Pick<Product, 'id'>): Product {
  return {
    name: p.id,
    searchKey: p.id,
    aliases: [],
    category: 'otros',
    baseUnit: 'kg',
    pricePerBase: 0,
    priceSource: 'manual',
    wastePct: 0,
    cookingLossPct: 0,
    allergens: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
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
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...p,
  };
}

const cebolla = product({ id: 'cebolla', pricePerBase: 1, wastePct: 10 });
const sal = product({ id: 'sal', pricePerBase: 0.5 });
const vinagre = product({ id: 'vinagre', baseUnit: 'l', pricePerBase: 4 });
const huevo = product({ id: 'huevo', baseUnit: 'ud', pricePerBase: 0.25, unitWeightKg: 0.063 });
const limaSinPeso = product({ id: 'lima', baseUnit: 'ud', pricePerBase: 0.3 });
const merluza = product({ id: 'merluza', pricePerBase: 10, yieldTestId: 'y-merluza' });

const ref = (id: string): RecipeItem['ref'] => ({ type: 'product', id });
const sub = (id: string): RecipeItem['ref'] => ({ type: 'dish', id });

describe('unidades culinarias', () => {
  const ctx = buildCostingContext([cebolla, sal, vinagre, huevo, limaSinPeso], [], [], business);
  const cost = (it: RecipeItem) => costDish(dish({ id: `d-${it.id}`, items: [it] }), ctx).items[0];

  it('cucharada de un producto por kg: 15 ml → 15 g asumiendo densidad 1 (con aviso)', () => {
    const c = cost(item({ id: 'c', ref: ref('sal'), quantity: 1, unit: 'cucharada' }));
    expect(c.grossQty).toBeCloseTo(0.015, 9);
    expect(c.cost).toBeCloseTo(0.0075, 9);
    expect(c.warnings).toContain('Se asume densidad 1 kg/l');
  });

  it('pizca de un líquido, docena de huevos y huevos en gramos', () => {
    expect(cost(item({ id: 'p', ref: ref('vinagre'), quantity: 2, unit: 'pizca' })).grossQty).toBeCloseTo(0.001, 9);
    const docena = cost(item({ id: 'd', ref: ref('huevo'), quantity: 1, unit: 'docena', basis: 'bruta' }));
    expect(docena.grossQty).toBe(12);
    expect(docena.cost).toBeCloseTo(3, 9);
    expect(docena.grossKg).toBeCloseTo(0.756, 9);
    // 126 g de huevo = 2 ud
    expect(cost(item({ id: 'g', ref: ref('huevo'), quantity: 126, unit: 'g' })).cost).toBeCloseTo(0.5, 9);
  });

  it('producto por unidades sin peso medio pedido en gramos: sin resolver y con el motivo (nunca 0 € silencioso)', () => {
    const c = cost(item({ id: 'l', ref: ref('lima'), quantity: 30, unit: 'g' }));
    expect(c.resolved).toBe(false);
    expect(c.cost).toBe(0);
    expect(c.warnings).toEqual(['Falta el peso por unidad del producto']);
  });
});

describe('elaboraciones anidadas', () => {
  // Nivel 3: 1 kg de cebolla bruta (10 % limpieza, 50 % cocción) = 1 €, rinde 0,45 kg servidos (sin rendimiento declarado)
  const pochado = dish({
    id: 'pochado',
    kind: 'elaboracion',
    items: [item({ id: 'x', ref: ref('cebolla'), quantity: 1, unit: 'kg', basis: 'bruta', cookingLossPct: 50 })],
  });
  // Nivel 2: 450 g de pochado → 1 €; rinde 1 kg declarado → 1 €/kg
  const base = dish({ id: 'base', kind: 'elaboracion', yieldQty: 1, yieldUnit: 'kg', items: [item({ id: 'y', ref: sub('pochado'), quantity: 450, unit: 'g' })] });
  // Nivel 1: 2 kg de base = 2 €; rinde 4 kg → 0,50 €/kg
  const salsa = dish({ id: 'salsa', kind: 'elaboracion', yieldQty: 4, yieldUnit: 'kg', items: [item({ id: 'z', ref: sub('base'), quantity: 2, unit: 'kg' })] });
  const plato = dish({ id: 'plato', menuPrice: 1.1, items: [item({ id: 'w', ref: sub('salsa'), quantity: 100, unit: 'g' })] });

  it('tres niveles con y sin rendimiento declarado', () => {
    const ctx = buildCostingContext([cebolla], [pochado, base, salsa, plato], [], business);
    expect(costDish(pochado, ctx).totalCost).toBeCloseTo(1, 9);
    const b = costDish(base, ctx);
    expect(b.totalCost).toBeCloseTo(1, 9);
    expect(b.items[0].warnings[0]).toMatch(/estimado por suma de ingredientes/);
    expect(costDish(salsa, ctx).pricePerYieldUnit).toBeCloseTo(0.5, 9);
    const p = costDish(plato, ctx);
    expect(p.costPerPortion).toBeCloseTo(0.05, 9);
    expect(p.foodCostPct).toBeCloseTo(5, 9);
  });

  it('una elaboración con rendimiento pero sin unidad usa kg, igual que su ficha ("€ por kg producido")', () => {
    const e = dish({ id: 'e', kind: 'elaboracion', yieldQty: 2, items: [item({ id: 'q', ref: ref('cebolla'), quantity: 2, unit: 'kg', basis: 'neta' })] });
    const u = dish({ id: 'u', menuPrice: 10, items: [item({ id: 'q2', ref: sub('e'), quantity: 200, unit: 'g' })] });
    const ctx = buildCostingContext([cebolla], [e, u], [], business);
    const ce = costDish(e, ctx);
    // 2 kg netos con 10 % de limpieza = 2,2222 €; 2 kg producidos → 1,1111 €/kg
    expect(ce.pricePerYieldUnit).toBeCloseTo(2 / 0.9 / 2, 9);
    const line = costDish(u, ctx).items[0];
    expect(line.resolved).toBe(true);
    expect(line.baseUnit).toBe('kg');
    expect(line.cost).toBeCloseTo(0.2 * (2 / 0.9 / 2), 9);
  });
});

describe('pruebas de rendimiento extremas', () => {
  const test = (outputs: YieldTest['outputs'], extra: Partial<YieldTest> = {}): YieldTest => ({
    id: 'y-merluza',
    name: 'Merluza',
    productId: 'merluza',
    date: '2026-01-01',
    grossWeightKg: 2,
    purchasePricePerKg: 10,
    outputs,
    cookingLossPct: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...extra,
  });

  it('subproductos valorados por encima del coste de la pieza: coste 0 € pero con aviso en la línea', () => {
    const y = test([
      { id: 'a', name: 'Lomos', weightKg: 1, kind: 'principal' },
      { id: 'b', name: 'Cabeza y espinas', weightKg: 1, kind: 'subproducto', valuePerKg: 50 },
    ]);
    const d = dish({ id: 'd', menuPrice: 20, items: [item({ id: 'm', ref: ref('merluza'), quantity: 200, unit: 'g' })] });
    const c = costDish(d, buildCostingContext([merluza], [d], [y], business)).items[0];
    expect(c.cost).toBe(0);
    expect(c.warnings.some((w) => /subproductos/.test(w))).toBe(true);
  });

  it('cocción del 99 %: el bruto se multiplica ×100 y el coste con él', () => {
    const y = test([{ id: 'a', name: 'Lomos', weightKg: 1, kind: 'principal' }, { id: 'b', name: 'Resto', weightKg: 1, kind: 'desperdicio' }], { cookingLossPct: 99 });
    const d = dish({ id: 'd', items: [item({ id: 'm', ref: ref('merluza'), quantity: 10, unit: 'g', basis: 'cocinada' })] });
    const c = costDish(d, buildCostingContext([merluza], [d], [y], business)).items[0];
    // 10 g servidos → 1 kg neto → 2 kg brutos → 20 €
    expect(c.netQty).toBeCloseTo(1, 9);
    expect(c.grossQty).toBeCloseTo(2, 9);
    expect(c.cost).toBeCloseTo(20, 9);
  });
});

describe('IVA, raciones y PVP', () => {
  const ctx = (d: Dish) => buildCostingContext([sal], [d], [], business);
  const plato = (extra: Partial<Dish>) => dish({ id: 'p', items: [item({ id: 's', ref: ref('sal'), quantity: 6, unit: 'kg' })], ...extra });

  it.each([
    [0, 10],
    [4, 10.4],
    [10, 11],
    [21, 12.1],
  ])('IVA %s %%: el food cost se calcula sobre el PVP sin IVA', (vat, menuPrice) => {
    const d = plato({ saleVatPct: vat, menuPrice, portions: 1 });
    const c = costDish(d, ctx(d));
    expect(c.netPrice).toBeCloseTo(10, 9);
    expect(c.foodCostPct).toBeCloseTo(30, 9);
    expect(foodCostStatus(c.foodCostPct, 30, 35)).toBe('ok');
    // PVP sugerido: 3 € / 30 % = 10 € sin IVA → con IVA y redondeado a 0,50 hacia arriba
    expect(c.suggestedPrice).toBe(Math.ceil(menuPrice / 0.5 - 1e-9) * 0.5);
  });

  it('raciones fraccionarias, cero o negativas', () => {
    const half = costDish(plato({ portions: 0.5 }), ctx(plato({ portions: 0.5 })));
    expect(half.costPerPortion).toBeCloseTo(6, 9);
    for (const portions of [0, -2]) {
      const d = plato({ portions });
      expect(costDish(d, ctx(d)).costPerPortion).toBeCloseTo(3, 9);
    }
  });

  it('sin PVP: sin food cost ni margen, con aviso y con PVP sugerido', () => {
    const d = plato({ menuPrice: undefined });
    const c = costDish(d, ctx(d));
    expect(c.foodCostPct).toBeUndefined();
    expect(c.grossMargin).toBeUndefined();
    expect(c.warnings).toContain('Falta el PVP de carta');
    expect(c.suggestedPrice).toBe(11);
  });
});
