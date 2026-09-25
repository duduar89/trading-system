import type { ExtractedInvoice } from '../types';
import { approxEqual, parseDateEs, parseNumberEs, round, type NumberParseOptions } from '../core/numbers';
import { normalizeInvoiceLine } from '../core/pack';
import { cleanProductName } from '../core/matching';
import { fold } from './textUtils';

/**
 * Importación de listados de facturas / tarifas en Excel (.xlsx) o CSV (usa exceljs con import dinámico; CSV propio con
 * detección de separador ; , \t y comillas).
 */

export type Cell = string | number | null;

export interface SheetData {
  name: string;
  rows: Cell[][];
}

// ───────────────────────────── Lectura de archivos ─────────────────────────────

/** Decodifica texto respetando el BOM (UTF-8 / UTF-16); sin BOM prueba UTF-8 y, si no es válido, Windows-1252 (Excel ES). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const DELIMITERS = [';', ',', '\t', '|'] as const;

/** Divide una línea respetando comillas (sólo para detectar el separador). */
function countFields(line: string, delim: string): number {
  let n = 1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === delim && !quoted) n++;
  }
  return n;
}

/**
 * Detecta el separador de un CSV entre ; , tabulador y | : el que da un número de columnas mayor que 1 y más
 * constante en las primeras líneas (fuera de comillas). En empate gana el punto y coma (Excel en español).
 */
export function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim())
    .slice(0, 30);
  if (!lines.length) return ';';
  let best: { delim: string; score: number } = { delim: ';', score: -1 };
  for (const delim of DELIMITERS) {
    const counts = lines.map((l) => countFields(l, delim));
    const freq = new Map<number, number>();
    for (const c of counts) if (c > 1) freq.set(c, (freq.get(c) ?? 0) + 1);
    if (!freq.size) continue;
    const [mode, times] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    // Constancia (líneas con la columna modal) y, a igualdad, más columnas
    const score = (times / lines.length) * 100 + Math.min(mode, 30) * 0.5;
    if (score > best.score + 1e-9) best = { delim, score };
  }
  return best.delim;
}

/**
 * CSV / TSV propio: separador automático (o el indicado, o la línea "sep=;" de Excel), comillas con comillas escapadas
 * (""), saltos de línea dentro de comillas y BOM. Las celdas se devuelven como texto (los números con coma decimal se
 * interpretan después con parseNumberEs); las vacías como null. Se quitan las filas vacías del final.
 */
export function parseCsv(input: string, delimiter?: string): Cell[][] {
  let text = input.replace(/^﻿/, '');
  const sep = /^sep=(.)\s*(?:\r\n|\n|\r)/i.exec(text);
  let delim = delimiter;
  if (sep) {
    delim = delim ?? sep[1];
    text = text.slice(sep[0].length);
  }
  delim = delim ?? detectDelimiter(text);
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  const pushField = () => {
    const v = wasQuoted ? field : field.trim();
    row.push(v === '' ? null : v);
    field = '';
    wasQuoted = false;
  };
  const pushRow = () => {
    pushField();
    while (row.length && row[row.length - 1] === null) row.pop();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      quoted = true;
      wasQuoted = true;
      field = '';
    } else if (ch === delim) pushField();
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else field += ch;
  }
  if (field !== '' || row.length || wasQuoted) pushRow();
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

type ExcelModule = typeof import('exceljs');

async function loadExcel(): Promise<ExcelModule> {
  const mod = (await import('exceljs')) as ExcelModule & { default?: ExcelModule };
  return mod.default ?? mod;
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Valor de una celda de exceljs → texto / número / null (texto enriquecido, fórmulas con su resultado, fechas ISO…). */
export function excelCellValue(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? round(value, 10) : null;
  if (typeof value === 'string') {
    const t = value.replace(/ /g, ' ').trim();
    return t === '' ? null : t;
  }
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : isoDate(value);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (Array.isArray(o.richText)) return excelCellValue((o.richText as { text?: string }[]).map((r) => r.text ?? '').join(''));
    if ('formula' in o || 'sharedFormula' in o) return excelCellValue(o.result);
    if ('error' in o) return null;
    if ('text' in o) return excelCellValue(o.text);
    if ('result' in o) return excelCellValue(o.result);
  }
  return null;
}

async function readXlsx(buffer: ArrayBuffer): Promise<SheetData[]> {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets: SheetData[] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    const last = ws.actualRowCount ? ws.rowCount : 0;
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r);
      const cells: Cell[] = [];
      const width = Math.max(row.cellCount, 0);
      for (let c = 1; c <= width; c++) cells.push(excelCellValue(row.getCell(c).value));
      while (cells.length && cells[cells.length - 1] === null) cells.pop();
      rows.push(cells);
    }
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

