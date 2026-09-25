import { describe, expect, it, vi } from 'vitest';
import type { InvoiceLine } from '../types';
import { invoiceParseSchema, menuParseSchema, recipesParseSchema } from './schemas';
import {
  cleanDishName,
  isValidSpanishTaxId,
  mapInvoice,
  mapMenu,
  mapRecipeBatch,
  normalizeBilledUnit,
  normalizeDate,
  normalizeTaxId,
  toSentenceCase,
} from './normalize';

// core/pack lo implementa otro módulo: aquí se sustituye por una versión mínima y determinista.
const packMock = vi.hoisted(() => ({ fail: false }));
vi.mock('../core/pack', () => ({
  normalizeInvoiceLine: <T extends Pick<InvoiceLine, 'quantity' | 'unit' | 'unitPrice' | 'total' | 'discountPct' | 'packSize'>>(line: T) => {
    if (packMock.fail) throw new Error('No implementado: normalizeInvoiceLine');
    const f = 1 - (line.discountPct ?? 0) / 100;
    const warnings: string[] = [];
    if (Math.abs(line.quantity * line.unitPrice * f - line.total) > Math.max(0.02, Math.abs(line.total) * 0.01)) warnings.push('Cantidad × precio no cuadra con el importe');
    const mass = line.unit === 'kg';
    const pack = line.packSize;
    const baseUnit = mass ? 'kg' : pack && pack.unit === 'l' ? 'l' : 'ud';
    const baseQuantity = mass ? line.quantity : pack ? line.quantity * pack.count * pack.size : line.quantity;
    return { ...line, baseUnit, baseQuantity, pricePerBase: line.total / baseQuantity, warnings };
  },
}));

const inv = (raw: unknown) => mapInvoice(invoiceParseSchema.parse(raw), { rawText: '{}' });
const line = (patch: Record<string, unknown>) => ({
  description: 'PRODUCTO',
  code: '',
  quantity: 1,
  unit: 'ud',
  unitPrice: 1,
  discountPct: 0,
  total: 1,
  suggestedName: 'Producto',
  suggestedCategory: 'otros',
  confidence: 0.95,
  ...patch,
});

describe('utilidades de cabecera', () => {
  it('fechas españolas e ISO', () => {
    expect(normalizeDate('12/03/2025')).toBe('2025-03-12');
    expect(normalizeDate('2025-03-12')).toBe('2025-03-12');
    expect(normalizeDate('1-3-25')).toBe('2025-03-01');
    expect(normalizeDate('12.03.2025')).toBe('2025-03-12');
    expect(normalizeDate('31/02/2025')).toBeUndefined();
    expect(normalizeDate('marzo')).toBeUndefined();
  });

  it('CIF/NIF: limpieza y dígito de control', () => {
    expect(normalizeTaxId('CIF: B-12.345.674')).toBe('B12345674');
    expect(normalizeTaxId('ESB12345674')).toBe('B12345674');
    expect(isValidSpanishTaxId('B12345674')).toBe(true);
    expect(isValidSpanishTaxId('B12345675')).toBe(false);
    expect(isValidSpanishTaxId('12345678Z')).toBe(true);
    expect(isValidSpanishTaxId('12345678A')).toBe(false);
    expect(isValidSpanishTaxId('X1234567L')).toBe(true);
    expect(isValidSpanishTaxId('Q2826000H')).toBe(true);
  });

  it('unidades de facturación', () => {
    expect(normalizeBilledUnit('KGS')).toBe('kg');
    expect(normalizeBilledUnit('Uds.')).toBe('ud');
    expect(normalizeBilledUnit('CJ')).toBe('caja');
    expect(normalizeBilledUnit('Botella')).toBe('bot');
    expect(normalizeBilledUnit('')).toBe('ud');
    expect(normalizeBilledUnit('Ristra')).toBe('ristra');
  });
});

