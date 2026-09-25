import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dish, DishProposal, ExtractedInvoice, ExtractedMenu, Invoice, InvoiceLine, MenuScan, Product, ProposedIngredient, YieldTest } from '../src/types';
import { createWorkspace, db, getCurrentWorkspaceId, setCurrentWorkspaceId, updateAppSettings, updateBusinessSettings } from '../src/db';
import { toSearchKey, AUTO_LINK_THRESHOLD, SUGGEST_THRESHOLD } from '../src/core/matching';
import { normalizeInvoiceLine } from '../src/core/pack';
import { buildCostingContext, costAllDishes } from '../src/core/costing';
import { uid } from '../src/lib/id';
import * as extract from '../src/extract/index';
import * as kbIngredients from '../src/kb/ingredients';
import * as kbPropose from '../src/kb/propose';
import * as aiRecipes from '../src/ai/recipes';
import {
  addProductAlias,
  createProduct,
  deleteProduct,
  findOrCreateSupplier,
  mergeProducts,
  priceConversionFactor,
  recomputeCurrentPrice,
  setProductPrice,
  supplierKey,
  updateProduct,
} from '../src/services/products';
import {
  addInvoiceFiles,
  confirmInvoice,
  createManualInvoice,
  deleteInvoice,
  matchInvoiceLines,
  newInvoiceLine,
  processInvoice,
  resumePendingInvoices,
  subscribeInvoiceQueue,
  updateInvoice,
  type QueueState,
} from '../src/services/invoices';
import { createDish, deleteDish, duplicateDish, newRecipeItem, proposalToItems, proposeForDishes, rematchDish, updateDish } from '../src/services/dishes';
import { addMenuScan, deleteMenuScan, importMenuEntries, processMenuScan } from '../src/services/menus';
import { XLSX_MIME, exportEscandallosXlsx, exportProductsXlsx, safeSheetName, toCsv } from '../src/lib/export';

// ───────────────────────────── Dobles de prueba ─────────────────────────────

vi.mock('../src/extract/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/extract/index')>();
  return { ...actual, extractInvoicesFromFile: vi.fn(), extractMenuFromFiles: vi.fn() };
});
// En Node no hay canvas: el preprocesado falla y se guardan los originales.
vi.mock('../src/extract/ocr', () => ({
  preprocessImage: vi.fn(() => Promise.reject(new Error('Sin canvas en Node'))),
  ocrImages: vi.fn(() => Promise.reject(new Error('Sin OCR en Node'))),
}));
vi.mock('../src/kb/ingredients', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/kb/ingredients')>();
  return { ...actual, findKbIngredient: vi.fn(actual.findKbIngredient) };
});
vi.mock('../src/kb/propose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/kb/propose')>();
  return { ...actual, proposeDishLocal: vi.fn(actual.proposeDishLocal) };
});
vi.mock('../src/ai/recipes', () => ({ aiProposeRecipesDetailed: vi.fn(), aiProposeRecipes: vi.fn() }));

const extractInvoices = vi.mocked(extract.extractInvoicesFromFile);
const extractMenu = vi.mocked(extract.extractMenuFromFiles);
const findKb = vi.mocked(kbIngredients.findKbIngredient);
const proposeLocal = vi.mocked(kbPropose.proposeDishLocal);
const aiDetailed = vi.mocked(aiRecipes.aiProposeRecipesDetailed);

// ───────────────────────────── Utilidades ─────────────────────────────

const NOW = '2026-01-01T00:00:00.000Z';

function rawProduct(p: Partial<Product> & { name: string }): Product {
  return {
    id: uid(),
    searchKey: toSearchKey(p.name),
    aliases: [],
    category: 'otros',
    baseUnit: 'kg',
    pricePerBase: 0,
    priceSource: 'manual',
    wastePct: 0,
    cookingLossPct: 0,
    allergens: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...p,
  };
}

function rawDish(d: Partial<Dish> & { name: string }): Dish {
  return {
    id: uid(),
    kind: 'plato',
    saleVatPct: 10,
    portions: 1,
    items: [],
    status: 'borrador',
    source: 'manual',
    createdAt: NOW,
    updatedAt: NOW,
    ...d,
  };
}

function line(description: string, quantity: number, unit: string, unitPrice: number, total: number, extra: Partial<InvoiceLine> = {}): InvoiceLine {
  return normalizeInvoiceLine(newInvoiceLine({ description, quantity, unit, unitPrice, total, ...extra }));
}

function rawInvoice(inv: Partial<Invoice>): Invoice {
  return {
    id: uid(),
    supplierName: 'Frutas García S.L.',
    date: '2026-02-01',
    status: 'revision',
    lines: [],
    createdAt: NOW,
    ...inv,
  };
}

function extracted(lines: Omit<InvoiceLine, 'id' | 'matchStatus'>[], extra: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return { supplierName: 'Frutas García S.L.', date: '2026-03-02', number: 'F-001', lines, method: 'pdf-texto', warnings: [], ...extra };
}

function exLine(description: string, quantity: number, unit: string, unitPrice: number, total: number): Omit<InvoiceLine, 'id' | 'matchStatus'> {
  const { id: _id, matchStatus: _m, ...rest } = line(description, quantity, unit, unitPrice, total);
  return rest;
}

function proposal(name: string, ingredients: ProposedIngredient[], extra: Partial<DishProposal> = {}): DishProposal {
  return { dishName: name, portions: 1, ingredients, source: 'plantilla', confidence: 0.9, ...extra };
}

function ing(name: string, quantity: number, unit: ProposedIngredient['unit'] = 'g', extra: Partial<ProposedIngredient> = {}): ProposedIngredient {
  return { name, quantity, unit, basis: 'neta', ...extra };
}

let wsId = '';

beforeEach(async () => {
  const ws = await createWorkspace({ name: `Servicios ${Math.random()}` });
  wsId = ws.id;
  setCurrentWorkspaceId(ws.id);
  extractInvoices.mockReset();
  extractMenu.mockReset();
  aiDetailed.mockReset();
  proposeLocal.mockClear();
  findKb.mockClear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await updateAppSettings({ aiEnabled: false, apiKey: undefined });
});

// ───────────────────────────── Productos ─────────────────────────────

