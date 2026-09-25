import { describe, expect, it } from 'vitest';
import type { ExtractedInvoice } from '../types';
import type { PdfTextLine } from './pdf';
import { invoiceQuality, mergeInvoiceReadings, parseInvoiceReading, parseInvoiceText, sumMatches, validCif, validNif } from './invoiceParser';

// ───────────────────────────── Documentos de prueba ─────────────────────────────

interface ExpectedLine {
  description: string;
  code?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPct?: number;
  total: number;
  vatPct?: number;
  pricePerBase: number;
  baseUnit: string;
}

interface Expected {
  method: 'pdf-texto' | 'ocr';
  header: { supplierName?: string; supplierTaxId?: string; number?: string; date?: string; subtotal?: number; vatTotal?: number; total?: number };
  lines: ExpectedLine[];
}

const texts = import.meta.glob('../../tests/fixtures/invoices/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const expectations = import.meta.glob('../../tests/fixtures/invoices/*.json', { import: 'default', eager: true }) as Record<string, Expected>;
const fixtures = Object.keys(texts)
  .sort()
  .map((path) => ({ name: path.split('/').pop() as string, text: texts[path], expected: expectations[path.replace(/\.txt$/, '.json')] }));

/** Filas posicionales como las reconstruiría pdf.js: cada tramo separado por 2+ espacios es una celda con su X. */
function toPdfLines(text: string, charWidth = 5): PdfTextLine[] {
  return text.split('\n').map((line, i) => {
    const items: PdfTextLine['items'] = [];
    const re = /\S+(?: \S+)*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) items.push({ x: m.index * charWidth, width: m[0].length * charWidth, str: m[0] });
    return { page: 1, y: i * 12, text: line, items };
  });
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function lineMatches(got: ExtractedInvoice['lines'][number], exp: ExpectedLine): boolean {
  return (
    norm(got.description) === norm(exp.description) &&
    Math.abs(got.quantity - exp.quantity) < 1e-6 &&
    Math.abs(got.unitPrice - exp.unitPrice) < 1e-6 &&
    Math.abs(got.total - exp.total) < 0.005 &&
    got.unit === exp.unit &&
    (exp.discountPct === undefined ? got.discountPct === undefined : Math.abs((got.discountPct ?? 0) - exp.discountPct) < 0.01) &&
    got.vatPct === exp.vatPct &&
    got.baseUnit === exp.baseUnit &&
    Math.abs((got.pricePerBase ?? 0) - exp.pricePerBase) <= Math.max(0.0001, exp.pricePerBase * 1e-4)
  );
}

function exactRatio(inv: ExtractedInvoice, expected: Expected): number {
  const used = new Set<number>();
  let ok = 0;
  for (const e of expected.lines) {
    const idx = inv.lines.findIndex((l, i) => !used.has(i) && lineMatches(l, e));
    if (idx >= 0) {
      used.add(idx);
      ok++;
    }
  }
  return ok / Math.max(expected.lines.length, inv.lines.length);
}

describe('parseInvoiceText · documentos reales (texto de pdf.js y OCR)', () => {
  it('hay al menos 8 facturas y 3 variantes de OCR con su resultado esperado', () => {
    expect(fixtures.filter((f) => !f.name.startsWith('ocr')).length).toBeGreaterThanOrEqual(8);
    expect(fixtures.filter((f) => f.name.startsWith('ocr')).length).toBeGreaterThanOrEqual(3);
    for (const f of fixtures) expect(f.expected, f.name).toBeDefined();
  });

  describe.each(fixtures)('$name', ({ text, expected }) => {
    it('texto plano: ≥ 95 % de líneas exactas y cabecera correcta', () => {
      const inv = parseInvoiceText({ text }, expected.method);
      expect(inv.method).toBe(expected.method);
      expect(exactRatio(inv, expected)).toBeGreaterThanOrEqual(0.95);
      expect(inv.lines.length).toBe(expected.lines.length);
      expect({
        supplierName: inv.supplierName,
        supplierTaxId: inv.supplierTaxId,
        number: inv.number,
        date: inv.date,
        subtotal: inv.subtotal,
        vatTotal: inv.vatTotal,
        total: inv.total,
      }).toEqual(expected.header);
      // Todo cuadra: sin avisos de validación ni de suma
      expect(inv.warnings.filter((w) => /no se ha podido validar|no se han podido validar|no cuadra|difiere/.test(w))).toEqual([]);
      for (const l of inv.lines) expect(l.suggestedName, l.description).toBeTruthy();
    });

    it('filas con posiciones X (columnas por cabecera): mismo resultado', () => {
      const inv = parseInvoiceText({ text }, expected.method, toPdfLines(text));
      expect(exactRatio(inv, expected)).toBeGreaterThanOrEqual(0.95);
      expect(inv.number).toBe(expected.header.number);
      expect(inv.supplierTaxId).toBe(expected.header.supplierTaxId);
      expect(inv.subtotal).toBe(expected.header.subtotal);
    });
  });
});

describe('cabecera del documento', () => {
  it('distingue el CIF del proveedor del CIF del cliente', () => {
    const text = [
      'Cliente: BAR EL RINCÓN S.L.   CIF B11223344',
      'DISTRIBUCIONES LÓPEZ S.L.',
      'CIF: B99887766',
      'Factura nº 2026-15    Fecha: 01/02/2026',
      'Descripción              Cantidad   Precio   Importe',
      'HARINA DE TRIGO 25KG            2    14,00     28,00',
      'Base imponible  28,00   IVA 4%  1,12   Total  29,12',
    ].join('\n');
    const inv = parseInvoiceText({ text }, 'pdf-texto');
    expect(inv.supplierTaxId).toBe('B99887766');
    expect(inv.supplierName).toBe('DISTRIBUCIONES LÓPEZ S.L.');
    expect(inv.number).toBe('2026-15');
    expect(inv.date).toBe('2026-02-01');
  });

  it.each([
    ['Nº Factura: FV-2026/0913', 'FV-2026/0913'],
    ['N" Factura: FV-2026/0913', 'FV-2026/0913'],
    ['Factura: 2026/P/7781', '2026/P/7781'],
    ['Número de factura: SN-2026-1187', 'SN-2026-1187'],
    ['FACTURA   Serie B   Nº 00123', 'B-00123'],
    ['Nº Pedido: 5566     Nº Factura: A-77', 'A-77'],
  ])('número de factura en "%s"', (line, number) => {
    const text = `PROVEEDOR EJEMPLO S.L.\nCIF B12345678\n${line}\nFecha 05/03/2026`;
    expect(parseInvoiceText({ text }, 'ocr').number).toBe(number);
  });

  it('valida CIF y NIF españoles', () => {
    expect(validCif('B12345674')).toBe(true);
    expect(validCif('B12345678')).toBe(false);
    expect(validCif('Q2826000H')).toBe(true);
    expect(validNif('12345678Z')).toBe(true);
    expect(validNif('12345678A')).toBe(false);
    expect(validNif('X1234567L')).toBe(true);
  });

  it('OCR: recupera la letra inicial del CIF leída como cifra tras la etiqueta', () => {
    const text = 'SUMINISTROS NORTE S.L.\nCIF: 812345674\nFactura 12 Fecha 01/01/2026';
    expect(parseInvoiceText({ text }, 'ocr').supplierTaxId).toBe('B12345674');
  });
});

describe('líneas de producto', () => {
  const wrap = (rows: string[], footer = '') =>
    ['PROVEEDOR S.L.', 'CIF B12345674', 'Factura 1  Fecha 01/01/2026', 'Descripción                 Cantidad    Precio     Importe', ...rows, footer].join('\n');

  it('unidad escrita entre los números ("2,500 KG 12,50 31,25")', () => {
    const inv = parseInvoiceText({ text: wrap(['SALMÓN NORUEGO FILETE        2,500 KG    12,50       31,25']) }, 'pdf-texto');
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ description: 'SALMÓN NORUEGO FILETE', quantity: 2.5, unit: 'kg', unitPrice: 12.5, total: 31.25, confidence: 1 });
  });

  it('ignora lotes y caducidades y une las descripciones partidas', () => {
    const inv = parseInvoiceText(
      {
        text: wrap([
          'QUESO CURADO DE OVEJA            3,200     14,20       45,44',
          'Lote: 23/456   Cad: 12/05/2027',
          'ACEITE DE OLIVA VIRGEN EXTRA         2      31,50       63,00',
          'GARRAFA 5 LITROS',
        ]),
      },
      'pdf-texto',
    );
    expect(inv.lines.map((l) => l.description)).toEqual(['QUESO CURADO DE OVEJA', 'ACEITE DE OLIVA VIRGEN EXTRA GARRAFA 5 LITROS']);
    expect(inv.lines[1].packSize).toEqual({ count: 1, size: 5, unit: 'l' });
  });

  it('descuento en %, código inicial e IVA por línea', () => {
    const inv = parseInvoiceText({ text: wrap(['000123   TOMATE FRITO 6X400G        10     2,40    5,00    22,80    10']) }, 'pdf-texto');
    expect(inv.lines[0]).toMatchObject({ code: '000123', quantity: 10, unitPrice: 2.4, discountPct: 5, total: 22.8, vatPct: 10 });
  });

  it('avisa si la suma de líneas no cuadra con la base imponible', () => {
    const inv = parseInvoiceText({ text: wrap(['PIMIENTO VERDE     3,000    2,00     6,00'], 'Base imponible   26,00\nIVA 4%   1,04\nTotal   27,04') }, 'pdf-texto');
    expect(inv.warnings.some((w) => w.includes('no cuadra con la base imponible'))).toBe(true);
  });

  it('sin líneas: avisa en lugar de inventar', () => {
    const inv = parseInvoiceText({ text: 'Documento sin tabla\nGracias por su visita' }, 'pdf-texto');
    expect(inv.lines).toEqual([]);
    expect(inv.warnings.some((w) => w.startsWith('No se han encontrado líneas'))).toBe(true);
  });

  it('ticket con precios IVA incluido: los convierte a precios sin IVA', () => {
    const text = [
      'BAZAR ALIMENTACIÓN S.L.   CIF B12345674',
      'Factura simplificada 778   Fecha 02/02/2026',
      'Descripción              Cant.   Precio    Importe',
      'PAN BARRA                    4     1,10       4,40',
      'LECHE 1L                     2     1,10       2,20',
      'Base imponible 6,00   IVA 10% 0,60   TOTAL 6,60',
    ].join('\n');
    const inv = parseInvoiceText({ text }, 'pdf-texto');
    expect(inv.warnings.some((w) => w.includes('incluían IVA'))).toBe(true);
    expect(inv.lines.map((l) => l.total)).toEqual([4, 2]);
  });
});

