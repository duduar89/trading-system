import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import clsx from 'clsx';
import { Carrot, Download, FileSpreadsheet, FileText, Merge, PackageSearch, Plus, Scale, Tag, Trash2, TrendingUp, X } from 'lucide-react';
import type { ID, Product } from '../types';
import { Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader, SearchInput, Select, Stat, Table, Td, Th } from '../components/ui';
import { AllergenChips } from '../components/Allergens';
import { useBusiness, usePricePoints, useProducts, useSuppliers } from '../state/hooks';
import { errorMessage, toast } from '../state/store';
import { deleteProduct } from '../services/products';
import { CATEGORIES, CATEGORY_LABELS } from '../lib/labels';
import { fmtDate, fmtEurPrecise, fmtNum, fmtPct } from '../lib/format';
import { todayIso } from '../lib/id';
import { CategoryBadge } from '../components/purchases/CategoryBadge';
import { PriceTrendChip } from '../components/purchases/badges';
import { NewProductModal } from '../components/purchases/NewProductModal';
import { MergeProductsModal } from '../components/purchases/MergeProductsModal';
import { ImportPriceListModal } from '../components/purchases/ImportPriceListModal';
import { DEFAULT_PRODUCT_FILTERS, filterProducts, priceTrends, productStats, type PriceTrend, type ProductFilters, type ProductSort } from '../components/purchases/logic';

const PAGE = 150;

const SORTS: { value: ProductSort; label: string }[] = [
  { value: 'nombre', label: 'Nombre (A-Z)' },
  { value: 'precio', label: 'Precio (mayor primero)' },
  { value: 'compra', label: 'Última compra' },
  { value: 'variacion', label: 'Mayor subida' },
];

