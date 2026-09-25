import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, CheckCircle2, ChefHat, FileText, Sparkles, X } from 'lucide-react';
import type { Dish, DishCost, ID } from '../../types';
import { Badge, Button, FoodCostBadge, IconButton, Modal } from '../ui';
import { foodCostStatus } from '../../core/costing';
import { useBusiness } from '../../state/hooks';
import { fmtEur, fmtEurPrecise, fmtNum } from '../../lib/format';
import { ChangePct } from './badges';
import { isMeaningfulChange, type PriceChangeRow } from './logic';

export interface ConfirmOutcome {
  created: number;
  updated: number;
  skipped: number;
  rows: PriceChangeRow[];
  /** Escandallos calculados justo antes de confirmar (para mostrar el impacto). */
  costsBefore?: Map<ID, DishCost>;
}

/** Resultado de confirmar una factura: precios que cambian, ingredientes nuevos y escandallos afectados. */
export function ConfirmResultModal({
  outcome,
  onClose,
  dishes,
  costsAfter,
}: {
  outcome: ConfirmOutcome | null;
  onClose: () => void;
  dishes: Dish[] | undefined;
  costsAfter: Map<ID, DishCost> | undefined;
}) {
  const navigate = useNavigate();
  const business = useBusiness();

  const changed = useMemo(() => (outcome?.rows ?? []).filter((r) => !r.isNew && isMeaningfulChange(r.changePct)), [outcome]);
  const created = useMemo(() => (outcome?.rows ?? []).filter((r) => r.isNew), [outcome]);
  const unchanged = (outcome?.rows.length ?? 0) - changed.length - created.length;

  const impacted = useMemo(() => {
    if (!outcome?.costsBefore || !costsAfter || !dishes) return [];
    const out: { dish: Dish; before: DishCost; after: DishCost; delta: number }[] = [];
    for (const d of dishes) {
      const b = outcome.costsBefore.get(d.id);
      const a = costsAfter.get(d.id);
      if (!b || !a) continue;
      const delta = a.costPerPortion - b.costPerPortion;
      if (Math.abs(delta) >= 0.005) out.push({ dish: d, before: b, after: a, delta });
    }
    const fcRise = (i: (typeof out)[number]) => (i.after.foodCostPct ?? 0) - (i.before.foodCostPct ?? 0);
    return out.sort((x, y) => fcRise(y) - fcRise(x) || y.delta - x.delta);
  }, [outcome, costsAfter, dishes]);

  if (!outcome) return null;
  const overTarget = impacted.filter(
    (i) => i.dish.kind === 'plato' && foodCostStatus(i.after.foodCostPct, i.after.targetFoodCostPct, business.warningFoodCostPct) === 'bad',
  ).length;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" icon={<FileText className="size-4" />} onClick={() => navigate('/facturas')}>
            Volver a facturas
          </Button>
          <Button
            variant="primary"
            icon={<ChefHat className="size-4" />}
            iconRight={<ArrowRight className="size-4" />}
            onClick={() => navigate('/platos')}
          >
            {impacted.length ? `Ver escandallos afectados (${impacted.length})` : 'Ver escandallos'}
          </Button>
        </>
      }
    >
      <div className="hero-mesh relative -mx-5 -mt-4 mb-5 border-b border-line px-5 pb-6 pt-7 text-center">
        <IconButton label="Cerrar" onClick={onClose} className="absolute right-3 top-3">
          <X className="size-5" />
        </IconButton>
        <div className="mx-auto mb-3 flex size-14 animate-slide-up items-center justify-center rounded-2xl bg-ok text-white shadow-[0_12px_30px_-12px_rgb(16_185_129/0.9)]">
          <CheckCircle2 className="size-7" />
        </div>
        <h2 className="font-display text-2xl font-extrabold text-ink">Factura confirmada</h2>
        <p className="mt-1 text-sm text-muted">Tu base de precios y todos los escandallos ya están al día.</p>
        <div className="mx-auto mt-5 grid max-w-md grid-cols-3 gap-2">
          <BigNumber value={outcome.updated} label={outcome.updated === 1 ? 'precio actualizado' : 'precios actualizados'} />
          <BigNumber value={outcome.created} label={outcome.created === 1 ? 'producto nuevo' : 'productos nuevos'} accent={outcome.created > 0} />
          <BigNumber value={impacted.length} label={impacted.length === 1 ? 'escandallo cambia' : 'escandallos cambian'} />
        </div>
      </div>

      {changed.length > 0 && (
        <section className="mb-5">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Cambios de precio</h3>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {changed.map((r) => (
              <div key={r.productId} className="flex items-center gap-3 bg-surface px-3.5 py-2.5">
                <div className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{r.name}</div>
                <div className="tabular hidden text-right text-xs text-muted sm:block">
                  {fmtEurPrecise(r.before)} <span aria-hidden>→</span>
                </div>
                <div className="tabular w-28 text-right text-sm font-bold text-ink">
                  {fmtEurPrecise(r.after)}
                  <span className="text-[11px] font-medium text-muted">/{r.baseUnit}</span>
                </div>
                <ChangePct pct={r.changePct} className="w-16 justify-end" />
              </div>
            ))}
          </div>
        </section>
      )}

      {created.length > 0 && (
        <section className="mb-5">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Ingredientes nuevos en tu base de precios</h3>
          <div className="flex flex-wrap gap-2">
            {created.map((r) => (
              <span
                key={r.productId}
                className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm"
              >
                <Badge tone="brand">Nuevo</Badge>
                <span className="font-semibold text-ink">{r.name}</span>
                <span className="tabular text-xs text-muted">
                  {fmtEurPrecise(r.after)}/{r.baseUnit}
                </span>
              </span>
            ))}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <Sparkles className="size-3.5" /> Hemos rellenado sus mermas y alérgenos típicos: revísalos en Ingredientes cuando quieras.
          </p>
        </section>
      )}

      {unchanged > 0 && (
        <p className="mb-5 text-sm text-muted">
          {fmtNum(unchanged, 0)} {unchanged === 1 ? 'ingrediente mantiene' : 'ingredientes mantienen'} el mismo precio
          {outcome.skipped > 0
            ? ` · ${outcome.skipped} ${outcome.skipped === 1 ? 'línea omitida' : 'líneas omitidas'} (ignoradas o sin precio)`
            : ''}
          .
        </p>
      )}

      {impacted.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
            Impacto en tus escandallos
            {overTarget > 0 && <Badge tone="bad">{overTarget} por encima del límite</Badge>}
          </h3>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {impacted.slice(0, 8).map(({ dish, before, after, delta }) => (
              <button
                key={dish.id}
                type="button"
                onClick={() => navigate(`/platos/${dish.id}`)}
                className="flex w-full items-center gap-3 bg-surface px-3.5 py-2.5 text-left transition hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{dish.name}</div>
                  <div className="tabular text-xs text-muted">
                    Coste ración {fmtEur(before.costPerPortion)} → {fmtEur(after.costPerPortion)}{' '}
                    <span className={delta > 0 ? 'font-semibold text-bad' : 'font-semibold text-ok'}>
                      ({delta > 0 ? '+' : ''}
                      {fmtEur(delta)})
                    </span>
                  </div>
                </div>
                {dish.kind === 'plato' && after.foodCostPct != null && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <FoodCostBadge
                      pct={before.foodCostPct}
                      status={foodCostStatus(before.foodCostPct, before.targetFoodCostPct, business.warningFoodCostPct)}
                    />
                    <ArrowRight className="size-3.5 text-muted" />
                    <FoodCostBadge
                      pct={after.foodCostPct}
                      status={foodCostStatus(after.foodCostPct, after.targetFoodCostPct, business.warningFoodCostPct)}
                    />
                  </div>
                )}
                {dish.kind === 'elaboracion' && <Badge>Elaboración</Badge>}
              </button>
            ))}
          </div>
          {impacted.length > 8 && <p className="mt-2 text-xs text-muted">y {impacted.length - 8} más.</p>}
        </section>
      )}
    </Modal>
  );
}

function BigNumber({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface/80 px-2 py-3 backdrop-blur">
      <div
        className={accent ? 'font-display text-3xl font-extrabold text-gradient-brand' : 'font-display text-3xl font-extrabold text-ink'}
      >
        {fmtNum(value, 0)}
      </div>
      <div className="mt-0.5 text-[11px] font-semibold leading-tight text-muted">{label}</div>
    </div>
  );
}
