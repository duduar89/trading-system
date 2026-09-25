import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import { useChartTheme } from './theme';
import { ChartTooltipBox, SrTable } from './ChartParts';

/**
 * Gráfico de columnas (una serie) para magnitudes en el tiempo o por tramos ordenados.
 * Columnas finas (≤ 28 px) con extremo redondeado de 4 px, rejilla horizontal en línea fina y tooltip por columna.
 */

export interface ColumnDatum {
  key: string;
  /** Etiqueta corta del eje. */
  label: string;
  value: number;
  /** Color propio (p. ej. semáforo); por defecto el de la serie. */
  color?: string;
  /** Título del tooltip (por defecto `label`). */
  tooltipTitle?: string;
  /** Línea extra en el tooltip. */
  tooltipNote?: string;
}

export function ColumnChart({
  data,
  height = 220,
  color,
  formatValue,
  formatAxis,
  valueLabel,
  highlightKey,
  labelKeys,
  onSelect,
  ariaLabel,
  allowDecimals = true,
  allTicks,
  yAxisWidth = 72,
  formatLabel,
}: {
  data: ColumnDatum[];
  height?: number;
  color?: string;
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
  /** Nombre de la magnitud en el tooltip (p. ej. "Gasto sin IVA"). */
  valueLabel: ReactNode;
  /** Columna destacada (el resto se atenúa ligeramente). */
  highlightKey?: string;
  /** Columnas que muestran su valor encima (etiquetado selectivo). */
  labelKeys?: string[];
  onSelect?: (key: string) => void;
  ariaLabel: string;
  allowDecimals?: boolean;
  /** Muestra todas las etiquetas del eje X (para pocas categorías). */
  allTicks?: boolean;
  yAxisWidth?: number;
  /** Formato de las etiquetas sobre las columnas (por defecto, `formatValue`). */
  formatLabel?: (v: number) => string;
}) {
  const t = useChartTheme();
  const base = color ?? t.brand;
  const labelSet = new Set(labelKeys ?? []);

  const renderTooltip = ({ active, payload }: TooltipContentProps) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload as ColumnDatum | undefined;
    if (!d) return null;
    return (
      <ChartTooltipBox
        title={d.tooltipTitle ?? d.label}
        rows={[{ key: 'v', color: d.color ?? base, label: valueLabel, value: formatValue(d.value), shape: 'dot' }]}
        footer={d.tooltipNote}
      />
    );
  };

  return (
    <div role="figure" aria-label={ariaLabel} className="w-full select-none">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 22, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={t.line} strokeWidth={1} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: t.lineStrong }}
            tick={{ fill: t.muted, fontSize: 11 }}
            interval={allTicks ? 0 : 'preserveStartEnd'}
            minTickGap={4}
            height={26}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: t.muted, fontSize: 11 }}
            tickFormatter={formatAxis ?? formatValue}
            width={yAxisWidth}
            allowDecimals={allowDecimals}
          />
          <Tooltip content={renderTooltip} cursor={{ fill: t.dark ? 'rgb(255 255 255 / 0.04)' : 'rgb(15 23 42 / 0.04)' }} isAnimationActive={false} />
          <Bar
            dataKey="value"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            isAnimationActive
            animationDuration={600}
            onClick={onSelect ? (entry: { payload?: ColumnDatum }) => entry.payload && onSelect(entry.payload.key) : undefined}
            cursor={onSelect ? 'pointer' : undefined}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={d.color ?? base} fillOpacity={highlightKey && d.key !== highlightKey ? 0.55 : 1} />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              offset={6}
              content={(props) => {
                const vb = props.viewBox as { x?: number; y?: number; width?: number } | undefined;
                const d = props.index != null ? data[props.index] : undefined;
                if (!d || !labelSet.has(d.key) || !vb || vb.x == null || vb.y == null || vb.width == null) return null;
                return (
                  <text x={vb.x + vb.width / 2} y={vb.y - 6} textAnchor="middle" fill={t.ink} fontSize={11} fontWeight={700}>
                    {(formatLabel ?? formatValue)(Number(props.value))}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <SrTable caption={ariaLabel} headers={['Categoría', 'Valor']} rows={data.map((d) => [d.tooltipTitle ?? d.label, formatValue(d.value)])} />
    </div>
  );
}