export default function Products() {
  const products = useProducts();
  const suppliers = useSuppliers();
  const points = usePricePoints();
  const business = useBusiness();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [filters, setFilters] = useState<ProductFilters>(DEFAULT_PRODUCT_FILTERS);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [newOpen, setNewOpen] = useState(params.get('nuevo') === '1');
  const [importOpen, setImportOpen] = useState(false);
  const [mergePair, setMergePair] = useState<[Product, Product] | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (params.get('nuevo') === '1') {
      setNewOpen(true);
      setParams(
        (p) => {
          p.delete('nuevo');
          return p;
        },
        { replace: true },
      );
    }
  }, [params, setParams]);

  const trends = useMemo(() => priceTrends(points ?? []), [points]);
  const supplierNames = useMemo(() => new Map((suppliers ?? []).map((s) => [s.id, s.name])), [suppliers]);
  const list = useMemo(() => filterProducts(products ?? [], filters, trends), [products, filters, trends]);
  const stats = useMemo(() => productStats(products ?? [], trends, business.priceAlertPct, todayIso()), [products, trends, business.priceAlertPct]);
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products ?? []) m.set(p.category, (m.get(p.category) ?? 0) + 1);
    return m;
  }, [products]);
  const risingCount = useMemo(() => (products ?? []).filter((p) => (trends.get(p.id)?.changePct ?? 0) > 0).length, [products, trends]);
  const yieldCount = useMemo(() => (products ?? []).filter((p) => p.yieldTestId).length, [products]);

  const setF = (patch: Partial<ProductFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setLimit(PAGE);
  };
  const toggle = (id: ID) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const visible = list.slice(0, limit);
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));
  const selectedProducts = (products ?? []).filter((p) => selected.has(p.id));

  const onDeleteSelected = async () => {
    const ids = [...selected];
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteProduct(id);
      } catch {
        failed++;
      }
    }
    setSelected(new Set());
    if (failed) toast.error(`No se pudieron eliminar ${failed} ingredientes`);
    else toast.success(ids.length === 1 ? 'Ingrediente eliminado' : `${ids.length} ingredientes eliminados`);
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const { exportProductsXlsx, downloadBlob } = await import('../lib/export');
      const blob = await exportProductsXlsx(products ?? [], suppliers ?? []);
      downloadBlob(blob, `ingredientes-${todayIso()}.xlsx`);
    } catch (e) {
      toast.error('No se pudo exportar', errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const loading = products === undefined;
  const empty = !loading && products.length === 0;
  const filtered = filters.query || filters.category !== 'todas' || filters.noPrice || filters.withYield || filters.rising;

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Compras"
        title="Ingredientes"
        subtitle="Tu base de precios: lo que pagas de verdad por cada kilo, litro o unidad, sin IVA. Se actualiza sola con cada factura confirmada."
        actions={
          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
            {!empty && (
              <Button variant="ghost" icon={<Download className="size-4" />} onClick={() => void onExport()} loading={exporting} title="Exportar a Excel">
                <span className="sm:hidden 2xl:inline">Exportar</span>
              </Button>
            )}
            <Button variant="outline" icon={<FileSpreadsheet className="size-4" />} onClick={() => setImportOpen(true)}>
              Importar tarifa
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>
              Nuevo ingrediente
            </Button>
          </div>
        }
      />

      {empty ? (
        <EmptyState
          icon={<Carrot className="size-7" />}
          title="Tu base de precios está vacía"
          description="La forma más rápida de llenarla es subir tus facturas: cada producto se convierte en un ingrediente con su precio real por kilo, litro o unidad. También puedes importar la tarifa de un proveedor o crearlos a mano."
          className="hero-mesh bg-surface"
          action={
            <>
              <Button variant="primary" size="lg" icon={<FileText className="size-4" />} onClick={() => navigate('/facturas?nuevo=1')}>
                Subir facturas
              </Button>
              <Button variant="outline" size="lg" icon={<FileSpreadsheet className="size-4" />} onClick={() => setImportOpen(true)}>
                Importar tarifa
              </Button>
              <Button variant="ghost" size="lg" icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>
                Crear a mano
              </Button>
            </>
          }
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Ingredientes" value={loading ? '—' : fmtNum(stats.total, 0)} icon={<Carrot className="size-4" />} tone="brand" hint={`${categoryCounts.size} categorías`} />
            <Stat
              label="Con precio"
              value={loading ? '—' : fmtNum(stats.withPrice, 0)}
              icon={<Tag className="size-4" />}
              tone="ok"
              hint={stats.total ? `${fmtPct((stats.withPrice / stats.total) * 100, 0)} de la base` : undefined}
            />
            <Stat
              label="Sin precio"
              value={loading ? '—' : fmtNum(stats.withoutPrice, 0)}
              icon={<PackageSearch className="size-4" />}
              tone={stats.withoutPrice > 0 ? 'warn' : 'ok'}
              hint={stats.withoutPrice > 0 ? 'sus escandallos salen incompletos' : 'todo con precio'}
            />
            <Stat
              label="Subidas recientes"
              value={loading ? '—' : fmtNum(stats.recentRises, 0)}
              icon={<TrendingUp className="size-4" />}
              tone={stats.recentRises > 0 ? 'bad' : 'ok'}
              hint={`≥ ${fmtPct(business.priceAlertPct, 0)} en los últimos 90 días`}
            />
          </div>

          <div className="mb-4 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <SearchInput value={filters.query} onChange={(v) => setF({ query: v })} placeholder="Buscar por nombre o como aparece en factura…" className="flex-1" />
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Select value={filters.category} onChange={(e) => setF({ category: e.target.value as ProductFilters['category'] })} aria-label="Categoría" className="sm:w-52">
                  <option value="todas">Todas las categorías</option>
                  {CATEGORIES.filter((c) => categoryCounts.has(c)).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c].emoji} {CATEGORY_LABELS[c].label} ({categoryCounts.get(c)})
                    </option>
                  ))}
                </Select>
                <Select value={filters.sort} onChange={(e) => setF({ sort: e.target.value as ProductSort })} aria-label="Ordenar por" className="sm:w-52">
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterChip active={filters.noPrice} onClick={() => setF({ noPrice: !filters.noPrice })} icon={<PackageSearch className="size-3.5" />} count={stats.withoutPrice}>
                Sin precio
              </FilterChip>
              <FilterChip active={filters.withYield} onClick={() => setF({ withYield: !filters.withYield })} icon={<Scale className="size-3.5" />} count={yieldCount}>
                Con prueba de merma
              </FilterChip>
              <FilterChip active={filters.rising} onClick={() => setF({ rising: !filters.rising })} icon={<TrendingUp className="size-3.5" />} count={risingCount}>
                Subidas
              </FilterChip>
              {filtered && (
                <button type="button" onClick={() => setF(DEFAULT_PRODUCT_FILTERS)} className="min-h-9 px-2 text-xs font-semibold text-muted underline-offset-2 hover:text-ink hover:underline">
                  Quitar filtros
                </button>
              )}
              <span className="ml-auto text-xs text-muted">
                {fmtNum(list.length, 0)} de {fmtNum(products?.length ?? 0, 0)}
              </span>
            </div>
          </div>

          {selected.size > 0 && (
            <div className="sticky top-16 z-20 mb-3 flex animate-slide-up flex-wrap items-center gap-2 rounded-2xl border border-brand-500/30 bg-elevated/95 p-2.5 pl-4 shadow-pop backdrop-blur-xl lg:top-4">
              <span className="text-sm font-semibold text-ink">
                {selected.size} {selected.size === 1 ? 'seleccionado' : 'seleccionados'}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Merge className="size-3.5" />}
                  disabled={selected.size !== 2}
                  title={selected.size !== 2 ? 'Selecciona exactamente 2 ingredientes' : undefined}
                  onClick={() => selectedProducts.length === 2 && setMergePair([selectedProducts[0], selectedProducts[1]])}
                >
                  Fusionar
                </Button>
                <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setAskDelete(true)}>
                  Eliminar
                </Button>
                <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setSelected(new Set())}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-2" aria-hidden>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-14 animate-pulse-soft rounded-2xl border border-line bg-surface" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center">
              <p className="text-sm text-muted">Ningún ingrediente coincide{filters.query ? ` con «${filters.query}»` : ''}.</p>
              <div className="mt-3 flex justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setF(DEFAULT_PRODUCT_FILTERS)}>
                  Quitar filtros
                </Button>
                {filters.query && (
                  <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setNewOpen(true)}>
                    Crear «{filters.query}»
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="hidden lg:block">
                <Table>
                  <thead>
                    <tr>
                      <Th className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Seleccionar todos los visibles"
                          checked={allVisibleSelected}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (allVisibleSelected) visible.forEach((p) => n.delete(p.id));
                              else visible.forEach((p) => n.add(p.id));
                              return n;
                            })
                          }
                          className="size-4 accent-brand-500"
                        />
                      </Th>
                      <Th>Ingrediente</Th>
                      <Th align="right">Precio sin IVA</Th>
                      <Th>Última compra</Th>
                      <Th align="right">Merma</Th>
                      <Th>Alérgenos</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <ProductRow key={p.id} p={p} trend={trends.get(p.id)} supplier={p.supplierId ? supplierNames.get(p.supplierId) : undefined} selected={selected.has(p.id)} onToggle={toggle} />
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="space-y-2.5 lg:hidden">
                {visible.map((p) => (
                  <ProductCard key={p.id} p={p} trend={trends.get(p.id)} supplier={p.supplierId ? supplierNames.get(p.supplierId) : undefined} selected={selected.has(p.id)} onToggle={toggle} />
                ))}
              </div>
              {list.length > limit && (
                <div className="mt-4 text-center">
                  <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
                    Mostrar más ({fmtNum(list.length - limit, 0)} restantes)
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      <NewProductModal open={newOpen} onClose={() => setNewOpen(false)} />
      <ImportPriceListModal open={importOpen} onClose={() => setImportOpen(false)} products={products ?? []} suppliers={suppliers ?? []} />
      <MergeProductsModal pair={mergePair} onClose={() => setMergePair(null)} onMerged={() => setSelected(new Set())} />
      <ConfirmDialog
        open={askDelete}
        onClose={() => setAskDelete(false)}
        title={selected.size === 1 ? '¿Eliminar este ingrediente?' : `¿Eliminar ${selected.size} ingredientes?`}
        message="Se borra también su histórico de precios. Los escandallos que lo usan conservan la línea, pero quedará sin precio hasta que la vincules a otro ingrediente."
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void onDeleteSelected()}
      />
    </div>
  );
}

