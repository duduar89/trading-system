import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, CloudAlert, CloudCheck, Copy, Flame, Loader2, PackageSearch, Scale, Snowflake, StickyNote, Trash2, Waypoints } from 'lucide-react';
import type { Product, YieldTest } from '../types';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Modal, NumberInput, Textarea, cx } from '../components/ui';
import { db } from '../db';
import { useBusiness, useDishCosts, useProducts, useYieldTests } from '../state/hooks';
import { errorMessage, toast } from '../state/store';
import { computeYield } from '../core/yield';
import { deleteYieldTest, duplicateYieldTest, linkYieldTestToProduct, productPricePerKg, updateYieldTest } from '../services/yieldTests';
import { fmtDate, fmtEur, fmtEurPrecise, fmtKg, fmtNum, fmtPct } from '../lib/format';
import { CATEGORY_LABELS } from '../lib/labels';
import { todayIso } from '../lib/id';
import { OutputsEditor } from '../components/yield/OutputsEditor';
import { YieldResultsPanel } from '../components/yield/YieldResultsPanel';
import { YieldCascade } from '../components/yield/YieldCascade';
import { YieldLinkCard } from '../components/yield/YieldLinkCard';
import { YieldProductPicker } from '../components/yield/YieldProductPicker';
import { COOKING_PRESETS, cascadeSteps } from '../components/yield/model';

const SAVE_DELAY_MS = 600;
const PORTION_PRESETS_G = [100, 150, 180, 200, 250];

/** Editor de una prueba de rendimiento con autoguardado y resultados en vivo. */
export default function YieldTestEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const tests = useYieldTests();
  const stored = tests?.find((t) => t.id === id);
  // Recién creada o duplicada: puede existir antes de que la lista reactiva se refresque. Lo comprobamos en la BD
  // para no mostrar un "no encontrada" fugaz.
  const [probe, setProbe] = useState<{ id: string; exists: boolean } | null>(null);
  useEffect(() => {
    if (!tests || stored || !id) return;
    let alive = true;
    db()
      .yieldTests.get(id)
      .then((t) => alive && setProbe({ id, exists: !!t }))
      .catch(() => alive && setProbe({ id, exists: false }));
    return () => {
      alive = false;
    };
  }, [tests, stored, id]);

  if (!tests || (!stored && (!probe || probe.id !== id || probe.exists))) return <EditorSkeleton />;
  if (!stored) {
    return (
      <EmptyState
        className="mt-6"
        icon={<Scale className="size-7" />}
        title="No encontramos esta prueba"
        description="Puede que se haya borrado o que el enlace sea de otro restaurante."
        action={
          <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/mermas')}>
            Volver a las pruebas
          </Button>
        }
      />
    );
  }
  return <Editor key={stored.id} initial={stored} allTests={tests} />;
}

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

