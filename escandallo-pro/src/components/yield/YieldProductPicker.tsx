import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Check, Plus, Scale } from 'lucide-react';
import type { IngredientCategory, Product } from '../../types';
import { Badge, SearchInput, Spinner, cx } from '../ui';
import { CATEGORY_LABELS } from '../../lib/labels';
import { fmtEurPrecise } from '../../lib/format';
import { createProduct } from '../../services/products';
import { errorMessage, toast } from '../../state/store';
import { searchProducts, suggestProductsForHint } from './productSearch';

/**
 * Buscador de producto (ingrediente de compra) para una prueba de rendimiento.
 * Sin texto muestra sugerencias para la pista (p. ej. "salmón"); con texto combina coincidencia literal y difusa.
 */
export function YieldProductPicker({
  products,
  value,
  onChange,
  hint,
  newProductCategory,
  autoFocus,
}: {
  products: Product[] | undefined;
  value: string | undefined;
  onChange: (product: Product | undefined) => void;
  hint?: string;
  newProductCategory?: IngredientCategory;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useMemo(() => products ?? [], [products]);
  const rootRef = useRef<HTMLDivElement>(null);
  const loaded = !!products;

  useEffect(() => {
    // Sólo con ratón/trackpad: en móvil abrir el teclado de golpe tapa la lista.
    if (!autoFocus || !loaded || !window.matchMedia?.('(pointer: fine)').matches) return;
    rootRef.current?.querySelector('input')?.focus();
  }, [autoFocus, loaded]);

  const results = useMemo(() => {
    if (query.trim()) return searchProducts(query, list, 8);
    const suggested = hint ? suggestProductsForHint(hint, list, 5) : [];
    if (suggested.length) return suggested;
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  }, [query, list, hint]);

  const title = query.trim() ? 'Resultados' : hint && results.length && suggestProductsForHint(hint, list, 1).length ? `Sugeridos para «${hint}»` : 'Ingredientes recientes';
  const exact = query.trim() && list.some((p) => p.name.toLowerCase() === query.trim().toLowerCase());

  async function create() {
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    try {
      const p = await createProduct({ name, baseUnit: 'kg', category: newProductCategory });
      toast.success('Ingrediente creado', `«${p.name}» ya está en tu base de ingredientes. Su precio se actualizará con la próxima factura.`);
      onChange(p);
      setQuery('');
    } catch (e) {
      toast.error('No se ha podido crear el ingrediente', errorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  if (!products) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-2" ref={rootRef}>
      <SearchInput value={query} onChange={setQuery} placeholder="Busca el producto de tus facturas…" />
      {results.length > 0 && <div className="px-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-muted">{title}</div>}
      <ul className="max-h-64 space-y-1 overflow-y-auto pr-0.5" role="listbox" aria-label="Productos">
        {results.map((p) => {
          const selected = p.id === value;
          return (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onChange(selected ? undefined : p)}
                className={cx(
                  'flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition',
                  selected ? 'border-brand-500 bg-brand-500/8 ring-2 ring-brand-500/20' : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
                )}
              >
                <span className="text-lg" aria-hidden>
                  {CATEGORY_LABELS[p.category]?.emoji ?? '📦'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{p.name}</span>
                  <span className="tabular block text-xs text-muted">
                    {p.pricePerBase > 0 ? `${fmtEurPrecise(p.pricePerBase)} / ${p.baseUnit}` : 'Sin precio todavía'}
                  </span>
                </span>
                {p.yieldTestId && (
                  <Badge tone="ok" icon={<Scale className="size-3" />}>
                    Con prueba
                  </Badge>
                )}
                {selected && <Check className="size-4 shrink-0 text-brand-500" />}
              </button>
            </li>
          );
        })}
      </ul>
      {query.trim() && !exact && (
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2 text-left text-sm font-semibold text-ink-2 transition hover:border-brand-400 hover:text-ink disabled:opacity-60"
        >
          {creating ? <Spinner className="size-4" /> : <Plus className="size-4 text-brand-500" />}
          Crear ingrediente «{query.trim()}»
        </button>
      )}
      {list.length === 0 && !query.trim() && (
        <p className="rounded-xl bg-surface-2 px-3 py-3 text-xs text-muted">
          Aún no tienes ingredientes. <Link to="/facturas?nuevo=1" className="font-semibold text-brand-600 hover:underline dark:text-brand-400">Sube una factura</Link>{' '}
          (se leen gratis en tu dispositivo) o escribe el nombre para crearlo. También puedes hacer la prueba sin producto y vincularla después.
        </p>
      )}
    </div>
  );
}
