import type { Dish, ExtractedMenu, ID, MenuEntry, MenuScan, ProgressInfo } from '../types';
import { db, getAppSettings, getBusinessSettings, getCurrentWorkspaceId, metaDb, workspaceDb, type WorkspaceDB } from '../db';
import { normalizeText } from '../core/matching';
import { extractMenuFromFiles, fileKind } from '../extract/index';
import { preprocessImage } from '../extract/ocr';
import { fmtDate } from '../lib/format';
import { nowIso, todayIso, uid } from '../lib/id';
import { proposeForDishes } from './dishes';

/**
 * Cartas: fotos (o PDF) de la carta → platos con PVP → propuesta de escandallo.
 * La lectura es gratuita y local (OCR en el dispositivo); la IA opcional sólo se usa si el usuario la ha activado.
 */

/** MenuScan con avisos de extracción (campo opcional que la revisión muestra si existe). */
type MenuScanRecord = MenuScan & { warnings?: string[] };

// ───────────────────────────── Progreso (opcional para la UI) ─────────────────────────────

export interface MenuScanProgress {
  scanId: ID;
  stage: string;
  progress?: number;
}

const progressListeners = new Set<(p: MenuScanProgress | null) => void>();
let lastProgress: MenuScanProgress | null = null;

function publish(p: MenuScanProgress | null): void {
  lastProgress = p;
  for (const fn of [...progressListeners]) {
    try {
      fn(p);
    } catch {
      // Un suscriptor que falla no interrumpe la lectura.
    }
  }
}

/** Progreso en vivo de la lectura de cartas (null cuando no hay ninguna en curso). */
export function subscribeMenuScanProgress(fn: (p: MenuScanProgress | null) => void): () => void {
  progressListeners.add(fn);
  fn(lastProgress);
  return () => {
    progressListeners.delete(fn);
  };
}

// ───────────────────────────── Utilidades ─────────────────────────────

/** Las cartas se leen de una en una (el OCR es pesado). */
let chain: Promise<unknown> = Promise.resolve();

function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