function FilterChip({ active, onClick, icon, count, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; count?: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition',
        active ? 'border-brand-500 bg-brand-500 text-white shadow-glow' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {icon}
      {children}
      {count != null && <span className={clsx('tabular rounded-full px-1.5 text-[10px]', active ? 'bg-white/25' : 'bg-surface-2 text-muted')}>{count}</span>}
    </button>
  );
}

function WasteCell({ p }: { p: Product }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="tabular">{p.wastePct > 0 ? fmtPct(p.wastePct, 0) : <span className="text-muted">—</span>}</span>
      {p.yieldTestId && (
        <Badge tone="info" icon={<Scale className="size-3" />}>
          prueba
        </Badge>
      )}
    </span>
  );
}

function PriceCell({ p, trend }: { p: Product; trend?: PriceTrend }) {
  if (!(p.pricePerBase > 0))
    return (
      <Badge tone="warn" className="tabular">
        sin precio
      </Badge>
    );
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <PriceTrendChip trend={trend} baseUnit={p.baseUnit} />
      <span className="tabular font-semibold text-ink">
        {fmtEurPrecise(p.pricePerBase)}
        <span className="ml-0.5 text-xs font-medium text-muted">/{p.baseUnit}</span>
      </span>
    </span>
  );
}

function ProductRow({ p, trend, supplier, selected, onToggle }: { p: Product; trend?: PriceTrend; supplier?: string; selected: boolean; onToggle: (id: ID) => void }) {
  const navigate = useNavigate();
  return (
    <tr
      className={clsx('cursor-pointer transition hover:bg-surface-2', selected && 'bg-brand-500/5')}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('input, a, button')) return;
        navigate(`/ingredientes/${p.id}`);
      }}
    >
      <Td>
        <input type="checkbox" aria-label={`Seleccionar ${p.name}`} checked={selected} onChange={() => onToggle(p.id)} className="size-4 accent-brand-500" />
      </Td>
      <Td>
        <div className="flex min-w-0 items-center gap-3">
          <CategoryBadge category={p.category} compact />
          <div className="min-w-0">
            <Link to={`/ingredientes/${p.id}`} className="block max-w-[340px] truncate font-semibold text-ink hover:text-brand-600 dark:hover:text-brand-400">
              {p.name}
            </Link>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span>{CATEGORY_LABELS[p.category]?.label}</span>
              {p.aliases.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span title={`También aparece como: ${p.aliases.join(' · ')}`} className="cursor-help underline decoration-dotted underline-offset-2">
                    +{p.aliases.length} {p.aliases.length === 1 ? 'nombre' : 'nombres'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </Td>
      <Td align="right" className="whitespace-nowrap">
        <PriceCell p={p} trend={trend} />
      </Td>
      <Td className="max-w-[200px]">
        <div className="whitespace-nowrap">{p.lastPurchaseDate ? fmtDate(p.lastPurchaseDate) : <span className="text-muted">—</span>}</div>
        {supplier && (
          <div className="truncate text-xs text-muted" title={supplier}>
            {supplier}
          </div>
        )}
      </Td>
      <Td align="right" className="whitespace-nowrap">
        <WasteCell p={p} />
      </Td>
      <Td className="min-w-[140px]">
        <AllergenChips allergens={p.allergens} size="sm" empty={null} />
      </Td>
    </tr>
  );
}

