import type { BaseUnit, ExtractedInvoice, ID, Invoice, InvoiceLine, Product, ProgressInfo } from '../types';
import { db, getAppSettings, getCurrentWorkspaceId, metaDb, workspaceDb, type WorkspaceDB } from '../db';
import { AUTO_LINK_THRESHOLD, SUGGEST_THRESHOLD, cleanProductName, rankMatches, toSearchKey } from '../core/matching';
import { normalizeInvoiceLine } from '../core/pack';
import { aiAvailable, extractInvoicesFromFile, fileKind } from '../extract/index';
import { nowIso, todayIso, uid } from '../lib/id';
import {
  addProductAliasIn,
  buildProduct,
  findOrCreateSupplierIn,
  insertProductIn,
  loadKbFinder,
  matchSupplier,
  priceConversionFactor,
  recomputeCurrentPrice,
  setProductPriceIn,
  supplierKey,
} from './products';

/**
 * Flujo de facturas: subir → procesar (extraer + emparejar) → revisar → confirmar (actualiza precios).
 *
 * La lectura es gratuita y se hace en el dispositivo (texto del PDF, OCR, hojas de cálculo); la IA sólo se usa si el
 * usuario la ha activado con su clave. Como el OCR es pesado, las facturas se leen de una en una en una cola en memoria.
 */

export { recomputeCurrentPrice };

// ───────────────────────────── Utilidades ─────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Prefijos de los avisos que añade la confirmación (se sustituyen al volver a confirmar). */
const CONFIRM_WARNING_PREFIXES = ['No se ha actualizado el precio', 'Precio convertido de'];
const MISSING_DATE_WARNING = 'No se ha detectado la fecha de la factura: revísala antes de confirmar';
const NO_LINES_WARNING = 'No se han encontrado líneas de producto: añádelas a mano o vuelve a leer la factura';

const UNIT_LABEL: Record<BaseUnit, string> = { kg: 'kg', l: 'litros', ud: 'unidades' };

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function uniq(list: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const s of list) if (s && s.trim() && !out.includes(s)) out.push(s);
  return out;
}

function cleanStr(s: string | undefined | null): string | undefined {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t || undefined;
}

function safeCleanName(description: string): string | undefined {
  try {
    return cleanProductName(description) || undefined;
  } catch {
    return undefined;
  }
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (typeof err === 'string' && err.trim()) return err.trim();
  return fallback;
}

function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError';
}

function isAIError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AIError';
}

/** Normaliza (unidad base y €/ud base) una línea que aún no lo está. Nunca lanza. */
function ensureNormalized(line: InvoiceLine): InvoiceLine {
  if (line.baseUnit && line.pricePerBase !== undefined) return line;
  try {
    return normalizeInvoiceLine(line);
  } catch {
    return line;
  }
}

