/**
 * Librería de componentes base de Escandallo Pro.
 * Todas las páginas deben construirse con estas piezas para mantener un diseño coherente.
 */
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Loader2, X, UploadCloud, Info } from 'lucide-react';
import type { FoodCostStatus } from '../core/costing';
import { fmtPct } from '../lib/format';

export { clsx as cx };

// ───────────────────────────── Botones ─────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
}

const btnVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-[0_8px_24px_-10px_rgb(255_90_31/0.8)] disabled:shadow-none',
  secondary: 'bg-ink text-bg hover:opacity-90 active:opacity-80',
  outline: 'border border-line-strong bg-surface text-ink hover:bg-surface-2 active:bg-line',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink active:bg-line',
  danger: 'bg-bad text-white hover:brightness-95 active:brightness-90',
  ai: 'bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white hover:brightness-110 shadow-[0_8px_24px_-10px_rgb(139_92_246/0.8)]',
};
const btnSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
  xl: 'h-14 px-7 text-base gap-2.5 rounded-2xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, iconRight, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-semibold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50',
        btnVariants[variant],
        btnSizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex size-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink active:bg-line disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ───────────────────────────── Superficies ─────────────────────────────

export function Card({
  className,
  children,
  padded = true,
  interactive,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean; interactive?: boolean }) {
  return (
    <div
      className={clsx(
        'rounded-2xl border border-line bg-surface shadow-card',
        padded && 'p-4 sm:p-5',
        interactive && 'cursor-pointer transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500">{icon}</div>}
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold text-ink sm:text-lg">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-brand-500">{eyebrow}</div>}
        <h1 className="font-display text-2xl font-extrabold text-ink sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted sm:text-[15px]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ───────────────────────────── KPIs ─────────────────────────────

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  trend,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'bad' | 'brand' | 'ai';
  trend?: { value: string; direction: 'up' | 'down' | 'flat'; good?: boolean };
  className?: string;
}) {
  const toneRing: Record<string, string> = {
    default: 'bg-surface-2 text-ink-2',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    bad: 'bg-bad-soft text-bad',
    brand: 'bg-brand-500/12 text-brand-500',
    ai: 'bg-ai-soft text-ai',
  };
  return (
    <Card className={clsx('relative overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
        {icon && <div className={clsx('flex size-8 items-center justify-center rounded-lg', toneRing[tone])}>{icon}</div>}
      </div>
      <div className="tabular mt-2 font-display text-2xl font-extrabold text-ink sm:text-[28px]">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {trend && (
          <span
            className={clsx(
              'rounded-md px-1.5 py-0.5 font-semibold',
              trend.good === undefined ? 'bg-surface-2 text-ink-2' : trend.good ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad',
            )}
          >
            {trend.direction === 'up' ? '▲' : trend.direction === 'down' ? '▼' : '•'} {trend.value}
          </span>
        )}
        {hint}
      </div>
    </Card>
  );
}

// ───────────────────────────── Badges ─────────────────────────────

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'ai';
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-ink-2 border-line',
  ok: 'bg-ok-soft text-ok border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  bad: 'bg-bad-soft text-bad border-transparent',
  info: 'bg-info-soft text-info border-transparent',
  brand: 'bg-brand-500/12 text-brand-600 dark:text-brand-400 border-transparent',
  ai: 'bg-ai-soft text-ai border-transparent',
};

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: BadgeTone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold', badgeTones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

const fcTone: Record<FoodCostStatus, BadgeTone> = { ok: 'ok', warn: 'warn', bad: 'bad', none: 'neutral' };

/** Píldora de food cost con semáforo. */
export function FoodCostBadge({ pct, status, size = 'md' }: { pct?: number; status: FoodCostStatus; size?: 'md' | 'lg' }) {
  if (size === 'lg') {
    const colors: Record<FoodCostStatus, string> = {
      ok: 'bg-ok text-white',
      warn: 'bg-warn text-white',
      bad: 'bg-bad text-white',
      none: 'bg-surface-2 text-muted',
    };
    return <span className={clsx('tabular inline-flex items-center rounded-xl px-3 py-1.5 font-display text-lg font-extrabold', colors[status])}>{fmtPct(pct)}</span>;
  }
  return (
    <Badge tone={fcTone[status]} className="tabular">
      {fmtPct(pct)}
    </Badge>
  );
}

// ───────────────────────────── Formularios ─────────────────────────────

export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="mb-1.5 block text-xs font-semibold text-ink-2">{label}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const inputBase =
  'w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted/70 transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & { suffix?: ReactNode; prefix?: ReactNode }>(
  function Input({ className, suffix, prefix, ...rest }, ref) {
    if (suffix || prefix) {
      return (
        <div className={clsx('relative flex items-center', className)}>
          {prefix && <span className="pointer-events-none absolute left-3 text-sm text-muted">{prefix}</span>}
          <input ref={ref} className={clsx(inputBase, 'h-10', prefix && 'pl-8', suffix && 'pr-12')} {...rest} />
          {suffix && <span className="pointer-events-none absolute right-3 text-xs font-medium text-muted">{suffix}</span>}
        </div>
      );
    }
    return <input ref={ref} className={clsx(inputBase, 'h-10', className)} {...rest} />;
  },
);

/**
 * Input numérico que acepta coma decimal (es-ES). Llama a onValue con number | undefined.
 * Mantiene el texto mientras se escribe para no "saltar" al teclear "12,".
 */
export function NumberInput({
  value,
  onValue,
  decimals = 3,
  className,
  suffix,
  prefix,
  placeholder,
  min,
  disabled,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix' | 'min' | 'placeholder'> & {
  placeholder?: string;
  value: number | undefined | null;
  onValue: (v: number | undefined) => void;
  decimals?: number;
  suffix?: ReactNode;
  prefix?: ReactNode;
  min?: number;
}) {
  const toText = (v: number | undefined | null) =>
    v == null || !Number.isFinite(v) ? '' : String(Math.round(v * 10 ** decimals) / 10 ** decimals).replace('.', ',');
  const [text, setText] = useState(toText(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      {...rest}
      inputMode="decimal"
      className={className}
      suffix={suffix}
      prefix={prefix}
      placeholder={placeholder}
      disabled={disabled}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(toText(value));
      }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const norm = t.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
        if (norm === '' || norm === '-') return onValue(undefined);
        const n = Number(norm);
        if (Number.isFinite(n)) onValue(min != null ? Math.max(min, n) : n);
      }}
    />
  );
}

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx(inputBase, 'h-10 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23677486' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(inputBase, 'min-h-[88px] py-2.5', className)} {...rest} />;
});

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      {(label || description) && (
        <label htmlFor={id} className="min-w-0 cursor-pointer">
          {label && <div className="text-sm font-semibold text-ink">{label}</div>}
          {description && <div className="text-xs text-muted">{description}</div>}
        </label>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-brand-500' : 'bg-line-strong')}
      >
        <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
    </div>
  );
}

