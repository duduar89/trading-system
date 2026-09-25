import type { Allergen, IngredientCategory, QtyBasis, InvoiceStatus, ExtractionMethod, MenuEngineeringClass, YieldOutputKind } from '../types';

/** Etiquetas y emojis compartidos por toda la UI. */

export const CATEGORY_LABELS: Record<IngredientCategory, { label: string; emoji: string }> = {
  carne: { label: 'Carne', emoji: '🥩' },
  pescado: { label: 'Pescado', emoji: '🐟' },
  marisco: { label: 'Marisco', emoji: '🦐' },
  verdura: { label: 'Verdura', emoji: '🥬' },
  fruta: { label: 'Fruta', emoji: '🍋' },
  lacteo: { label: 'Lácteo', emoji: '🧀' },
  huevo: { label: 'Huevo', emoji: '🥚' },
  cereal: { label: 'Cereal / harina', emoji: '🌾' },
  legumbre: { label: 'Legumbre', emoji: '🫘' },
  aceite: { label: 'Aceite / grasa', emoji: '🫒' },
  condimento: { label: 'Condimento / especia', emoji: '🧂' },
  panaderia: { label: 'Panadería', emoji: '🥖' },
  bebida: { label: 'Bebida', emoji: '🍷' },
  congelado: { label: 'Congelado', emoji: '🧊' },
  conserva: { label: 'Conserva', emoji: '🥫' },
  charcuteria: { label: 'Charcutería', emoji: '🍖' },
  dulce: { label: 'Repostería', emoji: '🍫' },
  otros: { label: 'Otros', emoji: '📦' },
};

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as IngredientCategory[];

export const ALLERGEN_LABELS: Record<Allergen, { label: string; emoji: string; short: string }> = {
  gluten: { label: 'Gluten', emoji: '🌾', short: 'GLU' },
  crustaceos: { label: 'Crustáceos', emoji: '🦐', short: 'CRU' },
  huevo: { label: 'Huevo', emoji: '🥚', short: 'HUE' },
  pescado: { label: 'Pescado', emoji: '🐟', short: 'PES' },
  cacahuete: { label: 'Cacahuetes', emoji: '🥜', short: 'CAC' },
  soja: { label: 'Soja', emoji: '🫛', short: 'SOJ' },
  lacteos: { label: 'Lácteos', emoji: '🥛', short: 'LAC' },
  frutos_cascara: { label: 'Frutos de cáscara', emoji: '🌰', short: 'FRC' },
  apio: { label: 'Apio', emoji: '🥬', short: 'API' },
  mostaza: { label: 'Mostaza', emoji: '🟡', short: 'MOS' },
  sesamo: { label: 'Sésamo', emoji: '⚪', short: 'SES' },
  sulfitos: { label: 'Sulfitos', emoji: '🍷', short: 'SUL' },
  altramuces: { label: 'Altramuces', emoji: '🌼', short: 'ALT' },
  moluscos: { label: 'Moluscos', emoji: '🦑', short: 'MOL' },
};

export const ALLERGENS = Object.keys(ALLERGEN_LABELS) as Allergen[];

export const BASIS_LABELS: Record<QtyBasis, { label: string; hint: string }> = {
  neta: { label: 'Neta', hint: 'Peso limpio en crudo (tras quitar la merma de limpieza)' },
  bruta: { label: 'Bruta', hint: 'Peso tal cual se compra, antes de limpiar' },
  cocinada: { label: 'Cocinada', hint: 'Peso servido en el plato, ya cocinado' },
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, { label: string; tone: 'neutral' | 'info' | 'warn' | 'ok' | 'bad' }> = {
  pendiente: { label: 'En cola', tone: 'neutral' },
  procesando: { label: 'Leyendo…', tone: 'info' },
  revision: { label: 'Por revisar', tone: 'warn' },
  confirmada: { label: 'Confirmada', tone: 'ok' },
  error: { label: 'Error', tone: 'bad' },
};

export const METHOD_LABELS: Record<ExtractionMethod, string> = {
  ia: 'IA',
  'pdf-texto': 'PDF',
  ocr: 'OCR',
  hoja: 'Excel/CSV',
  manual: 'Manual',
};

export const MENU_CLASS_LABELS: Record<MenuEngineeringClass, { label: string; emoji: string; tone: 'ok' | 'warn' | 'info' | 'bad'; advice: string }> = {
  estrella: { label: 'Estrella', emoji: '⭐', tone: 'ok', advice: 'Popular y rentable: mantén la calidad, destácalo en carta y no toques el precio a la baja.' },
  caballo: { label: 'Caballo de batalla', emoji: '🐴', tone: 'warn', advice: 'Se vende mucho pero deja poco margen: sube ligeramente el precio o reduce coste (gramaje, proveedor, guarnición).' },
  enigma: { label: 'Enigma', emoji: '🧩', tone: 'info', advice: 'Muy rentable pero se vende poco: dale visibilidad, recomiéndalo en sala o reposiciónalo en la carta.' },
  perro: { label: 'Perro', emoji: '🐶', tone: 'bad', advice: 'Poco popular y poco rentable: reformúlalo o sácalo de la carta.' },
};

export const YIELD_KIND_LABELS: Record<YieldOutputKind, { label: string; tone: 'ok' | 'info' | 'bad' }> = {
  principal: { label: 'Aprovechable (plato)', tone: 'ok' },
  subproducto: { label: 'Subproducto', tone: 'info' },
  desperdicio: { label: 'Desperdicio', tone: 'bad' },
};
