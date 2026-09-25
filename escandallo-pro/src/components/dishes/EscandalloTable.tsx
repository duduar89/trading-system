import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCheck,
  ExternalLink,
  Info,
  Link2Off,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
  Wand2,
} from 'lucide-react';
import type { BusinessSettings, Dish, DishCost, ID, ItemCost, Product, QtyBasis, QtyUnit, RecipeItem } from '../../types';
import { costDish, maxAffordablePrice, type CostingContext } from '../../core/costing';
import { QTY_UNITS, UNIT_LABELS, convertToBase, defaultRecipeUnit } from '../../core/units';
import { AUTO_LINK_THRESHOLD } from '../../core/matching';
import { BASIS_LABELS, CATEGORY_LABELS } from '../../lib/labels';
import { fmtBaseQty, fmtEur, fmtKg, fmtNum, perUnitLabel } from '../../lib/format';
import { newRecipeItem } from '../../services/dishes';
import { addProductAlias, createProduct } from '../../services/products';
import { errorMessage, toast } from '../../state/store';
import { Button, EmptyState, IconButton, NumberInput, Select } from '../ui';
import { IngredientPicker } from './IngredientPicker';
import { MenuItem, Popover } from './Popover';
import { useMediaQuery } from './hooks';
import { fmtPrice, moveItem, normalize, patchItem, targetOf, type IngredientOption, fmtPctNb } from './logic';

const BASES: QtyBasis[] = ['neta', 'bruta', 'cocinada'];

export interface EscandalloTableProps {
  dish: Dish;
  cost: DishCost;
  ctx: CostingContext;
  products: Product[];
  business: BusinessSettings;
  onItemsChange: (items: RecipeItem[]) => void;
  onPropose?: () => void;
}

/** Datos derivados de una línea para pintarla. */
interface LineInfo {
  product?: Product;
  sub?: Dish;
  testId?: ID;
  ic?: ItemCost;
}

/**
 * Tabla de escandallo: una fila por ingrediente con cantidad, base de peso, mermas y el cálculo en vivo
 * (bruto, servido, €/ud, coste y peso en el coste). En pantallas estrechas cada fila es una tarjeta.
 */
