/**
 * Utilidades de fecha para el panel e informes (deterministas: no dependen del ICU del navegador).
 */

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Saludo según la hora local, con los horarios habituales en España (la tarde empieza después de comer). */
export function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h >= 6 && h < 14) return 'Buenos días';
  if (h >= 14 && h < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

/** "Viernes, 25 de septiembre" (con año si no es el actual respecto a `ref`). */
export function longDate(date: Date, ref: Date = date): string {
  const base = `${WEEKDAYS[date.getDay()]}, ${date.getDate()} de ${MONTHS_LONG[date.getMonth()]}`;
  const text = date.getFullYear() === ref.getFullYear() ? base : `${base} de ${date.getFullYear()}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Clave de mes 'YYYY-MM' de una fecha local. */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonth(ym: string): { y: number; m: number } | undefined {
  const match = /^(\d{4})-(\d{2})/.exec(ym);
  if (!match) return undefined;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (!(m >= 1 && m <= 12)) return undefined;
  return { y, m };
}

/** Mes anterior: '2026-01' → '2025-12'. */
export function prevMonth(ym: string): string {
  const p = parseMonth(ym);
  if (!p) return ym;
  const y = p.m === 1 ? p.y - 1 : p.y;
  const m = p.m === 1 ? 12 : p.m - 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Etiqueta de mes: 'short' → "sep 26", 'long' → "septiembre 2026", 'month' → "sep".
 * Acepta también fechas completas 'YYYY-MM-DD'.
 */
export function monthLabel(ym: string, style: 'short' | 'long' | 'month' = 'short'): string {
  const p = parseMonth(ym);
  if (!p) return ym;
  if (style === 'long') return `${MONTHS_LONG[p.m - 1]} ${p.y}`;
  if (style === 'month') return MONTHS_SHORT[p.m - 1]!;
  return `${MONTHS_SHORT[p.m - 1]} ${String(p.y).slice(2)}`;
}

/** "25 sep" a partir de 'YYYY-MM-DD' (para ejes de gráficos). */
export function shortDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const m = Number(match[2]);
  return `${Number(match[3])} ${MONTHS_SHORT[m - 1] ?? ''}`.trim();
}

/** Días transcurridos entre una fecha 'YYYY-MM-DD' (o ISO) y `now` (redondeado hacia abajo, mínimo 0). */
export function daysSince(iso: string | undefined, now: Date = new Date()): number | undefined {
  if (!iso) return undefined;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}

/** "hoy", "ayer", "hace 5 días", "hace 3 semanas", "hace 2 meses". */
export function relativeDays(iso: string | undefined, now: Date = new Date()): string {
  const d = daysSince(iso, now);
  if (d == null) return '—';
  if (d === 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 14) return `hace ${d} días`;
  if (d < 60) return `hace ${Math.floor(d / 7)} semanas`;
  if (d < 730) return `hace ${Math.floor(d / 30)} meses`;
  return `hace ${Math.floor(d / 365)} años`;
}
