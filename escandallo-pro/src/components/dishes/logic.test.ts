import { describe, expect, it } from 'vitest';
import type { BusinessSettings, Dish, MenuEntry, Product, RecipeItem } from '../../types';
import { buildCostingContext, costAllDishes, costDish } from '../../core/costing';
import {
  costDraft,
  dishFoodCostStatus,
  dishListStats,
  editablePatch,
  entriesSummary,
  filterByFoodCost,
  filterDishes,
  foodCostCounts,
  groupEntries,
  parseFoodCostFilter,
  isSearchFragment,
  moveItem,
  normalize,
  patchItem,
  searchIngredients,
  sectionsOf,
  sortDishes,
  targetOf,
  usedIn,
  wasteBreakdown,
} from './logic';

const business: BusinessSettings = {
  id: 'business',
  targetFoodCostPct: 30,
  warningFoodCostPct: 35,
  defaultSaleVatPct: 10,
  priceAlertPct: 5,
  currency: 'EUR',
  priceRounding: 0.5,
};

const now = '2026-09-01T10:00:00.000Z';

function product(p: Partial<Product> & { id: string; name: string }): Product {
  return {
    searchKey: normalize(p.name),
    aliases: [],
    category: 'otros',
    baseUnit: 'kg',
    pricePerBase: 0,
    priceSource: 'manual',
    wastePct: 0,
    cookingLossPct: 0,
    allergens: [],
    createdAt: now,
    updatedAt: now,
    ...p,
  };
}

function item(i: Partial<RecipeItem> & { id: string; name: string }): RecipeItem {
  return { quantity: 0, unit: 'g', basis: 'neta', ...i };
}

function dish(d: Partial<Dish> & { id: string; name: string }): Dish {
  return {
    kind: 'plato',
    saleVatPct: 10,
    portions: 1,
    items: [],
    status: 'borrador',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    ...d,
  };
}

const products: Product[] = [
  product({ id: 'p-tom', name: 'Tomate pera', category: 'verdura', pricePerBase: 2, wastePct: 10, cookingLossPct: 0, aliases: ['TOM. PERA CAT I'] }),
  product({ id: 'p-sol', name: 'Solomillo de ternera', category: 'carne', pricePerBase: 30, wastePct: 20, cookingLossPct: 25, allergens: [] }),
  product({ id: 'p-aove', name: 'Aceite de oliva virgen extra', category: 'aceite', baseUnit: 'l', pricePerBase: 8, densityKgPerL: 0.92 }),
  product({ id: 'p-huevo', name: 'Huevo M', category: 'huevo', baseUnit: 'ud', pricePerBase: 0.25, allergens: ['huevo'] }),
  product({ id: 'p-sal', name: 'Sal', category: 'condimento', pricePerBase: 0.5 }),
];

describe('costDraft', () => {
  it('recalcula con el borrador y no reutiliza la caché del contexto', () => {
    const saved = dish({
      id: 'd1',
      name: 'Solomillo',
      menuPrice: 22,
      items: [item({ id: 'i1', name: 'Solomillo', ref: { type: 'product', id: 'p-sol' }, quantity: 180, unit: 'g', basis: 'cocinada' })],
    });
    const ctx = buildCostingContext(products, [saved], [], business);
    const before = costDish(saved, ctx);
    const draft: Dish = { ...saved, items: [{ ...saved.items[0], quantity: 200 }] };
    const after = costDraft(ctx, draft);
    expect(after.totalCost).toBeGreaterThan(before.totalCost);
    // 200 g cocinados, cocción 25 %, limpieza 20 % → bruto = 0.2 / 0.75 / 0.8 = 0.3333 kg · 30 €/kg
    expect(after.totalCost).toBeCloseTo((0.2 / 0.75 / 0.8) * 30, 6);
    // El contexto original no se ha tocado
    expect(ctx.dishes.get('d1')).toBe(saved);
    expect(ctx.cache.get('d1')).toBe(before);
  });

  it('propaga el borrador a elaboraciones anidadas sin arrastrar costes antiguos', () => {
    const salsa = dish({
      id: 'sub',
      name: 'Salsa de tomate',
      kind: 'elaboracion',
      yieldQty: 1,
      yieldUnit: 'kg',
      items: [item({ id: 's1', name: 'Tomate', ref: { type: 'product', id: 'p-tom' }, quantity: 1, unit: 'kg', basis: 'bruta' })],
    });
    const plato = dish({
      id: 'main',
      name: 'Macarrones',
      menuPrice: 11,
      items: [item({ id: 'm1', name: 'Salsa', ref: { type: 'dish', id: 'sub' }, quantity: 100, unit: 'g', basis: 'neta' })],
    });
    const ctx = buildCostingContext(products, [salsa, plato], [], business);
    costAllDishes(ctx);
    const editedSalsa: Dish = { ...salsa, items: [{ ...salsa.items[0], quantity: 2 }] };
    const salsaCost = costDraft(ctx, editedSalsa);
    expect(salsaCost.totalCost).toBeCloseTo(4, 6);
    expect(salsaCost.pricePerYieldUnit).toBeCloseTo(4, 6);
  });
});

