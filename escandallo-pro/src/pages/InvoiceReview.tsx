import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  FileSearch,
  PencilLine,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { ID, Invoice, InvoiceLine, Product } from '../types';
import { db } from '../db';
import { Badge, Button, Callout, ConfirmDialog, EmptyState, PageHeader, Segmented, Spinner } from '../components/ui';
import { useAppSettings, useDishCosts, useDishes, useInvoices, useProducts, useSuppliers } from '../state/hooks';
import { errorMessage, toast } from '../state/store';
import { confirmInvoice, deleteInvoice, newInvoiceLine, processInvoice, refreshInvoiceMatches, updateInvoice } from '../services/invoices';
import { aiAvailable } from '../extract/index';
import { fmtDate, fmtEur } from '../lib/format';
import { FilePreview } from '../components/purchases/FilePreview';
import { InvoiceLinesTable, type LinePatchMeta } from '../components/purchases/InvoiceLinesTable';
import { InvoiceHeaderForm, TotalsBar, type InvoiceDraft } from '../components/purchases/InvoiceHeaderForm';
import { ConfirmResultModal, type ConfirmOutcome } from '../components/purchases/ConfirmResultModal';
import { InvoiceProcessing } from '../components/purchases/ProcessingQueue';
import { InvoiceStatusBadge, MethodBadge, SaveIndicator } from '../components/purchases/badges';
import { DropdownMenu } from '../components/purchases/DropdownMenu';
import { useDebouncedAction, useInvoiceQueue, useMediaQuery } from '../components/purchases/hooks';
import { lineConversion, recomputeLine } from '../components/purchases/lineEdit';
import { diffPrices, findDuplicateInvoice, invoiceNetAmount, summarizeLines, totalsCheck, type PriceSnapshot } from '../components/purchases/logic';

type LineFilter = 'todas' | 'decidir' | 'avisos';
type SaveState = 'idle' | 'saving' | 'saved' | 'dirty' | 'error';

function toDraft(inv: Invoice): InvoiceDraft {
  return {
    supplierName: inv.supplierName ?? '',
    supplierTaxId: inv.supplierTaxId,
    number: inv.number,
    date: inv.date,
    subtotal: inv.subtotal,
    vatTotal: inv.vatTotal,
    total: inv.total,
    lines: inv.lines ?? [],
  };
}

export default function InvoiceReview() {
  const { id } = useParams();
  // Un estado por factura: al pasar de una a otra sin salir de la pantalla (historial, enlace directo o navegación rápida)
  // no se arrastran el borrador, sus guardados pendientes ni los diálogos abiertos de la anterior.
  return <InvoiceReviewScreen key={id} />;
}

function InvoiceReviewScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  // undefined = cargando · null = no existe
  const invoice = useLiveQuery(async () => (id ? ((await db().invoices.get(id)) ?? null) : null), [id]);
  const products = useProducts();
  const suppliers = useSuppliers();
  const settings = useAppSettings();
  const dishes = useDishes();
  const dishCosts = useDishCosts();
  const invoices = useInvoices();
  const queue = useInvoiceQueue();

  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const draftRef = useRef<InvoiceDraft | null>(null);
  const dirtyRef = useRef(false);
  const packManual = useRef(new Set<ID>());
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lineFilter, setLineFilter] = useState<LineFilter>('todas');
  const [focusLineId, setFocusLineId] = useState<ID>();
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<ConfirmOutcome | null>(null);
  const [askReprocess, setAskReprocess] = useState<null | { forceLocal: boolean }>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [askMismatch, setAskMismatch] = useState(false);
  const [askDuplicate, setAskDuplicate] = useState(false);
  const [showDoc, setShowDoc] = useState(true);
  const [mobileDoc, setMobileDoc] = useState(false);
  const wide = useMediaQuery('(min-width: 1280px)');

  // Líneas «nuevo» leídas antes de que existieran sus productos (p. ej. varias facturas subidas a la vez y confirmada ya la
  // primera): al abrir la revisión se vuelven a emparejar con la base de precios actual.
  const refreshedFor = useRef<ID | null>(null);
  useEffect(() => {
    if (!invoice || invoice.status !== 'revision' || refreshedFor.current === invoice.id) return;
    refreshedFor.current = invoice.id;
    refreshInvoiceMatches(invoice.id).catch(() => undefined);
  }, [invoice]);

  // Sincroniza el borrador con la BD mientras no haya cambios locales pendientes.
  useEffect(() => {
    if (!invoice) return;
    if (!dirtyRef.current) {
      const d = toDraft(invoice);
      draftRef.current = d;
      setDraft(d);
    }
  }, [invoice]);

  const save = useCallback(async () => {
    const d = draftRef.current;
    if (!d || !id) return;
    dirtyRef.current = false;
    setSaveState('saving');
    try {
      await updateInvoice(id, d);
      setSaveState(dirtyRef.current ? 'dirty' : 'saved');
    } catch (e) {
      dirtyRef.current = true;
      setSaveState('error');
      toast.error('No se ha podido guardar la factura', errorMessage(e));
    }
  }, [id]);
  const [scheduleSave, flushSave, cancelSave] = useDebouncedAction(() => void save(), 1200);

  const updateDraft = useCallback(
    (fn: (d: InvoiceDraft) => InvoiceDraft) => {
      const current = draftRef.current;
      if (!current) return;
      const next = fn(current);
      draftRef.current = next;
      dirtyRef.current = true;
      setDraft(next);
      setSaveState('dirty');
      scheduleSave();
    },
    [scheduleSave],
  );

  const onHeader = useCallback((patch: Partial<InvoiceDraft>) => updateDraft((d) => ({ ...d, ...patch })), [updateDraft]);

  const onPatchLine = useCallback(
    (lineId: ID, patch: Partial<InvoiceLine>, meta?: LinePatchMeta) => {
      if (meta?.packManual) packManual.current.add(lineId);
      updateDraft((d) => ({
        ...d,
        lines: d.lines.map((l) => (l.id === lineId ? recomputeLine(l, patch, packManual.current.has(lineId)) : l)),
      }));
    },
    [updateDraft],
  );

  const onRemoveLine = useCallback(
    (lineId: ID) => updateDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== lineId) })),
    [updateDraft],
  );

  const onAddLine = useCallback(() => {
    try {
      const line = newInvoiceLine();
      updateDraft((d) => ({ ...d, lines: [...d.lines, line] }));
      setLineFilter('todas');
      setFocusLineId(line.id);
    } catch (e) {
      toast.error('No se ha podido añadir la línea', errorMessage(e));
    }
  }, [updateDraft]);

  // Ctrl/Cmd + S guarda al momento.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushSave();
        if (!dirtyRef.current) void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flushSave, save]);

  // Aviso del navegador si se cierra la pestaña con cambios sin guardar.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const productsById = useMemo(() => new Map<ID, Product>((products ?? []).map((p) => [p.id, p])), [products]);
  const check = useMemo(() => (draft ? totalsCheck(draft.lines, draft.subtotal, draft.vatTotal, draft.total) : null), [draft]);
  const summary = useMemo(() => (draft ? summarizeLines(draft.lines) : null), [draft]);
  // Líneas cuyo precio no se podrá aplicar a su ingrediente (unidad distinta sin peso por unidad / densidad).
  const mismatches = useMemo(
    () =>
      (draft?.lines ?? []).filter((l) => {
        if (l.matchStatus === 'ignorado' || l.matchStatus === 'nuevo' || !l.productId) return false;
        const p = productsById.get(l.productId);
        return !!p && lineConversion(l, p).kind === 'incompatible';
      }).length,
    [draft, productsById],
  );
  const visibleLines = useMemo(() => {
    const lines = draft?.lines ?? [];
    if (lineFilter === 'decidir') return lines.filter((l) => l.matchStatus === 'nuevo' || l.matchStatus === 'sugerido');
    if (lineFilter === 'avisos') return lines.filter((l) => l.warnings?.length);
    return lines;
  }, [draft, lineFilter]);

  const canUseAi = aiAvailable(settings);
  // La misma factura subida dos veces (el PDF y una foto): confirmar las dos contaría el gasto dos veces.
  const duplicate = useMemo(() => (invoice && invoices ? findDuplicateInvoice(invoice, invoices) : undefined), [invoice, invoices]);

  const reprocess = async (forceLocal: boolean) => {
    if (!id) return;
    cancelSave();
    dirtyRef.current = false;
    packManual.current.clear();
    setSaveState('idle');
    try {
      await processInvoice(id, { forceLocal });
      const fresh = await db().invoices.get(id);
      if (fresh?.status === 'error') toast.error('No se ha podido leer la factura', fresh.error);
      else toast.success('Factura leída de nuevo', 'Revisa las líneas antes de confirmar.');
    } catch (e) {
      toast.error('No se ha podido volver a leer la factura', errorMessage(e));
    }
  };

  const startManual = async () => {
    if (!id) return;
    try {
      await updateInvoice(id, { status: 'revision', error: undefined, method: invoice?.method ?? 'manual' });
      if (!draftRef.current?.lines.length) onAddLine();
    } catch (e) {
      toast.error('No se ha podido abrir el editor', errorMessage(e));
    }
  };

  const acceptAllSuggestions = () =>
    updateDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.matchStatus === 'sugerido' && l.productId ? { ...l, matchStatus: 'vinculado' } : l)),
    }));

  const doConfirm = async () => {
    const d = draftRef.current;
    if (!id || !d) return;
    setConfirming(true);
    try {
      cancelSave();
      await updateInvoice(id, d);
      dirtyRef.current = false;
      setSaveState('saved');
      const wdb = db();
      const beforeList = await wdb.products.toArray();
      const snapshot = new Map<ID, PriceSnapshot>(
        beforeList.map((p) => [p.id, { id: p.id, name: p.name, price: p.pricePerBase, baseUnit: p.baseUnit }]),
      );
      const costsBefore = dishCosts?.costs;
      const res = await confirmInvoice(id);
      const afterList = await wdb.products.toArray();
      const touched = afterList.filter((p) => {
        const prev = snapshot.get(p.id);
        return !prev || Math.abs(prev.price - p.pricePerBase) > 1e-9;
      });
      // Productos vinculados cuyo precio no cambia (misma tarifa o compra más antigua): también se listan.
      const linkedIds = new Set(d.lines.filter((l) => l.matchStatus !== 'ignorado' && l.productId).map((l) => l.productId as ID));
      const sameList = afterList.filter((p) => linkedIds.has(p.id) && !touched.includes(p));
      setOutcome({ ...res, rows: diffPrices(snapshot, [...touched, ...sameList]), costsBefore });
    } catch (e) {
      toast.error('No se ha podido confirmar la factura', errorMessage(e));
    } finally {
      setConfirming(false);
    }
  };

  const confirmOrAskMismatch = () => {
    if (mismatches > 0) setAskMismatch(true);
    else void doConfirm();
  };

  // Confirmar la copia de una factura ya confirmada contaría su gasto dos veces: se pide confirmación expresa.
  const onConfirmClick = () => {
    if (!confirmed && duplicate?.status === 'confirmada') setAskDuplicate(true);
    else confirmOrAskMismatch();
  };

  const onDelete = async () => {
    if (!id) return;
    cancelSave();
    dirtyRef.current = false;
    try {
      await deleteInvoice(id);
      toast.success('Factura eliminada');
      navigate('/facturas');
    } catch (e) {
      toast.error('No se ha podido eliminar la factura', errorMessage(e));
    }
  };

  // ───────── Estados de carga / no encontrada ─────────
  if (invoice === undefined || (invoice && !draft)) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="size-7" />
      </div>
    );
  }
  if (invoice === null || !draft) {
    return (
      <EmptyState
        icon={<FileSearch className="size-7" />}
        title="No encontramos esta factura"
        description="Puede que se haya eliminado o que pertenezca a otro restaurante."
        action={
          <Button onClick={() => navigate('/facturas')} icon={<ArrowLeft className="size-4" />}>
            Volver a facturas
          </Button>
        }
      />
    );
  }

  const processing = invoice.status === 'pendiente' || invoice.status === 'procesando';
  const confirmed = invoice.status === 'confirmada';
  const title = draft.supplierName || invoice.fileName || 'Factura sin proveedor';
  const hasDoc = !!invoice.file || !!invoice.rawText;

  const reprocessItems = [
    {
      label: 'Volver a leer',
      description: 'Gratis y en tu dispositivo. Sustituye las líneas actuales.',
      icon: <RefreshCw className="size-4" />,
      onSelect: () => setAskReprocess({ forceLocal: true }),
      disabled: !invoice.file || invoice.method === 'hoja',
    },
    ...(canUseAi
      ? [
          {
            label: 'Volver a leer con IA',
            description: 'Usa tu clave de Claude (opcional). Sustituye las líneas actuales.',
            icon: <Sparkles className="size-4" />,
            tone: 'ai' as const,
            onSelect: () => setAskReprocess({ forceLocal: false }),
            disabled: !invoice.file || invoice.method === 'hoja',
          },
        ]
      : []),
    {
      label: 'Eliminar factura',
      description: confirmed ? 'También se retiran los precios que aportó.' : undefined,
      icon: <Trash2 className="size-4" />,
      tone: 'danger' as const,
      onSelect: () => setAskDelete(true),
      disabled: invoice.status === 'procesando',
    },
  ];

  return (
    <div className="animate-fade-in">
      <Link
        to="/facturas"
        className="mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-lg text-sm font-semibold text-muted transition hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Facturas
      </Link>

      <PageHeader
        eyebrow="Revisión de factura"
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 break-words">{title}</span>
            <span className="flex items-center gap-1.5 align-middle">
              <InvoiceStatusBadge status={invoice.status} />
              {invoice.method && <MethodBadge method={invoice.method} />}
            </span>
          </span>
        }
        subtitle={
          <span className="tabular">
            {fmtDate(draft.date)}
            {draft.number ? ` · Nº\u00a0${draft.number}` : ''} · {draft.lines.length} {draft.lines.length === 1 ? 'línea' : 'líneas'}
            {check && check.linesSum > 0
              ? ` · ${fmtEur(draft.subtotal && draft.subtotal > 0 ? draft.subtotal : check.linesSum)} sin IVA`
              : ''}
          </span>
        }
        actions={
          <>
            <SaveIndicator state={saveState} />
            {hasDoc && wide && !showDoc && (
              <Button variant="ghost" size="md" icon={<Eye className="size-4" />} onClick={() => setShowDoc(true)}>
                Ver documento
              </Button>
            )}
            <DropdownMenu
              label="Más acciones"
              items={reprocessItems}
              trigger={(p) => (
                <Button variant="outline" iconRight={<ChevronDown className="size-4" />} {...p}>
                  Más
                </Button>
              )}
            />
            {!processing && (
              <Button
                variant="outline"
                icon={<Save className="size-4" />}
                onClick={() => {
                  cancelSave();
                  void save();
                }}
                disabled={saveState === 'saving'}
              >
                Guardar
              </Button>
            )}
          </>
        }
      />

      {invoice.status === 'error' && (
        <Callout tone="bad" title="No hemos podido leer esta factura" icon={<AlertTriangle className="size-4" />} className="mb-5">
          <p>{invoice.error || 'El documento no se ha podido interpretar.'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {invoice.file && (
              <Button size="sm" variant="outline" icon={<RefreshCw className="size-3.5" />} onClick={() => void reprocess(true)}>
                Volver a intentarlo
              </Button>
            )}
            <Button size="sm" variant="primary" icon={<PencilLine className="size-3.5" />} onClick={() => void startManual()}>
              Introducir a mano
            </Button>
          </div>
        </Callout>
      )}

      {invoice.warnings && invoice.warnings.length > 0 && !processing && (
        <Callout tone="warn" title="Revisa estos puntos antes de confirmar" className="mb-5">
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {invoice.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}

      {duplicate && !processing && (
        <Callout
          tone="warn"
          icon={<Copy className="size-4" />}
          title={duplicate.status === 'confirmada' ? 'Parece repetida: ya confirmaste esta factura' : 'Parece repetida: tienes otra igual por revisar'}
          className="mb-5"
        >
          <p>
            {duplicate.number ? `La factura nº ${duplicate.number}` : `Una factura del ${fmtDate(duplicate.date)} por ${fmtEur(invoiceNetAmount(duplicate))}`} de{' '}
            {duplicate.supplierName || 'este proveedor'} ya está en tus facturas
            {duplicate.fileName ? ` («${duplicate.fileName}»)` : ''}.{' '}
            {duplicate.status === 'confirmada'
              ? 'Si es la misma, elimina esta copia: si la confirmas también, su gasto contará dos veces.'
              : 'Si es la misma, revisa solo una y elimina la otra para no contar el gasto dos veces.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" icon={<Eye className="size-3.5" />} onClick={() => navigate(`/facturas/${duplicate.id}`)}>
              Ver la otra
            </Button>
            <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setAskDelete(true)}>
              Eliminar esta copia
            </Button>
          </div>
        </Callout>
      )}

      {/* Documento en móvil / tableta: plegable */}
      {hasDoc && !wide && (
        <div className="mb-5">
          <button
            type="button"
            onClick={() => setMobileDoc((o) => !o)}
            aria-expanded={mobileDoc}
            className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-card"
          >
            <span className="flex items-center gap-2">
              <Eye className="size-4 text-muted" /> {mobileDoc ? 'Ocultar documento original' : 'Ver documento original'}
            </span>
            <ChevronDown className={clsx('size-4 text-muted transition', mobileDoc && 'rotate-180')} />
          </button>
          {mobileDoc && (
            <FilePreview
              file={invoice.file}
              fileName={invoice.fileName}
              fileType={invoice.fileType}
              rawText={invoice.rawText}
              className="mt-2 h-[70dvh]"
            />
          )}
        </div>
      )}

      <div className={clsx('grid gap-6', hasDoc && showDoc && wide ? 'grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : 'grid-cols-1')}>
        {hasDoc && showDoc && wide && (
          <div>
            <div className="sticky top-6">
              <FilePreview
                file={invoice.file}
                fileName={invoice.fileName}
                fileType={invoice.fileType}
                rawText={invoice.rawText}
                className="h-[calc(100dvh-6rem)]"
                onHide={() => setShowDoc(false)}
              />
            </div>
          </div>
        )}

        <div className="min-w-0 space-y-4">
          {processing ? (
            <InvoiceProcessing invoice={invoice} queue={queue} />
          ) : (
            <>
              {confirmed && (
                <Callout
                  tone="ok"
                  icon={<CheckCircle2 className="size-4" />}
                  title={`Confirmada${invoice.confirmedAt ? ` el ${fmtDate(invoice.confirmedAt)}` : ''}`}
                >
                  Sus precios ya están en tu base de datos. Si corriges algo, vuelve a aplicar los precios: no se duplican.
                </Callout>
              )}

              <InvoiceHeaderForm draft={draft} suppliers={suppliers ?? []} onChange={onHeader} />
              {check && <TotalsBar check={check} onUseLinesSum={() => onHeader({ subtotal: check.linesSum })} />}

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink">Líneas de la factura</h2>
                  {summary && summary.total > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {summary.linked > 0 && <Badge tone="ok">{summary.linked} vinculadas</Badge>}
                      {summary.suggested > 0 && <Badge tone="warn">{summary.suggested} por confirmar</Badge>}
                      {summary.created > 0 && <Badge tone="brand">{summary.created} nuevas</Badge>}
                      {summary.ignored > 0 && <Badge>{summary.ignored} ignoradas</Badge>}
                      {summary.withWarnings > 0 && (
                        <Badge tone="bad" icon={<AlertTriangle className="size-3" />}>
                          {summary.withWarnings} con avisos
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {summary && summary.suggested > 0 && (
                    <Button size="sm" variant="outline" icon={<CheckCheck className="size-3.5 text-ok-ink" />} onClick={acceptAllSuggestions}>
                      Aceptar sugerencias
                    </Button>
                  )}
                  {summary && summary.total > 0 && (
                    <Segmented
                      size="sm"
                      value={lineFilter}
                      onChange={setLineFilter}
                      options={[
                        { value: 'todas', label: 'Todas' },
                        {
                          value: 'decidir',
                          label: `Por decidir${summary.suggested + summary.created ? ` (${summary.suggested + summary.created})` : ''}`,
                        },
                        { value: 'avisos', label: `Avisos${summary.withWarnings ? ` (${summary.withWarnings})` : ''}` },
                      ]}
                    />
                  )}
                </div>
              </div>

              {draft.lines.length === 0 ? (
                <EmptyState
                  icon={<PencilLine className="size-7" />}
                  title="Sin líneas todavía"
                  description="Añade cada producto de la factura: descripción, cantidad, precio e importe. Calculamos el precio real por kg, litro o unidad."
                  action={
                    <Button onClick={onAddLine} icon={<PencilLine className="size-4" />}>
                      Añadir la primera línea
                    </Button>
                  }
                />
              ) : visibleLines.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center text-sm text-muted">
                  Nada por aquí: {lineFilter === 'decidir' ? 'todas las líneas están decididas' : 'ninguna línea tiene avisos'}.{' '}
                  <button
                    type="button"
                    className="font-semibold text-brand-ink underline"
                    onClick={() => setLineFilter('todas')}
                  >
                    Ver todas
                  </button>
                </div>
              ) : (
                <InvoiceLinesTable
                  lines={visibleLines}
                  products={products ?? []}
                  productsById={productsById}
                  onPatch={onPatchLine}
                  onRemove={onRemoveLine}
                  onAdd={lineFilter === 'todas' ? onAddLine : undefined}
                  focusLineId={focusLineId}
                />
              )}

              {summary && summary.total > 0 && (
                <ConfirmBar
                  confirmed={confirmed}
                  confirming={confirming}
                  priced={summary.priced}
                  created={summary.created}
                  suggested={summary.suggested}
                  unpriced={summary.total - summary.ignored - summary.priced - summary.credits}
                  credits={summary.credits}
                  mismatches={mismatches}
                  duplicate={!!duplicate}
                  onConfirm={onConfirmClick}
                />
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!askReprocess}
        onClose={() => setAskReprocess(null)}
        title="¿Volver a leer la factura?"
        message="Se sustituirán las líneas actuales por una lectura nueva y perderás los cambios que hayas hecho a mano."
        confirmLabel="Volver a leer"
        onConfirm={() => askReprocess && void reprocess(askReprocess.forceLocal)}
      />
      <ConfirmDialog
        open={askDelete}
        onClose={() => setAskDelete(false)}
        title="¿Eliminar esta factura?"
        message={
          confirmed
            ? 'La factura está confirmada: se retirarán sus precios del histórico y se recalculará el precio vigente de sus ingredientes.'
            : 'Se eliminará la factura y su documento original.'
        }
        confirmLabel="Eliminar"
        danger
        onConfirm={() => void onDelete()}
      />
      <ConfirmDialog
        open={askDuplicate}
        onClose={() => setAskDuplicate(false)}
        title="¿Confirmar una factura repetida?"
        message={
          duplicate
            ? `${duplicate.number ? `La factura nº ${duplicate.number}` : `Una factura del ${fmtDate(duplicate.date)} por ${fmtEur(invoiceNetAmount(duplicate))}`} de ${duplicate.supplierName || 'este proveedor'} ya está confirmada. Si es la misma, elimina esta copia: confirmarla contaría su gasto dos veces. Confírmala solo si es otra factura distinta.`
            : undefined
        }
        confirmLabel="Confirmar igualmente"
        onConfirm={confirmOrAskMismatch}
      />
      <ConfirmDialog
        open={askMismatch}
        onClose={() => setAskMismatch(false)}
        title="Hay precios que no se podrán aplicar"
        message={`${mismatches} ${mismatches === 1 ? 'línea está' : 'líneas están'} en una unidad distinta a la de su ingrediente (p. ej. €/ud frente a €/kg) y no hay peso por unidad o densidad para convertirla. Si confirmas, ${mismatches === 1 ? 'esa línea se omitirá' : 'esas líneas se omitirán'} y el resto de precios se actualizarán.`}
        confirmLabel="Confirmar igualmente"
        onConfirm={() => void doConfirm()}
      />
      <ConfirmResultModal outcome={outcome} onClose={() => setOutcome(null)} dishes={dishes} costsAfter={dishCosts?.costs} />
    </div>
  );
}

function ConfirmBar({
  confirmed,
  confirming,
  priced,
  created,
  suggested,
  unpriced,
  credits = 0,
  mismatches,
  duplicate,
  onConfirm,
}: {
  confirmed: boolean;
  confirming: boolean;
  priced: number;
  created: number;
  suggested: number;
  unpriced: number;
  /** Abonos o devoluciones: no cambian precios al confirmar. */
  credits?: number;
  mismatches: number;
  duplicate?: boolean;
  onConfirm: () => void;
}) {
  const notes: string[] = [];
  if (duplicate) notes.push('parece una factura repetida');
  if (suggested > 0) notes.push(`${suggested} ${suggested === 1 ? 'sugerencia se aplicará' : 'sugerencias se aplicarán'} tal cual`);
  if (unpriced > 0) notes.push(`${unpriced} sin precio se ${unpriced === 1 ? 'omitirá' : 'omitirán'}`);
  if (credits > 0) notes.push(`${credits} ${credits === 1 ? 'abono no cambia' : 'abonos no cambian'} precios`);
  if (mismatches > 0) notes.push(`${mismatches} no se ${mismatches === 1 ? 'podrá' : 'podrán'} aplicar (unidad distinta)`);
  return (
    // Con el documento al lado la columna es estrecha: el resumen pasa a dos líneas en vez de cortarse.
    <div className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-20 mt-6 lg:bottom-4">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-elevated/95 p-2.5 shadow-pop backdrop-blur-xl sm:p-3.5">
        <div className="hidden min-w-0 flex-1 px-1 sm:block">
          <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm font-semibold text-ink">
            <span className="whitespace-nowrap">
              {priced} {priced === 1 ? 'precio listo' : 'precios listos'}
            </span>
            {created > 0 && (
              <span className="whitespace-nowrap text-brand-ink">
                · {created} {created === 1 ? 'ingrediente nuevo' : 'ingredientes nuevos'}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-start gap-1.5 text-xs text-muted">
            {notes.length ? (
              <>
                <AlertTriangle className={clsx('mt-px size-3.5 shrink-0', mismatches || duplicate ? 'text-bad-ink' : 'text-warn-ink')} />
                <span className="line-clamp-2" title={notes.join(' · ')}>
                  {notes.join(' · ')}
                </span>
              </>
            ) : (
              <>
                <ShieldCheck className="mt-px size-3.5 shrink-0 text-ok-ink" />
                <span>Todo listo: tus escandallos se actualizan al momento.</span>
              </>
            )}
          </div>
        </div>
        <Button
          size="lg"
          variant="primary"
          loading={confirming}
          icon={<CheckCircle2 className="size-5" />}
          onClick={onConfirm}
          className="w-full shrink-0 sm:w-auto"
        >
          <span className="sm:hidden">
            {confirmed ? 'Volver a aplicar precios' : `Confirmar · ${priced} ${priced === 1 ? 'precio' : 'precios'}`}
          </span>
          <span className="hidden sm:inline">{confirmed ? 'Volver a aplicar precios' : 'Confirmar y actualizar precios'}</span>
        </Button>
      </div>
    </div>
  );
}
