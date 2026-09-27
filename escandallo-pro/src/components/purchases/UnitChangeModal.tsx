import { useMemo, useState } from 'react';
import { ArrowRight, FlaskConical, Scale, TriangleAlert } from 'lucide-react';
import type { BaseUnit, PricePoint, Product, YieldTest } from '../../types';
import { Button, Callout, Field, Modal, cx } from '../ui';
import { fmtDate, fmtEurPrecise, fmtNum } from '../../lib/format';
import { planBaseUnitChange, updateProduct } from '../../services/products';
import { errorMessage, toast } from '../../state/store';
import { AmountInput } from './AmountInput';

const UNIT_NAME: Record<BaseUnit, string> = { kg: 'kilo', l: 'litro', ud: 'unidad' };
const UNIT_OPTION: Record<BaseUnit, string> = { kg: 'kilo (kg)', l: 'litro (l)', ud: 'unidad (ud)' };

export interface UnitChangeResult {
  baseUnit: BaseUnit;
  unitWeightKg?: number;
  densityKgPerL?: number;
  convertible: boolean;
  newPrice: number;
}

function plural(n: number, one: string, many: string): string {
  return `${fmtNum(n, 0)} ${n === 1 ? one : many}`;
}

/**
 * Aviso previo al cambio de unidad de compra de un ingrediente: enseña qué pasará con el precio vigente, el histórico y
 * las pruebas de rendimiento, y permite indicar ahí mismo el peso por unidad o la densidad que faltan para convertir.
 */