/** Línea extraída → línea de factura con id, estado y nombre sugerido. */
function prepareLine(raw: ExtractedInvoice['lines'][number]): InvoiceLine {
  const { productId: _pid, matchScore: _score, ...rest } = raw;
  const num = (v: unknown, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  let line: InvoiceLine = {
    ...rest,
    id: uid(),
    description: (raw.description ?? '').replace(/\s+/g, ' ').trim(),
    unit: (raw.unit ?? '').trim() || 'ud',
    quantity: num(raw.quantity),
    unitPrice: num(raw.unitPrice),
    total: num(raw.total),
    matchStatus: 'nuevo',
  };
  line = ensureNormalized(line);
  if (!line.suggestedName) {
    const name = safeCleanName(line.description);
    if (name) line.suggestedName = name;
  }
  return line;
}

// ───────────────────────────── Emparejamiento ─────────────────────────────

function unitCompatible(product: Product, unit: BaseUnit | undefined): boolean {
  if (!unit || product.baseUnit === unit) return true;
  return !!priceConversionFactor(unit, product.baseUnit, product);
}

/** Mejor producto para una línea (nombre sugerido y descripción original; desempata por unidad y proveedor). */
function bestProductFor(line: InvoiceLine, products: Product[], supplierId?: ID): { product: Product; score: number } | undefined {
  const queries = uniq([cleanStr(line.suggestedName), cleanStr(line.description)]);
  if (!queries.length || !products.length) return undefined;
  const scores = new Map<ID, { product: Product; score: number }>();
  for (const q of queries) {
    for (const c of rankMatches(q, products, 6, SUGGEST_THRESHOLD - 0.05)) {
      const prev = scores.get(c.item.id);
      if (!prev || c.score > prev.score) scores.set(c.item.id, { product: c.item, score: c.score });
    }
  }
  let best: { product: Product; score: number; rank: number } | undefined;
  for (const s of scores.values()) {
    // Desempate suave: unidad compatible (+0,02) y mismo proveedor (+0,01). La puntuación guardada es la real.
    const rank = s.score + (unitCompatible(s.product, line.baseUnit) ? 0.02 : 0) + (supplierId && s.product.supplierId === supplierId ? 0.01 : 0);
    if (!best || rank > best.rank) best = { ...s, rank };
  }
  return best && { product: best.product, score: best.score };
}

/**
 * Empareja líneas con productos existentes (core/matching.rankMatches sobre nombre + alias, usando suggestedName y description).
 * score ≥ AUTO_LINK → 'vinculado'; ≥ SUGGEST → 'sugerido'; si no → 'nuevo'. No toca líneas 'ignorado' ni ya 'vinculado' manualmente.
 * `opts.supplierId` (opcional) desempata a favor de productos de ese proveedor.
 */
export function matchInvoiceLines(lines: InvoiceLine[], products: Product[], opts: { supplierId?: ID } = {}): InvoiceLine[] {
  const ids = new Set(products.map((p) => p.id));
  return lines.map((line) => {
    if (line.matchStatus === 'ignorado') return line;
    if (line.matchStatus === 'vinculado' && line.productId && ids.has(line.productId)) return line;
    const { productId: _pid, matchScore: _score, ...rest } = line;
    const best = bestProductFor(line, products, opts.supplierId);
    if (!best || best.score < SUGGEST_THRESHOLD) return { ...rest, matchStatus: 'nuevo' };
    return {
      ...rest,
      productId: best.product.id,
      matchScore: Math.round(best.score * 1000) / 1000,
      matchStatus: best.score >= AUTO_LINK_THRESHOLD ? 'vinculado' : 'sugerido',
    };
  });
}

// ───────────────────────────── Cola de lectura ─────────────────────────────

/** Estado de la cola de procesado (para mostrar progreso en la UI). Suscribible. */
export interface QueueState {
  running: ID | null;
  queued: ID[];
  stage?: string;
  progress?: number;
}

interface Waiter {
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface Job {
  wsId: string;
  id: ID;
  forceLocal: boolean;
  /** Sólo procesar si la factura sigue pendiente (altas y reanudaciones); las relecturas explícitas siempre se procesan. */
  onlyIfPending: boolean;
  waiters: Waiter[];
}

const jobs: Job[] = [];
let current: Job | null = null;
let currentStage: string | undefined;
let currentProgress: number | undefined;
const listeners = new Set<(s: QueueState) => void>();
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let lastEmit = 0;
const EMIT_INTERVAL_MS = 100;

function snapshot(): QueueState {
  const ws = getCurrentWorkspaceId();
  const visible = (j: Job) => !ws || j.wsId === ws;
  const running = current && visible(current) ? current : null;
  const state: QueueState = { running: running?.id ?? null, queued: jobs.filter(visible).map((j) => j.id) };
  if (running) {
    if (currentStage) state.stage = currentStage;
    if (currentProgress !== undefined) state.progress = currentProgress;
  }
  return state;
}

function emitNow(): void {
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
  lastEmit = Date.now();
  const s = snapshot();
  for (const fn of [...listeners]) {
    try {
      fn(s);
    } catch {
      // Un suscriptor que falla no debe parar la cola.
    }
  }
}

/** Emite con límite de frecuencia (el OCR informa de progreso muchas veces por segundo). */
function emitThrottled(): void {
  const wait = EMIT_INTERVAL_MS - (Date.now() - lastEmit);
  if (wait <= 0) emitNow();
  else emitTimer ??= setTimeout(emitNow, wait);
}

/**
 * Suscribe `fn` al estado de la cola del espacio activo: se llama al momento con el estado actual y después con cada
 * cambio (el progreso del OCR se limita a ~10 avisos por segundo). Devuelve la función para cancelar la suscripción.
 */
export function subscribeInvoiceQueue(fn: (s: QueueState) => void): () => void {
  listeners.add(fn);
  fn(snapshot());
  return () => {
    listeners.delete(fn);
  };
}

function isActive(wsId: string, id: ID): boolean {
  return (current?.wsId === wsId && current.id === id) || jobs.some((j) => j.wsId === wsId && j.id === id);
}

function enqueue(job: Omit<Job, 'waiters'>, opts: { skipIfRunning: boolean }): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject };
    const queued = jobs.find((j) => j.wsId === job.wsId && j.id === job.id);
    if (queued) {
      if (!job.onlyIfPending) {
        queued.onlyIfPending = false;
        queued.forceLocal = job.forceLocal;
      }
      queued.waiters.push(waiter);
      return;
    }
    if (opts.skipIfRunning && current && current.wsId === job.wsId && current.id === job.id) {
      current.waiters.push(waiter);
      return;
    }
    jobs.push({ ...job, waiters: [waiter] });
    emitNow();
    void runQueue();
  });
}

