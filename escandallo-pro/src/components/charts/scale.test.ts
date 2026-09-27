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
  // Espacios duros (\u00a0) para que el eje no parta la etiqueta en dos líneas.
  const sp = (s: string) => s.replace(/ /g, '\u00a0');
  it('compacta miles y millones', () => {
    expect(fmtEurAxis(600)).toBe(sp('600 €'));
    expect(fmtEurAxis(1800)).toBe(sp('1,8 mil €'));
    expect(fmtEurAxis(24000)).toBe(sp('24 mil €'));
    expect(fmtEurAxis(2_500_000)).toBe(sp('2,5 M€'));
    expect(fmtEurAxis(4.5)).toBe(sp('4,5 €'));
  });
  it('no redondea las marcas intermedias a otra cifra (2.250 € no es «2,3 mil €») ni las parte en dos líneas', () => {
    expect(fmtEurAxis(2250)).toBe(sp('2,25 mil €'));
    expect(fmtEurAxis(12_500)).toBe(sp('12,5 mil €'));
    expect(fmtEurAxis(2_250_000)).toBe(sp('2,25 M€'));
    expect(fmtEurAxis(2250)).not.toContain(' ');
  });
});
