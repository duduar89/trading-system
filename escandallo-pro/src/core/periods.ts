/**
 * Periodos de comparación para los indicadores de gasto.
 *
 * Comparar el mes en curso con el mes anterior COMPLETO engaña: el día 25 se comparan 25 días con 31 («▲ 189 %» con
 * compras normales) y el día 3 parece que el gasto se ha desplomado. Lo correcto es comparar el mes hasta hoy con el
 * mismo periodo del mes anterior (del día 1 al mismo día). Todo en fechas de negocio 'YYYY-MM-DD', sin husos horarios.
 */

const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Rango de fechas de negocio, ambos extremos incluidos ('YYYY-MM-DD'). */
export interface DateRange {
  from: string;
  to: string;
}

export interface PeriodComparison {
  /** Mes que se mide ('YYYY-MM'). */
  month: string;
  /** Periodo medido: del día 1 al día de corte (o el mes entero si está cerrado). */
  current: DateRange;
  /** Mes con el que se compara ('YYYY-MM'). */
  previousMonth: string;
  /** Mismo periodo del mes anterior. */
  previous: DateRange;
  /** Días que abarca el periodo anterior. */
  days: number;
  /**
   * true si se comparan meses completos: el mes medido ya ha terminado o hoy es su último día (y entonces el anterior
   * se toma entero aunque tenga más días: 30 de septiembre frente a todo agosto).
   */
  fullMonth: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parseYmd(iso: string): { y: number; m: number; d: number } | undefined {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso);
  if (!match) return undefined;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = match[3] ? Number(match[3]) : 1;
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= daysInMonth(y, m))) return undefined;
  return { y, m, d };
}

/** Días del mes (1–12), con bisiestos. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shift(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** true si la fecha de negocio (se ignora la hora) está dentro del rango. */
export function inRange(date: string | undefined, range: DateRange): boolean {
  if (!date) return false;
  const day = date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day >= range.from && day <= range.to;
}

/**
 * Mes en curso hasta `today` frente al mismo periodo del mes anterior.
 *  - Día 25 de septiembre → 1–25 sep frente a 1–25 ago.
 *  - 31 de marzo → 1–31 mar frente a todo febrero (28/29 días): no hay más febrero con el que comparar.
 *  - Último día del mes (30 de septiembre) → se comparan meses completos (todo agosto, 31 días).
 * Devuelve undefined si `today` no es una fecha válida.
 */
export function monthToDateComparison(today: string): PeriodComparison | undefined {
  const t = parseYmd(today);
  if (!t || today.length < 10) return undefined;
  const p = shift(t.y, t.m, -1);
  const prevDays = daysInMonth(p.y, p.m);
  const fullMonth = t.d >= daysInMonth(t.y, t.m);
  const days = fullMonth ? prevDays : Math.min(t.d, prevDays);
  return {
    month: `${t.y}-${pad(t.m)}`,
    current: { from: ymd(t.y, t.m, 1), to: ymd(t.y, t.m, t.d) },
    previousMonth: `${p.y}-${pad(p.m)}`,
    previous: { from: ymd(p.y, p.m, 1), to: ymd(p.y, p.m, days) },
    days,
    fullMonth,
  };
}

/** Un mes ya cerrado ('YYYY-MM') frente al mes anterior completo. */
export function fullMonthComparison(month: string): PeriodComparison | undefined {
  const t = parseYmd(month);
  if (!t) return undefined;
  const p = shift(t.y, t.m, -1);
  const prevDays = daysInMonth(p.y, p.m);
  return {
    month: `${t.y}-${pad(t.m)}`,
    current: { from: ymd(t.y, t.m, 1), to: ymd(t.y, t.m, daysInMonth(t.y, t.m)) },
    previousMonth: `${p.y}-${pad(p.m)}`,
    previous: { from: ymd(p.y, p.m, 1), to: ymd(p.y, p.m, prevDays) },
    days: prevDays,
    fullMonth: true,
  };
}

/** Nombre del mes en minúscula ('2026-08' → "agosto"); con año si no coincide con el de `refMonth`. */
export function monthName(month: string, refMonth?: string): string {
  const t = parseYmd(month);
  if (!t) return month;
  const name = MONTHS_LONG[t.m - 1]!;
  return refMonth && refMonth.slice(0, 4) !== String(t.y) ? `${name} de ${t.y}` : name;
}

/**
 * Texto de la comparación para las pistas de los indicadores:
 * "frente al mismo periodo de agosto" (mes en curso) o "frente a agosto" (meses completos).
 * Cruzando el año se añade el año: "frente al mismo periodo de diciembre de 2025".
 */
export function comparisonHint(c: PeriodComparison): string {
  const name = monthName(c.previousMonth, c.month);
  return c.fullMonth ? `frente a ${name}` : `frente al mismo periodo de ${name}`;
}

/** Detalle del periodo comparado para un `title`: "Del 1 al 25 de septiembre frente al 1 al 25 de agosto". */
export function comparisonDetail(c: PeriodComparison): string {
  const cur = parseYmd(c.current.to)!;
  const prev = parseYmd(c.previous.to)!;
  if (c.fullMonth) return `Todo ${monthName(c.month)} frente a todo ${monthName(c.previousMonth, c.month)}`;
  return `Del 1 al ${cur.d} de ${monthName(c.month)} frente al 1 al ${prev.d} de ${monthName(c.previousMonth, c.month)}`;
}

/** Periodo medido en texto: "del 1 al 27 de septiembre" (mes en curso) o "septiembre" (mes cerrado). */
export function currentPeriodLabel(c: PeriodComparison): string {
  const cur = parseYmd(c.current.to)!;
  const lastDay = daysInMonth(cur.y, cur.m);
  if (cur.d >= lastDay) return monthName(c.month);
  return cur.d === 1 ? `el 1 de ${monthName(c.month)}` : `del 1 al ${cur.d} de ${monthName(c.month)}`;
}

/**
 * Variación porcentual entre dos importes del mismo periodo. undefined si no hay base de comparación
 * (periodo anterior sin gasto) o algún importe no es válido.
 */
export function periodChangePct(previous: number | undefined, current: number | undefined): number | undefined {
  if (previous == null || current == null || !Number.isFinite(previous) || !Number.isFinite(current) || previous <= 0) return undefined;
  return ((current - previous) / previous) * 100;
}