function dropQueued(wsId: string | null, id: ID): void {
  for (let i = jobs.length - 1; i >= 0; i--) {
    const j = jobs[i];
    if (j.id === id && (!wsId || j.wsId === wsId)) {
      jobs.splice(i, 1);
      j.waiters.forEach((w) => w.resolve());
    }
  }
  emitNow();
}

async function runQueue(): Promise<void> {
  if (current) return;
  while (jobs.length) {
    const job = jobs.shift() as Job;
    current = job;
    currentStage = 'Preparando la lectura…';
    currentProgress = 0;
    emitNow();
    try {
      await runJob(job);
      job.waiters.forEach((w) => w.resolve());
    } catch (err) {
      job.waiters.forEach((w) => w.reject(err));
    }
  }
  current = null;
  currentStage = undefined;
  currentProgress = undefined;
  emitNow();
}

async function runJob(job: Job): Promise<void> {
  // El espacio puede haberse borrado mientras la factura esperaba.
  if (!(await metaDb.workspaces.get(job.wsId))) return;
  const wdb = workspaceDb(job.wsId);
  if (job.onlyIfPending) {
    const inv = await wdb.invoices.get(job.id);
    if (!inv || (inv.status !== 'pendiente' && inv.status !== 'procesando')) return;
  }
  await processInvoiceIn(wdb, job.id, {
    forceLocal: job.forceLocal,
    onProgress: (p: ProgressInfo) => {
      if (current !== job) return;
      const stageChanged = !!p.stage && p.stage !== currentStage;
      if (p.stage) currentStage = p.stage;
      if (p.progress !== undefined && Number.isFinite(p.progress)) currentProgress = Math.min(1, Math.max(0, p.progress));
      if (stageChanged) emitNow();
      else emitThrottled();
    },
  });
}

/**
 * Vuelve a poner en cola las facturas 'pendiente' o que se quedaron en 'procesando' (p. ej. se cerró la app mientras se
 * leían). Idempotente: no duplica las que ya están en la cola o leyéndose.
 */
export async function resumePendingInvoices(): Promise<void> {
  const wsId = getCurrentWorkspaceId();
  if (!wsId) return;
  const wdb = workspaceDb(wsId);
  const pending = await wdb.invoices.where('status').anyOf('pendiente', 'procesando').toArray();
  pending.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  for (const inv of pending) {
    if (isActive(wsId, inv.id)) continue;
    if (!inv.file) {
      await wdb.invoices.update(inv.id, { status: 'error', error: 'No se ha encontrado el archivo original: introduce la factura a mano' });
      continue;
    }
    void enqueue({ wsId, id: inv.id, forceLocal: false, onlyIfPending: true }, { skipIfRunning: true }).catch(() => undefined);
  }
}

