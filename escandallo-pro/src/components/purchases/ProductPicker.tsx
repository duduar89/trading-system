import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Ban, Check, Plus, Search } from 'lucide-react';
import type { ID, IngredientCategory, Product } from '../../types';
import { Modal, Select } from '../ui';
import { CATEGORIES, CATEGORY_LABELS } from '../../lib/labels';
import { fmtEurPrecise, perUnitLabel } from '../../lib/format';
import { CategoryBadge } from './CategoryBadge';
import { searchProducts, suggestProducts, type ProductHit } from './search';
import { useMediaQuery } from './hooks';

export interface ProductPickerProps {
  products: Product[];
  /** Texto con el que proponer coincidencias al abrir (p. ej. la descripción de la línea de factura). */
  seed?: string;
  selectedId?: ID;
  excludeIds?: ID[];
  onSelect: (product: Product) => void;
  /** Si se indica, aparece arriba "Crear nuevo" con nombre (y categoría) editables. */
  create?: { name: string; category?: IngredientCategory; onCreate: (name: string, category?: IngredientCategory) => void };
  /** Si se indica, aparece la opción "Ignorar línea". */
  onIgnore?: () => void;
  /** Texto accesible del disparador y título del selector en móvil. */
  label: string;
  children: ReactNode;
  triggerClassName?: string;
  disabled?: boolean;
}

type Option = { kind: 'create' } | { kind: 'product'; hit: ProductHit; section: 'match' | 'all' } | { kind: 'ignore' };

const PANEL_W = 400;

/**
 * Combobox para elegir un ingrediente de la base de precios: sugerencias difusas a partir de la descripción,
 * búsqueda instantánea (tolera erratas y abreviaturas), "Crear nuevo" y "Ignorar línea".
 * Escritorio: panel flotante anclado; móvil: hoja inferior.
 */
export function ProductPicker({
  products,
  seed,
  selectedId,
  excludeIds,
  onSelect,
  create,
  onIgnore,
  label,
  children,
  triggerClassName,
  disabled,
}: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const desktop = useMediaQuery('(min-width: 640px)');

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'group inline-flex min-h-10 w-full items-center gap-2 rounded-xl border border-line-strong bg-surface px-2.5 text-left text-sm text-ink transition hover:border-brand-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60',
          open && 'border-brand-500 ring-4 ring-brand-500/15',
          triggerClassName,
        )}
      >
        {children}
      </button>
      {open &&
        (desktop ? (
          <FloatingPanel anchor={triggerRef} onClose={close}>
            <PickerPanel {...{ products, seed, selectedId, excludeIds, create, onIgnore }} onSelect={onSelect} onDone={close} />
          </FloatingPanel>
        ) : (
          <Modal open onClose={close} title={label} size="md">
            <PickerPanel {...{ products, seed, selectedId, excludeIds, create, onIgnore }} onSelect={onSelect} onDone={close} sheet />
          </Modal>
        ))}
    </>
  );
}

function FloatingPanel({
  anchor,
  onClose,
  children,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number }>();

  useLayoutEffect(() => {
    let raf = 0;
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(r.width, PANEL_W), vw - 16);
      const left = Math.min(Math.max(8, r.left), vw - width - 8);
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      if (below >= 320 || below >= above) setPos({ left, width, top: r.bottom + 6, maxHeight: Math.max(220, below) });
      else setPos({ left, width, bottom: vh - r.top + 6, maxHeight: Math.max(220, above) });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[60] flex animate-fade-in flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-pop"
      style={
        pos
          ? { left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: Math.min(pos.maxHeight, 460) }
          : { opacity: 0, pointerEvents: 'none', left: 0, top: 0, width: PANEL_W }
      }
    >
      {children}
    </div>,
    document.body,
  );
}

