import type { Cell, Fill, Worksheet, Workbook } from 'exceljs';
import type { Dish, DishCost, ItemCost, Product, Supplier, BusinessSettings, Workspace } from '../types';
import { costDish, foodCostStatus, type CostingContext, type FoodCostStatus } from '../core/costing';
import { dishesUsingProduct } from '../core/analytics';
import { UNIT_LABELS } from '../core/units';
import { ALLERGEN_LABELS, BASIS_LABELS, CATEGORY_LABELS } from './labels';
import { fmtDate } from './format';
import { todayIso } from './id';

/** Descarga un Blob como archivo. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ───────────────────────────── CSV ─────────────────────────────

/** Número con coma decimal y sin separador de miles (Excel ES lo interpreta como número). */
function csvNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return (s === '-0' ? '0' : s).replace('.', ',');
}

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? csvNumber(v) : '';
  let s = String(v);
  // Evita que Excel interprete el texto como fórmula (inyección CSV): "=…", "+…", "@…", "-texto".
  if (/^[=+@\t\r]/.test(s) || /^-[^\d.,\s]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con ; y coma decimal (abre bien en Excel ES). Incluye BOM UTF-8 para que Excel respete las tildes. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return `﻿${rows.map((r) => r.map(csvCell).join(';')).join('\r\n')}`;
}

// ───────────────────────────── Excel: estilos comunes ─────────────────────────────

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const BRAND = 'FFFF5A1F';
const INK = 'FF0B0F14';
const MUTED = 'FF677486';
const LINE = 'FFE6E9EE';
const SOFT = 'FFF6F7F9';
const WHITE = 'FFFFFFFF';

const FMT_EUR = '#,##0.00 "€"';
const FMT_EUR_PRECISE = '#,##0.00## "€"';
const FMT_PCT = '0.0%';
const FMT_QTY = '#,##0.000';
const FMT_NUM = '#,##0.##';
const FMT_INT = '0';
const FMT_DATE = 'dd/mm/yyyy';

const STATUS_COLORS: Record<Exclude<FoodCostStatus, 'none'>, { fill: string; font: string }> = {
  ok: { fill: 'FFDCFCE7', font: 'FF166534' },
  warn: { fill: 'FFFEF3C7', font: 'FF92400E' },
  bad: { fill: 'FFFEE2E2', font: 'FF991B1B' },
};
const TAB_COLORS: Record<FoodCostStatus, string> = { ok: 'FF16A34A', warn: 'FFF59E0B', bad: 'FFDC2626', none: 'FF94A3B8' };

type ExcelModule = typeof import('exceljs');

async function loadExcel(): Promise<ExcelModule> {
  const mod = (await import('exceljs')) as ExcelModule & { default?: ExcelModule };
  return mod.default ?? mod;
}

function solid(argb: string): Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function newWorkbook(ExcelJS: ExcelModule, title: string): Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Escandallo Pro';
  wb.lastModifiedBy = 'Escandallo Pro';
  wb.created = new Date();
  wb.modified = new Date();
  wb.title = title;
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

async function toBlob(wb: Workbook): Promise<Blob> {
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer as ArrayBuffer], { type: XLSX_MIME });
}

/** Nombre de hoja válido para Excel: sin []:*?/\, máx. 31 caracteres, sin apóstrofo en los extremos y único. */
export function safeSheetName(name: string, used: Set<string>): string {
  let base = (name || 'Hoja').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim();
  if (!base || base.toLowerCase() === 'history') base = base ? `${base} (1)` : 'Hoja';
  let candidate = base.slice(0, 31).trim();
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Referencia a una hoja para fórmulas e hipervínculos ('Mi hoja'!B9). */
function sheetRef(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function titleBlock(ws: Worksheet, title: string, subtitle: string, span: number): void {
  ws.mergeCells(1, 1, 1, span);
  ws.mergeCells(2, 1, 2, span);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: BRAND } };
  t.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 26;
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: 'Calibri', size: 10, color: { argb: MUTED } };
}

/** Pie de página para imprimir: origen a la izquierda y "Página X de N" a la derecha ("&" es un código en Excel). */
function pageFooter(ws: Worksheet, left: string): void {
  const text = left.replace(/&/g, '&&');
  ws.headerFooter = { oddFooter: `&L&8${text}&R&8Página &P de &N`, evenFooter: `&L&8${text}&R&8Página &P de &N` };
}

