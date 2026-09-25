import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, BellRing, Camera, CheckCircle2, ChefHat, ClipboardCheck, FileText, Flame, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import type { PriceAlert } from '../../../core/analytics';
import type { BusinessSettings } from '../../../types';
import { fmtEur, fmtPct } from '../../../lib/format';
import { Badge, Card, CardHeader, FoodCostBadge, cx } from '../../ui';
import { relativeDays } from '../dates';
import { fmtSignedEur, fmtSignedPct, fmtUnitPrice } from '../shared';
import type { DishFcRow, ReviewItem } from '../insights';

function PanelFooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
      {children} <ArrowRight className="size-4" />
    </Link>
  );
}

function PanelEmpty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-surface-2 px-4 py-8 text-center">
      <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-ok-soft text-ok">{icon}</div>
      <div className="text-sm font-semibold text-ink">{title}</div>
      <p className="mt-0.5 max-w-xs text-xs text-muted">{text}</p>
    </div>
  );
}

const rowCls =
  'flex items-center gap-3 rounded-xl px-2 py-2.5 -mx-2 transition hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand-500';

/** Subidas (y bajadas) de precio de ingredientes por encima del umbral configurado. */
export function PriceAlertsPanel({ alerts, business, error, className }: { alerts: PriceAlert[]; business: BusinessSettings; error?: string; className?: string }) {
  const ups = alerts.filter((a) => a.changePct > 0).length;
  return (
    <Card className={className}>
      <CardHeader
        icon={<BellRing className="size-5" />}
        title="Alertas de precio"
        subtitle={`Cambios de ±${fmtPct(business.priceAlertPct, 0)} o más respecto a la compra anterior`}
        action={ups > 0 ? <Badge tone="bad">{ups} subida{ups === 1 ? '' : 's'}</Badge> : undefined}
      />
      {error ? (
        <p className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-ink-2">No se pudieron calcular las alertas: {error}</p>
      ) : alerts.length === 0 ? (
        <PanelEmpty icon={<CheckCircle2 className="size-5" />} title="Precios estables" text="Ningún ingrediente ha cambiado de precio por encima de tu umbral de alerta." />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {alerts.slice(0, 5).map((a) => {
              const up = a.changePct > 0;
              const n = a.affectedDishIds.length;
              return (
                <li key={a.productId}>
                  <Link to={`/ingredientes/${a.productId}`} className={rowCls}>
                    <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-xl', up ? 'bg-bad-soft text-bad' : 'bg-ok-soft text-ok')}>
                      {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{a.productName}</span>
                      <span className="tabular block truncate text-xs text-muted">
                        {fmtUnitPrice(a.previousPrice)} → <span className="font-semibold text-ink-2">{fmtUnitPrice(a.currentPrice)}</span>/{a.baseUnit}
                        {' · '}
                        {n ? `afecta a ${n} plato${n === 1 ? '' : 's'}` : 'sin platos afectados'}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <Badge tone={up ? 'bad' : 'ok'} className="tabular">
                        {fmtSignedPct(a.changePct)}
                      </Badge>
                      <span className="mt-0.5 text-[10px] text-muted">{relativeDays(a.currentDate)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <PanelFooterLink to="/informes?tab=precios">{alerts.length > 5 ? `Ver las ${alerts.length} alertas` : 'Ver evolución de precios'}</PanelFooterLink>
        </>
      )}
    </Card>
  );
}

/** Platos en ámbar o rojo con su PVP recomendado. */
export function AttentionPanel({ rows, className }: { rows: DishFcRow[]; className?: string }) {
  const bad = rows.filter((r) => r.status === 'bad').length;
  return (
    <Card className={className}>
      <CardHeader
        icon={<Flame className="size-5" />}
        title="Platos que necesitan atención"
        subtitle="Por encima de tu objetivo de food cost"
        action={bad > 0 ? <Badge tone="bad">{bad} en rojo</Badge> : rows.length ? <Badge tone="warn">{rows.length} en ámbar</Badge> : undefined}
      />
      {rows.length === 0 ? (
        <PanelEmpty icon={<CheckCircle2 className="size-5" />} title="Toda la carta en objetivo" text="Ningún plato supera tu food cost objetivo. Sigue vigilando las alertas de precio." />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {rows.slice(0, 6).map((r) => {
              const priceGap = r.suggestedPrice != null && r.menuPrice != null ? r.suggestedPrice - r.menuPrice : undefined;
              return (
                <li key={r.id}>
                  <Link to={`/platos/${r.id}`} className={rowCls}>
                    <FoodCostBadge pct={r.foodCostPct} status={r.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{r.name}</span>
                      <span className="tabular block truncate text-xs text-muted">
                        {r.excessCost > 0.005 ? `${fmtEur(r.excessCost)} de coste de más por ración` : `coste ${fmtEur(r.costPerPortion)} por ración`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">PVP sugerido</span>
                      <span className="tabular block text-sm font-bold text-ink">{fmtEur(r.suggestedPrice)}</span>
                      {priceGap != null && priceGap > 0.004 && <span className="tabular block text-[10px] font-semibold text-bad">{fmtSignedEur(priceGap)}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <PanelFooterLink to={bad > 0 ? '/platos?fc=bad' : '/platos?fc=warn'}>{rows.length > 6 ? `Ver los ${rows.length} platos` : 'Revisar escandallos'}</PanelFooterLink>
        </>
      )}
    </Card>
  );
}

const REVIEW_ICON: Record<ReviewItem['kind'], ReactNode> = {
  factura: <FileText className="size-4" />,
  carta: <Camera className="size-4" />,
  plato: <ChefHat className="size-4" />,
};
const REVIEW_TONE: Record<ReviewItem['tone'], string> = { warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad', ai: 'bg-ai-soft text-ai' };

/** Tareas pendientes: facturas por revisar, cartas por importar y escandallos propuestos sin revisar. */
export function ReviewPanel({ items, className }: { items: ReviewItem[]; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader
        icon={<ClipboardCheck className="size-5" />}
        title="Por revisar"
        subtitle="Lo que se ha leído o propuesto y espera tu visto bueno"
        action={items.length ? <Badge tone="warn">{items.length}</Badge> : undefined}
      />
      {items.length === 0 ? (
        <PanelEmpty icon={<CheckCircle2 className="size-5" />} title="Todo al día" text="No hay facturas, cartas ni escandallos pendientes de revisar." />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {items.slice(0, 6).map((it) => (
              <li key={`${it.kind}-${it.id}`}>
                <Link to={it.to} className={rowCls}>
                  <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-xl', REVIEW_TONE[it.tone])}>{REVIEW_ICON[it.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{it.title}</span>
                    <span className="block truncate text-xs text-muted">{it.subtitle}</span>
                  </span>
                  {it.kind === 'plato' ? (
                    <Badge tone="ai" icon={<Sparkles className="size-3" />}>
                      Propuesto
                    </Badge>
                  ) : it.tone === 'bad' ? (
                    <Badge tone="bad">Error</Badge>
                  ) : (
                    <Badge tone="warn">Revisar</Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {items.length > 6 && <p className="mt-3 text-xs text-muted">Y {items.length - 6} más pendientes.</p>}
        </>
      )}
    </Card>
  );
}
