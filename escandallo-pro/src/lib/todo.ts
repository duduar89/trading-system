/** Marcador temporal para funciones aún no implementadas (no debe quedar ninguno al terminar). */
export function todo(name: string): never {
  throw new Error(`No implementado: ${name}`);
}
