import { beforeAll, describe, expect, it } from 'vitest';
import { getAppSettings, getBusinessSettings, getCurrentWorkspaceId, metaDb, workspaceDb } from '../src/db';
import { loadDemoWorkspace, DEMO_WORKSPACE_NAME } from '../src/services/demo';
import { buildDemoData, localDate } from '../src/demo/build';
import { buildCostingContext, costDish, foodCostStatus } from '../src/core/costing';
import { computeYield } from '../src/core/yield';
import { useUI } from '../src/state/store';
import type { BusinessSettings, Dish, DishCost, Invoice, PricePoint, Product, Supplier, Workspace, YieldTest } from '../src/types';

interface Loaded {
  ws: Workspace;
  suppliers: Supplier[];
  products: Product[];
  pricePoints: PricePoint[];
  invoices: Invoice[];
  dishes: Dish[];
  yieldTests: YieldTest[];
  business: BusinessSettings;
  costs: Map<string, DishCost>;
}

let L: Loaded;

const byName = <T extends { name: string }>(list: T[], name: string): T => {
  const found = list.find((x) => x.name === name);
  if (!found) throw new Error(`No encontrado: ${name}`);
  return found;
};

/** Validación del dígito de control de un CIF de sociedad (A/B + 7 dígitos + control numérico). */
function validCif(cif: string): boolean {
  const m = /^[AB](\d{7})(\d)$/.exec(cif);
  if (!m) return false;
  const digits = m[1]!.split('').map(Number);
  let sum = 0;
  digits.forEach((d, i) => {
    if (i % 2 === 1) sum += d;
    else {
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    }
  });
  return (10 - (sum % 10)) % 10 === Number(m[2]);
}

beforeAll(async () => {
  const ws = await loadDemoWorkspace();
  const wdb = workspaceDb(ws.id);
  const [suppliers, products, pricePoints, invoices, dishes, yieldTests] = await Promise.all([
    wdb.suppliers.toArray(),
    wdb.products.toArray(),
    wdb.pricePoints.toArray(),
    wdb.invoices.toArray(),
    wdb.dishes.toArray(),
    wdb.yieldTests.toArray(),
  ]);
  const business = await getBusinessSettings(wdb);
  const ctx = buildCostingContext(products, dishes, yieldTests, business);
  const costs = new Map(dishes.map((d) => [d.id, costDish(d, ctx)]));
  L = { ws, suppliers, products, pricePoints, invoices, dishes, yieldTests, business, costs };
});

describe('loadDemoWorkspace', () => {
  it('crea el espacio de la taberna y lo deja activo', async () => {
    expect(L.ws.name).toBe(DEMO_WORKSPACE_NAME);
    expect(L.ws.name).toBe('Taberna El Fogón');
    expect(L.ws.city).toBe('Madrid');
    expect(L.ws.businessType).toBe('Restaurante · Taberna');
    expect(L.ws.color).toBe('#ff5a1f');
    expect(await metaDb.workspaces.get(L.ws.id)).toBeTruthy();
    expect((await getAppSettings()).currentWorkspaceId).toBe(L.ws.id);
    expect(getCurrentWorkspaceId()).toBe(L.ws.id);
    expect(useUI.getState().workspaceId).toBe(L.ws.id);
  });

  it('guarda los ajustes de negocio de la demo', () => {
    expect(L.business).toMatchObject({ targetFoodCostPct: 30, warningFoodCostPct: 35, defaultSaleVatPct: 10, priceAlertPct: 5, priceRounding: 0.5, currency: 'EUR' });
  });

  it('tiene 5 proveedores con CIF válido', () => {
    expect(L.suppliers).toHaveLength(5);
    for (const s of L.suppliers) expect(validCif(s.taxId ?? ''), `${s.name} ${s.taxId}`).toBe(true);
    expect(L.suppliers.map((s) => s.name)).toContain('Distribuciones Hosteleras Centro S.L.');
  });

  it('productos completos y coherentes', () => {
    expect(L.products.length).toBeGreaterThanOrEqual(70);
    const supplierIds = new Set(L.suppliers.map((s) => s.id));
    const names = new Set<string>();
    for (const p of L.products) {
      expect(names.has(p.name), `duplicado ${p.name}`).toBe(false);
      names.add(p.name);
      expect(p.priceSource).toBe('factura');
      expect(p.pricePerBase, p.name).toBeGreaterThan(0);
      expect(supplierIds.has(p.supplierId ?? '')).toBe(true);
      expect(p.lastPurchaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.searchKey.trim().length, p.name).toBeGreaterThan(0);
      expect(p.searchKey).not.toMatch(/[áéíóúÁÉÍÓÚ]/);
      expect(p.aliases.length, p.name).toBeGreaterThan(0);
      expect(p.wastePct).toBeGreaterThanOrEqual(0);
      expect(p.wastePct).toBeLessThan(100);
      if (p.baseUnit === 'ud') expect(p.unitWeightKg, `${p.name} sin peso por unidad`).toBeGreaterThan(0);
      if (p.baseUnit === 'l') expect(p.densityKgPerL, `${p.name} sin densidad`).toBeGreaterThan(0);
    }
    expect(byName(L.products, 'Harina de trigo').allergens).toContain('gluten');
    expect(byName(L.products, 'Gamba roja congelada').allergens).toContain('crustaceos');
    expect(byName(L.products, 'Pulpo crudo congelado').allergens).toContain('moluscos');
  });

  it('el precio vigente de cada producto es el de su última factura', () => {
    for (const p of L.products) {
      const pts = L.pricePoints.filter((pp) => pp.productId === p.id).sort((a, b) => a.date.localeCompare(b.date));
      expect(pts.length, p.name).toBeGreaterThan(0);
      const last = pts[pts.length - 1]!;
      expect(p.pricePerBase).toBeCloseTo(last.pricePerBase, 6);
      expect(p.lastPurchaseDate).toBe(last.date);
    }
  });
});

