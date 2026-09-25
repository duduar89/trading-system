import { describe, expect, it } from 'vitest';
import { daysSince, greetingFor, longDate, monthKey, monthLabel, prevMonth, relativeDays, shortDay } from './dates';

describe('greetingFor', () => {
  it('usa los horarios habituales en España', () => {
    expect(greetingFor(new Date(2026, 8, 25, 7, 0))).toBe('Buenos días');
    expect(greetingFor(new Date(2026, 8, 25, 13, 59))).toBe('Buenos días');
    expect(greetingFor(new Date(2026, 8, 25, 14, 0))).toBe('Buenas tardes');
    expect(greetingFor(new Date(2026, 8, 25, 20, 59))).toBe('Buenas tardes');
    expect(greetingFor(new Date(2026, 8, 25, 21, 0))).toBe('Buenas noches');
    expect(greetingFor(new Date(2026, 8, 25, 2, 30))).toBe('Buenas noches');
  });
});

describe('longDate', () => {
  it('capitaliza el día de la semana y omite el año actual', () => {
    expect(longDate(new Date(2026, 8, 25))).toBe('Viernes, 25 de septiembre');
  });
  it('añade el año si no es el de referencia', () => {
    expect(longDate(new Date(2025, 0, 1), new Date(2026, 8, 25))).toBe('Miércoles, 1 de enero de 2025');
  });
});

describe('meses', () => {
  it('monthKey rellena con ceros', () => {
    expect(monthKey(new Date(2026, 0, 31))).toBe('2026-01');
    expect(monthKey(new Date(2026, 11, 1))).toBe('2026-12');
  });
  it('prevMonth cruza el año', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(prevMonth('2026-10')).toBe('2026-09');
    expect(prevMonth('basura')).toBe('basura');
  });
  it('monthLabel en sus tres estilos', () => {
    expect(monthLabel('2026-09')).toBe('sep 26');
    expect(monthLabel('2026-09', 'long')).toBe('septiembre 2026');
    expect(monthLabel('2026-12-03', 'month')).toBe('dic');
    expect(monthLabel('2026-13')).toBe('2026-13');
  });
  it('shortDay', () => {
    expect(shortDay('2026-03-07')).toBe('7 mar');
    expect(shortDay('x')).toBe('x');
  });
});

describe('fechas relativas', () => {
  const now = new Date(2026, 8, 25, 18, 0);
  it('daysSince', () => {
    expect(daysSince('2026-09-25', now)).toBe(0);
    expect(daysSince('2026-09-20', now)).toBe(5);
    expect(daysSince(undefined, now)).toBeUndefined();
    expect(daysSince('no-fecha', now)).toBeUndefined();
    expect(daysSince('2026-10-01', now)).toBe(0);
  });
  it('relativeDays', () => {
    expect(relativeDays('2026-09-25', now)).toBe('hoy');
    expect(relativeDays('2026-09-24', now)).toBe('ayer');
    expect(relativeDays('2026-09-15', now)).toBe('hace 10 días');
    expect(relativeDays('2026-08-28', now)).toBe('hace 4 semanas');
    expect(relativeDays('2026-05-01', now)).toBe('hace 4 meses');
    expect(relativeDays('2023-05-01', now)).toBe('hace 3 años');
  });
});