export function EscandalloTable({ dish, cost, ctx, products, business, onItemsChange, onPropose }: EscandalloTableProps) {
  const wide = useMediaQuery('(min-width: 1280px)');
  const items = dish.items;
  const portions = dish.portions > 0 ? dish.portions : 1;
  const nameRefs = useRef(new Map<ID, HTMLInputElement>());
  const [focusId, setFocusId] = useState<ID | null>(null);

  const elaborations = useMemo(
    () => [...ctx.dishes.values()].filter((d) => d.kind === 'elaboracion' && d.id !== dish.id).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [ctx.dishes, dish.id],
  );
  const costById = useMemo(() => new Map(cost.items.map((i) => [i.itemId, i])), [cost]);

  useEffect(() => {
    if (!focusId) return;
    const el = nameRefs.current.get(focusId);
    if (el) {
      el.focus();
      setFocusId(null);
    }
  }, [focusId, items]);

  const info = useCallback(
    (item: RecipeItem): LineInfo => {
      const ic = costById.get(item.id);
      if (item.ref?.type === 'product') {
        const product = ctx.products.get(item.ref.id);
        const testId = ic?.wasteSource === 'prueba' ? item.yieldTestId ?? product?.yieldTestId : undefined;
        return { product, testId, ic };
      }
      if (item.ref?.type === 'dish') return { sub: ctx.dishes.get(item.ref.id), ic };
      return { ic };
    },
    [costById, ctx],
  );

  const dishPriceLabel = useCallback(
    (d: Dish): ReactNode => {
      const c = costDish(d, ctx);
      if (d.yieldQty && d.yieldQty > 0 && d.yieldUnit) {
        return (
          <>
            <span className="font-semibold">{fmtPrice(c.totalCost / d.yieldQty)}</span>
            <span className="text-muted"> /{d.yieldUnit}</span>
          </>
        );
      }
      return (
        <>
          <span className="font-semibold">{fmtEur(c.costPerPortion)}</span>
          <span className="text-muted"> /ración</span>
        </>
      );
    },
    [ctx],
  );

  // ── Acciones ──
  const setItem = (id: ID, patch: Partial<RecipeItem>) => onItemsChange(patchItem(items, id, patch));

  const addAfter = (afterId?: ID) => {
    const it = newRecipeItem();
    const idx = afterId ? items.findIndex((i) => i.id === afterId) : -1;
    const next = [...items];
    next.splice(idx >= 0 ? idx + 1 : next.length, 0, it);
    onItemsChange(next);
    setFocusId(it.id);
  };

  const remove = (id: ID) => onItemsChange(items.filter((i) => i.id !== id));

  const pick = (item: RecipeItem, opt: IngredientOption) => {
    const patch: Partial<RecipeItem> = { ref: { type: opt.kind, id: opt.id }, matchScore: 1, suggested: false };
    if (!item.name.trim()) patch.name = opt.name;
    if (opt.kind === 'product' && opt.product) {
      const p = opt.product;
      const probe = convertToBase(1, item.unit, p.baseUnit, { unitWeightKg: p.unitWeightKg, densityKgPerL: p.densityKgPerL });
      if (!probe.ok) patch.unit = defaultRecipeUnit(p.baseUnit);
      // Aprende el nombre de la receta como alias del producto para próximos emparejamientos.
      const typed = item.name.trim();
      if (typed && normalize(typed) !== normalize(p.name) && !p.aliases.some((a) => normalize(a) === normalize(typed))) {
        addProductAlias(p.id, typed).catch(() => undefined);
      }
    } else if (opt.kind === 'dish' && opt.dish) {
      const d = opt.dish;
      const yu = d.yieldQty && d.yieldQty > 0 ? d.yieldUnit : undefined;
      if (yu) {
        if (!convertToBase(1, item.unit, yu, {}).ok) patch.unit = defaultRecipeUnit(yu);
      } else if (item.unit !== 'ud' && !(d.items.length && item.quantity > 0)) {
        patch.unit = 'ud';
      }
      // En elaboraciones la merma ya va dentro de su escandallo.
      patch.wastePct = undefined;
      patch.cookingLossPct = undefined;
    }
    setItem(item.id, patch);
  };

  const create = async (item: RecipeItem, name: string) => {
    try {
      const p = await createProduct({ name });
      pick({ ...item, name: item.name || name }, { kind: 'product', id: p.id, name: p.name, score: 1, product: p });
      if (p.pricePerBase > 0) toast.success(`Ingrediente «${p.name}» creado`, `Precio de referencia ${fmtPrice(p.pricePerBase)} ${perUnitLabel(p.baseUnit)}: se actualizará con tu próxima factura.`);
      else toast.info(`Ingrediente «${p.name}» creado`, 'Indica su precio en Ingredientes o sube una factura donde aparezca.');
    } catch (e) {
      toast.error('No se pudo crear el ingrediente', errorMessage(e));
    }
  };

  const suggestedCount = items.filter((i) => i.suggested).length;
  const acceptAll = () => onItemsChange(items.map((i) => (i.suggested ? { ...i, suggested: false } : i)));

  const rowProps = (item: RecipeItem, index: number): RowProps => ({
    item,
    index,
    count: items.length,
    info: info(item),
    dish,
    cost,
    business,
    products,
    elaborations,
    dishPriceLabel,
    setItem: (patch) => setItem(item.id, patch),
    onPick: (opt) => pick(item, opt),
    onCreate: (name) => create(item, name),
    onRemove: () => remove(item.id),
    onMove: (delta) => onItemsChange(moveItem(items, item.id, delta)),
    onEnter: () => addAfter(item.id),
    nameRef: (el) => {
      if (el) nameRefs.current.set(item.id, el);
      else nameRefs.current.delete(item.id);
    },
  });

  if (!items.length) {
    return (
      <EmptyState
        icon={<Wand2 className="size-7" />}
        title="Este escandallo aún no tiene ingredientes"
        description="Deja que te propongamos la receta (gratis, con nuestra base de recetas de hostelería) o añade los ingredientes tú mismo."
        action={
          <>
            {onPropose && (
              <Button icon={<Sparkles className="size-4" />} onClick={onPropose}>
                Proponer ingredientes
              </Button>
            )}
            <Button variant="outline" icon={<Plus className="size-4" />} onClick={() => addAfter()}>
              Añadir ingrediente
            </Button>
          </>
        }
      />
    );
  }

  const weighableGross = cost.grossKgPerPortion * portions;
  const weighableServed = cost.servedKgPerPortion * portions;

  return (
    <div className="space-y-3">
      {suggestedCount > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-ai/30 bg-ai-soft p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5 text-sm text-ink-2">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-ai" />
            <div>
              <span className="font-semibold text-ink">
                {suggestedCount} {suggestedCount === 1 ? 'línea propuesta' : 'líneas propuestas'}
              </span>{' '}
              (borde violeta): comprueba gramajes y el ingrediente de tus facturas vinculado, y acéptalas.
            </div>
          </div>
          <Button size="sm" variant="ai" icon={<CheckCheck className="size-4" />} onClick={acceptAll} className="self-start sm:self-auto">
            Aceptar todas
          </Button>
        </div>
      )}

      {wide ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
          <table className="tabular w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2 text-[11px] font-bold uppercase tracking-wide text-muted">
                <HeadCell className="pl-4 text-left">Ingrediente</HeadCell>
                <HeadCell className="w-[172px] text-left">Cantidad</HeadCell>
                <HeadCell className="w-[112px] text-left">
                  <span className="inline-flex items-center gap-1">
                    Peso <BasisHelp />
                  </span>
                </HeadCell>
                <HeadCell className="w-[68px] text-left" title="Merma de limpieza / despiece (%)">
                  Limpieza
                </HeadCell>
                <HeadCell className="w-[68px] text-left" title="Merma de cocción (%)">
                  Cocción
                </HeadCell>
                <HeadCell className="w-[92px] text-right">Bruto → plato</HeadCell>
                <HeadCell className="w-[100px] text-right">Precio</HeadCell>
                <HeadCell className="w-[112px] text-right">Coste</HeadCell>
                <HeadCell className="w-[96px] pr-3">
                  <span className="sr-only">Acciones</span>
                </HeadCell>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <DesktopRow key={item.id} {...rowProps(item, i)} />
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-2 text-sm">
                <td className="py-3 pl-4 pr-2" colSpan={2}>
                  <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => addAfter()}>
                    Añadir ingrediente
                  </Button>
                  <span className="ml-3 hidden text-xs text-muted 2xl:inline">
                    Consejo: pulsa <kbd className="rounded border border-line-strong px-1 font-mono text-[10px]">Intro</kbd> en la cantidad para añadir otra línea
                  </span>
                </td>
                <td colSpan={3} className="px-2 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted">
                  Total receta{portions > 1 ? ` · ${portions} raciones` : ''}
                </td>
                <td className="px-2 py-3 text-right">
                  <div className="font-semibold text-ink">{fmtKg(weighableGross)}</div>
                  <div className="text-xs text-muted">{fmtKg(weighableServed)} al plato</div>
                </td>
                <td />
                <td className="px-2 py-3 text-right">
                  <div className="font-display text-base font-extrabold text-ink">{fmtEur(cost.totalCost)}</div>
                  {portions > 1 && <div className="text-xs text-muted">{fmtEur(cost.costPerPortion)} / ración</div>}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((item, i) => (
              <MobileRow key={item.id} {...rowProps(item, i)} />
            ))}
          </div>
          <Button variant="outline" block icon={<Plus className="size-4" />} onClick={() => addAfter()}>
            Añadir ingrediente
          </Button>
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-sm sm:grid-cols-4">
            <FooterStat label="Bruto total" value={fmtKg(weighableGross)} />
            <FooterStat label="Al plato" value={fmtKg(weighableServed)} />
            <FooterStat label="Coste receta" value={fmtEur(cost.totalCost)} strong />
            <FooterStat label="Coste / ración" value={fmtEur(cost.costPerPortion)} strong />
          </div>
        </div>
      )}
    </div>
  );
}

