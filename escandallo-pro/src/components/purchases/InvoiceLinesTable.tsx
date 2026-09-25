import { memo, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Ban, Check, ChevronDown, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import type { ID, IngredientCategory, InvoiceLine, PackSize, Product } from '../../types';
import { Badge, Button, Input } from '../ui';
import { CATEGORY_LABELS } from '../../lib/labels';
import { fmtBaseQty, fmtEurPrecise, perUnitLabel } from '../../lib/format';
import { parsePackSize } from '../../core/pack';
import { ChangePct, ConfidenceDot, Hint } from './badges';
import { ProductPicker } from './ProductPicker';
import { formatPack, pctChange } from './logic';
import { AmountInput } from './AmountInput';

export interface LinePatchMeta {
  /** El usuario ha fijado el formato a mano (no volver a detectarlo al cambiar la descripción). */
  packManual?: boolean;
}

export interface InvoiceLinesTableProps {
  lines: InvoiceLine[];
  products: Product[];
  productsById: Map<ID, Product>;
  onPatch: (lineId: ID, patch: Partial<InvoiceLine>, meta?: LinePatchMeta) => void;
  onRemove: (lineId: ID) => void;
  onAdd?: () => void;
  /** Línea recién añadida: recibe el foco. */
  focusLineId?: ID;
  readOnly?: boolean;
}

const UNIT_SUGGESTIONS = ['kg', 'g', 'l', 'ml', 'ud', 'caja', 'bot', 'paq', 'bandeja', 'docena', 'lata', 'saco', 'garrafa', 'bolsa', 'manojo', 'pieza'];

/**
 * Editor de líneas de factura: una tarjeta por línea (se adapta de móvil a escritorio), cálculo en vivo del
 * precio real por kg / l / ud, avisos de validación, confianza de lectura y vínculo con la base de precios.
 * Teclado: Enter baja a la misma casilla de la línea siguiente.
 */
export function InvoiceLinesTable({ lines, products, productsById, onPatch, onRemove, onAdd, focusLineId, readOnly }: InvoiceLinesTableProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focusLineId) return;
    const el = rootRef.current?.querySelector<HTMLInputElement>(`[data-line-id="${focusLineId}"] [data-field="description"]`);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusLineId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
    const t = e.target as HTMLElement;
    if (t.tagName !== 'INPUT' || !t.dataset.field || t.dataset.line == null) return;
    e.preventDefault();
    const next = rootRef.current?.querySelector<HTMLInputElement>(`[data-line="${Number(t.dataset.line) + 1}"][data-field="${t.dataset.field}"]`);
    if (next) {
      next.focus();
      next.select();
    } else {
      (t as HTMLInputElement).blur();
      addRef.current?.focus();
    }
  };

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className="space-y-3">
      <datalist id="invoice-unit-suggestions">
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      {lines.map((l, i) => (
        <LineCard
          key={l.id}
          index={i}
          line={l}
          product={l.productId ? productsById.get(l.productId) : undefined}
          products={products}
          onPatch={onPatch}
          onRemove={onRemove}
          readOnly={readOnly}
        />
      ))}
      {onAdd && !readOnly && (
        <button
          ref={addRef}
          type="button"
          onClick={onAdd}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong text-sm font-semibold text-muted transition hover:border-brand-400 hover:bg-brand-500/5 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-500 dark:hover:text-brand-400"
        >
          <Plus className="size-4" /> Añadir línea
        </button>
      )}
    </div>
  );
}

const accent: Record<InvoiceLine['matchStatus'], string> = {
  nuevo: 'before:bg-brand-500',
  sugerido: 'before:bg-warn',
  vinculado: 'before:bg-ok',
  ignorado: 'before:bg-line-strong',
};

