import type { Workspace } from '../types';
import { todo } from '../lib/todo';

/**
 * Crea un espacio de trabajo de demostración completo y realista ("Taberna Demo · Madrid"):
 * proveedores, ~8 facturas confirmadas en 3 meses (con subidas de precio), ~60 productos, 3–4 elaboraciones,
 * ~18 platos de carta con escandallo completo, ventas para ingeniería de menú y 3 pruebas de rendimiento.
 * Deja el espacio como activo.
 */
export async function loadDemoWorkspace(): Promise<Workspace> {
  return todo('loadDemoWorkspace');
}
