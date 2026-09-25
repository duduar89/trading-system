import { useId } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Wand2 } from 'lucide-react';
import type { Invoice, Supplier } from '../../types';
import { Button, Card, Field, Input } from '../ui';
import { fmtEur } from '../../lib/format';
import { foldText, type TotalsCheck } from './logic';
import { AmountInput } from './AmountInput';

export type InvoiceDraft = Pick<Invoice, 'supplierName' | 'supplierTaxId' | 'number' | 'date' | 'subtotal' | 'vatTotal' | 'total' | 'lines'>;

/** Cabecera editable de la factura (proveedor, CIF, nº, fecha e importes). */
export function InvoiceHeaderForm({
  draft,
  suppliers,
  onChange,
  disabled,
}: {
  draft: InvoiceDraft;
  suppliers: Supplier[];
  onChange: (patch: Partial<InvoiceDraft>) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const onSupplier = (name: string) => {
    const match = suppliers.find((s) => foldText(s.name) === foldText(name));
    onChange(match?.taxId && !draft.supplierTaxId ? { supplierName: name, supplierTaxId: match.taxId } : { supplierName: name });
  };
  return (
    <Card>
      <datalist id={listId}>
        {suppliers.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Field label="Proveedor" className="col-span-2 sm:col-span-4">
          <Input value={draft.supplierName} onChange={(e) => onSupplier(e.target.value)} list={listId} placeholder="Nombre del proveedor" disabled={disabled} autoComplete="off" />
        </Field>
        <Field label="CIF / NIF" className="col-span-2 sm:col-span-2">
          <Input
            value={draft.supplierTaxId ?? ''}
            onChange={(e) => onChange({ supplierTaxId: e.target.value.toUpperCase() || undefined })}
            placeholder="B12345678"
            disabled={disabled}
            autoComplete="off"
          />
        </Field>
        <Field label="Nº de factura" className="sm:col-span-3">
          <Input value={draft.number ?? ''} onChange={(e) => onChange({ number: e.target.value || undefined })} placeholder="F-2026/0001" disabled={disabled} />
        </Field>
        <Field label="Fecha" className="sm:col-span-3">
          <Input type="date" value={draft.date ?? ''} onChange={(e) => e.target.value && onChange({ date: e.target.value })} disabled={disabled} />
        </Field>
        <Field label="Base imponible" className="sm:col-span-2">
          <AmountInput value={draft.subtotal} onValue={(v) => onChange({ subtotal: v })} decimals={2} minDecimals={2} suffix="€" disabled={disabled} />
        </Field>
        <Field label="IVA" className="sm:col-span-2">
          <AmountInput value={draft.vatTotal} onValue={(v) => onChange({ vatTotal: v })} decimals={2} minDecimals={2} suffix="€" disabled={disabled} />
        </Field>
        <Field label="Total factura" className="col-span-2 sm:col-span-2">
          <AmountInput value={draft.total} onValue={(v) => onChange({ total: v })} decimals={2} minDecimals={2} suffix="€" disabled={disabled} className="font-semibold" />
        </Field>
      </div>
    </Card>
  );
}

/** Barra de comprobación de totales: suma de líneas frente a base imponible, y base + IVA frente a total. */
export function TotalsBar({ check, onUseLinesSum, disabled }: { check: TotalsCheck; onUseLinesSum: () => void; disabled?: boolean }) {
  const tone = check.status === 'ok' ? 'ok' : check.status === 'warn' ? 'warn' : 'info';
  const styles = { ok: 'border-ok/30 bg-ok-soft', warn: 'border-warn/40 bg-warn-soft', info: 'border-line bg-surface' };
  const Icon = check.status === 'ok' ? CheckCircle2 : check.status === 'warn' ? AlertTriangle : Info;
  const iconTone = { ok: 'text-ok', warn: 'text-warn', info: 'text-info' };
  return (
    <div className={clsx('rounded-2xl border p-3.5 sm:p-4', styles[tone])} role="status">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Icon className={clsx('hidden size-5 shrink-0 sm:block', iconTone[tone])} />
        <div className="min-w-0 flex-1 text-sm text-ink-2">
          {check.status === 'ok' && (
            <>
              <span className="font-semibold text-ink">Cuadra.</span> La suma de líneas coincide con la base imponible: no falta ninguna línea.
            </>
          )}
          {check.status === 'warn' && check.diff != null && (
            <>
              <span className="font-semibold text-ink">No cuadra por {fmtEur(Math.abs(check.diff))}.</span>{' '}
              {check.diff < 0
                ? 'Las líneas suman menos que la base imponible: puede faltar alguna línea o haber un importe mal leído.'
                : 'Las líneas suman más que la base imponible: revisa si hay una línea repetida o un descuento sin aplicar.'}
            </>
          )}
          {check.status === 'none' && <>Indica la base imponible para comprobar que no falta ninguna línea.</>}
          {check.vat && !check.vat.ok && (
            <div className="mt-1 text-xs text-muted">
              Ojo: base + IVA = {fmtEur(check.vat.expected)}, pero el total indica {fmtEur(check.vat.total)}.
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="tabular text-right">
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Suma de líneas</div>
            <div className="font-display text-lg font-extrabold text-ink">{fmtEur(check.linesSum)}</div>
          </div>
          {check.subtotal != null && (
            <div className="tabular text-right">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Base imponible</div>
              <div className="font-display text-lg font-extrabold text-ink">{fmtEur(check.subtotal)}</div>
            </div>
          )}
          {check.status !== 'ok' && check.linesSum > 0 && !disabled && (
            <Button size="sm" variant="outline" icon={<Wand2 className="size-3.5" />} onClick={onUseLinesSum} title="Usar la suma de líneas como base imponible">
              Usar suma
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
