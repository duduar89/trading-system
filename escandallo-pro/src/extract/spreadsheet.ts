import type { ExtractedInvoice } from '../types';
import { todo } from '../lib/todo';

/**
 * Importación de listados de facturas / tarifas en Excel (.xlsx) o CSV (usa exceljs con import dinámico; CSV propio con
 * detección de separador ; , \t y comillas).
 */

export type Cell = string | number | null;

export interface SheetData {
  name: string;
  rows: Cell[][];
}

export async function readSpreadsheet(file: Blob, fileName: string): Promise<SheetData[]> {
  void file;
  void fileName;
  return todo('readSpreadsheet');
}

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

/** Detecta la fila de cabecera y a qué columna corresponde cada campo (por nombres ES/EN habituales y por tipo de datos). */
export function guessColumnMapping(rows: Cell[][]): { headerRow: number; mapping: ColumnMapping; confidence: number } {
  void rows;
  return todo('guessColumnMapping');
}

/**
 * Convierte filas en facturas. Si hay columnas de proveedor / nº factura / fecha, agrupa por ellas (un listado de
 * muchas facturas); si no, devuelve una sola factura. Las líneas salen normalizadas (core/pack) con método 'hoja'.
 */
export function sheetToInvoices(rows: Cell[][], mapping: ColumnMapping, headerRow: number, defaults?: { supplierName?: string; date?: string }): ExtractedInvoice[] {
  void rows;
  void mapping;
  void headerRow;
  void defaults;
  return todo('sheetToInvoices');
}
