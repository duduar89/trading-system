import type { ID } from '../types';
import { todo } from '../lib/todo';

/** Crea un MenuScan con las fotos (preprocesadas) y lanza su lectura. Devuelve el id. */
export async function addMenuScan(files: File[], name?: string): Promise<ID> {
  void files;
  void name;
  return todo('addMenuScan');
}

/** Lee la carta (extract/extractMenuFromFiles) → entries con selected=true → status 'revision'. */
export async function processMenuScan(id: ID, opts?: { forceLocal?: boolean }): Promise<void> {
  void id;
  void opts;
  return todo('processMenuScan');
}

/**
 * Crea platos a partir de las entradas seleccionadas (nombre, sección, descripción, PVP), evita duplicados por nombre
 * (si ya existe un plato con ese nombre, actualiza PVP/sección) y marca la carta como 'importada'.
 * Si `propose`, lanza proposeForDishes sobre los platos creados. Devuelve ids de platos.
 */
export async function importMenuEntries(scanId: ID, opts?: { propose?: boolean; createMissing?: boolean; onProgress?: (done: number, total: number, stage: string) => void }): Promise<ID[]> {
  void scanId;
  void opts;
  return todo('importMenuEntries');
}

export async function deleteMenuScan(id: ID): Promise<void> {
  void id;
  return todo('deleteMenuScan');
}
