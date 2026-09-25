import { useDeferredValue, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Allergen, BaseUnit, IngredientCategory, Product } from '../../types';
import { Button, Field, Input, Modal, Select } from '../ui';
import { AllergenChips, AllergenPicker } from '../Allergens';
import { CATEGORIES, CATEGORY_LABELS } from '../../lib/labels';
import { fmtNum } from '../../lib/format';
import { findKbIngredient, type KbIngredient } from '../../kb/ingredients';
import { createProduct } from '../../services/products';
import { errorMessage, toast } from '../../state/store';
import { AmountInput } from './AmountInput';

const UNIT_LABEL: Record<BaseUnit, string> = { kg: 'Kilo (kg)', l: 'Litro (l)', ud: 'Unidad (ud)' };

interface FormState {
  name: string;
  category: IngredientCategory | '';
  baseUnit: BaseUnit | '';
  price?: number;
  wastePct?: number;
  cookingLossPct?: number;
  unitWeightG?: number;
  densityKgPerL?: number;
  allergens?: Allergen[];
}

const EMPTY: FormState = { name: '', category: '', baseUnit: '' };

function lookupKb(name: string): KbIngredient | undefined {
  if (name.trim().length < 3) return undefined;
  try {
    return findKbIngredient(name);
  } catch {
    return undefined;
  }
}

/** Alta rápida de un ingrediente. Lo que se deja vacío se completa con la base de conocimiento culinaria. */
export function NewProductModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (p: Product) => void }) {
  const [f, setF] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const deferredName = useDeferredValue(f.name);
  const kb = useMemo(() => lookupKb(deferredName), [deferredName]);
  const unit: BaseUnit = f.baseUnit || kb?.baseUnit || 'kg';
  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));

  const close = () => {
    setF(EMPTY);
    onClose();
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const name = f.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      const p = await createProduct({
        name,
        category: f.category || undefined,
        baseUnit: f.baseUnit || undefined,
        pricePerBase: f.price && f.price > 0 ? f.price : undefined,
        priceSource: 'manual',
        wastePct: f.wastePct,
        cookingLossPct: f.cookingLossPct,
        unitWeightKg: unit === 'ud' && f.unitWeightG && f.unitWeightG > 0 ? f.unitWeightG / 1000 : undefined,
        densityKgPerL: unit === 'l' && f.densityKgPerL && f.densityKgPerL > 0 ? f.densityKgPerL : undefined,
        allergens: f.allergens,
      });
      toast.success('Ingrediente creado', p.name);
      onCreated?.(p);
      close();
    } catch (err) {
      toast.error('No se pudo crear el ingrediente', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const kbCat = kb ? CATEGORY_LABELS[kb.category] : undefined;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Nuevo ingrediente"
      subtitle="Sólo el nombre es obligatorio: rellenamos mermas y alérgenos típicos automáticamente."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={saving} disabled={!f.name.trim()}>
            Crear ingrediente
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Nombre *">
          <Input
            value={f.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Ej.: Tomate pera, Solomillo de ternera…"
            autoFocus
          />
        </Field>

        {kb && (
          <div className="flex items-start gap-3 rounded-xl border border-ai/30 bg-ai-soft p-3 text-sm animate-fade-in">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-ai" />
            <div className="min-w-0 text-ink-2">
              <div className="font-semibold text-ink">Lo conocemos: {kb.name}</div>
              <div className="mt-0.5 text-xs">
                {kbCat?.emoji} {kbCat?.label} · se compra por {kb.baseUnit} · merma de limpieza {fmtNum(kb.wastePct, 1)} % · cocción{' '}
                {fmtNum(kb.cookingLossPct, 1)} %{kb.unitWeightKg ? ` · 1 ud ≈ ${fmtNum(kb.unitWeightKg * 1000, 0)} g` : ''}
              </div>
              {kb.allergens.length > 0 && (
                <div className="mt-1.5">
                  <AllergenChips allergens={kb.allergens} size="sm" />
                </div>
              )}
              <div className="mt-1 text-xs text-muted">Deja los campos vacíos para usar estos valores o escribe los tuyos.</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría">
            <Select value={f.category} onChange={(e) => set({ category: e.target.value as IngredientCategory | '' })}>
              <option value="">{kbCat ? `Automática (${kbCat.label})` : 'Automática'}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c].emoji} {CATEGORY_LABELS[c].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Se compra por">
            <Select value={f.baseUnit} onChange={(e) => set({ baseUnit: e.target.value as BaseUnit | '' })}>
              <option value="">{kb ? `Automático (${kb.baseUnit})` : 'Automático'}</option>
              {(Object.keys(UNIT_LABEL) as BaseUnit[]).map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Precio sin IVA (€/${unit})`} hint="Opcional: se actualizará con tus facturas">
            <AmountInput value={f.price} onValue={(v) => set({ price: v })} decimals={4} minDecimals={2} suffix={`€/${unit}`} min={0} />
          </Field>
          {unit === 'ud' ? (
            <Field label="Peso de 1 unidad" hint="Para usarlo en recetas por peso">
              <AmountInput
                value={f.unitWeightG}
                onValue={(v) => set({ unitWeightG: v })}
                decimals={1}
                suffix="g"
                min={0}
                placeholder={kb?.unitWeightKg ? fmtNum(kb.unitWeightKg * 1000, 0) : undefined}
              />
            </Field>
          ) : unit === 'l' ? (
            <Field label="Densidad" hint="kg por litro (agua = 1)">
              <AmountInput
                value={f.densityKgPerL}
                onValue={(v) => set({ densityKgPerL: v })}
                decimals={3}
                suffix="kg/l"
                min={0}
                placeholder={kb?.densityKgPerL ? fmtNum(kb.densityKgPerL, 2) : '1'}
              />
            </Field>
          ) : (
            <div />
          )}
          <Field label="Merma de limpieza" hint="Lo que se tira al limpiar o pelar">
            <AmountInput
              value={f.wastePct}
              onValue={(v) => set({ wastePct: v == null ? undefined : Math.min(99, v) })}
              decimals={1}
              suffix="%"
              min={0}
              placeholder={kb ? fmtNum(kb.wastePct, 1) : 'Auto'}
            />
          </Field>
          <Field label="Merma de cocción" hint="Peso que pierde al cocinarse">
            <AmountInput
              value={f.cookingLossPct}
              onValue={(v) => set({ cookingLossPct: v == null ? undefined : Math.min(99, v) })}
              decimals={1}
              suffix="%"
              min={0}
              placeholder={kb ? fmtNum(kb.cookingLossPct, 1) : 'Auto'}
            />
          </Field>
        </div>

        <div role="group" aria-labelledby="new-product-allergens">
          <span id="new-product-allergens" className="mb-1.5 block text-xs font-semibold text-ink-2">
            Alérgenos
          </span>
          <AllergenPicker value={f.allergens ?? kb?.allergens ?? []} onChange={(v) => set({ allergens: v })} />
          <span className="mt-1 block text-xs text-muted">
            {f.allergens ? 'Has elegido los alérgenos a mano.' : 'Si no marcas ninguno, usamos los típicos de este ingrediente.'}
          </span>
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
