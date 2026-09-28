/**
 * Documentos de ejemplo incluidos en la app (public/samples) para probar la lectura gratuita sin tener
 * facturas o cartas propias a mano.
 */
export const SAMPLE_INVOICES = ['factura-fruteria-garcia.pdf', 'factura-carnes-guadarrama.pdf', 'factura-distribuciones-centro.pdf'] as const;
export const SAMPLE_MENU = 'carta-el-fogon.jpg';

const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

/** Descarga los archivos de ejemplo como File (rutas relativas: funciona en cualquier subruta de despliegue). */
export async function loadSampleFiles(names: readonly string[]): Promise<File[]> {
  return Promise.all(
    names.map(async (name) => {
      const res = await fetch(`./samples/${name}`);
      if (!res.ok) throw new Error(`No se ha podido descargar el ejemplo «${name}»`);
      const blob = await res.blob();
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      return new File([blob], name, { type: TYPES[ext] ?? blob.type });
    }),
  );
}
