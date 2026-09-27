import type { PricePoint } from '../../types';

/** Origen de cada precio del histórico, tal y como se muestra en la ficha del ingrediente. */
export const SOURCE_LABELS: Record<PricePoint['source'], string> = {
  factura: 'Factura',
  manual: 'Precio manual',
  hoja: 'Tarifa importada',
  demo: 'Demostración',
};
