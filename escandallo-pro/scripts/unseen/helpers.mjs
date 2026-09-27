/**
 * Utilidades del conjunto de prueba «unseen» (documentos que el parser no ha visto nunca).
 *
 * Los importes se calculan UNA vez a partir de los datos (cantidad × precio × (1 − dto)) con redondeo comercial y
 * esos mismos valores se imprimen en el HTML y se escriben en expected.json: la verdad de referencia nunca sale de la
 * salida del parser.
 */

/** Redondeo comercial a 2 decimales (mitad hacia arriba en valor absoluto). */
export function r2(x) {
  return (Math.sign(x) * Math.round((Math.abs(x) + 1e-9) * 100)) / 100;
}

/** Número en formato español: 1234.5 → "1.234,50". */
export function fmt(v, dec = 2, { thousands = true, plus = false } = {}) {
  const neg = v < 0;
  const s = Math.abs(v).toFixed(dec);
  let [i, d] = s.split('.');
  if (thousands) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : plus ? '+' : ''}${i}${d ? `,${d}` : ''}`;
}

/** CIF con su carácter de control correcto: cif('B', '4612345') → "B46123450". */
export function cif(letter, seven) {
  let sum = 0;
  for (let k = 0; k < 7; k++) {
    const d = Number(seven[k]);
    if (k % 2 === 0) {
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    } else sum += d;
  }
  const control = (10 - (sum % 10)) % 10;
  const c = 'PQRSNW'.includes(letter) ? 'JABCDEFGHI'[control] : String(control);
  return `${letter}${seven}${c}`;
}

/** NIF de persona física con su letra: nif('12345678') → "12345678Z". */
export function nif(eight) {
  return `${eight}${'TRWAGMYFPDXBNJZSQVHLCKE'[Number(eight) % 23]}`;
}

/** Importe de una línea: cantidad × precio × (1 − dto1) × (1 − dto2). */
export function lineTotal(l) {
  return r2(l.qty * l.price * (1 - (l.dto ?? 0) / 100) * (1 - (l.dto2 ?? 0) / 100));
}

/** Descuento combinado de dos descuentos en cascada (%). */
export function combinedDiscount(l) {
  if (!l.dto && !l.dto2) return undefined;
  return r2((1 - (1 - (l.dto ?? 0) / 100) * (1 - (l.dto2 ?? 0) / 100)) * 100);
}

/**
 * Completa las líneas (importe) y calcula el desglose de IVA, la base, la cuota y el total.
 * `globalDiscountPct`: descuento por pronto pago sobre la base de cada tipo.
 */
export function computeTotals(lines, { globalDiscountPct = 0 } = {}) {
  for (const l of lines) l.total = lineTotal(l);
  const rates = [...new Set(lines.map((l) => l.vat))].sort((a, b) => a - b);
  const gross = r2(lines.reduce((s, l) => s + l.total, 0));
  const breakdown = rates.map((rate) => {
    const sumRate = r2(lines.filter((l) => l.vat === rate).reduce((s, l) => s + l.total, 0));
    const base = r2(sumRate * (1 - globalDiscountPct / 100));
    return { rate, gross: sumRate, base, vat: r2((base * rate) / 100) };
  });
  const subtotal = r2(breakdown.reduce((s, b) => s + b.base, 0));
  const vatTotal = r2(breakdown.reduce((s, b) => s + b.vat, 0));
  return { gross, discount: r2(gross - subtotal), breakdown, subtotal, vatTotal, total: r2(subtotal + vatTotal) };
}

/** Descripción impresa de una línea (una o varias filas) unida con espacios. */
export function descText(l) {
  return Array.isArray(l.desc) ? l.desc.join(' ') : l.desc;
}

/** expected.json de una factura a partir de los mismos datos con que se imprime. */
export function invoiceExpected({ id, features, supplier, number, date, lines, totals }) {
  const products = lines.filter((l) => !l.extra);
  const extras = lines.filter((l) => l.extra);
  return {
    id,
    kind: 'invoice',
    features,
    header: {
      supplierName: supplier.name,
      supplierTaxId: supplier.cif,
      number,
      date,
      subtotal: totals.subtotal,
      vatTotal: totals.vatTotal,
      total: totals.total,
    },
    lines: products.map((l) => {
      const out = { description: descText(l) };
      if (l.code) out.code = l.code;
      out.quantity = l.qty;
      out.unit = l.unit ?? 'ud';
      out.unitPrice = l.price;
      const d = combinedDiscount(l);
      if (d !== undefined) out.discountPct = d;
      out.total = l.total;
      if (l.vat !== undefined) out.vatPct = l.vat;
      return out;
    }),
    extras: extras.map((l) => ({ description: descText(l), amount: l.total })),
  };
}

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