const LineCard = memo(function LineCard({
  index,
  line,
  product,
  products,
  onPatch,
  onRemove,
  readOnly,
}: {
  index: number;
  line: InvoiceLine;
  product?: Product;
  products: Product[];
  onPatch: InvoiceLinesTableProps['onPatch'];
  onRemove: InvoiceLinesTableProps['onRemove'];
  readOnly?: boolean;
}) {
  const ignored = line.matchStatus === 'ignorado';
  const patch = (p: Partial<InvoiceLine>, meta?: LinePatchMeta) => onPatch(line.id, p, meta);
  const warnings = line.warnings ?? [];
  const unitMismatch = !ignored && product && line.baseUnit && product.baseUnit !== line.baseUnit;

  return (
    <div
      data-line-id={line.id}
      className={clsx(
        'relative overflow-hidden rounded-2xl border border-line bg-surface p-3 pl-4 shadow-card transition before:absolute before:inset-y-0 before:left-0 before:w-1 sm:p-4 sm:pl-5',
        accent[line.matchStatus],
      )}
    >
      <div className="flex items-start gap-2">
        <ConfidenceDot value={line.confidence} className="mt-[15px]" />
        <div className="min-w-0 flex-1">
          <Input
            value={line.description}
            onChange={(e) => patch({ description: e.target.value })}
            data-line={index}
            data-field="description"
            aria-label={`Descripción de la línea ${index + 1}`}
            placeholder="Descripción tal y como aparece en la factura"
            disabled={readOnly}
            className={clsx('font-semibold', ignored && 'text-muted line-through decoration-line-strong')}
          />
          {line.code && <div className="mt-1 pl-1 text-[11px] text-muted">Código {line.code}</div>}
        </div>
        <div className="flex shrink-0 items-center pt-1.5">
          {(warnings.length > 0 || unitMismatch) && (
            <Hint label={`Avisos de la línea ${index + 1}`} tone={unitMismatch ? 'bad' : 'warn'}>
              <ul className="list-disc space-y-1 pl-4">
                {unitMismatch && product && (
                  <li>
                    «{product.name}» tiene el precio en {perUnitLabel(product.baseUnit)} y esta línea sale en {perUnitLabel(line.baseUnit)}. Revisa la unidad o el
                    formato antes de confirmar.
                  </li>
                )}
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Hint>
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={() => onRemove(line.id)}
              className="inline-flex size-9 items-center justify-center rounded-xl text-muted transition hover:bg-bad-soft hover:text-bad"
              aria-label={`Eliminar la línea ${index + 1}`}
              title="Eliminar línea"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className={clsx('mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-6', ignored && 'opacity-60')}>
        <MiniField label="Cantidad">
          <AmountInput
            value={line.quantity}
            onValue={(v) => patch({ quantity: v ?? 0 })}
            decimals={3}
            data-line={index}
            data-field="quantity"
            aria-label={`Cantidad de la línea ${index + 1}`}
            disabled={readOnly}
          />
        </MiniField>
        <MiniField label="Unidad">
          <Input
            value={line.unit}
            onChange={(e) => patch({ unit: e.target.value })}
            list="invoice-unit-suggestions"
            data-line={index}
            data-field="unit"
            aria-label={`Unidad de la línea ${index + 1}`}
            disabled={readOnly}
          />
        </MiniField>
        <MiniField label="Formato">
          <PackInput pack={line.packSize} index={index} disabled={readOnly} onPack={(p) => patch({ packSize: p }, { packManual: true })} />
        </MiniField>
        <MiniField label="Precio ud. €">
          <AmountInput
            value={line.unitPrice}
            onValue={(v) => patch({ unitPrice: v ?? 0 })}
            decimals={4}
            minDecimals={2}
            data-line={index}
            data-field="unitPrice"
            aria-label={`Precio unitario de la línea ${index + 1}`}
            disabled={readOnly}
          />
        </MiniField>
        <MiniField label="Dto. %">
          <AmountInput
            value={line.discountPct}
            onValue={(v) => patch({ discountPct: v != null && v > 0 ? Math.min(v, 100) : undefined })}
            decimals={2}
            placeholder="0"
            data-line={index}
            data-field="discountPct"
            aria-label={`Descuento de la línea ${index + 1}`}
            disabled={readOnly}
          />
        </MiniField>
        <MiniField label="Importe €">
          <AmountInput
            value={line.total}
            onValue={(v) => patch({ total: v ?? 0 })}
            decimals={2}
            minDecimals={2}
            data-line={index}
            data-field="total"
            aria-label={`Importe de la línea ${index + 1}`}
            disabled={readOnly}
            className="font-semibold"
          />
        </MiniField>
      </div>

      <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-center">
        <RealPrice line={line} product={product} />
        <div className="min-w-0 flex-1">
          <MatchCell line={line} product={product} products={products} onPatch={patch} disabled={readOnly} />
        </div>
      </div>
    </div>
  );
});

function MiniField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block truncate text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Formato de envase editable como texto libre ("6x1 l", "caja 5 kg"), interpretado con core/pack. */
function PackInput({ pack, index, disabled, onPack }: { pack?: PackSize; index: number; disabled?: boolean; onPack: (p: PackSize | undefined) => void }) {
  const [text, setText] = useState(formatPack(pack));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setText(formatPack(pack));
      setInvalid(false);
    }
  }, [pack]);

  const commit = () => {
    const t = text.trim();
    if (t === formatPack(pack)) return;
    if (!t) {
      setInvalid(false);
      onPack(undefined);
      return;
    }
    let parsed: PackSize | undefined;
    try {
      parsed = parsePackSize(t);
    } catch {
      parsed = undefined;
    }
    if (parsed) {
      setInvalid(false);
      onPack(parsed);
      setText(formatPack(parsed));
    } else setInvalid(true);
  };

  return (
    <Input
      value={text}
      placeholder="—"
      disabled={disabled}
      data-line={index}
      data-field="pack"
      aria-label={`Formato de envase de la línea ${index + 1}`}
      aria-invalid={invalid}
      title={invalid ? 'No reconozco el formato. Prueba con "6x1 l", "5 kg" o "30 ud".' : 'Formato del envase, p. ej. 6x1 l, 5 kg, 30 ud'}
      className={clsx(invalid && 'border-bad focus:border-bad focus:ring-bad/15')}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

/** Precio real por unidad base (lo que de verdad cuesta 1 kg / 1 l / 1 ud) y comparación con el vigente. */
function RealPrice({ line, product }: { line: InvoiceLine; product?: Product }) {
  const ppb = line.pricePerBase;
  const comparable = product && product.pricePerBase > 0 && product.baseUnit === line.baseUnit && ppb != null && ppb > 0;
  const change = comparable ? pctChange(product.pricePerBase, ppb) : undefined;
  return (
    <div className="shrink-0 sm:w-56">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Precio real</div>
      {ppb != null && ppb > 0 ? (
        <>
          <div className="tabular font-display text-lg font-extrabold leading-tight text-ink">
            {fmtEurPrecise(ppb)}
            <span className="ml-0.5 font-sans text-xs font-semibold text-muted">/{line.baseUnit ?? 'ud'}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
            {line.baseQuantity != null && line.baseQuantity > 0 && <span className="tabular">{fmtBaseQty(line.baseQuantity, line.baseUnit)} comprados</span>}
            {comparable && (
              <span className="inline-flex items-center gap-1">
                · antes <span className="tabular">{fmtEurPrecise(product.pricePerBase)}</span> <ChangePct pct={change} />
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-1.5 text-sm font-semibold text-warn">
          <AlertTriangle className="size-4" /> Sin calcular
        </div>
      )}
    </div>
  );
}

function MatchCell({
  line,
  product,
  products,
  onPatch,
  disabled,
}: {
  line: InvoiceLine;
  product?: Product;
  products: Product[];
  onPatch: (p: Partial<InvoiceLine>) => void;
  disabled?: boolean;
}) {
  if (line.matchStatus === 'ignorado') {
    return (
      <div className="flex min-h-10 items-center justify-between gap-2 rounded-xl bg-surface-2 px-3">
        <span className="inline-flex items-center gap-2 text-sm text-muted">
          <Ban className="size-4" /> Línea ignorada: no actualiza precios
        </span>
        {!disabled && (
          <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => onPatch({ matchStatus: line.productId ? 'sugerido' : 'nuevo' })}>
            Recuperar
          </Button>
        )}
      </div>
    );
  }

  const createName = line.suggestedName || line.description;
  const picker = (children: ReactNode, className?: string) => (
    <ProductPicker
      products={products}
      seed={line.suggestedName || line.description}
      selectedId={line.productId}
      label="Elegir ingrediente para esta línea"
      disabled={disabled}
      triggerClassName={className}
      onSelect={(p) => onPatch({ productId: p.id, matchStatus: 'vinculado', matchScore: 1 })}
      create={{
        name: createName,
        category: line.suggestedCategory,
        onCreate: (name: string, category?: IngredientCategory) =>
          onPatch({ matchStatus: 'nuevo', productId: undefined, matchScore: undefined, suggestedName: name, suggestedCategory: category ?? line.suggestedCategory }),
      }}
      onIgnore={() => onPatch({ matchStatus: 'ignorado' })}
    >
      {children}
    </ProductPicker>
  );

  if (line.matchStatus === 'nuevo' || !product) {
    const cat = line.suggestedCategory ? CATEGORY_LABELS[line.suggestedCategory] : undefined;
    return picker(
      <>
        <Badge tone="brand" icon={<Plus className="size-3" />}>
          Nuevo producto
        </Badge>
        <span className="min-w-0 flex-1 truncate font-semibold">
          {cat && <span aria-hidden>{cat.emoji} </span>}
          {createName || 'Sin nombre'}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted" />
      </>,
    );
  }

  if (line.matchStatus === 'sugerido') {
    return (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {picker(
            <>
              <Badge tone="warn">¿Es…?</Badge>
              <span className="min-w-0 flex-1 truncate font-semibold">{product.name}</span>
              {line.matchScore != null && <span className="tabular hidden text-[11px] text-muted sm:inline">{Math.round(line.matchScore * 100)} %</span>}
              <ChevronDown className="size-4 shrink-0 text-muted" />
            </>,
            'border-warn/50',
          )}
        </div>
        {!disabled && (
          <Button size="md" variant="outline" className="shrink-0 px-3" icon={<Check className="size-4 text-ok" />} onClick={() => onPatch({ matchStatus: 'vinculado' })} aria-label={`Sí, es ${product.name}`}>
            Sí
          </Button>
        )}
      </div>
    );
  }

  return picker(
    <>
      <Badge tone="ok" icon={<Check className="size-3" />}>
        Vinculado
      </Badge>
      <span className="min-w-0 flex-1 truncate font-semibold">{product.name}</span>
      <RotateCcw className="size-3.5 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" aria-hidden />
      <ChevronDown className="size-4 shrink-0 text-muted" />
    </>,
  );
}
