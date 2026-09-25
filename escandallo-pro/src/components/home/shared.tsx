import { useCallback, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import clsx from 'clsx';
import { setCurrentWorkspaceId } from '../../db';
import { useUI, toast, errorMessage } from '../../state/store';
import { fmtEur, fmtEurPrecise } from '../../lib/format';

/** Bloque de carga con brillo suave (respeta "reducir movimiento"). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('rounded-xl bg-line/70 motion-safe:animate-pulse-soft', className)} />;
}

/** Esqueleto genérico de una tarjeta con cabecera y cuerpo. */
export function CardSkeleton({ className, lines = 4 }: { className?: string; lines?: number }) {
  return (
    <div className={clsx('rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5', className)} aria-hidden>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-2 h-3.5 w-56" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-3.5" />
        ))}
      </div>
    </div>
  );
}

/**
 * Ejecuta un cálculo de analítica sin tumbar la pantalla si algo falla (datos corruptos, versión antigua…):
 * devuelve el resultado o el error para mostrarlo con contexto.
 */
export function safeCompute<T>(fn: () => T): { value?: T; error?: string } {
  try {
    return { value: fn() };
  } catch (e) {
    console.error(e);
    return { error: errorMessage(e) };
  }
}

/**
 * Carga del restaurante de ejemplo: crea el espacio de demostración, lo activa y lleva al panel.
 * Devuelve [cargar, cargando].
 */
export function useDemoLoader(): [() => Promise<void>, boolean] {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const load = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { loadDemoWorkspace } = await import('../../services/demo');
      const ws = await loadDemoWorkspace();
      setCurrentWorkspaceId(ws.id);
      useUI.getState().setWorkspaceId(ws.id);
      navigate('/');
      toast.success(`«${ws.name}» listo`, 'Explora el panel, los escandallos y los informes con datos reales de ejemplo.');
    } catch (e) {
      toast.error('No se pudo cargar el restaurante de ejemplo', errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [loading, navigate]);
  return [load, loading];
}

/** Título de sección dentro de una tarjeta. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('text-[11px] font-bold uppercase tracking-[0.12em] text-muted', className)}>{children}</div>;
}

/** Precio por unidad base: 2 decimales desde 1 € (12,40 €) y hasta 4 por debajo (0,0385 €). */
export function fmtUnitPrice(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.abs(v) >= 1 ? fmtEur(v) : fmtEurPrecise(v);
}

/** Variación porcentual con signo: +12,3 % / −4,0 %. */
export function fmtSignedPct(v: number | undefined, decimals = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v).toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (Math.abs(v) < 0.5 * 10 ** -decimals) return `${abs} %`;
  return `${v > 0 ? '+' : '−'}${abs} %`;
}

/** Diferencia en euros con signo: +0,45 € / −1,20 €. */
export function fmtSignedEur(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Math.abs(v) < 0.005) return abs;
  return `${v > 0 ? '+' : '−'}${abs}`;
}

/** Diferencia en puntos porcentuales: +2,4 pp. */
export function fmtPp(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (Math.abs(v) < 0.05) return `${abs} pp`;
  return `${v > 0 ? '+' : '−'}${abs} pp`;
}