describe('OCR: correcciones validadas por la aritmética', () => {
  const header = [
    'Frutas García S.L.                 FACTURA',
    'CIF: B28123456           Nº Factura: FV-1',
    'Fecha: 18/09/2026',
    'Código   Descripción                    Cantidad   Ud.    Precio   Importe',
  ];
  const tail = ['1102   TOMATE PERA CAT.I              12,400   KG     1,85     22,94', 'Base imponible   56,69', 'IVA 4%   2,27', 'TOTAL FACTURA   58,96'];

  it('cifra mal leída (1,15 → 4,45) e importe ilegible: los corrige con la base imponible', () => {
    const text = [
      ...header,
      '1021   PATATA AGRIA SACO 25KG         25,000   KG     0,89     PEO',
      '1044   CEBOLLA DULCE MALLA            10,000   KG     4,45     11,50',
      ...tail,
    ].join('\n');
    const inv = parseInvoiceText({ text }, 'ocr');
    expect(inv.lines.map((l) => [l.description, l.quantity, l.unitPrice, l.total])).toEqual([
      ['PATATA AGRIA SACO 25KG', 25, 0.89, 22.25],
      ['CEBOLLA DULCE MALLA', 10, 1.15, 11.5],
      ['TOMATE PERA CAT.I', 12.4, 1.85, 22.94],
    ]);
    expect(inv.lines[0].warnings).toContain('Importe ilegible: calculado a partir de la base imponible');
    expect(inv.lines[1].warnings?.some((w) => w.includes('"4,45" → 1,15'))).toBe(true);
    expect(inv.warnings.filter((w) => /validar|cuadra/.test(w))).toEqual([]);
  });

  it('"casi cuadra" en OCR es una cifra mal leída (33,55 → 33,50)', () => {
    const text = [...header, '2001   SOLOMILLO TERNERA NAC.          4,620   KG    33,55    154,77', 'Base imponible   154,77', 'IVA 10%   15,48', 'TOTAL   170,25'].join('\n');
    const inv = parseInvoiceText({ text }, 'ocr');
    expect(inv.lines[0]).toMatchObject({ quantity: 4.62, unitPrice: 33.5, total: 154.77 });
  });

  it('letras por cifras y decimales perdidos ("1O,OOO", "7116")', () => {
    const text = [...header, '2210   MEJILLÓN GALLEGO MALLA 2KG    1O,OOO   KG     2,35     23,5O', '3001   PULPO COCIDO PATA              2,38O    KG    29,9O     7116'].join('\n');
    const inv = parseInvoiceText({ text }, 'ocr');
    expect(inv.lines.map((l) => [l.quantity, l.unitPrice, l.total])).toEqual([
      [10, 2.35, 23.5],
      [2.38, 29.9, 71.16],
    ]);
  });

  it('en PDF con texto no se "corrigen" cifras (no hay errores de lectura que reparar)', () => {
    const text = [...header, '1044   CEBOLLA DULCE MALLA            10,000   KG     1,45     11,50'].join('\n');
    const inv = parseInvoiceText({ text }, 'pdf-texto');
    expect(inv.lines[0].unitPrice).toBe(1.45);
    expect(inv.lines[0].confidence).toBeLessThan(0.8);
  });
});

