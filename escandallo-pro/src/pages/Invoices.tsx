import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import clsx from 'clsx';
import {
  Camera,
  CircleAlert,
  ClipboardList,
  Eye,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  MoreHorizontal,
  PencilLine,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  Wallet,
  X,
} from 'lucide-react';
import type { Invoice } from '../types';
import { Button, Callout, Card, ConfirmDialog, FileDrop, PageHeader, SearchInput, Segmented, Stat, Table, Td, Th } from '../components/ui';
import { db } from '../db';
import { useAppSettings, useInvoices } from '../state/hooks';
import { errorMessage, toast } from '../state/store';
import * as invoiceService from '../services/invoices';
import { addInvoiceFiles, createManualInvoice, deleteInvoice, processInvoice } from '../services/invoices';
import { aiAvailable } from '../extract/index';
import { fmtDate, fmtEur, fmtNum, fmtPct } from '../lib/format';
import { todayIso } from '../lib/id';
import { InvoiceStatusBadge, MethodBadge } from '../components/purchases/badges';
import { QueuePanel } from '../components/purchases/ProcessingQueue';
import { DropdownMenu } from '../components/purchases/DropdownMenu';
import { useInvoiceQueue } from '../components/purchases/hooks';
import { filterInvoices, invoiceNetAmount, invoiceStats, pctChange, type InvoiceFilter } from '../components/purchases/logic';

const ACCEPT = '.pdf,application/pdf,image/*,.heic,.heif,.xlsx,.xlsm,.csv,.tsv';
const CALLOUT_KEY = 'ep-invoices-local-callout';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(CALLOUT_KEY) === '1';
  } catch {
    return false;
  }
}