// ───────────────────────────── Alta y lectura ─────────────────────────────

function mimeFromName(name: string): string | undefined {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    txt: 'text/plain',
  };
  return map[ext];
}

/**
 * Crea facturas 'pendiente' con el archivo original y lanza su procesado en segundo plano (secuencial, en cola).
 * Un Excel/CSV con muchas facturas genera varias (al leerlo, la primera ocupa el lugar de la factura provisional).
 * Devuelve los ids creados (al menos uno por archivo).
 */
export async function addInvoiceFiles(files: File[]): Promise<ID[]> {
  const wsId = getCurrentWorkspaceId();
  if (!wsId) throw new Error('No hay espacio de trabajo activo');
  const nonEmpty = (files ?? []).filter((f) => f && f.size > 0);
  if (!nonEmpty.length) throw new Error('Los archivos están vacíos o no se han podido leer');
  const supported = nonEmpty.filter((f) => fileKind(f) !== 'unknown');
  if (!supported.length) throw new Error('Formato no admitido: sube facturas en PDF, fotos (JPG, PNG…) o Excel/CSV');
  const now = nowIso();
  const invoices: Invoice[] = supported.map((f) => {
    const inv: Invoice = {
      id: uid(),
      supplierName: '',
      date: todayIso(),
      fileName: f.name,
      file: f,
      status: 'pendiente',
      lines: [],
      createdAt: now,
    };
    const type = f.type || mimeFromName(f.name);
    if (type) inv.fileType = type;
    return inv;
  });
  await db().invoices.bulkAdd(invoices);
  for (const inv of invoices) void enqueue({ wsId, id: inv.id, forceLocal: false, onlyIfPending: true }, { skipIfRunning: true }).catch(() => undefined);
  return invoices.map((i) => i.id);
}

/**
 * Procesa una factura: status 'procesando' → extracción (extract/index) → líneas emparejadas con productos
 * (matchInvoiceLines) → status 'revision'. En error: status 'error' y mensaje legible.
 * `forceLocal` obliga a no usar IA. Pasa por la cola (una lectura a la vez) y se resuelve al terminar.
 * Si la factura estaba confirmada, al empezar a leerla se retiran sus precios del histórico (hay que volver a confirmarla).
 */
export async function processInvoice(id: ID, opts?: { forceLocal?: boolean }): Promise<void> {
  const wsId = getCurrentWorkspaceId();
  if (!wsId) throw new Error('No hay espacio de trabajo activo');
  const wdb = workspaceDb(wsId);
  const inv = await wdb.invoices.get(id);
  if (!inv) throw new Error('La factura ya no existe');
  if (!inv.file) throw new Error('Esta factura no tiene archivo original: introdúcela a mano');
  if (inv.status !== 'procesando') await wdb.invoices.update(id, { status: 'pendiente', error: undefined });
  return enqueue({ wsId, id, forceLocal: !!opts?.forceLocal, onlyIfPending: false }, { skipIfRunning: false });
}

/** Archivo con nombre (el extractor decide el tipo por MIME y extensión). */
function namedFile(inv: Invoice): Blob & { name?: string } {
  const blob = inv.file as Blob;
  const existing = (blob as { name?: unknown }).name;
  if (typeof existing === 'string' && existing) return blob;
  const type = inv.fileType || blob.type || '';
  const name = inv.fileName || 'factura';
  if (typeof File !== 'undefined') return new File([blob], name, { type });
  return Object.assign(blob.slice(0, blob.size, type), { name });
}

function normNumber(n: string | undefined): string {
  return (n ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '');
}

function sameAmount(a: number | undefined, b: number | undefined): boolean {
  return a !== undefined && b !== undefined && Math.abs(a - b) <= 0.02;
}

