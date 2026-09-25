/**
 * Modelo de dominio de Escandallo Pro.
 *
 * Convenciones (IMPORTANTES para que los cálculos sean exactos):
 *  - Todos los importes monetarios son en EUR y SIN IVA salvo que el nombre diga lo contrario
 *    (p. ej. `menuPrice` es el PVP de carta CON IVA, tal y como se imprime en la carta).
 *  - Los porcentajes se guardan en escala 0–100 (p. ej. 12.5 = 12,5 %).
 *  - Las cantidades internas se normalizan a unidades base: kg (masa), l (volumen) y ud (unidades).
 *  - Las fechas son cadenas ISO 8601 (`YYYY-MM-DD` para fechas de negocio, ISO completo para timestamps).
 */

export type ID = string;

/** Unidad base de precio de un producto. */
export type BaseUnit = 'kg' | 'l' | 'ud';

/**
 * Unidades admitidas en recetas / facturas. Las culinarias se convierten con equivalencias estándar
 * (cucharada = 15 ml, cucharadita = 5 ml, pizca = 0,5 g, taza = 250 ml, docena = 12 ud).
 */
export type QtyUnit =
  | 'kg'
  | 'g'
  | 'mg'
  | 'l'
  | 'dl'
  | 'cl'
  | 'ml'
  | 'ud'
  | 'docena'
  | 'cucharada'
  | 'cucharadita'
  | 'pizca'
  | 'taza';

/** Sobre qué peso está expresada la cantidad de una línea de escandallo. */
export type QtyBasis =
  /** Peso tal cual se compra (bruto, antes de limpiar). */
  | 'bruta'
  /** Peso limpio en crudo (neto, tras quitar merma de limpieza/despiece). */
  | 'neta'
  /** Peso cocinado servido en el plato (tras merma de cocción). */
  | 'cocinada';

export type IngredientCategory =
  | 'carne'
  | 'pescado'
  | 'marisco'
  | 'verdura'
  | 'fruta'
  | 'lacteo'
  | 'huevo'
  | 'cereal'
  | 'legumbre'
  | 'aceite'
  | 'condimento'
  | 'panaderia'
  | 'bebida'
  | 'congelado'
  | 'conserva'
  | 'charcuteria'
  | 'dulce'
  | 'otros';

/** Los 14 alérgenos de declaración obligatoria (Reglamento UE 1169/2011). */
export type Allergen =
  | 'gluten'
  | 'crustaceos'
  | 'huevo'
  | 'pescado'
  | 'cacahuete'
  | 'soja'
  | 'lacteos'
  | 'frutos_cascara'
  | 'apio'
  | 'mostaza'
  | 'sesamo'
  | 'sulfitos'
  | 'altramuces'
  | 'moluscos';

// ───────────────────────────── Espacios de trabajo ─────────────────────────────

