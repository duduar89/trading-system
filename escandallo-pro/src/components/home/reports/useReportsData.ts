import { useMemo } from 'react';
import { dashboardStats, type DashboardStats } from '../../../core/analytics';
import type { CostingContext } from '../../../core/costing';
import type { BusinessSettings, Dish, DishCost, ID, Invoice, PricePoint, Product, Supplier, Workspace, YieldTest } from '../../../types';
import { useBusiness, useCurrentWorkspace, useDishCosts, useDishes, useInvoices, usePricePoints, useProducts, useSuppliers, useYieldTests } from '../../../state/hooks';
import { safeCompute } from '../shared';

export interface ReportsData {
  workspace?: Workspace;
  business: BusinessSettings;
  dishes: Dish[];
  products: Product[];
  invoices: Invoice[];
  pricePoints: PricePoint[];
  suppliers: Supplier[];
  yieldTests: YieldTest[];
  ctx: CostingContext;
  costs: Map<ID, DishCost>;
  stats: { value?: DashboardStats; error?: string };
}

/** Todos los datos que necesitan los informes; `undefined` mientras cargan. */
export function useReportsData(): ReportsData | undefined {
  const workspace = useCurrentWorkspace();
  const business = useBusiness();
  const dishes = useDishes();
  const products = useProducts();
  const invoices = useInvoices();
  const pricePoints = usePricePoints();
  const suppliers = useSuppliers();
  const yieldTests = useYieldTests();
  const dishCosts = useDishCosts();

  return useMemo(() => {
    if (!dishes || !products || !invoices || !pricePoints || !suppliers || !yieldTests || !dishCosts) return undefined;
    const { ctx, costs } = dishCosts;
    return {
      workspace,
      business,
      dishes,
      products,
      invoices,
      pricePoints,
      suppliers,
      yieldTests,
      ctx,
      costs,
      stats: safeCompute(() => dashboardStats({ dishes, costs, products, invoices, business })),
    };
  }, [workspace, business, dishes, products, invoices, pricePoints, suppliers, yieldTests, dishCosts]);
}
