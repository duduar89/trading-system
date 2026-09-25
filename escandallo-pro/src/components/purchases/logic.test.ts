import { describe, expect, it } from 'vitest';
import type { Dish, DishCost, Invoice, InvoiceLine, PricePoint, Product } from '../../types';
import {
  applyLinePatch,
  columnLetter,
  diffPrices,
  DEFAULT_PRODUCT_FILTERS,
  filterInvoices,
  filterProducts,
  foldText,
  formatPack,
  invoiceNetAmount,
  invoiceStats,
  isMeaningfulChange,
  lineAmount,
  matchesQuery,
  parsePriceRows,
  pctChange,
  priceTrends,
  productStats,
  productUsage,
  summarizeLines,
  totalsCheck,
  type PriceSnapshot,
} from './logic';
import { isEstimatedPrice, userNotes } from './estimated';
import { ESTIMATED_PRICE_NOTE } from '../../services/products';

const line = (p: Partial<InvoiceLine> = {}): InvoiceLine => ({
  id: p.id ?? 'l1',
  description: 'TOMATE PERA',
  quantity: 1,
  unit: 'kg',
  unitPrice: 0,
  total: 0,
  matchStatus: 'nuevo',
  ...p,
});

const invoice = (p: Partial<Invoice> = {}): Invoice => ({
  id: p.id ?? 'i1',
  supplierName: 'Frutas García',
  date: '2026-09-10',
  status: 'confirmada',
  lines: [],
  createdAt: '2026-09-10T10:00:00Z',
  ...p,
});

const product = (p: Partial<Product> & { id: string; name: string }): Product => ({
  searchKey: p.name.toLowerCase(),
  aliases: [],
  category: 'verdura',
  baseUnit: 'kg',
  pricePerBase: 0,
  priceSource: 'factura',
  wastePct: 0,
  cookingLossPct: 0,
  allergens: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...p,
});

const pp = (id: string, productId: string, date: string, price: number): PricePoint => ({
  id,
  productId,
  date,
  pricePerBase: price,
  source: 'factura',
});

describe('texto', () => {
  it('foldText quita tildes, mayúsculas y signos', () => {
    expect(foldText('  Aceite de OLIVA v.e. — 5L ')).toBe('aceite de oliva v e 5l');
    expect(foldText('Piñones')).toBe('pinones');
    expect(foldText(undefined)).toBe('');
  });
  it('matchesQuery exige todos los términos en cualquier texto', () => {
    expect(matchesQuery('oliva ace', 'Aceite de oliva')).toBe(true);
    expect(matchesQuery('oliva girasol', 'Aceite de oliva')).toBe(false);
    expect(matchesQuery('aove', 'Aceite de oliva', 'AOVE garrafa')).toBe(true);
    expect(matchesQuery('   ', 'lo que sea')).toBe(true);
  });
});

describe('formatPack', () => {
  it('formatea envases múltiples y simples', () => {
    expect(formatPack({ count: 6, size: 1, unit: 'l' })).toBe('6 × 1 l');
    expect(formatPack({ count: 1, size: 5, unit: 'kg' })).toBe('5 kg');
    expect(formatPack({ count: 24, size: 33.3, unit: 'cl' })).toBe('24 × 33,3 cl');
    expect(formatPack({ count: 1, size: 500, unit: 'g' })).toBe('500 g');
    expect(formatPack({ count: 1, size: 2.5, unit: 'kg' })).toBe('2,5 kg');
  });
  it('unidades: total de piezas', () => {
    expect(formatPack({ count: 30, size: 1, unit: 'ud' })).toBe('30 ud');
    expect(formatPack({ count: 1, size: 12, unit: 'ud' })).toBe('12 ud');
    expect(formatPack({ count: 4, size: 6, unit: 'ud' })).toBe('4 × 6 ud');
  });
  it('vacío si no hay formato válido', () => {
    expect(formatPack(undefined)).toBe('');
    expect(formatPack({ count: 1, size: 0, unit: 'kg' })).toBe('');
  });
});

