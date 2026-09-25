import { describe, expect, it } from 'vitest';
import type { InvoiceLine, Product } from '../../types';
import { recomputeLine } from './lineEdit';
import { planPriceImport } from './priceImport';
import { parsePriceRows } from './logic';
import { parseNumberEs } from '../../core/numbers';

const line = (p: Partial<InvoiceLine> = {}): InvoiceLine => ({
  id: 'l1',
  description: 'LECHE ENTERA 6X1L',
  quantity: 2,
  unit: 'pack',
  unitPrice: 5.4,
  total: 10.8,
  matchStatus: 'nuevo',
  ...p,
});

const product = (p: Partial<Product> & { id: string; name: string }): Product => ({
  searchKey: p.name.toLowerCase(),
  aliases: [],
  category: 'verdura',
  baseUnit: 'kg',
  pricePerBase: 1,
  priceSource: 'factura',
  wastePct: 0,
  cookingLossPct: 0,
  allergens: [],
  createdAt: '',
  updatedAt: '',
  ...p,
});

describe('recomputeLine (edición en la revisión)', () => {
  it('calcula el €/ud base detectando el formato de la descripción', () => {
    const r = recomputeLine(line(), { quantity: 3 }, false);
    expect(r.total).toBe(16.2);
    expect(r.baseUnit).toBe('l');
    expect(r.baseQuantity).toBeCloseTo(18);
    expect(r.pricePerBase).toBeCloseTo(0.9);
  });

  it('un formato fijado a mano manda sobre la descripción', () => {
    const r = recomputeLine(line(), { packSize: { count: 12, size: 1, unit: 'l' } }, true);
    expect(r.baseQuantity).toBeCloseTo(24);
    expect(r.pricePerBase).toBeCloseTo(0.45);
    const r2 = recomputeLine(r, { description: 'LECHE SEMI 6X1L' }, true);
    expect(r2.packSize).toEqual({ count: 12, size: 1, unit: 'l' });
  });

  it('al cambiar la descripción vuelve a detectar el formato si no se fijó a mano', () => {
    const base = recomputeLine(line(), { quantity: 2 }, false);
    const r = recomputeLine(base, { description: 'ACEITE OLIVA V.E. GARRAFA 5L', quantity: 1, unit: 'ud', unitPrice: 32.5 }, false);
    expect(r.packSize?.size).toBe(5);
    expect(r.baseUnit).toBe('l');
    expect(r.pricePerBase).toBeCloseTo(6.5);
  });

  it('en líneas nuevas el nombre propuesto sigue a la descripción salvo que se haya personalizado', () => {
    const auto = recomputeLine(line({ suggestedName: undefined }), { description: 'TOMATE PERA CAT.I CAJA 6KG' }, false);
    expect(auto.suggestedName?.toLowerCase()).toContain('tomate');
    const custom = recomputeLine(line({ suggestedName: 'Mi leche' }), { description: 'TOMATE PERA CAJA 6KG' }, false);
    expect(custom.suggestedName).toBe('Mi leche');
  });

  it('cambios que no afectan al precio no recalculan', () => {
    const l = line({ pricePerBase: 123 });
    expect(recomputeLine(l, { matchStatus: 'ignorado' }, false).pricePerBase).toBe(123);
  });
});

describe('planPriceImport (tarifas)', () => {
  const rows = [
    ['Artículo', 'Ud', 'Precio'],
    ['TOMATE PERA CAT I', 'kg', '1,45'],
    ['ACEITE OLIVA VIRGEN EXTRA GARRAFA 5L', 'ud', '32,50'],
    ['Queso manchego curado', 'kg', '14,90'],
    ['Queso manchego curado', 'kg', '15,10'],
    ['Artículo sin precio', 'kg', ''],
  ];
  const parsed = parsePriceRows(rows, { description: 0, unit: 1, unitPrice: 2 }, 0, parseNumberEs);
  const products = [
    product({ id: 'tom', name: 'Tomate pera', aliases: ['TOMATE PERA CAT I'] }),
    product({ id: 'ace', name: 'Aceite de oliva virgen extra', baseUnit: 'l', category: 'aceite' }),
  ];

  it('actualiza lo que reconoce, crea lo nuevo una sola vez y omite lo que no tiene precio', () => {
    const plan = planPriceImport(parsed, products, true);
    expect(plan.rows).toHaveLength(4);
    const tom = plan.rows.find((r) => r.row.description.startsWith('TOMATE'));
    expect(tom?.action).toBe('update');
    expect(tom?.product?.id).toBe('tom');
    expect(tom?.pricePerBase).toBeCloseTo(1.45);
    const ace = plan.rows.find((r) => r.row.description.startsWith('ACEITE'));
    expect(ace?.baseUnit).toBe('l');
    expect(ace?.pricePerBase).toBeCloseTo(6.5);
    expect(ace?.action).toBe('update');
    expect(plan.creates).toBe(1);
    expect(plan.rows.filter((r) => r.action === 'create')).toHaveLength(2);
  });

  it('sin crear nuevos, sólo actualiza', () => {
    const plan = planPriceImport(parsed, products, false);
    expect(plan.creates).toBe(0);
    expect(plan.updates).toBe(2);
    expect(plan.skips).toBe(2);
  });

  it('convierte a la unidad del ingrediente cuando conoce su peso por unidad', () => {
    const plan = planPriceImport(parsed, [product({ id: 'tom', name: 'Tomate pera', baseUnit: 'ud', unitWeightKg: 0.2, aliases: ['TOMATE PERA CAT I'] })], true);
    const tom = plan.rows.find((r) => r.row.description.startsWith('TOMATE'));
    expect(tom?.action).toBe('update');
    expect(tom?.baseUnit).toBe('ud');
    expect(tom?.pricePerBase).toBeCloseTo(0.29);
  });

  it('no actualiza un producto con unidad distinta si no se puede convertir (evita precios erróneos)', () => {
    const plan = planPriceImport(
      parsed,
      [product({ id: 'tom', name: 'Tomate pera', baseUnit: 'ud', aliases: ['TOMATE PERA CAT I'] })],
      true,
    );
    const tom = plan.rows.find((r) => r.row.description.startsWith('TOMATE'));
    expect(tom?.action).toBe('create');
    expect(tom?.warnings.join(' ')).toMatch(/no se puede convertir/);
  });
});

describe('lineConversion', () => {
  it('misma unidad, conversión posible o imposible', async () => {
    const { lineConversion } = await import('./lineEdit');
    const huevo = product({ id: 'h', name: 'Huevo', baseUnit: 'ud', unitWeightKg: 0.06 });
    expect(lineConversion({ baseUnit: 'ud', pricePerBase: 0.2 }, huevo)).toEqual({ kind: 'same' });
    const conv = lineConversion({ baseUnit: 'kg', pricePerBase: 3 }, huevo);
    expect(conv.kind).toBe('convert');
    if (conv.kind === 'convert') expect(conv.pricePerProductUnit).toBeCloseTo(0.18);
    const sinPeso = product({ id: 'x', name: 'Lechuga', baseUnit: 'ud' });
    const inc = lineConversion({ baseUnit: 'kg', pricePerBase: 2 }, sinPeso);
    expect(inc.kind).toBe('incompatible');
  });
});
