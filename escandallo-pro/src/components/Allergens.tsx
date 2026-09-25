import clsx from 'clsx';
import type { Allergen } from '../types';
import { ALLERGENS, ALLERGEN_LABELS } from '../lib/labels';

/** Chips de alérgenos (solo lectura). */
export function AllergenChips({ allergens, size = 'md', empty = 'Sin alérgenos declarados' }: { allergens: Allergen[]; size?: 'sm' | 'md'; empty?: string | null }) {
  if (!allergens.length) return empty ? <span className="text-xs text-muted">{empty}</span> : null;
  return (
    <div className="flex flex-wrap gap-1">
      {allergens.map((a) => (
        <span
          key={a}
          title={ALLERGEN_LABELS[a].label}
          className={clsx(
            'inline-flex items-center gap-1 rounded-full border border-warn/30 bg-warn-soft font-semibold text-ink-2',
            size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]',
          )}
        >
          <span aria-hidden>{ALLERGEN_LABELS[a].emoji}</span>
          {size === 'sm' ? ALLERGEN_LABELS[a].short : ALLERGEN_LABELS[a].label}
        </span>
      ))}
    </div>
  );
}

/** Selector de alérgenos (los 14 del Reglamento UE 1169/2011). */
export function AllergenPicker({ value, onChange }: { value: Allergen[]; onChange: (v: Allergen[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALLERGENS.map((a) => {
        const on = value.includes(a);
        return (
          <button
            key={a}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== a) : [...value, a])}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition',
              on ? 'border-warn bg-warn-soft text-ink' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
            )}
            aria-pressed={on}
          >
            <span aria-hidden>{ALLERGEN_LABELS[a].emoji}</span>
            {ALLERGEN_LABELS[a].label}
          </button>
        );
      })}
    </div>
  );
}