describe('combinación de lecturas (varias pasadas de OCR)', () => {
  const base = [
    'Carnes Selectas S.L.   CIF B78456123   Nº Factura: C-1   Fecha: 19/09/2026',
    'Descripción                        Cantidad   Ud.   Precio    Importe',
  ];
  const foot = ['Base imponible   211,89', 'IVA 10%   21,19', 'TOTAL   233,08'];
  const readA = parseInvoiceReading(
    { text: [...base, 'SOLOMILLO TERNERA NAC.   4,602   KG   33,50   154,17', 'SECRETO IBERICO CEBO     3,400   KG   16,80    57,12', ...foot].join('\n') },
    'ocr',
  );
  const readB = parseInvoiceReading(
    { text: [...base, 'SOLOMILLO TERNERA NAC.   4,620   KG   33,50   154,77', 'SECRETO IBERICO CEBO     3,400   KG   16,80    5?,12', ...foot].join('\n') },
    'ocr',
  );

  it('cada línea cuadra por separado pero la suma no: usa la lectura alternativa que hace cuadrar la base', () => {
    expect(sumMatches(readA.invoice.lines.reduce((s, l) => s + l.total, 0), 211.89)).toBe(false);
    const merged = mergeInvoiceReadings([readA, readB]).invoice;
    expect(merged.lines.map((l) => [l.quantity, l.total])).toEqual([
      [4.62, 154.77],
      [3.4, 57.12],
    ]);
    expect(merged.warnings.filter((w) => /cuadra|difiere/.test(w))).toEqual([]);
  });

  it('invoiceQuality premia las lecturas que cuadran', () => {
    const merged = mergeInvoiceReadings([readA, readB]).invoice;
    expect(invoiceQuality(merged)).toBeGreaterThan(invoiceQuality(readA.invoice));
  });
});
