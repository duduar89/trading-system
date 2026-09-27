/**
 * Gráficos con recharts cargados bajo demanda: recharts pesa ~100 KB (gzip) y no hace falta para la primera pintura
 * del panel ni de los informes. Mientras llega se reserva el hueco con un esqueleto de la misma altura (sin saltos).
 */
import { lazy, Suspense, type ComponentProps } from 'react';
import type { ColumnChart as ColumnChartImpl } from './ColumnChart';
import type { TrendLine as TrendLineImpl } from './TrendLine';
import type { QuadrantScatter as QuadrantScatterImpl } from './QuadrantScatter';

const LazyColumnChart = lazy(() => import('./ColumnChart').then((m) => ({ default: m.ColumnChart })));
const LazyTrendLine = lazy(() => import('./TrendLine').then((m) => ({ default: m.TrendLine })));
const LazyQuadrantScatter = lazy(() => import('./QuadrantScatter').then((m) => ({ default: m.QuadrantScatter })));

/** Hueco del gráfico mientras se carga (respeta «reducir movimiento»). */
export function ChartSkeleton({ height, label }: { height: number; label?: string }) {
  return (
    <div
      role="status"
      aria-label={label ? `Cargando gráfico: ${label}` : 'Cargando gráfico'}
      className="w-full rounded-xl bg-surface-2 motion-safe:animate-pulse-soft"
      style={{ height }}
    />
  );
}

export function ColumnChart(props: ComponentProps<typeof ColumnChartImpl>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height ?? 220} label={props.ariaLabel} />}>
      <LazyColumnChart {...props} />
    </Suspense>
  );
}

export function TrendLine(props: ComponentProps<typeof TrendLineImpl>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height ?? 240} label={props.ariaLabel} />}>
      <LazyTrendLine {...props} />
    </Suspense>
  );
}

export function QuadrantScatter(props: ComponentProps<typeof QuadrantScatterImpl>) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height ?? 360} label={props.ariaLabel} />}>
      <LazyQuadrantScatter {...props} />
    </Suspense>
  );
}