export function UnitChangeModal({
  product,
  to,
  points,
  tests,
  dishCount,
  onClose,
  onApplied,
}: {
  product: Product;
  to: BaseUnit;
  points: PricePoint[];
  tests: YieldTest[];
  /** Escandallos que usan el ingrediente. */
  dishCount: number;
  onClose: () => void;
  onApplied: (r: UnitChangeResult) => void;
}) {
  const [unitWeightKg, setUnitWeightKg] = useState<number | undefined>(product.unitWeightKg);
  const [densityKgPerL, setDensityKgPerL] = useState<number | undefined>(product.densityKgPerL);
  const [busy, setBusy] = useState(false);
  const from = product.baseUnit;
  const pair = new Set([from, to]);
  const needsWeight = pair.has('ud');
  const needsDensity = pair.has('l');
  const plan = useMemo(() => planBaseUnitChange(product, to, points, { unitWeightKg, densityKgPerL }), [product, to, points, unitWeightKg, densityKgPerL]);
  // Foco inicial: el dato que falta para convertir o, si no falta nada, el botón de aplicar.
  const [initialMissing] = useState(plan.missing);
  const linkedTests = tests.filter((t) => t.productId === product.id || t.id === product.yieldTestId);
  const freezesTests = from === 'kg' && to !== 'kg' && product.pricePerBase > 0 && linkedTests.length > 0;
  const historyInOtherUnit = plan.keptPoints;

  const how = [
    needsWeight && unitWeightKg ? `el peso de 1 unidad (${fmtNum(unitWeightKg * 1000, 1)} g)` : '',
    needsDensity && densityKgPerL ? `la densidad (${fmtNum(densityKgPerL, 3)} kg/l)` : '',
  ]
    .filter(Boolean)
    .join(' y ');
  const missingText =
    plan.missing === 'both' ? 'el peso de 1 unidad y la densidad' : plan.missing === 'unitWeightKg' ? 'el peso de 1 unidad' : 'la densidad';

  const apply = async () => {
    setBusy(true);
    try {
      const patch: Partial<Product> = { baseUnit: to };
      if (needsWeight && unitWeightKg !== product.unitWeightKg) patch.unitWeightKg = unitWeightKg;
      if (needsDensity && densityKgPerL !== product.densityKgPerL) patch.densityKgPerL = densityKgPerL;
      await updateProduct(product.id, patch);
      if (plan.convertible) {
        toast.success('Unidad cambiada', `${product.name}: ${fmtEurPrecise(plan.newPrice)}/${to}. Histórico convertido.`);
      } else if (plan.newPrice > 0) {
        toast.success('Unidad cambiada', `${product.name}: recuperado el último precio por ${UNIT_NAME[to]}.`);
      } else {
        toast.info('Unidad cambiada', `Indica el precio de «${product.name}» por ${UNIT_NAME[to]} para que sus escandallos vuelvan a calcularse.`);
      }
      onApplied({
        baseUnit: to,
        unitWeightKg: 'unitWeightKg' in patch ? unitWeightKg : product.unitWeightKg,
        densityKgPerL: 'densityKgPerL' in patch ? densityKgPerL : product.densityKgPerL,
        convertible: plan.convertible,
        newPrice: plan.newPrice,
      });
    } catch (e) {
      toast.error('No se ha podido cambiar la unidad', errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Cambiar la unidad de compra"
      subtitle={`«${product.name}» pasa de comprarse por ${UNIT_OPTION[from]} a ${UNIT_OPTION[to]}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant={plan.convertible || plan.newPrice > 0 || plan.oldPrice === 0 ? 'primary' : 'danger'} loading={busy} onClick={() => void apply()} autoFocus={!initialMissing}>
            {plan.convertible
              ? plan.oldPrice > 0 || plan.convertedPoints > 0
                ? 'Convertir y cambiar'
                : 'Cambiar unidad'
              : plan.oldPrice > 0 && !(plan.newPrice > 0)
                ? 'Cambiar sin convertir'
                : 'Cambiar unidad'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Precio antes → después */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-line bg-surface-2 p-3 sm:gap-3 sm:p-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Ahora</div>
            <div className="tabular mt-0.5 truncate font-display text-xl font-extrabold text-ink sm:text-2xl">
              {plan.oldPrice > 0 ? fmtEurPrecise(plan.oldPrice) : 'Sin precio'}
              {plan.oldPrice > 0 && <span className="text-sm font-semibold text-muted">/{from}</span>}
            </div>
          </div>
          <ArrowRight className="size-5 text-muted" aria-hidden />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Después</div>
            <div className={cx('tabular mt-0.5 truncate font-display text-xl font-extrabold sm:text-2xl', plan.newPrice > 0 ? 'text-ok-ink' : 'text-warn-ink')}>
              {plan.newPrice > 0 ? fmtEurPrecise(plan.newPrice) : 'Sin precio'}
              {plan.newPrice > 0 && <span className="text-sm font-semibold text-muted">/{to}</span>}
            </div>
          </div>
        </div>

        {(needsWeight || needsDensity) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {needsWeight && (
              <Field label="Peso de 1 unidad" hint="Pesa varias y haz la media">
                <AmountInput
                  value={unitWeightKg != null ? unitWeightKg * 1000 : undefined}
                  onValue={(v) => setUnitWeightKg(v != null && v > 0 ? v / 1000 : undefined)}
                  decimals={1}
                  suffix="g"
                  min={0}
                  aria-label="Peso de 1 unidad en gramos"
                  autoFocus={initialMissing === 'unitWeightKg' || initialMissing === 'both'}
                />
              </Field>
            )}
            {needsDensity && (
              <Field label="Densidad" hint="Agua, leche o vino ≈ 1; aceite ≈ 0,92">
                <AmountInput
                  value={densityKgPerL}
                  onValue={(v) => setDensityKgPerL(v != null && v > 0 ? v : undefined)}
                  decimals={3}
                  suffix="kg/l"
                  min={0}
                  aria-label="Densidad en kilos por litro"
                  autoFocus={initialMissing === 'densityKgPerL'}
                />
              </Field>
            )}
          </div>
        )}

        {plan.convertible ? (
          plan.oldPrice > 0 || plan.convertedPoints > 0 ? (
            <Callout tone="ok" icon={<Scale className="size-4" />} title="El precio se convierte solo">
              Usaremos {how || 'la equivalencia'} para pasar a €/{to} el precio vigente
              {plan.convertedPoints > 0 ? ` y ${plan.convertedPoints === 1 ? 'el precio' : `los ${fmtNum(plan.convertedPoints, 0)} precios`} del histórico` : ''}: las alertas y
              el gráfico seguirán comparando lo mismo.
            </Callout>
          ) : (
            <Callout tone="info" title="Aún no tiene precio">
              No hay precio que convertir. Registra el primero por {UNIT_NAME[to]} cuando lo tengas.
            </Callout>
          )
        ) : (
          <Callout tone="warn" icon={<TriangleAlert className="size-4" />} title={`Sin ${missingText} no podemos convertir el precio`}>
            <p>
              {plan.priceFromHistory
                ? `Recuperaremos el último precio que tenías por ${UNIT_NAME[to]}: ${fmtEurPrecise(plan.priceFromHistory.pricePerBase)}/${to} (${fmtDate(plan.priceFromHistory.date)}).`
                : plan.oldPrice > 0
                  ? `Si cambias igualmente, «${product.name}» se quedará sin precio hasta que registres uno por ${UNIT_NAME[to]}${dishCount > 0 ? ` y ${dishCount === 1 ? 'el escandallo que lo usa lo marcará' : `los ${fmtNum(dishCount, 0)} escandallos que lo usan lo marcarán`} como pendiente` : ''}.`
                  : `«${product.name}» aún no tiene precio vigente.`}
            </p>
            {historyInOtherUnit > 0 && (
              <p className="mt-1">
                {historyInOtherUnit === 1 ? 'El precio' : `Los ${fmtNum(historyInOtherUnit, 0)} precios`} del histórico en otra unidad se{' '}
                {historyInOtherUnit === 1 ? 'conserva' : 'conservan'} como referencia, pero no se usarán en alertas ni gráficos.
              </p>
            )}
            {(plan.missing === 'unitWeightKg' || plan.missing === 'both') && dishCount > 0 && (
              <p className="mt-1">Las recetas que lo piden por peso no se podrán calcular hasta que indiques el peso de 1 unidad.</p>
            )}
          </Callout>
        )}

        {freezesTests && (
          <Callout tone="info" icon={<FlaskConical className="size-4" />} title="Pruebas de rendimiento">
            {linkedTests.length === 1 ? `La prueba «${linkedTests[0].name}» seguirá` : `Sus ${plural(linkedTests.length, 'prueba', 'pruebas')} seguirán`} calculando con{' '}
            {fmtEurPrecise(product.pricePerBase)}/kg: guardamos ese precio de compra en {linkedTests.length === 1 ? 'la prueba' : 'cada una'}, porque el
            ingrediente dejará de comprarse por kilo.
          </Callout>
        )}
      </div>
    </Modal>
  );
}