describe('líneas de factura', () => {
  it('lineAmount aplica descuento y redondea a céntimos', () => {
    expect(lineAmount({ quantity: 3, unitPrice: 2.155, discountPct: 0 })).toBe(6.47);
    expect(lineAmount({ quantity: 2, unitPrice: 10, discountPct: 15 })).toBe(17);
    expect(lineAmount({ quantity: Number.NaN, unitPrice: 10 })).toBe(0);
  });

  it('applyLinePatch recalcula el importe al cambiar cantidad o precio', () => {
    const l = line({ quantity: 2, unitPrice: 11.7, total: 23.4 });
    expect(applyLinePatch(l, { quantity: 2.5 }).total).toBe(29.25);
    expect(applyLinePatch(l, { unitPrice: 12 }).total).toBe(24);
    expect(applyLinePatch(l, { discountPct: 10 }).total).toBe(21.06);
  });

  it('applyLinePatch respeta el importe si se edita directamente', () => {
    const l = line({ quantity: 2, unitPrice: 11.7, total: 23.4 });
    const r = applyLinePatch(l, { total: 25 });
    expect(r.total).toBe(25);
    expect(r.unitPrice).toBe(11.7);
  });

  it('applyLinePatch deduce el precio si sólo hay importe', () => {
    const l = line({ quantity: 1, unitPrice: 0, total: 30 });
    const r = applyLinePatch(l, { quantity: 4 });
    expect(r.unitPrice).toBe(7.5);
    expect(r.total).toBe(30);
  });

  it('summarizeLines cuenta estados, avisos y líneas con precio', () => {
    const s = summarizeLines([
      line({ id: 'a', matchStatus: 'vinculado', pricePerBase: 2 }),
      line({ id: 'b', matchStatus: 'sugerido', pricePerBase: 1, warnings: ['x'] }),
      line({ id: 'c', matchStatus: 'nuevo', pricePerBase: 0 }),
      line({ id: 'd', matchStatus: 'ignorado', pricePerBase: 5 }),
    ]);
    expect(s).toEqual({ total: 4, linked: 1, suggested: 1, created: 1, ignored: 1, withWarnings: 1, priced: 2 });
  });
});

describe('totales', () => {
  it('cuadra suma de líneas con base imponible (tolerancia)', () => {
    const lines = [line({ total: 10.01 }), line({ total: 20 })];
    expect(totalsCheck(lines, 30).status).toBe('ok');
    expect(totalsCheck(lines, 30.05).status).toBe('ok');
    const bad = totalsCheck(lines, 35);
    expect(bad.status).toBe('warn');
    expect(bad.diff).toBe(-4.99);
    expect(totalsCheck(lines).status).toBe('none');
  });
  it('valida base + IVA = total', () => {
    const r = totalsCheck([line({ total: 100 })], 100, 10, 110);
    expect(r.vat?.ok).toBe(true);
    const r2 = totalsCheck([line({ total: 100 })], 100, 10, 121);
    expect(r2.vat?.ok).toBe(false);
    expect(r2.vat?.diff).toBe(11);
  });
  it('invoiceNetAmount usa la base o la suma de líneas', () => {
    expect(invoiceNetAmount({ subtotal: 50, lines: [line({ total: 10 })] })).toBe(50);
    expect(invoiceNetAmount({ subtotal: undefined, lines: [line({ total: 10.1 }), line({ total: 5.2 })] })).toBe(15.3);
  });
});

describe('lista de facturas', () => {
  const list = [
    invoice({ id: 'a', status: 'confirmada', supplierName: 'Makro', number: 'F-001' }),
    invoice({ id: 'b', status: 'revision', supplierName: 'Pescados Rías' }),
    invoice({ id: 'c', status: 'procesando', supplierName: '', fileName: 'foto_ticket.jpg' }),
    invoice({ id: 'd', status: 'error', supplierName: 'Carnes Ávila' }),
  ];
  it('filtra por estado', () => {
    expect(filterInvoices(list, 'todas', '').map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterInvoices(list, 'revisar', '').map((i) => i.id)).toEqual(['b', 'c']);
    expect(filterInvoices(list, 'confirmadas', '').map((i) => i.id)).toEqual(['a']);
    expect(filterInvoices(list, 'error', '').map((i) => i.id)).toEqual(['d']);
  });
  it('busca por proveedor (sin tildes), número o archivo', () => {
    expect(filterInvoices(list, 'todas', 'avila').map((i) => i.id)).toEqual(['d']);
    expect(filterInvoices(list, 'todas', 'f-001').map((i) => i.id)).toEqual(['a']);
    expect(filterInvoices(list, 'todas', 'ticket').map((i) => i.id)).toEqual(['c']);
  });
  it('invoiceStats: mes en curso, anterior y estados', () => {
    const s = invoiceStats(
      [
        invoice({ id: '1', date: '2026-09-02', status: 'confirmada', subtotal: 100 }),
        invoice({ id: '2', date: '2026-09-15', status: 'revision', lines: [line({ total: 40 }), line({ total: 10 })] }),
        invoice({ id: '3', date: '2026-09-20', status: 'error' }),
        invoice({ id: '4', date: '2026-08-31', status: 'confirmada', subtotal: 80 }),
        invoice({ id: '5', date: '2026-08-10', status: 'procesando', subtotal: 999 }),
      ],
      '2026-09-25',
    );
    expect(s.monthCount).toBe(3);
    expect(s.monthSpend).toBe(150);
    expect(s.monthPendingSpend).toBe(50);
    expect(s.prevMonthSpend).toBe(80);
    expect(s.toReview).toBe(1);
    expect(s.errors).toBe(1);
    expect(s.inProgress).toBe(1);
  });
  it('invoiceStats: el mes anterior de enero es diciembre del año previo', () => {
    const s = invoiceStats([invoice({ date: '2025-12-20', subtotal: 12 })], '2026-01-05');
    expect(s.prevMonthSpend).toBe(12);
  });
});