describe('semáforo por plato', () => {
  it('usa el objetivo del plato y desplaza la banda ámbar', () => {
    expect(targetOf({}, business)).toBe(30);
    expect(targetOf({ targetFoodCostPct: 25 }, business)).toBe(25);
    expect(dishFoodCostStatus(29, {}, business)).toBe('ok');
    expect(dishFoodCostStatus(33, {}, business)).toBe('warn');
    expect(dishFoodCostStatus(36, {}, business)).toBe('bad');
    expect(dishFoodCostStatus(27, { targetFoodCostPct: 25 }, business)).toBe('warn');
    expect(dishFoodCostStatus(31, { targetFoodCostPct: 25 }, business)).toBe('bad');
    expect(dishFoodCostStatus(38, { targetFoodCostPct: 40 }, business)).toBe('ok');
    expect(dishFoodCostStatus(undefined, {}, business)).toBe('none');
  });
});

describe('wasteBreakdown', () => {
  it('separa limpieza y cocción por ración en kg y ordena por merma', () => {
    const d = dish({
      id: 'd',
      name: 'Solomillo con tomate',
      portions: 2,
      items: [
        item({ id: 'a', name: 'Solomillo', ref: { type: 'product', id: 'p-sol' }, quantity: 400, unit: 'g', basis: 'neta' }),
        item({ id: 'b', name: 'Tomate', ref: { type: 'product', id: 'p-tom' }, quantity: 200, unit: 'g', basis: 'neta' }),
        item({ id: 'c', name: 'Huevo', ref: { type: 'product', id: 'p-huevo' }, quantity: 2, unit: 'ud', basis: 'neta', wastePct: 12 }),
      ],
    });
    const ctx = buildCostingContext(products, [d], [], business);
    const cost = costDish(d, ctx);
    const w = wasteBreakdown(cost, d.portions);
    expect(w.portions).toBe(2);
    expect(w.notWeighable).toBe(1); // huevo en ud sin peso por unidad
    expect(w.rows.map((r) => r.itemId)).toEqual(['a', 'b']);
    const sol = w.rows[0];
    // neto 0,4 kg → bruto 0,5 kg; limpieza 0,1 kg; cocción 0,1 kg (25 % de 0,4) → por ración / 2
    expect(sol.grossKg).toBeCloseTo(0.25, 6);
    expect(sol.cleaningKg).toBeCloseTo(0.05, 6);
    expect(sol.cookingKg).toBeCloseTo(0.05, 6);
    expect(sol.servedKg).toBeCloseTo(0.15, 6);
    expect(sol.totalKg).toBeCloseTo(sol.grossKg - sol.servedKg, 9);
    expect(sol.wastePct).toBeCloseTo(40, 6);
    // coste merma = coste − servido·precio = 0,5·30 − 0,3·30 = 6 € receta → 3 €/ración
    expect(sol.wasteCost).toBeCloseTo(3, 6);
  });
});

