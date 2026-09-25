import { Link } from 'react-router';
import { AlertTriangle, ArrowRight, CheckCircle2, Target, XCircle } from 'lucide-react';
import type { BusinessSettings } from '../../../types';
import type { FoodCostStatus } from '../../../core/costing';
import { fmtNum, fmtPct } from '../../../lib/format';
import { Card, cx } from '../../ui';
import { businessStatus, foodCostScale, type StatusCounts } from '../insights';

const STATUS_TEXT: Record<FoodCostStatus, { title: string; tone: string; icon: typeof CheckCircle2 }> = {
  ok: { title: 'En objetivo', tone: 'text-ok', icon: CheckCircle2 },
  warn: { title: 'Atención', tone: 'text-warn', icon: AlertTriangle },
  bad: { title: 'Por encima del objetivo', tone: 'text-bad', icon: XCircle },
  none: { title: 'Sin datos suficientes', tone: 'text-muted', icon: Target },
};

const VALUE_TONE: Record<FoodCostStatus, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', none: 'text-muted' };

/**
 * Cifra protagonista del panel: food cost medio frente al objetivo, con el semáforo en una regla
 * (verde hasta el objetivo, ámbar hasta el umbral, rojo después) y el reparto de platos por color.
 */
export function FoodCostHero({
  pct,
  weighted,
  business,
  counts,
  className,
}: {
  pct: number | undefined;
  /** true si la media está ponderada por unidades vendidas. */
  weighted: boolean;
  business: BusinessSettings;
  counts: StatusCounts;
  className?: string;
}) {
  const status = businessStatus(pct, business);
  const s = STATUS_TEXT[status];
  const scale = foodCostScale(pct, business);
  const diff = pct != null ? pct - business.targetFoodCostPct : undefined;
  const Icon = s.icon;

  const sentence =
    diff == null
      ? 'Añade el PVP y los ingredientes de tus platos para ver tu food cost.'
      : diff <= 0
        ? `${fmtNum(Math.abs(diff), 1)} puntos por debajo de tu objetivo del ${fmtPct(business.targetFoodCostPct, 0)}. ¡Buen trabajo!`
        : `${fmtNum(diff, 1)} puntos por encima de tu objetivo del ${fmtPct(business.targetFoodCostPct, 0)}. Revisa los platos en rojo.`;

  return (
    <Card className={cx('relative flex flex-col overflow-hidden', className)}>
      <div className="hero-mesh pointer-events-none absolute inset-0 opacity-35" aria-hidden />
      <div className="relative flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Food cost medio</div>
            <div className="text-[11px] text-muted">{weighted ? 'Ponderado por unidades vendidas' : 'Media de los platos con PVP y coste'}</div>
          </div>
          <span className={cx('inline-flex items-center gap-1 rounded-full bg-surface/80 px-2.5 py-1 text-xs font-bold shadow-card', s.tone)}>
            <Icon className="size-3.5" aria-hidden />
            {s.title}
          </span>
        </div>

        <div className="mt-3 flex items-end gap-3">
          <div className={cx('font-display text-6xl font-extrabold leading-none sm:text-7xl', VALUE_TONE[status])}>{fmtPct(pct)}</div>
          <div className="mb-1.5 text-sm text-muted">
            objetivo <span className="font-semibold text-ink">{fmtPct(business.targetFoodCostPct, 0)}</span>
          </div>
        </div>
        <p className="mt-2 text-sm text-ink-2">{sentence}</p>

        {/* Regla del semáforo */}
        <div
          className="mt-5"
          role="img"
          aria-label={`Food cost ${fmtPct(pct)} en una escala de 0 a ${scale.max} %: verde hasta ${fmtPct(business.targetFoodCostPct, 0)}, ámbar hasta ${fmtPct(business.warningFoodCostPct, 0)}`}
        >
          <div className="relative h-3">
            <div className="absolute inset-0 flex gap-0.5 overflow-hidden rounded-full">
              <div className="h-full bg-ok/80" style={{ width: `${scale.targetPos * 100}%` }} />
              <div className="h-full bg-warn/80" style={{ width: `${(scale.warnPos - scale.targetPos) * 100}%` }} />
              <div className="h-full flex-1 bg-bad/80" />
            </div>
            {pct != null && (
              <div
                className="absolute -top-1.5 size-6 -translate-x-1/2 transition-[left] duration-700 ease-out"
                style={{ left: `${scale.pos * 100}%` }}
              >
                <div className="size-6 rounded-full border-[3px] border-surface bg-ink shadow-pop" />
              </div>
            )}
          </div>
          <div className="relative mt-1.5 h-4 text-[10px] font-semibold text-muted">
            <span className="absolute left-0">0 %</span>
            <span className="absolute -translate-x-1/2" style={{ left: `${scale.targetPos * 100}%` }}>
              {fmtPct(business.targetFoodCostPct, 0)}
            </span>
            {scale.warnPos - scale.targetPos > 0.1 && (
              <span className="absolute -translate-x-1/2" style={{ left: `${scale.warnPos * 100}%` }}>
                {fmtPct(business.warningFoodCostPct, 0)}
              </span>
            )}
            <span className="absolute right-0">{scale.max} %</span>
          </div>
        </div>

        {/* Reparto de platos por color */}
        {counts.total > 0 && (
          <div className="mt-auto pt-5">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-semibold text-ink-2">
                {counts.total} plato{counts.total === 1 ? '' : 's'} con escandallo
              </span>
              <Link to="/platos" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Ver escandallos <ArrowRight className="size-3.5" />
              </Link>
            </div>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
              {counts.ok > 0 && <div className="bg-ok" style={{ flexGrow: counts.ok }} />}
              {counts.warn > 0 && <div className="bg-warn" style={{ flexGrow: counts.warn }} />}
              {counts.bad > 0 && <div className="bg-bad" style={{ flexGrow: counts.bad }} />}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-ok" aria-hidden />
                <span className="tabular font-bold text-ink">{counts.ok}</span> en objetivo
              </li>
              <li className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 text-warn" aria-hidden />
                <span className="tabular font-bold text-ink">{counts.warn}</span> atención
              </li>
              <li className="flex items-center gap-1.5">
                <XCircle className="size-3.5 text-bad" aria-hidden />
                <span className="tabular font-bold text-ink">{counts.bad}</span> en rojo
              </li>
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
