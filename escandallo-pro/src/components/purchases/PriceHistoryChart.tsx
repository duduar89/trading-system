import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import type { BaseUnit, PricePoint } from '../../types';
import { fmtDate, fmtEurPrecise, fmtNum } from '../../lib/format';
import { useChartColors } from './hooks';
import { niceTicks, sortPricePoints } from './logic';

export const SOURCE_LABELS: Record<PricePoint['source'], string> = {
  factura: 'Factura',
  manual: 'Precio manual',
  hoja: 'Tarifa importada',
  demo: 'Demostración',
};

interface Datum {
  ts: number;
  price: number;
  date: string;
  source: PricePoint['source'];
  supplier?: string;
  description?: string;
}

const shortDate = new Intl.DateTimeFormat('es-ES', { month: 'short', year: '2-digit' });
const dayDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });

function toTs(date: string): number {
  return new Date(date.length === 10 ? `${date}T12:00:00` : date).getTime();
}

/**
 * Evolución del precio de un ingrediente (línea escalonada: el precio se mantiene hasta la siguiente compra).
 * Una sola serie en el naranja de marca (validado para fondo claro y oscuro), rejilla discreta y
 * tooltip con cursor que encuentra la fecha. La tabla del histórico acompaña como vista accesible.
 */
export function PriceHistoryChart({
  points,
  baseUnit,
  supplierNames,
}: {
  points: PricePoint[];
  baseUnit: BaseUnit;
  supplierNames: Map<string, string>;
}) {
  const colors = useChartColors();
  const data: Datum[] = useMemo(
    () =>
      sortPricePoints(points)
        .filter((p) => p.pricePerBase > 0)
        .map((p) => ({
          ts: toTs(p.date),
          price: p.pricePerBase,
          date: p.date,
          source: p.source,
          supplier: p.supplierId ? supplierNames.get(p.supplierId) : undefined,
          description: p.rawDescription,
        })),
    [points, supplierNames],
  );

  if (data.length < 2) return null;

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = Math.max((max - min) * 0.2, max * 0.03);
  const { ticks, decimals } = niceTicks(Math.max(0, min - pad), max + pad, 4);
  const spanDays = (data[data.length - 1].ts - data[0].ts) / 86_400_000;
  const fmtTick = (ts: number) => (spanDays > 120 ? shortDate : dayDate).format(new Date(ts));
  const last = data[data.length - 1];

  return (
    <div
      className="h-[240px] w-full"
      role="img"
      aria-label={`Evolución del precio: de ${fmtEurPrecise(data[0].price)} a ${fmtEurPrecise(last.price)} por ${baseUnit}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 22, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={colors.grid} strokeWidth={1} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={fmtTick}
            tick={{ fill: colors.axis, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: colors.grid }}
            minTickGap={28}
            tickMargin={8}
          />
          <YAxis
            domain={[ticks[0], ticks[ticks.length - 1]]}
            ticks={ticks}
            interval={0}
            tickFormatter={(v: number) => `${fmtNum(v, Math.max(decimals, 2))} €`}
            tick={{ fill: colors.axis, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={62}
          />
          <Tooltip
            cursor={{ stroke: colors.axis, strokeWidth: 1 }}
            content={(props: TooltipContentProps<ValueType, NameType>) => <PriceTooltip {...props} baseUnit={baseUnit} />}
            isAnimationActive={false}
          />
          <Area
            type="stepAfter"
            dataKey="price"
            stroke={colors.series}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill={colors.series}
            fillOpacity={0.1}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const { cx, cy, index } = props;
              if (cx == null || cy == null) return <g key={`d-${index}`} />;
              const isLast = index === data.length - 1;
              return (
                <g key={`d-${index}`}>
                  <circle cx={cx} cy={cy} r={isLast ? 5 : 4} fill={colors.series} stroke={colors.surface} strokeWidth={2} />
                  {isLast && (
                    <text x={cx} y={cy - 12} textAnchor="end" fill={colors.ink} fontSize={12} fontWeight={700}>
                      {fmtEurPrecise(last.price)}
                    </text>
                  )}
                </g>
              );
            }}
            activeDot={{ r: 6, fill: colors.series, stroke: colors.surface, strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function PriceTooltip({ active, payload, baseUnit }: TooltipContentProps<ValueType, NameType> & { baseUnit: BaseUnit }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as Datum;
  return (
    <div className="max-w-[240px] rounded-xl border border-line bg-elevated px-3 py-2 shadow-pop">
      <div className="tabular font-display text-base font-extrabold text-ink">
        {fmtEurPrecise(d.price)}
        <span className="ml-0.5 font-sans text-xs font-semibold text-muted">/{baseUnit}</span>
      </div>
      <div className="text-xs text-ink-2">{fmtDate(d.date)}</div>
      <div className="mt-0.5 text-[11px] text-muted">
        {SOURCE_LABELS[d.source]}
        {d.supplier ? ` · ${d.supplier}` : ''}
      </div>
      {d.description && <div className="mt-0.5 truncate text-[11px] text-muted">«{d.description}»</div>}
    </div>
  );
}
