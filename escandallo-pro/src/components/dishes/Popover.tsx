import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

/**
 * Capa flotante anclada a un elemento, renderizada en un portal con posición fija:
 * no la recortan las tablas con scroll horizontal ni las tarjetas con overflow.
 * Se recoloca al hacer scroll / redimensionar y se abre hacia arriba si no cabe debajo.
 */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  className,
  align = 'start',
  matchWidth,
  minWidth = 220,
  role,
  id,
  keepFocus,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  matchWidth?: boolean;
  minWidth?: number;
  role?: string;
  id?: string;
  /** Pulsar dentro de la capa no quita el foco al campo que la abrió (combobox que se cierra al perder el foco). */
  keepFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number; maxHeight: number; placement: 'down' | 'up' } | null>(null);

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = matchWidth ? Math.max(r.width, minWidth) : undefined;
    const w = width ?? ref.current?.offsetWidth ?? minWidth;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    const placement = below < 220 && above > below ? 'up' : 'down';
    const maxHeight = Math.max(160, Math.min(420, placement === 'down' ? below : above));
    const top = placement === 'down' ? r.bottom + 6 : r.top - 6;
    setPos({ top, left, width, maxHeight, placement });
  }, [anchor, align, matchWidth, minWidth]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, place, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      id={id}
      role={role}
      onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: pos?.width,
        minWidth: pos?.width ? undefined : minWidth,
        maxHeight: pos?.maxHeight,
        transform: pos?.placement === 'up' ? 'translateY(-100%)' : undefined,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className={clsx('no-print z-[60] animate-fade-in overflow-y-auto rounded-2xl border border-line bg-elevated p-1.5 shadow-pop', className)}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Opción de menú contextual. */
export function MenuItem({
  icon,
  children,
  onClick,
  danger,
  disabled,
  hint,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition disabled:opacity-40',
        danger ? 'text-bad hover:bg-bad-soft' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
      )}
    >
      {icon && <span className="shrink-0 [&>svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1">
        {children}
        {hint && <span className="block text-xs font-normal text-muted">{hint}</span>}
      </span>
    </button>
  );
}