describe('facturas', () => {
  it('~10 facturas confirmadas en los últimos 100 días', () => {
    expect(L.invoices.length).toBeGreaterThanOrEqual(9);
    expect(L.invoices.length).toBeLessThanOrEqual(13);
    const today = localDate(new Date(), 0);
    const oldest = localDate(new Date(), 100);
    for (const inv of L.invoices) {
      expect(inv.status).toBe('confirmada');
      expect(inv.date <= today && inv.date >= oldest, inv.date).toBe(true);
      expect(inv.number).toBeTruthy();
      expect(inv.number).toContain(inv.date.slice(0, 4).slice(-2));
      expect(inv.supplierTaxId).toBeTruthy();
      expect(inv.confirmedAt).toBeTruthy();
    }
    expect(new Set(L.invoices.map((i) => i.method))).toEqual(new Set(['ia', 'pdf-texto', 'ocr', 'hoja']));
    expect(new Set(L.invoices.map((i) => i.supplierId)).size).toBe(5);
  });

  it('importes cuadrados al céntimo (líneas, base imponible, IVA y total)', () => {
    for (const inv of L.invoices) {
      const sum = inv.lines.reduce((s, l) => s + l.total, 0);
      expect(Math.abs(sum - (inv.subtotal ?? 0)), inv.number).toBeLessThanOrEqual(0.01);
      expect(Math.abs((inv.subtotal ?? 0) + (inv.vatTotal ?? 0) - (inv.total ?? 0))).toBeLessThanOrEqual(0.01);
      const byVat = new Map<number, number>();
      for (const l of inv.lines) byVat.set(l.vatPct ?? -1, (byVat.get(l.vatPct ?? -1) ?? 0) + l.total);
      const vat = [...byVat].reduce((s, [pct, base]) => s + Math.round(base * pct) / 100, 0);
      expect(Math.abs(vat - (inv.vatTotal ?? 0))).toBeLessThanOrEqual(0.01);
      for (const l of inv.lines) {
        expect([4, 10, 21]).toContain(l.vatPct);
        const expected = Math.round(l.quantity * l.unitPrice * (1 - (l.discountPct ?? 0) / 100) * 100) / 100;
        expect(l.total, l.description).toBeCloseTo(expected, 2);
        expect(l.matchStatus).toBe('vinculado');
        const product = L.products.find((p) => p.id === l.productId);
        expect(product, l.description).toBeTruthy();
        expect(l.baseUnit).toBe(product!.baseUnit);
        expect(Math.abs((l.pricePerBase ?? 0) * (l.baseQuantity ?? 0) - l.total), l.description).toBeLessThan(0.01);
      }
    }
    const bebidas = L.invoices.find((i) => i.supplierName.startsWith('Bebidas'))!;
    expect(bebidas.lines.some((l) => l.vatPct === 21)).toBe(true);
    expect(L.invoices.some((i) => i.lines.some((l) => l.packSize && l.unit === 'caja'))).toBe(true);
    expect(L.invoices.some((i) => i.lines.some((l) => (l.discountPct ?? 0) > 0))).toBe(true);
  });

  it('cada línea tiene su punto de precio', () => {
    const lineCount = L.invoices.reduce((s, i) => s + i.lines.length, 0);
    expect(L.pricePoints).toHaveLength(lineCount);
    for (const inv of L.invoices) {
      for (const l of inv.lines) {
        const pp = L.pricePoints.find((p) => p.invoiceId === inv.id && p.productId === l.productId);
        expect(pp, l.description).toBeTruthy();
        expect(pp!.source).toBe('factura');
        expect(pp!.date).toBe(inv.date);
        expect(pp!.pricePerBase).toBeCloseTo(l.pricePerBase ?? 0, 6);
      }
    }
  });

  it('hay subidas (y una bajada) de precio detectables', () => {
    const change = (name: string) => {
      const p = byName(L.products, name);
      const pts = L.pricePoints.filter((pp) => pp.productId === p.id).sort((a, b) => a.date.localeCompare(b.date));
      const last = pts[pts.length - 1]!.pricePerBase;
      const prev = [...pts].reverse().find((pp) => Math.abs(pp.pricePerBase - last) > 1e-9)?.pricePerBase;
      return prev ? ((last - prev) / prev) * 100 : 0;
    };
    const increases = L.products.filter((p) => change(p.name) > 0);
    expect(increases.length).toBeGreaterThanOrEqual(5);
    expect(change('Aceite de oliva virgen extra')).toBeCloseTo(12, 0);
    expect(change('Gamba roja congelada')).toBeCloseTo(11, 0);
    expect(change('Pulpo crudo congelado')).toBeCloseTo(9, 0);
    expect(change('Huevos camperos L')).toBeCloseTo(7, 0);
    expect(change('Solomillo de ternera entero')).toBeGreaterThanOrEqual(5);
    expect(change('Tomate pera')).toBeCloseTo(-8, 0);
    const alerts = L.products.filter((p) => Math.abs(change(p.name)) >= L.business.priceAlertPct);
    expect(alerts.length).toBeGreaterThanOrEqual(6);
  });
});

