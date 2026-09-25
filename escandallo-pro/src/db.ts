import Dexie, { type Table } from 'dexie';
import type {
  AppSettings,
  BusinessSettings,
  Dish,
  Invoice,
  MenuScan,
  PricePoint,
  Product,
  Supplier,
  Workspace,
  YieldTest,
} from './types';
import { uid, nowIso } from './lib/id';

/**
 * Persistencia 100 % local (IndexedDB vía Dexie).
 *
 *  - `metaDb` (una sola): espacios de trabajo + ajustes globales de la app.
 *  - `WorkspaceDB` (una por restaurante/cliente): todos los datos de negocio de ese espacio.
 *
 * Separar por base de datos permite a una agencia gestionar decenas de clientes sin mezclar datos
 * y sin filtrar por `workspaceId` en cada consulta.
 */

class MetaDB extends Dexie {
  workspaces!: Table<Workspace, string>;
  settings!: Table<AppSettings, string>;
  constructor() {
    super('escandallo-meta');
    this.version(1).stores({
      workspaces: 'id, name, createdAt',
      settings: 'id',
    });
  }
}

export class WorkspaceDB extends Dexie {
  products!: Table<Product, string>;
  pricePoints!: Table<PricePoint, string>;
  suppliers!: Table<Supplier, string>;
  invoices!: Table<Invoice, string>;
  dishes!: Table<Dish, string>;
  yieldTests!: Table<YieldTest, string>;
  menuScans!: Table<MenuScan, string>;
  business!: Table<BusinessSettings, string>;

  constructor(workspaceId: string) {
    super(`escandallo-ws-${workspaceId}`);
    this.version(1).stores({
      products: 'id, searchKey, category, supplierId, updatedAt, *aliases',
      pricePoints: 'id, productId, date, invoiceId, [productId+date]',
      suppliers: 'id, name',
      invoices: 'id, date, status, supplierId, createdAt',
      dishes: 'id, name, kind, section, status, updatedAt',
      yieldTests: 'id, productId, date',
      menuScans: 'id, createdAt, status',
      business: 'id',
    });
  }
}

export const metaDb = new MetaDB();

export const DEFAULT_APP_SETTINGS: AppSettings = {
  id: 'app',
  aiModel: 'claude-opus-5',
  aiEffort: 'medium',
  aiEnabled: true,
  theme: 'system',
  onboardingDone: false,
};

export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  id: 'business',
  targetFoodCostPct: 30,
  warningFoodCostPct: 35,
  defaultSaleVatPct: 10,
  priceAlertPct: 5,
  currency: 'EUR',
  priceRounding: 0.5,
};

const dbCache = new Map<string, WorkspaceDB>();

/** Devuelve (y cachea) la base de datos de un espacio de trabajo. */
export function workspaceDb(workspaceId: string): WorkspaceDB {
  let db = dbCache.get(workspaceId);
  if (!db) {
    db = new WorkspaceDB(workspaceId);
    dbCache.set(workspaceId, db);
  }
  return db;
}

let currentWorkspaceId: string | null = null;

/** Base de datos del espacio de trabajo activo. Lanza si no hay ninguno activo. */
export function db(): WorkspaceDB {
  if (!currentWorkspaceId) throw new Error('No hay espacio de trabajo activo');
  return workspaceDb(currentWorkspaceId);
}

export function getCurrentWorkspaceId(): string | null {
  return currentWorkspaceId;
}

export function setCurrentWorkspaceId(id: string | null): void {
  currentWorkspaceId = id;
}

export async function getAppSettings(): Promise<AppSettings> {
  const s = await metaDb.settings.get('app');
  return { ...DEFAULT_APP_SETTINGS, ...(s ?? {}) };
}

export async function updateAppSettings(patch: Partial<Omit<AppSettings, 'id'>>): Promise<AppSettings> {
  const current = await getAppSettings();
  const next: AppSettings = { ...current, ...patch, id: 'app' };
  await metaDb.settings.put(next);
  return next;
}

export async function getBusinessSettings(wdb: WorkspaceDB = db()): Promise<BusinessSettings> {
  const s = await wdb.business.get('business');
  return { ...DEFAULT_BUSINESS_SETTINGS, ...(s ?? {}) };
}