export default function Invoices() {
  const invoices = useInvoices();
  const settings = useAppSettings();
  const queue = useInvoiceQueue();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const highlight = params.get('nuevo') === '1';
  const dropRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<InvoiceFilter>('todas');
  const [query, setQuery] = useState('');
  const [toDelete, setToDelete] = useState<Invoice | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [calloutDismissed, setCalloutDismissed] = useState(readDismissed);

  // Retoma facturas que quedaron a medias (p. ej. se cerró la app mientras se leían).
  useEffect(() => {
    const svc = invoiceService as { resumePendingInvoices?: () => Promise<void> };
    svc.resumePendingInvoices?.().catch(() => undefined);
  }, []);

  // Aviso al terminar cada lectura en segundo plano.
  const prevRunning = useRef<string | null>(null);
  useEffect(() => {
    const finished = prevRunning.current;
    prevRunning.current = queue?.running ?? null;
    if (!finished || finished === queue?.running) return;
    void db()
      .invoices.get(finished)
      .then((inv) => {
        if (!inv) return;
        const name = inv.supplierName || inv.fileName || undefined;
        if (inv.status === 'revision') toast.success('Factura lista para revisar', name);
        else if (inv.status === 'error') toast.error('No se pudo leer una factura', inv.error ?? name);
      })
      .catch(() => undefined);
  }, [queue?.running]);

  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => dropRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
    const clear = setTimeout(() => {
      setParams(
        (p) => {
          p.delete('nuevo');
          return p;
        },
        { replace: true },
      );
    }, 6000);
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
    };
  }, [highlight, setParams]);

  const today = todayIso();
  const stats = useMemo(() => invoiceStats(invoices ?? [], today), [invoices, today]);
  const list = useMemo(() => filterInvoices(invoices ?? [], filter, query), [invoices, filter, query]);
  const aiOn = aiAvailable(settings);
  const spendTrend = pctChange(stats.prevMonthSpend, stats.monthSpend);

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const ids = await addInvoiceFiles(files);
      if (ids.length === 1 && files.length === 1)
        toast.info('Factura en cola', 'La estamos leyendo en tu dispositivo. Te avisamos al terminar.');
      else toast.info(`${ids.length} facturas en cola`, 'Se leen una tras otra en tu dispositivo. Puedes seguir trabajando.');
    } catch (e) {
      toast.error('No se pudieron añadir las facturas', errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const onManual = async () => {
    setCreating(true);
    try {
      const id = await createManualInvoice();
      navigate(`/facturas/${id}`);
    } catch (e) {
      toast.error('No se pudo crear la factura', errorMessage(e));
      setCreating(false);
    }
  };

  const onReprocess = async (inv: Invoice) => {
    try {
      toast.info('Leyendo de nuevo…', inv.fileName || inv.supplierName || undefined);
      // El resultado se avisa al terminar la lectura (ver el seguimiento de la cola).
      await processInvoice(inv.id);
    } catch (e) {
      toast.error('No se pudo volver a leer la factura', errorMessage(e));
    }
  };

  const onDelete = async (inv: Invoice) => {
    try {
      await deleteInvoice(inv.id);
      toast.success('Factura eliminada');
    } catch (e) {
      toast.error('No se pudo eliminar la factura', errorMessage(e));
    }
  };

  const dismissCallout = () => {
    setCalloutDismissed(true);
    try {
      localStorage.setItem(CALLOUT_KEY, '1');
    } catch {
      /* modo privado: sólo se oculta en esta sesión */
    }
  };

  const loading = invoices === undefined;
  const empty = !loading && invoices.length === 0;

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Compras"
        title="Facturas"
        subtitle="Sube tus facturas de proveedor y tendrás el precio real de cada ingrediente al día. Se leen gratis en tu dispositivo, sin enviar tus datos a nadie."
      />

      {!empty && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat
            label="Facturas este mes"
            value={loading ? '—' : fmtNum(stats.monthCount, 0)}
            icon={<Receipt className="size-4" />}
            tone="brand"
            className="lg:order-1"
            hint={`${fmtNum(invoices?.length ?? 0, 0)} en total`}
          />
          <Stat
            label="Gasto del mes (sin IVA)"
            value={loading ? '—' : fmtEur(stats.monthSpend)}
            icon={<Wallet className="size-4" />}
            tone="default"
            className="order-first col-span-2 lg:order-2 lg:col-span-1"
            trend={
              spendTrend != null
                ? { value: fmtPct(Math.abs(spendTrend), 0), direction: spendTrend > 0.5 ? 'up' : spendTrend < -0.5 ? 'down' : 'flat' }
                : undefined
            }
            hint={
              spendTrend != null
                ? 'frente al mes anterior'
                : stats.monthPendingSpend > 0
                  ? `${fmtEur(stats.monthPendingSpend)} por revisar`
                  : 'facturas confirmadas y por revisar'
            }
          />
          <Stat
            label="Pendientes de revisar"
            value={loading ? '—' : fmtNum(stats.toReview, 0)}
            icon={<ClipboardList className="size-4" />}
            tone={stats.toReview > 0 ? 'warn' : 'ok'}
            className="lg:order-3"
            hint={
              stats.errors > 0 ? (
                <span className="font-semibold text-bad">{stats.errors} con error</span>
              ) : stats.inProgress > 0 ? (
                `${stats.inProgress} leyéndose ahora`
              ) : stats.toReview > 0 ? (
                'confírmalas para actualizar precios'
              ) : (
                'todo al día'
              )
            }
          />
        </div>
      )}

      <div
        className={clsx(
          'mb-6 grid grid-cols-3 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-rows-2',
          empty ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : 'lg:grid-cols-[minmax(0,1fr)_300px]',
        )}
      >
        <div
          ref={dropRef}
          className={clsx(
            'relative rounded-2xl transition sm:col-span-2 lg:col-span-1 lg:row-span-2',
            highlight && 'animate-pulse-soft ring-4 ring-brand-500/40 ring-offset-4 ring-offset-bg',
          )}
        >
          <FileDrop
            accept={ACCEPT}
            onFiles={onFiles}
            compact
            icon={<UploadCloud className="size-5" />}
            title={uploading ? 'Añadiendo…' : 'Subir archivos'}
            className="h-full bg-surface px-2 sm:hidden"
          />
          <FileDrop
            accept={ACCEPT}
            onFiles={onFiles}
            title={uploading ? 'Añadiendo…' : 'Arrastra facturas en PDF, fotos o un Excel con tu listado de compras'}
            description={
              <>
                O haz clic para elegir archivos. Puedes subir varias a la vez.
                <span className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                  <FormatChip icon={<FileText className="size-3.5" />}>PDF</FormatChip>
                  <FormatChip icon={<ImageIcon className="size-3.5" />}>JPG · PNG · HEIC</FormatChip>
                  <FormatChip icon={<FileSpreadsheet className="size-3.5" />}>Excel · CSV</FormatChip>
                </span>
              </>
            }
            className={clsx('hidden h-full bg-surface sm:flex', empty ? 'min-h-[280px]' : 'min-h-[220px]')}
          />
        </div>
        <FileDrop
          accept="image/*"
          capture="environment"
          multiple
          compact
          onFiles={onFiles}
          icon={<Camera className="size-5" />}
          title="Hacer foto"
          description={<span className="hidden sm:inline">Fotografía la factura en papel</span>}
          className="h-full bg-surface px-2 sm:px-4 lg:col-start-2"
        />
        <button
          type="button"
          onClick={onManual}
          disabled={creating}
          className="group flex h-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line-strong bg-surface px-2 py-6 text-center transition hover:border-brand-400 hover:bg-brand-500/5 disabled:opacity-60 sm:px-4 lg:col-start-2"
        >
          <span className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500 transition group-hover:scale-105">
            <PencilLine className="size-5" />
          </span>
          <span className="font-display text-base font-bold text-ink">Añadir a mano</span>
          <span className="mt-1 hidden text-sm text-muted sm:inline">Para tickets o albaranes</span>
        </button>
      </div>

      {!aiOn && !calloutDismissed && !empty && (
        <Callout
          tone="ok"
          icon={<ShieldCheck className="size-4" />}
          title="Lectura gratuita en tu dispositivo"
          className="relative mb-6 pr-12"
        >
          Tus facturas se leen aquí mismo, sin coste y sin enviar tus datos a nadie: comprobamos que cantidad × precio cuadra con cada
          importe y que la suma coincide con la base imponible. Antes de confirmar, echa un vistazo a las líneas marcadas en ámbar. Si algún
          día quieres una segunda opinión, puedes activar la IA opcional en{' '}
          <Link to="/ajustes" className="font-semibold text-ink underline decoration-ok/50 underline-offset-2 hover:decoration-ok">
            Ajustes
          </Link>
          .
          <button
            type="button"
            onClick={dismissCallout}
            aria-label="Ocultar aviso"
            className="absolute right-2 top-2 inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </Callout>
      )}

      <QueuePanel queue={queue} invoices={invoices ?? []} />

      {loading ? (
        <ListSkeleton />
      ) : empty ? (
        <EmptyInvoices />
      ) : (
        <section aria-label="Listado de facturas">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <Segmented
                value={filter}
                onChange={setFilter}
                className="w-max"
                options={[
                  { value: 'todas', label: 'Todas' },
                  {
                    value: 'revisar',
                    label: `Por revisar${stats.toReview + stats.inProgress ? ` · ${stats.toReview + stats.inProgress}` : ''}`,
                  },
                  { value: 'confirmadas', label: 'Confirmadas' },
                  { value: 'error', label: `Con error${stats.errors ? ` · ${stats.errors}` : ''}` },
                ]}
              />
            </div>
            <SearchInput value={query} onChange={setQuery} placeholder="Buscar proveedor o nº de factura…" className="sm:w-80" />
          </div>

          {list.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center text-sm text-muted">
              Ninguna factura coincide con el filtro.{' '}
              <button
                type="button"
                className="font-semibold text-brand-600 underline dark:text-brand-400"
                onClick={() => {
                  setFilter('todas');
                  setQuery('');
                }}
              >
                Ver todas
              </button>
            </div>
          ) : (
            <>
              <div className="hidden lg:block">
                <InvoiceTable invoices={list} onReprocess={onReprocess} onDelete={setToDelete} />
              </div>
              <div className="space-y-3 lg:hidden">
                {list.map((inv) => (
                  <InvoiceCard key={inv.id} invoice={inv} onReprocess={onReprocess} onDelete={setToDelete} />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="¿Eliminar esta factura?"
        message={
          toDelete?.status === 'confirmada'
            ? 'La factura está confirmada: se retirarán sus precios del histórico y se recalculará el precio vigente de sus ingredientes.'
            : 'Se eliminará la factura y su documento original.'
        }
        confirmLabel="Eliminar"
        danger
        onConfirm={() => toDelete && void onDelete(toDelete)}
      />
    </div>
  );
}

function FormatChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-2">
      {icon}
      {children}
    </span>
  );
}

function invoiceTitle(inv: Invoice): string {
  return inv.supplierName || inv.fileName || 'Proveedor sin identificar';
}

function RowActions({
  invoice,
  onReprocess,
  onDelete,
}: {
  invoice: Invoice;
  onReprocess: (i: Invoice) => void;
  onDelete: (i: Invoice) => void;
}) {
  const navigate = useNavigate();
  const busy = invoice.status === 'procesando' || invoice.status === 'pendiente';
  return (
    <DropdownMenu
      label={`Acciones de ${invoiceTitle(invoice)}`}
      items={[
        { label: 'Revisar', icon: <Eye className="size-4" />, onSelect: () => navigate(`/facturas/${invoice.id}`) },
        {
          label: 'Volver a leer',
          description: 'Sustituye las líneas por una lectura nueva',
          icon: <RefreshCw className="size-4" />,
          onSelect: () => onReprocess(invoice),
          disabled: busy || !invoice.file || invoice.method === 'hoja',
        },
        {
          label: 'Eliminar',
          icon: <Trash2 className="size-4" />,
          tone: 'danger',
          onSelect: () => onDelete(invoice),
          disabled: busy && invoice.status === 'procesando',
        },
      ]}
      trigger={(p) => (
        <button
          type="button"
          {...p}
          aria-label={`Más acciones de ${invoiceTitle(invoice)}`}
          className="inline-flex size-10 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink"
        >
          <MoreHorizontal className="size-5" />
        </button>
      )}
    />
  );
}

function InvoiceTable({
  invoices,
  onReprocess,
  onDelete,
}: {
  invoices: Invoice[];
  onReprocess: (i: Invoice) => void;
  onDelete: (i: Invoice) => void;
}) {
  const navigate = useNavigate();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Fecha</Th>
          <Th>Proveedor</Th>
          <Th>Nº factura</Th>
          <Th align="right">Líneas</Th>
          <Th align="right">Total sin IVA</Th>
          <Th>Estado</Th>
          <Th>Lectura</Th>
          <Th align="right">
            <span className="sr-only">Acciones</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((inv) => (
          <tr
            key={inv.id}
            className="group cursor-pointer transition hover:bg-surface-2"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('button, a')) return;
              navigate(`/facturas/${inv.id}`);
            }}
          >
            <Td className="whitespace-nowrap">{fmtDate(inv.date)}</Td>
            <Td className="max-w-[280px]">
              <Link
                to={`/facturas/${inv.id}`}
                className="block truncate font-semibold text-ink hover:text-brand-600 dark:hover:text-brand-400"
              >
                {invoiceTitle(inv)}
              </Link>
              {inv.supplierName && inv.fileName && <div className="truncate text-xs text-muted">{inv.fileName}</div>}
            </Td>
            <Td className="whitespace-nowrap">{inv.number || <span className="text-muted">—</span>}</Td>
            <Td align="right">{inv.lines.length || <span className="text-muted">—</span>}</Td>
            <Td align="right" className="font-semibold text-ink">
              {inv.lines.length || inv.subtotal ? fmtEur(invoiceNetAmount(inv)) : <span className="font-normal text-muted">—</span>}
            </Td>
            <Td>
              <InvoiceStatusBadge status={inv.status} />
              {inv.status === 'error' && inv.error && (
                <div className="mt-1 max-w-[220px] truncate text-xs text-bad" title={inv.error}>
                  {inv.error}
                </div>
              )}
            </Td>
            <Td>
              <MethodBadge method={inv.method} />
            </Td>
            <Td align="right" className="whitespace-nowrap">
              <div className="flex items-center justify-end gap-1">
                {inv.status === 'revision' && (
                  <Button size="sm" variant="primary" onClick={() => navigate(`/facturas/${inv.id}`)}>
                    Revisar
                  </Button>
                )}
                <RowActions invoice={inv} onReprocess={onReprocess} onDelete={onDelete} />
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function InvoiceCard({
  invoice: inv,
  onReprocess,
  onDelete,
}: {
  invoice: Invoice;
  onReprocess: (i: Invoice) => void;
  onDelete: (i: Invoice) => void;
}) {
  const navigate = useNavigate();
  return (
    <Card padded={false}>
      <div className="flex items-start gap-3 p-4">
        <button type="button" onClick={() => navigate(`/facturas/${inv.id}`)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <InvoiceStatusBadge status={inv.status} />
            <MethodBadge method={inv.method} />
          </div>
          <div className="mt-2 truncate font-display text-base font-bold text-ink">{invoiceTitle(inv)}</div>
          <div className="tabular mt-0.5 text-xs text-muted">
            {fmtDate(inv.date)}
            {inv.number ? ` · Nº ${inv.number}` : ''}
            {inv.lines.length ? ` · ${inv.lines.length} ${inv.lines.length === 1 ? 'línea' : 'líneas'}` : ''}
          </div>
          {inv.status === 'error' && inv.error && (
            <div className="mt-1.5 flex items-start gap-1 text-xs text-bad">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="line-clamp-2">{inv.error}</span>
            </div>
          )}
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="tabular font-display text-lg font-extrabold text-ink">
            {inv.lines.length || inv.subtotal ? fmtEur(invoiceNetAmount(inv)) : <span className="text-muted">—</span>}
          </div>
          <RowActions invoice={inv} onReprocess={onReprocess} onDelete={onDelete} />
        </div>
      </div>
      {inv.status === 'revision' && (
        <div className="border-t border-line px-4 py-3">
          <Button block variant="primary" onClick={() => navigate(`/facturas/${inv.id}`)}>
            Revisar y confirmar precios
          </Button>
        </div>
      )}
    </Card>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-16 animate-pulse-soft rounded-2xl border border-line bg-surface" />
      ))}
    </div>
  );
}

function EmptyInvoices() {
  const ways: { icon: React.ReactNode; title: string; text: string }[] = [
    {
      icon: <FileText className="size-5" />,
      title: 'PDF del proveedor',
      text: 'Descárgalo del correo o de su web y arrástralo aquí. Es lo más preciso.',
    },
    {
      icon: <Camera className="size-5" />,
      title: 'Foto de la factura',
      text: 'Con el móvil, bien encuadrada y con luz. Leemos hasta tickets arrugados.',
    },
    {
      icon: <FileSpreadsheet className="size-5" />,
      title: 'Excel o CSV',
      text: 'Tu listado de compras o la tarifa del proveedor, con muchas facturas a la vez.',
    },
  ];
  return (
    <div className="hero-mesh overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-10">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok-soft px-3 py-1 text-xs font-bold text-ok">
          <ShieldCheck className="size-3.5" /> Gratis · en tu dispositivo · sin enviar tus datos a nadie
        </span>
        <h2 className="mt-4 font-display text-2xl font-extrabold text-ink sm:text-3xl">
          Tu primera factura, <span className="text-gradient-brand">en 30 segundos</span>
        </h2>
        <p className="mt-2 text-sm text-muted sm:text-[15px]">
          Leemos proveedor, productos, cantidades y precios, calculamos el precio real por kilo, litro o unidad y tú sólo revisas y
          confirmas. Cada factura mantiene al día el coste de todos tus platos.
        </p>
      </div>
      <div className="mx-auto mt-8 grid max-w-4xl gap-3 sm:grid-cols-3">
        {ways.map((w, i) => (
          <div key={w.title} className="rounded-2xl border border-line bg-surface/90 p-4 backdrop-blur">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500">{w.icon}</span>
              <span className="font-display text-sm font-bold text-ink">
                <span className="text-muted">{i + 1}.</span> {w.title}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted">{w.text}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
        <Sparkles className="size-3.5" /> ¿Prefieres escribirla? Usa «Añadir a mano»: calculamos el precio real igualmente.
      </p>
    </div>
  );
}