describe('createProduct', () => {
  it('completa los valores por defecto con la base de conocimiento y calcula la clave de búsqueda', async () => {
    const p = await createProduct({ name: '  Perejil  ' });
    expect(p.name).toBe('Perejil');
    expect(p.searchKey).toBe(toSearchKey('Perejil'));
    expect(p.aliases).toEqual([]);
    expect(p.priceSource).toBe('manual');
    expect(p.pricePerBase).toBe(0);
    const kb = kbIngredients.findKbIngredient('Perejil');
    if (kb) {
      expect(p.category).toBe(kb.category);
      expect(p.baseUnit).toBe(kb.baseUnit);
      expect(p.wastePct).toBe(kb.wastePct);
      expect(p.cookingLossPct).toBe(kb.cookingLossPct);
    }
    expect(await db().pricePoints.count()).toBe(0);
    expect(await db().products.get(p.id)).toMatchObject({ name: 'Perejil' });
  });

  it('los datos explícitos mandan sobre la base de conocimiento y el precio inicial crea un PricePoint', async () => {
    const p = await createProduct({ name: 'Huevo', baseUnit: 'kg', category: 'otros', wastePct: 12, pricePerBase: 3.4, lastPurchaseDate: '2026-01-05' });
    expect(p).toMatchObject({ baseUnit: 'kg', category: 'otros', wastePct: 12, pricePerBase: 3.4, lastPurchaseDate: '2026-01-05' });
    const kb = kbIngredients.findKbIngredient('Huevo');
    if (kb?.unitWeightKg) expect(p.unitWeightKg).toBe(kb.unitWeightKg);
    if (kb?.allergens.length) expect(p.allergens).toEqual(kb.allergens);
    const points = await db().pricePoints.where('productId').equals(p.id).toArray();
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ pricePerBase: 3.4, date: '2026-01-05', source: 'manual' });
  });

  it('deduplica alias ignorando mayúsculas, tildes y signos, y descarta el propio nombre', async () => {
    const p = await createProduct({
      name: 'Tomate pera',
      aliases: ['TOMATE PERA', 'Tomate Pera Cat I 6kg', 'tomate pera cat. i 6 kg', '', 'TOMATE PERA CAT.I CAJA 6KG'],
    });
    expect(p.aliases).toEqual(['Tomate Pera Cat I 6kg', 'TOMATE PERA CAT.I CAJA 6KG']);
  });

  it('funciona aunque la base de conocimiento falle', async () => {
    findKb.mockImplementationOnce(() => {
      throw new Error('No implementado: findKbIngredient');
    });
    const p = await createProduct({ name: 'Ingrediente misterioso' });
    expect(p).toMatchObject({ category: 'otros', baseUnit: 'kg', wastePct: 0, cookingLossPct: 0, allergens: [] });
    expect(p.searchKey).toBe(toSearchKey('Ingrediente misterioso'));
  });

  it('rechaza nombres vacíos', async () => {
    await expect(createProduct({ name: '   ' })).rejects.toThrow('nombre');
  });
});

describe('precios, alias y proveedores', () => {
  it('setProductPrice sólo cambia el precio vigente con fechas iguales o posteriores', async () => {
    const p = await createProduct({ name: 'Harina de trigo', baseUnit: 'kg', pricePerBase: 0.8, lastPurchaseDate: '2026-02-01' });
    await setProductPrice(p.id, 0.7, 'factura', { date: '2026-01-15' });
    expect((await db().products.get(p.id))?.pricePerBase).toBe(0.8);
    await setProductPrice(p.id, 0.95, 'factura', { date: '2026-02-10', rawDescription: 'HARINA T45 25KG' });
    expect(await db().products.get(p.id)).toMatchObject({ pricePerBase: 0.95, priceSource: 'factura', lastPurchaseDate: '2026-02-10' });
    expect(await db().pricePoints.where('productId').equals(p.id).count()).toBe(3);
    await expect(setProductPrice(p.id, 0, 'manual')).rejects.toThrow();
  });

  it('recomputeCurrentPrice toma el último precio por fecha', async () => {
    const p = await createProduct({ name: 'Nata 35 %', baseUnit: 'l', pricePerBase: 3.1, lastPurchaseDate: '2026-01-01' });
    await setProductPrice(p.id, 3.5, 'factura', { date: '2026-03-01' });
    const last = await db().pricePoints.where('productId').equals(p.id).and((pp) => pp.date === '2026-03-01').first();
    await db().pricePoints.delete(last?.id as string);
    expect(await recomputeCurrentPrice(p.id)).toBe(3.1);
    expect(await db().products.get(p.id)).toMatchObject({ pricePerBase: 3.1, lastPurchaseDate: '2026-01-01' });
  });

  it('updateProduct recalcula la clave y limpia los alias', async () => {
    const p = await createProduct({ name: 'Pimiento', aliases: ['Pimiento rojo'] });
    await updateProduct(p.id, { name: 'Pimiento rojo', wastePct: 150 });
    const after = await db().products.get(p.id);
    expect(after?.searchKey).toBe(toSearchKey('Pimiento rojo'));
    expect(after?.aliases).toEqual([]);
    expect(after?.wastePct).toBe(99);
    await expect(updateProduct('no-existe', { name: 'x' })).rejects.toThrow();
  });

  it('addProductAlias no duplica', async () => {
    const p = await createProduct({ name: 'Queso manchego curado' });
    await addProductAlias(p.id, 'QUESO MANCHEGO CURADO 3KG');
    await addProductAlias(p.id, 'queso manchego curado 3 kg');
    await addProductAlias(p.id, 'QUESO MANCHEGO CURADO');
    expect((await db().products.get(p.id))?.aliases).toEqual(['QUESO MANCHEGO CURADO 3KG']);
  });

  it('findOrCreateSupplier reconoce el mismo proveedor por nombre normalizado o CIF', async () => {
    const a = await findOrCreateSupplier('Frutas García, S.L.');
    const b = await findOrCreateSupplier('FRUTAS GARCIA SL', 'B12345678');
    expect(b.id).toBe(a.id);
    expect(b.taxId).toBe('B12345678');
    const c = await findOrCreateSupplier('Distribuciones Frutas García', 'ES-B12345678');
    expect(c.id).toBe(a.id);
    const d = await findOrCreateSupplier('Pescados del Norte S.A.');
    expect(d.id).not.toBe(a.id);
    expect(await db().suppliers.count()).toBe(2);
    expect(supplierKey('Hermanos Pérez, S. L. U.')).toBe('hermanos perez');
  });

  it('priceConversionFactor convierte con densidad y peso por unidad', () => {
    expect(priceConversionFactor('l', 'kg', { densityKgPerL: 0.92 })?.factor).toBeCloseTo(1 / 0.92, 6);
    expect(priceConversionFactor('ud', 'kg', { unitWeightKg: 0.06 })?.factor).toBeCloseTo(1 / 0.06, 6);
    expect(priceConversionFactor('kg', 'ud', { unitWeightKg: 0.06 })?.factor).toBeCloseTo(0.06, 6);
    expect(priceConversionFactor('kg', 'ud', {})).toBeUndefined();
    expect(priceConversionFactor('kg', 'l', {})?.assumption).toMatch(/densidad/);
  });
});

// ───────────────────────────── Facturas ─────────────────────────────

describe('matchInvoiceLines', () => {
  it('vincula, sugiere o marca como nuevo y respeta ignoradas y vínculos manuales', () => {
    const tomate = rawProduct({ name: 'Tomate pera' });
    const aceite = rawProduct({ name: 'Aceite de oliva virgen extra', baseUnit: 'l' });
    const lines = [
      line('TOMATE PERA CAT.I CAJA 6KG', 2, 'caja', 10.8, 21.6, { suggestedName: 'Tomate pera' }),
      line('ACEITE OLIVA V.E. GARRAFA 5L', 2, 'ud', 22.5, 45),
      line('SERVILLETAS PAPEL 40X40', 1, 'caja', 12, 12),
      line('PORTES', 1, 'ud', 5, 5, { matchStatus: 'ignorado' }),
      line('TOMATE CHERRY', 1, 'kg', 4, 4, { matchStatus: 'vinculado', productId: aceite.id }),
    ];
    const out = matchInvoiceLines(lines, [tomate, aceite]);
    expect(out[0]).toMatchObject({ productId: tomate.id, matchStatus: 'vinculado' });
    expect(out[0].matchScore).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
    expect(out[1]).toMatchObject({ productId: aceite.id, matchStatus: 'vinculado' });
    expect(out[2].matchStatus).toBe('nuevo');
    expect(out[2].productId).toBeUndefined();
    expect(out[3]).toBe(lines[3]);
    expect(out[4]).toBe(lines[4]);
  });
});