function HeadCell({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  return (
    <th title={title} className={clsx('whitespace-nowrap border-b border-line px-2 py-2.5 font-bold', className)}>
      {children}
    </th>
  );
}

function FooterStat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={clsx('tabular mt-0.5 text-ink', strong ? 'font-display text-lg font-extrabold' : 'font-semibold')}>{value}</div>
    </div>
  );
}

/** Ayuda sobre la base de peso de la cantidad. */
function BasisHelp() {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} type="button" aria-label="¿Qué peso indico?" onClick={() => setOpen((o) => !o)} className="rounded text-muted hover:text-ink">
        <Info className="size-3.5" />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} minWidth={300} className="p-3 normal-case tracking-normal">
        <div className="mb-2 text-sm font-bold text-ink">¿Sobre qué peso indicas la cantidad?</div>
        <ul className="space-y-2 text-xs font-normal text-ink-2">
          {BASES.map((b) => (
            <li key={b}>
              <span className="font-semibold text-ink">{BASIS_LABELS[b].label}:</span> {BASIS_LABELS[b].hint}.
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs font-normal text-muted">Calculamos el resto con las mermas: lo que compras (bruto), lo que queda limpio (neto) y lo que llega al plato.</p>
      </Popover>
    </>
  );
}

interface RowProps {
  item: RecipeItem;
  index: number;
  count: number;
  info: LineInfo;
  dish: Dish;
  cost: DishCost;
  business: BusinessSettings;
  products: Product[];
  elaborations: Dish[];
  dishPriceLabel: (d: Dish) => ReactNode;
  setItem: (patch: Partial<RecipeItem>) => void;
  onPick: (opt: IngredientOption) => void;
  onCreate: (name: string) => Promise<void>;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onEnter: () => void;
  nameRef: (el: HTMLInputElement | null) => void;
}

function Picker(p: RowProps) {
  return (
    <IngredientPicker
      value={p.item.name}
      onChangeText={(name) => p.setItem({ name })}
      products={p.products}
      elaborations={p.elaborations}
      excludeDishId={p.dish.id}
      onPick={p.onPick}
      onCreate={p.onCreate}
      dishPriceLabel={p.dishPriceLabel}
      inputRef={p.nameRef}
      invalid={!p.item.ref && !!p.item.name}
      ariaLabel={`Ingrediente ${p.index + 1}`}
    />
  );
}

/** Chip con el ingrediente vinculado (o aviso si falta). */
function LinkChip({ item, info, setItem }: Pick<RowProps, 'item' | 'info' | 'setItem'>) {
  const { product, sub } = info;
  if (!item.ref) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
        <AlertTriangle className="size-3.5" /> Sin vincular: elige un ingrediente de la lista
      </span>
    );
  }
  const unsure = item.suggested && item.matchScore != null && item.matchScore < AUTO_LINK_THRESHOLD;
  const name = product?.name ?? sub?.name ?? 'Ingrediente eliminado';
  const to = product ? `/ingredientes/${product.id}` : sub ? `/platos/${sub.id}` : undefined;
  return (
    <span className="inline-flex max-w-full items-center gap-1 text-xs text-muted">
      <span aria-hidden>{sub ? '🍲' : product ? CATEGORY_LABELS[product.category]?.emoji : '❓'}</span>
      {to ? (
        <Link to={to} className="truncate font-medium text-ink-2 underline-offset-2 hover:text-brand-600 hover:underline">
          {name}
        </Link>
      ) : (
        <span className="truncate font-medium text-bad">{name}</span>
      )}
      {sub && <span className="rounded-full bg-info-soft px-1.5 text-[10px] font-bold text-info">elab.</span>}
      {unsure && <span className="shrink-0 rounded-full bg-warn-soft px-1.5 text-[10px] font-bold text-warn">¿es este?</span>}
      <button
        type="button"
        onClick={() => setItem({ ref: undefined, matchScore: undefined })}
        className="ml-0.5 shrink-0 rounded p-0.5 text-muted hover:bg-surface-2 hover:text-bad"
        aria-label="Desvincular ingrediente"
        title="Desvincular"
      >
        <Link2Off className="size-3" />
      </button>
    </span>
  );
}

