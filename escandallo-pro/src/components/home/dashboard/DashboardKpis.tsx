import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChefHat, Coins, Flame, Receipt, Scale, Tags } from 'lucide-react';
import { fmtEur, fmtPct } from '../../../lib/format';
import { ProgressBar, Stat, cx } from '../../ui';
import { monthLabel } from '../dates';
import { fmtSignedPct } from '../shared';
import type { SpendTrend, StatusCounts } from '../insights';

const tileCls = 'h-full transition duration-200 group-hover:-translate-y-0.5 group-hover:border-line-strong group-hover:shadow-pop';

function LinkTile({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      aria-label={label}
      className="group block h-full rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
    >
      {children}
    </Link>
  );
}

/** Fila de indicadores clave del panel (cada tarjeta lleva a su detalle). */
export function DashboardKpis({
  avgMarginEur,
  counts,
  avgWastePct,
  spend,
  productCount,
  productsWithPrice,
  dishCount,
  completeDishes,
  className,
}: {
  avgMarginEur?: number;
  counts: StatusCounts;
  avgWastePct?: number;
  spend?: SpendTrend;
  productCount: number;
  productsWithPrice: number;
  dishCount: number;
  completeDishes: number;
  className?: string;
}) {
  const pricedShare = productCount ? productsWithPrice / productCount : 0;
  const completeShare = dishCount ? completeDishes / dishCount : 0;
  return (
    <div className={cx('grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3', className)}>
      <LinkTile to="/platos" label="Ver márgenes de los platos">
        <Stat
          className={tileCls}
          label="Margen bruto medio"
          value={fmtEur(avgMarginEur)}
          icon={<Coins className="size-4" />}
          tone="brand"
          hint="por plato, sin IVA"
        />
      </LinkTile>
      <LinkTile to="/platos?fc=bad" label="Ver platos en rojo">
        <Stat
          className={tileCls}
          label="Platos en rojo"
          value={
            <span className={counts.bad > 0 ? 'text-bad' : undefined}>
              {counts.bad}
              <span className="ml-1 text-base font-bold text-muted">/ {counts.total}</span>
            </span>
          }
          icon={<Flame className="size-4" />}
          tone={counts.bad > 0 ? 'bad' : 'ok'}
          hint={counts.bad > 0 ? 'por encima del umbral de atención' : counts.total ? '¡ninguno por encima del umbral!' : 'aún sin platos con PVP'}
        />
      </LinkTile>
      <LinkTile to="/informes?tab=mermas" label="Ver informe de mermas">
        <Stat
          className={tileCls}
          label="Merma media"
          value={fmtPct(avgWastePct)}
          icon={<Scale className="size-4" />}
          tone="warn"
          hint="en peso, de la compra al plato"
        />
      </LinkTile>
      <LinkTile to="/informes?tab=compras" label="Ver informe de compras">
        <Stat
          className={tileCls}
          label={spend?.inProgress ? 'Gasto este mes' : 'Gasto último mes'}
          value={fmtEur(spend?.total)}
          icon={<Receipt className="size-4" />}
          tone="default"
          hint={
            spend ? (
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {spend.changePct != null && (
                  <span
                    className="tabular whitespace-nowrap rounded-md bg-surface-2 px-1.5 py-0.5 font-semibold text-ink-2"
                    title={`Frente a ${monthLabel(spend.previousMonth, 'long')}`}
                  >
                    {spend.changePct > 0.05 ? '▲' : spend.changePct < -0.05 ? '▼' : '•'}{' '}
                    {fmtSignedPct(spend.changePct, Math.abs(spend.changePct) >= 10 ? 0 : 1)}
                  </span>
                )}
                <span className="whitespace-nowrap">
                  {monthLabel(spend.month)}
                  {spend.inProgress ? ' · en curso' : ''}
                </span>
              </span>
            ) : (
              'sin facturas confirmadas'
            )
          }
        />
      </LinkTile>
      <LinkTile to="/ingredientes" label="Ver ingredientes">
        <Stat
          className={tileCls}
          label="Ingredientes con precio"
          value={
            <span>
              {productsWithPrice}
              <span className="ml-1 text-base font-bold text-muted">/ {productCount}</span>
            </span>
          }
          icon={<Tags className="size-4" />}
          tone={pricedShare >= 1 ? 'ok' : 'warn'}
          hint={<ProgressBar value={pricedShare} tone={pricedShare >= 1 ? 'ok' : 'brand'} className="mt-1 h-1.5 w-24" />}
        />
      </LinkTile>
      <LinkTile to="/platos" label="Ver escandallos">
        <Stat
          className={tileCls}
          label="Escandallos completos"
          value={
            <span>
              {completeDishes}
              <span className="ml-1 text-base font-bold text-muted">/ {dishCount}</span>
            </span>
          }
          icon={<ChefHat className="size-4" />}
          tone={completeShare >= 1 ? 'ok' : 'ai'}
          hint={
            dishCount - completeDishes > 0
              ? `${dishCount - completeDishes} con ingredientes sin precio`
              : dishCount
                ? 'todos con precio'
                : 'sin platos todavía'
          }
        />
      </LinkTile>
    </div>
  );
}