describe('precios', () => {
  it('pctChange', () => {
    expect(pctChange(2, 2.5)).toBeCloseTo(25);
    expect(pctChange(0, 2)).toBeUndefined();
    expect(pctChange(undefined, 2)).toBeUndefined();
    expect(isMeaningfulChange(0.05)).toBe(false);
    expect(isMeaningfulChange(-3)).toBe(true);
  });

  it('priceTrends compara con el último precio distinto', () => {
    const t = priceTrends([
      pp('1', 'tom', '2026-06-01', 1.2),
      pp('2', 'tom', '2026-07-01', 1.5),
      pp('3', 'tom', '2026-08-01', 1.5),
      pp('4', 'ace', '2026-08-01', 6),
      pp('5', 'ace', '2026-05-01', 7.5),
      pp('6', 'sal', '2026-05-01', 0.4),
    ]);
    const tom = t.get('tom');
    expect(tom?.current).toBe(1.5);
    expect(tom?.previous).toBe(1.2);
    expect(tom?.previousDate).toBe('2026-06-01');
    expect(tom?.changePct).toBeCloseTo(25);
    expect(tom?.points).toBe(3);
    expect(t.get('ace')?.changePct).toBeCloseTo(-20);
    expect(t.get('sal')?.changePct).toBeUndefined();
  });

  it('priceTrends desempata la misma fecha por orden de alta', () => {
    const t = priceTrends([pp('b', 'x', '2026-08-01', 3), pp('a', 'x', '2026-08-01', 2)]);
    expect(t.get('x')?.current).toBe(3);
    expect(t.get('x')?.previous).toBe(2);
  });

  it('diffPrices ordena por mayor cambio y deja los nuevos al final', () => {
    const before = new Map<string, PriceSnapshot>([
      ['a', { id: 'a', name: 'Aceite', price: 5, baseUnit: 'l' }],
      ['b', { id: 'b', name: 'Tomate', price: 1, baseUnit: 'kg' }],
    ]);
    const rows = diffPrices(before, [
      product({ id: 'a', name: 'Aceite', baseUnit: 'l', pricePerBase: 5.5 }),
      product({ id: 'n', name: 'Nata', baseUnit: 'l', pricePerBase: 3 }),
      product({ id: 'b', name: 'Tomate', pricePerBase: 0.7 }),
    ]);
    expect(rows.map((r) => r.productId)).toEqual(['b', 'a', 'n']);
    expect(rows[0].changePct).toBeCloseTo(-30);
    expect(rows[2].isNew).toBe(true);
    expect(rows[2].before).toBeUndefined();
  });
});