describe('confirmInvoice', () => {
  async function setup() {
    const tomate = await createProduct({ name: 'Tomate pera', baseUnit: 'kg', pricePerBase: 1.5, lastPurchaseDate: '2026-01-10' });
    const inv = rawInvoice({
      lines: [
        line('TOMATE PERA CAT.I CAJA 6KG', 2, 'caja', 10.8, 21.6, { productId: tomate.id, matchStatus: 'vinculado', suggestedName: 'Tomate pera' }),
        line('PEREJIL MANOJO', 10, 'ud', 0.6, 6, { suggestedName: 'Perejil', suggestedCategory: 'verdura' }),
        line('PORTES', 1, 'ud', 5, 5, { matchStatus: 'ignorado' }),
        line('ACEITE OLIVA V.E. GARRAFA 5L', 2, 'ud', 22.5, 45, { suggestedName: 'Aceite de oliva virgen extra', suggestedCategory: 'aceite' }),
        line('DESCUENTO PRONTO PAGO', 1, 'ud', 0, -3),
      ],
    });
    await db().invoices.add(inv);
    return { tomate, inv };
  }

  it('crea productos, registra precios, aprende alias y es idempotente', async () => {
    const { tomate, inv } = await setup();
    const res = await confirmInvoice(inv.id);
    expect(res).toEqual({ created: 2, updated: 1, skipped: 2 });

    const t = await db().products.get(tomate.id);
    expect(t).toMatchObject({ pricePerBase: 1.8, priceSource: 'factura', lastPurchaseDate: '2026-02-01' });
    expect(t?.aliases).toContain('TOMATE PERA CAT.I CAJA 6KG');
    const supplier = await db().suppliers.toCollection().first();
    expect(supplier?.name).toBe('Frutas García S.L.');
    expect(t?.supplierId).toBe(supplier?.id);

    const products = await db().products.toArray();
    expect(products).toHaveLength(3);
    const perejil = products.find((p) => p.name === 'Perejil');
    const aceite = products.find((p) => p.name === 'Aceite de oliva virgen extra');
    expect(perejil).toMatchObject({ baseUnit: 'ud', pricePerBase: 0.6, priceSource: 'factura', category: 'verdura', supplierId: supplier?.id });
    expect(perejil?.aliases).toEqual(['PEREJIL MANOJO']);
    expect(aceite).toMatchObject({ baseUnit: 'l', pricePerBase: 4.5, category: 'aceite' });

    const saved = await db().invoices.get(inv.id);
    expect(saved?.status).toBe('confirmada');
    expect(saved?.confirmedAt).toBeTruthy();
    expect(saved?.supplierId).toBe(supplier?.id);
    expect(saved?.lines[1]).toMatchObject({ productId: perejil?.id, matchStatus: 'vinculado' });
    expect(await db().pricePoints.where('invoiceId').equals(inv.id).count()).toBe(3);

    // Re-confirmar: mismos precios, sin duplicar histórico ni productos
    const again = await confirmInvoice(inv.id);
    expect(again).toEqual({ created: 0, updated: 3, skipped: 2 });
    expect(await db().pricePoints.where('invoiceId').equals(inv.id).count()).toBe(3);
    expect(await db().products.count()).toBe(3);
    expect(await db().suppliers.count()).toBe(1);
    expect((await db().products.get(tomate.id))?.pricePerBase).toBe(1.8);
  });

  it('al re-confirmar con una fecha anterior recalcula el precio vigente desde el histórico', async () => {
    const { tomate, inv } = await setup();
    await confirmInvoice(inv.id);
    await updateInvoice(inv.id, { date: '2025-12-01' });
    await confirmInvoice(inv.id);
    expect(await db().products.get(tomate.id)).toMatchObject({ pricePerBase: 1.5, lastPurchaseDate: '2026-01-10' });
  });

  it('borrar la factura devuelve el precio anterior y elimina su histórico', async () => {
    const { tomate, inv } = await setup();
    await confirmInvoice(inv.id);
    await deleteInvoice(inv.id);
    expect(await db().invoices.get(inv.id)).toBeUndefined();
    expect(await db().pricePoints.where('invoiceId').equals(inv.id).count()).toBe(0);
    expect(await db().products.get(tomate.id)).toMatchObject({ pricePerBase: 1.5, lastPurchaseDate: '2026-01-10' });
    // Los productos creados por la factura conservan el último precio conocido, ya sin atribuirlo a una compra.
    const perejil = (await db().products.toArray()).find((p) => p.name === 'Perejil');
    expect(perejil).toMatchObject({ pricePerBase: 0.6, priceSource: 'manual' });
    expect(perejil?.lastPurchaseDate).toBeUndefined();
  });

  it('no crea duplicados si otra factura ya creó el producto con el mismo nombre', async () => {
    const a = rawInvoice({ lines: [line('PEREJIL MANOJO', 10, 'ud', 0.6, 6, { suggestedName: 'Perejil' })] });
    const b = rawInvoice({ date: '2026-02-08', lines: [line('PEREJIL FRESCO MANOJO', 5, 'ud', 0.7, 3.5, { suggestedName: 'Perejil' })] });
    await db().invoices.bulkAdd([a, b]);
    await confirmInvoice(a.id);
    const res = await confirmInvoice(b.id);
    expect(res).toEqual({ created: 0, updated: 1, skipped: 0 });
    const products = await db().products.toArray();
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ pricePerBase: 0.7, lastPurchaseDate: '2026-02-08' });
    expect(products[0].aliases).toEqual(expect.arrayContaining(['PEREJIL MANOJO', 'PEREJIL FRESCO MANOJO']));
  });

  it('convierte unidades cuando es posible y omite la línea con aviso cuando no', async () => {
    const huevoUd = rawProduct({ name: 'Huevo campero', baseUnit: 'ud', pricePerBase: 0.25, lastPurchaseDate: '2026-01-01' });
    const huevoKg = rawProduct({ name: 'Huevo XL', baseUnit: 'kg', unitWeightKg: 0.06, pricePerBase: 3.5, lastPurchaseDate: '2026-01-01' });
    const girasol = rawProduct({ name: 'Aceite de girasol', baseUnit: 'kg', densityKgPerL: 0.92, pricePerBase: 2, lastPurchaseDate: '2026-01-01' });
    await db().products.bulkAdd([huevoUd, huevoKg, girasol]);
    const inv = rawInvoice({
      lines: [
        line('HUEVOS CAMPEROS GRANEL', 5, 'kg', 4, 20, { productId: huevoUd.id, matchStatus: 'vinculado' }),
        line('HUEVO XL', 30, 'ud', 0.24, 7.2, { productId: huevoKg.id, matchStatus: 'sugerido' }),
        line('ACEITE GIRASOL', 5, 'l', 2.3, 11.5, { productId: girasol.id, matchStatus: 'vinculado' }),
      ],
    });
    await db().invoices.add(inv);
    const res = await confirmInvoice(inv.id);
    expect(res).toEqual({ created: 0, updated: 2, skipped: 1 });
    expect((await db().products.get(huevoUd.id))?.pricePerBase).toBe(0.25);
    expect(await db().pricePoints.where('productId').equals(huevoUd.id).count()).toBe(0);
    expect((await db().products.get(huevoKg.id))?.pricePerBase).toBeCloseTo(4, 6);
    expect((await db().products.get(girasol.id))?.pricePerBase).toBeCloseTo(2.5, 6);
    const saved = await db().invoices.get(inv.id);
    expect(saved?.lines[0].warnings?.some((w) => w.startsWith('No se ha actualizado el precio'))).toBe(true);
    expect(saved?.lines[1].matchStatus).toBe('vinculado');
    // Re-confirmar no acumula avisos
    await confirmInvoice(inv.id);
    const again = await db().invoices.get(inv.id);
    expect(again?.lines[0].warnings?.filter((w) => w.startsWith('No se ha actualizado el precio'))).toHaveLength(1);
  });

  it('no confirma facturas que aún se están leyendo', async () => {
    const inv = rawInvoice({ status: 'procesando' });
    await db().invoices.add(inv);
    await expect(confirmInvoice(inv.id)).rejects.toThrow('leyendo');
  });
});