/** Control segmentado (pestañas compactas). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={clsx('inline-flex rounded-xl border border-line bg-surface-2 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-lg font-semibold transition',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            value === o.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────────── Feedback ─────────────────────────────

export function ProgressBar({ value, tone = 'brand', className }: { value: number; tone?: 'brand' | 'ok' | 'warn' | 'bad' | 'ai'; className?: string }) {
  const colors = { brand: 'bg-brand-500', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', ai: 'bg-ai' };
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-line', className)}>
      <div className={clsx('h-full rounded-full transition-all duration-500', colors[tone])} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-brand-500', className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center', className)}>
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500">{icon}</div>}
      <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Callout({ tone = 'info', title, children, icon, className }: { tone?: 'info' | 'warn' | 'bad' | 'ok' | 'ai'; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string }) {
  const tones = {
    info: 'border-info/30 bg-info-soft',
    warn: 'border-warn/30 bg-warn-soft',
    bad: 'border-bad/30 bg-bad-soft',
    ok: 'border-ok/30 bg-ok-soft',
    ai: 'border-ai/30 bg-ai-soft',
  };
  const iconTones = { info: 'text-info', warn: 'text-warn', bad: 'text-bad', ok: 'text-ok', ai: 'text-ai' };
  return (
    <div className={clsx('flex gap-3 rounded-xl border p-3.5 text-sm', tones[tone], className)}>
      <div className={clsx('mt-0.5 shrink-0', iconTones[tone])}>{icon ?? <Info className="size-4" />}</div>
      <div className="min-w-0 text-ink-2">
        {title && <div className="font-semibold text-ink">{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ───────────────────────────── Modal / Drawer ─────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl', full: 'sm:max-w-[min(1400px,96vw)]' };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx('relative flex max-h-[94dvh] w-full animate-slide-up flex-col rounded-t-3xl border border-line bg-elevated shadow-pop sm:rounded-3xl', widths[size])}>
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              {title && <h2 className="font-display text-lg font-bold text-ink">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
            </div>
            <IconButton label="Cerrar" onClick={onClose}>
              <X className="size-5" />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Diálogo de confirmación imperativo. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p className="text-sm text-ink-2">{message}</p>}
    </Modal>
  );
}

// ───────────────────────────── Subida de archivos ─────────────────────────────

export function FileDrop({
  accept,
  multiple = true,
  onFiles,
  title = 'Arrastra aquí tus archivos',
  description,
  icon,
  capture,
  className,
  compact,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  capture?: 'environment' | 'user';
  className?: string;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      className={clsx(
        'group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center transition',
        compact ? 'px-4 py-6' : 'px-6 py-12',
        over ? 'border-brand-500 bg-brand-500/8' : 'border-line-strong bg-surface-2/60 hover:border-brand-400 hover:bg-brand-500/5',
        className,
      )}
    >
      <div className={clsx('mb-3 flex items-center justify-center rounded-2xl bg-brand-500/10 text-brand-500 transition group-hover:scale-105', compact ? 'size-11' : 'size-16')}>
        {icon ?? <UploadCloud className={compact ? 'size-5' : 'size-7'} />}
      </div>
      <div className={clsx('font-display font-bold text-ink', compact ? 'text-base' : 'text-lg')}>{title}</div>
      {description && <div className="mt-1 max-w-md text-sm text-muted">{description}</div>}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        capture={capture}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ───────────────────────────── Tabla ─────────────────────────────

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto rounded-2xl border border-line bg-surface', className)}>
      <table className="tabular w-full min-w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className={clsx(
        'sticky top-0 z-[1] whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-muted',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}
export function Td({ children, className, align = 'left', ...rest }: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <td className={clsx('border-b border-line px-3 py-2.5 align-middle text-ink-2', align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left', className)} {...rest}>
      {children}
    </td>
  );
}

// ───────────────────────────── Varios ─────────────────────────────

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={clsx('h-px w-full bg-line', className)} />;
}

/** Barra de búsqueda estándar. */
export function SearchInput({ value, onChange, placeholder = 'Buscar…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={clsx('relative', className)}>
      <svg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={clsx(inputBase, 'h-10 pl-9')} />
    </div>
  );
}