/** En una relectura, la factura del archivo que corresponde a esta (por número, o por proveedor + fecha + total). */
function pickExtracted(inv: Invoice, list: ExtractedInvoice[]): ExtractedInvoice | undefined {
  if (list.length === 1) return list[0];
  const num = normNumber(inv.number);
  if (num) {
    const byNumber = list.filter((e) => normNumber(e.number) === num);
    if (byNumber.length === 1) return byNumber[0];
    const refined = byNumber.find((e) => !inv.supplierName || supplierKey(e.supplierName ?? '') === supplierKey(inv.supplierName));
    if (refined) return refined;
  }
  return list.find(
    (e) => e.date === inv.date && sameAmount(e.total, inv.total) && supplierKey(e.supplierName ?? '') === supplierKey(inv.supplierName ?? ''),
  );
}

/** Aplica una extracción a una factura: cabecera, líneas emparejadas, avisos y estado 'revision'. */
function applyExtraction(base: Invoice, ex: ExtractedInvoice, products: Product[], suppliers: Parameters<typeof matchSupplier>[0], extraWarnings: string[]): Invoice {
  const supplierName = cleanStr(ex.supplierName) ?? base.supplierName ?? '';
  const supplierTaxId = cleanStr(ex.supplierTaxId) ?? base.supplierTaxId;
  const supplier = matchSupplier(suppliers, supplierName, supplierTaxId);
  const lines = matchInvoiceLines((ex.lines ?? []).map(prepareLine), products, { supplierId: supplier?.id });
  const date = ex.date && ISO_DATE.test(ex.date) ? ex.date : base.date && ISO_DATE.test(base.date) ? base.date : todayIso();
  const warnings = uniq([
    ...(ex.warnings ?? []),
    ...extraWarnings,
    ex.date && ISO_DATE.test(ex.date) ? undefined : MISSING_DATE_WARNING,
    lines.length ? undefined : NO_LINES_WARNING,
  ]);
  const next: Invoice = {
    ...base,
    supplierName,
    supplierTaxId,
    supplierId: supplier?.id,
    number: cleanStr(ex.number) ?? base.number,
    date,
    subtotal: ex.subtotal ?? base.subtotal,
    vatTotal: ex.vatTotal ?? base.vatTotal,
    total: ex.total ?? base.total,
    lines,
    method: ex.method,
    rawText: ex.rawText,
    warnings,
    status: 'revision',
    error: undefined,
  };
  return next;
}

/** Límite total para guardar el mismo archivo en cada factura de un Excel con muchas (si no, sólo en la primera). */
const SHARED_FILE_BUDGET = 8 * 1024 * 1024;

