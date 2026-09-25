import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import clsx from 'clsx';
import {
  ArrowLeft,
  Check,
  ChefHat,
  CloudOff,
  Copy,
  FlaskConical,
  Link2,
  Loader2,
  Printer,
  Soup,
  Sparkles,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import type { Dish, DishKind } from '../types';
import { useAppSettings, useBusiness, useCostingContext, useCurrentWorkspace, useDish, useDishes, useProducts } from '../state/hooks';
import { errorMessage, toast } from '../state/store';
import { deleteDish, duplicateDish, rematchDish, updateDish } from '../services/dishes';
import { aiAvailable } from '../extract/index';
import { db } from '../db';
import { fmtEur } from '../lib/format';
import { AllergenChips } from '../components/Allergens';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, IconButton, Input, NumberInput, Segmented, Select, Textarea } from '../components/ui';
import { EscandalloTable } from '../components/dishes/EscandalloTable';
import { KpiMini, KpiStrip } from '../components/dishes/KpiStrip';
import { WasteBreakdown } from '../components/dishes/WasteBreakdown';
import { PriceTargetTool } from '../components/dishes/PriceTargetTool';
import { PrintSheet } from '../components/dishes/PrintSheet';
import { ProposeModal } from '../components/dishes/ProposeModal';
import { useAutosave, useMediaQuery, type SaveState } from '../components/dishes/hooks';
import { costDraft, editablePatch, sectionsOf, usedIn, fmtPctNb } from '../components/dishes/logic';

const VAT_OPTIONS = [10, 21, 4, 0];

