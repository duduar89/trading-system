import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, History, Merge, PackageSearch, PencilLine, Receipt, Trash2, TriangleAlert } from 'lucide-react';
import type { Allergen, BaseUnit, ID, IngredientCategory, Product } from '../types';
import { db } from '../db';
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui';
import { AllergenPicker } from '../components/Allergens';
import { useDishCosts, useDishes, usePricePoints, useProducts, useSuppliers, useYieldTests } from '../state/hooks';
import { errorMessage, toast } from '../state/store';
import { deleteProduct, updateProduct } from '../services/products';
import { CATEGORIES, CATEGORY_LABELS } from '../lib/labels';
import { fmtDate, fmtEurPrecise, fmtNum } from '../lib/format';
import { CategoryBadge } from '../components/purchases/CategoryBadge';
import { ChangePct, PriceTrendChip, SaveIndicator } from '../components/purchases/badges';
import { PriceHistoryChart, SOURCE_LABELS } from '../components/purchases/PriceHistoryChart';
import { AliasEditor, ChangePriceModal } from '../components/purchases/ProductEditors';
import { PriceSimulator, UsageCard, YieldCard } from '../components/purchases/ProductInsights';
import { MergeProductsModal } from '../components/purchases/MergeProductsModal';
import { ProductPicker } from '../components/purchases/ProductPicker';
import { useDebouncedAction } from '../components/purchases/hooks';
import { pctChange, priceTrends, sortPricePoints } from '../components/purchases/logic';
import { AmountInput } from '../components/purchases/AmountInput';

type FormDraft = Pick<
  Product,
  'name' | 'category' | 'baseUnit' | 'unitWeightKg' | 'densityKgPerL' | 'wastePct' | 'cookingLossPct' | 'purchaseVatPct' | 'supplierId' | 'notes' | 'allergens'
>;
type SaveState = 'idle' | 'saving' | 'saved' | 'dirty' | 'error';

const PRICE_SOURCE_TEXT: Record<Product['priceSource'], string> = {
  factura: 'De tu última factura',
  manual: 'Precio introducido a mano',
  hoja: 'De una tarifa importada',
  demo: 'Dato de demostración',
};

