import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BUSINESS_SETTINGS, createWorkspace, db, setCurrentWorkspaceId } from '../src/db';
import type { Dish, Product, YieldTest } from '../src/types';
import {
  YIELD_TEMPLATES,
  createYieldTest,
  createYieldTestFromTemplate,
  deleteYieldTest,
  duplicateYieldTest,
  linkYieldTestToProduct,
  normalizeOutput,
  outputsFromTemplate,
  productPricePerKg,
  templateYieldPct,
  updateYieldTest,
} from '../src/services/yieldTests';
import { computeYield } from '../src/core/yield';
import { buildCostingContext, costDish } from '../src/core/costing';
import { todayIso } from '../src/lib/id';
import { cascadeSteps, effectivePurchasePrice, pieceSegments, remainingKg } from '../src/components/yield/model';
import { bestProductForHint, bestTemplateForProduct, normalizeQuery, searchProducts } from '../src/components/yield/productSearch';
import { buildYieldRows } from '../src/components/yield/YieldTestList';

function product(p: Partial<Product> & { id: string; name: string }): Product {
  return {
    searchKey: p.name.toLowerCase(),
    aliases: [],
    category: 'pescado',
    baseUnit: 'kg',
    pricePerBase: 0,
    priceSource: 'manual',
    wastePct: 0,
    cookingLossPct: 0,
    allergens: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...p,
  };
}

function dish(d: Partial<Dish> & { id: string; name: string }): Dish {
  return {
    kind: 'plato',
    saleVatPct: 10,
    portions: 1,
    items: [],
    status: 'borrador',
    source: 'manual',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...d,
  };
}

beforeEach(async () => {
  const ws = await createWorkspace({ name: `Test ${Math.random()}` });
  setCurrentWorkspaceId(ws.id);
});

describe('createYieldTest', () => {
  it('aplica valores por defecto (fecha de hoy, sin salidas, cocción 0)', async () => {
    const t = await createYieldTest({ name: 'Prueba' });
    expect(t.id).toBeTruthy();
    expect(t.date).toBe(todayIso());
    expect(t.outputs).toEqual([]);
    expect(t.cookingLossPct).toBe(0);
    expect(t.grossWeightKg).toBe(0);
    expect(t.purchasePricePerKg).toBe(0);
    expect(t.createdAt).toBeTruthy();
    expect(t.updatedAt).toBe(t.createdAt);
    expect(await db().yieldTests.get(t.id)).toEqual(t);
  });

  it('toma el precio vigente del producto en kg si no se indica', async () => {
    await db().products.put(product({ id: 'p1', name: 'Salmón', pricePerBase: 11.9 }));
    const t = await createYieldTest({ name: 'Salmón', productId: 'p1', grossWeightKg: 5 });
    expect(t.purchasePricePerKg).toBe(11.9);
    expect(t.productId).toBe('p1');
  });

  it('respeta el precio indicado aunque haya producto', async () => {
    await db().products.put(product({ id: 'p1', name: 'Salmón', pricePerBase: 11.9 }));
    const t = await createYieldTest({ name: 'Salmón', productId: 'p1', purchasePricePerKg: 9.5 });
    expect(t.purchasePricePerKg).toBe(9.5);
  });

  it('convierte el precio por unidad a €/kg con el peso medio', async () => {
    await db().products.put(product({ id: 'p2', name: 'Piña', category: 'fruta', baseUnit: 'ud', pricePerBase: 2.4, unitWeightKg: 1.6 }));
    const t = await createYieldTest({ name: 'Piña', productId: 'p2' });
    expect(t.purchasePricePerKg).toBeCloseTo(1.5, 6);
  });

  it('normaliza salidas y números no válidos', async () => {
    const t = await createYieldTest({
      name: '  Merluza  ',
      grossWeightKg: -3,
      cookingLossPct: 250,
      portionKg: 0,
      outputs: [{ id: '', name: ' Lomos ', weightKg: Number.NaN, kind: 'principal', valuePerKg: 4 }],
    });
    expect(t.name).toBe('Merluza');
    expect(t.grossWeightKg).toBe(0);
    expect(t.cookingLossPct).toBe(99.9);
    expect(t.portionKg).toBeUndefined();
    expect(t.outputs[0].id).toBeTruthy();
    expect(t.outputs[0].name).toBe('Lomos');
    expect(t.outputs[0].weightKg).toBe(0);
    // El valor €/kg sólo tiene sentido en subproductos
    expect(t.outputs[0].valuePerKg).toBeUndefined();
  });
});

