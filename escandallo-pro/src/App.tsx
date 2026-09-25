import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router';
import { metaDb, getAppSettings, setCurrentWorkspaceId, updateAppSettings } from './db';
import { useUI } from './state/store';
import { useAppSettings } from './state/hooks';
import { Layout } from './components/Layout';
import { Toaster } from './components/Toaster';
import { PwaPrompt } from './components/PwaPrompt';
import { Spinner } from './components/ui';

const Welcome = lazy(() => import('./pages/Welcome'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Invoices = lazy(() => import('./pages/Invoices'));
const InvoiceReview = lazy(() => import('./pages/InvoiceReview'));
const Products = lazy(() => import('./pages/Products'));
const ProductDetail = lazy(() => import('./pages/ProductDetail'));
const Menu = lazy(() => import('./pages/Menu'));
const MenuReview = lazy(() => import('./pages/MenuReview'));
const Dishes = lazy(() => import('./pages/Dishes'));
const DishEditor = lazy(() => import('./pages/DishEditor'));
const YieldTests = lazy(() => import('./pages/YieldTests'));
const YieldTestEditor = lazy(() => import('./pages/YieldTestEditor'));
const Reports = lazy(() => import('./pages/Reports'));
const Settings = lazy(() => import('./pages/Settings'));

/** Aplica el tema (claro / oscuro / sistema) a <html>. */
function useTheme() {
  const { theme } = useAppSettings();
  useEffect(() => {
    try {
      localStorage.setItem('ep-theme', theme);
    } catch {
      /* modo privado */
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0f14' : '#ff5a1f');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

/** Resuelve el espacio de trabajo activo al arrancar. */
function useBootstrapWorkspace(): boolean {
  const setWorkspaceId = useUI((s) => s.setWorkspaceId);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const settings = await getAppSettings();
      let id = settings.currentWorkspaceId;
      if (id && !(await metaDb.workspaces.get(id))) id = undefined;
      if (!id) {
        const first = await metaDb.workspaces.orderBy('createdAt').first();
        id = first?.id;
        if (id) await updateAppSettings({ currentWorkspaceId: id });
      }
      setCurrentWorkspaceId(id ?? null);
      setWorkspaceId(id ?? null);
      setReady(true);
    })();
  }, [setWorkspaceId]);
  return ready;
}

export function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export default function App() {
  useTheme();
  const ready = useBootstrapWorkspace();
  const workspaceId = useUI((s) => s.workspaceId);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  return (
    <>
      {!workspaceId ? (
        <Suspense fallback={<PageFallback />}>
          <Welcome />
        </Suspense>
      ) : (
        // key: al cambiar de restaurante se remonta todo con los datos del nuevo espacio
        <Layout key={workspaceId}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/facturas" element={<Invoices />} />
              <Route path="/facturas/:id" element={<InvoiceReview />} />
              <Route path="/ingredientes" element={<Products />} />
              <Route path="/ingredientes/:id" element={<ProductDetail />} />
              <Route path="/carta" element={<Menu />} />
              <Route path="/carta/:id" element={<MenuReview />} />
              <Route path="/platos" element={<Dishes />} />
              <Route path="/platos/:id" element={<DishEditor />} />
              <Route path="/mermas" element={<YieldTests />} />
              <Route path="/mermas/:id" element={<YieldTestEditor />} />
              <Route path="/informes" element={<Reports />} />
              <Route path="/ajustes" element={<Settings />} />
              <Route path="/bienvenida" element={<Welcome />} />
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </Suspense>
        </Layout>
      )}
      <Toaster />
      <PwaPrompt />
    </>
  );
}
