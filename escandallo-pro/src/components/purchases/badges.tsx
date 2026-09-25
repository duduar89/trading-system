import { useId, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import type { BaseUnit, ExtractionMethod, InvoiceStatus } from '../../types';
import { Badge } from '../ui';
import { INVOICE_STATUS_LABELS, METHOD_LABELS } from '../../lib/labels';
import { fmtDate, fmtEurPrecise, fmtPct, perUnitLabel } from '../../lib/format';
import type { PriceTrend } from './logic';

/** Estado de una factura; los estados en curso llevan un punto animado. */
export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const s = INVOICE_STATUS_LABELS[status];
  const live = status === 'procesando' || status === 'pendiente';
  const dot: Record<typeof s.tone, string> = { neutral: 'bg-muted', info: 'bg-info', warn: 'bg-warn', ok: 'bg-ok', bad: 'bg-bad' };
  return (
    <Badge tone={s.tone} className={className}>
      <span className="relative flex size-1.5" aria-hidden>
        {live && <span className={clsx('absolute inline-flex size-full animate-ping rounded-full opacity-75', dot[s.tone])} />}
        <span className={clsx('relative inline-flex size-1.5 rounded-full', dot[s.tone])} />
      </span>
      {s.label}
    </Badge>
  );
}

/** Método de lectura de la factura. La IA opcional se distingue en violeta. */
export function MethodBadge({ method }: { method?: ExtractionMethod }) {
  if (!method) return <span className="text-xs text-muted">—</span>;
  const titles: Record<ExtractionMethod, string> = {
    ia: 'Leída con IA (opcional, con tu clave)',
    'pdf-texto': 'Leída del texto del PDF, gratis en tu dispositivo',
    ocr: 'Leída con OCR, gratis en tu dispositivo',
    hoja: 'Importada de Excel/CSV',
    manual: 'Introducida a mano',
  };
  return (
    <span title={titles[method]}>
      <Badge tone={method === 'ia' ? 'ai' : 'neutral'}>{METHOD_LABELS[method]}</Badge>
    </span>
  );
}

/** Chip de tendencia de precio: ▲ rojo (sube, malo para el coste) / ▼ verde (baja). */
export function PriceTrendChip({ trend, baseUnit, className }: { trend?: PriceTrend; baseUnit?: BaseUnit; className?: string }) {
  if (!trend || trend.changePct == null || Math.abs(trend.changePct) < 0.1) return null;
  const up = trend.changePct > 0;
  const unit = baseUnit ? ` (${perUnitLabel(baseUnit)})` : '';
  const title = `${up ? 'Sube' : 'Baja'} ${fmtPct(Math.abs(trend.changePct))} desde la compra del ${fmtDate(trend.previousDate)}: ${fmtEurPrecise(trend.previous)} → ${fmtEurPrecise(trend.current)}${unit}`;
  return (
    <span
      title={title}
      className={clsx(
        'tabular inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-bold',
        up ? 'bg-bad-soft text-bad' : 'bg-ok-soft text-ok',
        className,
      )}
    >
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? 'Sube' : 'Baja'}</span>
      {fmtPct(Math.abs(trend.changePct))}
    </span>
  );
}

/** Variación de precio suelta (antes → ahora). */
export function ChangePct({ pct, className }: { pct?: number; className?: string }) {
  if (pct == null || !Number.isFinite(pct)) return <span className={clsx('text-xs text-muted', className)}>—</span>;
  if (Math.abs(pct) < 0.1) return <span className={clsx('text-xs font-semibold text-muted', className)}>= sin cambio</span>;
  const up = pct > 0;
  return (
    <span className={clsx('tabular inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-bold', up ? 'text-bad' : 'text-ok', className)}>
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? 'Sube' : 'Baja'}</span>
      {fmtPct(Math.abs(pct))}
    </span>
  );
}

/** Punto de confianza de lectura (0–1). */
export function ConfidenceDot({ value, className }: { value?: number; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={clsx('inline-block size-2.5 shrink-0 rounded-full bg-line-strong', className)} title="Introducida a mano" />;
  const tone = value >= 0.85 ? 'bg-ok' : value >= 0.6 ? 'bg-warn' : 'bg-bad';
  const label = value >= 0.85 ? 'alta' : value >= 0.6 ? 'media: revísala' : 'baja: compruébala con el documento';
  return (
    <span
      role="img"
      aria-label={`Confianza de lectura ${Math.round(value * 100)} %`}
      title={`Confianza de lectura ${label} (${Math.round(value * 100)} %)`}
      className={clsx('inline-block size-2.5 shrink-0 rounded-full ring-2 ring-surface', tone, className)}
    />
  );
}

/** Icono con burbuja explicativa accesible (hover, foco y toque). */
export function Hint({ children, icon, tone = 'warn', label, className }: { children: ReactNode; icon?: ReactNode; tone?: 'warn' | 'info' | 'bad'; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tones = { warn: 'text-warn', info: 'text-info', bad: 'text-bad' };
  return (
    <span className={clsx('relative inline-flex', className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className={clsx('inline-flex size-7 items-center justify-center rounded-lg transition hover:bg-surface-2', tones[tone])}
      >
        {icon ?? <AlertTriangle className="size-4" />}
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full right-0 z-40 mb-2 w-64 animate-fade-in rounded-xl border border-line bg-elevated p-3 text-left text-xs font-normal leading-relaxed text-ink-2 shadow-pop"
        >
          {children}
        </span>
      )}
    </span>
  );
}

/** Indicador discreto de guardado automático. */
export function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'dirty' | 'error' }) {
  if (state === 'idle') return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted" aria-live="polite">
      {state === 'saving' && (
        <>
          <Loader2 className="size-3.5 animate-spin" /> Guardando…
        </>
      )}
      {state === 'saved' && (
        <>
          <Check className="size-3.5 text-ok" /> Guardado
        </>
      )}
      {state === 'dirty' && (
        <>
          <span className="size-1.5 rounded-full bg-warn" /> Cambios sin guardar
        </>
      )}
      {state === 'error' && (
        <>
          <AlertTriangle className="size-3.5 text-bad" /> No se pudo guardar
        </>
      )}
    </span>
  );
}