describe('updateYieldTest', () => {
  it('actualiza campos y updatedAt', async () => {
    const t = await createYieldTest({ name: 'A' });
    await new Promise((r) => setTimeout(r, 5));
    await updateYieldTest(t.id, { name: 'B', grossWeightKg: 4.2, outputs: [{ id: 'o1', name: 'Lomos', weightKg: 2, kind: 'principal' }] });
    const u = await db().yieldTests.get(t.id);
    expect(u?.name).toBe('B');
    expect(u?.grossWeightKg).toBe(4.2);
    expect(u?.outputs).toHaveLength(1);
    expect(u?.updatedAt > t.updatedAt).toBe(true);
    expect(u?.createdAt).toBe(t.createdAt);
  });

  it('no permite cambiar id ni createdAt', async () => {
    const t = await createYieldTest({ name: 'A' });
    await updateYieldTest(t.id, { id: 'otro', createdAt: 'x' } as never);
    const u = await db().yieldTests.get(t.id);
    expect(u?.id).toBe(t.id);
    expect(u?.createdAt).toBe(t.createdAt);
  });

  it('borra campos opcionales cuando se envían como undefined', async () => {
    const t = await createYieldTest({ name: 'A', thawLossPct: 8, portionKg: 0.15 });
    await updateYieldTest(t.id, { thawLossPct: undefined, portionKg: undefined });
    const u = await db().yieldTests.get(t.id);
    expect(u?.thawLossPct).toBeUndefined();
    expect(u?.portionKg).toBeUndefined();
  });

  it('lanza si la prueba no existe', async () => {
    await expect(updateYieldTest('no-existe', { name: 'x' })).rejects.toThrow();
  });

  it('al cambiar de producto desvincula el producto anterior', async () => {
    await db().products.bulkPut([product({ id: 'p1', name: 'Salmón', pricePerBase: 10 }), product({ id: 'p2', name: 'Trucha', pricePerBase: 7 })]);
    const t = await createYieldTest({ name: 'X', productId: 'p1' });
    await linkYieldTestToProduct(t.id, 'p1');
    expect((await db().products.get('p1'))?.yieldTestId).toBe(t.id);
    await updateYieldTest(t.id, { productId: 'p2' });
    expect((await db().products.get('p1'))?.yieldTestId).toBeUndefined();
    expect((await db().products.get('p2'))?.yieldTestId).toBeUndefined();
    expect((await db().yieldTests.get(t.id))?.productId).toBe('p2');
  });
});