async function processInvoiceIn(wdb: WorkspaceDB, id: ID, opts: { forceLocal?: boolean; onProgress?: (p: ProgressInfo) => void }): Promise<void> {
  const inv = await wdb.invoices.get(id);
  if (!inv) throw new Error('La factura ya no existe');
  if (!inv.file) throw new Error('Esta factura no tiene archivo original: introdúcela a mano');
  await wdb.transaction('rw', [wdb.invoices, wdb.pricePoints, wdb.products], async () => {
    await wdb.invoices.update(id, { status: 'procesando', error: undefined, confirmedAt: undefined });
    // Una factura confirmada que se vuelve a leer deja de estarlo: sus precios salen del histórico hasta que se confirme de nuevo.
    await retractInvoicePricesIn(wdb, id);
  });
  try {
    const settings = await getAppSettings();
    const file = namedFile(inv);
    const forceLocal = !!opts.forceLocal;
    const extraWarnings: string[] = [];
    let extracted: ExtractedInvoice[];
    try {
      extracted = await extractInvoicesFromFile(file, { settings, onProgress: opts.onProgress, forceLocal });
    } catch (err) {
      // Red de seguridad: si la IA opcional falla, se lee gratis en el dispositivo.
      if (isAbortError(err) || forceLocal || !aiAvailable(settings) || !isAIError(err)) throw err;
      extraWarnings.push(`La IA no ha podido leer la factura (${errorText(err, 'error desconocido')}): se ha leído gratis en tu dispositivo`);
      extracted = await extractInvoicesFromFile(file, { settings, onProgress: opts.onProgress, forceLocal: true });
    }
    extracted = (extracted ?? []).filter(Boolean);
    if (!extracted.length) throw new Error('No se ha encontrado ninguna factura en el archivo');

    const firstRun = !inv.method;
    const target = firstRun ? extracted[0] : pickExtracted(inv, extracted);
    if (!target) throw new Error('No se ha encontrado esta factura dentro del archivo: revísala a mano');
    const siblings = firstRun ? extracted.slice(1) : [];

    const [products, suppliers] = await Promise.all([wdb.products.toArray(), wdb.suppliers.toArray()]);
    const shareFile = siblings.length > 0 && (inv.file.size || 0) * (siblings.length + 1) <= SHARED_FILE_BUDGET;
    await wdb.transaction('rw', wdb.invoices, async () => {
      const fresh = await wdb.invoices.get(id);
      if (!fresh) return; // Borrada mientras se leía.
      await wdb.invoices.put(applyExtraction(fresh, target, products, suppliers, extraWarnings));
      if (!siblings.length) return;
      const created = nowIso();
      const others = siblings.map((ex) => {
        const base: Invoice = {
          id: uid(),
          supplierName: '',
          date: fresh.date,
          status: 'revision',
          lines: [],
          createdAt: created,
        };
        if (fresh.fileName) base.fileName = fresh.fileName;
        if (fresh.fileType) base.fileType = fresh.fileType;
        if (shareFile) base.file = fresh.file;
        return applyExtraction(base, ex, products, suppliers, extraWarnings);
      });
      await wdb.invoices.bulkAdd(others);
    });
  } catch (err) {
    const message = isAbortError(err) ? 'Lectura cancelada' : errorText(err, 'No se ha podido leer el archivo');
    await wdb.invoices.update(id, { status: 'error', error: message });
    throw err;
  }
}

// ───────────────────────────── Revisión ─────────────────────────────

const PRICE_FIELDS: (keyof InvoiceLine)[] = ['description', 'quantity', 'unit', 'unitPrice', 'discountPct', 'total', 'packSize'];

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/** Limpia y re-normaliza una línea editada (sólo si cambió algo que afecte al precio). */
function sanitizeLine(line: InvoiceLine, previous: InvoiceLine | undefined): InvoiceLine {
  let next: InvoiceLine = { ...line, id: line.id || uid(), description: line.description ?? '', matchStatus: line.matchStatus ?? 'nuevo' };
  if (next.matchStatus !== 'ignorado' && next.matchStatus !== 'nuevo' && !next.productId) next.matchStatus = 'nuevo';
  if (next.matchStatus === 'nuevo' && next.productId) {
    const { productId: _pid, matchScore: _score, ...rest } = next;
    next = rest as InvoiceLine;
  }
  const changed = !previous || PRICE_FIELDS.some((k) => !sameValue(previous[k], next[k])) || next.pricePerBase === undefined;
  if (changed) {
    try {
      next = normalizeInvoiceLine(next);
    } catch {
      // Se guarda tal cual: la revisión mostrará que falta el precio por unidad base.
    }
  }
  return next;
}

/** Guarda cambios de la revisión (cabecera y/o líneas). Re-normaliza las líneas modificadas (core/pack). */
export async function updateInvoice(id: ID, patch: Partial<Invoice>): Promise<void> {
  const wdb = db();
  await wdb.transaction('rw', wdb.invoices, wdb.suppliers, async () => {
    const inv = await wdb.invoices.get(id);
    if (!inv) throw new Error('La factura ya no existe');
    const next: Partial<Invoice> = { ...patch };
    delete next.id;
    delete next.createdAt;
    if (patch.lines) {
      const prev = new Map(inv.lines.map((l) => [l.id, l]));
      next.lines = patch.lines.map((l) => sanitizeLine(l, l.id ? prev.get(l.id) : undefined));
    }
    if ('supplierName' in patch) next.supplierName = (patch.supplierName ?? '').replace(/\s+/g, ' ').trim();
    if ('supplierTaxId' in patch) next.supplierTaxId = cleanStr(patch.supplierTaxId);
    const nameChanged = 'supplierName' in patch && next.supplierName !== inv.supplierName;
    const taxChanged = 'supplierTaxId' in patch && next.supplierTaxId !== inv.supplierTaxId;
    if ((nameChanged || taxChanged) && !('supplierId' in patch)) {
      const suppliers = await wdb.suppliers.toArray();
      next.supplierId = matchSupplier(suppliers, next.supplierName ?? inv.supplierName, next.supplierTaxId ?? inv.supplierTaxId)?.id;
    }
    await wdb.invoices.update(id, next);
  });
}