describe('filtros y orden del listado', () => {
  const a = dish({ id: 'a', name: 'Croquetas de jamón', section: 'Entrantes', menuPrice: 9, status: 'revisado', createdAt: '2026-09-01T10:00:00Z' });
  const b = dish({ id: 'b', name: 'Ñoquis al pesto', section: 'Principales', menuPrice: 14, createdAt: '2026-09-03T10:00:00Z' });
  const c = dish({ id: 'c', name: 'Alioli', kind: 'elaboracion', createdAt: '2026-09-02T10:00:00Z' });
  const e = dish({ id: 'e', name: 'Ensalada', section: 'entrantes', createdAt: '2026-08-02T10:00:00Z' });
  const costs = new Map([
    ['a', { foodCostPct: 25, grossMargin: 6, costPerPortion: 2, wastePct: 10, grossKgPerPortion: 0.2 }],
    ['b', { foodCostPct: 40, grossMargin: 8, costPerPortion: 5, wastePct: 5, grossKgPerPortion: 0.3 }],
    ['c', { costPerPortion: 1, wastePct: 0, grossKgPerPortion: 0 }],
    ['e', { costPerPortion: 1, wastePct: 30, grossKgPerPortion: 0.2 }],
  ]) as unknown as Map<string, import('../../types').DishCost>;

  it('filtra por tipo, estado, sección y texto sin tildes', () => {
    const all = [a, b, c, e];
    expect(filterDishes(all, { query: '', kind: 'plato', status: 'todos' }).map((d) => d.id)).toEqual(['a', 'b', 'e']);
    expect(filterDishes(all, { query: '', kind: 'elaboracion', status: 'todos' }).map((d) => d.id)).toEqual(['c']);
    expect(filterDishes(all, { query: '', kind: 'todos', status: 'revisado' }).map((d) => d.id)).toEqual(['a']);
    expect(filterDishes(all, { query: 'noquis', kind: 'todos', status: 'todos' }).map((d) => d.id)).toEqual(['b']);
    expect(filterDishes(all, { query: 'JAMON croq', kind: 'todos', status: 'todos' }).map((d) => d.id)).toEqual(['a']);
    expect(filterDishes(all, { query: '', kind: 'todos', status: 'todos', section: '' }).map((d) => d.id)).toEqual(['c']);
  });

  it('ordena por métrica con los vacíos al final', () => {
    expect(sortDishes([a, b, c, e], costs, 'foodcost').map((d) => d.id)).toEqual(['b', 'a', 'c', 'e']);
    expect(sortDishes([a, b, c, e], costs, 'foodcost', 'asc').map((d) => d.id)).toEqual(['a', 'b', 'c', 'e']);
    expect(sortDishes([a, b, c, e], costs, 'margen').map((d) => d.id)).toEqual(['b', 'a', 'c', 'e']);
    expect(sortDishes([a, b, c, e], costs, 'merma').map((d) => d.id)).toEqual(['e', 'a', 'b', 'c']);
    expect(sortDishes([a, b, c, e], costs, 'nombre').map((d) => d.id)).toEqual(['c', 'a', 'e', 'b']);
    expect(sortDishes([a, b, c, e], costs, 'recientes').map((d) => d.id)).toEqual(['b', 'c', 'a', 'e']);
    expect(sortDishes([a, b, c, e], costs, 'seccion').map((d) => d.id)).toEqual(['a', 'e', 'b', 'c']);
  });

  it('calcula los KPIs de cabecera', () => {
    const d1 = dish({ id: 'a', name: 'A', menuPrice: 9, items: [item({ id: 'x', name: 'x', suggested: true })] });
    const d2 = dish({ id: 'b', name: 'B', menuPrice: 14 });
    const d3 = dish({ id: 'c', name: 'C', kind: 'elaboracion' });
    const d4 = dish({ id: 'e', name: 'E' });
    const st = dishListStats([d1, d2, d3, d4], costs, business);
    expect(st.dishes).toBe(3);
    expect(st.elaborations).toBe(1);
    expect(st.avgFoodCost).toBeCloseTo(32.5, 6);
    expect(st.red).toBe(1);
    expect(st.noPrice).toBe(1);
    expect(st.suggestedLines).toBe(1);
  });

  it('filtra por semáforo de food cost (enlaces ?fc= del panel)', () => {
    expect(parseFoodCostFilter('bad')).toBe('bad');
    expect(parseFoodCostFilter(' WARN ')).toBe('warn');
    expect(parseFoodCostFilter('rojo')).toBeUndefined();
    expect(parseFoodCostFilter(null)).toBeUndefined();
    const amber = dish({ id: 'm', name: 'Ámbar', menuPrice: 10 });
    const withAmber = new Map(costs);
    withAmber.set('m', { foodCostPct: 32, grossMargin: 6, costPerPortion: 3, wastePct: 0, grossKgPerPortion: 0 } as unknown as import('../../types').DishCost);
    const all = [a, b, c, e, amber];
    expect(filterByFoodCost(all, withAmber, business, 'bad').map((d) => d.id)).toEqual(['b']);
    expect(filterByFoodCost(all, withAmber, business, 'warn').map((d) => d.id)).toEqual(['m']);
    expect(filterByFoodCost(all, withAmber, business, 'ok').map((d) => d.id)).toEqual(['a']);
    // Sin PVP no hay food cost; las elaboraciones nunca entran en el semáforo.
    expect(filterByFoodCost(all, withAmber, business, 'sin').map((d) => d.id)).toEqual(['e']);
    expect(filterByFoodCost(all, withAmber, business, undefined)).toBe(all);
    expect(foodCostCounts(all, withAmber, business)).toEqual({ bad: 1, warn: 1, ok: 1, sin: 1 });
    // El objetivo propio del plato desplaza el semáforo (40 % con objetivo 38 % → ámbar).
    const own = dish({ id: 'b', name: 'Ñoquis', menuPrice: 14, targetFoodCostPct: 38 });
    expect(filterByFoodCost([own], withAmber, business, 'warn').map((d) => d.id)).toEqual(['b']);
  });

  it('agrupa secciones sin duplicados y detecta usos de elaboraciones', () => {
    expect(sectionsOf([a, b, c, e])).toEqual(['Entrantes', 'Principales']);
    const user = dish({ id: 'u', name: 'U', items: [item({ id: 'i', name: 'Alioli', ref: { type: 'dish', id: 'c' } })] });
    expect(usedIn('c', [a, user, c]).map((d) => d.id)).toEqual(['u']);
  });
});

