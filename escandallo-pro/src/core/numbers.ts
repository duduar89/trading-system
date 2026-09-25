import { todo } from '../lib/todo';

/**
 * Números y fechas en formato español (y tolerante a formato anglosajón).
 */

/**
 * Convierte un texto numérico a number. Soporta: "1.234,56", "1234,56", "12,5", "12.50", "1,234.56",
 * "-3,2", "3,20 €", "€ 3.20", "21%", "0,0385", "1.000" (→ 1000, miles), "1.5" (→ 1.5).
 * Regla de ambigüedad con un único separador: si hay exactamente 3 dígitos tras un "." y ninguna ",",
 * es separador de miles ("1.000" → 1000); tras "," siempre es decimal ("1,000" → 1).
 * Devuelve undefined si no es un número.
 */
export function parseNumberEs(raw: string | number | null | undefined): number | undefined {
  void raw;
  return todo('parseNumberEs');
}

export interface NumberToken {
  value: number;
  raw: string;
  start: number;
  end: number;
  isPercent: boolean;
  isCurrency: boolean;
}

/** Encuentra todos los números de una línea de texto, en orden, con su posición. */
export function findNumbers(text: string): NumberToken[] {
  void text;
  return todo('findNumbers');
}

/**
 * Interpreta una fecha española y la devuelve como YYYY-MM-DD. Soporta "12/03/2025", "12-03-25",
 * "12.03.2025", "2025-03-12", "12 de marzo de 2025", "12 mar 2025", "12-MAR-2025". Años de 2 dígitos → 20xx.
 * Devuelve undefined si no es una fecha válida.
 */
export function parseDateEs(raw: string): string | undefined {
  void raw;
  return todo('parseDateEs');
}

/** Busca la primera fecha plausible dentro de un texto largo. */
export function findDate(text: string): string | undefined {
  void text;
  return todo('findDate');
}

export function round(v: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((v + Number.EPSILON) * f) / f;
}

/** Igualdad aproximada para validar importes: |a−b| ≤ max(tolAbs, tolRel·max(|a|,|b|)). */
export function approxEqual(a: number, b: number, tolAbs = 0.02, tolRel = 0.01): boolean {
  return Math.abs(a - b) <= Math.max(tolAbs, tolRel * Math.max(Math.abs(a), Math.abs(b)));
}