/** Un espacio de trabajo = un restaurante / cliente. Cada uno tiene su propia base de datos. */
export interface Workspace {
  id: ID;
  name: string;
  /** Tipo de negocio, sólo informativo (restaurante, bar, catering, grupo, cliente de agencia…). */
  businessType?: string;
  city?: string;
  /** Color de acento para distinguir clientes (hex). */
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export type AIModel = 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5';
export type AIEffort = 'low' | 'medium' | 'high';

/** Ajustes globales de la app (no dependen del espacio de trabajo). */
export interface AppSettings {
  id: 'app';
  apiKey?: string;
  aiModel: AIModel;
  aiEffort: AIEffort;
  /** Si es false nunca se llama a la IA aunque haya clave (modo 100 % local). */
  aiEnabled: boolean;
  theme: 'system' | 'light' | 'dark';
  currentWorkspaceId?: ID;
  onboardingDone: boolean;
}

/** Ajustes de negocio por espacio de trabajo. */
export interface BusinessSettings {
  id: 'business';
  /** Food cost objetivo (%) sobre PVP sin IVA. */
  targetFoodCostPct: number;
  /** Umbral "atención" del semáforo de food cost (%). Por encima de target y por debajo de este = ámbar. */
  warningFoodCostPct: number;
  /** IVA de venta por defecto en restauración (%). En España, 10. */
  defaultSaleVatPct: number;
  /** Subida de precio (%) a partir de la cual se genera alerta. */
  priceAlertPct: number;
  currency: 'EUR';
  /** Redondeo psicológico del PVP sugerido (p. ej. 0.5 → múltiplos de 0,50 €; 0.1 → x,x0). */
  priceRounding: number;
}

// ───────────────────────────── Compras ─────────────────────────────

export interface Supplier {
  id: ID;
  name: string;
  taxId?: string;
  phone?: string;
  email?: string;
  notes?: string;
  createdAt: string;
}

/** Producto de compra / materia prima: el "ingrediente" de la base de datos de precios. */
export interface Product {
  id: ID;
  name: string;
  /** Nombre normalizado para búsqueda (sin tildes, minúsculas). Lo mantiene `core/matching`. */
  searchKey: string;
  /** Otros nombres con los que aparece en facturas o recetas (se aprenden al vincular). */
  aliases: string[];
  category: IngredientCategory;
  baseUnit: BaseUnit;
  /** Precio vigente en € por unidad base (kg / l / ud), sin IVA. */
  pricePerBase: number;
  priceSource: 'factura' | 'manual' | 'demo' | 'hoja';
  lastPurchaseDate?: string;
  supplierId?: ID;
  /** IVA de compra (%). Informativo. */
  purchaseVatPct?: number;
  /** Peso medio de 1 ud en kg (para convertir ud ⇄ kg). Ej.: huevo M ≈ 0.06. */
  unitWeightKg?: number;
  /** Densidad kg/l (para convertir l ⇄ kg). Por defecto 1 para líquidos. */
  densityKgPerL?: number;
  /** Merma de limpieza/despiece por defecto (%) cuando no hay prueba de rendimiento. */
  wastePct: number;
  /** Merma de cocción por defecto (%). */
  cookingLossPct: number;
  /** Prueba de rendimiento vinculada: si existe, manda sobre `wastePct` y ajusta el coste real. */
  yieldTestId?: ID;
  allergens: Allergen[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Histórico de precios de un producto (uno por línea de factura confirmada o cambio manual). */
export interface PricePoint {
  id: ID;
  productId: ID;
  date: string;
  pricePerBase: number;
  supplierId?: ID;
  invoiceId?: ID;
  source: 'factura' | 'manual' | 'demo' | 'hoja';
  /** Descripción original de la línea de factura. */
  rawDescription?: string;
}

/** Formato de envase detectado en la descripción: "Caja 6x1L" → { count: 6, size: 1, unit: 'l' }. */
export interface PackSize {
  count: number;
  size: number;
  unit: 'kg' | 'g' | 'l' | 'cl' | 'ml' | 'ud';
}

export type InvoiceStatus = 'pendiente' | 'procesando' | 'revision' | 'confirmada' | 'error';
export type ExtractionMethod = 'ia' | 'pdf-texto' | 'ocr' | 'hoja' | 'manual';

export interface InvoiceLine {
  id: ID;
  description: string;
  code?: string;
  /** Cantidad facturada en la unidad de facturación (`unit`). */
  quantity: number;
  /** Unidad de facturación tal cual (kg, ud, caja, l, bot, bandeja…). */
  unit: string;
  packSize?: PackSize;
  /** Precio por unidad de facturación, sin IVA y antes de descuento. */
  unitPrice: number;
  discountPct?: number;
  /** Importe neto de la línea sin IVA (tras descuento). */
  total: number;
  vatPct?: number;
  /** Normalización a unidad base (la rellena `core/units.normalizeInvoiceLine`). */
  baseUnit?: BaseUnit;
  /** Cantidad total comprada en unidad base (kg / l / ud). */
  baseQuantity?: number;
  /** € por unidad base, sin IVA y con descuento aplicado. */
  pricePerBase?: number;
  /** Nombre genérico limpio sugerido para el producto (p. ej. "Tomate pera"). */
  suggestedName?: string;
  suggestedCategory?: IngredientCategory;
  productId?: ID;
  matchScore?: number;
  matchStatus: 'nuevo' | 'sugerido' | 'vinculado' | 'ignorado';
  /** 0–1: confianza de la extracción de esta línea. */
  confidence?: number;
  /** Avisos de validación (p. ej. "cantidad × precio ≠ importe"). */
  warnings?: string[];
}

export interface Invoice {
  id: ID;
  supplierId?: ID;
  supplierName: string;
  supplierTaxId?: string;
  number?: string;
  /** Fecha de la factura (YYYY-MM-DD). */
  date: string;
  fileName?: string;
  fileType?: string;
  /** Archivo original (PDF / imagen) guardado para poder volver a consultarlo. */
  file?: Blob;
  status: InvoiceStatus;
  method?: ExtractionMethod;
  /** Base imponible. */
  subtotal?: number;
  vatTotal?: number;
  total?: number;
  lines: InvoiceLine[];
  /** Texto bruto extraído (para depurar / reprocesar). */
  rawText?: string;
  error?: string;
  /** Avisos globales (p. ej. "la suma de líneas no cuadra con la base imponible"). */
  warnings?: string[];
  createdAt: string;
  confirmedAt?: string;
}

// ───────────────────────────── Mermas / rendimientos ─────────────────────────────

export type YieldOutputKind = 'principal' | 'subproducto' | 'desperdicio';

export interface YieldOutput {
  id: ID;
  name: string;
  weightKg: number;
  kind: YieldOutputKind;
  /** Valor de mercado/aprovechamiento €/kg de un subproducto (p. ej. espinas para fumet). */
  valuePerKg?: number;
}

/**
 * Prueba de rendimiento (despiece) de una pieza: parte del peso bruto y registra lo que sale.
 * Permite obtener el % de merma total, el coste real €/kg aprovechable y la merma por ración.
 */
export interface YieldTest {
  id: ID;
  name: string;
  productId?: ID;
  date: string;
  /** Peso bruto de la pieza tal cual se compra (kg). */
  grossWeightKg: number;
  /** Precio de compra €/kg bruto (por defecto el precio vigente del producto). */
  purchasePricePerKg: number;
  /** Merma de descongelación/goteo (%) sobre bruto, antes de limpiar. Opcional. */
  thawLossPct?: number;
  outputs: YieldOutput[];
  /** Merma de cocción (%) de la parte principal. */
  cookingLossPct: number;
  /** Gramaje por ración (kg) de la parte principal, en el peso de servicio (cocinado si hay cocción). */
  portionKg?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Resultado del cálculo de una prueba de rendimiento. */
export interface YieldResult {
  grossWeightKg: number;
  grossCost: number;
  principalKg: number;
  byproductKg: number;
  wasteKg: number;
  /** Pérdida no registrada = bruto − suma de salidas (goteo, evaporación, error de pesaje). */
  unaccountedKg: number;
  /** Rendimiento de la parte principal en crudo (0–100). */
  yieldPct: number;
  /** Merma total respecto a la parte principal (0–100) = 100 − yieldPct. */
  totalWastePct: number;
  /** Merma real descontando subproductos aprovechables (0–100). */
  realWastePct: number;
  /** Valor recuperado por subproductos (€). */
  byproductValue: number;
  /** Coste real €/kg de la parte principal en crudo (descontando valor de subproductos). */
  costPerUsableKg: number;
  /** Peso de la parte principal cocinada (kg). */
  cookedKg: number;
  /** Rendimiento final bruto → cocinado (0–100). */
  finalYieldPct: number;
  /** Coste real €/kg cocinado. */
  costPerCookedKg: number;
  /** Factor multiplicador: costPerCookedKg / purchasePricePerKg. */
  costFactor: number;
  /** Raciones obtenidas (si hay portionKg). */
  portions?: number;
  /** Peso bruto necesario por ración (kg). */
  grossPerPortionKg?: number;
  /** Merma por ración (kg) = bruto por ración − ración servida. */
  wastePerPortionKg?: number;
  /** Coste por ración (€). */
  costPerPortion?: number;
  /** Coste de la merma por ración (€). */
  wasteCostPerPortion?: number;
  warnings: string[];
}

// ───────────────────────────── Platos / escandallos ─────────────────────────────

/** Referencia de una línea de escandallo: a un producto de compra o a una elaboración (sub-receta). */
export type ItemRef = { type: 'product'; id: ID } | { type: 'dish'; id: ID };

export interface RecipeItem {
  id: ID;
  /** Nombre del ingrediente tal y como se propuso/escribió. */
  name: string;
  ref?: ItemRef;
  quantity: number;
  unit: QtyUnit;
  basis: QtyBasis;
  /** Sobrescribe la merma de limpieza del producto (%). */
  wastePct?: number;
  /** Sobrescribe la merma de cocción del producto (%). */
  cookingLossPct?: number;
  /** Sobrescribe la prueba de rendimiento del producto. */
  yieldTestId?: ID;
  /** Puntuación del emparejamiento automático con el producto (0–1). */
  matchScore?: number;
  /** true si la línea la propuso la IA / base de conocimiento y aún no se ha revisado. */
  suggested?: boolean;
  note?: string;
}

export type DishKind = 'plato' | 'elaboracion';
export type DishSource = 'carta-ia' | 'carta-ocr' | 'manual' | 'demo' | 'plantilla';

export interface Dish {
  id: ID;
  name: string;
  /** 'plato' = se vende en carta; 'elaboracion' = sub-receta (salsa, fondo, masa…) usable como ingrediente. */
  kind: DishKind;
  section?: string;
  description?: string;
  /** PVP de carta CON IVA (€). */
  menuPrice?: number;
  /** IVA de venta (%). */
  saleVatPct: number;
  /** Raciones que produce la receta (los costes se dividen entre este número). */
  portions: number;
  /** Para elaboraciones: cantidad final producida (para usarla como ingrediente por kg/l/ud). */
  yieldQty?: number;
  yieldUnit?: BaseUnit;
  items: RecipeItem[];
  /** Food cost objetivo específico del plato (si no, el del negocio). */
  targetFoodCostPct?: number;
  /** Unidades vendidas en el periodo analizado (ingeniería de menú). */
  unitsSold?: number;
  status: 'borrador' | 'revisado';
  source: DishSource;
  /** Foto de la carta de la que proviene (id de MenuScan). */
  menuScanId?: ID;
  tags?: string[];
  notes?: string;
  /** Elaboración / emplatado (texto libre para la ficha técnica). */
  procedure?: string;
  createdAt: string;
  updatedAt: string;
}

/** Foto(s) de carta procesadas. */
export interface MenuScan {
  id: ID;
  name: string;
  images: Blob[];
  status: 'procesando' | 'revision' | 'importada' | 'error';
  method?: ExtractionMethod;
  rawText?: string;
  entries: MenuEntry[];
  error?: string;
  createdAt: string;
}

export interface MenuEntry {
  id: ID;
  section?: string;
  name: string;
  description?: string;
  /** PVP con IVA (€). */
  price?: number;
  confidence?: number;
  /** Plato creado a partir de esta entrada. */
  dishId?: ID;
  selected: boolean;
}

// ───────────────────────────── Resultados de cálculo ─────────────────────────────

export interface ItemCost {
  itemId: ID;
  name: string;
  resolved: boolean;
  /** Unidad base del producto/elaboración referenciada. */
  baseUnit?: BaseUnit;
  /** Precio €/unidad base usado (sin IVA). */
  pricePerBase?: number;
  /** Cantidad bruta (a comprar) en unidad base, para TODA la receta. */
  grossQty: number;
  /** Cantidad neta limpia en crudo, unidad base. */
  netQty: number;
  /** Cantidad servida (cocinada si aplica), unidad base. */
  servedQty: number;
  /** Merma de limpieza/despiece (unidad base). */
  cleaningWasteQty: number;
  /** Merma de cocción (unidad base). */
  cookingWasteQty: number;
  /** Merma total = bruto − servido (unidad base). */
  totalWasteQty: number;
  /** % merma total sobre bruto (0–100). */
  totalWastePct: number;
  /** Coste de la línea (€) para toda la receta. */
  cost: number;
  /** Valor económico de la merma (€) para toda la receta. */
  wasteCost: number;
  /** Peso en kg (si es convertible) para agregados. */
  grossKg?: number;
  servedKg?: number;
  /** % del coste total del plato (0–100). */
  costSharePct: number;
  /** Merma de limpieza (%) efectivamente aplicada. */
  appliedWastePct: number;
  /** Merma de cocción (%) efectivamente aplicada. */
  appliedCookingLossPct: number;
  /** De dónde sale la merma aplicada. */
  wasteSource: 'prueba' | 'linea' | 'producto' | 'ninguna';
  warnings: string[];
}

export interface DishCost {
  dishId: ID;
  /** Coste total de la receta (todas las raciones), €. */
  totalCost: number;
  /** Coste por ración, €. */
  costPerPortion: number;
  /** PVP sin IVA por ración, €. */
  netPrice?: number;
  /** Food cost (%) = coste ración / PVP sin IVA. */
  foodCostPct?: number;
  /** Margen bruto por ración (€) = PVP sin IVA − coste. */
  grossMargin?: number;
  /** Margen bruto (%) sobre PVP sin IVA. */
  grossMarginPct?: number;
  /** Multiplicador = PVP sin IVA / coste. */
  multiplier?: number;
  /** PVP con IVA sugerido para alcanzar el food cost objetivo (redondeado). */
  suggestedPrice?: number;
  targetFoodCostPct: number;
  /** Kg brutos por ración (sólo líneas convertibles a kg). */
  grossKgPerPortion: number;
  /** Kg servidos por ración. */
  servedKgPerPortion: number;
  /** Merma total por ración (kg). */
  wasteKgPerPortion: number;
  /** Merma total del plato (%) = merma / bruto (en peso). */
  wastePct: number;
  /** Coste de la merma por ración (€). */
  wasteCostPerPortion: number;
  /** Merma total de la receta completa (kg) — todas las raciones. */
  totalWasteKg: number;
  items: ItemCost[];
  /** Fracción de líneas resueltas con precio (0–1). */
  completeness: number;
  /** Para elaboraciones: € por unidad base producida. */
  pricePerYieldUnit?: number;
  allergens: Allergen[];
  warnings: string[];
}

export type MenuEngineeringClass = 'estrella' | 'caballo' | 'enigma' | 'perro';

// ───────────────────────────── Propuestas (IA / base de conocimiento) ─────────────────────────────

/** Ingrediente propuesto para un plato (salida de la IA o de la base de conocimiento local). */
export interface ProposedIngredient {
  name: string;
  quantity: number;
  unit: QtyUnit;
  basis: QtyBasis;
  wastePct?: number;
  cookingLossPct?: number;
  category?: IngredientCategory;
  /** Producto de la BD elegido por la IA (id) si lo hay. */
  productId?: ID;
  note?: string;
}

export interface DishProposal {
  dishName: string;
  portions: number;
  ingredients: ProposedIngredient[];
  procedure?: string;
  allergens?: Allergen[];
  source: 'ia' | 'plantilla' | 'heuristica';
  /** Plantilla de la base de conocimiento usada (si aplica). */
  templateName?: string;
  confidence: number;
}

/** Resultado normalizado de extraer una factura (IA o parser local). */
export interface ExtractedInvoice {
  supplierName?: string;
  supplierTaxId?: string;
  number?: string;
  date?: string;
  subtotal?: number;
  vatTotal?: number;
  total?: number;
  lines: Omit<InvoiceLine, 'id' | 'matchStatus'>[];
  method: ExtractionMethod;
  rawText?: string;
  warnings: string[];
}

/** Resultado normalizado de extraer una carta. */
export interface ExtractedMenu {
  entries: Omit<MenuEntry, 'id' | 'selected' | 'dishId'>[];
  method: ExtractionMethod;
  rawText?: string;
  warnings: string[];
}

/** Progreso de tareas largas (OCR, IA…) para la UI. */
export interface ProgressInfo {
  stage: string;
  /** 0–1 */
  progress?: number;
}
export type ProgressFn = (p: ProgressInfo) => void;