describe('linkYieldTestToProduct', () => {
  it('vincula, fija productId en la prueba y desvincula otros productos', async () => {
    await db().products.bulkPut([product({ id: 'p1', name: 'Salmón' }), product({ id: 'p2', name: 'Salmón noruego' })]);
    const t = await createYieldTest({ name: 'Salmón' });
    await linkYieldTestToProduct(t.id, 'p1');
    expect((await db().products.get('p1'))?.yieldTestId).toBe(t.id);
    expect((await db().yieldTests.get(t.id))?.productId).toBe('p1');

    await linkYieldTestToProduct(t.id, 'p2');
    expect((await db().products.get('p1'))?.yieldTestId).toBeUndefined();
    expect((await db().products.get('p2'))?.yieldTestId).toBe(t.id);
    expect((await db().yieldTests.get(t.id))?.productId).toBe('p2');
  });

  it('con undefined desvincula el producto pero la prueba conserva su producto', async () => {
    await db().products.put(product({ id: 'p1', name: 'Salmón' }));
    const t = await createYieldTest({ name: 'Salmón', productId: 'p1' });
    await linkYieldTestToProduct(t.id, 'p1');
    await linkYieldTestToProduct(t.id, undefined);
    expect((await db().products.get('p1'))?.yieldTestId).toBeUndefined();
    expect((await db().yieldTests.get(t.id))?.productId).toBe('p1');
  });

  it('sustituye la prueba que tuviera antes el producto', async () => {
    await db().products.put(product({ id: 'p1', name: 'Salmón' }));
    const a = await createYieldTest({ name: 'A', productId: 'p1' });
    const b = await createYieldTest({ name: 'B', productId: 'p1' });
    await linkYieldTestToProduct(a.id, 'p1');
    await linkYieldTestToProduct(b.id, 'p1');
    expect((await db().products.get('p1'))?.yieldTestId).toBe(b.id);
  });

  it('lanza si la prueba o el producto no existen', async () => {
    const t = await createYieldTest({ name: 'A' });
    await expect(linkYieldTestToProduct('nope', undefined)).rejects.toThrow();
    await expect(linkYieldTestToProduct(t.id, 'nope')).rejects.toThrow();
  });
});

