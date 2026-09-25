import { Link } from 'react-router';
import { ScanLine, ShieldCheck } from 'lucide-react';
import type { ID, Invoice } from '../../types';
import { Badge, ProgressBar } from '../ui';
import type { QueueState } from '../../services/invoices';

function invoiceLabel(inv: Invoice | undefined): string {
  if (!inv) return 'Factura';
  return inv.fileName || inv.supplierName || 'Factura';
}

/** Panel en vivo de la cola de lectura (archivo en curso, fase, progreso y pendientes). */
export function QueuePanel({ queue, invoices }: { queue: QueueState | null; invoices: Invoice[] }) {
  const byId = new Map<ID, Invoice>(invoices.map((i) => [i.id, i]));
  const fallbackRunning = invoices.find((i) => i.status === 'procesando');
  const fallbackQueued = invoices.filter((i) => i.status === 'pendiente');
  const runningId = queue ? queue.running : (fallbackRunning?.id ?? null);
  const queued = queue ? queue.queued.filter((id) => id !== runningId) : fallbackQueued.map((i) => i.id);
  if (!runningId && !queued.length) return null;

  const running = runningId ? byId.get(runningId) : undefined;
  const progress = queue?.running ? queue.progress : undefined;

  return (
    <div
      className="relative mb-6 animate-slide-up overflow-hidden rounded-2xl border border-info/30 bg-surface shadow-card"
      role="status"
      aria-live="polite"
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-info to-brand-500" />
      <div className="flex flex-col gap-3 p-4 pl-5 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-info-soft text-info">
          <ScanLine className="size-5 animate-pulse-soft" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-bold text-ink">{runningId ? 'Leyendo facturas…' : 'Facturas en cola'}</span>
            {queued.length > 0 && <Badge tone="neutral">{queued.length} en cola</Badge>}
          </div>
          {runningId && (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted">
              <Link
                to={`/facturas/${runningId}`}
                className="max-w-full truncate font-semibold text-ink-2 hover:text-brand-600 dark:hover:text-brand-400"
              >
                {invoiceLabel(running)}
              </Link>
              {queue?.stage && <span className="truncate">· {queue.stage}</span>}
            </div>
          )}
          <ProgressBar value={progress ?? 0.18} tone="brand" className={progress == null ? 'mt-2.5 animate-pulse-soft' : 'mt-2.5'} />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted sm:max-w-[220px]">
          <ShieldCheck className="size-4 shrink-0 text-ok" />
          Gratis y en tu dispositivo. Puedes seguir trabajando mientras tanto.
        </div>
      </div>
    </div>
  );
}

/** Estado de lectura de UNA factura (para la pantalla de revisión). */
export function InvoiceProcessing({ invoice, queue }: { invoice: Invoice; queue: QueueState | null }) {
  const isRunning = queue?.running === invoice.id || (!queue && invoice.status === 'procesando');
  const position = queue ? queue.queued.filter((id) => id !== queue.running).indexOf(invoice.id) : -1;
  const progress = queue?.running === invoice.id ? queue.progress : undefined;
  return (
    <div
      className="hero-mesh relative overflow-hidden rounded-3xl border border-line bg-surface p-6 text-center shadow-card sm:p-10"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-3xl bg-surface text-brand-500 shadow-glow">
        <ScanLine className="size-8 animate-pulse-soft" />
      </div>
      <h2 className="font-display text-xl font-extrabold text-ink sm:text-2xl">
        {isRunning ? 'Leyendo tu factura…' : 'En cola para leer'}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        {isRunning
          ? (queue?.stage ?? 'Detectando proveedor, líneas, cantidades y precios.')
          : position >= 0
            ? `Hay ${position + 1 === 1 ? 'una factura' : `${position + 1} facturas`} delante. Empezará enseguida.`
            : 'Empezará enseguida.'}
      </p>
      <div className="mx-auto mt-5 max-w-sm">
        <ProgressBar value={progress ?? 0.2} className={progress == null ? 'animate-pulse-soft' : undefined} />
        {progress != null && <div className="tabular mt-1.5 text-xs font-semibold text-muted">{Math.round(progress * 100)} %</div>}
      </div>
      <p className="mx-auto mt-6 flex max-w-md items-center justify-center gap-1.5 text-xs text-muted">
        <ShieldCheck className="size-4 shrink-0 text-ok" />
        Gratis, en tu dispositivo y sin enviar tus datos a nadie. La primera lectura prepara el lector y tarda unos segundos más.
      </p>
    </div>
  );
}