describe('pruebas de rendimiento', () => {
  it('3 pruebas vinculadas a sus productos y sin avisos', () => {
    expect(L.yieldTests).toHaveLength(3);
    for (const t of L.yieldTests) {
      const p = L.products.find((x) => x.id === t.productId);
      expect(p, t.name).toBeTruthy();
      expect(p!.yieldTestId).toBe(t.id);
      const r = computeYield(t);
      expect(r.warnings, t.name).toEqual([]);
      expect(r.principalKg).toBeGreaterThan(0);
      expect(r.portions).toBeGreaterThan(0);
    }
    const salmon = computeYield(L.yieldTests.find((t) => t.name.startsWith('Salmón'))!);
    expect(salmon.byproductValue).toBeCloseTo(0.45 * 6, 6);
    expect(salmon.unaccountedKg).toBeCloseTo(0.15, 6);
    const pulpo = L.yieldTests.find((t) => t.name.startsWith('Pulpo'))!;
    expect(pulpo.thawLossPct).toBe(8);
    expect(pulpo.purchasePricePerKg).toBeCloseTo(14.9, 6);
  });
});

describe('escandallos', () => {
  it('4 elaboraciones y 21 platos, todo vinculado', () => {
    const elab = L.dishes.filter((d) => d.kind === 'elaboracion');
    const platos = L.dishes.filter((d) => d.kind === 'plato');
    expect(elab).toHaveLength(4);
    expect(platos).toHaveLength(21);
    for (const e of elab) expect(e.yieldQty, e.name).toBeGreaterThan(0);
    expect(new Set(platos.map((d) => d.section))).toEqual(new Set(['Para picar', 'Entrantes', 'Arroces', 'Carnes', 'Pescados', 'Postres']));
    const productIds = new Set(L.products.map((p) => p.id));
    const dishIds = new Set(L.dishes.map((d) => d.id));
    for (const d of L.dishes) {
      for (const it of d.items) {
        expect(it.ref, `${d.name} · ${it.name}`).toBeTruthy();
        expect(it.ref!.type === 'product' ? productIds.has(it.ref!.id) : dishIds.has(it.ref!.id)).toBe(true);
      }
    }
    for (const d of platos) {
      expect(d.menuPrice, d.name).toBeGreaterThan(0);
      expect(d.unitsSold, d.name).toBeGreaterThan(0);
      expect(d.saleVatPct).toBe(10);
    }
    expect(byName(L.dishes, 'Tortilla de patatas').portions).toBe(6);
    expect(byName(L.dishes, 'Paella de marisco').portions).toBe(2);
    const bravas = byName(L.dishes, 'Patatas bravas');
    expect(bravas.items.some((i) => i.ref?.type === 'dish' && i.ref.id === byName(L.dishes, 'Salsa brava').id)).toBe(true);
    const carrilleras = byName(L.dishes, 'Carrilleras ibéricas al vino tinto');
    expect(carrilleras.items.some((i) => i.ref?.type === 'dish' && i.ref.id === byName(L.dishes, 'Fondo oscuro de ternera').id)).toBe(true);
  });

  it('borradores con líneas sugeridas para enseñar el flujo de revisión', () => {
    const drafts = L.dishes.filter((d) => d.status === 'borrador');
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    expect(drafts.length).toBeLessThanOrEqual(3);
    for (const d of drafts) {
      expect(d.kind).toBe('plato');
      expect(d.items.every((i) => i.suggested === true && (i.matchScore ?? 0) > 0)).toBe(true);
    }
    for (const d of L.dishes.filter((x) => x.status === 'revisado')) expect(d.items.some((i) => i.suggested)).toBe(false);
  });

  it('todos los escandallos se calculan completos y sin avisos de unidades', () => {
    for (const d of L.dishes) {
      const c = L.costs.get(d.id)!;
      expect(c.completeness, d.name).toBe(1);
      expect(c.totalCost, d.name).toBeGreaterThan(0);
      for (const it of c.items) {
        expect(it.warnings.filter((w) => /Unidad|incompatible|Falta el peso|densidad/i.test(w)), `${d.name} · ${it.name}`).toEqual([]);
        expect(it.warnings, `${d.name} · ${it.name}`).toEqual([]);
      }
      expect(c.warnings, d.name).toEqual([]);
    }
  });

  it('food cost realista con semáforo variado (verdes, ámbar y rojos)', () => {
    const platos = L.dishes.filter((d) => d.kind === 'plato');
    const status = { ok: 0, warn: 0, bad: 0, none: 0 };
    for (const d of platos) {
      const fc = L.costs.get(d.id)!.foodCostPct!;
      expect(fc, d.name).toBeGreaterThanOrEqual(15);
      expect(fc, d.name).toBeLessThanOrEqual(48);
      status[foodCostStatus(fc, L.business.targetFoodCostPct, L.business.warningFoodCostPct)]++;
    }
    expect(status.bad).toBeGreaterThanOrEqual(3);
    expect(status.warn).toBeGreaterThanOrEqual(4);
    expect(status.ok).toBeGreaterThanOrEqual(10);
    expect(status.none).toBe(0);
    const fc = (name: string) => L.costs.get(byName(L.dishes, name).id)!.foodCostPct!;
    expect(fc('Patatas bravas')).toBeLessThan(22);
    expect(fc('Jamón ibérico de bellota')).toBeGreaterThan(35);
    expect(fc('Tataki de atún rojo')).toBeGreaterThan(35);
  });

  it('usa las pruebas de rendimiento y las mermas en el coste', () => {
    const pulpo = L.costs.get(byName(L.dishes, 'Pulpo a la gallega').id)!;
    const linePulpo = pulpo.items.find((i) => i.name === 'Pulpo')!;
    expect(linePulpo.wasteSource).toBe('prueba');
    expect(linePulpo.servedQty).toBeCloseTo(0.15, 6);
    expect(linePulpo.grossQty).toBeGreaterThan(0.3);
    const salmon = L.costs.get(byName(L.dishes, 'Salmón a la plancha').id)!;
    expect(salmon.items.find((i) => i.name === 'Salmón')!.wasteSource).toBe('prueba');
    const solomillo = L.costs.get(byName(L.dishes, 'Solomillo de ternera a la brasa').id)!;
    expect(solomillo.items.find((i) => i.name === 'Solomillo de ternera')!.wasteSource).toBe('prueba');
    const paella = L.costs.get(byName(L.dishes, 'Paella de marisco').id)!;
    expect(paella.items.find((i) => i.name === 'Gamba roja')!.wasteSource).toBe('linea');
    for (const d of L.dishes.filter((x) => x.kind === 'plato')) expect(L.costs.get(d.id)!.wasteKgPerPortion, d.name).toBeGreaterThanOrEqual(0);
  });

  it('alérgenos heredados de productos y elaboraciones', () => {
    const al = (name: string) => L.costs.get(byName(L.dishes, name).id)!.allergens;
    expect(al('Croquetas de jamón ibérico')).toEqual(expect.arrayContaining(['gluten', 'lacteos', 'huevo']));
    expect(al('Paella de marisco')).toEqual(expect.arrayContaining(['crustaceos', 'moluscos', 'pescado']));
    expect(al('Patatas bravas')).toEqual(expect.arrayContaining(['gluten', 'huevo', 'apio', 'sulfitos']));
    expect(al('Tataki de atún rojo')).toEqual(expect.arrayContaining(['pescado', 'soja', 'sesamo']));
    // Las etiquetas de la carta no pueden contradecir los alérgenos calculados.
    for (const d of L.dishes) {
      const allergens = L.costs.get(d.id)!.allergens;
      if (d.tags?.includes('sin gluten')) expect(allergens, d.name).not.toContain('gluten');
      if (d.tags?.includes('sin lactosa')) expect(allergens, d.name).not.toContain('lacteos');
    }
  });

  it('las ventas dan una matriz de ingeniería de menú con los 4 cuadrantes', () => {
    const platos = L.dishes.filter((d) => d.kind === 'plato');
    const total = platos.reduce((s, d) => s + (d.unitsSold ?? 0), 0);
    const margin = (d: Dish) => L.costs.get(d.id)!.grossMargin!;
    const avgMargin = platos.reduce((s, d) => s + margin(d) * (d.unitsSold ?? 0), 0) / total;
    const threshold = 0.7 * (100 / platos.length);
    const classes = new Map<string, number>();
    for (const d of platos) {
      const popular = ((d.unitsSold ?? 0) / total) * 100 >= threshold;
      const profitable = margin(d) >= avgMargin;
      const cls = popular && profitable ? 'estrella' : popular ? 'caballo' : profitable ? 'enigma' : 'perro';
      classes.set(cls, (classes.get(cls) ?? 0) + 1);
    }
    for (const cls of ['estrella', 'caballo', 'enigma', 'perro']) expect(classes.get(cls) ?? 0, cls).toBeGreaterThanOrEqual(2);
  });

  it('segunda carga: crea otro espacio "(2)" y lo activa', async () => {
    const ws2 = await loadDemoWorkspace();
    expect(ws2.id).not.toBe(L.ws.id);
    expect(ws2.name).toBe(`${DEMO_WORKSPACE_NAME} (2)`);
    expect((await getAppSettings()).currentWorkspaceId).toBe(ws2.id);
    expect(getCurrentWorkspaceId()).toBe(ws2.id);
    expect(await workspaceDb(ws2.id).dishes.count()).toBe(L.dishes.length);
    expect(await workspaceDb(L.ws.id).dishes.count()).toBe(L.dishes.length);
  });
});

describe('buildDemoData', () => {
  it('las fechas y números de factura siguen a la fecha de referencia (cambio de año)', () => {
    let n = 0;
    const data = buildDemoData({ now: new Date(2026, 0, 10), makeId: () => `id-${n++}`, searchKey: (s) => s.toLowerCase() });
    const dates = data.invoices.map((i) => i.date).sort();
    expect(dates[0]!.startsWith('2025-10')).toBe(true);
    expect(dates[dates.length - 1]!.startsWith('2026-01')).toBe(true);
    for (const inv of data.invoices) expect(inv.number).toContain(inv.date.slice(2, 4));
    expect(new Set([...data.products, ...data.dishes, ...data.invoices, ...data.pricePoints].map((x) => x.id)).size).toBe(
      data.products.length + data.dishes.length + data.invoices.length + data.pricePoints.length,
    );
  });
});