function styleHeader(ws: Worksheet, rowNumber: number, labels: string[]): void {
  const row = ws.getRow(rowNumber);
  labels.forEach((label, i) => {
    const c = row.getCell(i + 1);
    c.value = label;
    c.fill = solid(BRAND);
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE } };
    c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: BRAND } } };
  });
  row.height = 32;
}

function styleBody(c: Cell, numFmt?: string): void {
  if (numFmt) c.numFmt = numFmt;
  c.font = { name: 'Calibri', size: 10, color: { argb: INK } };
  c.border = { bottom: { style: 'hair', color: { argb: LINE } } };
  c.alignment = { vertical: 'middle', wrapText: false };
}

function setWidths(ws: Worksheet, widths: number[]): void {
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

/**
 * Semáforo de food cost como formato condicional (se recalcula si se editan los valores en Excel), con los mismos
 * umbrales que la app (core/costing.foodCostStatus): verde ≤ objetivo, ámbar ≤ umbral de atención, rojo por encima.
 * `target` es el objetivo en tanto por uno o una referencia relativa a la primera fila del rango (p. ej. "J5").
 */
function foodCostRules(ws: Worksheet, ref: string, firstCell: string, target: number | string, warningPct: number): void {
  const t = typeof target === 'number' ? String(Math.round(target * 1e6) / 1e6) : target;
  const w = String(Math.round((warningPct / 100) * 1e6) / 1e6);
  const upper = `MAX(${t},${w})`;
  const style = (s: Exclude<FoodCostStatus, 'none'>) => ({
    fill: { type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb: STATUS_COLORS[s].fill } },
    font: { bold: true, color: { argb: STATUS_COLORS[s].font } },
  });
  ws.addConditionalFormatting({
    ref,
    rules: [
      { type: 'expression', priority: 1, formulae: [`AND(ISNUMBER(${firstCell}),${firstCell}<=${t})`], style: style('ok') },
      { type: 'expression', priority: 2, formulae: [`AND(ISNUMBER(${firstCell}),${firstCell}>${t},${firstCell}<=${upper})`], style: style('warn') },
      { type: 'expression', priority: 3, formulae: [`AND(ISNUMBER(${firstCell}),${firstCell}>${upper})`], style: style('bad') },
    ],
  });
}

/** Enlace interno a otra hoja del libro. */
function sheetLink(sheet: string, text: string, tooltip: string): Cell['value'] {
  return { text, hyperlink: `#${sheetRef(sheet)}!A1`, tooltip };
}

function allergenText(list: readonly string[]): string {
  return list.map((a) => ALLERGEN_LABELS[a as keyof typeof ALLERGEN_LABELS]?.label ?? a).join(', ');
}

