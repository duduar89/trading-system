import { describe, expect, it } from 'vitest';
import {
  comparisonDetail,
  comparisonHint,
  currentPeriodLabel,
  daysInMonth,
  fullMonthComparison,
  inRange,
  monthName,
  monthToDateComparison,
  periodChangePct,
} from './periods';

describe('daysInMonth', () => {
  it('meses de 28, 29, 30 y 31 días', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 8)).toBe(31);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('monthToDateComparison', () => {
  it('día 25 de septiembre: 1–25 sep frente a 1–25 ago', () => {
    const c = monthToDateComparison('2026-09-25')!;
    expect(c.month).toBe('2026-09');
    expect(c.current).toEqual({ from: '2026-09-01', to: '2026-09-25' });
    expect(c.previousMonth).toBe('2026-08');
    expect(c.previous).toEqual({ from: '2026-08-01', to: '2026-08-25' });
    expect(c.days).toBe(25);
    expect(c.fullMonth).toBe(false);
  });

  it('primer día del mes: un solo día frente a un solo día', () => {
    const c = monthToDateComparison('2026-10-01')!;
    expect(c.previous).toEqual({ from: '2026-09-01', to: '2026-09-01' });
    expect(c.days).toBe(1);
  });

  it('enero se compara con diciembre del año anterior', () => {
    const c = monthToDateComparison('2027-01-12')!;
    expect(c.previousMonth).toBe('2026-12');
    expect(c.previous).toEqual({ from: '2026-12-01', to: '2026-12-12' });
  });

  it('el mes anterior más corto se toma entero como tope (30 de marzo frente a todo febrero)', () => {
    const c = monthToDateComparison('2026-03-30')!;
    expect(c.previous).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(c.days).toBe(28);
    expect(c.fullMonth).toBe(false);
    // Bisiesto
    expect(monthToDateComparison('2028-03-29')!.previous.to).toBe('2028-02-29');
  });

  it('último día del mes: meses completos aunque el anterior sea más largo', () => {
    const c = monthToDateComparison('2026-09-30')!;
    expect(c.fullMonth).toBe(true);
    expect(c.previous).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(c.days).toBe(31);
    const feb = monthToDateComparison('2026-02-28')!;
    expect(feb.fullMonth).toBe(true);
    expect(feb.previous.to).toBe('2026-01-31');
  });

  it('acepta un timestamp ISO y rechaza fechas inválidas', () => {
    expect(monthToDateComparison('2026-09-25T23:59:00.000Z')!.previous.to).toBe('2026-08-25');
    expect(monthToDateComparison('2026-09')).toBeUndefined();
    expect(monthToDateComparison('2026-02-30')).toBeUndefined();
    expect(monthToDateComparison('2026-13-01')).toBeUndefined();
    expect(monthToDateComparison('basura')).toBeUndefined();
  });
});

describe('fullMonthComparison', () => {
  it('mes cerrado frente al anterior completo', () => {
    const c = fullMonthComparison('2026-03')!;
    expect(c.current).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(c.previous).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(c.fullMonth).toBe(true);
    expect(fullMonthComparison('2026-01')!.previousMonth).toBe('2025-12');
    expect(fullMonthComparison('x')).toBeUndefined();
  });
});

describe('inRange', () => {
  const r = { from: '2026-08-01', to: '2026-08-25' };
  it('incluye los extremos e ignora la hora', () => {
    expect(inRange('2026-08-01', r)).toBe(true);
    expect(inRange('2026-08-25', r)).toBe(true);
    expect(inRange('2026-08-25T22:00:00Z', r)).toBe(true);
    expect(inRange('2026-08-26', r)).toBe(false);
    expect(inRange('2026-07-31', r)).toBe(false);
    expect(inRange(undefined, r)).toBe(false);
    expect(inRange('26/08/2026', r)).toBe(false);
  });
});

describe('textos', () => {
  it('pista de la comparación', () => {
    expect(comparisonHint(monthToDateComparison('2026-09-25')!)).toBe('frente al mismo periodo de agosto');
    expect(comparisonHint(monthToDateComparison('2026-09-30')!)).toBe('frente a agosto');
    expect(comparisonHint(fullMonthComparison('2026-08')!)).toBe('frente a julio');
    expect(comparisonHint(monthToDateComparison('2027-01-10')!)).toBe('frente al mismo periodo de diciembre de 2026');
  });
  it('detalle del periodo', () => {
    expect(comparisonDetail(monthToDateComparison('2026-09-25')!)).toBe('Del 1 al 25 de septiembre frente al 1 al 25 de agosto');
    expect(comparisonDetail(monthToDateComparison('2026-03-30')!)).toBe('Del 1 al 30 de marzo frente al 1 al 28 de febrero');
    expect(comparisonDetail(fullMonthComparison('2026-08')!)).toBe('Todo agosto frente a todo julio');
  });
  it('periodo medido', () => {
    expect(currentPeriodLabel(monthToDateComparison('2026-09-25')!)).toBe('del 1 al 25 de septiembre');
    expect(currentPeriodLabel(monthToDateComparison('2026-09-01')!)).toBe('el 1 de septiembre');
    expect(currentPeriodLabel(monthToDateComparison('2026-09-30')!)).toBe('septiembre');
    expect(currentPeriodLabel(fullMonthComparison('2026-08')!)).toBe('agosto');
  });
  it('nombre del mes', () => {
    expect(monthName('2026-08')).toBe('agosto');
    expect(monthName('2025-12', '2026-01')).toBe('diciembre de 2025');
    expect(monthName('raro')).toBe('raro');
  });
});

describe('periodChangePct', () => {
  it('variación sólo con base de comparación', () => {
    expect(periodChangePct(100, 150)).toBeCloseTo(50);
    expect(periodChangePct(200, 150)).toBeCloseTo(-25);
    expect(periodChangePct(0, 150)).toBeUndefined();
    expect(periodChangePct(undefined, 150)).toBeUndefined();
    expect(periodChangePct(100, Number.NaN)).toBeUndefined();
  });
});
