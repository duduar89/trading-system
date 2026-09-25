import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

export interface MenuItem {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger' | 'ai';
  disabled?: boolean;
}

const MENU_W = 288;

/**
 * Menú desplegable accesible (Esc / clic fuera cierran; flechas para moverse).
 * Se pinta en un portal con posición fija para que ninguna tabla con scroll lo recorte.
 */
export function DropdownMenu({
  trigger,
  items,
  align = 'right',
  label,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>();

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(MENU_W, vw - 16);
      const rawLeft = align === 'right' ? r.right - width : r.left;
      const left = Math.min(Math.max(8, rawLeft), vw - width - 8);
      const menuH = menuRef.current?.offsetHeight ?? 200;
      if (vh - r.bottom < menuH + 16 && r.top > vh - r.bottom) setPos({ left, bottom: vh - r.top + 8 });
      else setPos({ left, top: r.bottom + 8 });
    };
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        rootRef.current?.querySelector<HTMLElement>('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    const raf = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            style={{ left: pos?.left ?? -9999, top: pos?.top, bottom: pos?.bottom, width: Math.min(MENU_W, window.innerWidth - 16), visibility: pos ? 'visible' : 'hidden' }}
            className="fixed z-[60] animate-fade-in overflow-hidden rounded-2xl border border-line bg-elevated p-1.5 shadow-pop"
          >
            {items.map((it, i) => (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={clsx(
                  'flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-2 focus:bg-surface-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-45',
                  it.tone === 'danger' ? 'text-bad' : 'text-ink',
                )}
              >
                {it.icon && <span className={clsx('mt-0.5 shrink-0', it.tone === 'ai' ? 'text-ai' : it.tone === 'danger' ? 'text-bad' : 'text-muted')}>{it.icon}</span>}
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{it.label}</span>
                  {it.description && <span className="mt-0.5 block text-xs text-muted">{it.description}</span>}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
