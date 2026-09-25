import { useEffect, useState } from 'react';
import { CircleCheck, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type { YieldOutput, YieldOutputKind } from '../../types';
import { Button, IconButton, Input, NumberInput, Select, cx } from '../ui';
import { YIELD_KIND_LABELS } from '../../lib/labels';
import { fmtKg, fmtPct } from '../../lib/format';
import { uid } from '../../lib/id';
import { QUICK_OUTPUTS, UNASSIGNED_OUTPUT_NAME, remainingKg } from './model';
import { YIELD_VIZ_VARS, fillStyle } from './palette';

const KIND_OPTIONS: YieldOutputKind[] = ['principal', 'subproducto', 'desperdicio'];

/** Etiqueta corta para el desplegable ("Aprovechable (plato)" → "Aprovechable"). */
function shortKindLabel(k: YieldOutputKind): string {
  return YIELD_KIND_LABELS[k].label.replace(/\s*\(.*\)\s*$/, '');
}

/**
 * Tabla editable de salidas de la pieza (lomos, recortes, espinas, piel…).
 * En pantallas anchas es una fila por salida; en estrechas, una tarjeta compacta (container queries).
 */
export function OutputsEditor({
  outputs,
  grossWeightKg,
  thawLossPct,
  onChange,
}: {
  outputs: YieldOutput[];
  grossWeightKg: number;
  thawLossPct?: number;
  onChange: (outputs: YieldOutput[]) => void;
}) {
  const [focusId, setFocusId] = useState<{ id: string; field: 'w' | 'n' } | null>(null);
  const G = Math.max(0, grossWeightKg || 0);
  const available = G * (1 - Math.min(99.9, Math.max(0, thawLossPct ?? 0)) / 100);
  const remaining = remainingKg({ grossWeightKg: G, thawLossPct, outputs });
  const assigned = available - remaining;

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`yo-${focusId.field}-${focusId.id}`) as HTMLInputElement | null;
    if (el) {
      el.focus();
      el.select?.();
    }
    setFocusId(null);
  }, [focusId]);

  const update = (id: string, patch: Partial<YieldOutput>) =>
    onChange(
      outputs.map((o) => {
        if (o.id !== id) return o;
        const next = { ...o, ...patch };
        if (next.kind !== 'subproducto') delete next.valuePerKg;
        return next;
      }),
    );
  const remove = (id: string) => onChange(outputs.filter((o) => o.id !== id));
  const add = (o: Omit<YieldOutput, 'id'>, field: 'w' | 'n' = 'w') => {
    const id = uid();
    onChange([...outputs, { ...o, id }]);
    setFocusId({ id, field });
  };

  function assignRemainingAsWaste() {
    const kg = Math.round(remaining * 1000) / 1000;
    if (!(kg > 0)) return;
    const existing = outputs.find((o) => o.kind === 'desperdicio' && o.name === UNASSIGNED_OUTPUT_NAME);
    if (existing) update(existing.id, { weightKg: Math.round((existing.weightKg + kg) * 1000) / 1000 });
    else onChange([...outputs, { id: uid(), name: UNASSIGNED_OUTPUT_NAME, kind: 'desperdicio', weightKg: kg }]);
  }

  return (
    <div className={cx(YIELD_VIZ_VARS, '@container')}>
      {outputs.length > 0 && (
        <div className="mb-1.5 hidden grid-cols-[minmax(0,1fr)_8.5rem_6.25rem_3.25rem_6.75rem_2.25rem] gap-2 px-1 text-[11px] font-bold uppercase tracking-wide text-muted @min-[44rem]:grid">
          <span>Salida</span>
          <span>Tipo</span>
          <span>Peso</span>
          <span className="text-right">%</span>
          <span>Valor</span>
          <span className="sr-only">Quitar</span>
        </div>
      )}

      <ul className="space-y-2">
        {outputs.map((o, i) => {
          const share = G > 0 ? (o.weightKg / G) * 100 : 0;
          return (
            <li
              key={o.id}
              className="animate-slide-up rounded-xl border border-line bg-surface-2/60 p-2.5 @min-[44rem]:rounded-none @min-[44rem]:border-0 @min-[44rem]:bg-transparent @min-[44rem]:p-0"
            >
              <div className="grid grid-cols-12 items-center gap-2 @min-[44rem]:grid-cols-[minmax(0,1fr)_8.5rem_6.25rem_3.25rem_6.75rem_2.25rem]">
                <div className="order-1 col-span-12 flex min-w-0 items-center gap-2 @min-[44rem]:col-span-1">
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={fillStyle(o.kind)} aria-hidden />
                  <Input
                    id={`yo-n-${o.id}`}
                    value={o.name}
                    placeholder={o.kind === 'principal' ? 'p. ej. Lomos limpios' : o.kind === 'subproducto' ? 'p. ej. Espinas para fumet' : 'p. ej. Piel'}
                    onChange={(e) => update(o.id, { name: e.target.value })}
                    aria-label={`Nombre de la salida ${i + 1}`}
                    className="min-w-0 flex-1"
                  />
                  <span className="tabular w-12 shrink-0 text-right text-xs font-semibold text-ink-2 @min-[44rem]:hidden">{fmtPct(share, 1)}</span>
                  <IconButton label={`Quitar ${o.name || 'salida'}`} onClick={() => remove(o.id)} className="-mr-1 size-10 shrink-0 hover:text-bad @min-[44rem]:hidden">
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
                <div className="order-6 hidden justify-end @min-[44rem]:flex">
                  <IconButton label={`Quitar ${o.name || 'salida'}`} onClick={() => remove(o.id)} className="size-10 hover:text-bad">
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
                <div className="order-3 col-span-7 @min-[44rem]:order-2 @min-[44rem]:col-span-1">
                  <Select value={o.kind} onChange={(e) => update(o.id, { kind: e.target.value as YieldOutputKind })} aria-label={`Tipo de la salida ${i + 1}`}>
                    {KIND_OPTIONS.map((k) => (
                      <option key={k} value={k} title={YIELD_KIND_LABELS[k].label}>
                        {shortKindLabel(k)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="order-4 col-span-5 @min-[44rem]:order-3 @min-[44rem]:col-span-1">
                  <NumberInput
                    id={`yo-w-${o.id}`}
                    value={o.weightKg || undefined}
                    onValue={(v) => update(o.id, { weightKg: v ?? 0 })}
                    min={0}
                    suffix="kg"
                    placeholder="0,000"
                    aria-label={`Peso de ${o.name || 'la salida'} en kg`}
                  />
                </div>
                <div className="tabular order-5 hidden text-right text-sm font-semibold text-ink-2 @min-[44rem]:order-4 @min-[44rem]:block">{fmtPct(share, 1)}</div>
                <div className={cx('order-6 col-span-12 @min-[44rem]:order-5 @min-[44rem]:col-span-1', o.kind !== 'subproducto' && 'hidden @min-[44rem]:block')}>
                  {o.kind === 'subproducto' ? (
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-xs font-medium text-muted @min-[44rem]:hidden">Valor de aprovechamiento</span>
                      <NumberInput
                        value={o.valuePerKg}
                        onValue={(v) => update(o.id, { valuePerKg: v })}
                        min={0}
                        decimals={2}
                        suffix="€/kg"
                        placeholder="0,00"
                        className="min-w-0 flex-1"
                        title="Lo que te costaría comprar esto aparte (o su valor de aprovechamiento)"
                        aria-label={`Valor de aprovechamiento de ${o.name || 'el subproducto'} en €/kg`}
                      />
                    </div>
                  ) : (
                    <span className="block px-3 text-sm text-muted" aria-hidden>
                      —
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {outputs.length === 0 && (
        <div className="rounded-xl border border-dashed border-line-strong bg-surface-2/50 px-4 py-6 text-center text-sm text-muted">
          Limpia la pieza, pesa cada parte y añádela aquí. Empieza por lo que va al plato.
        </div>
      )}

      {/* Atajos */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {QUICK_OUTPUTS.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => add({ name: q.name, kind: q.kind, weightKg: 0, valuePerKg: q.valuePerKg })}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-semibold text-ink-2 transition hover:border-brand-400 hover:text-ink active:scale-95"
          >
            <span className="size-2 rounded-full" style={fillStyle(q.kind)} aria-hidden />+ {q.label}
          </button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus className="size-3.5" />}
          className="h-9 rounded-full"
          onClick={() => add({ name: '', kind: outputs.some((o) => o.kind === 'principal') ? 'desperdicio' : 'principal', weightKg: 0 }, 'n')}
        >
          Otra salida
        </Button>
      </div>

      {/* Peso restante */}
      {G > 0 && (
        <div
          className={cx(
            'mt-4 flex flex-col gap-2 rounded-xl border px-3.5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
            remaining > 0.0005 ? 'border-warn/30 bg-warn-soft' : remaining < -0.0005 ? 'border-bad/30 bg-bad-soft' : 'border-ok/30 bg-ok-soft',
          )}
          aria-live="polite"
        >
          <div className="flex items-start gap-2.5">
            {remaining < -0.0005 ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
            ) : remaining > 0.0005 ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" />
            )}
            <div>
              <div className="font-semibold text-ink">
                {remaining > 0.0005
                  ? `Quedan ${fmtKg(remaining)} sin asignar`
                  : remaining < -0.0005
                    ? `Las salidas pesan ${fmtKg(-remaining)} más que la pieza`
                    : 'Todo el peso está asignado'}
              </div>
              <div className="tabular text-xs text-ink-2">
                Registrado {fmtKg(assigned)} de {fmtKg(available)}
                {thawLossPct ? ' (tras descongelar)' : ''}.{' '}
                {remaining > 0.0005 && 'Si es goteo o diferencia de báscula, déjalo: cuenta como merma no registrada.'}
                {remaining < -0.0005 && 'Revisa los pesos o el peso bruto de la pieza.'}
              </div>
            </div>
          </div>
          {remaining > 0.0005 && (
            <Button size="sm" variant="outline" className="shrink-0 self-start sm:self-auto" onClick={assignRemainingAsWaste}>
              Asignar como desperdicio
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