function isoToDate(iso: string | undefined): Date | undefined {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return undefined;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function num(v: number | undefined | null): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Valor de fórmula con su resultado calculado (visible en vistas previas que no recalculan). */
function formula(f: string, result: number | string | undefined): { formula: string; result: number | string } {
  return { formula: f, result: result ?? '' };
}

const WASTE_SOURCE_LABELS: Record<ItemCost['wasteSource'], string> = {
  prueba: 'Prueba de rendimiento',
  linea: 'Indicada en la línea',
  producto: 'Del producto',
  ninguna: '—',
};

const PRICE_SOURCE_LABELS: Record<Product['priceSource'], string> = { factura: 'Factura', manual: 'Manual', demo: 'Demo', hoja: 'Tarifa (Excel)' };

// ───────────────────────────── Excel: escandallos ─────────────────────────────

interface DishSheetInfo {
  dish: Dish;
  cost: DishCost;
  sheet: string;
  /** Celda con el coste por ración y el PVP sugerido en la hoja del plato. */
  costCell: string;
  suggestedCell: string;
}

const LINE_HEADERS = [
  'Ingrediente',
  'Vinculado a',
  'Cantidad',
  'Unidad',
  'Base',
  'Bruto',
  'Neto',
  'Servido',
  'Ud. base',
  'Merma limpieza',
  'Merma cocción',
  'Merma total',
  'Precio (€/ud base)',
  'Coste',
  '% del coste',
  'Coste de la merma',
  'Origen de la merma',
  'Avisos',
];
const LINE_WIDTHS = [30, 26, 10, 9, 10, 11, 11, 11, 8, 10, 10, 10, 13, 12, 10, 12, 18, 44];

/** "Vinculado a": producto o elaboración (con enlace a su ficha si está en el libro). */
function refValue(dishItem: Dish['items'][number], ctx: CostingContext, sheets: Map<string, string>): Cell['value'] {
  if (!dishItem.ref) return '';
  if (dishItem.ref.type === 'product') return ctx.products.get(dishItem.ref.id)?.name ?? '';
  const d = ctx.dishes.get(dishItem.ref.id);
  if (!d) return '';
  const text = `${d.name} (elaboración)`;
  const sheet = sheets.get(d.id);
  return sheet ? sheetLink(sheet, text, 'Abrir la ficha de la elaboración') : text;
}

function addDishSheet(
  wb: Workbook,
  info: DishSheetInfo,
  workspace: Workspace,
  ctx: CostingContext,
  business: BusinessSettings,
  sheets: Map<string, string>,
): void {
  const { dish, cost } = info;
  const status = foodCostStatus(cost.foodCostPct, cost.targetFoodCostPct, business.warningFoodCostPct);
  const ws = wb.addWorksheet(info.sheet, {
    properties: { tabColor: { argb: TAB_COLORS[dish.kind === 'plato' ? status : 'none'] } },
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  setWidths(ws, LINE_WIDTHS);
  pageFooter(ws, `${dish.name} · ${workspace.name} · Escandallo Pro`);
  const kindLabel = dish.kind === 'plato' ? 'Ficha técnica' : 'Elaboración (sub-receta)';
  titleBlock(ws, dish.name, `${kindLabel} · ${workspace.name} · ${fmtDate(todayIso())}`, LINE_HEADERS.length);

  const portions = dish.portions > 0 ? dish.portions : 1;
  const vat = (dish.saleVatPct ?? business.defaultSaleVatPct) / 100;
  const target = cost.targetFoodCostPct / 100;
  const items = cost.items;
  const firstLine = 16;
  const lastLine = firstLine + Math.max(items.length, 1) - 1;
  const totalRow = lastLine + 1;

  const label = (cell: Cell, text: string) => {
    cell.value = text;
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: MUTED } };
    cell.fill = solid(SOFT);
    cell.alignment = { vertical: 'middle' };
    cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
  };
  const value = (cell: Cell, v: Cell['value'], fmt?: string, bold = false) => {
    cell.value = v;
    if (fmt) cell.numFmt = fmt;
    cell.font = { name: 'Calibri', size: 11, bold, color: { argb: INK } };
    cell.alignment = { vertical: 'middle', horizontal: 'right' };
    cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
  };
  // Bloque izquierdo (A/B) y derecho (E:G etiqueta, H:I valor)
  const left: [string, Cell['value'], string?, boolean?][] = [
    ['Sección', dish.section ?? (dish.kind === 'elaboracion' ? 'Elaboraciones' : '—')],
    ['Raciones', portions, FMT_NUM],
    ['PVP (IVA incl.)', num(dish.menuPrice) ?? '', FMT_EUR, true],
    ['IVA de venta', vat, '0%'],
    ['PVP sin IVA', formula('IF(AND(ISNUMBER(B6),B6>0),B6/(1+B7),"")', num(cost.netPrice)), FMT_EUR],
    ['Coste por ración', formula('IF(B5>0,B10/B5,0)', cost.costPerPortion), FMT_EUR, true],
    ['Coste total de la receta', formula(`N${totalRow}`, cost.totalCost), FMT_EUR],
  ];
  left.forEach(([l, v, fmt, bold], i) => {
    label(ws.getCell(4 + i, 1), l);
    value(ws.getCell(4 + i, 2), v, fmt, bold);
    if (i === 0) ws.getCell(4, 2).alignment = { vertical: 'middle', horizontal: 'left' };
  });
  const rounding = business.priceRounding > 0 ? business.priceRounding : 0;
  const suggestedFormula = rounding
    ? `IF(AND(B9>0,H5>0),CEILING(ROUND(B9/H5*(1+B7),6),${rounding}),"")`
    : 'IF(AND(B9>0,H5>0),ROUND(B9/H5*(1+B7),2),"")';
  const right: [string, Cell['value'], string?, boolean?][] = [
    ['Food cost', formula('IF(AND(ISNUMBER(B8),B8>0),B9/B8,"")', cost.foodCostPct != null ? cost.foodCostPct / 100 : undefined), FMT_PCT, true],
    ['Food cost objetivo', target, FMT_PCT],
    ['Margen bruto por ración', formula('IF(ISNUMBER(B8),B8-B9,"")', num(cost.grossMargin)), FMT_EUR, true],
    ['Margen bruto (%)', formula('IF(AND(ISNUMBER(B8),B8>0),(B8-B9)/B8,"")', cost.grossMarginPct != null ? cost.grossMarginPct / 100 : undefined), FMT_PCT],
    ['PVP sugerido (IVA incl.)', formula(suggestedFormula, num(cost.suggestedPrice)), FMT_EUR],
    ['Merma por ración (kg)', cost.wasteKgPerPortion, FMT_QTY],
    ['Coste de la merma por ración', formula(`IF(B5>0,SUM(P${firstLine}:P${lastLine})/B5,0)`, cost.wasteCostPerPortion), FMT_EUR],
  ];
  right.forEach(([l, v, fmt, bold], i) => {
    const r = 4 + i;
    ws.mergeCells(r, 5, r, 7);
    ws.mergeCells(r, 8, r, 9);
    label(ws.getCell(r, 5), l);
    value(ws.getCell(r, 8), v, fmt, bold);
  });
  foodCostRules(ws, 'H4', 'H4', 'H5', business.warningFoodCostPct);

  // Alérgenos y rendimiento
  label(ws.getCell(11, 1), 'Alérgenos');
  ws.mergeCells(11, 2, 11, LINE_HEADERS.length);
  const alg = ws.getCell(11, 2);
  alg.value = cost.allergens.length ? allergenText(cost.allergens) : 'Sin alérgenos declarados en sus ingredientes';
  alg.font = { name: 'Calibri', size: 10, bold: cost.allergens.length > 0, color: { argb: INK } };
  label(ws.getCell(12, 1), dish.kind === 'elaboracion' ? 'Rendimiento' : 'Estado');
  ws.mergeCells(12, 2, 12, LINE_HEADERS.length);
  const info2 = ws.getCell(12, 2);
  if (dish.kind === 'elaboracion') {
    const perUnit = num(cost.pricePerYieldUnit);
    info2.value =
      dish.yieldQty && dish.yieldUnit
        ? `${String(dish.yieldQty).replace('.', ',')} ${dish.yieldUnit}${perUnit != null ? ` · ${perUnit.toFixed(2).replace('.', ',')} €/${dish.yieldUnit}` : ''}`
        : 'Sin rendimiento indicado (se usa por raciones)';
  } else {
    const pct = Math.round(cost.completeness * 100);
    info2.value = `${dish.status === 'revisado' ? 'Revisado' : 'Borrador'} · ${pct} % de los ingredientes con precio`;
  }
  info2.font = { name: 'Calibri', size: 10, color: { argb: INK } };
  if (dish.procedure?.trim()) {
    label(ws.getCell(13, 1), 'Elaboración');
    ws.mergeCells(13, 2, 13, LINE_HEADERS.length);
    const p = ws.getCell(13, 2);
    p.value = dish.procedure.trim();
    p.font = { name: 'Calibri', size: 10, color: { argb: INK } };
    p.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(13).height = Math.min(120, 15 * Math.max(1, Math.ceil(dish.procedure.length / 180)));
  }

  // Tabla de líneas
  const headerRow = firstLine - 1;
  styleHeader(ws, headerRow, LINE_HEADERS);
  ws.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 1, topLeftCell: `B${firstLine}` }];
  const itemsById = new Map(dish.items.map((it) => [it.id, it]));
  if (!items.length) {
    const c = ws.getCell(firstLine, 1);
    c.value = 'La receta aún no tiene ingredientes';
    c.font = { name: 'Calibri', size: 10, italic: true, color: { argb: MUTED } };
    ws.getCell(firstLine, 14).value = 0;
  }
  items.forEach((ic, i) => {
    const r = firstLine + i;
    const it = itemsById.get(ic.itemId);
    const row = ws.getRow(r);
    const values: [Cell['value'], string?][] = [
      [ic.name || it?.name || ''],
      [it ? refValue(it, ctx, sheets) : ''],
      [num(it?.quantity) ?? '', FMT_NUM],
      [it ? UNIT_LABELS[it.unit] : ''],
      [it ? BASIS_LABELS[it.basis].label : ''],
      [ic.resolved || ic.grossQty > 0 ? ic.grossQty : '', FMT_QTY],
      [ic.resolved || ic.netQty > 0 ? ic.netQty : '', FMT_QTY],
      [ic.resolved || ic.servedQty > 0 ? ic.servedQty : '', FMT_QTY],
      [ic.baseUnit ?? ''],
      [ic.baseUnit ? ic.appliedWastePct / 100 : '', FMT_PCT],
      [ic.baseUnit ? ic.appliedCookingLossPct / 100 : '', FMT_PCT],
      [ic.baseUnit ? ic.totalWastePct / 100 : '', FMT_PCT],
      [num(ic.pricePerBase) ?? '', FMT_EUR_PRECISE],
      ['', FMT_EUR],
      [formula(`IF($N$${totalRow}>0,N${r}/$N$${totalRow},"")`, cost.totalCost > 0 ? ic.cost / cost.totalCost : undefined), FMT_PCT],
      [ic.wasteCost, FMT_EUR],
      [ic.baseUnit ? WASTE_SOURCE_LABELS[ic.wasteSource] : ''],
      [ic.warnings.join(' · ')],
    ];
    values.forEach(([v, fmt], col) => {
      const c = row.getCell(col + 1);
      c.value = v;
      styleBody(c, fmt);
    });
    if (it?.ref?.type === 'dish' && sheets.has(it.ref.id)) row.getCell(2).font = { name: 'Calibri', size: 10, color: { argb: BRAND }, underline: true };
    // Coste: fórmula bruto × precio salvo con prueba de rendimiento (coste real por kg útil, ya calculado).
    const costCell = row.getCell(14);
    const plain = ic.pricePerBase != null && Math.abs(ic.grossQty * ic.pricePerBase - ic.cost) <= Math.max(1e-6, Math.abs(ic.cost) * 1e-6);
    costCell.value = ic.pricePerBase != null && ic.grossQty > 0 && plain ? formula(`F${r}*M${r}`, ic.cost) : ic.cost;
    costCell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK } };
    if (!ic.resolved) {
      row.getCell(1).fill = solid(STATUS_COLORS.warn.fill);
      row.getCell(18).font = { name: 'Calibri', size: 10, color: { argb: STATUS_COLORS.warn.font } };
    }
  });
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastLine, column: LINE_HEADERS.length } };

  // Totales
  const total = ws.getRow(totalRow);
  total.getCell(1).value = 'Total receta';
  total.getCell(14).value = formula(`SUM(N${firstLine}:N${lastLine})`, cost.totalCost);
  total.getCell(14).numFmt = FMT_EUR;
  total.getCell(16).value = formula(`SUM(P${firstLine}:P${lastLine})`, cost.wasteCostPerPortion * portions);
  total.getCell(16).numFmt = FMT_EUR;
  const perPortion = ws.getRow(totalRow + 1);
  perPortion.getCell(1).value = `Coste por ración (${String(portions).replace('.', ',')} ${portions === 1 ? 'ración' : 'raciones'})`;
  perPortion.getCell(14).value = formula(`IF(B5>0,N${totalRow}/B5,0)`, cost.costPerPortion);
  perPortion.getCell(14).numFmt = FMT_EUR;
  for (const r of [total, perPortion]) {
    for (let c = 1; c <= LINE_HEADERS.length; c++) {
      const cell = r.getCell(c);
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK } };
      cell.fill = solid(SOFT);
      cell.border = { top: { style: 'thin', color: { argb: LINE } } };
    }
  }
}

