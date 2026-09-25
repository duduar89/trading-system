import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, FilePlus2, Lightbulb, X } from 'lucide-react';
import type { Product } from '../../types';
import { Button, Callout, Field, Input, Modal, NumberInput, cx } from '../ui';
import { useProducts } from '../../state/hooks';
import { errorMessage, toast } from '../../state/store';
import { computeYield } from '../../core/yield';
import {
  YIELD_TEMPLATES,
  createYieldTest,
  createYieldTestFromTemplate,
  outputsFromTemplate,
  productPricePerKg,
  type YieldTemplate,
} from '../../services/yieldTests';
import { fmtEur, fmtEurPrecise, fmtKg, fmtPct } from '../../lib/format';
import { CATEGORY_LABELS } from '../../lib/labels';
import { YieldProductPicker } from './YieldProductPicker';
import { bestProductForHint, bestTemplateForProduct } from './productSearch';

/**
 * Modal de creación de una prueba de rendimiento, en blanco o desde plantilla.
 * `template`: plantilla elegida en la galería (null = en blanco; undefined = que elija el usuario).
 */
export function CreateYieldTestModal({
  open,
  onClose,
  template,
  productId: initialProductId,
}: {
  open: boolean;
  onClose: () => void;
  template?: YieldTemplate | null;
  productId?: string;
}) {
  const navigate = useNavigate();
  const products = useProducts();
  const [tpl, setTpl] = useState<YieldTemplate | null>(null);
  const [productId, setProductId] = useState<string | undefined>();
  const [pickingProduct, setPickingProduct] = useState(false);
  const [gross, setGross] = useState<number | undefined>(5);
  const [price, setPrice] = useState<number | undefined>();
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [productTouched, setProductTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const initialised = useRef(false);
  const chipsRef = useRef<HTMLDivElement>(null);

  const product = useMemo(() => products?.find((p) => p.id === productId), [products, productId]);

  // Estado inicial cada vez que se abre (y en cuanto cargan los productos, para preseleccionar).
  useEffect(() => {
    if (!open) {
      initialised.current = false;
      return;
    }
    if (initialised.current || !products) return;
    initialised.current = true;
    const pre = initialProductId ? products.find((p) => p.id === initialProductId) : undefined;
    const t = template !== undefined ? template : pre ? (bestTemplateForProduct(pre.name) ?? null) : null;
    const p = pre ?? (t ? bestProductForHint(t.productHint, products) : undefined);
    setTpl(t);
    setProductId(p?.id);
    setProductTouched(!!pre);
    setPickingProduct(false);
    setGross(t?.typicalGrossKg ?? 5);
    setPrice(productPricePerKg(p));
    setName('');
    setNameTouched(false);
    setSaving(false);
  }, [open, products, template, initialProductId]);

  // Lleva a la vista la plantilla elegida dentro de la fila deslizable.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const row = chipsRef.current;
      const chip = row?.querySelector<HTMLElement>('[aria-checked="true"]');
      if (row && chip) row.scrollTo({ left: Math.max(0, chip.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2), behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [open, tpl]);

  const defaultName = tpl ? tpl.name : product ? `Prueba de ${product.name.toLowerCase()}` : 'Prueba de rendimiento';
  const finalName = nameTouched && name.trim() ? name.trim() : defaultName;

  function chooseTemplate(t: YieldTemplate | null) {
    setTpl(t);
    if (t) setGross(t.typicalGrossKg ?? 5);
    if (!productTouched && products) {
      const p = t ? bestProductForHint(t.productHint, products) : undefined;
      setProductId(p?.id);
      setPrice(productPricePerKg(p));
    }
  }

  function chooseProduct(p: Product | undefined) {
    setProductId(p?.id);
    setProductTouched(true);
    setPickingProduct(false);
    const pp = productPricePerKg(p);
    if (pp != null) setPrice(pp);
  }

  const preview = useMemo(() => {
    if (!tpl || !(gross && gross > 0)) return undefined;
    return computeYield({
      grossWeightKg: gross,
      purchasePricePerKg: price ?? 0,
      thawLossPct: tpl.thawLossPct,
      cookingLossPct: tpl.cookingLossPct,
      portionKg: tpl.portionKg,
      outputs: outputsFromTemplate(tpl, gross),
    });
  }, [tpl, gross, price]);

  async function submit() {
    setSaving(true);
    try {
      const opts = { productId, grossWeightKg: gross, purchasePricePerKg: price, name: finalName };
      const test = tpl ? await createYieldTestFromTemplate(tpl, opts) : await createYieldTest({ ...opts, grossWeightKg: gross ?? 0 });
      toast.success('Prueba creada', tpl ? 'Ajusta los pesos con lo que te salga en la báscula.' : 'Ahora anota lo que sale de la pieza.');
      onClose();
      navigate(`/mermas/${test.id}`);
    } catch (e) {
      toast.error('No se ha podido crear la prueba', errorMessage(e));
      setSaving(false);
    }
  }

  const productPrice = productPricePerKg(product);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={tpl ? `${tpl.emoji ?? '⚖️'} ${tpl.name}` : 'Nueva prueba de rendimiento'}
      subtitle="Pesa la pieza al comprarla y lo que sale al limpiarla. Tarda 5 minutos y afina todos tus escandallos."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} disabled={!(gross && gross > 0)} iconRight={<ArrowRight className="size-4" />}>
            Crear y empezar a pesar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Plantilla */}
        <div>
          <div className="mb-2 text-xs font-semibold text-ink-2">Punto de partida</div>
          <div ref={chipsRef} className="relative -mx-5 flex scroll-px-5 gap-2 overflow-x-auto px-5 pb-1" role="radiogroup" aria-label="Plantilla">
            <TemplateChip active={!tpl} onClick={() => chooseTemplate(null)} emoji={<FilePlus2 className="size-4" />} label="En blanco" />
            {YIELD_TEMPLATES.map((t) => (
              <TemplateChip key={t.name} active={tpl?.name === t.name} onClick={() => chooseTemplate(t)} emoji={t.emoji ?? '⚖️'} label={t.name} />
            ))}
          </div>
          {tpl?.tip && (
            <div className="mt-2 flex gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warn" />
              <span>{tpl.tip}</span>
            </div>
          )}
        </div>

        {/* Producto */}
        <div>
          <div className="mb-1.5 flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <span className="text-xs font-semibold text-ink-2">Producto que vas a despiezar</span>
            <span className="text-[11px] text-muted">Opcional, pero necesario para aplicarla a tus escandallos</span>
          </div>
          {product && !pickingProduct ? (
            <div className="flex items-center gap-3 rounded-xl border border-brand-500/40 bg-brand-500/5 px-3 py-2.5">
              <span className="text-xl" aria-hidden>
                {CATEGORY_LABELS[product.category]?.emoji ?? '📦'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-bold leading-snug text-ink">{product.name}</div>
                <div className="tabular text-xs text-muted">
                  {product.pricePerBase > 0 ? `${fmtEurPrecise(product.pricePerBase)} / ${product.baseUnit}` : 'Sin precio todavía'}
                  {!productTouched && tpl && ' · sugerido por la plantilla'}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setPickingProduct(true)}>
                Cambiar
              </Button>
              <button
                type="button"
                aria-label="Quitar producto"
                onClick={() => chooseProduct(undefined)}
                className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <YieldProductPicker
              products={products}
              value={productId}
              onChange={chooseProduct}
              hint={tpl?.productHint}
              newProductCategory={tpl?.category}
              autoFocus={pickingProduct}
            />
          )}
        </div>

        {/* Pesos y precio */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Peso bruto de la pieza" hint="Tal cual llega del proveedor">
            <NumberInput value={gross} onValue={setGross} min={0} suffix="kg" placeholder="5" aria-label="Peso bruto en kg" />
          </Field>
          <Field
            label="Precio de compra"
            hint={productPrice != null && price != null && Math.abs(productPrice - price) > 0.004 ? `Factura: ${fmtEurPrecise(productPrice)}/kg` : 'Sin IVA, por kg bruto'}
          >
            <NumberInput value={price} onValue={setPrice} min={0} decimals={4} suffix="€/kg" placeholder="0,00" aria-label="Precio de compra en euros por kilo" />
          </Field>
          <Field label="Nombre de la prueba" className="col-span-2 sm:col-span-1">
            <Input
              value={nameTouched ? name : defaultName}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              aria-label="Nombre de la prueba"
            />
          </Field>
        </div>

        {tpl && preview && (
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Con los porcentajes típicos</div>
            <div className={cx('mt-2 grid gap-3', tpl.cookingLossPct > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
              <PreviewNum label="Rendimiento" value={fmtPct(preview.yieldPct, 0)} />
              <PreviewNum label="Parte limpia" value={fmtKg(preview.principalKg)} />
              <PreviewNum label="€/kg limpio" value={price && price > 0 ? fmtEur(preview.costPerUsableKg) : '—'} highlight />
              {tpl.cookingLossPct > 0 && (
                <PreviewNum label={`€/kg cocinado (−${fmtPct(tpl.cookingLossPct, 0)})`} value={price && price > 0 ? fmtEur(preview.costPerCookedKg) : '—'} highlight />
              )}
            </div>
            <p className="mt-2.5 text-xs text-muted">
              Después ajustas cada salida con lo que marque tu báscula: la prueba real manda sobre la plantilla.
            </p>
          </div>
        )}
        {!tpl && (
          <Callout tone="info" title="Prueba en blanco">
            Anotarás tú cada salida (lomos, recortes, espinas, piel…). Te avisamos si falta peso por asignar.
          </Callout>
        )}
      </div>
    </Modal>
  );
}

function TemplateChip({ active, onClick, emoji, label }: { active: boolean; onClick: () => void; emoji: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cx(
        'inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition',
        active ? 'border-brand-500 bg-brand-500 text-white shadow-glow' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      <span aria-hidden className="flex items-center">
        {emoji}
      </span>
      <span className="max-w-[14rem] truncate">{label}</span>
    </button>
  );
}

function PreviewNum({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className={cx('font-display text-xl font-extrabold sm:text-2xl', highlight ? 'text-brand-600 dark:text-brand-400' : 'text-ink')}>{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