describe('mapInvoice', () => {
  it('mapea cabecera y líneas (método ia) con números como texto', () => {
    const r = inv({
      supplierName: '  Distribuciones García S.L. ',
      supplierTaxId: 'B-12345674',
      number: 'Nº FA-2025/0012',
      date: '12/03/2025',
      subtotal: '97,35',
      vatTotal: '9,74',
      total: '107,09',
      lines: [
        line({ description: 'TOMATE PERA CAT.I', quantity: '12,5', unit: 'KGS', unitPrice: '1,80', total: '22,50', vatPct: '4', suggestedName: 'TOMATE PERA', suggestedCategory: 'Verduras', confidence: 98 }),
        line({ description: 'LECHE ENTERA 6X1L', quantity: 5, unit: 'CJ', unitPrice: 5.34, total: 26.7, vatPct: 4, packSize: { count: 6, size: 1, unit: 'L' }, suggestedName: 'leche entera', suggestedCategory: 'lácteos' }),
        line({ description: 'SOLOMILLO TERNERA', quantity: 2.05, unit: 'kg', unitPrice: 23.5, discountPct: 0, total: 48.18, vatPct: 10, suggestedName: 'Solomillo de ternera', suggestedCategory: 'carne' }),
      ],
      nonProductLines: [],
      warnings: [],
    });
    expect(r).toMatchObject({ supplierName: 'Distribuciones García S.L.', supplierTaxId: 'B12345674', number: 'FA-2025/0012', date: '2025-03-12', subtotal: 97.35, vatTotal: 9.74, total: 107.09, method: 'ia', rawText: '{}' });
    expect(r.lines).toHaveLength(3);
    expect(r.lines[0]).toMatchObject({ quantity: 12.5, unit: 'kg', unitPrice: 1.8, total: 22.5, vatPct: 4, suggestedName: 'Tomate pera', suggestedCategory: 'verdura', confidence: 0.98, baseUnit: 'kg', baseQuantity: 12.5 });
    expect(r.lines[0].warnings).toBeUndefined();
    expect(r.lines[0]).not.toHaveProperty('discountPct');
    expect(r.lines[1]).toMatchObject({ unit: 'caja', packSize: { count: 6, size: 1, unit: 'l' }, baseUnit: 'l', baseQuantity: 30, suggestedName: 'Leche entera', suggestedCategory: 'lacteo' });
    expect(r.lines[1].pricePerBase).toBeCloseTo(0.89, 3);
    expect(r.warnings).toEqual([]);
  });

  it('corrige un importe mal leído cuando la base imponible lo confirma', () => {
    const r = inv({
      subtotal: 45.9,
      lines: [
        line({ description: 'ACEITE OLIVA 5L', quantity: 2, unitPrice: 11.25, total: 22.5 }),
        line({ description: 'HARINA 1KG', quantity: 12, unitPrice: 1.95, total: 234 }), // debería ser 23,40
      ],
    });
    expect(r.lines[1].total).toBe(23.4);
    expect(r.lines[1].confidence).toBeLessThanOrEqual(0.7);
    expect(r.lines[1].warnings?.[0]).toMatch(/Importe corregido a 23,40/);
    expect(r.warnings.join(' ')).not.toMatch(/no cuadra/);
  });

  it('corrige el precio unitario cuando el importe es el correcto', () => {
    const r = inv({
      subtotal: 45.9,
      lines: [line({ quantity: 2, unitPrice: 11.25, total: 22.5 }), line({ description: 'HARINA 1KG', quantity: 12, unitPrice: 19.5, total: 23.4 })],
    });
    expect(r.lines[1]).toMatchObject({ unitPrice: 1.95, total: 23.4, quantity: 12 });
    expect(r.lines[1].warnings?.[0]).toMatch(/^Precio unitario corregido a 1,95\s€ con el importe \(se leyó 19,50\s€\)$/);
  });

  it('corrige la cantidad en unidades enteras cuando es lo plausible', () => {
    const r = inv({ subtotal: 30, lines: [line({ description: 'LIMONES MALLA', unit: 'ud', quantity: 1.2, unitPrice: 2.5, total: 30 })] });
    expect(r.lines[0].quantity).toBe(12);
    expect(r.lines[0].warnings?.[0]).toBe('Cantidad corregida a 12 con el importe (se leyó 1,2)');
  });

  it('descarta un descuento que el importe no refleja', () => {
    const r = inv({ subtotal: 20, lines: [line({ quantity: 10, unitPrice: 2, discountPct: 10, total: 20 })] });
    expect(r.lines[0]).not.toHaveProperty('discountPct');
    expect(r.lines[0].warnings?.[0]).toMatch(/no refleja el descuento/);
  });

  it('corrige un descuento mal leído si un porcentaje redondo explica el importe', () => {
    const r = inv({ subtotal: 19, lines: [line({ quantity: 10, unitPrice: 2, discountPct: 10, total: 19 })] });
    expect(r.lines[0]).toMatchObject({ discountPct: 5, unitPrice: 2, quantity: 10, total: 19 });
    expect(r.lines[0].warnings?.[0]).toBe('Descuento corregido al 5 % con el importe (se leyó 10 %)');
  });

  it('líneas sin cargo: se conservan con aviso', () => {
    const r = inv({ lines: [line({ quantity: 2, unitPrice: 0, total: 0 })] });
    expect(r.lines[0].warnings?.[0]).toMatch(/Línea sin cargo/);
    expect(r.lines[0].confidence).toBe(0.6);
  });

  it('número de factura: quita prefijos «Nº» sin romper números que empiezan por NO', () => {
    expect(inv({ number: 'Nº 000123', lines: [] }).number).toBe('000123');
    expect(inv({ number: 'No. 55', lines: [] }).number).toBe('55');
    expect(inv({ number: 'NOV-2025-001', lines: [] }).number).toBe('NOV-2025-001');
    expect(inv({ number: 'Núm. FV/88', lines: [] }).number).toBe('FV/88');
  });

  it('descuento dado como fracción (0,1 = 10 %)', () => {
    const r = inv({ lines: [line({ quantity: 10, unitPrice: 2, discountPct: 0.1, total: 18 })] });
    expect(r.lines[0].discountPct).toBe(10);
    expect(r.lines[0].warnings).toBeUndefined();
  });

  it('sin base imponible no corrige: baja la confianza y deja el aviso de la línea', () => {
    const r = inv({ lines: [line({ quantity: 12, unitPrice: 1.95, total: 234 })] });
    expect(r.lines[0].total).toBe(234);
    expect(r.lines[0].confidence).toBe(0.5);
    expect(r.lines[0].warnings).toEqual(['Cantidad × precio no cuadra con el importe']);
  });

  it('deduce datos que faltan a partir de los otros dos', () => {
    const r = inv({
      lines: [
        { description: 'A', quantity: 3, unitPrice: 2, total: null },
        { description: 'B', quantity: 4, unitPrice: '', total: 10 },
        { description: 'C', quantity: null, unitPrice: 2.5, total: 7.5 },
        { description: 'D', total: 9.99 },
        { description: '', quantity: 1, total: 3 },
        { description: 'E' },
      ],
    });
    expect(r.lines.map((l) => [l.description, l.quantity, l.unitPrice, l.total])).toEqual([
      ['A', 3, 2, 6],
      ['B', 4, 2.5, 10],
      ['C', 3, 2.5, 7.5],
      ['D', 1, 9.99, 9.99],
    ]);
    expect(r.lines[3].confidence).toBe(0.5);
    expect(r.warnings).toContain('Se han descartado 2 líneas sin descripción ni importes');
  });

  it('avisa si la suma de líneas no cuadra con la base imponible (> 1 %)', () => {
    const r = inv({ subtotal: 100, lines: [line({ quantity: 1, unitPrice: 90, total: 90 })] });
    expect(r.warnings.find((w) => w.startsWith('La suma de las líneas'))).toMatch(/90,00.*100,00.*diferencia de 10,00/);
  });

  it('explica la diferencia cuando la cubren los portes y otros cargos', () => {
    const r = inv({
      date: '2025-03-12',
      subtotal: 102,
      vatTotal: 10.2,
      total: 112.2,
      lines: [line({ quantity: 1, unitPrice: 90, total: 90 })],
      nonProductLines: [{ description: 'Portes', amount: '12,00' }, { description: 'Suma y sigue' }],
    });
    expect(r.warnings[0]).toMatch(/^Se han omitido líneas que no son producto: Portes \(12,00\s€\), Suma y sigue$/);
    expect(r.warnings[1]).toMatch(/por los cargos o descuentos no incluidos como producto/);
    expect(r.warnings).toHaveLength(2);
  });

  it('la conciliación usa la base menos los cargos no producto', () => {
    const r = inv({
      subtotal: 57.4,
      lines: [line({ quantity: 2, unitPrice: 11.25, total: 22.5 }), line({ quantity: 12, unitPrice: 1.95, total: 234 })],
      nonProductLines: [{ description: 'Portes', amount: 11.5 }],
    });
    expect(r.lines[1].total).toBe(23.4);
  });

  it('comprueba base + IVA = total, el CIF y la fecha', () => {
    const r = inv({ supplierTaxId: 'B12345675', date: '31/02/2025', subtotal: 10, vatTotal: 1, total: 12, lines: [line({ quantity: 1, unitPrice: 10, total: 10 })] });
    expect(r.warnings.join('\n')).toMatch(/CIF\/NIF del proveedor \(B12345675\)/);
    expect(r.warnings.join('\n')).toMatch(/No se ha podido interpretar la fecha «31\/02\/2025»/);
    expect(r.warnings.join('\n')).toMatch(/no coincide con el total/);
    expect(r).not.toHaveProperty('date');
  });

  it('sin base imponible, compara la suma con IVA frente al total', () => {
    const r = inv({ total: 30, lines: [line({ quantity: 1, unitPrice: 10, total: 10, vatPct: 10 })] });
    expect(r.warnings.join('\n')).toMatch(/La suma de las líneas con IVA \(11,00\s€\) no cuadra con el total/);
  });

  it('si la normalización de la línea falla, la conserva con un aviso', () => {
    packMock.fail = true;
    try {
      const r = inv({ lines: [line({ quantity: 2, unitPrice: 3, total: 6 })] });
      expect(r.lines[0]).toMatchObject({ quantity: 2, unitPrice: 3, total: 6 });
      expect(r.lines[0].warnings).toEqual(['No se ha podido calcular el precio por unidad base: revísalo']);
    } finally {
      packMock.fail = false;
    }
  });

  it('respuesta cortada y documento sin líneas', () => {
    const r = mapInvoice(invoiceParseSchema.parse({ lines: [], warnings: ['El documento no es una factura'] }), { truncated: true });
    expect(r.warnings).toEqual([
      'No se ha encontrado la fecha de la factura: indícala al revisar',
      'No se han encontrado líneas de producto en el documento',
      'La respuesta de la IA se cortó por ser muy larga: puede que falten las últimas líneas. Divide el documento si es necesario',
      'El documento no es una factura',
    ]);
  });
});

