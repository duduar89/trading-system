import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Camera, FileText } from 'lucide-react';
import { dashboardStats, priceAlerts } from '../core/analytics';
import { useBusiness, useCurrentWorkspace, useDishCosts, useDishes, useInvoices, useMenuScans, usePricePoints, useProducts } from '../state/hooks';
import { useUI } from '../state/store';
import { Button, Callout, PageHeader } from '../components/ui';
import { CardSkeleton, Skeleton, safeCompute } from '../components/home/shared';
import { greetingFor, longDate, monthKey } from '../components/home/dates';
import { countByStatus, dishFoodCostRows, dishesNeedingAttention, lastMonthSpend, onboardingSteps, reviewQueue } from '../components/home/insights';
import { FoodCostHero } from '../components/home/dashboard/FoodCostHero';
import { DashboardKpis } from '../components/home/dashboard/DashboardKpis';
import { BucketsCard, CategorySpendCard, FoodCostByDishCard, MonthlySpendCard } from '../components/home/dashboard/DashboardCharts';
import { AttentionPanel, PriceAlertsPanel, ReviewPanel } from '../components/home/dashboard/DashboardPanels';
import { OnboardingBanner, OnboardingChecklist } from '../components/home/dashboard/DashboardOnboarding';

const BANNER_KEY = 'ep-dash-banner-hidden:';

function readBannerHidden(wsId: string | null): boolean {
  if (!wsId) return false;
  try {
    return localStorage.getItem(BANNER_KEY + wsId) === '1';
  } catch {
    return false;
  }
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando el panel">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <CardSkeleton className="lg:col-span-5" lines={5} />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:col-span-7 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-7 w-20" />
              <Skeleton className="mt-2 h-3 w-28" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <CardSkeleton className="lg:col-span-7" lines={8} />
        <CardSkeleton className="lg:col-span-5" lines={6} />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const wsId = useUI((s) => s.workspaceId);
  const workspace = useCurrentWorkspace();
  const business = useBusiness();
  const products = useProducts();
  const dishes = useDishes();
  const invoices = useInvoices();
  const menuScans = useMenuScans();
  const pricePoints = usePricePoints();
  const dishCosts = useDishCosts();
  const [bannerHidden, setBannerHidden] = useState(() => readBannerHidden(wsId));
  const now = useMemo(() => new Date(), []);

  const ready = !!(products && dishes && invoices && menuScans && pricePoints && dishCosts);

  const data = useMemo(() => {
    if (!products || !dishes || !invoices || !menuScans || !pricePoints || !dishCosts) return undefined;
    const { costs } = dishCosts;
    const platos = dishes.filter((d) => d.kind === 'plato');
    const rows = dishFoodCostRows(dishes, costs, business);
    const counts = countByStatus(rows);
    const stats = safeCompute(() => dashboardStats({ dishes, costs, products, invoices, business }));
    const alerts = safeCompute(() => priceAlerts(products, pricePoints, business.priceAlertPct, dishes));
    const onboarding = onboardingSteps({
      invoiceCount: invoices.length,
      productCount: products.length,
      menuScanCount: menuScans.length,
      dishCount: platos.length,
      reviewedDishCount: platos.filter((d) => d.status === 'revisado').length,
    });
    const completeDishes = platos.filter((d) => (costs.get(d.id)?.completeness ?? 0) >= 1 && d.items.length > 0).length;
    return {
      rows,
      counts,
      stats,
      alerts,
      onboarding,
      platoCount: platos.length,
      completeDishes,
      attention: dishesNeedingAttention(rows),
      review: reviewQueue(invoices, dishes, menuScans),
      spend: stats.value ? lastMonthSpend(stats.value.monthlySpend, monthKey(new Date())) : undefined,
      productsWithPrice: products.filter((p) => p.pricePerBase > 0).length,
      isEmpty: products.length === 0 && dishes.length === 0,
    };
  }, [products, dishes, invoices, menuScans, pricePoints, dishCosts, business]);

  const greeting = greetingFor(now);
  const header = (
    <PageHeader
      eyebrow={longDate(now)}
      title={
        <>
          {greeting}
          {workspace?.name ? (
            <>
              , <span className="text-gradient-brand">{workspace.name}</span>
            </>
          ) : null}
        </>
      }
      subtitle={data?.isEmpty ? 'Tu panel de control del food cost. Empieza por aquí.' : 'Así va el food cost de tu carta hoy.'}
      actions={
        <>
          <Button variant="outline" icon={<FileText className="size-4" />} onClick={() => navigate('/facturas?nuevo=1')}>
            Subir facturas
          </Button>
          <Button icon={<Camera className="size-4" />} onClick={() => navigate('/carta?nuevo=1')}>
            Fotografiar carta
          </Button>
        </>
      }
    />
  );

  if (!ready || !data) {
    return (
      <div className="animate-fade-in">
        {header}
        <DashboardSkeleton />
      </div>
    );
  }

  if (data.isEmpty) {
    return (
      <div className="animate-fade-in">
        {header}
        <OnboardingChecklist steps={data.onboarding.steps} doneCount={data.onboarding.doneCount} workspaceName={workspace?.name} />
      </div>
    );
  }

  const stats = data.stats.value;
  const weighted = !!dishes?.some((d) => d.kind === 'plato' && (d.unitsSold ?? 0) > 0);
  const avgFc = stats?.weightedFoodCostPct ?? stats?.avgFoodCostPct;

  return (
    <div className="animate-fade-in space-y-4 sm:space-y-5">
      {header}

      {!bannerHidden && data.onboarding.next && (
        <OnboardingBanner
          steps={data.onboarding.steps}
          doneCount={data.onboarding.doneCount}
          onDismiss={() => {
            setBannerHidden(true);
            try {
              if (wsId) localStorage.setItem(BANNER_KEY + wsId, '1');
            } catch {
              /* almacenamiento no disponible: solo se oculta en esta sesión */
            }
          }}
        />
      )}

      {data.stats.error && (
        <Callout tone="bad" icon={<AlertTriangle className="size-4" />} title="No se pudieron calcular algunos indicadores">
          {data.stats.error}. El resto del panel sigue funcionando; si persiste, exporta una copia de seguridad desde Ajustes.
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12">
        <FoodCostHero className="lg:col-span-5" pct={avgFc} weighted={weighted} business={business} counts={data.counts} />
        <DashboardKpis
          className="lg:col-span-7"
          avgMarginEur={stats?.avgMarginEur}
          counts={data.counts}
          avgWastePct={stats?.avgWastePct}
          spend={data.spend}
          productCount={products?.length ?? 0}
          productsWithPrice={data.productsWithPrice}
          dishCount={data.platoCount}
          completeDishes={data.completeDishes}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12">
        <FoodCostByDishCard className="lg:col-span-7" rows={data.rows} business={business} />
        <AttentionPanel className="lg:col-span-5" rows={data.attention} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
        <PriceAlertsPanel alerts={data.alerts.value ?? []} error={data.alerts.error} business={business} />
        <ReviewPanel items={data.review} />
        <BucketsCard className="md:col-span-2 xl:col-span-1" buckets={stats?.foodCostBuckets ?? []} business={business} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-12">
        <MonthlySpendCard className="lg:col-span-7" monthly={stats?.monthlySpend ?? []} />
        <CategorySpendCard className="lg:col-span-5" byCategory={stats?.spendByCategory ?? []} />
      </div>
    </div>
  );
}