describe('revisión de facturas', () => {
  it('updateInvoice re-normaliza las líneas modificadas y reasigna el proveedor', async () => {
    const supplier = await findOrCreateSupplier('Carnes Selectas SL');
    const l = line('SOLOMILLO TERNERA', 2, 'kg', 30, 60);
    const inv = rawInvoice({ supplierName: '', lines: [l] });
    await db().invoices.add(inv);
    await updateInvoice(inv.id, { supplierName: 'CARNES SELECTAS, S.L.', lines: [{ ...l, quantity: 3, total: 90 }] });
    const saved = await db().invoices.get(inv.id);
    expect(saved?.supplierId).toBe(supplier.id);
    expect(saved?.lines[0]).toMatchObject({ baseQuantity: 3, pricePerBase: 30 });
    await updateInvoice(inv.id, { lines: [{ ...saved!.lines[0], total: 105 }] });
    expect((await db().invoices.get(inv.id))?.lines[0].pricePerBase).toBe(35);
  });

  it('createManualInvoice y newInvoiceLine', async () => {
    const id = await createManualInvoice();
    expect(await db().invoices.get(id)).toMatchObject({ status: 'revision', method: 'manual', lines: [] });
    const a = newInvoiceLine();
    const b = newInvoiceLine({ description: 'Sal', quantity: 2 });
    expect(a.id).not.toBe(b.id);
    expect(b).toMatchObject({ description: 'Sal', quantity: 2, unit: 'ud', matchStatus: 'nuevo' });
  });
});

describe('cola de lectura de facturas', () => {
  it('lee PDF y Excel en segundo plano; un Excel con varias facturas crea varias', async () => {
    const tomate = await createProduct({ name: 'Tomate pera', pricePerBase: 1.5 });
    await findOrCreateSupplier('Frutas García S.L.');
    extractInvoices.mockImplementation(async (file, opts) => {
      opts.onProgress?.({ stage: 'Leyendo el archivo…', progress: 0.5 });
      if (file.name?.endsWith('.csv')) {
        return [
          extracted([exLine('TOMATE PERA CAT.I CAJA 6KG', 1, 'caja', 10.2, 10.2)], { number: 'A-1', method: 'hoja' }),
          extracted([exLine('PEREJIL MANOJO', 5, 'ud', 0.6, 3)], { number: 'A-2', method: 'hoja', supplierName: 'Hierbas Martín' }),
        ];
      }
      return [extracted([exLine('TOMATE PERA CAT.I CAJA 6KG', 2, 'caja', 10.8, 21.6), exLine('SERVILLETAS PAPEL', 1, 'caja', 12, 12)], { date: undefined })];
    });
    const states: QueueState[] = [];
    const unsub = subscribeInvoiceQueue((s) => states.push(s));
    const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'factura-garcia.pdf', { type: 'application/pdf' });
    const csv = new File(['numero;descripcion\nA-1;TOMATE'], 'compras-marzo.csv', { type: 'text/csv' });
    const ids = await addInvoiceFiles([pdf, csv]);
    expect(ids).toHaveLength(2);
    await vi.waitFor(async () => {
      const all = await db().invoices.toArray();
      expect(all).toHaveLength(3);
      expect(all.every((i) => i.status === 'revision')).toBe(true);
    });
    unsub();

    const pdfInv = await db().invoices.get(ids[0]);
    expect(pdfInv).toMatchObject({ method: 'pdf-texto', supplierName: 'Frutas García S.L.', fileName: 'factura-garcia.pdf', fileType: 'application/pdf' });
    expect(pdfInv?.file).toBeInstanceOf(Blob);
    expect(pdfInv?.supplierId).toBeTruthy();
    expect(pdfInv?.lines[0]).toMatchObject({ productId: tomate.id, matchStatus: 'vinculado' });
    expect(pdfInv?.lines[1].matchStatus).toBe('nuevo');
    expect(pdfInv?.lines.every((l) => !!l.id)).toBe(true);
    expect(pdfInv?.warnings).toContain('No se ha detectado la fecha de la factura: revísala antes de confirmar');

    const sheetInvs = (await db().invoices.toArray()).filter((i) => i.method === 'hoja');
    expect(sheetInvs.map((i) => i.number).sort()).toEqual(['A-1', 'A-2']);
    expect(sheetInvs.find((i) => i.number === 'A-1')?.id).toBe(ids[1]);
    expect(sheetInvs.find((i) => i.number === 'A-2')?.fileName).toBe('compras-marzo.csv');

    // El extractor recibe un archivo con nombre aunque IndexedDB devuelva un Blob.
    expect(extractInvoices.mock.calls.map((c) => c[0].name)).toEqual(['factura-garcia.pdf', 'compras-marzo.csv']);
    expect(extractInvoices.mock.calls[0][1].forceLocal).toBe(false);
    expect(states.some((s) => s.running === ids[0] && s.stage === 'Leyendo el archivo…')).toBe(true);
    expect(states[states.length - 1]).toEqual({ running: null, queued: [] });

    // Releer una factura de un Excel sólo actualiza esa factura
    await processInvoice(ids[1], { forceLocal: true });
    expect(await db().invoices.count()).toBe(3);
    expect(extractInvoices.mock.calls[2][1].forceLocal).toBe(true);
  });

  it('registra el error de lectura con un mensaje legible', async () => {
    extractInvoices.mockRejectedValue(new Error('El PDF está protegido con contraseña'));
    const inv = rawInvoice({ status: 'error', file: new Blob(['x'], { type: 'application/pdf' }), fileName: 'f.pdf', fileType: 'application/pdf' });
    await db().invoices.add(inv);
    await expect(processInvoice(inv.id)).rejects.toThrow('contraseña');
    expect(await db().invoices.get(inv.id)).toMatchObject({ status: 'error', error: 'El PDF está protegido con contraseña' });
    await expect(processInvoice((await createManualInvoice()) as string)).rejects.toThrow('archivo original');
  });

  it('si la IA opcional falla, lee la factura gratis en el dispositivo', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    await updateAppSettings({ aiEnabled: true, apiKey: 'sk-ant-prueba' });
    extractInvoices.mockImplementation(async (_file, opts) => {
      if (!opts.forceLocal) throw Object.assign(new Error('Clave de API no válida'), { name: 'AIError' });
      return [extracted([exLine('SAL MARINA 1KG', 10, 'ud', 0.4, 4)])];
    });
    const inv = rawInvoice({ status: 'pendiente', file: new Blob(['x'], { type: 'image/jpeg' }), fileName: 'ticket.jpg' });
    await db().invoices.add(inv);
    await processInvoice(inv.id);
    const saved = await db().invoices.get(inv.id);
    expect(saved?.status).toBe('revision');
    expect(saved?.warnings?.some((w) => w.includes('gratis en tu dispositivo'))).toBe(true);
    expect(extractInvoices).toHaveBeenCalledTimes(2);
  });

  it('resumePendingInvoices retoma las pendientes sin duplicarlas', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    extractInvoices.mockImplementation(async () => {
      await gate;
      return [extracted([exLine('LECHE ENTERA 1L', 12, 'ud', 0.9, 10.8)])];
    });
    const a = rawInvoice({ status: 'pendiente', file: new Blob(['a'], { type: 'application/pdf' }), fileName: 'a.pdf', createdAt: '2026-01-01T00:00:00.000Z' });
    const b = rawInvoice({ status: 'procesando', file: new Blob(['b'], { type: 'application/pdf' }), fileName: 'b.pdf', createdAt: '2026-01-02T00:00:00.000Z' });
    const c = rawInvoice({ status: 'pendiente', fileName: 'perdida.pdf' });
    await db().invoices.bulkAdd([a, b, c]);
    await resumePendingInvoices();
    await resumePendingInvoices();
    release();
    await vi.waitFor(async () => {
      expect((await db().invoices.get(a.id))?.status).toBe('revision');
      expect((await db().invoices.get(b.id))?.status).toBe('revision');
    });
    await resumePendingInvoices();
    expect(extractInvoices).toHaveBeenCalledTimes(2);
    expect(await db().invoices.get(c.id)).toMatchObject({ status: 'error' });
  });
});