describe('mapMenu', () => {
  it('limpia nombres, fusiona duplicados entre fotos y conserva platos distintos', () => {
    const r = mapMenu(
      menuParseSchema.parse({
        items: [
          { section: 'ENTRANTES', name: 'PULPO A LA GALLEGA', description: '', price: '18,50 €', confidence: 0.9 },
          { section: 'Entrantes', name: 'Croquetas caseras de jamón', description: 'Media ración: 6 €', price: 10, confidence: 0.95 },
          { section: 'Entrantes', name: 'Pulpo a la gallega', description: 'Con cachelos y pimentón de la Vera', price: 18.5, confidence: 0.99 },
          { section: 'Tapas', name: 'Croquetas caseras de jamón', description: '', price: 2.5, confidence: 0.9 },
          { section: 'Postres', name: '3. Tarta de queso ........ 6,50 €', description: '', price: 6.5, confidence: 0.8 },
          { section: 'Vinos', name: 'Ribera del Duero crianza', description: 'Copa: 4 €', confidence: 0.7 },
          { section: 'Vinos', name: 'Precio raro', description: '', price: -3, confidence: 0.5 },
          { section: '', name: '   ', description: '', price: 3, confidence: 1 },
        ],
        warnings: ['La foto 2 está algo borrosa'],
      }),
    );
    expect(r.method).toBe('ia');
    expect(r.entries.map((e) => [e.section, e.name, e.price])).toEqual([
      ['Entrantes', 'Pulpo a la gallega', 18.5],
      ['Entrantes', 'Croquetas caseras de jamón', 10],
      ['Tapas', 'Croquetas caseras de jamón', 2.5],
      ['Postres', 'Tarta de queso', 6.5],
      ['Vinos', 'Ribera del Duero crianza', undefined],
      ['Vinos', 'Precio raro', undefined],
    ]);
    expect(r.entries[0]).toMatchObject({ description: 'Con cachelos y pimentón de la Vera', confidence: 0.99 });
    expect(r.warnings).toEqual([
      '2 platos no tienen precio legible: complétalos al revisar',
      'Se ha descartado 1 precio que no parecía válido',
      'La foto 2 está algo borrosa',
    ]);
  });

  it('helpers de texto', () => {
    expect(cleanDishName('SECRETO IBÉRICO A LA BRASA')).toBe('Secreto ibérico a la brasa');
    expect(cleanDishName('12 - Chuletón de vaca 1 kg')).toBe('Chuletón de vaca 1 kg');
    expect(toSentenceCase('VINO TINTO DO RIOJA')).toBe('Vino tinto DO rioja');
  });
});