describe('productos', () => {
  const products = [
    product({
      id: 'a',
      name: 'Aceite de oliva virgen extra',
      category: 'aceite',
      pricePerBase: 6,
      lastPurchaseDate: '2026-09-01',
      aliases: ['AOVE 5L'],
    }),
    product({ id: 'b', name: 'Tomate pera', pricePerBase: 1.5, lastPurchaseDate: '2026-09-20', yieldTestId: 'y1' }),
    product({ id: 'c', name: 'Azafrán', category: 'condimento', pricePerBase: 0 }),
    product({ id: 'd', name: 'Ñora', category: 'condimento', pricePerBase: 12, lastPurchaseDate: '2026-07-01' }),
  ];
  const trends = priceTrends([
    pp('1', 'b', '2026-08-01', 1.2),
    pp('2', 'b', '2026-09-20', 1.5),
    pp('3', 'a', '2026-06-01', 6.5),
    pp('4', 'a', '2026-09-01', 6),
  ]);

  it('filtra por texto (también alias), categoría y marcas', () => {
    expect(filterProducts(products, { ...DEFAULT_PRODUCT_FILTERS, query: 'aove' }, trends).map((p) => p.id)).toEqual(['a']);
    expect(filterProducts(products, { ...DEFAULT_PRODUCT_FILTERS, category: 'condimento' }, trends).map((p) => p.id)).toEqual(['c', 'd']);
    expect(filterProducts(products, { ...DEFAULT_PRODUCT_FILTERS, noPrice: true }, trends).map((p) => p.id)).toEqual(['c']);
    expect(filterProducts(products, { ...DEFAULT_PRODUCT_FILTERS, withYield: true }, trends).map((p) => p.id)).toEqual(['b']);
    expect(filterProducts(products, { ...DEFAULT_PRODUCT_FILTERS, rising: true }, trends).map((p) => p.id)).toEqual(['b']);
    expect(filterProducts(products, { ...DEFAULT_PRODUCT_FILTERS, query: 'nora' }, trends).map((p) => p.id)).toEqual(['d']);
  });

  it('distingue los precios estimados de referencia (sin factura todavía)', () => {
    const est = product({ id: 'e', name: 'Pimentón de la Vera', pricePerBase: 18, notes: ESTIMATED_PRICE_NOTE });
    const zero = product({ id: 'z', name: 'Comino', pricePerBase: 0, notes: ESTIMATED_PRICE_NOTE });
    const all = [...products, est, zero];
    expect(isEstimatedPrice(est)).toBe(true);
    expect(isEstimatedPrice(zero)).toBe(false);
    expect(isEstimatedPrice(products[0])).toBe(false);
    expect(filterProducts(all, { ...DEFAULT_PRODUCT_FILTERS, estimated: true }, trends).map((p) => p.id)).toEqual(['e']);
    expect(userNotes(est)).toBeUndefined();
    expect(userNotes({ notes: 'Calibre 3' })).toBe('Calibre 3');
  });

  it('ordena por nombre (es), precio, compra y variación', () => {
    const ids = (sort: typeof DEFAULT_PRODUCT_FILTERS.sort) =>
      filterProducts(products, { ...DEFAULT_PRODUCT_FILTERS, sort }, trends).map((p) => p.id);
    expect(ids('nombre')).toEqual(['a', 'c', 'd', 'b']);
    expect(ids('precio')).toEqual(['d', 'a', 'b', 'c']);
    expect(ids('compra')).toEqual(['b', 'a', 'd', 'c']);
    expect(ids('variacion')).toEqual(['b', 'a', 'c', 'd']);
  });

  it('productStats cuenta precios y subidas recientes', () => {
    expect(productStats(products, trends, 5, '2026-09-25')).toEqual({ total: 4, withPrice: 3, withoutPrice: 1, recentRises: 1 });
    expect(productStats(products, trends, 5, '2027-03-01').recentRises).toBe(0);
    expect(productStats(products, trends, 30, '2026-09-25').recentRises).toBe(0);
  });
});

describe('productUsage', () => {
  const dish = (p: Partial<Dish> & { id: string; name: string }): Dish => ({
    kind: 'plato',
    saleVatPct: 10,
    portions: 1,
    items: [],
    status: 'revisado',
    source: 'manual',
    createdAt: '',
    updatedAt: '',
    ...p,
  });
  const dishes = [
    dish({
      id: 'salsa',
      name: 'Salsa brava',
      kind: 'elaboracion',
      portions: 10,
      items: [{ id: 's1', name: 'Tomate', ref: { type: 'product', id: 'tom' }, quantity: 1, unit: 'kg', basis: 'neta' }],
    }),
    dish({
      id: 'bravas',
      name: 'Patatas bravas',
      items: [{ id: 'b1', name: 'Salsa', ref: { type: 'dish', id: 'salsa' }, quantity: 50, unit: 'g', basis: 'neta' }],
    }),
    dish({
      id: 'ensalada',
      name: 'Ensalada de tomate',
      portions: 2,
      items: [
        { id: 'e1', name: 'Tomate', ref: { type: 'product', id: 'tom' }, quantity: 300, unit: 'g', basis: 'neta' },
        { id: 'e2', name: 'Tomate cherry', ref: { type: 'product', id: 'tom' }, quantity: 100, unit: 'g', basis: 'neta' },
      ],
    }),
    dish({
      id: 'otro',
      name: 'Otro',
      items: [{ id: 'o1', name: 'Sal', ref: { type: 'product', id: 'sal' }, quantity: 1, unit: 'g', basis: 'neta' }],
    }),
  ];
  const cost = (dishId: string, items: { itemId: string; cost: number; share: number }[], fc?: number): DishCost =>
    ({
      dishId,
      foodCostPct: fc,
      items: items.map((i) => ({ itemId: i.itemId, cost: i.cost, costSharePct: i.share })),
    }) as unknown as DishCost;
  const costs = new Map<string, DishCost>([
    [
      'ensalada',
      cost(
        'ensalada',
        [
          { itemId: 'e1', cost: 0.6, share: 40 },
          { itemId: 'e2', cost: 0.2, share: 13 },
        ],
        22,
      ),
    ],
    ['salsa', cost('salsa', [{ itemId: 's1', cost: 2, share: 70 }])],
    ['bravas', cost('bravas', [], 31)],
  ]);

  it('suma varias líneas del mismo producto y detecta el uso a través de elaboraciones', () => {
    const u = productUsage('tom', dishes, costs);
    expect(u.map((x) => x.dish.id)).toEqual(['salsa', 'ensalada', 'bravas']);
    const ens = u.find((x) => x.dish.id === 'ensalada');
    expect(ens?.sharePct).toBe(53);
    expect(ens?.costPerPortion).toBeCloseTo(0.4);
    expect(ens?.foodCostPct).toBe(22);
    const salsa = u.find((x) => x.dish.id === 'salsa');
    expect(salsa?.costPerPortion).toBeCloseTo(0.2);
    const bravas = u.find((x) => x.dish.id === 'bravas');
    expect(bravas?.via).toBe('Salsa brava');
    expect(bravas?.foodCostPct).toBe(31);
  });

  it('sin costes calculados sigue listando los platos', () => {
    expect(productUsage('sal', dishes, undefined).map((x) => x.dish.id)).toEqual(['otro']);
    expect(productUsage('nada', dishes, costs)).toEqual([]);
  });
});

