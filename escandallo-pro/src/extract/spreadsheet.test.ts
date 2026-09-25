import { describe, expect, it } from 'vitest';
import type { ExtractedInvoice } from '../types';
import { decodeText, detectDelimiter, excelCellValue, guessColumnMapping, parseCsv, readSpreadsheet, sheetToInvoices, type Cell, type ColumnMapping } from './spreadsheet';

// ───────────────────────────── Fixtures ─────────────────────────────

const rawSheets = import.meta.glob('../../tests/fixtures/sheets/*.csv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
/** CSV guardado por Excel en español: Windows-1252 (la "í" es el byte 0xED, no UTF-8). */
function windows1252(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    if (code > 0xff) throw new Error(`Carácter fuera de Windows-1252: ${ch}`);
    return code;
  });
}
const expectedSheets = import.meta.glob('../../tests/fixtures/sheets/*.expected.json', { import: 'default', eager: true }) as Record<
  string,
  { headerRow: number; mapping: ColumnMapping; invoices: (Partial<ExtractedInvoice> & { lines: Record<string, unknown>[] })[] }
>;
const sheet = (name: string) => rawSheets[`../../tests/fixtures/sheets/${name}`];

type ExcelModule = typeof import('exceljs');
async function loadExcel(): Promise<ExcelModule> {
  const mod = (await import('exceljs')) as ExcelModule & { default?: ExcelModule };
  return mod.default ?? mod;
}

function pick<T extends object>(o: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if ((o as Record<string, unknown>)[k] !== undefined) out[k] = (o as Record<string, unknown>)[k];
  return out;
}

// ───────────────────────────── CSV ─────────────────────────────

describe('parseCsv', () => {
  it('punto y coma con coma decimal (Excel en español): los números quedan como texto', () => {
    expect(parseCsv('Descripción;Cantidad;Precio\nTomate pera;12,5;1,20\n')).toEqual([
      ['Descripción', 'Cantidad', 'Precio'],
      ['Tomate pera', '12,5', '1,20'],
    ]);
  });

  it('comas con comillas, comillas escapadas y saltos de línea dentro de comillas', () => {
    const csv = 'Producto,Precio\r\n"Limón ""Verna"", caja",18.90\r\n"Queso\nmanchego",12.00\r\n';
    expect(parseCsv(csv)).toEqual([
      ['Producto', 'Precio'],
      ['Limón "Verna", caja', '18.90'],
      ['Queso\nmanchego', '12.00'],
    ]);
  });

  it('tabulador, barra vertical, BOM, línea "sep=" de Excel y celdas vacías', () => {
    expect(parseCsv('﻿a\tb\tc\n1\t\t3')).toEqual([
      ['a', 'b', 'c'],
      ['1', null, '3'],
    ]);
    expect(parseCsv('a|b|c\nx|y|z')).toEqual([
      ['a', 'b', 'c'],
      ['x', 'y', 'z'],
    ]);
    expect(parseCsv('sep=,\nPrecio;unidad,1;5\n')).toEqual([['Precio;unidad', '1;5']]);
    expect(parseCsv('a;b\n\n\n')).toEqual([['a', 'b']]);
  });

  it('detecta el separador aunque haya comas decimales dentro de los campos', () => {
    expect(detectDelimiter('Tomate;2,5;1,20\nCebolla;3;0,90\nAjo;1,2;4,10')).toBe(';');
    expect(detectDelimiter('Tomate,2.5,1.20\nCebolla,3,0.90')).toBe(',');
    expect(detectDelimiter('a\tb\tc\nd\te\tf')).toBe('\t');
  });

  it('decodifica UTF-8, UTF-16 con BOM y Windows-1252 (CSV guardado con Excel en español)', () => {
    expect(decodeText(new TextEncoder().encode('Descripción'))).toBe('Descripción');
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xf1, 0x00]))).toBe('Añ');
    expect(decodeText(new Uint8Array([0x41, 0x72, 0x74, 0xed, 0x63, 0x75, 0x6c, 0x6f]))).toBe('Artículo');
  });
});

