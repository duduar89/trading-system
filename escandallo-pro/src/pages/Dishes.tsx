import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import clsx from 'clsx';
import {
  AlertOctagon,
  Camera,
  CheckCheck,
  ChefHat,
  FlaskConical,
  LayoutGrid,
  List,
  Plus,
  Receipt,
  Sparkles,
  Tag,
  Trash2,
  UtensilsCrossed,
  X,
  PartyPopper,
  Gauge,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
} from 'lucide-react';
import type { DishKind, ID } from '../types';
import { useBusiness, useDishCosts, useDishes } from '../state/hooks';
import { errorMessage, toast } from '../state/store';
import { deleteDish, updateDish } from '../services/dishes';

import { foodCostStatus } from '../core/costing';
import { Button, Callout, ConfirmDialog, EmptyState, IconButton, PageHeader, SearchInput, Segmented, Select, Stat } from '../components/ui';
import { DishCard, DishCardSkeleton } from '../components/dishes/DishCard';
import { DishListTable } from '../components/dishes/DishListTable';
import { NewDishModal } from '../components/dishes/NewDishModal';
import { useMediaQuery } from '../components/dishes/hooks';
import { ProposeModal } from '../components/dishes/ProposeModal';
import {
  defaultDir,
  dishListStats,
  filterDishes,
  sectionsOf,
  sortDishes,
  type DishSort,
  type KindFilter,
  type StatusFilter,
  type FoodCostFilter,
  fmtPctNb,
  filterByFoodCost,
  foodCostCounts,
  parseFoodCostFilter,
} from '../components/dishes/logic';

const SORTS: { value: DishSort; label: string }[] = [
  { value: 'foodcost', label: 'Food cost' },
  { value: 'margen', label: 'Margen €' },
  { value: 'merma', label: 'Merma' },
  { value: 'coste', label: 'Coste por ración' },
  { value: 'nombre', label: 'Nombre' },
  { value: 'seccion', label: 'Sección' },
  { value: 'recientes', label: 'Más recientes' },
];

type View = 'cards' | 'table';
const VIEW_KEY = 'ep-dishes-view';

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards';
  } catch {
    return 'cards';
  }
}