/**
 * Excel profesional con: hoja "Resumen" (todos los platos: sección, PVP, coste, FC %, margen, merma %, sugerido),
 * una hoja por plato (ficha técnica con líneas: ingrediente, bruto, neto, merma %, precio, coste, % coste) y hoja "Ingredientes".
 * Formatos €, %, cabeceras con color de marca, anchos ajustados, filtros. Los totales son fórmulas (con su resultado ya
 * calculado): si se cambia un precio o un PVP en Excel, el escandallo se recalcula.
 */
export async function exportEscandallosXlsx(args: {
  workspace: Workspace;
  dishes: Dish[];
  costs: Map<string, DishCost>;
  ctx: CostingContext;
  business: BusinessSettings;
}): Promise<Blob> {
  const { workspace, costs, ctx, business } = args;
  const ExcelJS = await loadExcel();
  const wb = newWorkbook(ExcelJS, `Escandallos · ${workspace.name}`);
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const dishes = [...args.dishes].sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'plato' ? -1 : 1) ||
      collator.compare(a.section ?? '~', b.section ?? '~') ||
      collator.compare(a.name, b.name),
  );

  const used = new Set<string>(['resumen', 'ingredientes']);
  const infos: DishSheetInfo[] = dishes.map((dish) => ({
    dish,
    cost: costs.get(dish.id) ?? costDish(dish, ctx),
    sheet: safeSheetName(dish.name, used),
    costCell: 'B9',
    suggestedCell: 'H8',
  }));

  // ── Resumen ──
  const summary = wb.addWorksheet('Resumen', {
    properties: { tabColor: { argb: BRAND } },
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const headers = [
    'Plato',
    'Tipo',
    'Sección',
    'Raciones',
    'PVP (IVA incl.)',
    'IVA',
    'PVP sin IVA',
    'Coste ración',
    'Food cost',
    'FC objetivo',
    'Margen bruto',
    'Margen %',
    'PVP sugerido',
    'Merma por ración (kg)',
    'Merma %',
    'Coste merma ración',
    'Ingredientes con precio',
    'Estado',
    'Alérgenos',
  ];
  setWidths(summary, [34, 12, 18, 9, 12, 7, 12, 12, 10, 10, 12, 10, 12, 12, 9, 12, 12, 11, 40]);
  pageFooter(summary, `Escandallos · ${workspace.name} · Escandallo Pro`);
  const platos = infos.filter((i) => i.dish.kind === 'plato');
  // Misma población que la fórmula AVERAGE de la fila de medias (las filas sin PVP no cuentan).
  const withPrice = infos.filter((i) => i.cost.foodCostPct != null);
  const avgFc = withPrice.length ? withPrice.reduce((s, i) => s + (i.cost.foodCostPct ?? 0), 0) / withPrice.length : undefined;
  titleBlock(
    summary,
    `Escandallos · ${workspace.name}`,
    `${platos.length} platos · ${infos.length - platos.length} elaboraciones · Food cost objetivo ${business.targetFoodCostPct} % · ` +
      `${avgFc != null ? `Food cost medio ${avgFc.toFixed(1).replace('.', ',')} % · ` : ''}Generado el ${fmtDate(todayIso())} con Escandallo Pro`,
    headers.length,
  );
  const headerRow = 4;
  styleHeader(summary, headerRow, headers);
  summary.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 1, topLeftCell: `B${headerRow + 1}` }];
  infos.forEach((info, i) => {
    const r = headerRow + 1 + i;
    const { dish, cost } = info;
    const ref = sheetRef(info.sheet);
    const vat = (dish.saleVatPct ?? business.defaultSaleVatPct) / 100;
    const values: [Cell['value'], string?][] = [
      [sheetLink(info.sheet, dish.name, dish.kind === 'plato' ? 'Abrir la ficha del plato' : 'Abrir la ficha de la elaboración')],
      [dish.kind === 'plato' ? 'Plato' : 'Elaboración'],
      [dish.section ?? ''],
      [dish.portions > 0 ? dish.portions : 1, FMT_NUM],
      [num(dish.menuPrice) ?? '', FMT_EUR],
      [vat, '0%'],
      [formula(`IF(AND(ISNUMBER(E${r}),E${r}>0),E${r}/(1+F${r}),"")`, num(cost.netPrice)), FMT_EUR],
      [formula(`${ref}!${info.costCell}`, cost.costPerPortion), FMT_EUR],
      [formula(`IF(AND(ISNUMBER(G${r}),G${r}>0),H${r}/G${r},"")`, cost.foodCostPct != null ? cost.foodCostPct / 100 : undefined), FMT_PCT],
      [cost.targetFoodCostPct / 100, FMT_PCT],
      [formula(`IF(ISNUMBER(G${r}),G${r}-H${r},"")`, num(cost.grossMargin)), FMT_EUR],
      [formula(`IF(AND(ISNUMBER(G${r}),G${r}>0),(G${r}-H${r})/G${r},"")`, cost.grossMarginPct != null ? cost.grossMarginPct / 100 : undefined), FMT_PCT],
      [formula(`${ref}!${info.suggestedCell}`, num(cost.suggestedPrice)), FMT_EUR],
      [cost.wasteKgPerPortion, FMT_QTY],
      [cost.wastePct / 100, FMT_PCT],
      [cost.wasteCostPerPortion, FMT_EUR],
      [cost.completeness, '0%'],
      [dish.status === 'revisado' ? 'Revisado' : 'Borrador'],
      [allergenText(cost.allergens)],
    ];
    const row = summary.getRow(r);
    values.forEach(([v, fmt], col) => {
      const c = row.getCell(col + 1);
      c.value = v;
      styleBody(c, fmt);
    });
    row.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK }, underline: false };
    row.getCell(9).font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK } };
    row.getCell(10).font = { name: 'Calibri', size: 10, color: { argb: MUTED } };
    if (cost.completeness < 1 && cost.items.length) row.getCell(17).font = { name: 'Calibri', size: 10, color: { argb: STATUS_COLORS.warn.font } };
  });
  const lastRow = headerRow + Math.max(infos.length, 1);
  if (!infos.length) summary.getCell(headerRow + 1, 1).value = 'No hay platos que exportar';
  summary.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastRow, column: headers.length } };
  // Cada plato se compara con su propio objetivo (columna J), que puede diferir del general del negocio.
  foodCostRules(summary, `I${headerRow + 1}:I${lastRow}`, `I${headerRow + 1}`, `J${headerRow + 1}`, business.warningFoodCostPct);
  if (infos.length) {
    const avgRow = summary.getRow(lastRow + 2);
    avgRow.getCell(1).value = 'Media de la carta';
    avgRow.getCell(9).value = formula(`IFERROR(AVERAGE(I${headerRow + 1}:I${lastRow}),"")`, avgFc != null ? avgFc / 100 : undefined);
    avgRow.getCell(9).numFmt = FMT_PCT;
    avgRow.getCell(10).value = business.targetFoodCostPct / 100;
    avgRow.getCell(10).numFmt = FMT_PCT;
    const margins = infos.map((p) => p.cost.grossMargin).filter((m): m is number => m != null);
    avgRow.getCell(11).value = formula(`IFERROR(AVERAGE(K${headerRow + 1}:K${lastRow}),"")`, margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : undefined);
    avgRow.getCell(11).numFmt = FMT_EUR;
    for (let c = 1; c <= headers.length; c++) {
      const cell = avgRow.getCell(c);
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK } };
      cell.fill = solid(SOFT);
      cell.border = { top: { style: 'thin', color: { argb: LINE } } };
    }
    foodCostRules(summary, `I${lastRow + 2}`, `I${lastRow + 2}`, `J${lastRow + 2}`, business.warningFoodCostPct);
  }

  // ── Ingredientes ──
  const ing = wb.addWorksheet('Ingredientes', {
    properties: { tabColor: { argb: 'FF0EA5E9' } },
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const ingHeaders = [
    'Ingrediente',
    'Categoría',
    'Unidad base',
    'Precio (€/ud base)',
    'Origen del precio',
    'Última compra',
    'Merma limpieza',
    'Merma cocción',
    'Prueba de rendimiento',
    'Alérgenos',
    'Nº de platos',
    'Platos que lo usan',
  ];
  setWidths(ing, [34, 18, 10, 14, 14, 13, 11, 11, 14, 30, 10, 60]);
  pageFooter(ing, `Ingredientes · ${workspace.name} · Escandallo Pro`);
  const allDishes = [...ctx.dishes.values()];
  const products = [...ctx.products.values()].sort((a, b) => collator.compare(a.name, b.name));
  titleBlock(ing, `Ingredientes · ${workspace.name}`, `${products.length} ingredientes con su precio vigente (sin IVA) y sus mermas`, ingHeaders.length);
  styleHeader(ing, headerRow, ingHeaders);
  ing.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 1, topLeftCell: `B${headerRow + 1}` }];
  products.forEach((p, i) => {
    const r = headerRow + 1 + i;
    const usedIn = [...dishesUsingProduct(allDishes, p.id)].map((id) => ctx.dishes.get(id)?.name).filter((n): n is string => !!n);
    const test = p.yieldTestId ? ctx.yieldTests.get(p.yieldTestId) : undefined;
    const values: [Cell['value'], string?][] = [
      [p.name],
      [CATEGORY_LABELS[p.category]?.label ?? p.category],
      [p.baseUnit],
      [p.pricePerBase > 0 ? p.pricePerBase : '', FMT_EUR_PRECISE],
      [PRICE_SOURCE_LABELS[p.priceSource] ?? p.priceSource],
      [isoToDate(p.lastPurchaseDate) ?? '', FMT_DATE],
      [p.wastePct / 100, FMT_PCT],
      [p.cookingLossPct / 100, FMT_PCT],
      [test ? test.name : ''],
      [allergenText(p.allergens)],
      [usedIn.length, FMT_INT],
      [usedIn.sort(collator.compare).join(', ')],
    ];
    const row = ing.getRow(r);
    values.forEach(([v, fmt], col) => {
      const c = row.getCell(col + 1);
      c.value = v;
      styleBody(c, fmt);
    });
    if (!(p.pricePerBase > 0)) row.getCell(4).fill = solid(STATUS_COLORS.warn.fill);
  });
  ing.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + Math.max(products.length, 1), column: ingHeaders.length } };

  // ── Una hoja por plato ──
  const sheets = new Map(infos.map((i) => [i.dish.id, i.sheet]));
  for (const info of infos) addDishSheet(wb, info, workspace, ctx, business, sheets);

  return toBlob(wb);
}

