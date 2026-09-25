import type { ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { useChartTheme } from './theme';
import { ChartTooltipBox, SrTable } from './ChartParts';

/**
 * Línea temporal de una serie (p. ej. histórico de precios): línea de 2 px en escalón, marcadores ≥ 8 px con anillo
 * del color de la superficie, relleno suave, retícula en cruz que se ajusta al punto más cercano.
 */

/** Escala "redonda" para el eje Y: pasos de 1, 2, 2,5 o 5 × 10^n. */
export function niceScale(lo: number, hi: number, targetTicks = 4): { domain: [number, number]; ticks: number[] } {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / targetTicks;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / exp;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { domain: [ticks[0]!, ticks[ticks.length - 1]!], ticks };
}

export interface TrendPoint {
  /** Clave de fecha 'YYYY-MM-DD' o etiqueta única. */
  key: string;
  label: string;
  value: number;
  tooltipTitle?: string;
  tooltipNote?: string;
}

export function TrendLine({
  data,
  height = 240,
  color,
  formatValue,
  formatAxis,
  valueLabel,
  reference,
  step = true,
  ariaLabel,
}: {
  data: TrendPoint[];
  height?: number;
  color?: string;
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
  valueLabel: ReactNode;
  reference?: { value: number; label: string };
  step?: boolean;
  ariaLabel: string;
}) {
  const t = useChartTheme();
  const c = color ?? t.brand;
  if (!data.length) return null;
  const values = data.map((d) => d.value);
  const min = Math.min(...values, reference?.value ?? Infinity);
  const max = Math.max(...values, reference?.value ?? -Infinity);
  const pad = (max - min) * 0.18 || Math.max(0.05, max * 0.08);
  const { domain, ticks } = niceScale(Math.max(0, min - pad), max + pad, 4);
  const gradId = `trend-${ariaLabel.replace(/[^a-z0-9]/gi, '').slice(0, 24)}`;

  const renderTooltip = ({ active, payload }: TooltipContentProps) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload as TrendPoint | undefined;
    if (!d) return null;
    return (
      <ChartTooltipBox
        title={d.tooltipTitle ?? d.label}
        rows={[{ key: 'v', color: c, label: valueLabel, value: formatValue(d.value) }]}
        footer={d.tooltipNote}
      />
    );
  };

  return (
    <div role="figure" aria-label={ariaLabel} className="w-full select-none">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity={0.16} />
              <stop offset="100%" stopColor={c} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={t.line} strokeWidth={1} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: t.lineStrong }}
            tick={{ fill: t.muted, fontSize: 11 }}
            minTickGap={16}
            height={26}
          />
          <YAxis
            domain={domain}
            tickLine={false}
            axisLine={false}
            tick={{ fill: t.muted, fontSize: 11 }}
            tickFormatter={formatAxis ?? formatValue}
            width={64}
            ticks={ticks}
          />
          {reference && (
            <ReferenceLine
              y={reference.value}
              stroke={t.muted}
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{ value: reference.label, position: 'insideTopLeft', fill: t.muted, fontSize: 10 }}
            />
          )}
          <Tooltip content={renderTooltip} cursor={{ stroke: t.lineStrong, strokeWidth: 1 }} isAnimationActive={false} />
          <Area
            type={step ? 'stepAfter' : 'monotone'}
            dataKey="value"
            stroke={c}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill={`url(#${gradId})`}
            dot={{ r: 4, fill: c, stroke: t.surface, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: c, stroke: t.surface, strokeWidth: 2 }}
            isAnimationActive
            animationDuration={700}
          />
        </AreaChart>
      </ResponsiveContainer>
      <SrTable caption={ariaLabel} headers={['Fecha', 'Valor']} rows={data.map((d) => [d.tooltipTitle ?? d.label, formatValue(d.value)])} />
    </div>
  );
}