/**
 * Confirma la factura: proveedor (findOrCreateSupplier); por cada línea no ignorada con pricePerBase > 0:
 * 'nuevo' → crea producto (nombre = suggestedName, categoría sugerida) ; 'sugerido'/'vinculado' → usa productId.
 * Registra precio (setProductPrice con fecha de factura) y aprende alias (descripción original).
 * Marca status 'confirmada'. Idempotente: re-confirmar no duplica PricePoints de la misma factura.
 * Si la unidad de la línea no coincide con la del producto se convierte (densidad, peso por unidad); si no se puede,
 * la línea se omite con un aviso. `skipped` cuenta las líneas ignoradas, sin precio o con unidad incompatible.
 */
export async function confirmInvoice(id: ID): Promise<{ created: number; updated: number; skipped: number }> {
  const wdb = db();
  const kbFind = await loadKbFinder();
  return wdb.transaction('rw', [wdb.invoices, wdb.products, wdb.pricePoints, wdb.suppliers], async () => {
    const inv = await wdb.invoices.get(id);
    if (!inv) throw new Error('La factura ya no existe');
    if (inv.status === 'pendiente' || inv.status === 'procesando') throw new Error('La factura aún se está leyendo: espera a que termine');
    const date = inv.date && ISO_DATE.test(inv.date) ? inv.date : todayIso();

    let supplierId: ID | undefined;
    if (cleanStr(inv.supplierName) || cleanStr(inv.supplierTaxId)) {
      supplierId = (await findOrCreateSupplierIn(wdb, inv.supplierName ?? '', cleanStr(inv.supplierTaxId))).id;
    }

    // Idempotencia: fuera los precios que esta factura registró en una confirmación anterior.
    const previous = await wdb.pricePoints.where('invoiceId').equals(id).toArray();
    const touched = new Set<ID>(previous.map((p) => p.productId));
    if (previous.length) await wdb.pricePoints.bulkDelete(previous.map((p) => p.id));

    const products = await wdb.products.toArray();
    const byId = new Map<ID, Product>(products.map((p) => [p.id, p]));
    const byKey = new Map<string, Product>();
    for (const p of products) if (p.searchKey && !byKey.has(p.searchKey)) byKey.set(p.searchKey, p);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const lines: InvoiceLine[] = [];

    for (const raw of inv.lines) {
      const line = ensureNormalized(raw);
      const warnings = (line.warnings ?? []).filter((w) => !CONFIRM_WARNING_PREFIXES.some((p) => w.startsWith(p)));
      const price = line.pricePerBase;
      const hasPrice = typeof price === 'number' && Number.isFinite(price) && price > 0 && !!line.baseUnit;
      if (line.matchStatus === 'ignorado' || !hasPrice || line.quantity < 0) {
        skipped++;
        lines.push({ ...line, warnings });
        continue;
      }
      const lineUnit = line.baseUnit as BaseUnit;
      const description = line.description.trim();
      let product = line.productId && line.matchStatus !== 'nuevo' ? byId.get(line.productId) : undefined;

      if (!product) {
        const name = cleanStr(line.suggestedName) ?? safeCleanName(description) ?? description;
        if (!name) {
          skipped++;
          lines.push({ ...line, warnings });
          continue;
        }
        const key = toSearchKey(name);
        const existing = key ? byKey.get(key) : undefined;
        if (existing) product = existing;
        else {
          const p = buildProduct(
            {
              name,
              category: line.suggestedCategory,
              baseUnit: lineUnit,
              pricePerBase: round6(price),
              supplierId,
              lastPurchaseDate: date,
              priceSource: 'factura',
              aliases: [description],
            },
            kbFind,
            { date, invoiceId: id, rawDescription: description },
          );
          await insertProductIn(wdb, p, { date, invoiceId: id, rawDescription: description });
          byId.set(p.id, p);
          if (p.searchKey) byKey.set(p.searchKey, p);
          touched.add(p.id);
          created++;
          lines.push({ ...line, warnings, productId: p.id, matchScore: 1, matchStatus: 'vinculado' });
          continue;
        }
      }

      const conv = priceConversionFactor(lineUnit, product.baseUnit, product);
      if (!conv) {
        const missing = lineUnit === 'ud' || product.baseUnit === 'ud' ? 'falta el peso por unidad' : 'no se pueden convertir';
        warnings.push(
          `No se ha actualizado el precio: la línea está en ${UNIT_LABEL[lineUnit]} y «${product.name}» se compra en ${UNIT_LABEL[product.baseUnit]} (${missing})`,
        );
        skipped++;
        lines.push({ ...line, warnings, productId: product.id, matchStatus: 'vinculado' });
        continue;
      }
      if (conv.assumption) warnings.push(`Precio convertido de €/${lineUnit} a €/${product.baseUnit}: ${conv.assumption.charAt(0).toLowerCase()}${conv.assumption.slice(1)}`);
      await setProductPriceIn(wdb, product.id, round6(price * conv.factor), 'factura', { date, supplierId, invoiceId: id, rawDescription: description });
      await addProductAliasIn(wdb, product.id, description);
      if (line.suggestedName) await addProductAliasIn(wdb, product.id, line.suggestedName);
      touched.add(product.id);
      updated++;
      lines.push({ ...line, warnings, productId: product.id, matchStatus: 'vinculado' });
    }

    for (const pid of touched) await recomputeCurrentPrice(pid, wdb);

    const patch: Partial<Invoice> = { status: 'confirmada', confirmedAt: nowIso(), date, lines, error: undefined };
    if (supplierId) patch.supplierId = supplierId;
    await wdb.invoices.update(id, patch);
    return { created, updated, skipped };
  });
}

