/**
 * Auditoría de cifras de informes y pantallas de compras: que cada número se muestre en su unidad y con el mismo
 * criterio que el resto de la app (semáforo, food cost sin coste, subidas de precio).
 */
import { describe, expect, it } from 'vitest';
import type { BusinessSettings, Dish, PricePoint, Product, RecipeItem, YieldTest } from '../src/types';
import { buildCostingContext, costAllDishes } from '../src/core/costing';
import { simulatePriceChange } from '../src/core/analytics';
import { productWasteRows, simulationRows, simulationSummary } from '../src/components/home/insights';
import { priceTrends, productStats, productUsage } from '../src/components/purchases/logic';

const business: BusinessSettings = {
  id: 'business',
  targetFoodCostPct: 30,
  warningFoodCostPct: 35,
  defaultSaleVatPct: 10,
  priceAlertPct: 5,
  currency: 'EUR',
  priceRounding: 0.5,
};
const T = '2026-01-01T00:00:00.000Z';

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
    createdAt: T,
    updatedAt: T,
    ...p,
  };
}

function item(productId: string, quantity: number, extra: Partial<RecipeItem> = {}): RecipeItem {
  return { id: `${productId}-${quantity}`, name: productId, ref: { type: 'product', id: productId }, quantity, unit: 'kg', basis: 'neta', ...extra };
}

function dish(d: Partial<Dish> & Pick<Dish, 'id'>): Dish {
  return { name: d.id, kind: 'plato', saleVatPct: 10, portions: 1, items: [], status: 'revisado', source: 'manual', createdAt: T, updatedAt: T, ...d };
}

describe('informe de mermas: precio real en la unidad del producto', () => {
  it('un producto por unidades con prueba de rendimiento muestra €/ud limpia, no el €/kg útil de la prueba', () => {
    // Piña a 2,40 €/ud (1,6 kg): la prueba deja la mitad del peso limpio.
    const y: YieldTest = {
      id: 'y',
      name: 'Piña',
      date: '2026-01-01',
      grossWeightKg: 1.6,
      purchasePricePerKg: 1.5,
      outputs: [
        { id: 'a', name: 'Pulpa', weightKg: 0.8, kind: 'principal' },
        { id: 'b', name: 'Corteza', weightKg: 0.8, kind: 'desperdicio' },
      ],
      cookingLossPct: 0,
      createdAt: T,
      updatedAt: T,
    };
    const [row] = productWasteRows([product({ id: 'pina', baseUnit: 'ud', pricePerBase: 2.4, unitWeightKg: 1.6, yieldTestId: 'y' })], [y], []);
    expect(row.source).toBe('prueba');
    expect(row.cleaningPct).toBeCloseTo(50, 9);
    // Se muestra como «4,80 €/ud»: lo que cuesta cada unidad limpia (antes salía 3,00 €/kg etiquetado como €/ud)
    expect(row.realPricePerUsable).toBeCloseTo(4.8, 9);
    expect(row.lossPerBase).toBeCloseTo(1.2, 9);
  });
});

describe('simulador: platos que antes no tenían coste', () => {
  it('un plato sin coste antes de simular no cuenta como «empeora» ni muestra un 0 % de partida', () => {
    const trufa = product({ id: 'trufa', pricePerBase: 0 });
    const plato = dish({ id: 'p', menuPrice: 22, items: [item('trufa', 0.01)] });
    const ctx = buildCostingContext([trufa], [plato], [], business);
    const sim = simulatePriceChange(ctx, 'trufa', 800);
    const [row] = simulationRows(sim, [plato], business);
    expect(row.costBefore).toBe(0);
    expect(row.fcBefore).toBeUndefined();
    expect(row.statusBefore).toBe('none');
    // 8 € sobre 20 € sin IVA = 40 % → rojo
    expect(row.fcAfter).toBeCloseTo(40, 9);
    expect(row.statusAfter).toBe('bad');
    expect(simulationSummary([row])).toMatchObject({ worsened: 0, improved: 0 });
  });
});

describe('ficha de ingrediente: «Usado en»', () => {
  it('un plato cuyo coste aún es 0 € no enseña un food cost del 0 %', () => {
    const trufa = product({ id: 'trufa', pricePerBase: 0 });
    const plato = dish({ id: 'p', menuPrice: 22, items: [item('trufa', 0.01)] });
    const costs = costAllDishes(buildCostingContext([trufa], [plato], [], business));
    expect(costs.get('p')!.foodCostPct).toBe(0);
    expect(productUsage('trufa', [plato], costs)[0].foodCostPct).toBeUndefined();
  });
});

describe('subidas recientes en Ingredientes: mismo umbral que las alertas', () => {
  it('una subida que se muestra como «+5,0 %» cuenta con un umbral del 5 %', () => {
    const pts: PricePoint[] = [
      { id: 'a', productId: 'x', date: '2026-01-01', pricePerBase: 1, source: 'factura' },
      { id: 'b', productId: 'x', date: '2026-02-01', pricePerBase: 1.0496, source: 'factura' },
    ];
    const trends = priceTrends(pts);
    expect(productStats([product({ id: 'x', pricePerBase: 1.0496 })], trends, 5, '2026-02-10').recentRises).toBe(1);
  });
});
