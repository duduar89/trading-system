import { useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import clsx from 'clsx';
import {
  LayoutDashboard,
  FileText,
  Carrot,
  Camera,
  ChefHat,
  Scale,
  BarChart3,
  Settings as SettingsIcon,
  Menu as MenuIcon,
  Plus,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { Logo } from './Logo';
import { Modal } from './ui';
import { useAppSettings } from '../state/hooks';
import { useOnline } from '../lib/useOnline';

export const NAV = [
  { to: '/', label: 'Panel', icon: LayoutDashboard, end: true },
  { to: '/facturas', label: 'Facturas', icon: FileText },
  { to: '/ingredientes', label: 'Ingredientes', icon: Carrot },
  { to: '/carta', label: 'Carta', icon: Camera },
  { to: '/platos', label: 'Escandallos', icon: ChefHat },
  { to: '/mermas', label: 'Mermas', icon: Scale },
  { to: '/informes', label: 'Informes', icon: BarChart3 },
  { to: '/ajustes', label: 'Ajustes', icon: SettingsIcon },
] as const;

function SideNav() {
  const settings = useAppSettings();
  const aiOn = settings.aiEnabled && !!settings.apiKey;
  return (
    <aside className="no-print sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <div className="px-5 pb-3 pt-5">
        <Logo />
      </div>
      <div className="px-3 pb-3">
        <WorkspaceSwitcher />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV.map(({ to, label, icon: Icon, ...rest }) => (
          <NavLink
            key={to}
            to={to}
            end={'end' in rest ? rest.end : false}
            className={({ isActive }) =>
              clsx(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                isActive ? 'bg-brand-500 text-white shadow-glow' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
              )
            }
          >
            <Icon className="size-[18px]" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="m-3 rounded-2xl border border-line bg-surface-2 p-3.5">
        <div className="flex items-center gap-2 text-xs font-bold text-ink">
          <Sparkles className={clsx('size-4', aiOn ? 'text-ai' : 'text-muted')} />
          {aiOn ? 'IA opcional activada' : 'Lectura gratis'}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          {aiOn
            ? 'Los documentos más difíciles se refuerzan con Claude. Todo lo demás, en tu dispositivo.'
            : 'Facturas y cartas se leen gratis en tu dispositivo, sin enviar tus datos a nadie.'}
        </p>
      </div>
    </aside>
  );
}

function MobileTopBar() {
  return (
    <header className="no-print pt-safe sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-xl lg:hidden">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <Logo compact />
        <div className="min-w-0 max-w-[60%]">
          <WorkspaceSwitcher compact />
        </div>
      </div>
    </header>
  );
}

function MobileBottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const navigate = useNavigate();
  const main = [NAV[0], NAV[1], NAV[4], NAV[2]];
  const mainTos: string[] = main.map((n) => n.to);
  const more = NAV.filter((n) => !mainTos.includes(n.to) && n.to !== '/carta');
  return (
    <>
      <nav className="no-print pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/92 backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5 items-end px-2 pt-1.5">
          {main.slice(0, 2).map(({ to, label, icon: Icon, ...rest }) => (
            <NavLink key={to} to={to} end={'end' in rest ? rest.end : false} className="flex flex-col items-center gap-0.5 py-1">
              {({ isActive }) => (
                <>
                  <Icon className={clsx('size-[22px]', isActive ? 'text-brand-500' : 'text-muted')} />
                  <span className={clsx('text-[10px] font-semibold', isActive ? 'text-ink' : 'text-muted')}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => navigate('/carta?nuevo=1')}
            className="-mt-6 flex flex-col items-center gap-0.5"
            aria-label="Fotografiar carta"
          >
            <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-glow ring-4 ring-bg">
              <Camera className="size-6" />
            </span>
            <span className="text-[10px] font-semibold text-ink">Carta</span>
          </button>
          {main.slice(2, 3).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className="flex flex-col items-center gap-0.5 py-1">
              {({ isActive }) => (
                <>
                  <Icon className={clsx('size-[22px]', isActive ? 'text-brand-500' : 'text-muted')} />
                  <span className={clsx('text-[10px] font-semibold', isActive ? 'text-ink' : 'text-muted')}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button type="button" onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-0.5 py-1">
            <MenuIcon className="size-[22px] text-muted" />
            <span className="text-[10px] font-semibold text-muted">Más</span>
          </button>
        </div>
      </nav>
      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Más secciones" size="sm">
        <div className="grid grid-cols-2 gap-2 pb-2">
          {[NAV[2], ...more].map(({ to, label, icon: Icon }) => (
            <button
              key={to}
              type="button"
              onClick={() => {
                setMoreOpen(false);
                navigate(to);
              }}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3.5 text-left text-sm font-semibold text-ink transition active:scale-[0.98]"
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500">
                <Icon className="size-5" />
              </span>
              {label}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}

/** Botón flotante de acción rápida (escritorio). */
function QuickActions() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  // En las pantallas de detalle/edición el botón taparía acciones de las tablas: se oculta.
  if (/^\/(platos|facturas|ingredientes|carta|mermas)\/[^/]+/.test(pathname)) return null;
  return (
    <div className="no-print fixed bottom-6 right-6 z-30 hidden lg:block">
      {open && (
        <div className="mb-3 flex animate-slide-up flex-col items-end gap-2">
          {[
            { label: 'Subir facturas', icon: FileText, to: '/facturas?nuevo=1' },
            { label: 'Fotografiar carta', icon: Camera, to: '/carta?nuevo=1' },
            { label: 'Nuevo escandallo', icon: ChefHat, to: '/platos?nuevo=1' },
            { label: 'Nueva prueba de merma', icon: Scale, to: '/mermas?nuevo=1' },
          ].map((a) => (
            <button
              key={a.to}
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(a.to);
              }}
              className="flex items-center gap-2.5 rounded-full border border-line bg-elevated py-2 pl-3 pr-4 text-sm font-semibold text-ink shadow-pop transition hover:border-brand-400"
            >
              <a.icon className="size-4 text-brand-500" />
              {a.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Acciones rápidas"
        className={clsx(
          'ml-auto flex size-14 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-glow transition hover:bg-brand-600',
          open && 'rotate-45',
        )}
      >
        <Plus className="size-6" />
      </button>
    </div>
  );
}

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="no-print flex items-center justify-center gap-2 bg-ink px-4 py-1.5 text-xs font-semibold text-bg">
      <WifiOff className="size-3.5" /> Sin conexión: todo sigue funcionando en local (la IA no está disponible).
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <SideNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <MobileTopBar />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>
      </div>
      <MobileBottomNav />
      <QuickActions />
    </div>
  );
}
