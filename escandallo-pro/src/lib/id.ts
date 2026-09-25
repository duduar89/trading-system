/** Identificador único corto y ordenable por tiempo. */
export function uid(): string {
  const t = Date.now().toString(36);
  const r =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 9)
      : Math.random().toString(36).slice(2, 11);
  return `${t}${r}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Fecha de hoy en formato YYYY-MM-DD (hora local). */
export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
