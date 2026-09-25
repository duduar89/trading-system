import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Plus, CornerDownLeft, Loader2 } from 'lucide-react';
import type { Dish, ID, Product } from '../../types';
import { CATEGORY_LABELS } from '../../lib/labels';
import { perUnitLabel } from '../../lib/format';
import { EstimatedBadge } from '../purchases/badges';
import { isEstimatedPrice } from '../purchases/estimated';
import { Popover } from './Popover';
import { fmtPrice, normalize, searchIngredients, type IngredientOption } from './logic';

/**
 * Campo de ingrediente con buscador (combobox): escribe el nombre como en la receta y elige el producto
 * de tus facturas o una elaboración propia. Si no existe, lo crea al vuelo con los datos de la base de conocimiento.
 */
export function IngredientPicker({
  value,
  onChangeText,
  products,
  elaborations,
  excludeDishId,
  onPick,
  onCreate,
  dishPriceLabel,
  inputRef,
  placeholder = 'Ingrediente…',
  className,
  ariaLabel = 'Ingrediente',
  invalid,
}: {
  value: string;
  onChangeText: (v: string) => void;
  products: Product[];
  elaborations: Dish[];
  excludeDishId?: ID;
  onPick: (opt: IngredientOption) => void;
  onCreate: (name: string) => Promise<void>;
  /** Precio legible de una elaboración (lo calcula quien tiene el contexto de costes). */
  dishPriceLabel?: (d: Dish) => ReactNode;
  inputRef?: (el: HTMLInputElement | null) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  invalid?: boolean;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const listId = useId();

  const options = useMemo(
    () => (open ? searchIngredients(value, products, elaborations, 8, excludeDishId) : []),
    [open, value, products, elaborations, excludeDishId],
  );
  const trimmed = value.trim();
  const exact = options.some((o) => normalize(o.name) === normalize(trimmed));
  const canCreate = trimmed.length >= 2 && !exact;
  const count = options.length + (canCreate ? 1 : 0);

  const choose = async (index: number) => {
    if (index < options.length) {
      onPick(options[index]);
      setOpen(false);
      return;
    }
    if (canCreate && !creating) {
      setCreating(true);
      try {
        await onCreate(trimmed);
        setOpen(false);
      } finally {
        setCreating(false);
      }
    }
  };

  return (
    <div ref={anchor} className={clsx('relative', className)}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && count ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          // Se cierra al salir del campo (la lista mantiene el foco en el input al pulsarla); mientras se crea, sigue abierta.
          if (!creating) setOpen(false);
        }}
        onChange={(e) => {
          onChangeText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (count ? (a + 1) % count : 0));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (count ? (a - 1 + count) % count : 0));
          } else if (e.key === 'Enter' && open && count && trimmed) {
            e.preventDefault();
            void choose(active);
          } else if (e.key === 'Escape') {
            setOpen(false);
          } else if (e.key === 'Tab') {
            setOpen(false);
          }
        }}
        className={clsx(
          'h-10 w-full rounded-xl border bg-surface px-3 text-sm font-semibold text-ink placeholder:font-normal placeholder:text-muted/70 transition focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15',
          invalid ? 'border-warn/60' : 'border-line-strong',
        )}
      />
      <Popover anchor={anchor} open={open && count > 0} onClose={() => setOpen(false)} matchWidth minWidth={300} role="listbox" id={listId} keepFocus>
        {options.map((o, i) => (
          <OptionRow key={`${o.kind}:${o.id}`} id={`${listId}-${i}`} option={o} active={i === active} onHover={() => setActive(i)} onChoose={() => void choose(i)} dishPriceLabel={dishPriceLabel} />
        ))}
        {canCreate && (
          <button
            type="button"
            id={`${listId}-${options.length}`}
            role="option"
            aria-selected={active === options.length}
            onMouseEnter={() => setActive(options.length)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void choose(options.length)}
            className={clsx(
              'mt-1 flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-dashed px-3 py-2 text-left text-sm transition',
              active === options.length ? 'border-brand-400 bg-brand-500/8 text-ink' : 'border-line-strong text-ink-2',
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/12 text-brand-500">
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-semibold">Crear ingrediente «{trimmed}»</span>
              <span className="block text-xs text-muted">Con merma, alérgenos y precio de referencia de nuestra base; lo afinas con tu factura</span>
            </span>
          </button>
        )}
        <div className="flex items-center justify-end gap-1 px-2 pb-0.5 pt-1.5 text-[10px] text-muted">
          <CornerDownLeft className="size-3" /> para elegir · Esc para cerrar
        </div>
      </Popover>
    </div>
  );
}

function OptionRow({
  id,
  option,
  active,
  onHover,
  onChoose,
  dishPriceLabel,
}: {
  id: string;
  option: IngredientOption;
  active: boolean;
  onHover: () => void;
  onChoose: () => void;
  dishPriceLabel?: (d: Dish) => ReactNode;
}) {
  const p = option.product;
  const emoji = option.kind === 'dish' ? '🍲' : p ? CATEGORY_LABELS[p.category]?.emoji ?? '📦' : '📦';
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onChoose}
      className={clsx('flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition', active ? 'bg-surface-2' : 'hover:bg-surface-2')}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-base" aria-hidden>
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink">{option.name}</span>
          {option.kind === 'dish' && (
            <span className="shrink-0 rounded-full bg-info-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-info">elaboración</span>
          )}
        </span>
        {option.matchedOn && <span className="block truncate text-xs text-muted">≈ {option.matchedOn}</span>}
      </span>
      <span className="tabular shrink-0 text-right text-xs">
        {option.kind === 'dish' && option.dish ? (
          <span className="text-ink-2">{dishPriceLabel?.(option.dish)}</span>
        ) : p && p.pricePerBase > 0 ? (
          <span className="flex flex-col items-end gap-0.5">
            <span className="font-semibold text-ink-2">
              {fmtPrice(p.pricePerBase)}
              <span className="font-normal text-muted"> {perUnitLabel(p.baseUnit).replace('€', '')}</span>
            </span>
            {isEstimatedPrice(p) && <EstimatedBadge short />}
          </span>
        ) : (
          <span className="rounded-full bg-warn-soft px-1.5 py-0.5 font-semibold text-warn">sin precio</span>
        )}
      </span>
    </button>
  );
}
