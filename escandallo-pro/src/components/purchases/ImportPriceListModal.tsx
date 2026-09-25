import { useDeferredValue, useId, useMemo, useState } from 'react';
import clsx from 'clsx';
import { CheckCircle2, FileSpreadsheet, Info, RotateCcw } from 'lucide-react';
import type { ID, Product, Supplier } from '../../types';
import { Badge, Button, Callout, Field, FileDrop, Input, Modal, ProgressBar, Select, Spinner, Switch } from '../ui';
import { guessColumnMapping, readSpreadsheet, type Cell, type ColumnMapping, type SheetData } from '../../extract/spreadsheet';
import { parseNumberEs } from '../../core/numbers';
import { addProductAlias, createProduct, findOrCreateSupplier, setProductPrice } from '../../services/products';
import { errorMessage, toast } from '../../state/store';
import { fmtEurPrecise, fmtNum } from '../../lib/format';
import { todayIso } from '../../lib/id';
import { MAPPING_FIELDS, columnLetter, foldText, parsePriceRows } from './logic';
import { planPriceImport, type ImportPlan } from './priceImport';

type Step = 'pick' | 'map' | 'importing' | 'done';

interface Result {
  updated: number;
  created: number;
  failed: number;
}

/**
 * Importar una tarifa o listado de precios (Excel / CSV): detecta columnas, deja ajustarlas, muestra una vista previa
 * con el precio real por kg / l / ud y actualiza o crea ingredientes (precio con origen "hoja").
 */
