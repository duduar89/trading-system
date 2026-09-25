import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Merge } from 'lucide-react';
import type { ID, Product } from '../../types';
import { Button, Modal } from '../ui';
import { fmtDate, fmtEurPrecise } from '../../lib/format';
import { mergeProducts } from '../../services/products';
import { errorMessage, toast } from '../../state/store';
import { CategoryBadge } from './CategoryBadge';

/** Fusionar dos ingredientes duplicados eligiendo cuál se conserva. */
export function MergeProductsModal({
  pair,
  defaultKeepId,
  onClose,
  onMerged,
}: {
  pair: [Product, Product] | null;
  defaultKeepId?: ID;
  onClose: () => void;
  onMerged?: (keepId: ID, removedId: ID) => void;
}) {
  const [keepId, setKeepId] = useState<ID | undefined>(defaultKeepId);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pair) return;
    // Por defecto, el que tiene más historia (última compra más reciente y más alias).
    const [a, b] = pair;
    const score = (p: Product) => (p.lastPurchaseDate ? 2 : 0) + (p.pricePerBase > 0 ? 1 : 0) + p.aliases.length * 0.1;
    setKeepId(defaultKeepId ?? (score(b) > score(a) ? b.id : a.id));
  }, [pair, defaultKeepId]);

  if (!pair) return null;
  const keep = pair.find((p) => p.id === keepId) ?? pair[0];
  const remove = pair.find((p) => p.id !== keep.id) ?? pair[1];

  const submit = async () => {
    setSaving(true);
    try {
      await mergeProducts(keep.id, remove.id);
      toast.success('Ingredientes fusionados', `«${remove.name}» ahora es «${keep.name}»`);
      onMerged?.(keep.id, remove.id);
      onClose();
    } catch (e) {
      toast.error('No se pudieron fusionar', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Fusionar ingredientes duplicados"
      subtitle="Elige cuál se queda. Del otro pasamos su histórico de precios, sus nombres alternativos y los escandallos que lo usan."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon={<Merge className="size-4" />} loading={saving} onClick={() => void submit()}>
            Fusionar en «{keep.name}»
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Ingrediente que se conserva">
        {pair.map((p) => {
          const on = p.id === keep.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setKeepId(p.id)}
              className={clsx(
                'rounded-2xl border-2 p-4 text-left transition',
                on ? 'border-brand-500 bg-brand-500/6 shadow-glow' : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <CategoryBadge category={p.category} />
                <span className={clsx('text-[11px] font-bold uppercase tracking-wide', on ? 'text-brand-600 dark:text-brand-400' : 'text-muted')}>
                  {on ? 'Se conserva' : 'Se fusiona'}
                </span>
              </div>
              <div className="mt-2 font-display text-lg font-bold text-ink">{p.name}</div>
              <dl className="mt-2 space-y-1 text-xs text-muted">
                <div className="flex justify-between gap-2">
                  <dt>Precio</dt>
                  <dd className="tabular font-semibold text-ink-2">{p.pricePerBase > 0 ? `${fmtEurPrecise(p.pricePerBase)}/${p.baseUnit}` : 'sin precio'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Última compra</dt>
                  <dd className="text-ink-2">{fmtDate(p.lastPurchaseDate)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Nombres alternativos</dt>
                  <dd className="text-ink-2">{p.aliases.length}</dd>
                </div>
              </dl>
            </button>
          );
        })}
      </div>
      {keep.baseUnit !== remove.baseUnit && (
        <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm text-ink-2">
          Ojo: «{keep.name}» se compra por {keep.baseUnit} y «{remove.name}» por {remove.baseUnit}. Revisa las recetas afectadas después de fusionar.
        </p>
      )}
    </Modal>
  );
}