describe('searchIngredients', () => {
  const elab = dish({ id: 'el', name: 'Salsa de tomate casera', kind: 'elaboracion' });
  it('encuentra por prefijo, palabra, alias y elaboraciones', () => {
    const r = searchIngredients('tom', products, [elab]);
    expect(r[0].name).toBe('Tomate pera');
    expect(r.some((o) => o.kind === 'dish' && o.id === 'el')).toBe(true);
    expect(searchIngredients('aceite oliva', products, [])[0].id).toBe('p-aove');
    const alias = searchIngredients('tom. pera cat', products, []);
    expect(alias[0].id).toBe('p-tom');
    expect(searchIngredients('solo', products, [])[0].id).toBe('p-sol');
  });
  it('excluye el propio plato y devuelve sugerencias sin consulta', () => {
    expect(searchIngredients('salsa', products, [elab], 8, 'el').some((o) => o.id === 'el')).toBe(false);
    expect(searchIngredients('', products, [elab]).length).toBeGreaterThan(0);
  });
});

describe('texto de búsqueda frente a nombre de receta', () => {
  it('sustituye fragmentos de búsqueda y conserva nombres propios', () => {
    expect(isSearchFragment('calabac', 'Calabacín')).toBe(true);
    expect(isSearchFragment('aceite gir', 'Aceite de girasol alto oleico')).toBe(true);
    expect(isSearchFragment('  ', 'Sal')).toBe(true);
    expect(isSearchFragment('Pimientos de Padrón', 'Pimiento de Padrón')).toBe(false);
    expect(isSearchFragment('Aceite de girasol (fritura)', 'Aceite de girasol alto oleico')).toBe(false);
    expect(isSearchFragment('Calabacín', 'Calabacín')).toBe(false);
    expect(isSearchFragment('tomate', 'Tomate')).toBe(false);
  });
});

describe('edición de líneas', () => {
  const items = [item({ id: '1', name: 'a' }), item({ id: '2', name: 'b' }), item({ id: '3', name: 'c' })];
  it('parchea y mueve de forma inmutable', () => {
    const p = patchItem(items, '2', { quantity: 5 });
    expect(p[1].quantity).toBe(5);
    expect(items[1].quantity).toBe(0);
    expect(moveItem(items, '3', -1).map((i) => i.id)).toEqual(['1', '3', '2']);
    expect(moveItem(items, '1', -1)).toBe(items);
  });
  it('el parche editable no incluye id ni marcas de tiempo', () => {
    const patch = editablePatch(dish({ id: 'x', name: 'X' }));
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('createdAt');
    expect(patch).not.toHaveProperty('updatedAt');
    expect(patch.name).toBe('X');
  });
});

describe('carta', () => {
  const entries: MenuEntry[] = [
    { id: '1', name: 'Croquetas', section: 'Entrantes', price: 9, selected: true, confidence: 0.9 },
    { id: '2', name: 'Pulpo', section: 'Principales', selected: true, confidence: 0.4 },
    { id: '3', name: 'Ensaladilla', section: 'ENTRANTES', price: 7, selected: false, dishId: 'd' },
    { id: '4', name: 'Pan', selected: true, price: 1.5 },
  ];
  it('agrupa por sección en orden de aparición', () => {
    const g = groupEntries(entries);
    expect(g.map((x) => x.section)).toEqual(['Entrantes', 'Principales', 'Sin sección']);
    expect(g[0].entries.map((e) => e.id)).toEqual(['1', '3']);
  });
  it('resume la revisión', () => {
    expect(entriesSummary(entries)).toEqual({ total: 4, selected: 3, withoutPrice: 1, lowConfidence: 1, imported: 1 });
  });
});

describe('formato', () => {
  it('precio unitario con 2 decimales desde 1 € y hasta 4 por debajo', async () => {
    const { fmtPrice, fmtPctNb } = await import('./logic');
    expect(fmtPrice(12.0263)).toBe('12,03\u00a0€');
    expect(fmtPrice(0.0385)).toBe('0,0385\u00a0€');
    expect(fmtPrice(undefined)).toBe('—');
    expect(fmtPctNb(30, 0)).toBe('30 %');
    expect(fmtPctNb(undefined)).toBe('—');
  });
});
