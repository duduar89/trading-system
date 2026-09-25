import type { BusinessSettings, Dish, DishCost, ID, Invoice, MenuEngineeringClass, PricePoint, Product, IngredientCategory, BaseUnit } from '../types';
import type { CostingContext } from './costing';
import { todo } from '../lib/todo';

/**
 * Analítica de negocio: ingeniería de menú, alertas de precio y KPIs del panel.
 */

export interface MenuEngineeringRow {
  dishId: ID;
  name: string;
  section?: string;
  unitsSold: number;
  /** % de ventas sobre el total de platos analizados. */
  mixPct: number;
  /** Margen de contribución unitario (€) = PVP sin IVA − coste ración. */
  contributionMargin: number;
  /** Margen total aportado (€) = margen unitario × unidades. */
  totalMargin: number;
  popularity: 'alta' | 'baja';
  profitability: 'alta' | 'baja';
  class: MenuEngineeringClass;
  foodCostPct?: number;
}

/**
 * Matriz de Kasavana & Smith. Sólo platos (kind='plato') con PVP y coste > 0.
 * Popularidad alta si mixPct ≥ 70 % × (100 / nº platos). Rentabilidad alta si margen ≥ margen medio ponderado por ventas.
 * estrella = alta/alta, caballo (caballo de batalla) = popular/poco rentable, enigma = poco popular/rentable, perro = baja/baja.
 * Si ningún plato tiene unitsSold, se asume 1 venta por plato (sólo se clasifica por margen) y hasVolumeData = false.
 */
export function menuEngineering(dishes: Dish[], costs: Map<ID, DishCost>): {
  rows: MenuEngineeringRow[];
  avgMargin: number;
  popularityThresholdPct: number;
  hasVolumeData: boolean;
} {
  void dishes;
  void costs;
  return todo('menuEngineering');
}

export interface PriceAlert {
  productId: ID;
  productName: string;
  baseUnit: BaseUnit;
  previousPrice: number;
  currentPrice: number;
  /** Variación (%) respecto al precio anterior (positivo = subida). */
  changePct: number;
  previousDate: string;
  currentDate: string;
  /** Platos/elaboraciones que usan el producto (directamente). */
  affectedDishIds: ID[];
}

/**
 * Compara, para cada producto, su último precio con el anterior (distinto) del histórico.
 * Devuelve las variaciones con |changePct| ≥ thresholdPct, ordenadas por mayor subida primero.
 */
export function priceAlerts(products: Product[], pricePoints: PricePoint[], thresholdPct: number, dishes: Dish[] = []): PriceAlert[] {
  void products;
  void pricePoints;
  void thresholdPct;
  void dishes;
  return todo('priceAlerts');
}

export interface DashboardStats {
  dishCount: number;
  /** Media simple del food cost de los platos con PVP y coste. */
  avgFoodCostPct?: number;
  /** Food cost ponderado por unidades vendidas (o = media simple si no hay ventas). */
  weightedFoodCostPct?: number;
  avgMarginEur?: number;
  dishesOk: number;
  dishesWarn: number;
  dishesBad: number;
  /** Platos sin PVP o sin coste calculable. */
  dishesNoData: number;
  /** Platos con líneas sin precio / sin vincular. */
  incompleteDishes: number;
  productCount: number;
  productsWithoutPrice: number;
  invoiceCount: number;
  pendingInvoices: number;
  /** Gasto (sin IVA) de facturas confirmadas por mes, últimos 12 meses con datos: [{ month: 'YYYY-MM', total }]. */
  monthlySpend: { month: string; total: number }[];
  spendByCategory: { category: IngredientCategory; total: number }[];
  spendBySupplier: { supplier: string; total: number }[];
  /** Productos que más dinero suponen en compras. */
  topProductsBySpend: { productId: ID; name: string; total: number }[];
  /** Distribución de platos por tramos de food cost: <25, 25-30, 30-35, 35-40, >40. */
  foodCostBuckets: { label: string; count: number }[];
  /** Merma media de los platos (% en peso). */
  avgWastePct?: number;
}

export function dashboardStats(args: {
  dishes: Dish[];
  costs: Map<ID, DishCost>;
  products: Product[];
  invoices: Invoice[];
  business: BusinessSettings;
}): DashboardStats {
  void args;
  return todo('dashboardStats');
}

/**
 * Simulación "¿y si?": cambia el precio de un producto y devuelve el impacto en cada plato afectado.
 * No modifica el contexto original (clona y recalcula).
 */
export function simulatePriceChange(ctx: CostingContext, productId: ID, newPricePerBase: number): {
  dishId: ID;
  name: string;
  before: DishCost;
  after: DishCost;
}[] {
  void ctx;
  void productId;
  void newPricePerBase;
  return todo('simulatePriceChange');
}