export async function updateBusinessSettings(
  patch: Partial<Omit<BusinessSettings, 'id'>>,
  wdb: WorkspaceDB = db(),
): Promise<BusinessSettings> {
  const current = await getBusinessSettings(wdb);
  const next: BusinessSettings = { ...current, ...patch, id: 'business' };
  await wdb.business.put(next);
  return next;
}

export async function createWorkspace(data: Partial<Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>> & { name: string }): Promise<Workspace> {
  const ws: Workspace = { id: uid(), createdAt: nowIso(), updatedAt: nowIso(), ...data };
  await metaDb.workspaces.put(ws);
  await workspaceDb(ws.id).business.put(DEFAULT_BUSINESS_SETTINGS);
  return ws;
}

export async function deleteWorkspace(id: string): Promise<void> {
  const wdb = workspaceDb(id);
  wdb.close();
  dbCache.delete(id);
  await Dexie.delete(`escandallo-ws-${id}`);
  await metaDb.workspaces.delete(id);
  const s = await getAppSettings();
  if (s.currentWorkspaceId === id) {
    const other = await metaDb.workspaces.toCollection().first();
    await updateAppSettings({ currentWorkspaceId: other?.id });
  }
}

/** Copia de seguridad completa de un espacio de trabajo (sin los Blobs de archivos originales). */
export interface WorkspaceBackup {
  format: 'escandallo-pro-backup';
  version: 1;
  exportedAt: string;
  workspace: Workspace;
  data: {
    products: Product[];
    pricePoints: PricePoint[];
    suppliers: Supplier[];
    invoices: Omit<Invoice, 'file'>[];
    dishes: Dish[];
    yieldTests: YieldTest[];
    menuScans: Omit<MenuScan, 'images'>[];
    business: BusinessSettings[];
  };
}

export async function exportWorkspace(workspaceId: string): Promise<WorkspaceBackup> {
  const ws = await metaDb.workspaces.get(workspaceId);
  if (!ws) throw new Error('Espacio de trabajo no encontrado');
  const wdb = workspaceDb(workspaceId);
  const [products, pricePoints, suppliers, invoices, dishes, yieldTests, menuScans, business] = await Promise.all([
    wdb.products.toArray(),
    wdb.pricePoints.toArray(),
    wdb.suppliers.toArray(),
    wdb.invoices.toArray(),
    wdb.dishes.toArray(),
    wdb.yieldTests.toArray(),
    wdb.menuScans.toArray(),
    wdb.business.toArray(),
  ]);
  return {
    format: 'escandallo-pro-backup',
    version: 1,
    exportedAt: nowIso(),
    workspace: ws,
    data: {
      products,
      pricePoints,
      suppliers,
      invoices: invoices.map(({ file: _file, ...rest }) => rest),
      dishes,
      yieldTests,
      menuScans: menuScans.map(({ images: _images, ...rest }) => rest),
      business,
    },
  };
}

/** Restaura una copia como NUEVO espacio de trabajo (nunca sobrescribe uno existente). */
export async function importWorkspace(backup: WorkspaceBackup): Promise<Workspace> {
  if (backup?.format !== 'escandallo-pro-backup') throw new Error('Archivo de copia de seguridad no válido');
  const ws = await createWorkspace({
    name: `${backup.workspace.name} (restaurado)`,
    businessType: backup.workspace.businessType,
    city: backup.workspace.city,
    color: backup.workspace.color,
  });
  const wdb = workspaceDb(ws.id);
  const d = backup.data;
  await wdb.transaction(
    'rw',
    [wdb.products, wdb.pricePoints, wdb.suppliers, wdb.invoices, wdb.dishes, wdb.yieldTests, wdb.menuScans, wdb.business],
    async () => {
      await wdb.products.bulkPut(d.products ?? []);
      await wdb.pricePoints.bulkPut(d.pricePoints ?? []);
      await wdb.suppliers.bulkPut(d.suppliers ?? []);
      await wdb.invoices.bulkPut((d.invoices ?? []) as Invoice[]);
      await wdb.dishes.bulkPut(d.dishes ?? []);
      await wdb.yieldTests.bulkPut(d.yieldTests ?? []);
      await wdb.menuScans.bulkPut((d.menuScans ?? []).map((m) => ({ ...m, images: [] })) as MenuScan[]);
      if (d.business?.length) await wdb.business.bulkPut(d.business);
    },
  );
  return ws;
}