/** Celda de merma (%): vacía = hereda la de la prueba de rendimiento o la del producto. */
function WasteInput({
  value,
  applied,
  onValue,
  source,
  testId,
  label,
  compact,
}: {
  value: number | undefined;
  applied: number | undefined;
  onValue: (v: number | undefined) => void;
  source?: ItemCost['wasteSource'] | 'cocción';
  testId?: ID;
  label: string;
  compact?: boolean;
}) {
  const overridden = value != null;
  return (
    <div className="min-w-0">
      <NumberInput
        value={value}
        onValue={(v) => onValue(v == null ? undefined : Math.min(95, Math.max(0, v)))}
        decimals={1}
        placeholder={applied != null ? fmtNum(applied, 1) : '0'}
        aria-label={label}
        className={compact ? '[&_input]:pr-8 [&_input]:text-right' : 'w-full px-2! text-right'}
        suffix={compact ? '%' : undefined}
      />
      <div className="mt-1 flex h-4 items-center gap-1 text-[10px] font-semibold">
        {overridden ? (
          <button type="button" onClick={() => onValue(undefined)} className="inline-flex items-center gap-0.5 rounded text-muted hover:text-ink" title="Volver al valor del ingrediente">
            <RotateCcw className="size-2.5" /> manual
          </button>
        ) : source === 'prueba' && testId ? (
          <Link to={`/mermas/${testId}`} className="rounded bg-ok-soft px-1 text-ok hover:underline" title="Merma real de tu prueba de rendimiento">
            prueba
          </Link>
        ) : source === 'producto' ? (
          <span className="rounded bg-surface-2 px-1 text-muted" title="Merma por defecto del ingrediente">
            producto
          </span>
        ) : null}
      </div>
    </div>
  );
}

