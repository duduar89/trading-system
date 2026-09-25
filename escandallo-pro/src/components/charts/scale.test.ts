import { describe, expect, it } from 'vitest';
import { niceScale } from './TrendLine';
import { fmtEurAxis } from './theme';

describe('niceScale', () => {
  it('genera marcas redondas que cubren el rango', () => {
    const { domain, ticks } = niceScale(4.26, 4.96, 4);
    expect(ticks).toEqual([4.2, 4.4, 4.6, 4.8, 5]);
    expect(domain).toEqual([4.2, 5]);
  });
  it('funciona con rangos grandes y degenerados', () => {
    expect(niceScale(0, 2263, 4).ticks).toEqual([0, 1000, 2000, 3000]);
    const flat = niceScale(10, 10, 4);
    expect(flat.ticks[0]).toBeLessThanOrEqual(10);
    expect(flat.ticks[flat.ticks.length - 1]).toBeGreaterThanOrEqual(10);
  });
});

describe('fmtEurAxis', () => {
  it('compacta miles y millones', () => {
    expect(fmtEurAxis(600)).toBe('600 €');
    expect(fmtEurAxis(1800)).toBe('1,8 mil €');
    expect(fmtEurAxis(24000)).toBe('24 mil €');
    expect(fmtEurAxis(2_500_000)).toBe('2,5 M€');
    expect(fmtEurAxis(4.5)).toBe('4,5 €');
  });
});
