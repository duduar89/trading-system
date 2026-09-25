import type { ReactNode } from 'react';
import clsx from 'clsx';

/** Contenedor del tooltip de los gráficos: el valor manda, la etiqueta acompaña. */
export function ChartTooltipBox({
  title,
  rows,
  footer,
}: {
  title?: ReactNode;
  rows: { key: string; color?: string; label: ReactNode; value: ReactNode; shape?: 'line' | 'dot' }[];
  footer?: ReactNode;
}) {
  return (
    <div className="pointer-events-none min-w-[160px] max-w-[260px] rounded-xl border border-line bg-elevated px-3 py-2.5 text-xs shadow-pop">
      {title && <div className="mb-1.5 truncate font-semibold text-ink-2">{title}</div>}
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            {r.color && (
              <span
                aria-hidden
                className={clsx('shrink-0', r.shape === 'dot' ? 'size-2 rounded-full' : 'h-0.5 w-3 rounded-full')}
                style={{ background: r.color }}
              />
            )}
            <span className="tabular font-display text-sm font-bold text-ink">{r.value}</span>
            <span className="min-w-0 truncate text-muted">{r.label}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-line pt-1.5 text-[11px] text-muted">{footer}</div>}
    </div>
  );
}

/** Leyenda HTML: la marca lleva el color, el texto va en tinta. */
export function ChartLegend({
  items,
  className,
}: {
  items: { key: string; color: string; label: ReactNode; shape?: 'square' | 'line' | 'dot' | ReactNode; count?: ReactNode }[];
  className?: string;
}) {
  return (
    <ul className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2', className)}>
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-1.5">
          {i.shape === 'line' ? (
            <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: i.color }} />
          ) : i.shape === 'dot' ? (
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: i.color }} />
          ) : i.shape == null || i.shape === 'square' ? (
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
          ) : (
            <span aria-hidden className="flex items-center" style={{ color: i.color }}>
              {i.shape}
            </span>
          )}
          <span>{i.label}</span>
          {i.count != null && <span className="tabular font-semibold text-muted">{i.count}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Estado vacío compacto para el hueco de un gráfico. */
export function ChartEmpty({
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
    <div
      className={clsx(
        'flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface-2/60 px-5 py-8 text-center',
        className,
      )}
    >
      {icon && <div className="mb-2.5 flex size-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500">{icon}</div>}
      <div className="text-sm font-semibold text-ink">{title}</div>
      {description && <p className="mt-1 max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Tabla accesible (solo lectores de pantalla) equivalente a un gráfico. */
export function SrTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