function QtyControls({ item, setItem, onEnter, index }: Pick<RowProps, 'item' | 'setItem' | 'onEnter' | 'index'>) {
  return (
    <div className="flex items-start gap-1">
      <NumberInput
        value={item.quantity > 0 ? item.quantity : undefined}
        onValue={(v) => setItem({ quantity: v != null && v > 0 ? v : 0 })}
        decimals={3}
        min={0}
        placeholder="0"
        aria-label={`Cantidad del ingrediente ${index + 1}`}
        className="w-[76px] px-2! text-right font-semibold"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          }
        }}
      />
      <Select
        value={item.unit}
        onChange={(e) => setItem({ unit: e.target.value as QtyUnit })}
        aria-label={`Unidad del ingrediente ${index + 1}`}
        className="w-[84px] px-2!"
      >
        {QTY_UNITS.map((u) => (
          <option key={u} value={u}>
            {UNIT_LABELS[u]}
          </option>
        ))}
      </Select>
    </div>
  );
}

function BasisSelect({ item, setItem, index }: Pick<RowProps, 'item' | 'setItem' | 'index'>) {
  return (
    <Select
      value={item.basis}
      onChange={(e) => setItem({ basis: e.target.value as QtyBasis })}
      title={BASIS_LABELS[item.basis].hint}
      aria-label={`Peso del ingrediente ${index + 1}`}
      className="w-full px-2!"
    >
      {BASES.map((b) => (
        <option key={b} value={b} title={BASIS_LABELS[b].hint}>
          {BASIS_LABELS[b].label}
        </option>
      ))}
    </Select>
  );
}

function PriceCell({ info }: { info: LineInfo }) {
  const { ic, product, sub } = info;
  if (ic?.pricePerBase && ic.pricePerBase > 0) {
    return (
      <span className="whitespace-nowrap">
        <span className="font-medium text-ink-2">{fmtPrice(ic.pricePerBase)}</span>
        <span className="text-xs text-muted"> /{ic.baseUnit}</span>
      </span>
    );
  }
  if (product) {
    return (
      <Link to={`/ingredientes/${product.id}`} className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn hover:underline">
        Sin precio
      </Link>
    );
  }
  if (sub) return <span className="text-xs font-semibold text-warn">Sin coste</span>;
  return <span className="text-muted">—</span>;
}

