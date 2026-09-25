import { useState } from 'react';
import { Briefcase, RotateCcw, Save } from 'lucide-react';
import { DEFAULT_BUSINESS_SETTINGS, updateBusinessSettings } from '../../../db';
import { suggestedMenuPrice } from '../../../core/costing';
import { useBusiness } from '../../../state/hooks';
import { toast, errorMessage } from '../../../state/store';
import { fmtEur, fmtPct } from '../../../lib/format';
import { Button, Card, CardHeader, Field, NumberInput, Select } from '../../ui';
import { ROUNDING_OPTIONS, draftDiffers, draftFromBusiness, hasErrors, validateBusinessDraft, type BusinessDraft } from '../settingsLogic';

const EXAMPLE_COST = 4;

/** Parámetros de negocio del restaurante activo: objetivo de food cost, semáforo, IVA, alertas y redondeo. */
export function BusinessCard({ id }: { id?: string }) {
  const business = useBusiness();
  const [draft, setDraft] = useState<BusinessDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const d: BusinessDraft = draft ?? draftFromBusiness(business);
  const errors = validateBusinessDraft(d);
  const dirty = draft != null && draftDiffers(draft, business);
  const set = (patch: BusinessDraft) => setDraft({ ...d, ...patch });

  const valid = !hasErrors(errors);
  const example = valid ? suggestedMenuPrice(EXAMPLE_COST, d.targetFoodCostPct!, d.defaultSaleVatPct!, d.priceRounding!) : undefined;
  const t = d.targetFoodCostPct ?? 0;
  const w = Math.max(t, d.warningFoodCostPct ?? t);
  const scaleMax = Math.max(60, Math.ceil((w + 15) / 5) * 5);

  const save = async () => {
    if (!valid || !dirty) return;
    setSaving(true);
    try {
      await updateBusinessSettings({
        targetFoodCostPct: d.targetFoodCostPct!,
        warningFoodCostPct: d.warningFoodCostPct!,
        defaultSaleVatPct: d.defaultSaleVatPct!,
        priceAlertPct: d.priceAlertPct!,
        priceRounding: d.priceRounding!,
      });
      setDraft(null);
      toast.success('Ajustes de negocio guardados', 'Todos los escandallos se han recalculado con los nuevos valores.');
    } catch (e) {
      toast.error('No se pudieron guardar los ajustes', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader
        icon={<Briefcase className="size-5" />}
        title="Negocio"
        subtitle="Tus objetivos. Se aplican a todos los platos de este restaurante (salvo los que tengan un objetivo propio)."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Food cost objetivo" error={errors.targetFoodCostPct} hint="Lo habitual en restauración: 25–35 % del PVP sin IVA.">
          <NumberInput value={d.targetFoodCostPct} onValue={(v) => set({ targetFoodCostPct: v })} suffix="%" decimals={1} />
        </Field>
        <Field label="Umbral de atención (ámbar)" error={errors.warningFoodCostPct} hint="Por encima de este valor el plato se marca en rojo.">
          <NumberInput value={d.warningFoodCostPct} onValue={(v) => set({ warningFoodCostPct: v })} suffix="%" decimals={1} />
        </Field>
        <Field label="IVA de venta por defecto" error={errors.defaultSaleVatPct} hint="En España, la hostelería aplica el 10 %.">
          <NumberInput value={d.defaultSaleVatPct} onValue={(v) => set({ defaultSaleVatPct: v })} suffix="%" decimals={1} />
        </Field>
        <Field label="Avisar si un ingrediente sube más de" error={errors.priceAlertPct} hint="Aparecerá en «Alertas de precio» del panel.">
          <NumberInput value={d.priceAlertPct} onValue={(v) => set({ priceAlertPct: v })} suffix="%" decimals={1} />
        </Field>
        <Field
          label="Redondeo del PVP sugerido"
          error={errors.priceRounding}
          className="sm:col-span-2"
          hint="El precio recomendado se redondea hacia arriba a un importe «de carta»."
        >
          <Select value={String(d.priceRounding ?? '')} onChange={(e) => set({ priceRounding: Number(e.target.value) })}>
            {ROUNDING_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label} (p. ej. {o.example})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Vista previa del semáforo y del PVP sugerido */}
      <div className="mt-5 rounded-2xl border border-line bg-surface-2 p-4">
        <div className="text-xs font-bold uppercase tracking-wide text-muted">Así se verá tu semáforo</div>
        <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          <div className="bg-ok" style={{ width: `${(Math.min(t, scaleMax) / scaleMax) * 100}%` }} />
          <div className="bg-warn" style={{ width: `${(Math.max(0, Math.min(w, scaleMax) - Math.min(t, scaleMax)) / scaleMax) * 100}%` }} />
          <div className="flex-1 bg-bad" />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          <span>
            <span className="font-semibold text-ok">Verde</span> hasta {fmtPct(t, 1)}
          </span>
          <span>
            <span className="font-semibold text-warn">Ámbar</span> hasta {fmtPct(w, 1)}
          </span>
          <span>
            <span className="font-semibold text-bad">Rojo</span> por encima
          </span>
        </div>
        {example != null && (
          <p className="mt-3 text-sm text-ink-2">
            Ejemplo: un plato que te cuesta <strong className="text-ink">{fmtEur(EXAMPLE_COST)}</strong> debería venderse a{' '}
            <strong className="text-ink">{fmtEur(example)}</strong> en carta (IVA incluido) para cumplir tu objetivo.
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setDraft(draftFromBusiness(DEFAULT_BUSINESS_SETTINGS))}>
          Valores recomendados
        </Button>
        <div className="flex gap-2">
          {dirty && (
            <Button variant="outline" onClick={() => setDraft(null)} className="flex-1 sm:flex-none">
              Descartar
            </Button>
          )}
          <Button onClick={save} loading={saving} disabled={!dirty || !valid} icon={<Save className="size-4" />} className="flex-1 sm:flex-none">
            Guardar cambios
          </Button>
        </div>
      </div>
    </Card>
  );
}
