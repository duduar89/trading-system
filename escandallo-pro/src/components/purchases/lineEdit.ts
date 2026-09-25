import type { InvoiceLine } from '../../types';
import { normalizeInvoiceLine } from '../../core/pack';
import { cleanProductName } from '../../core/matching';
import { applyLinePatch } from './logic';

const PRICE_FIELDS: (keyof InvoiceLine)[] = ['description', 'quantity', 'unit', 'unitPrice', 'discountPct', 'total', 'packSize'];

function tryNormalize(line: InvoiceLine): InvoiceLine | undefined {
  try {
    return normalizeInvoiceLine(line);
  } catch {
    return undefined;
  }
}

function tryClean(description: string): string | undefined {
  try {
    return cleanProductName(description) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Aplica una edición de la revisión y recalcula en vivo el €/ud base (core/pack.normalizeInvoiceLine).
 *  - Mantiene cantidad × precio = importe (ver applyLinePatch).
 *  - Si cambia la descripción y el formato no se fijó a mano, se vuelve a detectar el envase.
 *  - En líneas nuevas, el nombre propuesto sigue a la descripción mientras el usuario no lo haya personalizado.
 */
export function recomputeLine(line: InvoiceLine, patch: Partial<InvoiceLine>, packManual: boolean): InvoiceLine {
  let next = applyLinePatch(line, patch);
  if ('description' in patch && next.matchStatus === 'nuevo') {
    const autoName = tryClean(line.description);
    if (!line.suggestedName || line.suggestedName === autoName) {
      const fresh = tryClean(next.description);
      if (fresh) next = { ...next, suggestedName: fresh };
    }
  }
  if (!PRICE_FIELDS.some((k) => k in patch)) return next;
  if ('description' in patch && !packManual) {
    const redetected = tryNormalize({ ...next, packSize: undefined });
    if (redetected) return redetected;
  }
  return tryNormalize(next) ?? next;
}
