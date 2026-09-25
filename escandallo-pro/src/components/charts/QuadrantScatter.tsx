import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Symbols,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  type SymbolType,
  type TooltipContentProps,
} from 'recharts';
import { useChartTheme } from './theme';
import { ChartTooltipBox } from './ChartParts';

/**
 * Dispersión con cuadrantes (p. ej. matriz de ingeniería de menú).
 * Cada grupo tiene color Y forma propios (el color nunca es el único canal); área de toque de 24 px por punto.
 */

export interface QuadrantPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  group: string;
  /** Líneas extra en el tooltip. */
  details?: { label: string; value: string }[];
}

export interface QuadrantGroup {
  key: string;
  label: string;
  color: string;
  shape: SymbolType;
}

/** Cuadrantes: qué grupo ocupa cada esquina, para rotular el fondo. */
export interface QuadrantLabels {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
}

function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function QuadrantScatter({
  points,
  groups,
  xThreshold,
  yThreshold,
  xLabel,
  yLabel,
  xThresholdLabel,
  yThresholdLabel,
  quadrantLabels,
  quadrantGroups,
  formatX,
  formatY,
  onSelect,
  height = 360,
  ariaLabel,
}: {
  points: QuadrantPoint[];
  groups: QuadrantGroup[];
  xThreshold: number;
  yThreshold: number;
  xLabel: string;
  yLabel: string;
  xThresholdLabel: string;
  yThresholdLabel: string;
  quadrantLabels: QuadrantLabels;
  /** Grupo de cada cuadrante (tiñe muy suavemente el fondo). */
  quadrantGroups: QuadrantLabels;
  formatX: (v: number) => string;
  formatY: (v: number) => string;
  onSelect?: (id: string) => void;
  height?: number;
  ariaLabel: string;
}) {
  const t = useChartTheme();
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMax = niceCeil(Math.max(...xs, xThreshold * 1.6, 0.1) * 1.08);
  const yMaxRaw = Math.max(...ys, yThreshold * 1.4, 0.1) * 1.1;
  const yMinRaw = Math.min(0, ...ys);
  const yMax = niceCeil(yMaxRaw);
  const yMin = yMinRaw < 0 ? -niceCeil(-yMinRaw * 1.1) : 0;
  const groupMap = new Map(groups.map((g) => [g.key, g]));
  const tint = (key: string) => groupMap.get(key)?.color ?? t.neutral;

  const renderTooltip = ({ active, payload }: TooltipContentProps) => {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload as QuadrantPoint | undefined;
    if (!p) return null;
    const g = groupMap.get(p.group);
    return (
      <ChartTooltipBox
        title={p.name}
        rows={[
          { key: 'g', color: g?.color, label: '', value: g?.label ?? p.group, shape: 'dot' },
          { key: 'y', label: yLabel, value: formatY(p.y) },
          { key: 'x', label: xLabel, value: formatX(p.x) },
          ...(p.details ?? []).map((d) => ({ key: d.label, label: d.label, value: d.value })),
        ]}
      />
    );
  };

  const quadLabel = (value: string, position: 'insideTopLeft' | 'insideTopRight' | 'insideBottomLeft' | 'insideBottomRight') => ({
    value,
    position,
    fill: t.muted,
    fontSize: 11,
    fontWeight: 700,
  });

  return (
    <div role="figure" aria-label={ariaLabel} className="w-full select-none">
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
          <CartesianGrid stroke={t.line} strokeWidth={1} />
          <ReferenceArea
            x1={0}
            x2={xThreshold}
            y1={yThreshold}
            y2={yMax}
            fill={tint(quadrantGroups.topLeft)}
            fillOpacity={0.05}
            stroke="none"
            label={quadLabel(quadrantLabels.topLeft, 'insideTopLeft')}
          />
          <ReferenceArea
            x1={xThreshold}
            x2={xMax}
            y1={yThreshold}
            y2={yMax}
            fill={tint(quadrantGroups.topRight)}
            fillOpacity={0.05}
            stroke="none"
            label={quadLabel(quadrantLabels.topRight, 'insideTopRight')}
          />
          <ReferenceArea
            x1={0}
            x2={xThreshold}
            y1={yMin}
            y2={yThreshold}
            fill={tint(quadrantGroups.bottomLeft)}
            fillOpacity={0.05}
            stroke="none"
            label={quadLabel(quadrantLabels.bottomLeft, 'insideBottomLeft')}
          />
          <ReferenceArea
            x1={xThreshold}
            x2={xMax}
            y1={yMin}
            y2={yThreshold}
            fill={tint(quadrantGroups.bottomRight)}
            fillOpacity={0.05}
            stroke="none"
            label={quadLabel(quadrantLabels.bottomRight, 'insideBottomRight')}
          />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            domain={[0, xMax]}
            tickLine={false}
            axisLine={{ stroke: t.lineStrong }}
            tick={{ fill: t.muted, fontSize: 11 }}
            tickFormatter={formatX}
            label={{ value: xLabel, position: 'insideBottom', offset: -12, fill: t.ink2, fontSize: 11, fontWeight: 600 }}
            height={36}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            domain={[yMin, yMax]}
            tickLine={false}
            axisLine={false}
            tick={{ fill: t.muted, fontSize: 11 }}
            tickFormatter={formatY}
            width={62}
            label={{
              value: yLabel,
              angle: -90,
              position: 'insideLeft',
              offset: 8,
              fill: t.ink2,
              fontSize: 11,
              fontWeight: 600,
              style: { textAnchor: 'middle' },
            }}
          />
          <ZAxis range={[90, 90]} />
          <ReferenceLine
            x={xThreshold}
            stroke={t.muted}
            strokeDasharray="4 4"
            label={{ value: xThresholdLabel, position: 'insideTop', fill: t.muted, fontSize: 10, offset: 22 }}
          />
          <ReferenceLine
            y={yThreshold}
            stroke={t.muted}
            strokeDasharray="4 4"
            label={{ value: yThresholdLabel, position: 'insideBottomRight', fill: t.muted, fontSize: 10 }}
          />
          <Tooltip content={renderTooltip} cursor={false} isAnimationActive={false} />
          {groups.map((g) => (
            <Scatter
              key={g.key}
              name={g.label}
              data={points.filter((p) => p.group === g.key)}
              isAnimationActive
              animationDuration={600}
              shape={(props: { cx?: number; cy?: number; payload?: QuadrantPoint; isActive?: boolean }) => {
                if (props.cx == null || props.cy == null) return <g />;
                const id = props.payload?.id;
                return (
                  <g onClick={onSelect && id ? () => onSelect(id) : undefined} style={{ cursor: onSelect ? 'pointer' : undefined }}>
                    <circle cx={props.cx} cy={props.cy} r={12} fill="transparent" />
                    <Symbols
                      cx={props.cx}
                      cy={props.cy}
                      type={g.shape}
                      size={props.isActive ? 150 : 96}
                      fill={g.color}
                      stroke={t.surface}
                      strokeWidth={2}
                    />
                  </g>
                );
              }}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
