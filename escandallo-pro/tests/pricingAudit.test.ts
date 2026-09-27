/**
 * Auditoría de cifras: precios de compra, alertas y exportación. Casos límite que un restaurante encuentra en sus
 * facturas reales (mismo producto en varias líneas, facturas fuera de orden, abonos, unidades distintas…).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Invoice, InvoiceLine } from '../src/types';
import { createWorkspace, db, setCurrentWorkspaceId, updateBusinessSettings } from '../src/db';
import { normalizeInvoiceLine } from '../src/core/pack';
import { priceAlerts } from '../src/core/analytics';
import { buildCostingContext, costAllDishes } from '../src/core/costing';
import { uid } from '../src/lib/id';
import { createProduct, mergeConversionProps, mergeProducts } from '../src/services/products';
import { confirmInvoice, deleteInvoice, newInvoiceLine } from '../src/services/invoices';
import { createDish, newRecipeItem } from '../src/services/dishes';
import { exportEscandallosXlsx } from '../src/lib/export';
import { priceTrends } from '../src/components/purchases/logic';

const NOW = '2026-01-01T00:00:00.000Z';

function line(description: string, quantity: number, unit: string, unitPrice: number, total: number, extra: Partial<InvoiceLine> = {}): InvoiceLine {
  return normalizeInvoiceLine(newInvoiceLine({ description, quantity, unit, unitPrice, total, ...extra }));
}

function rawInvoice(inv: Partial<Invoice>): Invoice {
  return { id: uid(), supplierName: 'Makro', date: '2026-02-01', status: 'revision', lines: [], createdAt: NOW, ...inv };
}

beforeEach(async () => {
  const ws = await createWorkspace({ name: `Auditoría ${Math.random()}` });
  setCurrentWorkspaceId(ws.id);
});

describe('confirmInvoice: el mismo producto en varias líneas', () => {
  it('el precio vigente es la media ponderada por cantidad de la factura (no la última línea) y no genera alertas falsas', async () => {
    const arroz = await createProduct({ name: 'Arroz bomba', baseUnit: 'kg', pricePerBase: 2.3, lastPurchaseDate: '2026-01-10' });
    const inv = rawInvoice({
      lines: [
        // 10 kg a 2,40 €/kg (paquetes de 1 kg) + 5 kg a 2,20 €/kg (saco): media ponderada = 35 / 15 = 2,3333 €/kg
        line('ARROZ BOMBA 1KG', 10, 'ud', 2.4, 24, { productId: arroz.id, matchStatus: 'vinculado' }),
        line('ARROZ BOMBA SACO 5KG', 1, 'ud', 11, 11, { productId: arroz.id, matchStatus: 'vinculado' }),
      ],
    });
    await db().invoices.add(inv);
    expect(await confirmInvoice(inv.id)).toEqual({ created: 0, updated: 2, skipped: 0 });

    const p = await db().products.get(arroz.id);
    expect(p?.pricePerBase).toBeCloseTo(35 / 15, 6);
    const points = await db().pricePoints.where('invoiceId').equals(inv.id).toArray();
    expect(points).toHaveLength(1);
    expect(points[0].rawDescription).toBe('ARROZ BOMBA 1KG + ARROZ BOMBA SACO 5KG');

    // 2,30 → 2,3333 = +1,4 %: por debajo del umbral del 5 %, sin alerta. Antes: 2,40 → 2,20 dentro de la MISMA factura (−8,3 %).
    const all = await db().pricePoints.toArray();
    const products = await db().products.toArray();
    expect(priceAlerts(products, all, 5)).toEqual([]);
    expect(priceTrends(all).get(arroz.id)?.changePct).toBeCloseTo((35 / 15 / 2.3 - 1) * 100, 3);

    // Re-confirmar es idempotente
    await confirmInvoice(inv.id);
    expect(await db().pricePoints.where('invoiceId').equals(inv.id).count()).toBe(1);
    expect((await db().products.get(arroz.id))?.pricePerBase).toBeCloseTo(35 / 15, 6);
  });

  it('pondera en la unidad del producto aunque las líneas vengan en unidades distintas', async () => {
    // Huevos por unidad (60 g): una línea por docenas y otra por kg
    const huevo = await createProduct({ name: 'Huevo M', baseUnit: 'ud', pricePerBase: 0.2, unitWeightKg: 0.06, lastPurchaseDate: '2026-01-10' });
    const inv = rawInvoice({
      lines: [
        line('HUEVOS M', 30, 'docena', 2.4, 72, { productId: huevo.id, matchStatus: 'vinculado' }), // 360 ud a 0,20 €
        line('HUEVO M GRANEL', 6, 'kg', 3.5, 21, { productId: huevo.id, matchStatus: 'vinculado' }), // 100 ud a 0,21 €
      ],
    });
    await db().invoices.add(inv);
    await confirmInvoice(inv.id);
    expect((await db().products.get(huevo.id))?.pricePerBase).toBeCloseTo(93 / 460, 6);
  });

  it('un producto nuevo que aparece en dos líneas se crea una vez con la media ponderada', async () => {
    const inv = rawInvoice({
      lines: [
        line('TOMATE PERA', 10, 'kg', 1.8, 18, { suggestedName: 'Tomate pera' }),
        line('TOMATE PERA OFERTA', 20, 'kg', 1.5, 30, { suggestedName: 'Tomate pera' }),
      ],
    });
    await db().invoices.add(inv);
    expect(await confirmInvoice(inv.id)).toEqual({ created: 1, updated: 1, skipped: 0 });
    const products = await db().products.toArray();
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ name: 'Tomate pera', lastPurchaseDate: '2026-02-01', priceSource: 'factura' });
    expect(products[0].pricePerBase).toBeCloseTo(48 / 30, 6);
    expect(await db().pricePoints.count()).toBe(1);
  });
});

describe('confirmInvoice: orden de fechas y borrado', () => {
  it('una factura antigua confirmada después no pisa el precio vigente; borrar la última devuelve el anterior', async () => {
    const aceite = await createProduct({ name: 'Aceite de oliva virgen extra', baseUnit: 'l', pricePerBase: 6, lastPurchaseDate: '2026-01-05' });
    const nueva = rawInvoice({ date: '2026-03-01', lines: [line('AOVE 5L', 2, 'ud', 40, 80, { productId: aceite.id, matchStatus: 'vinculado' })] });
    const vieja = rawInvoice({ date: '2026-02-01', lines: [line('AOVE 5L', 1, 'ud', 35, 35, { productId: aceite.id, matchStatus: 'vinculado' })] });
    await db().invoices.bulkAdd([nueva, vieja]);
    await confirmInvoice(nueva.id);
    await confirmInvoice(vieja.id);
    expect(await db().products.get(aceite.id)).toMatchObject({ pricePerBase: 8, lastPurchaseDate: '2026-03-01' });
    await deleteInvoice(nueva.id);
    expect(await db().products.get(aceite.id)).toMatchObject({ pricePerBase: 7, lastPurchaseDate: '2026-02-01' });
  });
});

describe('exportación a Excel: mismas cifras que la app', () => {
  async function loadWorkbook(blob: Blob) {
    const mod = (await import('exceljs')) as typeof import('exceljs') & { default?: typeof import('exceljs') };
    const ExcelJS = mod.default ?? mod;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    return wb;
  }
  type CF = { ref: string; rules: { formulae: string[] }[] };

  it('un plato con PVP pero sin coste no sale con 0 % de food cost ni entra en la media; el semáforo usa la cifra mostrada', async () => {
    await updateBusinessSettings({ targetFoodCostPct: 30, warningFoodCostPct: 35 });
    const carne = await createProduct({ name: 'Carrillera de ibérico', baseUnit: 'kg', pricePerBase: 15, wastePct: 0 });
    // 300 g × 15 €/kg = 4,50 € sobre 16,50 € (IVA 10 %) = 30,000000000000004 %
    const justo = await createDish({
      name: 'Carrillera',
      menuPrice: 16.5,
      items: [{ ...newRecipeItem({ name: 'Carrillera', quantity: 300, unit: 'g', basis: 'neta' }), ref: { type: 'product', id: carne.id } }],
    });
    const vacio = await createDish({ name: 'Plato sin receta', menuPrice: 12 });
    const products = await db().products.toArray();
    const dishes = await db().dishes.toArray();
    const business = { ...(await db().business.get('business'))!, targetFoodCostPct: 30, warningFoodCostPct: 35 };
    const ctx = buildCostingContext(products, dishes, [], business);
    const costs = costAllDishes(ctx);
    expect(costs.get(justo.id)!.foodCostPct).toBeGreaterThan(30);
    const wb = await loadWorkbook(await exportEscandallosXlsx({ workspace: { id: 'w', name: 'Casa', createdAt: NOW, updatedAt: NOW }, dishes, costs, ctx, business }));
    const summary = wb.getWorksheet('Resumen')!;
    // Media de la carta = sólo la carrillera (30 %), no (30 + 0) / 2
    expect(String(summary.getCell('A2').value)).toContain('Food cost medio 30,0 %');
    const rowOf = (name: string) => [5, 6].map((r) => summary.getRow(r)).find((r) => (r.getCell(1).value as { text: string }).text === name)!;
    const empty = rowOf('Plato sin receta');
    const fc = empty.getCell(9).value as { formula: string; result: unknown };
    expect(fc.result ?? '').toBe('');
    expect(fc.formula).toBe(`IF(AND(ISNUMBER(G${empty.number}),G${empty.number}>0,H${empty.number}>0),H${empty.number}/G${empty.number},"")`);
    expect((empty.getCell(11).value as { result: unknown }).result ?? '').toBe('');
    expect((empty.getCell(12).value as { result: unknown }).result ?? '').toBe('');
    const avg = summary.getRow(8).getCell(9).value as { result: number };
    expect(avg.result).toBeCloseTo(0.3, 9);
    // Semáforo sobre el valor redondeado a la décima (formato 0,0 %), como en la app
    const cfs = (summary as unknown as { conditionalFormattings: CF[] }).conditionalFormattings;
    expect(cfs.find((c) => c.ref === 'I5:I6')!.rules[0].formulae[0]).toBe('AND(ISNUMBER(I5),ROUND(I5,3)<=J5)');
    // Ficha del plato vacío: sin food cost ni margen
    const sheet = wb.getWorksheet('Plato sin receta')!;
    expect((sheet.getCell('H4').value as { result: unknown }).result ?? '').toBe('');
    expect((sheet.getCell('H6').value as { result: unknown }).result ?? '').toBe('');
    expect((sheet.getCell('H4').value as { formula: string }).formula).toBe('IF(AND(ISNUMBER(B8),B8>0,B9>0),B9/B8,"")');
  });
});

describe('confirmInvoice: abonos', () => {
  it('una línea de abono con importe negativo no fija el precio del producto aunque la cantidad venga en positivo', async () => {
    const tomate = await createProduct({ name: 'Tomate pera', baseUnit: 'kg', pricePerBase: 1.8, lastPurchaseDate: '2026-01-10' });
    const inv = rawInvoice({
      lines: [
        line('TOMATE PERA', 10, 'kg', 1.9, 19, { productId: tomate.id, matchStatus: 'vinculado' }),
        // Abono por mal estado: 1 kg × 5 € = −5 € (el signo sólo en el importe)
        line('ABONO TOMATE PERA MAL ESTADO', 1, 'kg', 5, -5, { productId: tomate.id, matchStatus: 'vinculado' }),
        // Devolución clásica: cantidad e importe negativos
        line('DEVOLUCION TOMATE PERA', -2, 'kg', 1.9, -3.8, { productId: tomate.id, matchStatus: 'vinculado' }),
      ],
    });
    await db().invoices.add(inv);
    expect(await confirmInvoice(inv.id)).toEqual({ created: 0, updated: 1, skipped: 2 });
    expect((await db().products.get(tomate.id))?.pricePerBase).toBeCloseTo(1.9, 6);
    const points = await db().pricePoints.where('invoiceId').equals(inv.id).toArray();
    expect(points.map((p) => p.pricePerBase)).toEqual([1.9]);
  });
});

describe('exportación a Excel: semáforo igual que en la app', () => {
  async function loadWorkbook(blob: Blob) {
    const mod = (await import('exceljs')) as typeof import('exceljs') & { default?: typeof import('exceljs') };
    const ExcelJS = mod.default ?? mod;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    return wb;
  }
  type CF = { ref: string; rules: { formulae: string[] }[] };

  it('con objetivo propio, la franja ámbar se desplaza con él (pestaña y formato condicional) y sin peso no hay «0 %» de merma', async () => {
    await updateBusinessSettings({ targetFoodCostPct: 30, warningFoodCostPct: 35 });
    const gamba = await createProduct({ name: 'Gamba roja', baseUnit: 'kg', pricePerBase: 40, wastePct: 0 });
    const pan = await createProduct({ name: 'Pan de hogaza', baseUnit: 'ud', pricePerBase: 1.2 });
    // 100 g × 40 € = 4 € sobre 10 € sin IVA = 40 %: con objetivo 38 % y franja de 5 puntos → ámbar (hasta 43 %)
    await createDish({
      name: 'Gambas',
      menuPrice: 11,
      targetFoodCostPct: 38,
      items: [{ ...newRecipeItem({ name: 'Gamba', quantity: 100, unit: 'g', basis: 'neta' }), ref: { type: 'product', id: gamba.id } }],
    });
    await createDish({
      name: 'Tostada',
      menuPrice: 4.4,
      items: [{ ...newRecipeItem({ name: 'Pan', quantity: 1, unit: 'ud', basis: 'neta' }), ref: { type: 'product', id: pan.id } }],
    });
    const products = await db().products.toArray();
    const dishes = await db().dishes.toArray();
    const business = { ...(await db().business.get('business'))!, targetFoodCostPct: 30, warningFoodCostPct: 35 };
    const ctx = buildCostingContext(products, dishes, [], business);
    const costs = costAllDishes(ctx);
    const wb = await loadWorkbook(await exportEscandallosXlsx({ workspace: { id: 'w', name: 'Casa', createdAt: NOW, updatedAt: NOW }, dishes, costs, ctx, business }));
    const summary = wb.getWorksheet('Resumen')!;
    const cfs = (summary as unknown as { conditionalFormattings: CF[] }).conditionalFormattings;
    expect(cfs.find((c) => c.ref === 'I5:I6')!.rules.map((r) => r.formulae[0])).toEqual([
      'AND(ISNUMBER(I5),ROUND(I5,3)<=J5)',
      'AND(ISNUMBER(I5),ROUND(I5,3)>J5,ROUND(I5,3)<=J5+0.05)',
      'AND(ISNUMBER(I5),ROUND(I5,3)>J5+0.05)',
    ]);
    const sheet = wb.getWorksheet('Gambas')!;
    // Ámbar en la pestaña (como en la ficha de la app), no rojo
    expect(sheet.properties.tabColor?.argb).toBe('FFF59E0B');
    const dishCf = (sheet as unknown as { conditionalFormattings: CF[] }).conditionalFormattings.find((c) => c.ref === 'H4')!;
    expect(dishCf.rules[1].formulae[0]).toBe('AND(ISNUMBER(H4),ROUND(H4,3)>H5,ROUND(H4,3)<=H5+0.05)');
    // La tostada (pan por unidades sin peso) no tiene datos de peso: merma en blanco, no «0,0 %»
    const tostada = [5, 6].map((r) => summary.getRow(r)).find((r) => (r.getCell(1).value as { text: string }).text === 'Tostada')!;
    expect(tostada.getCell(14).value ?? '').toBe('');
    expect(tostada.getCell(15).value ?? '').toBe('');
  });
});

describe('fusionar productos con distinta unidad', () => {
  it('los precios por unidad del duplicado se pasan a €/kg con SU peso por unidad (no con el peso orientativo del otro)', async () => {
    // «Limón» por kg trae el peso medio de la base de conocimiento; la malla declara el peso real de sus limones (150 g).
    const limonKg = await createProduct({ name: 'Limón', baseUnit: 'kg', pricePerBase: 2, lastPurchaseDate: '2026-01-01' });
    const malla = await createProduct({ name: 'Limones malla', baseUnit: 'ud', pricePerBase: 0.3, unitWeightKg: 0.15, lastPurchaseDate: '2026-02-01' });
    expect(limonKg.unitWeightKg).toBeDefined();
    expect(limonKg.unitWeightKg).not.toBe(0.15);
    expect(mergeConversionProps(limonKg, malla).unitWeightKg).toBe(0.15);
    await mergeProducts(limonKg.id, malla.id);
    // 0,30 €/ud ÷ 0,15 kg = 2 €/kg: mismo precio, sin subida falsa del 25 %
    expect((await db().products.get(limonKg.id))?.pricePerBase).toBeCloseTo(2, 6);
    const points = await db().pricePoints.toArray();
    expect(points.map((p) => p.pricePerBase).sort()).toEqual([2, 2]);
    expect(priceAlerts(await db().products.toArray(), points, 5)).toEqual([]);
  });
});