/** Crea una factura vacía para introducir a mano. */
export async function createManualInvoice(): Promise<ID> {
  const inv: Invoice = {
    id: uid(),
    supplierName: '',
    date: todayIso(),
    status: 'revision',
    method: 'manual',
    lines: [],
    createdAt: nowIso(),
  };
  await db().invoices.add(inv);
  return inv.id;
}

/**
 * Retira del histórico los precios que aportó una factura y recalcula el precio vigente de sus productos
 * (dentro de una transacción ya abierta sobre invoices/pricePoints/products). Devuelve cuántos precios retira.
 */
async function retractInvoicePricesIn(wdb: WorkspaceDB, id: ID): Promise<number> {
  const points = await wdb.pricePoints.where('invoiceId').equals(id).toArray();
  if (!points.length) return 0;
  await wdb.pricePoints.bulkDelete(points.map((p) => p.id));
  for (const pid of new Set(points.map((p) => p.productId))) await recomputeCurrentPrice(pid, wdb);
  return points.length;
}

/** Borra la factura. Si estaba confirmada, elimina sus PricePoints y recalcula el precio vigente de los productos afectados. */
export async function deleteInvoice(id: ID): Promise<void> {
  const wdb = db();
  dropQueued(getCurrentWorkspaceId(), id);
  await wdb.transaction('rw', [wdb.invoices, wdb.pricePoints, wdb.products], async () => {
    await wdb.invoices.delete(id);
    await retractInvoicePricesIn(wdb, id);
  });
}

/** Línea vacía lista para añadir en la revisión. */
export function newInvoiceLine(partial?: Partial<InvoiceLine>): InvoiceLine {
  return {
    description: '',
    quantity: 1,
    unit: 'ud',
    unitPrice: 0,
    total: 0,
    matchStatus: 'nuevo',
    ...partial,
    id: partial?.id || uid(),
  };
}