describe('mapRecipeBatch', () => {
  const ctx = {
    dishes: [
      { ref: 'D1', key: 'dish-a', name: 'Tortilla de patatas' },
      { ref: 'D2', key: 'dish-b', name: 'Entrecot a la brasa' },
    ],
    productRefs: new Map([
      ['P1', 'prod-huevo'],
      ['P2', 'prod-patata'],
      ['P3', 'prod-entrecot'],
    ]),
    productIds: new Set(['prod-huevo', 'prod-patata', 'prod-entrecot', 'prod-aceite']),
  };
  const ing = (patch: Record<string, unknown>) => ({ name: 'X', quantity: 10, unit: 'g', basis: 'neta', category: 'otros', productRef: '', note: '', ...patch });

  it('valida referencias de producto, unidades y cantidades', () => {
    const parsed = recipesParseSchema.parse({
      dishes: [
        {
          ref: 'D1',
          dishName: 'Tortilla',
          ingredients: [
            ing({ name: 'huevo', quantity: 2, unit: 'ud', basis: 'bruta', category: 'huevo', productRef: 'p1' }),
            ing({ name: 'Patata', quantity: 0.25, unit: 'kg', productRef: 'P2', wastePct: 120 }),
            ing({ name: 'Aceite de oliva', quantity: 3, unit: 'cl', productRef: 'prod-aceite', cookingLossPct: -5 }),
            ing({ name: 'Cebolla', quantity: 60, unit: 'gr', productRef: 'P99' }),
            ing({ name: 'Sal', quantity: 1.5, unit: 'g', productRef: 'prod-inventado' }),
            ing({ name: 'Absurdo', quantity: 50, unit: 'l' }),
            ing({ name: 'Cero', quantity: 0 }),
            ing({ name: '', quantity: 5 }),
          ],
          steps: ['1. Pelar y cortar las patatas', 'Paso 2: Freír a fuego suave', 'Cuajar la tortilla.'],
          allergens: ['huevo'],
          confidence: 0.9,
        },
      ],
    });
    const out = mapRecipeBatch(parsed, ctx);
    const p = out.get('dish-a');
    expect(p).toBeDefined();
    expect(p).toMatchObject({ dishName: 'Tortilla de patatas', portions: 1, source: 'ia', confidence: 0.9, allergens: ['huevo'] });
    expect(p?.procedure).toBe('1. Pelar y cortar las patatas.\n2. Freír a fuego suave.\n3. Cuajar la tortilla.');
    expect(p?.ingredients).toEqual([
      { name: 'Huevo', quantity: 2, unit: 'ud', basis: 'bruta', category: 'huevo', productId: 'prod-huevo' },
      { name: 'Patata', quantity: 250, unit: 'g', basis: 'neta', category: 'otros', productId: 'prod-patata', wastePct: 95 },
      { name: 'Aceite de oliva', quantity: 30, unit: 'ml', basis: 'neta', category: 'otros', productId: 'prod-aceite', cookingLossPct: 0 },
      { name: 'Cebolla', quantity: 60, unit: 'g', basis: 'neta', category: 'otros' },
      { name: 'Sal', quantity: 1.5, unit: 'g', basis: 'neta', category: 'otros' },
      { name: 'Absurdo', quantity: 50, unit: 'ml', basis: 'neta', category: 'otros' },
    ]);
  });

  it('asocia por nombre si la referencia no cuadra y por orden si coincide el número de platos', () => {
    const parsed = recipesParseSchema.parse({
      dishes: [
        { ref: 'X9', dishName: 'ENTRECOT A LA BRASA', ingredients: [ing({ name: 'Entrecot', quantity: 300, productRef: 'P3' })], steps: [], allergens: [], confidence: 1 },
        { ref: '??', dishName: 'Otra cosa', ingredients: [ing({ name: 'Huevo', quantity: 2, unit: 'ud' })], steps: [], allergens: [], confidence: 1 },
      ],
    });
    const out = mapRecipeBatch(parsed, ctx);
    expect(out.get('dish-b')?.ingredients[0]).toMatchObject({ name: 'Entrecot', productId: 'prod-entrecot' });
    expect(out.get('dish-b')?.procedure).toBeUndefined();
    // El segundo no tiene ref ni nombre válidos, pero hay tantos platos como se pidieron: se asocia por posición… que ya está ocupada.
    expect(out.size).toBe(1);
  });

  it('descarta platos sin ingredientes válidos', () => {
    const parsed = recipesParseSchema.parse({ dishes: [{ ref: 'D1', dishName: 'x', ingredients: [ing({ quantity: -1 })], steps: [], allergens: [], confidence: 1 }] });
    expect(mapRecipeBatch(parsed, ctx).size).toBe(0);
  });
});
