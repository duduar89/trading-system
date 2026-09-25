import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, ChefHat, Info, Sparkles } from 'lucide-react';
import type { SymbolType } from 'recharts';
import { menuEngineering, type MenuEngineeringRow } from '../../../core/analytics';
import type { MenuEngineeringClass } from '../../../types';
import { MENU_CLASS_LABELS } from '../../../lib/labels';
import { fmtEur, fmtNum, fmtPct } from '../../../lib/format';
import { Badge, Button, Callout, Card, CardHeader, EmptyState, Stat, Table, Td, Th, cx } from '../../ui';
import { ChartLegend, HBarList, QuadrantScatter, useChartTheme, type QuadrantGroup } from '../../charts';
import { safeCompute } from '../shared';
import type { ReportsData } from './useReportsData';

const CLASS_ORDER: MenuEngineeringClass[] = ['estrella', 'caballo', 'enigma', 'perro'];
const CLASS_SHAPE: Record<MenuEngineeringClass, SymbolType> = { estrella: 'star', caballo: 'triangle', enigma: 'diamond', perro: 'circle' };
const CLASS_SOFT: Record<MenuEngineeringClass, string> = {
  estrella: 'bg-ok-soft text-ok',
  caballo: 'bg-warn-soft text-warn',
  enigma: 'bg-info-soft text-info',
  perro: 'bg-bad-soft text-bad',
};

function ShapeIcon({ shape, color }: { shape: SymbolType; color: string }) {
  const paths: Partial<Record<SymbolType, string>> = {
    star: 'M6 0.8l1.5 3.3 3.6.4-2.7 2.4.8 3.6L6 8.7 2.8 10.5l.8-3.6L.9 4.5l3.6-.4z',
    triangle: 'M6 1l5 9H1z',
    diamond: 'M6 .8l5 5.2-5 5.2L1 6z',
  };
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
      {shape === 'circle' ? <circle cx="6" cy="6" r="4.6" fill={color} /> : <path d={paths[shape]} fill={color} />}
    </svg>
  );
}