export function ImportPriceListModal({
  open,
  onClose,
  products,
  suppliers,
}: {
  open: boolean;
  onClose: () => void;
  products: Product[];
  suppliers: Supplier[];
}) {
  const [step, setStep] = useState<Step>('pick');
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({ description: 0 });
  const [date, setDate] = useState(todayIso());
  const [supplierName, setSupplierName] = useState('');
  const [createMissing, setCreateMissing] = useState(true);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const supplierList = useId();

  const reset = () => {
    setStep('pick');
    setSheets([]);
    setSheetIdx(0);
    setFileName('');
    setResult(null);
    setProgress(0);
  };

  const close = () => {
    if (step === 'importing') return;
    reset();
    onClose();
  };

  const applySheet = (data: SheetData[], idx: number) => {
    const rows = data[idx]?.rows ?? [];
    try {
      const g = guessColumnMapping(rows);
      setHeaderRow(g.headerRow);
      setMapping(g.mapping);
    } catch {
      setHeaderRow(0);
      setMapping({ description: 0 });
    }
  };

  const onFile = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setReading(true);
    try {
      const data = (await readSpreadsheet(f, f.name)).filter((s) => s.rows.length > 0);
      if (!data.length) throw new Error('El archivo no tiene filas con datos.');
      const best = data.reduce((bi, s, i) => (s.rows.length > data[bi].rows.length ? i : bi), 0);
      setSheets(data);
      setSheetIdx(best);
      applySheet(data, best);
      setFileName(f.name);
      setStep('map');
    } catch (e) {
      toast.error('No se pudo leer el archivo', errorMessage(e));
    } finally {
      setReading(false);
    }
  };

  const rows: Cell[][] = useMemo(() => sheets[sheetIdx]?.rows ?? [], [sheets, sheetIdx]);
  const width = useMemo(() => rows.slice(0, 50).reduce((m, r) => Math.max(m, r.length), 0), [rows]);
  const priceRows = useMemo(() => {
    try {
      return parsePriceRows(rows, mapping, headerRow, parseNumberEs);
    } catch {
      return [];
    }
  }, [rows, mapping, headerRow]);
  const deferredRows = useDeferredValue(priceRows);
  const plan: ImportPlan = useMemo(() => planPriceImport(deferredRows, products, createMissing), [deferredRows, products, createMissing]);
  const hasPrice = mapping.unitPrice != null || mapping.total != null;

  const colLabel = (i: number) => {
    const head = rows[headerRow]?.[i];
    const text = head == null || head === '' ? '' : String(head).slice(0, 28);
    return `${columnLetter(i)}${text ? ` · ${text}` : ''}`;
  };

  const runImport = async () => {
    setStep('importing');
    setProgress(0);
    const res: Result = { updated: 0, created: 0, failed: 0 };
    const todo = plan.rows.filter((r) => r.action !== 'skip');
    const supplierIds = new Map<string, ID>();
    const createdIds = new Map<string, ID>();
    const supplierFor = async (name: string | undefined): Promise<ID | undefined> => {
      const n = name?.trim();
      if (!n) return undefined;
      const key = foldText(n);
      const cached = supplierIds.get(key);
      if (cached) return cached;
      const s = await findOrCreateSupplier(n);
      supplierIds.set(key, s.id);
      return s.id;
    };
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      try {
        const supplierId = await supplierFor(r.row.supplier ?? supplierName);
        const opts = { date, supplierId, rawDescription: r.row.description };
        const price = r.pricePerBase ?? 0;
        if (r.action === 'update' && r.product) {
          await setProductPrice(r.product.id, price, 'hoja', opts);
          if (foldText(r.row.description) !== foldText(r.product.name)) await addProductAlias(r.product.id, r.row.description);
          res.updated++;
        } else {
          const key = foldText(r.name);
          let id = createdIds.get(key);
          if (!id) {
            const p = await createProduct({
              name: r.name,
              baseUnit: r.baseUnit,
              supplierId,
              aliases: foldText(r.row.description) !== key ? [r.row.description] : [],
            });
            id = p.id;
            createdIds.set(key, id);
            res.created++;
          } else res.updated++;
          await setProductPrice(id, price, 'hoja', opts);
        }
      } catch {
        res.failed++;
      }
      setProgress((i + 1) / todo.length);
    }
    setResult(res);
    setStep('done');
    if (res.failed) toast.error(`${res.failed} filas no se pudieron importar`);
    else toast.success('Tarifa importada', `${res.updated} precios actualizados · ${res.created} ingredientes nuevos`);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size={step === 'map' ? 'xl' : 'md'}
      title="Importar tarifa o listado de precios"
      subtitle={step === 'map' ? fileName : 'Excel (.xlsx) o CSV con una fila por producto'}
      footer={
        step === 'map' ? (
          <>
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={reset}>
              Otro archivo
            </Button>
            <Button variant="primary" onClick={() => void runImport()} disabled={!hasPrice || plan.updates + plan.creates === 0}>
              Importar {fmtNum(plan.updates + plan.creates, 0)} {plan.updates + plan.creates === 1 ? 'precio' : 'precios'}
            </Button>
          </>
        ) : step === 'done' ? (
          <Button variant="primary" onClick={close}>
            Ver ingredientes
          </Button>
        ) : undefined
      }
    >
      {step === 'pick' && (
        <div className="space-y-4">
          {reading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-14 text-sm text-muted">
              <Spinner className="size-7" /> Leyendo el archivo…
            </div>
          ) : (
            <FileDrop
              accept=".xlsx,.xlsm,.csv,.tsv,.txt"
              multiple={false}
              onFiles={(f) => void onFile(f)}
              icon={<FileSpreadsheet className="size-7" />}
              title="Arrastra aquí tu tarifa"
              description="La tarifa que te manda el proveedor o tu propio listado. Detectamos solos las columnas de producto, unidad y precio."
            />
          )}
          <Callout tone="info" icon={<Info className="size-4" />}>
            Los precios se guardan sin IVA. Si tu hoja tiene varias facturas (proveedor, nº y fecha por fila), súbela mejor en Facturas.
          </Callout>
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {sheets.length > 1 && (
              <Field label="Hoja">
                <Select
                  value={sheetIdx}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    setSheetIdx(i);
                    applySheet(sheets, i);
                  }}
                >
                  {sheets.map((s, i) => (
                    <option key={i} value={i}>
                      {s.name} ({s.rows.length} filas)
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Fila de cabecera" hint="La fila con los títulos de las columnas">
              <Select value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
                {rows.slice(0, 25).map((r, i) => (
                  <option key={i} value={i}>
                    Fila {i + 1}:{' '}
                    {r
                      .filter((c) => c != null && c !== '')
                      .slice(0, 4)
                      .map((c) => String(c).slice(0, 14))
                      .join(' · ') || '(vacía)'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha de los precios">
              <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
            {mapping.supplier == null && (
              <Field label="Proveedor (opcional)">
                <Input
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  list={supplierList}
                  placeholder="Ej.: Makro"
                />
                <datalist id={supplierList}>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.name} />
                  ))}
                </datalist>
              </Field>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">¿Qué hay en cada columna?</h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {MAPPING_FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint}>
                  <Select
                    value={mapping[f.key] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? undefined : Number(e.target.value);
                      setMapping((m) => ({ ...m, [f.key]: f.key === 'description' ? (v ?? 0) : v }));
                    }}
                  >
                    {!f.required && <option value="">— No usar —</option>}
                    {Array.from({ length: width }, (_, i) => (
                      <option key={i} value={i}>
                        {colLabel(i)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
            {!hasPrice && <p className="mt-2 text-sm font-semibold text-bad">Indica la columna de precio unitario o de importe.</p>}
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="ok">{fmtNum(plan.updates, 0)} actualizan precio</Badge>
              <Badge tone="brand">{fmtNum(plan.creates, 0)} ingredientes nuevos</Badge>
              {plan.skips > 0 && <Badge>{fmtNum(plan.skips, 0)} omitidas</Badge>}
            </div>
            <div className="sm:max-w-xs">
              <Switch
                checked={createMissing}
                onChange={setCreateMissing}
                label="Crear los que no tengas"
                description="Si lo desactivas, sólo se actualizan tus ingredientes."
              />
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
              Vista previa {plan.rows.length > 10 ? `(10 de ${fmtNum(plan.rows.length, 0)} filas)` : ''}
            </h3>
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="tabular w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="bg-surface-2 text-left text-[11px] font-bold uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">Producto en la hoja</th>
                    <th className="px-3 py-2 text-right">Precio</th>
                    <th className="px-3 py-2 text-right">Precio real</th>
                    <th className="px-3 py-2">Qué haremos</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.slice(0, 10).map((r) => (
                    <tr key={r.row.rowIndex} className="border-t border-line">
                      <td className="max-w-[260px] px-3 py-2">
                        <div className="truncate font-medium text-ink">{r.row.description}</div>
                        {r.row.code && <div className="text-[11px] text-muted">{r.row.code}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-ink-2">
                        {fmtEurPrecise(r.row.unitPrice)} <span className="text-xs text-muted">/{r.row.unit}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-ink">
                        {r.pricePerBase ? (
                          <>
                            {fmtEurPrecise(r.pricePerBase)} <span className="text-xs font-normal text-muted">/{r.baseUnit}</span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.action === 'update' && r.product && (
                          <Badge tone="ok" className="max-w-[220px]">
                            <span className="truncate">Actualiza «{r.product.name}»</span>
                          </Badge>
                        )}
                        {r.action === 'create' && (
                          <div className="flex flex-col items-start gap-0.5">
                            <Badge tone="brand" className="max-w-[220px]">
                              <span className="truncate">Nuevo: {r.name}</span>
                            </Badge>
                            {r.product && r.score != null && <span className="text-[11px] text-muted">Parecido a «{r.product.name}»</span>}
                          </div>
                        )}
                        {r.action === 'skip' && <span className="text-xs text-muted">Omitida · {r.reason}</span>}
                      </td>
                    </tr>
                  ))}
                  {plan.rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted">
                        No hay filas con producto y precio. Revisa la fila de cabecera y las columnas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              Si un nombre no encaja del todo con tus ingredientes creamos uno nuevo en vez de arriesgar un precio equivocado. Luego puedes
              fusionar duplicados.
            </p>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="py-10 text-center">
          <Spinner className="mx-auto size-8" />
          <div className="mt-4 font-display text-lg font-bold text-ink">Importando precios…</div>
          <ProgressBar value={progress} className="mx-auto mt-4 max-w-xs" />
          <div className="tabular mt-2 text-xs font-semibold text-muted">{Math.round(progress * 100)} %</div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="py-6 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-ok text-white">
            <CheckCircle2 className="size-7" />
          </div>
          <div className="mt-4 font-display text-xl font-extrabold text-ink">Tarifa importada</div>
          <div className="mx-auto mt-5 grid max-w-sm grid-cols-2 gap-2">
            <div className="rounded-2xl border border-line bg-surface p-3">
              <div className="font-display text-3xl font-extrabold text-ink">{fmtNum(result.updated, 0)}</div>
              <div className="text-xs font-semibold text-muted">precios actualizados</div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-3">
              <div className="font-display text-3xl font-extrabold text-gradient-brand">{fmtNum(result.created, 0)}</div>
              <div className="text-xs font-semibold text-muted">ingredientes nuevos</div>
            </div>
          </div>
          {result.failed > 0 && (
            <p className={clsx('mt-4 text-sm font-semibold text-bad')}>{result.failed} filas no se pudieron importar.</p>
          )}
          <p className="mx-auto mt-4 max-w-sm text-sm text-muted">
            Hemos rellenado mermas y alérgenos típicos de los ingredientes nuevos. Tus escandallos ya usan los precios nuevos.
          </p>
        </div>
      )}
    </Modal>
  );
}