function ProductCard({ p, trend, supplier, selected, onToggle }: { p: Product; trend?: PriceTrend; supplier?: string; selected: boolean; onToggle: (id: ID) => void }) {
  return (
    <Card padded={false} className={clsx('transition', selected && 'border-brand-500/50 bg-brand-500/5')}>
      <div className="flex items-start gap-3 p-3.5">
        <label className="-m-1.5 flex size-10 shrink-0 cursor-pointer items-center justify-center">
          <input type="checkbox" aria-label={`Seleccionar ${p.name}`} checked={selected} onChange={() => onToggle(p.id)} className="size-4 accent-brand-500" />
        </label>
        <Link to={`/ingredientes/${p.id}`} className="flex min-w-0 flex-1 items-start gap-3">
          <CategoryBadge category={p.category} compact className="size-10 text-xl" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate font-semibold text-ink">{p.name}</span>
              <span className="shrink-0 text-right">
                {p.pricePerBase > 0 ? (
                  <span className="tabular font-display text-base font-extrabold text-ink">
                    {fmtEurPrecise(p.pricePerBase)}
                    <span className="font-sans text-xs font-medium text-muted">/{p.baseUnit}</span>
                  </span>
                ) : (
                  <Badge tone="warn">sin precio</Badge>
                )}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <PriceTrendChip trend={trend} baseUnit={p.baseUnit} />
              {p.lastPurchaseDate && <span>{fmtDate(p.lastPurchaseDate)}</span>}
              {supplier && <span className="max-w-[140px] truncate">· {supplier}</span>}
              {p.wastePct > 0 && <span>· merma {fmtPct(p.wastePct, 0)}</span>}
              {p.yieldTestId && (
                <Badge tone="info" icon={<Scale className="size-3" />}>
                  prueba
                </Badge>
              )}
            </div>
            {p.allergens.length > 0 && (
              <div className="mt-2">
                <AllergenChips allergens={p.allergens} size="sm" empty={null} />
              </div>
            )}
          </div>
        </Link>
      </div>
    </Card>
  );
}