// ───────────────────────────── Fusión y borrado de productos ─────────────────────────────

describe('mergeProducts y deleteProduct', () => {
  it('fusiona histórico, recetas, facturas, pruebas y alias', async () => {
    const keep = await createProduct({ name: 'Tomate pera', baseUnit: 'kg', pricePerBase: 1.5, lastPurchaseDate: '2026-01-10' });
    const remove = await createProduct({ name: 'Tomate de pera', baseUnit: 'kg', pricePerBase: 1.9, lastPurchaseDate: '2026-02-15', aliases: ['TOM. PERA'] });
    const dish = rawDish({ name: 'Ensalada', items: [{ ...newRecipeItem({ name: 'Tomate', quantity: 150 }), ref: { type: 'product', id: remove.id } }] });
    await db().dishes.add(dish);
    const inv = rawInvoice({ status: 'confirmada', lines: [line('TOMATE DE PERA', 1, 'kg', 1.9, 1.9, { productId: remove.id, matchStatus: 'vinculado' })] });
    await db().invoices.add(inv);
    const test: YieldTest = {
      id: uid(),
      name: 'Pelado de tomate',
      productId: remove.id,
      date: '2026-02-01',
      grossWeightKg: 1,
      purchasePricePerKg: 1.9,
      outputs: [],
      cookingLossPct: 0,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await db().yieldTests.add(test);

    await mergeProducts(keep.id, remove.id);
    expect(await db().products.get(remove.id)).toBeUndefined();
    const k = await db().products.get(keep.id);
    expect(k?.aliases).toEqual(expect.arrayContaining(['Tomate de pera', 'TOM. PERA']));
    expect(k).toMatchObject({ pricePerBase: 1.9, lastPurchaseDate: '2026-02-15' });
    expect(await db().pricePoints.where('productId').equals(keep.id).count()).toBe(2);
    expect((await db().dishes.get(dish.id))?.items[0].ref).toEqual({ type: 'product', id: keep.id });
    expect((await db().invoices.get(inv.id))?.lines[0].productId).toBe(keep.id);
    expect((await db().yieldTests.get(test.id))?.productId).toBe(keep.id);
  });

  it('convierte el histórico entre unidades y se niega si no es posible', async () => {
    const kg = await createProduct({ name: 'Limón', baseUnit: 'kg', unitWeightKg: 0.125, pricePerBase: 2, lastPurchaseDate: '2026-01-01' });
    const ud = await createProduct({ name: 'Limones sueltos', baseUnit: 'ud', pricePerBase: 0.3, lastPurchaseDate: '2026-02-01' });
    await mergeProducts(kg.id, ud.id);
    expect((await db().products.get(kg.id))?.pricePerBase).toBeCloseTo(2.4, 6);

    const a = rawProduct({ name: 'Bolsa de hielo', baseUnit: 'ud' });
    const b = rawProduct({ name: 'Hielo en cubitos', baseUnit: 'kg' });
    await db().products.bulkAdd([a, b]);
    await expect(mergeProducts(a.id, b.id)).rejects.toThrow('peso por unidad');
    await expect(mergeProducts(a.id, a.id)).rejects.toThrow();
  });

  it('deleteProduct desvincula recetas y facturas y borra el histórico', async () => {
    const p = await createProduct({ name: 'Mantequilla', pricePerBase: 7.5 });
    const dish = rawDish({ name: 'Tostada', items: [{ ...newRecipeItem({ name: 'Mantequilla', quantity: 10 }), ref: { type: 'product', id: p.id }, matchScore: 1 }] });
    await db().dishes.add(dish);
    const inv = rawInvoice({ lines: [line('MANTEQUILLA 1KG', 2, 'ud', 7.5, 15, { productId: p.id, matchStatus: 'vinculado' })] });
    await db().invoices.add(inv);
    await deleteProduct(p.id);
    expect(await db().products.get(p.id)).toBeUndefined();
    expect(await db().pricePoints.where('productId').equals(p.id).count()).toBe(0);
    const item = (await db().dishes.get(dish.id))?.items[0];
    expect(item?.name).toBe('Mantequilla');
    expect(item?.ref).toBeUndefined();
    expect((await db().invoices.get(inv.id))?.lines[0]).toMatchObject({ matchStatus: 'nuevo' });
    expect((await db().invoices.get(inv.id))?.lines[0].productId).toBeUndefined();
  });
});

// ───────────────────────────── Platos ─────────────────────────────

describe('platos', () => {
  it('createDish usa el IVA del negocio y valores por defecto', async () => {
    await updateBusinessSettings({ defaultSaleVatPct: 21 });
    const d = await createDish({ name: ' Gin tonic ' });
    expect(d).toMatchObject({ name: 'Gin tonic', kind: 'plato', portions: 1, saleVatPct: 21, status: 'borrador', source: 'manual', items: [] });
    await updateDish(d.id, { portions: 0, menuPrice: 9 });
    expect(await db().dishes.get(d.id)).toMatchObject({ portions: 1, menuPrice: 9 });
  });

  it('duplicateDish y deleteDish (desvincula quien lo usa como elaboración)', async () => {
    const salsa = await createDish({ name: 'Salsa brava', kind: 'elaboracion', yieldQty: 1, yieldUnit: 'l' });
    const bravas = await createDish({ name: 'Patatas bravas', items: [{ ...newRecipeItem({ name: 'Salsa brava', quantity: 60, unit: 'ml' }), ref: { type: 'dish', id: salsa.id } }] });
    const copy = await duplicateDish(bravas.id);
    expect(copy.name).toBe('Patatas bravas (copia)');
    expect(copy.items[0].id).not.toBe(bravas.items[0].id);
    expect((await duplicateDish(bravas.id)).name).toBe('Patatas bravas (copia 2)');
    await deleteDish(salsa.id);
    const after = await db().dishes.get(bravas.id);
    expect(after?.items[0].ref).toBeUndefined();
    expect(after?.items[0].name).toBe('Salsa brava');
  });
});

describe('proposalToItems', () => {
  it('coteja con productos y elaboraciones, respeta ids explícitos y escala raciones', () => {
    const tomate = rawProduct({ name: 'Tomate pera' });
    const aceite = rawProduct({ name: 'Aceite de oliva virgen extra', baseUnit: 'l', category: 'aceite' });
    const sal = rawProduct({ name: 'Sal', category: 'condimento' });
    const sofrito = rawDish({ name: 'Sofrito de tomate', kind: 'elaboracion' });
    const fondo = rawDish({ name: 'Fondo oscuro', kind: 'elaboracion' });
    const prop = proposal(
      'Arroz',
      [
        ing('Tomate', 200, 'g', { basis: 'bruta', wastePct: 8 }),
        ing('AOVE', 20, 'ml', { note: 'Para el sofrito' }),
        ing('Sofrito', 60),
        ing('Pimentón de la Vera', 2),
        ing('Caldo', 300, 'ml', { productId: `dish:${fondo.id}` }),
        ing('Sal gruesa', 3, 'g', { productId: sal.id }),
        ing('Inventado', 5, 'g', { productId: 'id-que-no-existe' }),
        ing('   ', 5),
      ],
      { portions: 2 },
    );
    const items = proposalToItems(prop, [tomate, aceite, sal], [sofrito, fondo], { portions: 4 });
    expect(items).toHaveLength(7);
    expect(items.every((i) => i.suggested && i.id)).toBe(true);
    expect(items[0]).toMatchObject({ name: 'Tomate', ref: { type: 'product', id: tomate.id }, quantity: 400, unit: 'g', basis: 'bruta', wastePct: 8 });
    expect(items[0].matchScore).toBeGreaterThanOrEqual(SUGGEST_THRESHOLD);
    expect(items[0].cookingLossPct).toBeUndefined();
    expect(items[1]).toMatchObject({ ref: { type: 'product', id: aceite.id }, quantity: 40, note: 'Para el sofrito' });
    expect('wastePct' in items[1]).toBe(false);
    expect(items[2].ref).toEqual({ type: 'dish', id: sofrito.id });
    expect(items[3].ref).toBeUndefined();
    expect(items[4]).toMatchObject({ ref: { type: 'dish', id: fondo.id }, matchScore: 1 });
    expect(items[5]).toMatchObject({ ref: { type: 'product', id: sal.id }, matchScore: 1 });
    expect(items[6].ref).toBeUndefined();
  });
});

describe('proposeForDishes', () => {
  it('ruta local gratuita: rellena platos vacíos y crea una sola vez los ingredientes que faltan', async () => {
    const tomate = await createProduct({ name: 'Tomate pera', pricePerBase: 1.6 });
    const gazpacho = await createDish({ name: 'Gazpacho', portions: 2 });
    const ensalada = await createDish({ name: 'Ensalada verde' });
    const conReceta = await createDish({ name: 'Tortilla', items: [newRecipeItem({ name: 'Huevo', quantity: 2, unit: 'ud' })] });
    proposeLocal.mockImplementation((name) =>
      name === 'Gazpacho'
        ? proposal('Gazpacho', [ing('Tomate', 250, 'g', { basis: 'bruta' }), ing('Perejil', 5)], { procedure: 'Triturar y enfriar.' })
        : proposal(name, [ing('Perejil fresco', 3), ing('Lechuga', 80)]),
    );
    const progress: [number, number, string][] = [];
    const res = await proposeForDishes([gazpacho.id, ensalada.id, conReceta.id, 'no-existe'], {
      createMissing: true,
      onProgress: (d, t, s) => progress.push([d, t, s]),
    });
    expect(res.usedAI).toBe(false);
    expect(res.proposed).toBe(2);
    expect(proposeLocal).toHaveBeenCalledTimes(2);

    const g = await db().dishes.get(gazpacho.id);
    expect(g?.procedure).toBe('Triturar y enfriar.');
    expect(g?.items[0]).toMatchObject({ name: 'Tomate', ref: { type: 'product', id: tomate.id }, quantity: 500, suggested: true });
    const perejilProducts = (await db().products.toArray()).filter((p) => p.name === 'Perejil');
    expect(perejilProducts).toHaveLength(1);
    const perejil = perejilProducts[0];
    expect(perejil).toMatchObject({ priceSource: 'manual', notes: 'Precio estimado de referencia: actualízalo con una factura' });
    const kbPerejil = kbIngredients.findKbIngredient('Perejil');
    if (kbPerejil?.refPricePerBase) expect(perejil.pricePerBase).toBe(kbPerejil.refPricePerBase);
    expect(g?.items[1].ref).toEqual({ type: 'product', id: perejil.id });
    const e = await db().dishes.get(ensalada.id);
    expect(e?.items[0].ref).toEqual({ type: 'product', id: perejil.id });
    expect(e?.items[1].ref?.type).toBe('product');
    expect((await db().dishes.get(conReceta.id))?.items).toHaveLength(1);
    expect(res.warnings.some((w) => w.includes('precio estimado'))).toBe(true);
    expect(progress[progress.length - 1]).toEqual([2, 2, 'Propuesta lista']);

    // Sin createMissing no se crean productos
    const before = await db().products.count();
    await proposeForDishes([ensalada.id], { replace: true });
    expect(await db().products.count()).toBe(before);
  });

  it('con la IA activada usa sus propuestas y completa con la base local los platos que falle', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    await updateAppSettings({ aiEnabled: true, apiKey: 'sk-ant-prueba' });
    const aceite = await createProduct({ name: 'Aceite de oliva virgen extra', baseUnit: 'l', pricePerBase: 8 });
    const alioli = await createDish({ name: 'Alioli', kind: 'elaboracion', yieldQty: 0.5, yieldUnit: 'l' });
    const pulpo = await createDish({ name: 'Pulpo a la gallega', menuPrice: 19 });
    const flan = await createDish({ name: 'Flan de huevo' });
    aiDetailed.mockImplementation(async (dishes, catalog) => {
      expect(catalog.some((c) => c.id === `dish:${alioli.id}` && c.baseUnit === 'l' && c.category === 'otros')).toBe(true);
      expect(dishes.find((d) => d.key === pulpo.id)).toMatchObject({ name: 'Pulpo a la gallega', price: 19 });
      return {
        proposals: new Map([[pulpo.id, proposal('Pulpo a la gallega', [ing('Aceite', 15, 'ml', { productId: aceite.id }), ing('Alioli', 20, 'ml', { productId: `dish:${alioli.id}` })], { source: 'ia' })]]),
        warnings: ['Aviso de la IA'],
        failed: [flan.id],
      };
    });
    proposeLocal.mockImplementation((name) => proposal(name, [ing('Huevo', 1, 'ud'), ing('Azúcar', 30)]));
    const res = await proposeForDishes([pulpo.id, flan.id], {});
    expect(res.usedAI).toBe(true);
    expect(res.proposed).toBe(2);
    expect(res.warnings).toContain('Aviso de la IA');
    expect(proposeLocal).toHaveBeenCalledTimes(1);
    expect(proposeLocal.mock.calls[0][0]).toBe('Flan de huevo');
    const p = await db().dishes.get(pulpo.id);
    expect(p?.items.map((i) => i.ref)).toEqual([
      { type: 'product', id: aceite.id },
      { type: 'dish', id: alioli.id },
    ]);
  });

  it('si la IA falla del todo avisa y usa la base local', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    await updateAppSettings({ aiEnabled: true, apiKey: 'sk-ant-prueba' });
    const d = await createDish({ name: 'Croquetas' });
    aiDetailed.mockRejectedValue(Object.assign(new Error('Sin conexión'), { name: 'AIError' }));
    proposeLocal.mockImplementation((name) => proposal(name, [ing('Leche', 100, 'ml')]));
    const res = await proposeForDishes([d.id], { replace: true });
    expect(res.usedAI).toBe(false);
    expect(res.proposed).toBe(1);
    expect(res.warnings[0]).toMatch(/Sin conexión/);
  });

  it('rematchDish vincula las líneas sin producto con los productos nuevos', async () => {
    const d = await createDish({ name: 'Tostada con tomate', items: [newRecipeItem({ name: 'Tomate rallado', quantity: 40 }), newRecipeItem({ name: 'Pan de pueblo', quantity: 80 })] });
    expect(await rematchDish(d.id)).toBe(0);
    const pan = await createProduct({ name: 'Pan de pueblo', baseUnit: 'kg', pricePerBase: 3 });
    expect(await rematchDish(d.id)).toBe(1);
    const after = await db().dishes.get(d.id);
    expect(after?.items[1]).toMatchObject({ ref: { type: 'product', id: pan.id }, suggested: true });
    expect(after?.items[0].ref).toBeUndefined();
  });
});