function CostCell({ ic, align = 'right' }: { ic?: ItemCost; align?: 'right' | 'left' }) {
  const share = ic?.costSharePct ?? 0;
  return (
    <div className={clsx('min-w-0', align === 'right' ? 'text-right' : 'text-left')}>
      <div className="font-semibold text-ink">{ic && ic.cost > 0 ? fmtEur(ic.cost) : '—'}</div>
      <div className={clsx('mt-1 flex items-center gap-1.5', align === 'right' && 'justify-end')}>
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-line" aria-hidden>
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, share)}%` }} />
        </div>
        <span className="w-9 text-right text-[10px] font-semibold text-muted">{share > 0 ? fmtPctNb(share, share < 10 ? 1 : 0) : ''}</span>
      </div>
    </div>
  );
}

function WarningsButton({ warnings }: { warnings: string[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  if (!warnings.length) return <span className="inline-block size-9" aria-hidden />;
  return (
    <>
      <IconButton label={`Avisos: ${warnings.join('. ')}`} onClick={() => setOpen((o) => !o)} className="text-warn hover:text-warn">
        <span ref={ref} className="inline-flex">
          <AlertTriangle className="size-4" />
        </span>
      </IconButton>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" minWidth={260} className="p-3">
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-warn">Revisa esta línea</div>
        <ul className="space-y-1.5 text-sm text-ink-2">
          {warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
              {w}
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}

function RowMenu(p: RowProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const { item, info, dish, cost, business } = p;
  const max = maxAffordablePrice(cost, item.id, dish, business);
  const current = info.ic?.pricePerBase;
  const unit = info.ic?.baseUnit;
  const target = targetOf(dish, business);
  const link = info.product ? `/ingredientes/${info.product.id}` : info.sub ? `/platos/${info.sub.id}` : undefined;
  return (
    <>
      <IconButton label="Más opciones de la línea" onClick={() => setOpen((o) => !o)}>
        <span ref={ref} className="inline-flex">
          <MoreHorizontal className="size-4" />
        </span>
      </IconButton>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" minWidth={280} role="menu">
        <div className="m-1 mb-1.5 rounded-xl bg-surface-2 p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-ink">
            <Target className="size-3.5 text-brand-500" /> Precio máximo para cumplir objetivo
          </div>
          {max == null ? (
            <p className="mt-1 text-xs text-muted">
              {cost.netPrice ? 'Indica cantidad y vincula el ingrediente para calcularlo.' : 'Indica el PVP de carta del plato para calcularlo.'}
            </p>
          ) : max <= 0 ? (
            <p className="mt-1 text-xs text-bad">Aunque fuera gratis, el resto de ingredientes ya supera el {fmtPctNb(target, 0)} de food cost.</p>
          ) : (
            <>
              <div className="tabular mt-1 font-display text-xl font-extrabold text-ink">
                {fmtPrice(max)} <span className="text-sm font-semibold text-muted">{perUnitLabel(unit)}</span>
              </div>
              <p className="text-xs text-muted">
                Para un food cost del {fmtPctNb(target, 0)}
                {current ? (
                  <>
                    {' '}
                    · ahora pagas{' '}
                    <span className={clsx('font-semibold', current > max ? 'text-bad' : 'text-ok')}>
                      {fmtPrice(current)} {perUnitLabel(unit)}
                    </span>
                  </>
                ) : null}
                . Úsalo para negociar con tu proveedor.
              </p>
            </>
          )}
        </div>
        {link && (
          <Link to={link} role="menuitem" className="flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
            <ExternalLink className="size-4" /> {info.sub ? 'Abrir la elaboración' : 'Ver ficha del ingrediente'}
          </Link>
        )}
        <MenuItem icon={<ArrowUp />} disabled={p.index === 0} onClick={() => p.onMove(-1)}>
          Subir
        </MenuItem>
        <MenuItem icon={<ArrowDown />} disabled={p.index === p.count - 1} onClick={() => p.onMove(1)}>
          Bajar
        </MenuItem>
        <MenuItem
          icon={<Trash2 />}
          danger
          onClick={() => {
            setOpen(false);
            p.onRemove();
          }}
        >
          Eliminar línea
        </MenuItem>
      </Popover>
    </>
  );
}

function AcceptButton({ item, setItem }: Pick<RowProps, 'item' | 'setItem'>) {
  if (!item.suggested) return null;
  return (
    <IconButton label="Aceptar la propuesta" onClick={() => setItem({ suggested: false })} className="bg-ai-soft text-ai hover:bg-ai hover:text-white">
      <Check className="size-4" />
    </IconButton>
  );
}

function wasteSourceFor(info: LineInfo): ItemCost['wasteSource'] | undefined {
  return info.ic?.wasteSource;
}

function DesktopRow(p: RowProps) {
  const { item, info } = p;
  const ic = info.ic;
  const isSub = item.ref?.type === 'dish';
  return (
    <tr className={clsx('group align-top transition-colors hover:bg-surface-2/60', item.suggested && 'bg-ai-soft/40')}>
      <td className={clsx('border-b border-line py-2.5 pl-3 pr-2', item.suggested ? 'border-l-4 border-l-ai' : 'border-l-4 border-l-transparent')}>
        <Picker {...p} />
        <div className="mt-1 min-h-4 pl-1">
          <LinkChip item={item} info={info} setItem={p.setItem} />
        </div>
      </td>
      <td className="border-b border-line px-2 py-2.5">
        <QtyControls item={item} setItem={p.setItem} onEnter={p.onEnter} index={p.index} />
      </td>
      <td className="border-b border-line px-2 py-2.5">
        <BasisSelect item={item} setItem={p.setItem} index={p.index} />
      </td>
      <td className="border-b border-line px-2 py-2.5">
        <WasteInput
          value={item.wastePct}
          applied={ic?.appliedWastePct}
          onValue={(v) => p.setItem({ wastePct: v })}
          source={isSub ? undefined : wasteSourceFor(info)}
          testId={info.testId}
          label={`Merma de limpieza del ingrediente ${p.index + 1} (%)`}
        />
      </td>
      <td className="border-b border-line px-2 py-2.5">
        <WasteInput
          value={item.cookingLossPct}
          applied={ic?.appliedCookingLossPct}
          onValue={(v) => p.setItem({ cookingLossPct: v })}
          label={`Merma de cocción del ingrediente ${p.index + 1} (%)`}
        />
      </td>
      <td className="border-b border-line px-2 py-3 text-right">
        <div className="font-medium text-ink-2">{ic && ic.grossQty > 0 ? fmtBaseQty(ic.grossQty, ic.baseUnit) : '—'}</div>
        <div className="text-xs text-muted">{ic && ic.servedQty > 0 ? fmtBaseQty(ic.servedQty, ic.baseUnit) : ''}</div>
      </td>
      <td className="border-b border-line px-2 py-3 text-right">
        <PriceCell info={info} />
      </td>
      <td className="border-b border-line px-2 py-3">
        <CostCell ic={ic} />
      </td>
      <td className="border-b border-line py-2 pl-1 pr-3">
        <div className="flex items-center justify-end gap-0.5">
          <AcceptButton item={item} setItem={p.setItem} />
          <WarningsButton warnings={ic?.warnings ?? []} />
          <RowMenu {...p} />
        </div>
      </td>
    </tr>
  );
}

function MobileRow(p: RowProps) {
  const { item, info } = p;
  const ic = info.ic;
  const isSub = item.ref?.type === 'dish';
  return (
    <div className={clsx('rounded-2xl border bg-surface p-3.5 shadow-card', item.suggested ? 'border-ai/40 border-l-4 border-l-ai bg-ai-soft/30' : 'border-line')}>
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <Picker {...p} />
          <div className="mt-1 min-h-4 pl-1">
            <LinkChip item={item} info={info} setItem={p.setItem} />
          </div>
        </div>
        <AcceptButton item={item} setItem={p.setItem} />
        <WarningsButton warnings={ic?.warnings ?? []} />
        <RowMenu {...p} />
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] gap-2">
        <MiniLabel label="Cantidad">
          <QtyControls item={item} setItem={p.setItem} onEnter={p.onEnter} index={p.index} />
        </MiniLabel>
        <MiniLabel label="Peso">
          <BasisSelect item={item} setItem={p.setItem} index={p.index} />
        </MiniLabel>
        <MiniLabel label="Merma limpieza">
          <WasteInput
            value={item.wastePct}
            applied={ic?.appliedWastePct}
            onValue={(v) => p.setItem({ wastePct: v })}
            source={isSub ? undefined : wasteSourceFor(info)}
            testId={info.testId}
            label={`Merma de limpieza del ingrediente ${p.index + 1} (%)`}
            compact
          />
        </MiniLabel>
        <MiniLabel label="Merma cocción">
          <WasteInput
            value={item.cookingLossPct}
            applied={ic?.appliedCookingLossPct}
            onValue={(v) => p.setItem({ cookingLossPct: v })}
            label={`Merma de cocción del ingrediente ${p.index + 1} (%)`}
            compact
          />
        </MiniLabel>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3 border-t border-line pt-2.5 text-sm">
        <div className="tabular min-w-0 text-xs text-muted">
          <div>
            <span className="font-semibold text-ink-2">{ic && ic.grossQty > 0 ? fmtBaseQty(ic.grossQty, ic.baseUnit) : '—'}</span> bruto →{' '}
            <span className="font-semibold text-ink-2">{ic && ic.servedQty > 0 ? fmtBaseQty(ic.servedQty, ic.baseUnit) : '—'}</span> al plato
          </div>
          <div className="mt-0.5">
            <PriceCell info={info} />
          </div>
        </div>
        <CostCell ic={ic} />
      </div>
    </div>
  );
}

function MiniLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-semibold text-muted">{label}</div>
      {children}
    </div>
  );
}