export default function DishEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const dbDish = useDish(id);
  const allDishes = useDishes();
  const ctx = useCostingContext();
  const products = useProducts();
  const business = useBusiness();
  const workspace = useCurrentWorkspace();
  const settings = useAppSettings();
  const aiOn = aiAvailable(settings);

  const [draft, setDraftState] = useState<Dish | null>(null);
  const draftRef = useRef<Dish | null>(null);
  const setDraft = useCallback((d: Dish | null) => {
    draftRef.current = d;
    setDraftState(d);
  }, []);

  // Marca de tiempo de nuestro último guardado: su "eco" desde la BD no debe reemplazar el borrador
  // (el servicio normaliza espacios y eso borraría, p. ej., el espacio que el usuario acaba de teclear).
  const ownStamp = useRef<string | undefined>(undefined);
  const saver = useAutosave<Dish>(
    async (d) => {
      const patch = editablePatch(d);
      if (!d.name.trim()) delete patch.name; // nombre a medio escribir: se conserva el guardado
      await updateDish(d.id, patch);
      ownStamp.current = (await db().dishes.get(d.id))?.updatedAt;
    },
    400,
    (e) => toast.error('No se pudieron guardar los cambios', errorMessage(e)),
  );
  const { isPending, schedule, flush } = saver;

  // Sincroniza el borrador con la BD (carga inicial, propuestas, cambios desde otra pestaña),
  // sin pisar lo que el usuario está escribiendo ni cambios que aún no se han podido guardar.
  useEffect(() => {
    if (!dbDish) return;
    const cur = draftRef.current;
    if (!cur || cur.id !== dbDish.id) setDraft(dbDish);
    else if (!isPending() && dbDish.updatedAt !== ownStamp.current && dbDish.updatedAt !== cur.updatedAt) setDraft(dbDish);
  }, [dbDish, isPending, setDraft]);

  // Ctrl/Cmd + S guarda al momento (por costumbre; el autoguardado ya lo hace solo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush]);

  const update = useCallback(
    (patch: Partial<Dish>) => {
      const cur = draftRef.current;
      if (!cur) return;
      const next = { ...cur, ...patch };
      setDraft(next);
      schedule(next);
    },
    [schedule, setDraft],
  );

  const cost = useMemo(() => (draft && ctx ? costDraft(ctx, draft) : undefined), [ctx, draft]);
  const sections = useMemo(() => sectionsOf(allDishes ?? []), [allDishes]);
  const users = useMemo(() => (draft && ctx ? usedIn(draft.id, ctx.dishes.values()) : []), [ctx, draft]);

  const [proposeOpen, setProposeOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<'dup' | 'match' | null>(null);
  const sectionListId = useId();
  const wideLg = useMediaQuery('(min-width: 1024px)');
  const [kpiEl, setKpiEl] = useState<HTMLDivElement | null>(null);
  const [kpiVisible, setKpiVisible] = useState(true);
  useEffect(() => {
    if (!kpiEl) return;
    const io = new IntersectionObserver(([e]) => setKpiVisible(e.isIntersecting), { rootMargin: '-64px 0px 0px 0px' });
    io.observe(kpiEl);
    return () => io.disconnect();
  }, [kpiEl]);

  const notFound = allDishes !== undefined && id != null && !allDishes.some((d) => d.id === id) && !dbDish;
  if (notFound) {
    return (
      <EmptyState
        icon={<UtensilsCrossed className="size-7" />}
        title="No encontramos este escandallo"
        description="Puede que se haya eliminado o que pertenezca a otro restaurante."
        action={
          <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/platos')}>
            Volver a escandallos
          </Button>
        }
      />
    );
  }
  if (!draft || !cost || !ctx || !products) return <EditorSkeleton />;

  const unlinked = draft.items.filter((i) => !i.ref && i.name.trim()).length;
  const isPlato = draft.kind === 'plato';

  const openPropose = async () => {
    await flush();
    setProposeOpen(true);
  };
  const doDuplicate = async () => {
    setBusy('dup');
    try {
      await flush();
      const copy = await duplicateDish(draft.id);
      toast.success('Escandallo duplicado', `«${copy.name}» listo para editar.`);
      navigate(`/platos/${copy.id}`);
    } catch (e) {
      toast.error('No se pudo duplicar', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const doDelete = async () => {
    try {
      await deleteDish(draft.id);
      toast.success('Escandallo eliminado', draft.name);
      navigate('/platos', { replace: true });
    } catch (e) {
      toast.error('No se pudo eliminar', errorMessage(e));
    }
  };
  const doRematch = async () => {
    setBusy('match');
    try {
      await flush();
      const n = await rematchDish(draft.id);
      if (n > 0) toast.success(`${n} ${n === 1 ? 'ingrediente vinculado' : 'ingredientes vinculados'}`, 'Revisa las líneas marcadas en violeta.');
      else toast.info('No hemos encontrado coincidencias', 'Elige el ingrediente en la lista o créalo desde la propia línea.');
    } catch (e) {
      toast.error('No se pudo vincular', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const doPrint = async () => {
    await flush();
    window.print();
  };

  const fichaCard = (
    <Card>
      <CardHeader icon={<Soup className="size-5" />} title="Ficha técnica" subtitle="Lo que imprimirás para cocina: descripción, elaboración y notas." />
      <div className="space-y-4">
        {isPlato && (
          <Field label="Descripción en carta">
            <Textarea value={draft.description ?? ''} onChange={(e) => update({ description: e.target.value || undefined })} rows={2} className="min-h-0!" placeholder="Como aparece en la carta" />
          </Field>
        )}
        <Field label="Elaboración y emplatado">
          <Textarea
            value={draft.procedure ?? ''}
            onChange={(e) => update({ procedure: e.target.value || undefined })}
            rows={6}
            placeholder={'1. Marcar la carne a fuego fuerte…\n2. Emplatar con la guarnición…'}
          />
        </Field>
        <Field label="Notas internas">
          <Textarea value={draft.notes ?? ''} onChange={(e) => update({ notes: e.target.value || undefined })} rows={2} className="min-h-0!" placeholder="Proveedor preferido, variaciones de temporada…" />
        </Field>
      </div>
    </Card>
  );

  return (
    <>
      <div className="no-print">
        {/* ── Cabecera ── */}
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-3">
              <Link to="/platos" className="inline-flex h-9 items-center gap-1.5 rounded-lg pr-2 text-sm font-semibold text-muted transition hover:text-ink">
                <ArrowLeft className="size-4" /> Escandallos
              </Link>
              <SaveIndicator state={saver.state} onRetry={() => void flush()} />
            </div>
            <NameField value={draft.name} onChange={(name) => update({ name })} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={isPlato ? 'brand' : 'info'} icon={isPlato ? <UtensilsCrossed className="size-3" /> : <FlaskConical className="size-3" />}>
                {isPlato ? 'Plato de carta' : 'Elaboración'}
              </Badge>
              {draft.source === 'carta-ia' || draft.source === 'carta-ocr' ? <Badge tone="neutral">De la carta</Badge> : null}
              <div className="w-44">
                <Input
                  value={draft.section ?? ''}
                  onChange={(e) => update({ section: e.target.value || undefined })}
                  placeholder="Sección"
                  list={sectionListId}
                  aria-label="Sección de la carta"
                  className="h-9!"
                />
                <datalist id={sectionListId}>
                  {sections.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <Segmented
                size="sm"
                value={draft.status}
                onChange={(v) => update({ status: v })}
                options={[
                  { value: 'borrador', label: 'Borrador' },
                  { value: 'revisado', label: 'Revisado', icon: <Check className="size-3.5" /> },
                ]}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={aiOn ? 'ai' : 'primary'} icon={<Sparkles className="size-4" />} onClick={openPropose}>
              Proponer ingredientes
            </Button>
            <Button variant="outline" icon={<Printer className="size-4" />} onClick={doPrint}>
              Ficha técnica
            </Button>
            <Button variant="outline" icon={<Copy className="size-4" />} onClick={doDuplicate} loading={busy === 'dup'} className="max-sm:px-3" aria-label="Duplicar">
              <span className="max-sm:hidden">Duplicar</span>
            </Button>
            <IconButton label="Eliminar escandallo" onClick={() => setConfirmDelete(true)} className="size-10 border border-line text-bad hover:bg-bad-soft hover:text-bad">
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        </div>

        {/* ── KPIs ── */}
        {!kpiVisible && (
          <div className="fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-20 animate-fade-in border-b border-line bg-bg/95 px-4 py-2 shadow-card backdrop-blur-xl lg:hidden">
            <KpiMini dish={draft} cost={cost} business={business} />
          </div>
        )}
        <div ref={setKpiEl} className="z-20 mb-6 lg:sticky lg:top-0 lg:-mx-2 lg:bg-bg/95 lg:px-2 lg:py-3 lg:backdrop-blur-xl">
          <KpiStrip dish={draft} cost={cost} business={business} onChange={update} usedInCount={users.length} />
        </div>

        {/* ── Escandallo ── */}
        <section aria-labelledby="escandallo-title" className="mb-6">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="escandallo-title" className="font-display text-xl font-extrabold text-ink">
                Escandallo
              </h2>
              <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-ink-2">
                Receta para
                <span className="inline-block w-16">
                  <NumberInput
                    value={draft.portions}
                    onValue={(v) => update({ portions: v != null && v >= 1 ? Math.round(v) : 1 })}
                    decimals={0}
                    min={1}
                    aria-label="Raciones de la receta"
                    className="h-9! px-2! text-center font-semibold"
                  />
                </span>
                {draft.portions === 1 ? 'ración' : 'raciones'}
              </div>
              <p className="mt-1 text-xs text-muted">Deja la merma vacía para usar la del ingrediente o la de tu prueba de rendimiento.</p>
            </div>
            {unlinked > 0 && (
              <Button size="sm" variant="outline" icon={<Link2 className="size-4" />} loading={busy === 'match'} onClick={doRematch}>
                Vincular {unlinked} automáticamente
              </Button>
            )}
          </div>
          <EscandalloTable dish={draft} cost={cost} ctx={ctx} products={products} business={business} onItemsChange={(items) => update({ items })} onPropose={openPropose} />
        </section>

        {/* ── Merma + panel lateral ── */}
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <WasteBreakdown cost={cost} portions={draft.portions} />
            {wideLg && fichaCard}
          </div>

          <aside className="space-y-6 lg:col-span-5">
            {isPlato && <PriceTargetTool dish={draft} cost={cost} business={business} onApply={(menuPrice) => update({ menuPrice })} />}

            <Card>
              <CardHeader icon={<ChefHat className="size-5" />} title="Ajustes" />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Tipo" className="col-span-2">
                  <Segmented<DishKind>
                    value={draft.kind}
                    onChange={(kind) => update({ kind })}
                    options={[
                      { value: 'plato', label: 'Plato de carta', icon: <UtensilsCrossed className="size-3.5" /> },
                      { value: 'elaboracion', label: 'Elaboración', icon: <FlaskConical className="size-3.5" /> },
                    ]}
                  />
                </Field>
                <Field label="Raciones" hint="Del total de la receta">
                  <NumberInput value={draft.portions} onValue={(v) => update({ portions: v != null && v >= 1 ? Math.round(v) : 1 })} decimals={0} min={1} />
                </Field>
                {isPlato && (
                  <Field label="IVA de venta">
                    <Select value={String(draft.saleVatPct ?? business.defaultSaleVatPct)} onChange={(e) => update({ saleVatPct: Number(e.target.value) })}>
                      {[...new Set([...VAT_OPTIONS, draft.saleVatPct ?? business.defaultSaleVatPct])].map((v) => (
                        <option key={v} value={v}>
                          {v} %{v === 10 ? ' (hostelería)' : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {isPlato && (
                  <Field label="Objetivo de food cost" hint={`Vacío = general (${fmtPctNb(business.targetFoodCostPct, 0)})`}>
                    <NumberInput
                      value={draft.targetFoodCostPct}
                      onValue={(v) => update({ targetFoodCostPct: v != null && v > 0 && v < 100 ? v : undefined })}
                      decimals={1}
                      suffix="%"
                      placeholder={String(business.targetFoodCostPct)}
                    />
                  </Field>
                )}
                {isPlato && (
                  <Field label="Unidades vendidas" hint="Para la ingeniería de menú">
                    <NumberInput value={draft.unitsSold} onValue={(v) => update({ unitsSold: v != null && v >= 0 ? Math.round(v) : undefined })} decimals={0} min={0} placeholder="0" />
                  </Field>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Alérgenos" subtitle="Se calculan solos a partir de los ingredientes vinculados y sus elaboraciones." />
              <AllergenChips allergens={cost.allergens} />
              {draft.items.some((i) => !i.ref) && <p className="mt-3 text-xs text-warn">Hay ingredientes sin vincular: sus alérgenos no se cuentan todavía.</p>}
            </Card>

            {!isPlato && (
              <Card>
                <CardHeader title="Se usa en" subtitle={users.length ? 'Platos que llevan esta elaboración' : 'Todavía ningún plato la usa'} />
                <ul className="divide-y divide-line">
                  {users.map((u) => {
                    const c = ctx.cache.get(u.id);
                    return (
                      <li key={u.id}>
                        <Link to={`/platos/${u.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-brand-600">
                          <span className="truncate font-semibold text-ink">{u.name}</span>
                          <span className="tabular text-xs text-muted">{c ? fmtEur(c.costPerPortion) : ''}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
            {!wideLg && fichaCard}
          </aside>
        </div>
      </div>

      <PrintSheet dish={draft} cost={cost} business={business} workspace={workspace} />

      <ProposeModal
        open={proposeOpen}
        dishIds={[draft.id]}
        withItems={draft.items.length}
        single
        onClose={() => setProposeOpen(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
        danger
        title={`¿Eliminar «${draft.name}»?`}
        confirmLabel="Eliminar"
        message={
          users.length
            ? `Esta elaboración se usa en ${users.length} ${users.length === 1 ? 'plato' : 'platos'}: esas líneas quedarán sin vincular. No se puede deshacer.`
            : 'Se borrará el escandallo completo. No se puede deshacer.'
        }
      />
    </>
  );
}

/** Nombre editable en línea que crece en varias líneas (nombres largos en móvil). */
function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    const onResize = () => {
      const el = ref.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\s*\n+\s*/g, ' '))}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
      onBlur={() => !value.trim() && onChange('Sin nombre')}
      aria-label="Nombre"
      spellCheck
      className="-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-xl border border-transparent bg-transparent px-2 py-1 font-display text-[26px] font-extrabold leading-tight text-ink transition hover:border-line focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 sm:text-[32px]"
    />
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'idle') return null;
  if (state === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 rounded-full bg-bad-soft px-2 py-0.5 text-[11px] font-semibold text-bad hover:underline"
        aria-live="polite"
      >
        <CloudOff className="size-3" /> Sin guardar · Reintentar
      </button>
    );
  }
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        state === 'saving' && 'bg-surface-2 text-muted',
        state === 'saved' && 'bg-ok-soft text-ok',
      )}
      aria-live="polite"
    >
      {state === 'saving' ? (
        <>
          <Loader2 className="size-3 animate-spin" /> Guardando…
        </>
      ) : (
        <>
          <Check className="size-3" /> Guardado
        </>
      )}
    </span>
  );
}

function EditorSkeleton() {
  return (
    <div className="animate-pulse-soft space-y-5" aria-busy="true" aria-label="Cargando escandallo">
      <div className="h-5 w-28 rounded-lg bg-line" />
      <div className="h-9 w-2/3 max-w-md rounded-xl bg-line" />
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-surface shadow-card" />
        ))}
      </div>
      <div className="h-80 rounded-2xl bg-surface shadow-card" />
    </div>
  );
}
