import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getAppSettings, getBusinessSettings, metaDb, DEFAULT_APP_SETTINGS, DEFAULT_BUSINESS_SETTINGS } from '../db';
import type { AppSettings, BusinessSettings, Dish, DishCost, ID, Invoice, MenuScan, PricePoint, Product, Supplier, Workspace, YieldTest } from '../types';
import { buildCostingContext, costAllDishes, type CostingContext } from '../core/costing';
import { useUI } from './store';

/**
 * Hooks de datos reactivos (se actualizan solos cuando cambia IndexedDB).
 * Todos devuelven `undefined` mientras cargan, salvo que se indique lo contrario.
 */

export function useAppSettings(): AppSettings {
  return useLiveQuery(() => getAppSettings(), [], DEFAULT_APP_SETTINGS);
}

export function useWorkspaces(): Workspace[] | undefined {
  return useLiveQuery(() => metaDb.workspaces.orderBy('createdAt').toArray(), []);
}

export function useCurrentWorkspace(): Workspace | undefined {
  const id = useUI((s) => s.workspaceId);
  return useLiveQuery(() => (id ? metaDb.workspaces.get(id) : undefined), [id]);
}

function useWs<T>(fn: () => Promise<T> | T, deps: unknown[] = [], def?: T): T | undefined {
  const id = useUI((s) => s.workspaceId);
  return useLiveQuery(() => (id ? fn() : def), [id, ...deps], def);
}

export function useBusiness(): BusinessSettings {
  return useWs(() => getBusinessSettings(), [], DEFAULT_BUSINESS_SETTINGS) ?? DEFAULT_BUSINESS_SETTINGS;
}

export function useProducts(): Product[] | undefined {
  return useWs(() => db().products.orderBy('searchKey').toArray());
}

export function useProduct(id: ID | undefined): Product | undefined {
  return useWs(() => (id ? db().products.get(id) : undefined), [id]);
}

export function useSuppliers(): Supplier[] | undefined {
  return useWs(() => db().suppliers.orderBy('name').toArray());
}

export function useInvoices(): Invoice[] | undefined {
  return useWs(() => db().invoices.orderBy('date').reverse().toArray());
}

export function useInvoice(id: ID | undefined): Invoice | undefined {
  return useWs(() => (id ? db().invoices.get(id) : undefined), [id]);
}

export function useDishes(): Dish[] | undefined {
  return useWs(() => db().dishes.orderBy('name').toArray());
}

export function useDish(id: ID | undefined): Dish | undefined {
  return useWs(() => (id ? db().dishes.get(id) : undefined), [id]);
}

export function useYieldTests(): YieldTest[] | undefined {
  return useWs(() => db().yieldTests.orderBy('date').reverse().toArray());
}

export function useMenuScans(): MenuScan[] | undefined {
  return useWs(() => db().menuScans.orderBy('createdAt').reverse().toArray());
}

export function usePricePoints(productId?: ID): PricePoint[] | undefined {
  return useWs(
    () =>
      productId
        ? db().pricePoints.where('[productId+date]').between([productId, ''], [productId, '￿']).toArray()
        : db().pricePoints.orderBy('date').toArray(),
    [productId],
  );
}

/** Contexto de cálculo con todos los datos necesarios para escandallar. */
export function useCostingContext(): CostingContext | undefined {
  const products = useProducts();
  const dishes = useDishes();
  const yieldTests = useYieldTests();
  const business = useBusiness();
  return useMemo(() => {
    if (!products || !dishes || !yieldTests) return undefined;
    return buildCostingContext(products, dishes, yieldTests, business);
  }, [products, dishes, yieldTests, business]);
}

/** Escandallos calculados de todos los platos y elaboraciones. */
export function useDishCosts(): { ctx: CostingContext; costs: Map<ID, DishCost> } | undefined {
  const ctx = useCostingContext();
  return useMemo(() => (ctx ? { ctx, costs: costAllDishes(ctx) } : undefined), [ctx]);
}
