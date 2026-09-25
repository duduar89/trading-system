/**
 * Lógica pura de Ajustes: validación de parámetros de negocio, copias de seguridad y utilidades de texto.
 */
import type { BusinessSettings } from '../../types';
import type { WorkspaceBackup } from '../../db';

export type BusinessDraft = {
  targetFoodCostPct?: number;
  warningFoodCostPct?: number;
  defaultSaleVatPct?: number;
  priceAlertPct?: number;
  priceRounding?: number;
};

export type BusinessErrors = Partial<Record<keyof BusinessDraft, string>>;

export const ROUNDING_OPTIONS: { value: number; label: string; example: string }[] = [
  { value: 0.05, label: 'Céntimos de 5 en 5', example: '12,35 €' },
  { value: 0.1, label: 'Múltiplos de 0,10 €', example: '12,40 €' },
  { value: 0.5, label: 'Múltiplos de 0,50 €', example: '12,50 €' },
  { value: 1, label: 'Euros enteros', example: '13,00 €' },
];

/** Valida el borrador de ajustes de negocio. Devuelve un mensaje por campo con problemas. */
export function validateBusinessDraft(d: BusinessDraft): BusinessErrors {
  const e: BusinessErrors = {};
  const t = d.targetFoodCostPct;
  const w = d.warningFoodCostPct;
  if (t == null || !Number.isFinite(t)) e.targetFoodCostPct = 'Indica el food cost objetivo';
  else if (t < 5 || t > 80) e.targetFoodCostPct = 'Debe estar entre 5 % y 80 % (lo habitual es 25–35 %)';
  if (w == null || !Number.isFinite(w)) e.warningFoodCostPct = 'Indica el umbral de atención';
  else if (w > 95) e.warningFoodCostPct = 'Debe ser como máximo 95 %';
  else if (t != null && Number.isFinite(t) && w < t) e.warningFoodCostPct = 'Debe ser igual o mayor que el objetivo';
  const v = d.defaultSaleVatPct;
  if (v == null || !Number.isFinite(v)) e.defaultSaleVatPct = 'Indica el IVA de venta';
  else if (v < 0 || v > 30) e.defaultSaleVatPct = 'Debe estar entre 0 % y 30 % (en hostelería suele ser 10 %)';
  const a = d.priceAlertPct;
  if (a == null || !Number.isFinite(a)) e.priceAlertPct = 'Indica a partir de qué subida avisar';
  else if (a < 0 || a > 100) e.priceAlertPct = 'Debe estar entre 0 % y 100 %';
  const r = d.priceRounding;
  if (r == null || !ROUNDING_OPTIONS.some((o) => Math.abs(o.value - r) < 1e-9)) e.priceRounding = 'Elige un redondeo';
  return e;
}

export function hasErrors(e: BusinessErrors): boolean {
  return Object.values(e).some(Boolean);
}

/** Borrador a partir de los ajustes guardados. */
export function draftFromBusiness(b: BusinessSettings): Required<BusinessDraft> {
  return {
    targetFoodCostPct: b.targetFoodCostPct,
    warningFoodCostPct: b.warningFoodCostPct,
    defaultSaleVatPct: b.defaultSaleVatPct,
    priceAlertPct: b.priceAlertPct,
    priceRounding: b.priceRounding,
  };
}

export function draftDiffers(d: BusinessDraft, b: BusinessSettings): boolean {
  const keys: (keyof BusinessDraft)[] = ['targetFoodCostPct', 'warningFoodCostPct', 'defaultSaleVatPct', 'priceAlertPct', 'priceRounding'];
  return keys.some((k) => {
    const v = d[k];
    return v == null || Math.abs(v - b[k]) > 1e-9;
  });
}

// ───────────────────────────── Copias de seguridad ─────────────────────────────

const BACKUP_TABLES = ['products', 'pricePoints', 'suppliers', 'invoices', 'dishes', 'yieldTests', 'menuScans', 'business'] as const;

export interface BackupSummary {
  name: string;
  exportedAt?: string;
  products: number;
  dishes: number;
  invoices: number;
  yieldTests: number;
}

/**
 * Lee y valida el texto de un archivo de copia de seguridad.
 * Lanza un Error con un mensaje en español si el archivo no es válido.
 */
export function parseBackup(text: string): WorkspaceBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('El archivo no es un JSON válido. Elige una copia exportada desde Escandallo Pro.');
  }
  if (!raw || typeof raw !== 'object') throw new Error('El archivo está vacío o no tiene el formato esperado.');
  const obj = raw as Record<string, unknown>;
  if (obj.format !== 'escandallo-pro-backup') throw new Error('Este archivo no es una copia de seguridad de Escandallo Pro.');
  if (typeof obj.version !== 'number' || obj.version > 1) {
    throw new Error('La copia se hizo con una versión más reciente de la app. Actualiza la app e inténtalo de nuevo.');
  }
  const ws = obj.workspace as Record<string, unknown> | undefined;
  if (!ws || typeof ws !== 'object' || typeof ws.name !== 'string' || !ws.name.trim()) {
    throw new Error('A la copia le falta el nombre del restaurante.');
  }
  const data = obj.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') throw new Error('La copia no contiene datos.');
  for (const t of BACKUP_TABLES) {
    const v = data[t];
    if (v != null && !Array.isArray(v)) throw new Error(`La copia está dañada (la tabla «${t}» no es una lista).`);
  }
  for (const t of BACKUP_TABLES) {
    const list = (data[t] as unknown[] | undefined) ?? [];
    if (list.some((row) => !row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string')) {
      throw new Error(`La copia está dañada (hay registros sin identificador en «${t}»).`);
    }
  }
  return raw as WorkspaceBackup;
}

export function backupSummary(b: WorkspaceBackup): BackupSummary {
  return {
    name: b.workspace.name,
    exportedAt: b.exportedAt,
    products: b.data.products?.length ?? 0,
    dishes: b.data.dishes?.length ?? 0,
    invoices: b.data.invoices?.length ?? 0,
    yieldTests: b.data.yieldTests?.length ?? 0,
  };
}

/** Texto sin tildes, minúsculas y con guiones: "Taberna La Lonja" → "taberna-la-lonja". */
export function slugify(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/ñ/g, 'n')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'restaurante'
  );
}

/** "escandallo-pro_taberna-la-lonja_2026-09-25.json" */
export function backupFileName(workspaceName: string, date: Date = new Date(), ext = 'json'): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `escandallo-pro_${slugify(workspaceName)}_${d}.${ext}`;
}

/** Comparación tolerante para confirmar borrados escribiendo el nombre (ignora mayúsculas, tildes y espacios extra). */
export function confirmNameMatches(input: string, name: string): boolean {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  return norm(input).length > 0 && norm(input) === norm(name);
}

// ───────────────────────────── Clave de IA ─────────────────────────────

/** Formato de las claves de la API de Anthropic ("sk-ant-…"). */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}

/** "sk-ant-api03-…9f2K" */
export function maskApiKey(key: string | undefined): string {
  const k = (key ?? '').trim();
  if (!k) return '';
  if (k.length <= 12) return '•'.repeat(k.length);
  return `${k.slice(0, 10)}…${k.slice(-4)}`;
}

/** Bytes legibles: 1536 → "1,5 KB". */
export function fmtBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const decimals = i === 0 || v >= 100 ? 0 : 1;
  return `${v.toFixed(decimals).replace('.', ',')} ${units[i]}`;
}
