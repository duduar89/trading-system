import type { ID, MenuEntry, MenuScan } from '../../types';
import { db } from '../../db';
import { uid } from '../../lib/id';

/** Estado de una carta leída, para las insignias. */
export const SCAN_STATUS: Record<MenuScan['status'], { label: string; tone: 'info' | 'warn' | 'ok' | 'bad' }> = {
  procesando: { label: 'Leyendo…', tone: 'info' },
  revision: { label: 'Por revisar', tone: 'warn' },
  importada: { label: 'Importada', tone: 'ok' },
  error: { label: 'Error', tone: 'bad' },
};

/**
 * Guardado de la revisión de una carta (el servicio de cartas no expone una función de actualización):
 * sólo toca el nombre y las entradas editadas por el usuario.
 */
export async function saveMenuScanPatch(id: ID, patch: Partial<Pick<MenuScan, 'entries' | 'name'>>): Promise<void> {
  const n = await db().menuScans.update(id, patch);
  if (n === 0 && !(await db().menuScans.get(id))) throw new Error('La carta ya no existe');
}

/** Entrada vacía para añadir a mano en la revisión. */
export function newMenuEntry(section?: string): MenuEntry {
  return { id: uid(), name: '', section: section?.trim() || undefined, selected: true };
}

/** Avisos de extracción guardados con la carta (campo opcional `warnings` si el servicio lo guarda, o `error` sin estado de error). */
export function scanWarnings(scan: MenuScan): string[] {
  const extra = (scan as MenuScan & { warnings?: unknown }).warnings;
  const list = Array.isArray(extra) ? extra.filter((w): w is string => typeof w === 'string' && w.trim().length > 0) : [];
  if (scan.status !== 'error' && scan.error && !list.includes(scan.error)) list.push(scan.error);
  return list;
}