// ───────────────────────────── Cartas ─────────────────────────────

describe('cartas', () => {
  it('addMenuScan guarda las fotos, lee la carta en segundo plano y deduplica entradas', async () => {
    const result: ExtractedMenu = {
      method: 'ocr',
      rawText: 'ENTRANTES\nCroquetas 8,50',
      warnings: ['Foto algo inclinada'],
      entries: [
        { section: 'Entrantes', name: 'Croquetas caseras', price: 8.5, confidence: 0.9 },
        { section: 'Entrantes', name: 'Croquetas caseras', price: 8.5, confidence: 0.8 },
        { section: 'Entrantes', name: '  ', price: 3 },
        { section: 'Principales', name: 'Pulpo a la gallega', price: 18.5 },
      ],
    };
    extractMenu.mockResolvedValue(result);
    const photo = new File([new Uint8Array([255, 216, 255])], 'IMG_2031.jpg', { type: 'image/jpeg' });
    const id = await addMenuScan([photo]);
    await vi.waitFor(async () => expect((await db().menuScans.get(id))?.status).toBe('revision'));
    const scan = (await db().menuScans.get(id)) as MenuScan & { warnings?: string[] };
    expect(scan.images).toHaveLength(1);
    expect(scan.name).toMatch(/^Carta del /);
    expect(scan.method).toBe('ocr');
    expect(scan.entries.map((e) => e.name)).toEqual(['Croquetas caseras', 'Pulpo a la gallega']);
    expect(scan.entries.every((e) => e.selected && e.id)).toBe(true);
    expect(scan.warnings).toEqual(['Foto algo inclinada']);
    const passed = extractMenu.mock.calls[0][0];
    expect(passed[0].name).toMatch(/\.jpg$/);
    await expect(addMenuScan([new File(['x'], 'notas.docx')])).rejects.toThrow('Formato');
  });

  it('processMenuScan registra el error si no se puede leer', async () => {
    extractMenu.mockRejectedValue(new Error('No se ha podido leer la foto'));
    const scan: MenuScan = { id: uid(), name: 'Carta', images: [new Blob(['x'], { type: 'image/jpeg' })], status: 'revision', entries: [], createdAt: NOW };
    await db().menuScans.add(scan);
    await expect(processMenuScan(scan.id, { forceLocal: true })).rejects.toThrow();
    expect(await db().menuScans.get(scan.id)).toMatchObject({ status: 'error', error: 'No se ha podido leer la foto' });
    expect(extractMenu.mock.calls[0][1].forceLocal).toBe(true);
  });

  it('importMenuEntries evita duplicados, actualiza PVP/sección y propone recetas', async () => {
    const croquetas = await createDish({ name: 'Croquetas de jamón', menuPrice: 8, description: 'Caseras, de la abuela' });
    const scanId = uid();
    const scan: MenuScan = {
      id: scanId,
      name: 'Carta de invierno',
      images: [],
      status: 'revision',
      method: 'ocr',
      createdAt: NOW,
      entries: [
        { id: uid(), name: 'CROQUETAS DE JAMÓN', section: 'Entrantes', price: 9, description: 'Ibéricas', selected: true },
        { id: uid(), name: 'Pulpo a la gallega', section: 'Principales', price: 18.5, description: 'Con cachelos', selected: true },
        { id: uid(), name: 'pulpo a la gallega', section: 'Principales', price: 18.5, selected: true },
        { id: uid(), name: 'Flan', section: 'Postres', price: 5, selected: false },
        { id: uid(), name: '', price: 4, selected: true },
      ],
    };
    await db().menuScans.add(scan);
    proposeLocal.mockImplementation((name) => proposal(name, [ing('Aceite de oliva', 10, 'ml')]));
    const progress: string[] = [];
    const ids = await importMenuEntries(scanId, { propose: true, onProgress: (_d, _t, s) => progress.push(s) });
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(croquetas.id);
    const c = await db().dishes.get(croquetas.id);
    expect(c).toMatchObject({ menuPrice: 9, section: 'Entrantes', description: 'Caseras, de la abuela', menuScanId: scanId });
    const pulpo = await db().dishes.get(ids[1]);
    expect(pulpo).toMatchObject({ name: 'Pulpo a la gallega', menuPrice: 18.5, section: 'Principales', description: 'Con cachelos', source: 'carta-ocr', menuScanId: scanId, kind: 'plato' });
    expect(pulpo?.items.length).toBeGreaterThan(0);
    expect(c?.items.length).toBeGreaterThan(0);
    expect(await db().dishes.count()).toBe(2);
    const saved = await db().menuScans.get(scanId);
    expect(saved?.status).toBe('importada');
    expect(saved?.entries.map((e) => e.dishId)).toEqual([croquetas.id, ids[1], ids[1], undefined, undefined]);
    expect(progress.length).toBeGreaterThan(0);

    // Importar de nuevo no crea platos
    const again = await importMenuEntries(scanId);
    expect(again.sort()).toEqual([...ids].sort());
    expect(await db().dishes.count()).toBe(2);

    await deleteMenuScan(scanId);
    expect(await db().menuScans.get(scanId)).toBeUndefined();
    expect((await db().dishes.get(ids[1]))?.menuScanId).toBeUndefined();
  });

  it('los platos de una carta leída con IA quedan marcados como carta-ia', async () => {
    const scan: MenuScan = { id: uid(), name: 'Carta', images: [], status: 'revision', method: 'ia', createdAt: NOW, entries: [{ id: uid(), name: 'Tataki de atún', price: 16, selected: true }] };
    await db().menuScans.add(scan);
    const [id] = await importMenuEntries(scan.id);
    expect((await db().dishes.get(id))?.source).toBe('carta-ia');
  });
});

