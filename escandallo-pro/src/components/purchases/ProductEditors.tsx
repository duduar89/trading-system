import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Product } from '../../types';
import { Button, Field, Input, Modal } from '../ui';
import { fmtEurPrecise, perUnitLabel } from '../../lib/format';
import { todayIso } from '../../lib/id';
import { addProductAlias, setProductPrice, updateProduct } from '../../services/products';
import { errorMessage, toast } from '../../state/store';
import { ChangePct } from './badges';
import { foldText, pctChange } from './logic';
import { AmountInput } from './AmountInput';

/** Nombres alternativos (cómo aparece el producto en facturas y recetas). Se aprenden solos al vincular. */
export function AliasEditor({ product }: { product: Product }) {
  const [text, setText] = useState('');
  const add = async () => {
    const alias = text.trim();
    if (!alias) return;
    if (foldText(alias) === foldText(product.name) || product.aliases.some((a) => foldText(a) === foldText(alias))) {
      setText('');
      return;
    }
    try {
      await addProductAlias(product.id, alias);
      setText('');
    } catch (e) {
      toast.error('No se pudo añadir el nombre', errorMessage(e));
    }
  };
  const remove = async (alias: string) => {
    try {
      await updateProduct(product.id, { aliases: product.aliases.filter((a) => a !== alias) });
    } catch (e) {
      toast.error('No se pudo quitar el nombre', errorMessage(e));
    }
  };
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-ink-2">Otros nombres (en facturas y recetas)</span>
      {product.aliases.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {product.aliases.map((a) => (
            <span
              key={a}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2.5 pr-1 text-xs font-medium text-ink-2"
            >
              <span className="truncate">{a}</span>
              <button
                type="button"
                onClick={() => void remove(a)}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-bad-soft hover:text-bad"
                aria-label={`Quitar «${a}»`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="Ej.: TOM. PERA CAT I"
          aria-label="Añadir otro nombre"
        />
        <Button
          variant="outline"
          icon={<Plus className="size-4" />}
          onClick={() => void add()}
          disabled={!text.trim()}
          aria-label="Añadir nombre"
        >
          <span className="hidden sm:inline">Añadir</span>
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">Nos ayudan a reconocerlo automáticamente en las próximas facturas.</p>
    </div>
  );
}

/** Cambio manual de precio (queda en el histórico con origen "manual"). */
export function ChangePriceModal({ product, open, onClose }: { product: Product; open: boolean; onClose: () => void }) {
  const [price, setPrice] = useState<number | undefined>(product.pricePerBase > 0 ? product.pricePerBase : undefined);
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const change = pctChange(product.pricePerBase, price);
  const olderThanLast = !!product.lastPurchaseDate && date < product.lastPurchaseDate;

  const submit = async () => {
    if (!price || !(price > 0)) return;
    setSaving(true);
    try {
      await setProductPrice(product.id, price, 'manual', { date });
      toast.success('Precio actualizado', `${product.name}: ${fmtEurPrecise(price)}/${product.baseUnit}`);
      onClose();
    } catch (e) {
      toast.error('No se pudo cambiar el precio', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Cambiar precio"
      subtitle={product.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={saving} disabled={!price || !(price > 0)} onClick={() => void submit()}>
            Guardar precio
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={`Nuevo precio sin IVA (${perUnitLabel(product.baseUnit)})`}>
          <AmountInput
            value={price}
            onValue={setPrice}
            decimals={4}
            minDecimals={2}
            suffix={perUnitLabel(product.baseUnit)}
            min={0}
            autoFocus
            className="text-lg"
          />
        </Field>
        {product.pricePerBase > 0 && price != null && price > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <span className="text-muted">
              Antes <span className="tabular font-semibold text-ink-2">{fmtEurPrecise(product.pricePerBase)}</span>
            </span>
            <ChangePct pct={change} />
          </div>
        )}
        <Field
          label="Fecha del precio"
          hint={olderThanLast ? 'Es anterior a la última compra: quedará en el histórico sin cambiar el precio vigente.' : undefined}
        >
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