/**
 * Lee un Excel (.xlsx, .xlsm) o un CSV/TSV/TXT y devuelve sus hojas (el CSV como una sola hoja).
 * Los .xls (Excel 97-2003) y .ods no se pueden leer en el navegador: se pide guardarlos como .xlsx o .csv.
 */
export async function readSpreadsheet(file: Blob, fileName: string): Promise<SheetData[]> {
  const name = (fileName || '').toLowerCase();
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isOle = bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isOle || /\.xls$/.test(name)) throw new Error('Formato .xls (Excel 97-2003) no compatible: ábrelo en Excel y guárdalo como .xlsx o .csv');
  if (/\.(ods|numbers)$/.test(name)) throw new Error('Formato no compatible: expórtalo desde tu hoja de cálculo como .xlsx o .csv');
  if (isZip || /\.(xlsx|xlsm)$/.test(name)) {
    if (!isZip) throw new Error('El archivo no parece un Excel válido (.xlsx): vuelve a exportarlo');
    try {
      return await readXlsx(buffer);
    } catch (e) {
      throw new Error(`No se ha podido leer el Excel: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const text = decodeText(bytes);
  const delim = /\.tsv$/.test(name) ? '\t' : undefined;
  return [{ name: fileName.replace(/\.[^.]+$/, '') || 'Hoja 1', rows: parseCsv(text, delim) }];
}

// ───────────────────────────── Columnas ─────────────────────────────

export interface ColumnMapping {
  description: number;
  quantity?: number;
  unit?: number;
  unitPrice?: number;
  total?: number;
  discount?: number;
  vat?: number;
  code?: number;
  date?: number;
  supplier?: number;
  invoiceNumber?: number;
}

type Field = keyof ColumnMapping;

/** Cabecera normalizada: minúsculas, sin tildes, "nº" → "n", signos → espacio. */
function headerKey(c: Cell): string {
  if (c == null || typeof c === 'number') return '';
  return fold(String(c))
    .replace(/(^|[\s(])n\s*\.?\s*[º°]\s*\.?/g, '$1n ')
    .replace(/(^|[\s(])no\.?\s+(?=[a-z])/g, '$1n ')
    .replace(/[€]/g, ' eur ')
    .replace(/[^a-z0-9%/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reglas de cabecera: exactas (10) y por palabra contenida (7); algunas penalizan (importe con IVA, precio de venta…). */
const HEADER_RULES: { field: Field; exact?: RegExp; contains?: RegExp; not?: RegExp }[] = [
  {
    field: 'code',
    exact: /^(cod|codigo|cod articulo|codigo articulo|cod art|cod producto|codigo producto|ref|refer|referencia|ref articulo|ean|ean ?13|sku|plu|code|id|id articulo|item code)$/,
    contains: /\b(cod|codigo|ref|referencia|ean|sku|plu)\b/,
  },
  {
    field: 'description',
    exact: /^(descripcion|descripciones|descrip|desc|descripcion articulo|descripcion del articulo|descripcion producto|articulo|articulos|producto|productos|nombre|nombre producto|nombre del producto|concepto|denominacion|designacion|detalle|material|item|product|description|name)$/,
    contains: /\b(descripcion|producto|concepto|denominacion|articulo|description|product|nombre)\b/,
  },
  {
    field: 'quantity',
    exact: /^(cantidad|cant|ctd|cdad|cant facturada|uds|unds|unidades|unid|n uds|num uds|kilos|kg|kgs|peso|peso neto|qty|quantity|bultos|cajas|piezas|litros)$/,
    contains: /\b(cantidad|kilos|unidades|peso|qty|quantity)\b/,
  },
  {
    field: 'unit',
    exact: /^(unidad|ud|u m|um|u\/m|umedida|unidad de medida|unidad medida|ud medida|medida|formato|unit|uom|envase|presentacion|tipo unidad)$/,
    contains: /\b(unidad de medida|medida|formato|presentacion)\b/,
  },
  {
    field: 'unitPrice',
    exact: /^(precio|precios|pvp|pvp tarifa|p unit|p unitario|pu|p u|p\/u|precio unitario|precio unidad|precio ud|precio \/ ud|precio neto|precio coste|precio de coste|precio compra|precio de compra|precio sin iva|precio tarifa|coste|coste unitario|costo|tarifa|price|unit price|cost|importe unitario|eur ?\/ ?ud|eur ?\/ ?kg|eur ?\/ ?u|eur)$/,
    contains: /\b(precio|tarifa|coste|costo|price|pvp|unitario)\b/,
    not: /\b(venta|con iva|iva incl|total)\b/,
  },
  {
    field: 'total',
    exact: /^(importe|importes|importe neto|importe total|importe linea|importe sin iva|total|total linea|total neto|total sin iva|neto|subtotal|base|base imponible|amount|line total|valor)$/,
    contains: /\b(importe|total|neto|subtotal|amount)\b/,
    not: /\b(con iva|iva incl|factura|cuota)\b/,
  },
  { field: 'discount', exact: /^(dto|dto %|% dto|dtos|dto1|dcto|descuento|descuentos|desc %|% desc|bonificacion|rappel|discount)$/, contains: /\b(dto|dcto|descuento|discount)\b/ },
  { field: 'vat', exact: /^(iva|% iva|iva %|tipo iva|tipo de iva|tipo impositivo|impuesto|vat|tax|igic)$/, contains: /\b(iva|vat|igic)\b/, not: /\b(cuota|importe|total|incl)\b/ },
  {
    field: 'date',
    exact: /^(fecha|fecha factura|f factura|fecha fra|fecha doc|fecha documento|fecha albaran|fecha emision|fecha de factura|date|invoice date)$/,
    contains: /\b(fecha|date)\b/,
    not: /\b(venc|vto|vencimiento|pago|entrega|caducidad)\b/,
  },
  {
    field: 'supplier',
    exact: /^(proveedor|proveedores|acreedor|suministrador|emisor|supplier|vendor|razon social|nombre proveedor)$/,
    contains: /\b(proveedor|acreedor|supplier|vendor)\b/,
  },
  {
    field: 'invoiceNumber',
    exact: /^(n factura|num factura|numero factura|numero de factura|n de factura|factura|n fra|num fra|fra|documento|n documento|num documento|doc|n doc|albaran|n albaran|invoice|invoice number|invoice no|serie numero|num|numero|n)$/,
    contains: /\b(factura|fra|documento|albaran|invoice)\b/,
    not: /\b(fecha|total|importe)\b/,
  },
];

function headerScores(c: Cell): { field: Field; score: number }[] {
  const k = headerKey(c);
  if (!k || k.length > 40) return [];
  const out: { field: Field; score: number }[] = [];
  for (const r of HEADER_RULES) {
    if (r.exact?.test(k)) out.push({ field: r.field, score: 10 });
    else if (r.contains?.test(k) && !r.not?.test(k)) out.push({ field: r.field, score: 7 });
    else if (r.contains?.test(k)) out.push({ field: r.field, score: 3 });
  }
  return out;
}

function isNumericCell(c: Cell, opts?: NumberParseOptions): boolean {
  if (typeof c === 'number') return Number.isFinite(c);
  if (c == null) return false;
  const s = String(c).trim();
  if (!s || /[a-df-z]/i.test(s.replace(/eur(os)?|€/gi, ''))) return false;
  return parseNumberEs(s, opts) !== undefined;
}

function toNumber(c: Cell | undefined, opts?: NumberParseOptions): number | undefined {
  if (c == null || c === '') return undefined;
  if (typeof c === 'number') return Number.isFinite(c) ? c : undefined;
  return parseNumberEs(String(c), opts);
}

function cellText(c: Cell | undefined): string {
  if (c == null) return '';
  return (typeof c === 'number' ? String(c) : c).replace(/\s+/g, ' ').trim();
}

function letters(s: string): number {
  return s.replace(/[^\p{L}]/gu, '').length;
}

const UNIT_WORDS = /^(kg|kgs|k|g|gr|grs|l|lt|lts|litro|litros|ml|cl|ud|uds|u|un|und|unid|unidad|unidades|caja|cajas|cj|pack|paquete|paq|bot|botella|botellas|lata|latas|bandeja|bandejas|bolsa|saco|malla|docena|dz|pieza|pz|kilo|kilos|garrafa|brik|tarro|bote|manojo|fardo|barra|barqueta|estuche|cubo|bidon)\.?$/i;
const VAT_RATES = new Set([0, 2, 4, 5, 7, 10, 21, 3, 9.5, 13.5, 15]);
const TOTALS_ROW = /^(total|totales|subtotal|suma|sumas|base imponible|bases?|iva|cuota|importe total|total factura|total general|recargo)\b/i;

interface ColumnProfile {
  n: number;
  numeric: number;
  text: number;
  avgTextLen: number;
  dates: number;
  units: number;
  integers: number;
  distinct: number;
  vatLike: number;
  pctLike: number;
}

function profileColumns(rows: Cell[][], start: number, width: number, opts: NumberParseOptions): ColumnProfile[] {
  const profiles: ColumnProfile[] = [];
  const sample = rows.slice(start, start + 400).filter((r) => r.some((c) => c != null && c !== ''));
  for (let c = 0; c < width; c++) {
    const p: ColumnProfile = { n: 0, numeric: 0, text: 0, avgTextLen: 0, dates: 0, units: 0, integers: 0, distinct: 0, vatLike: 0, pctLike: 0 };
    const seen = new Set<string>();
    let textLen = 0;
    for (const r of sample) {
      const v = r[c];
      if (v == null || v === '') continue;
      p.n++;
      const t = cellText(v);
      seen.add(t);
      if (/^\d{4}-\d{2}-\d{2}$/.test(t) || (typeof v === 'string' && /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(t) && parseDateEs(t))) {
        p.dates++;
        continue;
      }
      if (isNumericCell(v, opts)) {
        p.numeric++;
        const num = toNumber(v, opts) ?? NaN;
        if (Number.isInteger(num)) p.integers++;
        if (VAT_RATES.has(num)) p.vatLike++;
        if (num >= 0 && num <= 100) p.pctLike++;
        continue;
      }
      if (UNIT_WORDS.test(t)) p.units++;
      if (letters(t) >= 2) {
        p.text++;
        textLen += t.length;
      }
    }
    p.avgTextLen = p.text ? textLen / p.text : 0;
    p.distinct = seen.size;
    profiles.push(p);
  }
  return profiles;
}

/** Estilo decimal del documento: '.' si hay números anglosajones ("1,234.56", "12.50" sin ninguna coma decimal). */
function decimalStyle(rows: Cell[][]): NumberParseOptions {
  let comma = 0;
  let dot = 0;
  for (const r of rows.slice(0, 400))
    for (const c of r) {
      if (typeof c !== 'string') continue;
      const s = c.trim();
      if (/^-?\d{1,3}(?:\.\d{3})*,\d+$/.test(s) || /^-?\d+,\d{1,2}(?:\s?€)?$/.test(s)) comma++;
      else if (/^-?\d{1,3}(?:,\d{3})+\.\d+$/.test(s) || /^-?\d+\.\d{1,2}(?:\s?€)?$/.test(s)) dot++;
    }
  return dot > comma * 2 && dot >= 3 ? { decimal: '.' } : {};
}

/**
 * Busca la relación cantidad × precio × (1 − dto) = importe entre columnas numéricas (respetando las ya asignadas).
 * Devuelve la mejor combinación y la proporción de filas que la cumplen.
 */
function findArithmetic(
  rows: Cell[][],
  start: number,
  numericCols: number[],
  fixed: Partial<Pick<ColumnMapping, 'quantity' | 'unitPrice' | 'total' | 'discount'>>,
  opts: NumberParseOptions,
): { quantity: number; unitPrice: number; total: number; discount?: number; ratio: number } | undefined {
  const data = rows.slice(start, start + 300).filter((r) => r.some((c) => c != null && c !== ''));
  if (!data.length) return undefined;
  const cand = (f: 'quantity' | 'unitPrice' | 'total' | 'discount') => (fixed[f] !== undefined ? [fixed[f] as number] : numericCols);
  // Valores numéricos interpretados una sola vez (la búsqueda recorre muchas combinaciones)
  const cols = new Set<number>([...numericCols, ...Object.values(fixed).filter((v): v is number => v !== undefined)]);
  const values = new Map<number, (number | undefined)[]>();
  for (const c of cols) values.set(c, data.map((r) => toNumber(r[c], opts)));
  let best: { quantity: number; unitPrice: number; total: number; discount?: number; ratio: number } | undefined;
  for (const q of cand('quantity'))
    for (const p of cand('unitPrice'))
      for (const t of cand('total')) {
        if (q === p || q === t || p === t) continue;
        const qs = values.get(q) ?? [];
        const ps = values.get(p) ?? [];
        const ts = values.get(t) ?? [];
        const discounts: (number | undefined)[] = [undefined, ...cand('discount').filter((d) => d !== q && d !== p && d !== t)];
        for (const d of discounts) {
          const ds = d !== undefined ? (values.get(d) ?? []) : undefined;
          let ok = 0;
          let n = 0;
          for (let i = 0; i < data.length; i++) {
            const qv = qs[i];
            const pv = ps[i];
            const tv = ts[i];
            if (qv === undefined || pv === undefined || tv === undefined) continue;
            n++;
            const dv = ds ? (ds[i] ?? 0) : 0;
            const dPct = dv > 0 && dv < 1 ? dv * 100 : dv;
            if (qv !== 0 && pv > 0 && approxEqual(qv * pv * (1 - dPct / 100), tv)) ok++;
          }
          if (n < 1) continue;
          const ratio = ok / n;
          // Preferir la combinación que explica más filas; a igualdad, sin descuento
          if (!best || ratio > best.ratio + 1e-9 || (Math.abs(ratio - best.ratio) < 1e-9 && d === undefined && best.discount !== undefined)) {
            best = { quantity: q, unitPrice: p, total: t, ...(d !== undefined ? { discount: d } : {}), ratio };
          }
        }
      }
  return best && best.ratio >= 0.5 ? best : undefined;
}

/** Detecta la fila de cabecera y a qué columna corresponde cada campo (por nombres ES/EN habituales y por tipo de datos). */
export function guessColumnMapping(rows: Cell[][]): { headerRow: number; mapping: ColumnMapping; confidence: number } {
  const width = rows.slice(0, 400).reduce((m, r) => Math.max(m, r.length), 0);
  if (!width) return { headerRow: -1, mapping: { description: 0 }, confidence: 0 };
  const opts = decimalStyle(rows);

  // 1) Fila de cabecera: la de más campos reconocidos (≥ 2) entre las 20 primeras, con celdas de texto
  let headerRow = -1;
  let bestFields = 1;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] ?? [];
    const textCells = row.filter((c) => typeof c === 'string' && letters(c) >= 2).length;
    const numericCells = row.filter((c) => isNumericCell(c)).length;
    if (textCells < 2 || numericCells > textCells) continue;
    const fields = new Set<Field>();
    for (const c of row) for (const s of headerScores(c)) if (s.score >= 7) fields.add(s.field);
    if (fields.size > bestFields) {
      bestFields = fields.size;
      headerRow = r;
    }
  }

  // 2) Asignación por cabecera: mejor puntuación primero, un campo por columna y una columna por campo. Antes se
  //    corrigen las cabeceras ambiguas con el contenido: "Ud." con números es la cantidad; "Cantidad" con kg, caja… es
  //    la unidad; una columna numérica no puede ser la descripción.
  const start = headerRow + 1;
  const prof = profileColumns(rows, start, width, opts);
  const numericRatio = (c: number) => (prof[c]?.n ? prof[c].numeric / prof[c].n : 0);
  const unitRatio = (c: number) => (prof[c]?.n ? prof[c].units / prof[c].n : 0);
  const mapping: Partial<ColumnMapping> = {};
  const used = new Set<number>();
  const byHeader = new Set<Field>();
  if (headerRow >= 0) {
    const cands: { col: number; field: Field; score: number }[] = [];
    (rows[headerRow] ?? []).forEach((c, col) => {
      for (const s of headerScores(c)) {
        if (s.score < 7) continue;
        let field = s.field;
        if (field === 'unit' && numericRatio(col) >= 0.8) field = 'quantity';
        else if (field === 'quantity' && unitRatio(col) >= 0.7) field = 'unit';
        if ((field === 'description' || field === 'supplier') && numericRatio(col) > 0.8) continue;
        cands.push({ col, field, score: field === s.field ? s.score : s.score - 1 });
      }
    });
    cands.sort((a, b) => b.score - a.score || a.col - b.col);
    for (const c of cands) {
      if (mapping[c.field] !== undefined || used.has(c.col)) continue;
      mapping[c.field] = c.col;
      used.add(c.col);
      byHeader.add(c.field);
    }
  }

  // 3) Tipos de datos: completa lo que falte
  const free = (c: number) => !Object.values(mapping).includes(c);
  /** Columna sin cabecera (o sin fila de cabecera): sólo ahí se deducen unidad, fecha, IVA o código por el contenido. */
  const unlabeled = (c: number) => headerRow < 0 || cellText(rows[headerRow]?.[c]) === '';
  const numericCols = prof.map((_, c) => c).filter((c) => prof[c].n > 0 && numericRatio(c) >= 0.8);

  // Cantidad × precio = importe
  const fixed: Partial<Pick<ColumnMapping, 'quantity' | 'unitPrice' | 'total' | 'discount'>> = {};
  for (const f of ['quantity', 'unitPrice', 'total', 'discount'] as const) if (mapping[f] !== undefined) fixed[f] = mapping[f];
  // Como mucho 8 columnas candidatas (las más rellenas): la búsqueda es cúbica en columnas
  const freeNumeric = numericCols
    .filter((c) => free(c) || Object.values(fixed).includes(c))
    .sort((a, b) => prof[b].numeric - prof[a].numeric || a - b)
    .slice(0, 8)
    .sort((a, b) => a - b);
  let arithmetic = false;
  const missingMath = fixed.quantity === undefined || fixed.unitPrice === undefined || fixed.total === undefined;
  const rel = findArithmetic(rows, start, freeNumeric, fixed, opts);
  if (rel) {
    arithmetic = rel.ratio >= 0.8;
    if (missingMath || rel.ratio >= 0.8) {
      mapping.quantity ??= rel.quantity;
      mapping.unitPrice ??= rel.unitPrice;
      mapping.total ??= rel.total;
      if (rel.discount !== undefined) mapping.discount ??= rel.discount;
    }
  }

  // Descripción: la columna de texto más larga y variada
  if (mapping.description === undefined) {
    let best = -1;
    let bestScore = 0;
    prof.forEach((p, c) => {
      if (!free(c) || !p.n) return;
      const textRatio = p.text / p.n;
      const score = textRatio >= 0.6 ? textRatio * p.avgTextLen * (p.distinct / p.n + 0.5) : 0;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    });
    mapping.description = best >= 0 ? best : 0;
  }
  // Unidad y fecha por el contenido
  if (mapping.unit === undefined) {
    const c = prof.findIndex((p, i) => free(i) && unlabeled(i) && p.n > 0 && p.units / p.n >= 0.7);
    if (c >= 0) mapping.unit = c;
  }
  if (mapping.date === undefined) {
    const c = prof.findIndex((p, i) => free(i) && unlabeled(i) && p.n > 0 && p.dates / p.n >= 0.8);
    if (c >= 0) mapping.date = c;
  }
  // IVA: columna numérica con tipos de IVA (4, 10, 21…)
  if (mapping.vat === undefined) {
    const c = numericCols.find((i) => {
      if (!free(i) || !unlabeled(i) || prof[i].vatLike / prof[i].n < 0.9) return false;
      const distinct = new Set(rows.slice(start, start + 200).map((r) => toNumber(r[i], opts)).filter((v) => v !== undefined));
      return distinct.size <= 4 && [4, 10, 21].some((v) => distinct.has(v));
    });
    if (c !== undefined) mapping.vat = c;
  }
  // Tarifa sin importes: un único número decimal libre → precio
  if (mapping.unitPrice === undefined && mapping.total === undefined) {
    const decimalsCols = numericCols.filter((c) => free(c) && prof[c].integers < prof[c].numeric);
    if (decimalsCols.length >= 1) mapping.unitPrice = decimalsCols[decimalsCols.length - 1];
    else {
      const any = numericCols.filter(free);
      if (any.length) mapping.unitPrice = any[any.length - 1];
    }
  }
  // Código: columna libre, a la izquierda de la descripción, casi todo distinto y sin decimales
  if (mapping.code === undefined) {
    const c = prof.findIndex((p, i) => {
      if (!free(i) || !unlabeled(i) || !p.n || i > (mapping.description ?? 0)) return false;
      const vals = rows.slice(start, start + 200).map((r) => cellText(r[i])).filter(Boolean);
      return p.distinct / p.n >= 0.9 && vals.every((v) => /^[A-Z0-9][A-Z0-9./-]{2,}$/i.test(v) && !/^\d+[.,]\d{1,2}$/.test(v));
    });
    if (c >= 0) mapping.code = c;
  }

  const result: ColumnMapping = { description: mapping.description ?? 0 };
  for (const f of ['quantity', 'unit', 'unitPrice', 'total', 'discount', 'vat', 'code', 'date', 'supplier', 'invoiceNumber'] as const) {
    if (mapping[f] !== undefined) result[f] = mapping[f];
  }

  // Confianza
  let confidence = headerRow >= 0 ? 0.55 : 0.35;
  if (byHeader.has('description')) confidence += 0.12;
  if (byHeader.has('unitPrice') || byHeader.has('total')) confidence += 0.12;
  if (arithmetic) confidence += 0.15;
  confidence += Math.min(0.1, 0.03 * Math.max(0, byHeader.size - 2));
  const descProf = prof[result.description];
  if (!descProf || !descProf.n || descProf.text / descProf.n < 0.5) confidence -= 0.25;
  if (result.unitPrice === undefined && result.total === undefined) confidence -= 0.3;
  return { headerRow, mapping: result, confidence: round(Math.max(0.05, Math.min(0.98, confidence)), 2) };
}

// ───────────────────────────── Filas → facturas ─────────────────────────────

/** Número de serie de Excel (días desde 1899-12-30) → YYYY-MM-DD. */
function excelSerialToIso(n: number): string | undefined {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return undefined;
  return isoDate(new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000));
}

function dateOf(c: Cell | undefined): string | undefined {
  if (c == null || c === '') return undefined;
  if (typeof c === 'number') return excelSerialToIso(c);
  const s = c.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const n = /^\d{5}(?:\.\d+)?$/.test(s) ? excelSerialToIso(Number(s)) : undefined;
  return n ?? parseDateEs(s);
}

function textOf(c: Cell | undefined): string | undefined {
  if (c == null) return undefined;
  const t = typeof c === 'number' ? String(c) : c.replace(/\s+/g, ' ').trim();
  return t || undefined;
}

/** Porcentaje de una celda: 21 → 21; 0,21 (celda con formato % en Excel) → 21. */
function pctOf(c: Cell | undefined, fractions: boolean, opts: NumberParseOptions): number | undefined {
  const v = toNumber(c, opts);
  if (v === undefined || v < 0) return undefined;
  const pct = fractions && v > 0 && v < 1 ? v * 100 : v;
  return pct > 100 ? undefined : round(pct, 4);
}

/** Unidad por defecto si no hay columna de unidad: la de la cabecera de cantidad ("Kilos" → kg) o la del final de la descripción. */
function defaultUnit(quantityHeader: string, description: string): string {
  if (/\b(kilos?|kg|kgs|peso)\b/.test(quantityHeader)) return 'kg';
  if (/\b(litros?|lts?)\b/.test(quantityHeader)) return 'l';
  if (/\b(cajas?)\b/.test(quantityHeader)) return 'caja';
  const d = fold(description);
  if (/(?:\/|\bpor\s|\b)(kg|kilo|kilos)\.?$/.test(d)) return 'kg';
  if (/(?:\/|\bpor\s|\b)(l|litro|litros)\.?$/.test(d)) return 'l';
  return 'ud';
}

type Line = ExtractedInvoice['lines'][number];

/**
 * Convierte filas en facturas. Si hay columnas de proveedor / nº factura / fecha, agrupa por ellas (un listado de
 * muchas facturas); si no, devuelve una sola factura. Las líneas salen normalizadas (core/pack) con método 'hoja'.
 * Las celdas vacías de proveedor / nº / fecha heredan el valor de la fila anterior (exportaciones de ERP que sólo lo
 * ponen en la primera línea de cada factura). Se omiten filas vacías, de totales y sin precio. Sin líneas → [].
 */
export function sheetToInvoices(rows: Cell[][], mapping: ColumnMapping, headerRow: number, defaults?: { supplierName?: string; date?: string }): ExtractedInvoice[] {
  const opts = decimalStyle(rows);
  const header = rows[headerRow] ?? [];
  const qtyHeader = mapping.quantity !== undefined ? headerKey(header[mapping.quantity] ?? null) : '';
  const data = rows.slice(Math.max(0, headerRow + 1));
  // ¿Descuento / IVA como fracción (0,21) en vez de porcentaje (21)?
  const fractionCol = (col: number | undefined) => {
    if (col === undefined) return false;
    const vals = data.map((r) => toNumber(r[col], opts)).filter((v): v is number => v !== undefined && v !== 0);
    return vals.length > 0 && vals.every((v) => v > 0 && v < 1);
  };
  const discountFractions = fractionCol(mapping.discount);
  const vatFractions = fractionCol(mapping.vat);
  const grouped = mapping.supplier !== undefined || mapping.invoiceNumber !== undefined || mapping.date !== undefined;

  interface Group {
    supplierName?: string;
    number?: string;
    date?: string;
    lines: Line[];
    warnings: string[];
    computed: number;
  }
  const groups = new Map<string, Group>();
  let carry: { supplier?: string; number?: string; date?: string } = {};
  let skippedNoPrice = 0;

  for (const r of data) {
    if (!r || !r.some((c) => c != null && c !== '')) continue;
    const description = cellText(r[mapping.description]);
    const supplierCell = mapping.supplier !== undefined ? textOf(r[mapping.supplier]) : undefined;
    const numberCell = mapping.invoiceNumber !== undefined ? textOf(r[mapping.invoiceNumber]) : undefined;
    const dateCell = mapping.date !== undefined ? dateOf(r[mapping.date]) : undefined;
    // Cambio de factura: si aparece un proveedor o número nuevo, no se hereda lo anterior
    if (supplierCell || numberCell) carry = {};
    carry = { supplier: supplierCell ?? carry.supplier, number: numberCell ?? carry.number, date: dateCell ?? carry.date };
    if (!description || letters(description) < 2 || TOTALS_ROW.test(description)) continue;

    const qRaw = mapping.quantity !== undefined ? toNumber(r[mapping.quantity], opts) : undefined;
    const pRaw = mapping.unitPrice !== undefined ? toNumber(r[mapping.unitPrice], opts) : undefined;
    const tRaw = mapping.total !== undefined ? toNumber(r[mapping.total], opts) : undefined;
    const discountPct = mapping.discount !== undefined ? pctOf(r[mapping.discount], discountFractions, opts) : undefined;
    const vatPct = mapping.vat !== undefined ? pctOf(r[mapping.vat], vatFractions, opts) : undefined;
    const factor = 1 - (discountPct ?? 0) / 100;

    let quantity = qRaw !== undefined && qRaw !== 0 ? qRaw : undefined;
    let unitPrice = pRaw !== undefined && pRaw > 0 ? pRaw : undefined;
    let total = tRaw !== undefined && tRaw !== 0 ? tRaw : undefined;
    const warnings: string[] = [];
    let computed = false;
    if (quantity === undefined && unitPrice !== undefined && total !== undefined && factor > 0) {
      quantity = round(total / (unitPrice * factor), 4);
      computed = true;
    }
    quantity ??= 1;
    if (unitPrice === undefined && total !== undefined && factor > 0) {
      unitPrice = round(total / quantity / factor, 6);
      computed = true;
    }
    if (total === undefined && unitPrice !== undefined) {
      total = round(quantity * unitPrice * factor, 2);
      computed = true;
    }
    if (unitPrice === undefined || total === undefined) {
      skippedNoPrice++;
      continue;
    }
    const validated = qRaw !== undefined && pRaw !== undefined && tRaw !== undefined && approxEqual(qRaw * pRaw * factor, tRaw);

    const unitCell = mapping.unit !== undefined ? cellText(r[mapping.unit]) : '';
    const code = mapping.code !== undefined ? textOf(r[mapping.code]) : undefined;
    const base: Omit<Line, 'baseUnit' | 'baseQuantity' | 'pricePerBase'> = {
      description,
      ...(code ? { code } : {}),
      quantity,
      unit: unitCell || defaultUnit(qtyHeader, description),
      unitPrice,
      ...(discountPct ? { discountPct } : {}),
      total,
      ...(vatPct !== undefined ? { vatPct } : {}),
      confidence: validated ? 1 : computed ? 0.9 : 0.8,
      warnings,
    };
    const line = normalizeInvoiceLine(base);
    const suggestedName = cleanProductName(description);
    const finalLine: Line = { ...line, ...(suggestedName ? { suggestedName } : {}) };

    const supplierName = carry.supplier ?? defaults?.supplierName;
    const date = carry.date ?? defaults?.date;
    const key = grouped ? `${fold(supplierName ?? '')}|${carry.number ?? ''}|${date ?? ''}` : 'única';
    let g = groups.get(key);
    if (!g) {
      g = { ...(supplierName ? { supplierName } : {}), ...(carry.number ? { number: carry.number } : {}), ...(date ? { date } : {}), lines: [], warnings: [], computed: 0 };
      groups.set(key, g);
    }
    g.lines.push(finalLine);
    if (computed) g.computed++;
  }

  const out: ExtractedInvoice[] = [];
  for (const g of groups.values()) {
    const subtotal = round(
      g.lines.reduce((s, l) => s + l.total, 0),
      2,
    );
    const hasVat = g.lines.some((l) => l.vatPct !== undefined);
    const vatTotal = hasVat
      ? round(
          g.lines.reduce((s, l) => s + (l.total * (l.vatPct ?? 0)) / 100, 0),
          2,
        )
      : undefined;
    const warnings = [...g.warnings];
    if (g.computed) warnings.push(g.computed === 1 ? '1 línea no traía cantidad, precio o importe: se ha calculado con los otros dos' : `${g.computed} líneas no traían cantidad, precio o importe: se han calculado con los otros dos`);
    if (skippedNoPrice && out.length === 0) warnings.push(skippedNoPrice === 1 ? 'Se ha omitido 1 fila sin precio ni importe' : `Se han omitido ${skippedNoPrice} filas sin precio ni importe`);
    const inv: ExtractedInvoice = {
      ...(g.supplierName ? { supplierName: g.supplierName } : {}),
      ...(g.number ? { number: g.number } : {}),
      ...(g.date ? { date: g.date } : {}),
      subtotal,
      ...(vatTotal !== undefined ? { vatTotal, total: round(subtotal + vatTotal, 2) } : {}),
      lines: g.lines,
      method: 'hoja',
      warnings,
    };
    out.push(inv);
  }
  return out;
}