// ───────────────────────────── Excel: productos ─────────────────────────────

export async function exportProductsXlsx(products: Product[], suppliers: Supplier[]): Promise<Blob> {
  const ExcelJS = await loadExcel();
  const wb = newWorkbook(ExcelJS, 'Productos y precios');
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const sorted = [...products].sort((a, b) => collator.compare(a.name, b.name));

  const ws = wb.addWorksheet('Productos', {
    properties: { tabColor: { argb: BRAND } },
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const headers = [
    'Producto',
    'Categoría',
    'Proveedor',
    'Unidad base',
    'Precio (€/ud base)',
    'Origen del precio',
    'Última compra',
    'IVA compra',
    'Merma limpieza',
    'Merma cocción',
    'Peso por ud (kg)',
    'Densidad (kg/l)',
    'Alérgenos',
    'Otros nombres (alias)',
    'Notas',
  ];
  setWidths(ws, [34, 18, 24, 10, 14, 14, 13, 10, 11, 11, 12, 12, 30, 44, 36]);
  pageFooter(ws, 'Productos y precios · Escandallo Pro');
  const priced = sorted.filter((p) => p.pricePerBase > 0).length;
  titleBlock(
    ws,
    'Productos y precios',
    `${sorted.length} productos · ${priced} con precio · Precios sin IVA · Generado el ${fmtDate(todayIso())} con Escandallo Pro`,
    headers.length,
  );
  const headerRow = 4;
  styleHeader(ws, headerRow, headers);
  ws.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 1, topLeftCell: `B${headerRow + 1}` }];
  sorted.forEach((p, i) => {
    const r = headerRow + 1 + i;
    const values: [Cell['value'], string?][] = [
      [p.name],
      [CATEGORY_LABELS[p.category]?.label ?? p.category],
      [p.supplierId ? (supplierById.get(p.supplierId)?.name ?? '') : ''],
      [p.baseUnit],
      [p.pricePerBase > 0 ? p.pricePerBase : '', FMT_EUR_PRECISE],
      [PRICE_SOURCE_LABELS[p.priceSource] ?? p.priceSource],
      [isoToDate(p.lastPurchaseDate) ?? '', FMT_DATE],
      [p.purchaseVatPct != null ? p.purchaseVatPct / 100 : '', '0%'],
      [p.wastePct / 100, FMT_PCT],
      [p.cookingLossPct / 100, FMT_PCT],
      [num(p.unitWeightKg) ?? '', FMT_QTY],
      [num(p.densityKgPerL) ?? '', FMT_QTY],
      [allergenText(p.allergens)],
      [p.aliases.join(' · ')],
      [p.notes ?? ''],
    ];
    const row = ws.getRow(r);
    values.forEach(([v, fmt], col) => {
      const c = row.getCell(col + 1);
      c.value = v;
      styleBody(c, fmt);
    });
    row.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK } };
    if (!(p.pricePerBase > 0)) row.getCell(5).fill = solid(STATUS_COLORS.warn.fill);
  });
  const last = headerRow + Math.max(sorted.length, 1);
  if (!sorted.length) ws.getCell(headerRow + 1, 1).value = 'Todavía no hay productos';
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: last, column: headers.length } };

  // ── Proveedores ──
  const sup = wb.addWorksheet('Proveedores', { properties: { tabColor: { argb: 'FF0EA5E9' } } });
  const supHeaders = ['Proveedor', 'CIF/NIF', 'Teléfono', 'Email', 'Nº de productos', 'Notas'];
  setWidths(sup, [34, 14, 16, 30, 14, 40]);
  titleBlock(sup, 'Proveedores', `${suppliers.length} proveedores`, supHeaders.length);
  styleHeader(sup, headerRow, supHeaders);
  sup.views = [{ state: 'frozen', ySplit: headerRow }];
  const countBySupplier = new Map<string, number>();
  for (const p of products) if (p.supplierId) countBySupplier.set(p.supplierId, (countBySupplier.get(p.supplierId) ?? 0) + 1);
  [...suppliers]
    .sort((a, b) => collator.compare(a.name, b.name))
    .forEach((s, i) => {
      const row = sup.getRow(headerRow + 1 + i);
      const values: [Cell['value'], string?][] = [
        [s.name],
        [s.taxId ?? ''],
        [s.phone ?? ''],
        [s.email ?? ''],
        [countBySupplier.get(s.id) ?? 0, FMT_INT],
        [s.notes ?? ''],
      ];
      values.forEach(([v, fmt], col) => {
        const c = row.getCell(col + 1);
        c.value = v;
        styleBody(c, fmt);
      });
    });
  sup.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + Math.max(suppliers.length, 1), column: supHeaders.length } };

  return toBlob(wb);
}

