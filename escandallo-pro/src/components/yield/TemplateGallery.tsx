import { useMemo, useState } from 'react';
import { Flame, Snowflake } from 'lucide-react';
import type { IngredientCategory } from '../../types';
import { YIELD_TEMPLATES, templateYieldPct, type YieldTemplate } from '../../services/yieldTests';
import { Segmented, cx } from '../ui';
import { fmtPct } from '../../lib/format';
import { YIELD_VIZ_VARS, fillStyle } from './palette';

type Family = 'todas' | 'pescado' | 'marisco' | 'carne' | 'vegetal';

const FAMILY_OF: Partial<Record<IngredientCategory, Family>> = {
  pescado: 'pescado',
  marisco: 'marisco',
  carne: 'carne',
  charcuteria: 'carne',
  verdura: 'vegetal',
  fruta: 'vegetal',
};

/** Galería de plantillas de despiece con su rendimiento típico. */
export function TemplateGallery({ onPick }: { onPick: (tpl: YieldTemplate) => void }) {
  const [family, setFamily] = useState<Family>('todas');
  const list = useMemo(
    () => YIELD_TEMPLATES.filter((t) => family === 'todas' || FAMILY_OF[t.category ?? 'otros'] === family),
    [family],
  );

  return (
    <div>
      <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Segmented<Family>
          value={family}
          onChange={setFamily}
          size="sm"
          options={[
            { value: 'todas', label: 'Todas' },
            { value: 'pescado', label: '🐟 Pescado' },
            { value: 'marisco', label: '🦑 Marisco' },
            { value: 'carne', label: '🥩 Carne' },
            { value: 'vegetal', label: '🥬 Fruta y verdura' },
          ]}
        />
      </div>
      <div className={cx(YIELD_VIZ_VARS, 'grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4')}>
        {list.map((t) => (
          <TemplateCard key={t.name} tpl={t} onPick={() => onPick(t)} />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({ tpl, onPick }: { tpl: YieldTemplate; onPick: () => void }) {
  const y = templateYieldPct(tpl);
  const sub = tpl.outputs.filter((o) => o.kind === 'subproducto').reduce((s, o) => s + o.fraction, 0);
  const waste = tpl.outputs.filter((o) => o.kind === 'desperdicio').reduce((s, o) => s + o.fraction, 0);
  const thaw = (tpl.thawLossPct ?? 0) / 100;
  const rest = Math.max(0, 1 - y / 100 - sub - waste - thaw);
  const parts = [
    { key: 'principal' as const, v: y / 100 },
    { key: 'subproducto' as const, v: sub },
    { key: 'desperdicio' as const, v: waste },
    { key: 'noRegistrado' as const, v: rest },
    { key: 'descongelacion' as const, v: thaw },
  ].filter((p) => p.v > 0.001);

  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex min-h-[148px] flex-col rounded-2xl border border-line bg-surface p-3.5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-pop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 active:scale-[0.99] sm:p-4"
      aria-label={`Usar plantilla ${tpl.name}: rendimiento típico ${fmtPct(y, 0)}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-surface-2 text-2xl transition group-hover:scale-110" aria-hidden>
          {tpl.emoji ?? '⚖️'}
        </span>
        <div className="text-right">
          <div className="font-display text-2xl font-extrabold leading-none text-ink">{fmtPct(y, 0)}</div>
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">rinde</div>
        </div>
      </div>
      <div className="mt-2.5 line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-snug text-ink">{tpl.name}</div>
      <div className="mt-auto pt-2">
        <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full" aria-hidden>
          {parts.map((p) => (
            <div key={p.key} style={{ ...fillStyle(p.key), flexGrow: p.v, flexBasis: 0 }} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] font-medium text-muted">
          {tpl.cookingLossPct > 0 && (
            <span className="inline-flex items-center gap-1">
              <Flame className="size-3" /> −{fmtPct(tpl.cookingLossPct, 0)}
            </span>
          )}
          {thaw > 0 && (
            <span className="inline-flex items-center gap-1">
              <Snowflake className="size-3" /> −{fmtPct(tpl.thawLossPct, 0)}
            </span>
          )}
          {sub >= 0.03 && <span>{fmtPct(sub * 100, 0)} aprovechable aparte</span>}
        </div>
      </div>
    </button>
  );
}