export function MenuEngineeringTab({ data }: { data: ReportsData }) {
  const navigate = useNavigate();
  const t = useChartTheme();
  const result = useMemo(() => safeCompute(() => menuEngineering(data.dishes, data.costs)), [data.dishes, data.costs]);
  const colors: Record<MenuEngineeringClass, string> = { estrella: t.ok, caballo: t.warn, enigma: t.info, perro: t.bad };

  if (result.error) {
    return (
      <Callout tone="bad" icon={<AlertTriangle className="size-4" />} title="No se pudo calcular la ingeniería de menú">
        {result.error}
      </Callout>
    );
  }
  const me = result.value!;
  const rows = [...me.rows].sort((a, b) => b.totalMargin - a.totalMargin);

  if (rows.length < 2) {
    return (
      <EmptyState
        icon={<ChefHat className="size-7" />}
        title="Necesitas al menos dos platos con PVP y coste"
        description="La ingeniería de menú compara tus platos entre sí por popularidad y rentabilidad. Completa los escandallos de tu carta para verla."
        action={<Button onClick={() => navigate('/platos')}>Ir a escandallos</Button>}
      />
    );
  }

  const byClass = new Map<MenuEngineeringClass, MenuEngineeringRow[]>(CLASS_ORDER.map((c) => [c, rows.filter((r) => r.class === c)]));
  const groups: QuadrantGroup[] = CLASS_ORDER.map((c) => ({
    key: c,
    label: `${MENU_CLASS_LABELS[c].emoji} ${MENU_CLASS_LABELS[c].label}`,
    color: colors[c],
    shape: CLASS_SHAPE[c],
  }));
  const totalUnits = rows.reduce((s, r) => s + r.unitsSold, 0);
  const totalMargin = rows.reduce((s, r) => s + r.totalMargin, 0);
  const highMargin = rows.filter((r) => r.contributionMargin >= me.avgMargin).length;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          label="Platos analizados"
          value={rows.length}
          icon={<ChefHat className="size-4" />}
          hint={me.hasVolumeData ? `${fmtNum(totalUnits, 0)} unidades vendidas` : 'sin datos de ventas'}
        />
        <Stat
          label="Margen medio"
          value={fmtEur(me.avgMargin)}
          icon={<Sparkles className="size-4" />}
          tone="brand"
          hint={me.hasVolumeData ? 'ponderado por ventas' : 'media por plato'}
        />
        {me.hasVolumeData ? (
          <Stat
            label="Estrellas"
            value={
              <span className="text-ok">
                {byClass.get('estrella')!.length}
                <span className="ml-1 text-base font-bold text-muted">/ {rows.length}</span>
              </span>
            }
            tone="ok"
            icon={<span aria-hidden>⭐</span>}
            hint="populares y rentables"
          />
        ) : (
          <Stat
            label="Margen sobre la media"
            value={
              <span className="text-ok">
                {highMargin}
                <span className="ml-1 text-base font-bold text-muted">/ {rows.length}</span>
              </span>
            }
            tone="ok"
            icon={<Sparkles className="size-4" />}
            hint="platos que más dinero dejan"
          />
        )}
        <Stat
          label={me.hasVolumeData ? 'Margen total del periodo' : 'Margen bajo la media'}
          value={me.hasVolumeData ? fmtEur(totalMargin) : rows.length - highMargin}
          tone={me.hasVolumeData ? 'default' : 'warn'}
          icon={me.hasVolumeData ? <Sparkles className="size-4" /> : <AlertTriangle className="size-4" />}
          hint={me.hasVolumeData ? 'suma de margen × unidades' : 'por debajo del margen medio'}
        />
      </div>

      {!me.hasVolumeData && (
        <Callout tone="info" icon={<Info className="size-4" />} title="Añade las ventas para completar la matriz">
          Para saber qué platos son populares necesitamos las <strong>unidades vendidas</strong> de cada plato en un periodo (por ejemplo, el último
          mes, sacado de tu TPV). Indícalas en el campo «Unidades vendidas» de cada escandallo. Mientras tanto, te mostramos los platos ordenados por
          margen.
        </Callout>
      )}

      <Card>
        <CardHeader
          title={me.hasVolumeData ? 'Matriz de popularidad y rentabilidad' : 'Margen de contribución por plato'}
          subtitle={
            me.hasVolumeData
              ? `Popular si supera el ${fmtPct(me.popularityThresholdPct)} de las ventas; rentable si deja más de ${fmtEur(me.avgMargin)} por plato. Toca un punto para abrir el escandallo.`
              : `Lo que deja cada plato (PVP sin IVA − coste). La línea marca el margen medio: ${fmtEur(me.avgMargin)}.`
          }
        />
        {me.hasVolumeData ? (
          <>
            <QuadrantScatter
              ariaLabel="Matriz de ingeniería de menú: popularidad frente a margen de contribución"
              points={rows.map((r) => ({
                id: r.dishId,
                name: r.name,
                x: r.mixPct,
                y: r.contributionMargin,
                group: r.class,
                details: [
                  { label: 'unidades vendidas', value: fmtNum(r.unitsSold, 0) },
                  { label: 'food cost', value: fmtPct(r.foodCostPct) },
                ],
              }))}
              groups={groups}
              xThreshold={me.popularityThresholdPct}
              yThreshold={me.avgMargin}
              xLabel="Popularidad (% de las ventas)"
              yLabel="Margen por plato (€)"
              xThresholdLabel={`Umbral ${fmtPct(me.popularityThresholdPct)}`}
              yThresholdLabel={`Margen medio ${fmtEur(me.avgMargin)}`}
              quadrantLabels={{ topLeft: '🧩 Enigmas', topRight: '⭐ Estrellas', bottomLeft: '🐶 Perros', bottomRight: '🐴 Caballos' }}
              quadrantGroups={{ topLeft: 'enigma', topRight: 'estrella', bottomLeft: 'perro', bottomRight: 'caballo' }}
              formatX={(v) => `${fmtNum(v, 1)} %`}
              formatY={(v) => `${fmtNum(v, Math.abs(v) < 10 ? 1 : 0)} €`}
              onSelect={(id) => navigate(`/platos/${id}`)}
            />
            <ChartLegend
              className="mt-3 border-t border-line pt-3"
              items={CLASS_ORDER.map((c) => ({
                key: c,
                color: colors[c],
                shape: <ShapeIcon shape={CLASS_SHAPE[c]} color={colors[c]} />,
                label: `${MENU_CLASS_LABELS[c].emoji} ${MENU_CLASS_LABELS[c].label}`,
                count: byClass.get(c)!.length,
              }))}
            />
          </>
        ) : (
          <HBarList
            ariaLabel="Margen de contribución por plato"
            reference={{ value: me.avgMargin, label: `Media ${fmtEur(me.avgMargin)}` }}
            items={[...rows]
              .sort((a, b) => b.contributionMargin - a.contributionMargin)
              .map((r) => ({
                id: r.dishId,
                label: r.name,
                sublabel: `food cost ${fmtPct(r.foodCostPct)}`,
                value: Math.max(0, r.contributionMargin),
                display: fmtEur(r.contributionMargin),
                tone: r.contributionMargin >= me.avgMargin ? 'ok' : 'warn',
                to: `/platos/${r.dishId}`,
                title: `${r.name}: margen ${fmtEur(r.contributionMargin)}`,
              }))}
          />
        )}
      </Card>

      {me.hasVolumeData && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {CLASS_ORDER.map((c) => {
            const list = byClass.get(c)!;
            const L = MENU_CLASS_LABELS[c];
            return (
              <Card key={c} className="flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', CLASS_SOFT[c])}>
                    <span aria-hidden>{L.emoji}</span> {L.label}
                  </span>
                  <span className="tabular font-display text-2xl font-extrabold text-ink">{list.length}</span>
                </div>
                <p className="mt-2 text-sm text-ink-2">{L.advice}</p>
                {list.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {list.slice(0, 8).map((r) => (
                      <button
                        key={r.dishId}
                        type="button"
                        onClick={() => navigate(`/platos/${r.dishId}`)}
                        className="max-w-full truncate rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2 transition hover:border-line-strong hover:text-ink"
                      >
                        {r.name}
                      </button>
                    ))}
                    {list.length > 8 && <span className="px-1 py-1 text-xs text-muted">y {list.length - 8} más</span>}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Card padded={false}>
        <div className="p-4 pb-3 sm:p-5 sm:pb-3">
          <CardHeader title="Detalle por plato" subtitle="Ordenado por el margen total que aporta cada plato." />
        </div>
        <Table className="rounded-none border-x-0 border-b-0">
          <thead>
            <tr>
              <Th>Plato</Th>
              <Th align="right">Uds.</Th>
              <Th align="right">Mix</Th>
              <Th align="right">Margen / plato</Th>
              <Th align="right">Margen total</Th>
              <Th align="right">Food cost</Th>
              <Th>{me.hasVolumeData ? 'Clase' : 'Rentabilidad'}</Th>
              <Th className="min-w-[260px]">Qué hacer</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.dishId} className="cursor-pointer transition hover:bg-surface-2" onClick={() => navigate(`/platos/${r.dishId}`)}>
                <Td className="max-w-[240px]">
                  <span className="block truncate font-semibold text-ink">{r.name}</span>
                  {r.section && <span className="block truncate text-xs text-muted">{r.section}</span>}
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  {me.hasVolumeData ? fmtNum(r.unitsSold, 0) : '—'}
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  {me.hasVolumeData ? fmtPct(r.mixPct) : '—'}
                </Td>
                <Td align="right" className="whitespace-nowrap font-semibold text-ink">
                  {fmtEur(r.contributionMargin)}
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  {me.hasVolumeData ? fmtEur(r.totalMargin) : '—'}
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  {fmtPct(r.foodCostPct)}
                </Td>
                <Td>
                  {me.hasVolumeData ? (
                    <Badge tone={MENU_CLASS_LABELS[r.class].tone}>
                      {MENU_CLASS_LABELS[r.class].emoji} {MENU_CLASS_LABELS[r.class].label}
                    </Badge>
                  ) : (
                    <Badge tone={r.contributionMargin >= me.avgMargin ? 'ok' : 'warn'}>
                      {r.contributionMargin >= me.avgMargin ? 'Margen alto' : 'Margen bajo'}
                    </Badge>
                  )}
                </Td>
                <Td className="text-xs text-muted">
                  {me.hasVolumeData
                    ? MENU_CLASS_LABELS[r.class].advice
                    : r.contributionMargin >= me.avgMargin
                      ? 'Deja más margen que la media: dale visibilidad y recomiéndalo en sala.'
                      : 'Deja menos margen que la media: revisa gramajes, proveedor o precio.'}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