function PickerPanel({
  products,
  seed,
  selectedId,
  excludeIds,
  create,
  onIgnore,
  onSelect,
  onDone,
  sheet,
}: Pick<ProductPickerProps, 'products' | 'seed' | 'selectedId' | 'excludeIds' | 'create' | 'onIgnore' | 'onSelect'> & {
  onDone: () => void;
  sheet?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [createName, setCreateName] = useState(create?.name ?? '');
  const [createNameTouched, setCreateNameTouched] = useState(false);
  const [createCategory, setCreateCategory] = useState<IngredientCategory | ''>(create?.category ?? '');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pool = useMemo(() => (excludeIds?.length ? products.filter((p) => !excludeIds.includes(p.id)) : products), [products, excludeIds]);
  const suggestions = useMemo(() => (seed ? suggestProducts(seed, pool, 6, 0.35) : []), [seed, pool]);
  const hits = useMemo(() => searchProducts(query, pool, 30), [query, pool]);

  const options: Option[] = useMemo(() => {
    const out: Option[] = [];
    if (create) out.push({ kind: 'create' });
    if (query.trim()) {
      for (const h of hits) out.push({ kind: 'product', hit: h, section: 'match' });
    } else {
      const seen = new Set<ID>();
      for (const h of suggestions) {
        seen.add(h.product.id);
        out.push({ kind: 'product', hit: h, section: 'match' });
      }
      const rest = pool
        .filter((p) => !seen.has(p.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        .slice(0, 60);
      for (const p of rest) out.push({ kind: 'product', hit: { product: p, score: 0 }, section: 'all' });
    }
    if (onIgnore) out.push({ kind: 'ignore' });
    return out;
  }, [create, query, hits, suggestions, pool, onIgnore]);

  // La opción activa por defecto: la mejor coincidencia si es buena; si no, "Crear nuevo".
  useEffect(() => {
    const firstProduct = options.findIndex((o) => o.kind === 'product');
    const best = firstProduct >= 0 ? options[firstProduct] : undefined;
    const strong = best?.kind === 'product' && (query.trim() ? true : best.hit.score >= 0.55);
    setActive(strong ? firstProduct : 0);
  }, [options, query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    if (!sheet) inputRef.current?.focus();
  }, [sheet]);

  const effectiveCreateName =
    createNameTouched || !query.trim() ? createName : query.trim().charAt(0).toUpperCase() + query.trim().slice(1);

  const choose = (o: Option | undefined) => {
    if (!o) return;
    if (o.kind === 'create') {
      const name = effectiveCreateName.trim();
      if (!name || !create) return;
      create.onCreate(name, createCategory || undefined);
    } else if (o.kind === 'ignore') onIgnore?.();
    else onSelect(o.hit.product);
    onDone();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onDone();
    }
  };

  const firstAll = options.findIndex((o) => o.kind === 'product' && o.section === 'all');
  const firstMatch = options.findIndex((o) => o.kind === 'product' && o.section === 'match');

  return (
    <div className={clsx('flex min-h-0 flex-col', sheet && '-mx-1')} onKeyDown={onKey}>
      <div className={clsx('relative shrink-0', sheet ? 'mb-3' : 'border-b border-line p-2')}>
        <Search className={clsx('pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted', sheet ? 'left-3' : 'left-5')} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar ingrediente…"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={`${listId}-${active}`}
          aria-autocomplete="list"
          className="h-10 w-full rounded-xl border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-muted/70 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
        />
      </div>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Ingredientes"
        className={clsx('min-h-0 flex-1 overflow-y-auto', sheet ? 'max-h-[60dvh]' : 'p-1.5')}
      >
        {options.map((o, i) => {
          const isActive = i === active;
          const common = {
            id: `${listId}-${i}`,
            'data-index': i,
            role: 'option' as const,
            'aria-selected': isActive,
            onMouseEnter: () => setActive(i),
          };
          if (o.kind === 'create') {
            return (
              <div
                key="create"
                {...common}
                className={clsx(
                  'mb-1 rounded-xl border p-2.5 transition',
                  isActive ? 'border-brand-400 bg-brand-500/8' : 'border-dashed border-line-strong',
                )}
              >
                <div className="mb-2 flex items-center gap-2 text-xs font-bold text-brand-600 dark:text-brand-400">
                  <Plus className="size-3.5" /> Crear nuevo ingrediente
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={effectiveCreateName}
                    onChange={(e) => {
                      setCreateNameTouched(true);
                      setCreateName(e.target.value);
                    }}
                    onFocus={() => setActive(i)}
                    aria-label="Nombre del nuevo ingrediente"
                    className="h-10 w-full min-w-0 shrink-0 rounded-xl border border-line-strong bg-surface px-3 text-sm font-semibold sm:w-auto sm:flex-1 text-ink focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
                  />
                  <Select
                    value={createCategory}
                    onChange={(e) => setCreateCategory(e.target.value as IngredientCategory | '')}
                    onFocus={() => setActive(i)}
                    aria-label="Categoría del nuevo ingrediente"
                    className="sm:w-44"
                  >
                    <option value="">Automática</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c].emoji} {CATEGORY_LABELS[c].label}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => choose(o)}
                    disabled={!effectiveCreateName.trim()}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-brand-500 px-3.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
                  >
                    Crear
                  </button>
                </div>
              </div>
            );
          }
          if (o.kind === 'ignore') {
            return (
              <button
                key="ignore"
                type="button"
                {...common}
                onClick={() => choose(o)}
                className={clsx(
                  'mt-1 flex min-h-11 w-full items-center gap-2.5 rounded-xl border-t border-line px-2.5 text-left text-sm text-muted transition',
                  isActive && 'bg-surface-2 text-ink',
                )}
              >
                <Ban className="size-4" /> Ignorar línea <span className="text-xs">(portes, envases, cargos…)</span>
              </button>
            );
          }
          const p = o.hit.product;
          const selected = p.id === selectedId;
          return (
            <div key={p.id}>
              {i === firstMatch && (
                <SectionTitle>
                  {query.trim() ? `${hits.length} resultado${hits.length === 1 ? '' : 's'}` : 'Coincidencias probables'}
                </SectionTitle>
              )}
              {i === firstAll && <SectionTitle>Todos los ingredientes</SectionTitle>}
              <button
                type="button"
                {...common}
                onClick={() => choose(o)}
                className={clsx(
                  'flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition',
                  isActive ? 'bg-surface-2' : 'hover:bg-surface-2',
                )}
              >
                <CategoryBadge category={p.category} compact />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-ink">{p.name}</span>
                    {selected && <Check className="size-4 shrink-0 text-ok" aria-label="Seleccionado" />}
                  </span>
                  {o.hit.matchedOn && <span className="block truncate text-[11px] text-muted">por «{o.hit.matchedOn}»</span>}
                </span>
                <span className="shrink-0 text-right">
                  <span className={clsx('tabular block text-xs font-semibold', p.pricePerBase > 0 ? 'text-ink-2' : 'text-muted')}>
                    {p.pricePerBase > 0 ? `${fmtEurPrecise(p.pricePerBase)}/${p.baseUnit}` : `sin precio (${perUnitLabel(p.baseUnit)})`}
                  </span>
                  {o.section === 'match' && !query.trim() && o.hit.score > 0 && (
                    <span className="tabular block text-[10px] font-semibold text-muted">coincide {Math.round(o.hit.score * 100)} %</span>
                  )}
                </span>
              </button>
            </div>
          );
        })}
        {query.trim() && !hits.length && (
          <p className="px-3 py-4 text-center text-sm text-muted">
            Ningún ingrediente coincide con «{query.trim()}».{create ? ' Puedes crearlo arriba.' : ''}
          </p>
        )}
        {!query.trim() && !pool.length && (
          <p className="px-3 py-4 text-center text-sm text-muted">Aún no hay ingredientes en tu base de precios.</p>
        )}
      </div>
      {!sheet && (
        <div className="shrink-0 border-t border-line px-3 py-2 text-[11px] text-muted">
          <kbd className="font-mono">↑↓</kbd> moverse · <kbd className="font-mono">Enter</kbd> elegir · <kbd className="font-mono">Esc</kbd>{' '}
          cerrar
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-wider text-muted">{children}</div>;
}