describe('importar tarifas', () => {
  const parse = (raw: string | number | null | undefined) => {
    if (raw == null) return undefined;
    if (typeof raw === 'number') return raw;
    const n = Number(raw.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  };
  const rows = [
    ['Tarifa septiembre', null, null, null],
    ['Código', 'Artículo', 'Ud', 'Precio'],
    ['A1', 'Tomate pera cat. I', 'kg', '1,45 €'],
    ['A2', 'Aceite oliva v.e. garrafa 5L', 'ud', 32.5],
    ['', '', '', ''],
    ['A3', 'Sin precio', 'kg', ''],
    ['', 'TOTAL', '', '999'],
    ['123', '4567', 'kg', '2'],
  ];
  it('extrae filas válidas y descarta vacías, totales y sin precio', () => {
    const r = parsePriceRows(rows, { description: 1, code: 0, unit: 2, unitPrice: 3 }, 1, parse);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ rowIndex: 2, description: 'Tomate pera cat. I', code: 'A1', unit: 'kg', quantity: 1, unitPrice: 1.45 });
    expect(r[1]).toMatchObject({ description: 'Aceite oliva v.e. garrafa 5L', unit: 'ud', unitPrice: 32.5 });
  });
  it('usa importe / cantidad si no hay precio unitario', () => {
    const r = parsePriceRows(
      [
        ['Artículo', 'Cant', 'Importe'],
        ['Queso manchego', '2,5', '37,50'],
      ],
      { description: 0, quantity: 1, total: 2 },
      0,
      parse,
    );
    expect(r[0]).toMatchObject({ quantity: 2.5, unitPrice: 15, total: 37.5, unit: 'ud' });
  });
  it('columnLetter', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
  });
});

describe('niceTicks y parseAmount', () => {
  it('marcas redondas que cubren el rango', async () => {
    const { niceTicks } = await import('./logic');
    expect(niceTicks(0.882, 0.978, 4)).toEqual({ ticks: [0.85, 0.9, 0.95, 1], decimals: 2 });
    expect(niceTicks(3, 47, 4)).toEqual({ ticks: [0, 20, 40, 60], decimals: 0 });
    const flat = niceTicks(2, 2, 4);
    expect(flat.ticks[0]).toBeLessThan(2);
    expect(flat.ticks[flat.ticks.length - 1]).toBeGreaterThan(2);
    expect(niceTicks(0.0101, 0.0199, 4).decimals).toBe(3);
  });
  it('parseAmount entiende coma decimal, miles y punto decimal', async () => {
    const { parseAmount } = await import('./logic');
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('1.234,56 €')).toBe(1234.56);
    expect(parseAmount('1.234')).toBe(1234);
    expect(parseAmount('0.125')).toBe(0.125);
    expect(parseAmount('1.5')).toBe(1.5);
    expect(parseAmount(' ')).toBeUndefined();
    expect(parseAmount('abc')).toBeNaN();
  });
});
