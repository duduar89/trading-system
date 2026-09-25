import type { Workspace } from '../types';
import { createWorkspace, deleteWorkspace, metaDb, setCurrentWorkspaceId, updateAppSettings, workspaceDb } from '../db';
import { toSearchKey } from '../core/matching';
import { uid } from '../lib/id';
import { useUI } from '../state/store';
import { buildDemoData } from '../demo/build';

/** Nombre base del espacio de demostración. */
export const DEMO_WORKSPACE_NAME = 'Taberna El Fogón';

/** Clave de búsqueda de respaldo: minúsculas, sin tildes ni signos, espacios colapsados. */
function fallbackSearchKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Usa `core/matching.toSearchKey` y, si falla o devuelve vacío, la normalización básica. */
function safeSearchKey(name: string): string {
  try {
    const key = toSearchKey(name);
    if (typeof key === 'string' && key.trim()) return key;
  } catch {
    // El emparejador aún no está disponible: normalización básica.
  }
  return fallbackSearchKey(name);
}

/** Nombre libre para el nuevo espacio: "Taberna El Fogón", "Taberna El Fogón (2)", "(3)"… */
async function nextDemoName(): Promise<string> {
  const names = new Set((await metaDb.workspaces.toArray()).map((w) => w.name));
  if (!names.has(DEMO_WORKSPACE_NAME)) return DEMO_WORKSPACE_NAME;
  let n = 2;
  while (names.has(`${DEMO_WORKSPACE_NAME} (${n})`)) n++;
  return `${DEMO_WORKSPACE_NAME} (${n})`;
}

/**
 * Crea un espacio de trabajo de demostración completo y realista ("Taberna El Fogón", Madrid):
 * 5 proveedores, 11 facturas confirmadas en los últimos ~100 días (con subidas de precio que disparan alertas),
 * ~80 productos con histórico de precios, 4 elaboraciones, 21 platos de carta con escandallo completo
 * (verdes, ámbar y rojos; 3 en borrador con líneas propuestas), ventas del último mes para la ingeniería de menú
 * y 3 pruebas de rendimiento vinculadas. Las fechas son relativas a hoy. Deja el espacio como activo.
 * Llamarla dos veces crea dos espacios de demostración ("… (2)").
 */
export async function loadDemoWorkspace(): Promise<Workspace> {
  const data = buildDemoData({ now: new Date(), makeId: uid, searchKey: safeSearchKey });
  const ws = await createWorkspace({
    name: await nextDemoName(),
    businessType: 'Restaurante · Taberna',
    city: 'Madrid',
    color: '#ff5a1f',
  });
  const wdb = workspaceDb(ws.id);
  try {
    await wdb.transaction('rw', [wdb.suppliers, wdb.products, wdb.pricePoints, wdb.invoices, wdb.yieldTests, wdb.dishes, wdb.business], async () => {
      await wdb.suppliers.bulkPut(data.suppliers);
      await wdb.products.bulkPut(data.products);
      await wdb.pricePoints.bulkPut(data.pricePoints);
      await wdb.invoices.bulkPut(data.invoices);
      await wdb.yieldTests.bulkPut(data.yieldTests);
      await wdb.dishes.bulkPut(data.dishes);
      await wdb.business.put(data.business);
    });
  } catch (e) {
    // No dejamos un espacio a medias si la escritura falla (p. ej. cuota de almacenamiento agotada).
    await deleteWorkspace(ws.id).catch(() => undefined);
    throw e;
  }
  await updateAppSettings({ currentWorkspaceId: ws.id });
  setCurrentWorkspaceId(ws.id);
  useUI.getState().setWorkspaceId(ws.id);
  return ws;
}
