import { useMemo, useSyncExternalStore } from 'react';
import type { FoodCostStatus } from '../../core/costing';

/**
 * Colores para gráficos (recharts pinta SVG con colores explícitos, así que resolvemos los tokens del tema
 * a valores reales y los recalculamos cuando cambia la clase `.dark` de <html>).
 */

/** Colores de marca y estado: fijos en ambos temas (ver src/index.css). */
export const FIXED_COLORS = {
  brand: '#ff5a1f',
  brandSoft: '#ffa274',
  ok: '#10b981',
  warn: '#f59e0b',
  bad: '#f43f5e',
  info: '#3b82f6',
  ai: '#8b5cf6',
} as const;

export interface ChartTheme {
  dark: boolean;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  lineStrong: string;
  surface: string;
  surface2: string;
  elevated: string;
  brand: string;
  brandSoft: string;
  ok: string;
  warn: string;
  bad: string;
  info: string;
  ai: string;
  /** Color de las barras "sin dato" o de contexto (de-énfasis). */
  neutral: string;
}

const LIGHT = {
  ink: '#0b0f14',
  ink2: '#2a3441',
  muted: '#677486',
  line: '#e6e9ee',
  lineStrong: '#d3d8e0',
  surface: '#ffffff',
  surface2: '#f8f9fb',
  elevated: '#ffffff',
};
const DARK = {
  ink: '#f3f5f8',
  ink2: '#c9d1dc',
  muted: '#8a97a8',
  line: '#222c39',
  lineStrong: '#2e3a4a',
  surface: '#121821',
  surface2: '#0f141c',
  elevated: '#19212d',
};

function subscribe(cb: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => undefined;
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

function readVar(style: CSSStyleDeclaration | undefined, name: string, fallback: string): string {
  const v = style?.getPropertyValue(name).trim();
  return v || fallback;
}

/** Hook: paleta resuelta del tema activo. */
export function useChartTheme(): ChartTheme {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return useMemo(() => {
    const fb = dark ? DARK : LIGHT;
    const style = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : undefined;
    const t = {
      ink: readVar(style, '--t-ink', fb.ink),
      ink2: readVar(style, '--t-ink-2', fb.ink2),
      muted: readVar(style, '--t-muted', fb.muted),
      line: readVar(style, '--t-line', fb.line),
      lineStrong: readVar(style, '--t-line-strong', fb.lineStrong),
      surface: readVar(style, '--t-surface', fb.surface),
      surface2: readVar(style, '--t-surface-2', fb.surface2),
      elevated: readVar(style, '--t-elevated', fb.elevated),
    };
    return { dark, ...t, ...FIXED_COLORS, neutral: t.lineStrong };
  }, [dark]);
}

/** Color del semáforo de food cost. */
export function statusColor(status: FoodCostStatus, theme: Pick<ChartTheme, 'ok' | 'warn' | 'bad' | 'neutral'>): string {
  if (status === 'ok') return theme.ok;
  if (status === 'warn') return theme.warn;
  if (status === 'bad') return theme.bad;
  return theme.neutral;
}

/** Etiquetas del semáforo para leyendas (el color nunca va solo). */
export const STATUS_LEGEND: Record<Exclude<FoodCostStatus, 'none'>, string> = {
  ok: 'En objetivo',
  warn: 'Atención',
  bad: 'Por encima',
};

/** Formato compacto de euros para ejes: 1.250 € → "1,3 mil €". */
export function fmtEurAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} M€`;
  if (a >= 10_000) return `${Math.round(v / 1000).toLocaleString('es-ES')} mil €`;
  if (a >= 1000) return `${(v / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} mil €`;
  return `${v.toLocaleString('es-ES', { maximumFractionDigits: a < 10 ? 2 : 0 })} €`;
}