describe('deleteYieldTest', () => {
  it('borra y desvincula productos y líneas de receta', async () => {
    await db().products.bulkPut([product({ id: 'p1', name: 'Salmón' }), product({ id: 'p2', name: 'Otro' })]);
    const t = await createYieldTest({ name: 'Salmón', productId: 'p1' });
    const other = await createYieldTest({ name: 'Otra' });
    await linkYieldTestToProduct(t.id, 'p1');
    await linkYieldTestToProduct(other.id, 'p2');
    await db().dishes.bulkPut([
      dish({
        id: 'd1',
        name: 'Tartar',
        items: [
          { id: 'i1', name: 'Salmón', ref: { type: 'product', id: 'p1' }, quantity: 150, unit: 'g', basis: 'neta', yieldTestId: t.id },
          { id: 'i2', name: 'Aguacate', quantity: 50, unit: 'g', basis: 'neta', yieldTestId: other.id },
        ],
      }),
      dish({ id: 'd2', name: 'Nada', items: [{ id: 'i3', name: 'Sal', quantity: 1, unit: 'g', basis: 'neta' }] }),
    ]);

    await deleteYieldTest(t.id);
    expect(await db().yieldTests.get(t.id)).toBeUndefined();
    expect((await db().products.get('p1'))?.yieldTestId).toBeUndefined();
    expect((await db().products.get('p2'))?.yieldTestId).toBe(other.id);
    const d1 = await db().dishes.get('d1');
    expect(d1?.items[0].yieldTestId).toBeUndefined();
    expect('yieldTestId' in (d1?.items[0] ?? {})).toBe(false);
    expect(d1?.items[0].ref).toEqual({ type: 'product', id: 'p1' });
    expect(d1?.items[1].yieldTestId).toBe(other.id);
    expect((await db().dishes.get('d2'))?.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('duplicateYieldTest', () => {
  it('copia salidas con ids nuevos, fecha de hoy y sin vincular', async () => {
    await db().products.put(product({ id: 'p1', name: 'Salmón', pricePerBase: 12 }));
    const t = await createYieldTest({
      name: 'Salmón',
      productId: 'p1',
      grossWeightKg: 5,
      outputs: [{ id: 'o1', name: 'Lomos', weightKg: 3, kind: 'principal' }],
    });
    await linkYieldTestToProduct(t.id, 'p1');
    const c = await duplicateYieldTest(t.id);
    expect(c.id).not.toBe(t.id);
    expect(c.name).toBe('Salmón (copia)');
    expect(c.outputs[0].id).not.toBe('o1');
    expect(c.outputs[0].weightKg).toBe(3);
    expect(c.productId).toBe('p1');
    expect((await db().products.get('p1'))?.yieldTestId).toBe(t.id);
  });
});

describe('YIELD_TEMPLATES', () => {
  it('incluye al menos 14 plantillas con nombres únicos', () => {
    expect(YIELD_TEMPLATES.length).toBeGreaterThanOrEqual(14);
    expect(new Set(YIELD_TEMPLATES.map((t) => t.name)).size).toBe(YIELD_TEMPLATES.length);
  });

  it.each(YIELD_TEMPLATES.map((t) => [t.name, t] as const))('%s es coherente', (_name, t) => {
    expect(t.productHint.trim().length).toBeGreaterThan(2);
    expect(t.portionKg).toBeGreaterThan(0);
    expect(t.cookingLossPct).toBeGreaterThanOrEqual(0);
    expect(t.cookingLossPct).toBeLessThan(70);
    const principal = t.outputs.filter((o) => o.kind === 'principal');
    expect(principal.length).toBeGreaterThan(0);
    const sum = t.outputs.reduce((s, o) => s + o.fraction, 0) + (t.thawLossPct ?? 0) / 100;
    expect(sum).toBeLessThanOrEqual(1 + 1e-9);
    expect(sum).toBeGreaterThan(0.85);
    for (const o of t.outputs) {
      expect(o.fraction).toBeGreaterThan(0);
      if (o.valuePerKg != null) expect(o.kind).toBe('subproducto');
    }
    const r = computeYield({
      grossWeightKg: 10,
      purchasePricePerKg: 10,
      thawLossPct: t.thawLossPct,
      cookingLossPct: t.cookingLossPct,
      portionKg: t.portionKg,
      outputs: outputsFromTemplate(t, 10),
    });
    expect(r.warnings).toEqual([]);
    expect(r.costPerUsableKg).toBeGreaterThan(10);
    expect(r.portions).toBeGreaterThan(0);
  });

  it('cubre las piezas clave de cocina española', () => {
    const names = YIELD_TEMPLATES.map((t) => t.name.toLowerCase()).join(' | ');
    for (const k of ['salmón', 'merluza', 'lubina', 'rape', 'bacalao', 'pulpo', 'calamar', 'sepia', 'langostino', 'solomillo', 'lomo alto', 'cordero', 'pollo', 'jamón', 'alcachofa', 'espárrago', 'piña', 'melón']) {
      expect(names).toContain(k);
    }
  });

  it('el pulpo congelado incluye descongelación y cocción del 45 %', () => {
    const pulpo = YIELD_TEMPLATES.find((t) => t.name.toLowerCase().includes('pulpo'));
    expect(pulpo?.thawLossPct).toBeGreaterThan(0);
    expect(pulpo?.cookingLossPct).toBe(45);
  });

  it('el solomillo tiene el cordón como subproducto', () => {
    const s = YIELD_TEMPLATES.find((t) => t.name.toLowerCase().includes('solomillo'));
    expect(s?.outputs.some((o) => o.kind === 'subproducto' && /cord[oó]n/i.test(o.name))).toBe(true);
  });

  it('templateYieldPct suma las salidas principales', () => {
    const pollo = YIELD_TEMPLATES.find((t) => t.name.startsWith('Pollo'))!;
    expect(templateYieldPct(pollo)).toBeCloseTo(58, 6);
  });
});

describe('createYieldTestFromTemplate', () => {
  it('escala las salidas al peso bruto y hereda cocción, ración y descongelación', async () => {
    const pulpo = YIELD_TEMPLATES.find((t) => t.name.toLowerCase().includes('pulpo'))!;
    await db().products.put(product({ id: 'pp', name: 'Pulpo congelado', category: 'marisco', pricePerBase: 14 }));
    const t = await createYieldTestFromTemplate(pulpo, { productId: 'pp', grossWeightKg: 2 });
    expect(t.grossWeightKg).toBe(2);
    expect(t.purchasePricePerKg).toBe(14);
    expect(t.thawLossPct).toBe(pulpo.thawLossPct);
    expect(t.cookingLossPct).toBe(45);
    expect(t.portionKg).toBe(pulpo.portionKg);
    expect(t.outputs).toHaveLength(pulpo.outputs.length);
    expect(t.outputs[0].weightKg).toBeCloseTo(pulpo.outputs[0].fraction * 2, 3);
    expect(new Set(t.outputs.map((o) => o.id)).size).toBe(t.outputs.length);
  });

  it('sin peso usa el peso típico de la plantilla', async () => {
    const salmon = YIELD_TEMPLATES[0];
    const t = await createYieldTestFromTemplate(salmon);
    expect(t.grossWeightKg).toBe(salmon.typicalGrossKg ?? 5);
    expect(t.name).toBe(salmon.name);
  });
});

describe('integración con escandallos', () => {
  it('un producto vinculado calcula con el coste €/kg útil de la prueba y el precio vigente', async () => {
    await db().products.put(product({ id: 'p1', name: 'Salmón', pricePerBase: 10 }));
    const t = await createYieldTest({
      name: 'Salmón',
      productId: 'p1',
      grossWeightKg: 10,
      cookingLossPct: 0,
      outputs: [
        { id: 'a', name: 'Lomos', weightKg: 5, kind: 'principal' },
        { id: 'b', name: 'Espinas', weightKg: 2, kind: 'subproducto', valuePerKg: 5 },
        { id: 'c', name: 'Piel', weightKg: 3, kind: 'desperdicio' },
      ],
    });
    await linkYieldTestToProduct(t.id, 'p1');
    const d = dish({ id: 'd1', name: 'Salmón a la plancha', items: [{ id: 'i1', name: 'Salmón', ref: { type: 'product', id: 'p1' }, quantity: 200, unit: 'g', basis: 'neta' }] });
    await db().dishes.put(d);
    const [products, dishes, tests] = await Promise.all([db().products.toArray(), db().dishes.toArray(), db().yieldTests.toArray()]);
    const ctx = buildCostingContext(products, dishes, tests, DEFAULT_BUSINESS_SETTINGS);
    const cost = costDish(dishes[0], ctx);
    // (10 kg · 10 € − 2 kg · 5 €) / 5 kg = 18 €/kg útil → 0,2 kg = 3,60 €
    expect(cost.costPerPortion).toBeCloseTo(3.6, 6);
    expect(cost.items[0].wasteSource).toBe('prueba');
    expect(cost.items[0].appliedWastePct).toBeCloseTo(50, 6);

    // Tras borrar la prueba, vuelve a la merma por defecto del producto
    await deleteYieldTest(t.id);
    const ctx2 = buildCostingContext(await db().products.toArray(), await db().dishes.toArray(), await db().yieldTests.toArray(), DEFAULT_BUSINESS_SETTINGS);
    expect(costDish((await db().dishes.get('d1'))!, ctx2).costPerPortion).toBeCloseTo(2, 6);
  });
});

describe('utilidades', () => {
  it('productPricePerKg', () => {
    expect(productPricePerKg(undefined)).toBeUndefined();
    expect(productPricePerKg({ baseUnit: 'kg', pricePerBase: 0 })).toBeUndefined();
    expect(productPricePerKg({ baseUnit: 'kg', pricePerBase: 8 })).toBe(8);
    expect(productPricePerKg({ baseUnit: 'ud', pricePerBase: 3 })).toBeUndefined();
    expect(productPricePerKg({ baseUnit: 'ud', pricePerBase: 3, unitWeightKg: 1.5 })).toBe(2);
    expect(productPricePerKg({ baseUnit: 'l', pricePerBase: 4.6, densityKgPerL: 0.92 })).toBeCloseTo(5, 6);
    expect(productPricePerKg({ baseUnit: 'l', pricePerBase: 2 })).toBe(2);
  });

  it('normalizeOutput mantiene el valor de subproductos y corrige tipos desconocidos', () => {
    expect(normalizeOutput({ name: 'Espinas', kind: 'subproducto', weightKg: 1, valuePerKg: 2 }).valuePerKg).toBe(2);
    expect(normalizeOutput({ name: 'X', kind: 'raro' as never, weightKg: 1 }).kind).toBe('principal');
    expect(normalizeOutput({ name: 'Y', kind: 'subproducto', weightKg: 1, valuePerKg: -1 }).valuePerKg).toBeUndefined();
  });
});

// ───────────────────────────── Lógica de presentación (components/yield) ─────────────────────────────

function yt(p: Partial<YieldTest>): YieldTest {
  return {
    id: 't1',
    name: 'Prueba',
    date: '2026-09-01',
    grossWeightKg: 10,
    purchasePricePerKg: 10,
    outputs: [],
    cookingLossPct: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...p,
  };
}

describe('model: tramos, cascada y restante', () => {
  const test = yt({
    thawLossPct: 10,
    cookingLossPct: 20,
    portionKg: 0.15,
    outputs: [
      { id: 'a', name: 'Limpio', weightKg: 6, kind: 'principal' },
      { id: 'b', name: 'Espinas', weightKg: 1.5, kind: 'subproducto', valuePerKg: 2 },
      { id: 'c', name: 'Piel', weightKg: 1, kind: 'desperdicio' },
    ],
  });
  const r = computeYield(test);

  it('remainingKg descuenta la descongelación', () => {
    expect(remainingKg(test)).toBeCloseTo(0.5, 9);
    expect(remainingKg({ ...test, outputs: [...test.outputs, { id: 'd', name: 'x', weightKg: 1, kind: 'desperdicio' }] })).toBeCloseTo(-0.5, 9);
  });

  it('pieceSegments suma el 100 % de la pieza', () => {
    const segs = pieceSegments(test, r);
    expect(segs.map((s) => s.key)).toEqual(['principal', 'subproducto', 'desperdicio', 'noRegistrado', 'descongelacion']);
    expect(segs.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
    expect(segs.find((s) => s.key === 'descongelacion')?.kg).toBeCloseTo(1, 9);
    expect(segs.find((s) => s.key === 'noRegistrado')?.kg).toBeCloseTo(0.5, 9);
    expect(segs[0].outputs).toHaveLength(1);
  });

  it('pieceSegments normaliza si las salidas pesan más que la pieza', () => {
    const over = yt({ grossWeightKg: 1, outputs: [{ id: 'a', name: 'x', weightKg: 1.5, kind: 'principal' }] });
    const segs = pieceSegments(over, computeYield(over));
    expect(segs.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
  });

  it('cascadeSteps encadena bruto → limpio → cocinado → raciones sin huecos', () => {
    const steps = cascadeSteps(test, r);
    const keys = steps.map((s) => s.key);
    expect(keys).toEqual(['bruto', 'descongelacion', 'desperdicio', 'noRegistrado', 'subproducto', 'limpio', 'coccion', 'cocinado', 'raciones']);
    const subIdx = keys.indexOf('subproducto');
    // Tras restar todas las pérdidas llegamos exactamente a la parte limpia
    expect(steps[subIdx].from).toBeCloseTo(6, 9);
    expect(steps.find((s) => s.key === 'coccion')?.kg).toBeCloseTo(1.2, 9);
    const raciones = steps.find((s) => s.key === 'raciones')!;
    expect(raciones.label).toBe('32 raciones');
    expect(raciones.kg).toBeCloseTo(4.8, 9);
    // 4,8 kg cocinados / 150 g = 32 raciones exactas: no hay sobrante
    expect(steps.find((s) => s.key === 'sobrante')).toBeUndefined();
    const withLeftover = { ...test, portionKg: 0.13 };
    const left = cascadeSteps(withLeftover, computeYield(withLeftover)).find((s) => s.key === 'sobrante');
    expect(left?.kg).toBeCloseTo(4.8 - 36 * 0.13, 9);
  });

  it('cascadeSteps vacía sin peso bruto', () => {
    expect(cascadeSteps(yt({ grossWeightKg: 0 }), computeYield(yt({ grossWeightKg: 0 })))).toEqual([]);
  });

  it('effectivePurchasePrice usa el precio vigente del producto en kg', () => {
    expect(effectivePurchasePrice({ purchasePricePerKg: 9 }, product({ id: 'x', name: 'x', pricePerBase: 12 }))).toBe(12);
    expect(effectivePurchasePrice({ purchasePricePerKg: 9 }, product({ id: 'x', name: 'x', pricePerBase: 0 }))).toBe(9);
    expect(effectivePurchasePrice({ purchasePricePerKg: 9 }, product({ id: 'x', name: 'x', baseUnit: 'ud', pricePerBase: 3 }))).toBe(9);
    expect(effectivePurchasePrice({ purchasePricePerKg: 9 }, undefined)).toBe(9);
  });

  it('buildYieldRows calcula factor y vínculo con el precio vigente', () => {
    const t = yt({ productId: 'p', outputs: [{ id: 'a', name: 'Limpio', weightKg: 5, kind: 'principal' }] });
    const rows = buildYieldRows([t], [product({ id: 'p', name: 'Salmón', pricePerBase: 20, yieldTestId: 't1' })]);
    expect(rows[0].linked).toBe(true);
    expect(rows[0].price).toBe(20);
    expect(rows[0].result.costPerUsableKg).toBeCloseTo(40, 9);
    expect(rows[0].factor).toBeCloseTo(2, 9);
  });
});

describe('productSearch', () => {
  const catalog = [
    product({ id: '1', name: 'Salmón noruego entero', aliases: ['SALMON FRESCO NORUEGA'] }),
    product({ id: '2', name: 'Merluza de pincho' }),
    product({ id: '3', name: 'Solomillo de ternera', category: 'carne' }),
    product({ id: '4', name: 'Pulpo cocido' }),
    product({ id: '5', name: 'Pulpo crudo congelado' }),
  ];

  it('normalizeQuery quita tildes, signos y mayúsculas', () => {
    expect(normalizeQuery('  Salmón  NORUEGO, 5-6kg ')).toBe('salmon noruego 5 6kg');
  });

  it('searchProducts encuentra por prefijo, tildes y alias', () => {
    expect(searchProducts('salm', catalog)[0]?.id).toBe('1');
    expect(searchProducts('SALMON', catalog)[0]?.id).toBe('1');
    expect(searchProducts('noruega', catalog)[0]?.id).toBe('1');
    expect(searchProducts('', catalog)).toEqual([]);
    expect(searchProducts('pulpo', catalog).map((p) => p.id).sort()).toEqual(['4', '5']);
  });

  it('bestProductForHint elige el producto de la plantilla', () => {
    expect(bestProductForHint('salmón', catalog)?.id).toBe('1');
    expect(bestProductForHint('solomillo de ternera', catalog)?.id).toBe('3');
    expect(bestProductForHint('piña', catalog)).toBeUndefined();
    expect(bestProductForHint('salmón', [])).toBeUndefined();
  });

  it('bestTemplateForProduct propone la plantilla adecuada', () => {
    expect(bestTemplateForProduct('Salmón noruego entero')?.name).toBe('Salmón entero');
    expect(bestTemplateForProduct('Pulpo crudo congelado T3')?.name).toMatch(/Pulpo/);
    expect(bestTemplateForProduct('Solomillo de ternera nacional')?.name).toMatch(/Solomillo/);
    expect(bestTemplateForProduct('Papel de horno')).toBeUndefined();
  });
});