function cleanStr(s: string | undefined | null): string | undefined {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t || undefined;
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

/** Clave de nombre de plato para evitar duplicados ("Croquetas de jamón" = "CROQUETAS DE JAMON."). */
export function dishNameKey(name: string): string {
  return normalizeText(name);
}

function positivePrice(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : undefined;
}

/** Nombre por defecto de la carta: el del archivo si es uno solo, si no la fecha. */
function defaultScanName(files: File[]): string {
  if (files.length === 1) {
    const base = files[0].name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (base && !/^(?:img|image|photo|foto|dsc|pxl|scan|captura|screenshot|whatsapp)\b/i.test(base)) return base.charAt(0).toUpperCase() + base.slice(1);
  }
  return `Carta del ${fmtDate(todayIso())}`;
}

// ───────────────────────────── Casos de uso ─────────────────────────────

/** Crea un MenuScan con las fotos (preprocesadas) y lanza su lectura. Devuelve el id. */
export async function addMenuScan(files: File[], name?: string): Promise<ID> {
  const wsId = getCurrentWorkspaceId();
  if (!wsId) throw new Error('No hay espacio de trabajo activo');
  const valid = (files ?? []).filter((f) => f && f.size > 0 && (fileKind(f) === 'image' || fileKind(f) === 'pdf'));
  if (!valid.length) throw new Error('Formato no admitido: sube fotos de la carta (JPG, PNG…) o un PDF');
  const images: Blob[] = [];
  for (const f of valid) {
    if (fileKind(f) === 'pdf') {
      images.push(f);
      continue;
    }
    try {
      // Endereza, reduce y comprime: la lectura es más rápida y la BD ocupa menos.
      const processed = await preprocessImage(f, { maxSide: 2000, mime: 'image/jpeg' });
      images.push(processed && processed.size > 0 ? processed : f);
    } catch {
      images.push(f);
    }
  }
  const scan: MenuScanRecord = {
    id: uid(),
    name: cleanStr(name) ?? defaultScanName(valid),
    images,
    status: 'procesando',
    entries: [],
    createdAt: nowIso(),
  };
  await workspaceDb(wsId).menuScans.add(scan);
  // Lectura en segundo plano: los errores quedan registrados en la propia carta.
  void runScan(wsId, scan.id, {}).catch(() => undefined);
  return scan.id;
}

/** Lee la carta (extract/extractMenuFromFiles) → entries con selected=true → status 'revision'. */
export async function processMenuScan(id: ID, opts?: { forceLocal?: boolean }): Promise<void> {
  const wsId = getCurrentWorkspaceId();
  if (!wsId) throw new Error('No hay espacio de trabajo activo');
  const scan = await workspaceDb(wsId).menuScans.get(id);
  if (!scan) throw new Error('La carta ya no existe');
  await workspaceDb(wsId).menuScans.update(id, { status: 'procesando', error: undefined });
  return runScan(wsId, id, { forceLocal: opts?.forceLocal });
}

function runScan(wsId: string, id: ID, opts: { forceLocal?: boolean }): Promise<void> {
  return serial(async () => {
    if (!(await metaDb.workspaces.get(wsId))) return;
    await readScan(workspaceDb(wsId), id, opts);
  });
}

/** Archivos con nombre para el extractor (decide por tipo MIME y extensión). */
function namedImages(scan: MenuScan): (Blob & { name?: string })[] {
  return scan.images.map((blob, i) => {
    const existing = (blob as { name?: unknown }).name;
    if (typeof existing === 'string' && existing) return blob;
    const type = blob.type || 'image/jpeg';
    const ext = type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    const name = `carta-${i + 1}.${ext}`;
    if (typeof File !== 'undefined') return new File([blob], name, { type });
    return Object.assign(blob.slice(0, blob.size, type), { name });
  });
}

/** Entradas limpias: sin nombres vacíos ni duplicados exactos (la misma carta fotografiada dos veces). */
function toEntries(extracted: ExtractedMenu['entries']): MenuEntry[] {
  const seen = new Set<string>();
  const out: MenuEntry[] = [];
  for (const e of extracted ?? []) {
    const name = cleanStr(e.name);
    if (!name) continue;
    const price = positivePrice(e.price);
    const section = cleanStr(e.section);
    const key = `${dishNameKey(name)}|${price ?? ''}|${section ? normalizeText(section) : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry: MenuEntry = { id: uid(), name, selected: true };
    if (section) entry.section = section;
    const description = cleanStr(e.description);
    if (description) entry.description = description;
    if (price !== undefined) entry.price = price;
    if (typeof e.confidence === 'number' && Number.isFinite(e.confidence)) entry.confidence = Math.min(1, Math.max(0, e.confidence));
    out.push(entry);
  }
  return out;
}

async function readScan(wdb: WorkspaceDB, id: ID, opts: { forceLocal?: boolean }): Promise<void> {
  const scan = await wdb.menuScans.get(id);
  if (!scan) return;
  if (!scan.images.length) {
    await wdb.menuScans.update(id, { status: 'error', error: 'La carta no tiene fotos: vuelve a subirla' });
    throw new Error('La carta no tiene fotos: vuelve a subirla');
  }
  const onProgress = (p: ProgressInfo) => publish({ scanId: id, stage: p.stage, progress: p.progress });
  publish({ scanId: id, stage: 'Preparando la lectura…', progress: 0 });
  try {
    const settings = await getAppSettings();
    const files = namedImages(scan);
    const forceLocal = !!opts.forceLocal;
    const extraWarnings: string[] = [];
    let result: ExtractedMenu;
    try {
      result = await extractMenuFromFiles(files, { settings, onProgress, forceLocal });
    } catch (err) {
      // Red de seguridad: si la IA opcional falla, se lee gratis en el dispositivo.
      if (isAbortError(err) || forceLocal || !isAIError(err)) throw err;
      extraWarnings.push(`La IA no ha podido leer la carta (${errorText(err, 'error desconocido')}): se ha leído gratis en tu dispositivo`);
      result = await extractMenuFromFiles(files, { settings, onProgress, forceLocal: true });
    }
    const entries = toEntries(result.entries);
    const warnings = [...new Set([...(result.warnings ?? []), ...extraWarnings])].filter((w) => w && w.trim());
    if (!entries.length) warnings.push('No se ha encontrado ningún plato con precio: prueba con una foto más nítida y de frente, o añádelos a mano');
    const patch: Partial<MenuScanRecord> = {
      entries,
      method: result.method,
      rawText: result.rawText,
      status: 'revision',
      error: undefined,
      warnings,
    };
    await wdb.menuScans.update(id, patch);
  } catch (err) {
    await wdb.menuScans.update(id, { status: 'error', error: isAbortError(err) ? 'Lectura cancelada' : errorText(err, 'No se ha podido leer la carta') });
    throw err;
  } finally {
    publish(null);
  }
}

/**
 * Crea platos a partir de las entradas seleccionadas (nombre, sección, descripción, PVP), evita duplicados por nombre
 * (si ya existe un plato con ese nombre, actualiza PVP/sección; la descripción sólo si faltaba) y marca la carta como
 * 'importada'. Si `propose`, lanza proposeForDishes sobre los platos importados (sólo rellena los que no tienen receta).
 * Devuelve ids de platos (creados y actualizados).
 */
export async function importMenuEntries(
  scanId: ID,
  opts?: { propose?: boolean; createMissing?: boolean; onProgress?: (done: number, total: number, stage: string) => void },
): Promise<ID[]> {
  const wdb = db();
  const business = await getBusinessSettings(wdb);
  const ids = await wdb.transaction('rw', wdb.menuScans, wdb.dishes, async () => {
    const scan = await wdb.menuScans.get(scanId);
    if (!scan) throw new Error('La carta ya no existe');
    const source: Dish['source'] = scan.method === 'ia' ? 'carta-ia' : 'carta-ocr';
    const dishes = await wdb.dishes.toArray();
    const byName = new Map<string, Dish>();
    for (const d of dishes) if (d.kind === 'plato' && !byName.has(dishNameKey(d.name))) byName.set(dishNameKey(d.name), d);

    const now = nowIso();
    const touched = new Set<ID>();
    const createdNow = new Set<ID>();
    const toPut = new Map<ID, Dish>();
    const entries = scan.entries.map((entry) => {
      const name = cleanStr(entry.name);
      if (!entry.selected || !name) return entry;
      const key = dishNameKey(name);
      if (!key) return entry;
      const price = positivePrice(entry.price);
      const section = cleanStr(entry.section);
      const description = cleanStr(entry.description);
      const existing = byName.get(key);
      if (existing) {
        if (!createdNow.has(existing.id)) {
          // Plato ya existente: se actualiza el PVP y la sección de la carta nueva; la descripción, sólo si faltaba.
          const next: Dish = { ...(toPut.get(existing.id) ?? existing) };
          let changed = false;
          if (price !== undefined && next.menuPrice !== price) {
            next.menuPrice = price;
            changed = true;
          }
          if (section && next.section !== section) {
            next.section = section;
            changed = true;
          }
          if (description && !cleanStr(next.description)) {
            next.description = description;
            changed = true;
          }
          if (!next.menuScanId) {
            next.menuScanId = scanId;
            changed = true;
          }
          if (changed) {
            next.updatedAt = now;
            toPut.set(next.id, next);
          }
        }
        touched.add(existing.id);
        return { ...entry, dishId: existing.id };
      }
      const dish: Dish = {
        id: uid(),
        name,
        kind: 'plato',
        saleVatPct: business.defaultSaleVatPct,
        portions: 1,
        items: [],
        status: 'borrador',
        source,
        menuScanId: scanId,
        createdAt: now,
        updatedAt: now,
      };
      if (section) dish.section = section;
      if (description) dish.description = description;
      if (price !== undefined) dish.menuPrice = price;
      byName.set(key, dish);
      createdNow.add(dish.id);
      toPut.set(dish.id, dish);
      touched.add(dish.id);
      return { ...entry, dishId: dish.id };
    });
    if (toPut.size) await wdb.dishes.bulkPut([...toPut.values()]);
    await wdb.menuScans.update(scanId, { entries, status: 'importada' });
    return [...touched];
  });

  if (opts?.propose && ids.length) {
    await proposeForDishes(ids, { replace: false, createMissing: !!opts.createMissing, onProgress: opts.onProgress });
  } else {
    opts?.onProgress?.(ids.length, ids.length, 'Platos creados');
  }
  return ids;
}

export async function deleteMenuScan(id: ID): Promise<void> {
  const wdb = db();
  await wdb.transaction('rw', wdb.menuScans, wdb.dishes, async () => {
    await wdb.menuScans.delete(id);
    const linked = await wdb.dishes.filter((d) => d.menuScanId === id).toArray();
    if (!linked.length) return;
    const now = nowIso();
    await wdb.dishes.bulkPut(
      linked.map((d) => {
        const { menuScanId: _scan, ...rest } = d;
        return { ...rest, updatedAt: now };
      }),
    );
  });
}