function toForm(p: Product): FormDraft {
  return {
    name: p.name,
    category: p.category,
    baseUnit: p.baseUnit,
    unitWeightKg: p.unitWeightKg,
    densityKgPerL: p.densityKgPerL,
    wastePct: p.wastePct,
    cookingLossPct: p.cookingLossPct,
    purchaseVatPct: p.purchaseVatPct,
    supplierId: p.supplierId,
    notes: p.notes,
    allergens: p.allergens ?? [],
  };
}

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  // undefined = cargando · null = no existe
  const product = useLiveQuery(async () => (id ? ((await db().products.get(id)) ?? null) : null), [id]);
  const products = useProducts();
  const suppliers = useSuppliers();
  const points = usePricePoints(id);
  const dishes = useDishes();
  const dishCosts = useDishCosts();
  const tests = useYieldTests();

  const [form, setForm] = useState<FormDraft | null>(null);
  const loadedId = useRef<ID | null>(null);
  const initialUnit = useRef<BaseUnit | null>(null);
  const pending = useRef<Partial<Product>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [priceOpen, setPriceOpen] = useState(false);
  const [mergeWith, setMergeWith] = useState<Product | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);

  useEffect(() => {
    if (product && loadedId.current !== product.id) {
      loadedId.current = product.id;
      initialUnit.current = product.baseUnit;
      setForm(toForm(product));
    }
  }, [product]);

  const persist = useCallback(async () => {
    const patch = pending.current;
    pending.current = {};
    const pid = loadedId.current;
    if (!pid || !Object.keys(patch).length) return;
    setSaveState('saving');
    try {
      await updateProduct(pid, patch);
      setSaveState(Object.keys(pending.current).length ? 'dirty' : 'saved');
    } catch (e) {
      pending.current = { ...patch, ...pending.current };
      setSaveState('error');
      toast.error('No se pudieron guardar los cambios', errorMessage(e));
    }
  }, []);
  const [schedule] = useDebouncedAction(() => void persist(), 700);

  const change = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    if (key === 'name' && !String(value ?? '').trim()) return; // un nombre vacío no se guarda
    pending.current = { ...pending.current, [key]: key === 'name' ? String(value).trim() : value };
    setSaveState('dirty');
    schedule();
  };

  const trend = useMemo(() => (id ? priceTrends(points ?? []).get(id) : undefined), [points, id]);
  const supplierNames = useMemo(() => new Map((suppliers ?? []).map((s) => [s.id, s.name])), [suppliers]);
  const history = useMemo(() => sortPricePoints(points ?? []).reverse(), [points]);

  const onDelete = async () => {
    if (!product) return;
    try {
      await deleteProduct(product.id);
      toast.success('Ingrediente eliminado', product.name);
      navigate('/ingredientes');
    } catch (e) {
      toast.error('No se pudo eliminar', errorMessage(e));
    }
  };

  if (product === undefined || (product && !form)) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="size-7" />
      </div>
    );
  }
  if (product === null || !form) {
    return (
      <EmptyState
        icon={<PackageSearch className="size-7" />}
        title="No encontramos este ingrediente"
        description="Puede que se haya eliminado o fusionado con otro."
        action={
          <Button onClick={() => navigate('/ingredientes')} icon={<ArrowLeft className="size-4" />}>
            Volver a ingredientes
          </Button>
        }
      />
    );
  }

  const unit = form.baseUnit;
  const unitChanged = initialUnit.current != null && unit !== initialUnit.current && product.pricePerBase > 0;
  const shownHistory = showAllHistory ? history : history.slice(0, 6);

  return (
    <div className="animate-fade-in">
      <Link to="/ingredientes" className="mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg text-sm font-semibold text-muted transition hover:text-ink">
        <ArrowLeft className="size-4" /> Ingredientes
      </Link>
      <PageHeader
        eyebrow={<CategoryBadge category={form.category} className="normal-case tracking-normal" />}
        title={form.name || product.name}
        subtitle={`Se compra por ${product.baseUnit}${product.supplierId && supplierNames.get(product.supplierId) ? ` · ${supplierNames.get(product.supplierId)}` : ''}${product.aliases.length ? ` · ${product.aliases.length} ${product.aliases.length === 1 ? 'nombre alternativo' : 'nombres alternativos'}` : ''}`}
        actions={<SaveIndicator state={saveState} />}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-5">
          {/* Precio */}
          <Card className="relative overflow-hidden">
            <div className="hero-mesh pointer-events-none absolute inset-0 opacity-60" aria-hidden />
            <div className="relative">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">Precio vigente sin IVA</div>
                  {product.pricePerBase > 0 ? (
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-display text-5xl font-extrabold text-ink">{fmtEurPrecise(product.pricePerBase)}</span>
                      <span className="text-lg font-semibold text-muted">/{product.baseUnit}</span>
                      <PriceTrendChip trend={trend} baseUnit={product.baseUnit} className="text-xs" />
                    </div>
                  ) : (
                    <div className="mt-1 font-display text-3xl font-extrabold text-warn">Sin precio</div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                    <span>{product.pricePerBase > 0 ? PRICE_SOURCE_TEXT[product.priceSource] : 'Sube una factura o indícalo a mano'}</span>
                    {product.lastPurchaseDate && <span>· Última compra {fmtDate(product.lastPurchaseDate)}</span>}
                  </div>
                </div>
                <Button variant={product.pricePerBase > 0 ? 'outline' : 'primary'} icon={<PencilLine className="size-4" />} onClick={() => setPriceOpen(true)} className="shrink-0">
                  Cambiar precio
                </Button>
              </div>

              {history.length >= 2 && (
                <div className="mt-5">
                  <PriceHistoryChart points={points ?? []} baseUnit={product.baseUnit} supplierNames={supplierNames} />
                </div>
              )}
            </div>
          </Card>

          {/* Histórico */}
          <Card>
            <CardHeader icon={<History className="size-5" />} title="Histórico de precios" subtitle={history.length ? `${history.length} ${history.length === 1 ? 'precio registrado' : 'precios registrados'}` : 'Aún sin compras registradas'} />
            {history.length === 0 ? (
              <p className="text-sm text-muted">Cuando confirmes una factura con este ingrediente, cada compra quedará aquí con su fecha, proveedor y precio.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="tabular w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted">
                        <th className="py-2 pr-2">Fecha</th>
                        <th className="px-2 py-2 text-right">Precio</th>
                        <th className="px-2 py-2 text-right">Variación</th>
                        <th className="px-2 py-2">Origen</th>
                        <th className="py-2 pl-2">Proveedor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownHistory.map((pt, i) => {
                        const prev = history[i + 1];
                        return (
                          <tr key={pt.id} className="border-t border-line">
                            <td className="whitespace-nowrap py-2 pr-2 text-ink-2">{fmtDate(pt.date)}</td>
                            <td className="whitespace-nowrap px-2 py-2 text-right font-semibold text-ink">
                              {fmtEurPrecise(pt.pricePerBase)}
                              <span className="text-xs font-normal text-muted">/{product.baseUnit}</span>
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-right">{prev ? <ChangePct pct={pctChange(prev.pricePerBase, pt.pricePerBase)} /> : <span className="text-xs text-muted">—</span>}</td>
                            <td className="px-2 py-2">
                              {pt.invoiceId ? (
                                <Link to={`/facturas/${pt.invoiceId}`} className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-400" title={pt.rawDescription}>
                                  <Receipt className="size-3.5" /> Factura
                                </Link>
                              ) : (
                                <span className="text-ink-2">{SOURCE_LABELS[pt.source]}</span>
                              )}
                            </td>
                            <td className="max-w-[180px] truncate py-2 pl-2 text-ink-2">{pt.supplierId ? (supplierNames.get(pt.supplierId) ?? '—') : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {history.length > 6 && (
                  <button type="button" onClick={() => setShowAllHistory((s) => !s)} className="mt-2 min-h-10 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                    {showAllHistory ? 'Ver menos' : `Ver los ${history.length} precios`}
                  </button>
                )}
              </>
            )}
          </Card>

          <UsageCard product={product} dishes={dishes} costs={dishCosts?.costs} />
          <PriceSimulator key={product.id} product={product} ctx={dishCosts?.ctx} />
        </div>

        <div className="min-w-0 space-y-5">
          {/* Ficha */}
          <Card>
            <CardHeader title="Ficha del ingrediente" subtitle="Se guarda sola mientras escribes" />
            <div className="space-y-4">
              <Field label="Nombre" error={!form.name.trim() ? 'El nombre no puede quedar vacío' : undefined}>
                <Input value={form.name} onChange={(e) => change('name', e.target.value)} />
              </Field>
              <AliasEditor product={product} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Categoría">
                  <Select value={form.category} onChange={(e) => change('category', e.target.value as IngredientCategory)}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c].emoji} {CATEGORY_LABELS[c].label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Se compra por">
                  <Select value={form.baseUnit} onChange={(e) => change('baseUnit', e.target.value as BaseUnit)}>
                    <option value="kg">Kilo (kg)</option>
                    <option value="l">Litro (l)</option>
                    <option value="ud">Unidad (ud)</option>
                  </Select>
                </Field>
              </div>
              {unitChanged && (
                <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-xs text-ink-2">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
                  Cambiar la unidad no convierte el precio: {fmtEurPrecise(product.pricePerBase)} pasará a ser por {unit}. Revisa el precio y las recetas que lo usan.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Peso de 1 unidad" hint={unit === 'ud' ? 'Para recetas por peso' : 'Opcional'}>
                  <AmountInput
                    value={form.unitWeightKg != null ? form.unitWeightKg * 1000 : undefined}
                    onValue={(v) => change('unitWeightKg', v != null && v > 0 ? v / 1000 : undefined)}
                    decimals={1}
                    suffix="g"
                    min={0}
                  />
                </Field>
                <Field label="Densidad" hint={unit === 'l' ? 'kg por litro (agua = 1)' : 'Sólo líquidos'}>
                  <AmountInput value={form.densityKgPerL} onValue={(v) => change('densityKgPerL', v != null && v > 0 ? v : undefined)} decimals={3} suffix="kg/l" min={0} />
                </Field>
                <Field label="Merma de limpieza" hint={product.yieldTestId ? 'Manda la prueba de rendimiento' : 'Lo que se tira al limpiar'}>
                  <AmountInput value={form.wastePct} onValue={(v) => change('wastePct', Math.min(99, Math.max(0, v ?? 0)))} decimals={1} suffix="%" min={0} />
                </Field>
                <Field label="Merma de cocción" hint="Peso que pierde al cocinarse">
                  <AmountInput value={form.cookingLossPct} onValue={(v) => change('cookingLossPct', Math.min(99, Math.max(0, v ?? 0)))} decimals={1} suffix="%" min={0} />
                </Field>
                <Field label="IVA de compra">
                  <Select value={form.purchaseVatPct ?? ''} onChange={(e) => change('purchaseVatPct', e.target.value === '' ? undefined : Number(e.target.value))}>
                    <option value="">Sin indicar</option>
                    <option value="4">4 %</option>
                    <option value="10">10 %</option>
                    <option value="21">21 %</option>
                  </Select>
                </Field>
                <Field label="Proveedor habitual">
                  <Select value={form.supplierId ?? ''} onChange={(e) => change('supplierId', e.target.value || undefined)}>
                    <option value="">Sin proveedor</option>
                    {(suppliers ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div role="group" aria-labelledby="product-allergens">
                <span id="product-allergens" className="mb-1.5 block text-xs font-semibold text-ink-2">
                  Alérgenos
                </span>
                <AllergenPicker value={form.allergens} onChange={(v: Allergen[]) => change('allergens', v)} />
                <span className="mt-1 block text-xs text-muted">Se trasladan automáticamente a la ficha de cada plato que lo lleve.</span>
              </div>
              <Field label="Notas">
                <Textarea value={form.notes ?? ''} onChange={(e) => change('notes', e.target.value || undefined)} placeholder="Calibre, marca preferida, conservación…" rows={3} />
              </Field>
            </div>
          </Card>

          <YieldCard product={product} tests={tests} />

          {/* Zona de peligro */}
          <Card className="border-bad/25">
            <CardHeader title="Duplicados y borrado" subtitle="Acciones que afectan a tus escandallos" />
            <div className="space-y-3">
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-ink-2">Fusionar con otro ingrediente</span>
                <ProductPicker
                  products={products ?? []}
                  excludeIds={[product.id]}
                  seed={product.name}
                  label="Elegir el ingrediente duplicado"
                  onSelect={(p) => setMergeWith(p)}
                >
                  <Merge className="size-4 shrink-0 text-muted" />
                  <span className="flex-1 text-muted">Buscar el duplicado…</span>
                </ProductPicker>
                <p className="mt-1 text-xs text-muted">Útil cuando el mismo producto aparece con dos nombres (p. ej. de dos proveedores).</p>
              </div>
              <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" icon={<Trash2 className="size-4" />} onClick={() => setAskDelete(true)}>
                Eliminar ingrediente
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {priceOpen && <ChangePriceModal product={product} open onClose={() => setPriceOpen(false)} />}
      <MergeProductsModal
        pair={mergeWith ? [product, mergeWith] : null}
        defaultKeepId={product.id}
        onClose={() => setMergeWith(null)}
        onMerged={(keepId) => {
          if (keepId !== product.id) navigate(`/ingredientes/${keepId}`, { replace: true });
        }}
      />
      <ConfirmDialog
        open={askDelete}
        onClose={() => setAskDelete(false)}
        title={`¿Eliminar «${product.name}»?`}
        message={`Se borra su histórico de ${fmtNum(history.length, 0)} ${history.length === 1 ? 'precio' : 'precios'}. Las recetas que lo usan conservan la línea, pero sin precio hasta que la vincules a otro ingrediente.`}
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void onDelete()}
      />
    </div>
  );
}