function Editor({ initial, allTests }: { initial: YieldTest; allTests: YieldTest[] }) {
  const navigate = useNavigate();
  const products = useProducts();
  const business = useBusiness();
  const dishCosts = useDishCosts();

  const [draft, setDraft] = useState<YieldTest>(initial);
  const draftRef = useRef(draft);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [productModal, setProductModal] = useState(false);
  const [pricePrompt, setPricePrompt] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  // ── Autoguardado (parches acumulados, guardados en serie) ──
  const testId = useRef(initial.id);
  const pending = useRef<Partial<YieldTest>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const deleted = useRef(false);

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    const p = pending.current;
    if (deleted.current || !Object.keys(p).length) return chain.current;
    pending.current = {};
    setSaveState('saving');
    chain.current = chain.current
      .then(() => updateYieldTest(testId.current, p))
      .then(
        () => {
          if (!Object.keys(pending.current).length) setSaveState('saved');
        },
        (e: unknown) => {
          if (deleted.current) return;
          pending.current = { ...p, ...pending.current };
          setSaveState('error');
          toast.error('No se han podido guardar los cambios', errorMessage(e));
        },
      );
    return chain.current;
  }, []);

  const patch = useCallback(
    (p: Partial<YieldTest>) => {
      const next = { ...draftRef.current, ...p };
      draftRef.current = next;
      setDraft(next);
      pending.current = { ...pending.current, ...p };
      setSaveState('pending');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  // Guardar al salir de la página o al ocultar la pestaña.
  useEffect(() => {
    const onHide = () => void flush();
    const onVisibility = () => document.visibilityState === 'hidden' && void flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      void flush();
    };
  }, [flush]);

  // ── Datos derivados ──
  const product = useMemo(() => products?.find((p) => p.id === draft.productId), [products, draft.productId]);
  const productPrice = productPricePerKg(product);
  const linked = !!product && product.yieldTestId === draft.id;
  const otherLinkedTest = product?.yieldTestId && product.yieldTestId !== draft.id ? allTests.find((t) => t.id === product.yieldTestId) : undefined;
  const result = useMemo(() => computeYield(draft), [draft]);
  const deferred = useDeferredValue(draft);
  const deferredResult = useMemo(() => computeYield(deferred), [deferred]);
  const steps = useMemo(() => cascadeSteps(deferred, deferredResult), [deferred, deferredResult]);
  const usableFactor = draft.purchasePricePerKg > 0 && result.principalKg > 0 ? result.costPerUsableKg / draft.purchasePricePerKg : 0;

  // ── Acciones ──
  function changeProduct(p: Product | undefined) {
    const wasLinked = linked;
    const old = product;
    setProductModal(false);
    if (p?.id === draft.productId) return;
    patch({ productId: p?.id });
    const pp = productPricePerKg(p);
    setPricePrompt(pp != null && Math.abs(pp - draftRef.current.purchasePricePerKg) > 0.004 ? pp : null);
    if (wasLinked && old) {
      toast.info('Prueba desvinculada', `${old.name} vuelve a su merma genérica.${p ? ` Actívala para ${p.name} si quieres aplicarla.` : ''}`);
    }
  }

  async function toggleLink(on: boolean) {
    if (!product) return;
    setLinkBusy(true);
    try {
      await flush();
      await linkYieldTestToProduct(draft.id, on ? product.id : undefined);
      if (on) toast.success('Prueba aplicada', `Los escandallos con ${product.name} ya usan su rendimiento real.`);
      else toast.info('Prueba desactivada', `${product.name} vuelve a su merma genérica (${fmtPct(product.wastePct, 0)}).`);
    } catch (e) {
      toast.error('No se ha podido cambiar el vínculo', errorMessage(e));
    } finally {
      setLinkBusy(false);
    }
  }

  async function duplicate() {
    setDuplicating(true);
    try {
      await flush();
      const copy = await duplicateYieldTest(draft.id);
      toast.success('Prueba duplicada', 'Ajusta los pesos con la nueva pieza.');
      navigate(`/mermas/${copy.id}`);
    } catch (e) {
      toast.error('No se ha podido duplicar', errorMessage(e));
    } finally {
      setDuplicating(false);
    }
  }

  async function remove() {
    deleted.current = true;
    clearTimeout(timer.current);
    pending.current = {};
    const name = draft.name;
    navigate('/mermas', { replace: true });
    try {
      await chain.current;
      await deleteYieldTest(testId.current);
      toast.success('Prueba borrada', `«${name}» ya no se aplica a ningún escandallo.`);
    } catch (e) {
      toast.error('No se ha podido borrar la prueba', errorMessage(e));
    }
  }

  const portionG = draft.portionKg ? draft.portionKg * 1000 : undefined;

  return (
    <div className="animate-fade-in">
      {/* Cabecera */}
      <div className="mb-5">
        <Link to="/mermas" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-ink">
          <ArrowLeft className="size-4" /> Pruebas de rendimiento
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-brand-500">Prueba de rendimiento</div>
            <h1 className="line-clamp-2 font-display text-2xl font-extrabold text-ink sm:text-3xl">{draft.name.trim() || 'Prueba sin nombre'}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span>{product?.name ?? 'Sin producto'}</span>
              <span aria-hidden>·</span>
              <span>{fmtDate(draft.date)}</span>
              {linked && <Badge tone="ok">En escandallos</Badge>}
              <SaveIndicator state={saveState} onRetry={() => void flush()} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" icon={<Copy className="size-4" />} onClick={duplicate} loading={duplicating}>
              Duplicar
            </Button>
            <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
              Borrar
            </Button>
          </div>
        </div>
      </div>

      {/* Resumen fijo en móvil y tableta */}
      <a
        href="#resultado"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('resultado')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 -mx-4 mb-4 flex items-center justify-between gap-3 border-y border-line bg-surface/92 px-4 py-2.5 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8 xl:hidden"
        aria-label="Ver resultado completo"
      >
        <SummaryItem label="Rinde" value={result.principalKg > 0 ? fmtPct(result.yieldPct, 0) : '—'} />
        <SummaryItem label="Merma" value={result.grossWeightKg > 0 ? fmtPct(result.totalWastePct, 0) : '—'} />
        <SummaryItem
          label={usableFactor > 0 ? `€/kg útil ×${fmtNum(usableFactor, 2)}` : '€/kg útil'}
          value={usableFactor > 0 ? fmtEur(result.costPerUsableKg) : '—'}
          strong
        />
        {result.wastePerPortionKg != null && <SummaryItem label="Merma/ración" value={fmtKg(result.wastePerPortionKg)} className="hidden min-[400px]:block" />}
      </a>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
        {/* ── Formulario ── */}
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader icon={<Scale className="size-4" />} title="La pieza" subtitle="Pésala tal cual llega del proveedor, antes de limpiar." />
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4">
              <Field label="Nombre de la prueba" className="col-span-2">
                <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="p. ej. Salmón noruego · lote de octubre" />
              </Field>
              <div className="col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-ink-2">Producto</span>
                <button
                  type="button"
                  onClick={() => setProductModal(true)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-line-strong bg-surface px-3 py-2 text-left transition hover:border-brand-400 focus-visible:outline-2 focus-visible:outline-brand-500"
                >
                  {product ? (
                    <>
                      <span className="text-xl" aria-hidden>
                        {CATEGORY_LABELS[product.category]?.emoji ?? '📦'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-ink">{product.name}</span>
                        <span className="tabular block text-xs text-muted">
                          {product.pricePerBase > 0 ? `${fmtEurPrecise(product.pricePerBase)} / ${product.baseUnit} en factura` : 'Sin precio todavía'}
                        </span>
                      </span>
                      <span className="text-xs font-semibold text-brand-600 dark:text-brand-400">Cambiar</span>
                    </>
                  ) : (
                    <>
                      <PackageSearch className="size-5 text-muted" />
                      <span className="flex-1 text-sm text-muted">Elige el producto de tus facturas</span>
                      <span className="text-xs font-semibold text-brand-600 dark:text-brand-400">Elegir</span>
                    </>
                  )}
                </button>
              </div>
              <Field label="Fecha de la prueba" className="col-span-2 sm:col-span-1">
                <Input type="date" value={draft.date} max={todayIso()} onChange={(e) => patch({ date: e.target.value || todayIso() })} />
              </Field>
              <Field label="Peso bruto" hint="Pieza entera, sin limpiar">
                <NumberInput value={draft.grossWeightKg || undefined} onValue={(v) => patch({ grossWeightKg: v ?? 0 })} min={0} suffix="kg" placeholder="0,000" />
              </Field>
              <div>
                <Field label="Precio de compra" hint="Sin IVA, por kg bruto">
                  <NumberInput
                    value={draft.purchasePricePerKg || undefined}
                    onValue={(v) => {
                      setPricePrompt(null);
                      patch({ purchasePricePerKg: v ?? 0 });
                    }}
                    min={0}
                    decimals={4}
                    suffix="€/kg"
                    placeholder="0,00"
                  />
                </Field>
                {productPrice != null && Math.abs(productPrice - draft.purchasePricePerKg) > 0.004 && (
                  <button
                    type="button"
                    onClick={() => {
                      setPricePrompt(null);
                      patch({ purchasePricePerKg: Math.round(productPrice * 10000) / 10000 });
                    }}
                    className={cx(
                      'mt-1 inline-flex min-h-10 items-center rounded-lg px-2 text-left text-xs font-semibold transition',
                      pricePrompt != null ? 'animate-pulse-soft bg-brand-500 text-white' : 'text-brand-600 hover:bg-brand-500/10 dark:text-brand-400',
                    )}
                  >
                    Usar precio actual del producto ({fmtEurPrecise(productPrice)}/kg)
                  </button>
                )}
              </div>
              <Field label="Merma de descongelación" hint="Sólo si la compras congelada: pesa antes y después de descongelar" className="col-span-2 sm:col-span-1">
                <NumberInput
                  value={draft.thawLossPct}
                  onValue={(v) => patch({ thawLossPct: v && v > 0 ? Math.min(99, v) : undefined })}
                  min={0}
                  decimals={1}
                  suffix="%"
                  placeholder="0"
                  prefix={<Snowflake className="size-3.5" />}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={<Waypoints className="size-4" />}
              title="¿Qué sale de la pieza?"
              subtitle="Pesa cada parte por separado. Lo que va al plato es aprovechable; lo que reutilizas (espinas para fumet, recortes) es subproducto y resta coste."
            />
            <OutputsEditor
              outputs={draft.outputs}
              grossWeightKg={draft.grossWeightKg}
              thawLossPct={draft.thawLossPct}
              onChange={(outputs) => patch({ outputs })}
            />
          </Card>

          <Card>
            <CardHeader icon={<Flame className="size-4" />} title="Cocción y ración" subtitle="Para saber cuánto pierde al cocinar y cuánta merma lleva cada plato." />
            <div className="@container">
              <div className="grid gap-5 @min-[46rem]:grid-cols-2">
                <div>
                  <Field label="Merma de cocción" hint="Peso que pierde la parte aprovechable al cocinarla">
                    <NumberInput value={draft.cookingLossPct} onValue={(v) => patch({ cookingLossPct: v ?? 0 })} min={0} decimals={1} suffix="%" placeholder="0" />
                  </Field>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {COOKING_PRESETS.map((c) => (
                      <Chip key={c.label} active={draft.cookingLossPct === c.pct} onClick={() => patch({ cookingLossPct: c.pct })}>
                        {c.label} {c.pct > 0 && <span className="tabular opacity-70">{c.pct} %</span>}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <Field label="Gramaje por ración" hint={draft.cookingLossPct > 0 ? 'Peso ya cocinado, tal cual se sirve' : 'Peso servido en el plato'}>
                    <NumberInput value={portionG} onValue={(v) => patch({ portionKg: v && v > 0 ? v / 1000 : undefined })} min={0} decimals={0} suffix="g" placeholder="150" />
                  </Field>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {PORTION_PRESETS_G.map((g) => (
                      <Chip key={g} active={portionG != null && Math.abs(portionG - g) < 0.5} onClick={() => patch({ portionKg: g / 1000 })}>
                        <span className="tabular">{g} g</span>
                      </Chip>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <YieldLinkCard
            test={deferred}
            product={product}
            linked={linked}
            otherLinkedTest={otherLinkedTest}
            costing={dishCosts?.ctx}
            business={business}
            canLink={result.principalKg > 0}
            busy={linkBusy}
            onToggle={toggleLink}
            onPickProduct={() => setProductModal(true)}
          />

          <Card>
            <CardHeader icon={<StickyNote className="size-4" />} title="Notas" subtitle="Proveedor, calibre, quién la hizo… lo que te ayude a repetirla." />
            <Textarea value={draft.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} placeholder="p. ej. Pieza de 5,4 kg del proveedor habitual, calibre 4-5. Limpia Marta." />
          </Card>
        </div>

        {/* ── Resultados ── */}
        <aside id="resultado" className="min-w-0 scroll-mt-28 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:self-start xl:overflow-y-auto xl:pb-20 xl:pr-1">
          <div className="space-y-5">
            <Card>
              <CardHeader title="Resultado" subtitle="Se recalcula mientras escribes" />
              <YieldResultsPanel test={draft} result={result} currentProductPrice={product?.baseUnit === 'kg' ? productPrice : undefined} />
            </Card>
            {steps.length > 0 && (
              <Card>
                <CardHeader title="De la compra al plato" subtitle="Dónde se va cada kilo de la pieza" />
                <YieldCascade steps={steps} grossKg={deferredResult.grossWeightKg} />
              </Card>
            )}
          </div>
        </aside>
      </div>

      <Modal open={productModal} onClose={() => setProductModal(false)} title="Producto de la pieza" subtitle="El ingrediente de tus facturas al que corresponde esta prueba." size="md">
        <YieldProductPicker products={products} value={draft.productId} onChange={changeProduct} hint={draft.name} autoFocus />
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title="¿Borrar esta prueba?"
        message={
          linked && product
            ? `Los escandallos con ${product.name} volverán a usar su merma genérica. Esta acción no se puede deshacer.`
            : 'Se borrará la prueba y dejará de aplicarse en cualquier escandallo. Esta acción no se puede deshacer.'
        }
        confirmLabel="Borrar prueba"
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'idle') return null;
  if (state === 'error')
    return (
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-xs font-semibold text-bad hover:underline">
        <CloudAlert className="size-3.5" /> Sin guardar · reintentar
      </button>
    );
  if (state === 'saved')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ok" role="status">
        <CloudCheck className="size-3.5" /> Guardado
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted" role="status">
      <Loader2 className="size-3.5 animate-spin" /> Guardando…
    </span>
  );
}

function SummaryItem({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className={cx('truncate font-display text-base font-extrabold leading-tight sm:text-lg', strong ? 'text-brand-600 dark:text-brand-400' : 'text-ink')}>{value}</div>
      <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex h-10 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition active:scale-95',
        active ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function EditorSkeleton() {
  return (
    <div className="animate-fade-in space-y-5" aria-busy="true" aria-label="Cargando prueba">
      <div className="h-4 w-40 animate-pulse-soft rounded bg-line" />
      <div className="h-9 w-72 max-w-full animate-pulse-soft rounded-lg bg-line" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <div className="h-72 animate-pulse-soft rounded-2xl border border-line bg-surface" />
          <div className="h-80 animate-pulse-soft rounded-2xl border border-line bg-surface" />
        </div>
        <div className="h-[32rem] animate-pulse-soft rounded-2xl border border-line bg-surface" />
      </div>
    </div>
  );
}
