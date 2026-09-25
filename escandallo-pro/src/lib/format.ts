/** Formateadores es-ES compartidos por toda la UI. */

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur4 = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const num = (d: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: d });

/** 12,50 € */
export function fmtEur(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return eur.format(v);
}

/** Precio unitario con hasta 4 decimales: 0,0385 € */
export function fmtEurPrecise(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return eur4.format(v);
}

/** 28,4 % */
export function fmtPct(v: number | undefined | null, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${num(decimals).format(v)} %`;
}

export function fmtNum(v: number | undefined | null, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return num(decimals).format(v);
}

/** Peso legible a partir de kg: 0.185 → "185 g", 2.5 → "2,5 kg". */
export function fmtKg(kg: number | undefined | null): string {
  if (kg == null || !Number.isFinite(kg)) return '—';
  const a = Math.abs(kg);
  if (a < 1) return `${num(a < 0.01 ? 1 : 0).format(kg * 1000)} g`;
  return `${num(2).format(kg)} kg`;
}

/** Cantidad en unidad base legible: (0.25,'l') → "250 ml", (3,'ud') → "3 ud". */
export function fmtBaseQty(qty: number | undefined | null, unit: 'kg' | 'l' | 'ud' | undefined): string {
  if (qty == null || !Number.isFinite(qty)) return '—';
  if (unit === 'kg') return fmtKg(qty);
  if (unit === 'l') {
    const a = Math.abs(qty);
    if (a < 1) return `${num(0).format(qty * 1000)} ml`;
    return `${num(2).format(qty)} l`;
  }
  return `${num(2).format(qty)} ud`;
}

/** "€/kg", "€/l", "€/ud" */
export function perUnitLabel(unit: 'kg' | 'l' | 'ud' | undefined): string {
  return unit ? `€/${unit}` : '€';
}

export function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}