// ───────────────────────────── Lectura de archivos ─────────────────────────────

describe('readSpreadsheet', () => {
  it('CSV en Windows-1252 como una sola hoja', async () => {
    const sheets = await readSpreadsheet(new Blob([windows1252('Artículo;Kilos\nPATATA;25\n')]), 'frutas.csv');
    expect(sheets).toEqual([{ name: 'frutas', rows: [['Artículo', 'Kilos'], ['PATATA', '25']] }]);
  });

  it('TSV por extensión', async () => {
    const sheets = await readSpreadsheet(new Blob(['a,b\tc\n1,5\t2']), 'lista.tsv');
    expect(sheets[0].rows).toEqual([
      ['a,b', 'c'],
      ['1,5', '2'],
    ]);
  });

  it('Excel .xlsx generado con exceljs: texto enriquecido, fórmulas, fechas, hipervínculos y varias hojas', async () => {
    const ExcelJS = await loadExcel();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Compras marzo');
    ws.addRow(['Fecha', 'Proveedor', 'Descripción', 'Cantidad', 'Precio', 'Importe']);
    ws.addRow([new Date(Date.UTC(2025, 2, 14)), 'Frutas García', { richText: [{ text: 'TOMATE ' }, { text: 'PERA', font: { bold: true } }] }, 12.5, 1.2, { formula: 'D2*E2', result: 15 }]);
    ws.addRow([null, null, { text: 'CEBOLLA MALLA 5KG', hyperlink: 'https://proveedor.example/cebolla' }, 2, 4.5, { formula: 'D3*E3', result: 9 }]);
    ws.addRow([null, null, '  AJO MORADO  ', 3, 0.1 + 0.2, { formula: 'D4*E4', result: { error: '#VALUE!' } }]);
    wb.addWorksheet('Vacía');
    const otra = wb.addWorksheet('Tarifa');
    otra.addRow(['Producto', 'PVP']);
    otra.addRow(['Nata 35% 1L', 3.85]);
    const buffer = await wb.xlsx.writeBuffer();
    const sheets = await readSpreadsheet(new Blob([buffer]), 'compras.xlsx');
    expect(sheets.map((s) => s.name)).toEqual(['Compras marzo', 'Vacía', 'Tarifa']);
    expect(sheets[0].rows).toEqual([
      ['Fecha', 'Proveedor', 'Descripción', 'Cantidad', 'Precio', 'Importe'],
      ['2025-03-14', 'Frutas García', 'TOMATE PERA', 12.5, 1.2, 15],
      [null, null, 'CEBOLLA MALLA 5KG', 2, 4.5, 9],
      [null, null, 'AJO MORADO', 3, 0.3],
    ]);
    expect(sheets[1].rows).toEqual([]);
    expect(sheets[2].rows).toEqual([
      ['Producto', 'PVP'],
      ['Nata 35% 1L', 3.85],
    ]);
  });

  it('formatos no compatibles con un mensaje claro', async () => {
    await expect(readSpreadsheet(new Blob([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])]), 'viejo.xls')).rejects.toThrow(/\.xls.*\.xlsx o \.csv/);
    await expect(readSpreadsheet(new Blob(['x']), 'hoja.ods')).rejects.toThrow(/\.xlsx o \.csv/);
    await expect(readSpreadsheet(new Blob(['no soy un zip']), 'roto.xlsx')).rejects.toThrow(/Excel válido/);
  });

  it('valores de celda de exceljs', () => {
    expect(excelCellValue(null)).toBeNull();
    expect(excelCellValue('  ')).toBeNull();
    expect(excelCellValue(true)).toBe('Sí');
    expect(excelCellValue({ sharedFormula: 'A1', result: 'x' })).toBe('x');
    expect(excelCellValue({ formula: 'A1' })).toBeNull();
    expect(excelCellValue({ text: { richText: [{ text: 'a' }, { text: 'b' }] }, hyperlink: 'h' })).toBe('ab');
    expect(excelCellValue(new Date(Number.NaN))).toBeNull();
  });
});