export default function Dishes() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const dishes = useDishes();
  const dc = useDishCosts();
  const business = useBusiness();

  const recent = params.get('recientes') === '1';
  const proposedCount = params.get('propuestos');
  // ?fc=bad|warn|ok|sin → semáforo de food cost (lo usan los enlaces del panel). Vive en la URL para que «atrás» lo respete.
  const fc = parseFoodCostFilter(params.get('fc'));
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('plato');
  const [status, setStatus] = useState<StatusFilter>('todos');
  const [section, setSection] = useState<string | undefined>();
  const [sort, setSort] = useState<DishSort>(recent ? 'recientes' : 'foodcost');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [view, setView] = useState<View>(readView);
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [newKind, setNewKind] = useState<DishKind | null>(null);
  const [proposeIds, setProposeIds] = useState<ID[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const wide = useMediaQuery('(min-width: 640px)');

  // ?nuevo=1 → abre el alta; se limpia el parámetro para no reabrirlo al volver.
  useEffect(() => {
    if (params.get('nuevo') === '1') {
      setNewKind(params.get('tipo') === 'elaboracion' ? 'elaboracion' : 'plato');
      const next = new URLSearchParams(params);
      next.delete('nuevo');
      next.delete('tipo');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  // Al llegar desde la importación de la carta, los recién creados primero.
  useEffect(() => {
    if (recent) {
      setSort('recientes');
      setDir('desc');
    }
  }, [recent]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* almacenamiento no disponible */
    }
  }, [view]);

  const costs = dc?.costs;
  const all = useMemo(() => dishes ?? [], [dishes]);
  const sections = useMemo(() => sectionsOf(all.filter((d) => kind === 'todos' || d.kind === kind)), [all, kind]);
  const hasNoSection = useMemo(() => all.some((d) => (kind === 'todos' || d.kind === kind) && !d.section?.trim()), [all, kind]);
  const stats = useMemo(() => (costs ? dishListStats(all, costs, business) : undefined), [all, costs, business]);
  const fcCounts = useMemo(() => (costs ? foodCostCounts(all, costs, business) : undefined), [all, costs, business]);
  const visible = useMemo(() => {
    if (!costs) return [];
    const filtered = filterByFoodCost(filterDishes(all, { query, kind: fc ? 'plato' : kind, status, section }), costs, business, fc);
    return sortDishes(filtered, costs, sort, dir);
  }, [all, costs, business, fc, query, kind, status, section, sort, dir]);

  // Si cambia el filtro, la selección se queda sólo con lo visible.
  useEffect(() => {
    setSelected((cur) => {
      if (!cur.size) return cur;
      const ids = new Set(visible.map((d) => d.id));
      const next = new Set([...cur].filter((id) => ids.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [visible]);

  const changeSort = (s: DishSort) => {
    if (s === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(s);
      setDir(defaultDir(s));
    }
  };
  const toggle = (id: ID) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setFc = (next: FoodCostFilter | undefined) => {
    const p = new URLSearchParams(params);
    if (next) {
      p.set('fc', next);
      setKind('plato');
    } else p.delete('fc');
    setParams(p, { replace: true });
  };
  const toggleAll = () => setSelected((cur) => (visible.every((d) => cur.has(d.id)) ? new Set() : new Set(visible.map((d) => d.id))));
  const dismissRecent = () => {
    const next = new URLSearchParams(params);
    next.delete('recientes');
    next.delete('propuestos');
    setParams(next, { replace: true });
  };

  const markReviewed = async () => {
    setBulkBusy(true);
    try {
      const ids = [...selected];
      for (const id of ids) await updateDish(id, { status: 'revisado' });
      toast.success(`${ids.length} ${ids.length === 1 ? 'escandallo revisado' : 'escandallos revisados'}`);
      setSelected(new Set());
    } catch (e) {
      toast.error('No se pudieron marcar', errorMessage(e));
    } finally {
      setBulkBusy(false);
    }
  };
  const removeSelected = async () => {
    setBulkBusy(true);
    try {
      const ids = [...selected];
      for (const id of ids) await deleteDish(id);
      toast.success(`${ids.length} ${ids.length === 1 ? 'escandallo eliminado' : 'escandallos eliminados'}`);
      setSelected(new Set());
    } catch (e) {
      toast.error('No se pudieron eliminar', errorMessage(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const loading = !dishes || !costs;
  const empty = !loading && all.length === 0;
  const avgStatus = foodCostStatus(stats?.avgFoodCost, business.targetFoodCostPct, business.warningFoodCostPct);
  const withoutRecipe = all.filter((d) => d.kind === 'plato' && d.items.length === 0);
  const proposeTargets = proposeIds ? all.filter((d) => proposeIds.includes(d.id)) : [];

  return (
    <div className="pb-24">
      <PageHeader
        eyebrow="Escandallos"
        title="Platos y elaboraciones"
        subtitle="El coste real de cada plato, su food cost y su margen, al día con los precios de tus facturas."
        actions={
          <>
            <Button variant="outline" icon={<FlaskConical className="size-4" />} onClick={() => setNewKind('elaboracion')}>
              Nueva elaboración
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setNewKind('plato')}>
              Nuevo plato
            </Button>
          </>
        }
      />

      {recent && (
        <Callout
          tone="ok"
          icon={<PartyPopper className="size-4" />}
          className="mb-5 animate-slide-up"
          title={proposedCount === '0' ? 'Platos importados' : 'Platos importados: revisa las propuestas'}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {proposedCount === '0'
                ? 'Ya están en tu lista, los más recientes primero. Propón su receta de una vez o ábrelos para añadir los ingredientes.'
                : `Cada plato trae una receta propuesta con gramajes y mermas. Ábrelos, ajusta lo que haga falta y acepta las líneas en violeta${
                    stats?.suggestedLines ? ` (${stats.suggestedLines} por revisar)` : ''
                  }.`}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {withoutRecipe.length > 0 && (
                <Button size="sm" variant="ai" icon={<Sparkles className="size-3.5" />} onClick={() => setProposeIds(withoutRecipe.map((d) => d.id))}>
                  Proponer para {withoutRecipe.length} sin receta
                </Button>
              )}
              <button type="button" onClick={dismissRecent} className="inline-flex h-8 items-center gap-1 px-1 text-xs font-semibold text-ink-2 hover:text-ink">
                <X className="size-3.5" /> Entendido
              </button>
            </div>
          </div>
        </Callout>
      )}

      {empty ? (
        <EmptyHero onNew={() => setNewKind('plato')} onCamera={() => navigate('/carta?nuevo=1')} />
      ) : (
        <>
          {/* ── KPIs ── */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Platos"
              value={stats ? stats.dishes : '—'}
              icon={<UtensilsCrossed className="size-4" />}
              tone="brand"
              hint={stats ? `${stats.elaborations} ${stats.elaborations === 1 ? 'elaboración' : 'elaboraciones'}` : undefined}
            />
            <Stat
              label="Food cost medio"
              value={fmtPctNb(stats?.avgFoodCost)}
              icon={<Gauge className="size-4" />}
              tone={avgStatus === 'none' ? 'default' : avgStatus}
              hint={`Objetivo ${fmtPctNb(business.targetFoodCostPct, 0)}`}
            />
            <button
              type="button"
              onClick={() => setFc(fc === 'bad' ? undefined : 'bad')}
              aria-pressed={fc === 'bad'}
              disabled={!stats?.red && fc !== 'bad'}
              title={stats?.red ? (fc === 'bad' ? 'Ver todos los platos' : 'Ver sólo los platos en rojo') : undefined}
              className={clsx(
                'rounded-2xl text-left transition enabled:hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
                fc === 'bad' && 'ring-2 ring-bad/60 ring-offset-2 ring-offset-bg',
              )}
            >
              <Stat
                label="En rojo"
                value={stats ? stats.red : '—'}
                icon={<AlertOctagon className="size-4" />}
                tone={stats?.red ? 'bad' : 'ok'}
                className="h-full"
                hint={stats?.warn ? `y ${stats.warn} en ámbar` : `Por encima del ${fmtPctNb(business.warningFoodCostPct, 0)}`}
              />
            </button>
            <Stat
              label="Sin PVP"
              value={stats ? stats.noPrice : '—'}
              icon={<Tag className="size-4" />}
              tone={stats?.noPrice ? 'warn' : 'ok'}
              hint={stats?.incomplete ? `${stats.incomplete} con ingredientes sin precio` : 'Todos con precio de carta'}
            />
          </div>

          {/* ── Filtros ── */}
          <div className="mb-5 space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <SearchInput value={query} onChange={setQuery} placeholder="Buscar plato, sección o ingrediente…" className="md:max-w-sm md:flex-1" />
              <div className="flex flex-wrap items-center gap-2">
                <Segmented<KindFilter>
                  value={fc ? 'plato' : kind}
                  onChange={(k) => {
                    setKind(k);
                    setSection(undefined);
                    if (k !== 'plato' && fc) setFc(undefined);
                  }}
                  options={[
                    { value: 'plato', label: 'Platos' },
                    { value: 'elaboracion', label: 'Elaboraciones' },
                    { value: 'todos', label: 'Todos' },
                  ]}
                />
                <Segmented<View>
                  className="max-sm:hidden"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'cards', label: <span className="sr-only">Tarjetas</span>, icon: <LayoutGrid className="size-4" /> },
                    { value: 'table', label: <span className="sr-only">Tabla</span>, icon: <List className="size-4" /> },
                  ]}
                />
              </div>
              <div className="flex items-center gap-2 md:ml-auto">
                <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Estado" className="w-auto max-sm:min-w-0 max-sm:flex-1 sm:min-w-[11.5rem]">
                  <option value="todos">{wide ? 'Todos los estados' : 'Todos'}</option>
                  <option value="borrador">Borradores</option>
                  <option value="revisado">Revisados</option>
                </Select>
                <Select
                  value={sort}
                  onChange={(e) => {
                    const s = e.target.value as DishSort;
                    setSort(s);
                    setDir(defaultDir(s));
                  }}
                  aria-label="Ordenar por"
                  className="w-auto min-w-36 max-sm:flex-1"
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
                <IconButton
                  label={dir === 'desc' ? 'Orden descendente (pulsa para ascendente)' : 'Orden ascendente (pulsa para descendente)'}
                  onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  className="size-10 shrink-0 border border-line-strong bg-surface"
                >
                  {dir === 'desc' ? <ArrowDownWideNarrow className="size-4" /> : <ArrowUpNarrowWide className="size-4" />}
                </IconButton>
              </div>
            </div>
            {(sections.length > 0 || hasNoSection) && (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="toolbar" aria-label="Secciones">
                <Chip active={section === undefined} onClick={() => setSection(undefined)}>
                  Todas
                </Chip>
                {sections.map((s) => (
                  <Chip key={s} active={section === s} onClick={() => setSection(section === s ? undefined : s)}>
                    {s}
                  </Chip>
                ))}
                {hasNoSection && sections.length > 0 && (
                  <Chip active={section === ''} onClick={() => setSection(section === '' ? undefined : '')}>
                    Sin sección
                  </Chip>
                )}
              </div>
            )}
            {fcCounts && (kind !== 'elaboracion' || fc) && fcCounts.bad + fcCounts.warn + fcCounts.ok + fcCounts.sin > 0 && (
              <FoodCostFilterBar value={fc} counts={fcCounts} business={business} onChange={setFc} />
            )}
          </div>

          {/* ── Listado ── */}
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <DishCardSkeleton key={i} />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<ChefHat className="size-7" />}
              title="Ningún escandallo coincide"
              description="Prueba con otra búsqueda o quita los filtros."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery('');
                    setStatus('todos');
                    setSection(undefined);
                    setKind('todos');
                    if (fc) setFc(undefined);
                  }}
                >
                  Quitar filtros
                </Button>
              }
            />
          ) : view === 'cards' || !wide ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((d) => (
                <DishCard key={d.id} dish={d} cost={costs.get(d.id)} business={business} selected={selected.has(d.id)} selecting={selected.size > 0} onToggle={() => toggle(d.id)} />
              ))}
            </div>
          ) : (
            <DishListTable
              dishes={visible}
              costs={costs}
              business={business}
              sort={sort}
              dir={dir}
              onSort={changeSort}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
            />
          )}
          {!loading && visible.length > 0 && (
            <p className="mt-4 text-center text-xs text-muted">
              {visible.length} de {all.length} escandallos
            </p>
          )}
        </>
      )}

      {/* ── Barra de acciones en bloque ── */}
      {selected.size > 0 && (
        <div className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-3xl animate-slide-up lg:bottom-6 lg:left-64 lg:right-24">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-elevated p-2.5 shadow-pop">
            <button type="button" onClick={() => setSelected(new Set())} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink hover:bg-surface-2" aria-label="Quitar selección">
              <X className="size-4" /> {selected.size} <span className="max-sm:hidden">{selected.size === 1 ? 'seleccionado' : 'seleccionados'}</span>
            </button>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="md" variant="ai" icon={<Sparkles className="size-4" />} onClick={() => setProposeIds([...selected])} disabled={bulkBusy}>
                <span className="max-sm:hidden">Proponer ingredientes</span>
                <span className="sm:hidden">Proponer</span>
              </Button>
              <Button size="md" variant="outline" icon={<CheckCheck className="size-4" />} onClick={markReviewed} loading={bulkBusy} aria-label="Marcar revisado">
                <span className="max-sm:hidden">Marcar revisado</span>
              </Button>
              <Button size="md" variant="outline" icon={<Trash2 className="size-4 text-bad" />} onClick={() => setConfirmDelete(true)} disabled={bulkBusy} aria-label="Eliminar">
                <span className="max-sm:hidden">Eliminar</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      <NewDishModal open={newKind != null} initialKind={newKind ?? 'plato'} sections={sectionsOf(all)} onClose={() => setNewKind(null)} />
      <ProposeModal
        open={proposeIds != null}
        dishIds={proposeIds ?? []}
        withItems={proposeTargets.filter((d) => d.items.length > 0).length}
        onClose={() => setProposeIds(null)}
        onDone={() => setSelected(new Set())}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={removeSelected}
        danger
        confirmLabel="Eliminar"
        title={`¿Eliminar ${selected.size} ${selected.size === 1 ? 'escandallo' : 'escandallos'}?`}
        message="Se borrarán por completo. Si alguno es una elaboración usada en otros platos, esas líneas quedarán sin vincular. No se puede deshacer."
      />
    </div>
  );
}

const FC_CHIPS: { value: FoodCostFilter; label: string; dot: string; active: string }[] = [
  { value: 'bad', label: 'En rojo', dot: 'bg-bad', active: 'border-bad/50 bg-bad-soft text-bad' },
  { value: 'warn', label: 'En ámbar', dot: 'bg-warn', active: 'border-warn/50 bg-warn-soft text-warn' },
  { value: 'ok', label: 'En verde', dot: 'bg-ok', active: 'border-ok/50 bg-ok-soft text-ok' },
  { value: 'sin', label: 'Sin food cost', dot: 'bg-line-strong', active: 'border-line-strong bg-surface-2 text-ink' },
];

/** Filtro por semáforo de food cost con el recuento de cada color (enlazable con `?fc=`). */
function FoodCostFilterBar({
  value,
  counts,
  business,
  onChange,
}: {
  value: FoodCostFilter | undefined;
  counts: Record<FoodCostFilter, number>;
  business: { targetFoodCostPct: number; warningFoodCostPct: number };
  onChange: (v: FoodCostFilter | undefined) => void;
}) {
  const hints: Record<FoodCostFilter, string> = {
    bad: `Food cost por encima del ${fmtPctNb(business.warningFoodCostPct, 0)}`,
    warn: `Entre el ${fmtPctNb(business.targetFoodCostPct, 0)} y el ${fmtPctNb(business.warningFoodCostPct, 0)}`,
    ok: `Hasta el ${fmtPctNb(business.targetFoodCostPct, 0)} (tu objetivo)`,
    sin: 'Sin PVP o sin ingredientes con precio',
  };
  return (
    <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filtrar por food cost">
      <span className="shrink-0 pr-1 text-xs font-bold uppercase tracking-wide text-muted">Food cost</span>
      {FC_CHIPS.filter((c) => c.value !== 'sin' || counts.sin > 0 || value === 'sin').map((c) => {
        const active = value === c.value;
        const n = counts[c.value];
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={active}
            title={hints[c.value]}
            disabled={!n && !active}
            onClick={() => onChange(active ? undefined : c.value)}
            className={clsx(
              'inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-sm font-semibold transition disabled:opacity-45',
              active ? c.active : 'border-line bg-surface text-ink-2 enabled:hover:border-line-strong enabled:hover:text-ink',
            )}
          >
            <span className={clsx('size-2 rounded-full', c.dot)} aria-hidden />
            {c.label}
            <span className={clsx('tabular text-xs', active ? 'opacity-80' : 'text-muted')}>{n}</span>
            {active && <X className="-mr-1 size-3.5" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition',
        active ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

/** Estado vacío con propuesta de valor y los dos caminos para empezar. */
function EmptyHero({ onCamera, onNew }: { onCamera: () => void; onNew: () => void }) {
  return (
    <div className="hero-mesh relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-12 text-center shadow-card sm:px-10 sm:py-16">
      <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-glow">
        <ChefHat className="size-8" />
      </div>
      <h2 className="mx-auto mt-5 max-w-xl font-display text-2xl font-extrabold text-ink sm:text-3xl">
        Tu carta, <span className="text-gradient-brand">escandallada en minutos</span>
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-ink-2 sm:text-[15px]">
        Haz una foto a la carta: leemos platos y precios, te proponemos la receta de cada uno y la cruzamos con los precios de tus facturas. Gratis, en tu dispositivo.
      </p>
      <div className="mt-7 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Button size="lg" icon={<Camera className="size-5" />} onClick={onCamera}>
          Fotografiar la carta
        </Button>
        <Button size="lg" variant="outline" icon={<Plus className="size-5" />} onClick={onNew}>
          Crear un plato a mano
        </Button>
      </div>
      <div className="mx-auto mt-8 grid max-w-2xl gap-3 text-left sm:grid-cols-3">
        {[
          { icon: <Camera className="size-4" />, t: 'Foto de la carta', d: 'Platos, secciones y PVP leídos solos.' },
          { icon: <Sparkles className="size-4" />, t: 'Receta propuesta', d: 'Gramajes y mermas típicos de cada plato.' },
          { icon: <Receipt className="size-4" />, t: 'Precios reales', d: 'Cruzados con tus facturas: food cost al céntimo.' },
        ].map((s) => (
          <div key={s.t} className="rounded-2xl border border-line bg-surface/80 p-3.5 backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-bold text-ink">
              <span className="flex size-7 items-center justify-center rounded-lg bg-brand-500/12 text-brand-500">{s.icon}</span>
              {s.t}
            </div>
            <p className="mt-1 text-xs text-muted">{s.d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