// ───────────────────────────── Exportación ─────────────────────────────

describe('toCsv', () => {
  it('usa ; como separador, coma decimal, comillas y BOM', () => {
    const csv = toCsv([
      ['Producto', 'Precio', 'Notas'],
      ['Tomate "pera"', 1.8, 'Caja; 6 kg'],
      ['Sal', 0.35, null],
      ['Aceite', 4, 'línea 1\nlínea 2'],
      ['=SUMA(A1)', -2.5, undefined],
      ['-merma', 0.000123, 'ok'],
      ['Nada', Number.NaN, ''],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Producto;Precio;Notas');
    expect(lines[1]).toBe('"Tomate ""pera""";1,8;"Caja; 6 kg"');
    expect(lines[2]).toBe('Sal;0,35;');
    expect(csv).toContain('Aceite;4;"línea 1\nlínea 2"');
    expect(csv).toContain("'=SUMA(A1);-2,5;");
    expect(csv).toContain("'-merma;0,000123;ok");
    expect(csv).toContain('Nada;;');
  });
});

describe('exportación a Excel', () => {
  async function loadWorkbook(blob: Blob) {
    const mod = (await import('exceljs')) as typeof import('exceljs') & { default?: typeof import('exceljs') };
    const ExcelJS = mod.default ?? mod;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    return wb;
  }

  it('safeSheetName limpia caracteres prohibidos, recorta a 31 y evita duplicados', () => {
    const used = new Set<string>(['resumen']);
    expect(safeSheetName('Resumen', used)).toBe('Resumen (2)');
    const long = safeSheetName('Pulpo [a feira]: 1/2 ración*? con cachelos y pimentón', used);
    expect(long.length).toBeLessThanOrEqual(31);
    expect(long).not.toMatch(/[[\]:*?/\\]/);
    const again = safeSheetName('Pulpo [a feira]: 1/2 ración*? con cachelos y pimentón', used);
    expect(again).not.toBe(long);
    expect(again.length).toBeLessThanOrEqual(31);
    expect(safeSheetName("'Salsa'", used)).toBe('Salsa');
  });

  it('exportEscandallosXlsx genera resumen, ingredientes y una ficha por plato con fórmulas', async () => {
    await updateBusinessSettings({ targetFoodCostPct: 30, warningFoodCostPct: 35 });
    const tomate = await createProduct({ name: 'Tomate pera', baseUnit: 'kg', pricePerBase: 2, wastePct: 10 });
    const aceite = await createProduct({ name: 'Aceite de oliva virgen extra', baseUnit: 'l', pricePerBase: 8 });
    const salsa = await createDish({
      name: 'Salsa de tomate',
      kind: 'elaboracion',
      yieldQty: 1,
      yieldUnit: 'kg',
      items: [{ ...newRecipeItem({ name: 'Tomate', quantity: 1.2, unit: 'kg', basis: 'bruta' }), ref: { type: 'product', id: tomate.id } }],
    });
    const dish = await createDish({
      name: 'Pan con tomate [especial]',
      section: 'Entrantes',
      menuPrice: 5.5,
      portions: 2,
      items: [
        { ...newRecipeItem({ name: 'Tomate', quantity: 200, unit: 'g', basis: 'neta' }), ref: { type: 'product', id: tomate.id } },
        { ...newRecipeItem({ name: 'AOVE', quantity: 20, unit: 'ml' }), ref: { type: 'product', id: aceite.id } },
        { ...newRecipeItem({ name: 'Salsa', quantity: 50, unit: 'g' }), ref: { type: 'dish', id: salsa.id } },
        newRecipeItem({ name: 'Sal en escamas', quantity: 1 }),
      ],
    });
    const products = await db().products.toArray();
    const dishes = await db().dishes.toArray();
    const business = { ...(await db().business.get('business'))!, targetFoodCostPct: 30, warningFoodCostPct: 35 };
    const ctx = buildCostingContext(products, dishes, [], business);
    const costs = costAllDishes(ctx);
    const blob = await exportEscandallosXlsx({ workspace: { id: wsId, name: 'Casa Pepe', createdAt: NOW, updatedAt: NOW }, dishes, costs, ctx, business });
    expect(blob.type).toBe(XLSX_MIME);
    expect(blob.size).toBeGreaterThan(5000);

    const wb = await loadWorkbook(blob);
    const names = wb.worksheets.map((w) => w.name);
    expect(names.slice(0, 2)).toEqual(['Resumen', 'Ingredientes']);
    expect(names).toContain('Pan con tomate especial');
    expect(names).toContain('Salsa de tomate');

    const summary = wb.getWorksheet('Resumen')!;
    const header = summary.getRow(4);
    expect(header.getCell(1).value).toBe('Plato');
    expect((header.getCell(1).fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe('FFFF5A1F');
    expect(header.getCell(1).font?.bold).toBe(true);
    expect(summary.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
    expect(summary.autoFilter).toBeTruthy();
    const row = summary.getRow(5);
    expect((row.getCell(1).value as { text: string }).text).toBe('Pan con tomate [especial]');
    const dc = costs.get(dish.id)!;
    const fcCell = row.getCell(9).value as { formula: string; result: number };
    expect(fcCell.formula).toContain('H5/G5');
    expect(fcCell.result).toBeCloseTo((dc.foodCostPct ?? 0) / 100, 6);
    expect(row.getCell(9).numFmt).toBe('0.0%');
    const costRef = row.getCell(8).value as { formula: string; result: number };
    expect(costRef.formula).toBe("'Pan con tomate especial'!B9");
    expect(costRef.result).toBeCloseTo(dc.costPerPortion, 6);
    expect(row.getCell(8).numFmt).toContain('€');

    const sheet = wb.getWorksheet('Pan con tomate especial')!;
    expect(sheet.getCell('A1').value).toBe('Pan con tomate [especial]');
    expect(sheet.getCell('B5').value).toBe(2);
    expect((sheet.getCell('B9').value as { result: number }).result).toBeCloseTo(dc.costPerPortion, 6);
    expect(sheet.getRow(15).getCell(1).value).toBe('Ingrediente');
    const tomatoCost = sheet.getRow(16).getCell(14).value as { formula: string; result: number };
    expect(tomatoCost.formula).toBe('F16*M16');
    expect(tomatoCost.result).toBeCloseTo(dc.items[0].cost, 6);
    expect(sheet.getRow(19).getCell(18).value).toContain('Sin producto vinculado');
    const total = sheet.getRow(20).getCell(14).value as { formula: string; result: number };
    expect(total.formula).toBe('SUM(N16:N19)');
    expect(total.result).toBeCloseTo(dc.totalCost, 6);

    const ingSheet = wb.getWorksheet('Ingredientes')!;
    const ingNames = [5, 6].map((r) => ingSheet.getRow(r).getCell(1).value);
    expect(ingNames).toEqual(['Aceite de oliva virgen extra', 'Tomate pera']);
    expect(ingSheet.getRow(6).getCell(11).value).toBe(2);
  });

  it('exportProductsXlsx genera productos y proveedores con formato', async () => {
    const s = await findOrCreateSupplier('Frutas García S.L.', 'B12345678');
    const p = await createProduct({ name: 'Tomate pera', pricePerBase: 1.8, supplierId: s.id, lastPurchaseDate: '2026-02-01', aliases: ['TOMATE PERA 6KG'] });
    await createProduct({ name: 'Sal' });
    const blob = await exportProductsXlsx(await db().products.toArray(), await db().suppliers.toArray());
    expect(blob.type).toBe(XLSX_MIME);
    const wb = await loadWorkbook(blob);
    const ws = wb.getWorksheet('Productos')!;
    expect(ws.getRow(4).getCell(1).value).toBe('Producto');
    const row = ws.getRow(6);
    expect(row.getCell(1).value).toBe(p.name);
    expect(row.getCell(3).value).toBe('Frutas García S.L.');
    expect(row.getCell(5).value).toBe(1.8);
    expect(row.getCell(5).numFmt).toContain('€');
    expect(row.getCell(7).value).toBeInstanceOf(Date);
    expect(row.getCell(14).value).toBe('TOMATE PERA 6KG');
    const sup = wb.getWorksheet('Proveedores')!;
    expect(sup.getRow(5).getCell(1).value).toBe('Frutas García S.L.');
    expect(sup.getRow(5).getCell(5).value).toBe(1);
  });
});

describe('espacio de trabajo', () => {
  it('los servicios usan el espacio activo', () => {
    expect(getCurrentWorkspaceId()).toBe(wsId);
  });
});