// ───────────────────────────── Columnas ─────────────────────────────

describe('guessColumnMapping', () => {
  it('cabecera española completa (con filas de título delante)', () => {
    const rows = parseCsv(sheet('compras-erp-varias-facturas.csv'));
    const exp = expectedSheets['../../tests/fixtures/sheets/compras-erp-varias-facturas.expected.json'];
    const g = guessColumnMapping(rows);
    expect(g.headerRow).toBe(exp.headerRow);
    expect(g.mapping).toEqual(exp.mapping);
    expect(g.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it.each<[string, string, Partial<ColumnMapping>]>([
    ['sinónimos: Artículo / Kilos / Tarifa / Dto. / Neto / % IVA', 'Artículo;Kilos;Tarifa;Dto.;Neto;% IVA\nPATATA;25;0,62;5;14,73;4\nAJO;3;4,10;10;11,07;4', { description: 0, quantity: 1, unitPrice: 2, discount: 3, total: 4, vat: 5 }],
    ['inglés: Item code / Description / Qty / Unit price / Amount', 'Item code,Description,Qty,Unit price,Amount\nA-1,Tomato,2,1.50,3.00\nA-2,Onion,4,0.80,3.20', { code: 0, description: 1, quantity: 2, unitPrice: 3, total: 4 }],
    ['PVP de venta no es el precio de compra', 'Producto;PVP venta;Precio coste;Uds\nCerveza;2,50;0,62;24\nAgua;1,80;0,21;12', { description: 0, unitPrice: 2, quantity: 3 }],
    ['"Ud." con números es la cantidad; "Formato" es la unidad', 'Denominación;Ud.;Formato;P.Unit;Total\nLeche entera;6;brik 1L;0,99;5,94\nNata;2;brik 1L;3,85;7,70', { description: 0, quantity: 1, unit: 2, unitPrice: 3, total: 4 }],
    ['Cód. artículo es código, no descripción', 'Cód. artículo;Descripción artículo;Cant.;Precio;Importe\n001;Harina;2;17,40;34,80\n002;Sal;5;0,40;2,00', { code: 0, description: 1, quantity: 2, unitPrice: 3, total: 4 }],
    ['nº de factura, fecha y proveedor', 'Nº Factura;Fecha factura;Acreedor;Concepto;Importe\nF-1;03/03/2025;Makro;Aceite;38,75\nF-2;04/03/2025;Makro;Harina;17,40', { invoiceNumber: 0, date: 1, supplier: 2, description: 3, total: 4 }],
  ])('%s', (_label, csv, expected) => {
    const g = guessColumnMapping(parseCsv(csv));
    expect(g.headerRow).toBe(0);
    expect(g.mapping).toMatchObject(expected);
  });

  it('sin cabecera: deduce columnas por el tipo de dato y la aritmética cantidad × precio = importe', () => {
    const rows = parseCsv('TOMATE PERA;kg;12,5;1,20;15,00\nCEBOLLA DULCE;kg;10;0,85;8,50\nLIMÓN;caja;2;18,90;37,80\nPEREJIL MANOJO;ud;6;0,60;3,60');
    const g = guessColumnMapping(rows);
    expect(g.headerRow).toBe(-1);
    expect(g.mapping).toEqual({ description: 0, unit: 1, quantity: 2, unitPrice: 3, total: 4 });
    expect(g.confidence).toBeGreaterThanOrEqual(0.4);
  });

  it('sin cabecera y con descuento: la aritmética encuentra la columna de descuento', () => {
    const rows = parseCsv('PATATA;25;0,62;5;14,73\nAJO;3;4,10;10;11,07\nPIMIENTO;6,4;2,35;0;15,04');
    expect(guessColumnMapping(rows).mapping).toMatchObject({ description: 0, quantity: 1, unitPrice: 2, discount: 3, total: 4 });
  });

  it('tarifa sin cabecera ni importes: descripción, unidad y precio', () => {
    const g = guessColumnMapping(parseCsv(sheet('tarifa-proveedor-sin-cabecera.csv')));
    expect(g.headerRow).toBe(-1);
    expect(g.mapping).toEqual({ description: 0, unit: 1, unitPrice: 2 });
  });

  it('hoja vacía', () => {
    expect(guessColumnMapping([])).toEqual({ headerRow: -1, mapping: { description: 0 }, confidence: 0 });
  });
});

// ───────────────────────────── Filas → facturas ─────────────────────────────

describe('sheetToInvoices', () => {
  it('listado de un ERP con varias facturas: agrupa por proveedor, número y fecha (heredando celdas vacías)', () => {
    const rows = parseCsv(sheet('compras-erp-varias-facturas.csv'));
    const exp = expectedSheets['../../tests/fixtures/sheets/compras-erp-varias-facturas.expected.json'];
    const g = guessColumnMapping(rows);
    const invoices = sheetToInvoices(rows, g.mapping, g.headerRow);
    expect(invoices).toHaveLength(exp.invoices.length);
    invoices.forEach((inv, i) => {
      const e = exp.invoices[i];
      expect(pick(inv, ['supplierName', 'number', 'date', 'subtotal'])).toEqual(pick(e, ['supplierName', 'number', 'date', 'subtotal']));
      expect(inv.method).toBe('hoja');
      expect(inv.lines.map((l) => pick(l, ['description', 'code', 'quantity', 'unit', 'unitPrice', 'total', 'pricePerBase']))).toEqual(e.lines);
      for (const l of inv.lines) {
        expect(l.confidence).toBe(1);
        expect(l.suggestedName).toBeTruthy();
        expect(l.warnings).toEqual([]);
      }
    });
    expect(invoices[1].lines[0].suggestedName).toBe('Solomillo de ternera');
  });

  it('CSV en Windows-1252 con descuento e IVA: calcula base, cuota y total; unidad kg por la cabecera "Kilos"', async () => {
    const bytes = windows1252('Artículo;Kilos;Tarifa;Dto.;Neto;% IVA\nPATATA AGRIA SACO 25KG;25;0,62;5;14,73;4\nPIMIENTO ROJO LAMUYO;6,4;2,35;0;15,04;4\nAJO MORADO MALLA 1KG;3;4,10;10;11,07;4\n');
    expect(bytes[3]).toBe(0xed);
    const [s] = await readSpreadsheet(new Blob([bytes]), 'frutas-windows-1252.csv');
    expect(s.rows[0][0]).toBe('Artículo');
    const g = guessColumnMapping(s.rows);
    const [inv] = sheetToInvoices(s.rows, g.mapping, g.headerRow, { supplierName: 'Frutas García', date: '2025-03-10' });
    expect(pick(inv, ['supplierName', 'date', 'subtotal', 'vatTotal', 'total'])).toEqual({ supplierName: 'Frutas García', date: '2025-03-10', subtotal: 40.84, vatTotal: 1.63, total: 42.47 });
    expect(inv.lines.map((l) => [l.unit, l.quantity, l.discountPct, l.vatPct, l.total])).toEqual([
      ['kg', 25, 5, 4, 14.73],
      ['kg', 6.4, undefined, 4, 15.04],
      ['kg', 3, 10, 4, 11.07],
    ]);
    expect(inv.lines[0].pricePerBase).toBeCloseTo(0.589, 6); // 0,62 × (1 − 5 %): precio neto exacto, no 14,73 ÷ 25
    expect(inv.lines.every((l) => l.confidence === 1)).toBe(true);
  });

  it('tarifa sin cantidades: cantidad 1, importe = precio y precio por unidad base desde el formato', () => {
    const rows = parseCsv(sheet('tarifa-proveedor-sin-cabecera.csv'));
    const g = guessColumnMapping(rows);
    const [inv] = sheetToInvoices(rows, g.mapping, g.headerRow, { supplierName: 'Makro' });
    expect(inv.supplierName).toBe('Makro');
    expect(inv.lines).toHaveLength(6);
    const aceite = inv.lines[0];
    expect(pick(aceite, ['quantity', 'unit', 'unitPrice', 'total', 'baseUnit'])).toEqual({ quantity: 1, unit: 'ud', unitPrice: 38.75, total: 38.75, baseUnit: 'l' });
    expect(aceite.pricePerBase).toBeCloseTo(7.75, 6);
    expect(inv.lines[2].pricePerBase).toBeCloseTo(0.99, 6);
    expect(inv.lines[1].pricePerBase).toBeCloseTo(0.696, 6);
    expect(inv.warnings.join(' ')).toContain('6 líneas no traían');
  });

  it('completa el importe, el precio o la cantidad que falten', () => {
    const rows: Cell[][] = [
      ['Descripción', 'Cantidad', 'Precio', 'Importe'],
      ['Tomate', '10', '1,50', null],
      ['Cebolla', '4', null, '3,60'],
      ['Ajo', null, '4,00', '12,00'],
      ['Perejil', null, null, '2,40'],
      ['Sin precio', '3', null, null],
      ['Total', null, null, '30,00'],
      [null, null, null, null],
    ];
    const g = guessColumnMapping(rows);
    const [inv] = sheetToInvoices(rows, g.mapping, g.headerRow);
    expect(inv.lines.map((l) => [l.description, l.quantity, l.unitPrice, l.total, l.confidence])).toEqual([
      ['Tomate', 10, 1.5, 15, 0.9],
      ['Cebolla', 4, 0.9, 3.6, 0.9],
      ['Ajo', 3, 4, 12, 0.9],
      ['Perejil', 1, 2.4, 2.4, 0.9],
    ]);
    expect(inv.subtotal).toBe(33);
    expect(inv.warnings.join(' ')).toContain('Se ha omitido 1 fila sin precio ni importe');
  });

  it('descuento e IVA como fracción (celdas con formato % en Excel), fechas como número de serie y decimales anglosajones', () => {
    const rows: Cell[][] = [
      ['Date', 'Supplier', 'Description', 'Qty', 'Unit price', 'Discount', 'VAT', 'Amount'],
      [45730, 'Makro', 'Olive oil 5L', 2, 38.75, 0.1, 0.1, 69.75],
      [45730, 'Makro', 'Flour 25 kg', '1', '1,234.50', '0', '0.1', '1,234.50'],
      ['2025-03-15', 'Makro', 'Salt 1 kg', '10', '0.40', '0', '0.21', '4.00'],
    ];
    const g = guessColumnMapping(rows);
    expect(g.mapping).toMatchObject({ date: 0, supplier: 1, description: 2, quantity: 3, unitPrice: 4, discount: 5, vat: 6, total: 7 });
    const invoices = sheetToInvoices(rows, g.mapping, g.headerRow);
    expect(invoices.map((i) => [i.supplierName, i.date, i.lines.length])).toEqual([
      ['Makro', '2025-03-14', 2],
      ['Makro', '2025-03-15', 1],
    ]);
    expect(invoices[0].lines[0]).toMatchObject({ discountPct: 10, vatPct: 10, total: 69.75, confidence: 1 });
    expect(invoices[0].lines[1]).toMatchObject({ unitPrice: 1234.5, total: 1234.5 });
    expect(invoices[1].lines[0]).toMatchObject({ vatPct: 21, total: 4 });
  });

  it('sin filas con precio devuelve una lista vacía', () => {
    expect(sheetToInvoices([['Descripción'], ['Tomate']], { description: 0 }, 0)).toEqual([]);
  });

  it('sin columnas de agrupación: una sola factura con los valores por defecto', () => {
    const rows = parseCsv('Producto;Precio\nTomate;1,20\nCebolla;0,90');
    const invoices = sheetToInvoices(rows, { description: 0, unitPrice: 1 }, 0, { supplierName: 'Frutas García', date: '2025-03-01' });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ supplierName: 'Frutas García', date: '2025-03-01', subtotal: 2.1, method: 'hoja' });
  });
});
