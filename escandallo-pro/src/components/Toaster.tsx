import clsx from 'clsx';
import { CheckCircle2, AlertTriangle, Info, Sparkles, X } from 'lucide-react';
import { useUI } from '../state/store';

export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  // En móvil, arriba: abajo taparían la navegación y las barras de acción fijas (confirmar factura, carta, selección).
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 px-4 lg:left-auto lg:right-6 lg:top-6 lg:items-end">
      {toasts.map((t) => {
        const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? AlertTriangle : t.tone === 'ai' ? Sparkles : Info;
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-2xl border border-line bg-elevated p-3.5 shadow-pop"
          >
            <Icon
              className={clsx(
                'mt-0.5 size-5 shrink-0',
                t.tone === 'success' && 'text-ok-ink',
                t.tone === 'error' && 'text-bad-ink',
                t.tone === 'info' && 'text-info-ink',
                t.tone === 'ai' && 'text-ai-ink',
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">{t.title}</div>
              {t.description && <div className="mt-0.5 text-xs text-muted">{t.description}</div>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} className="text-muted hover:text-ink" aria-label="Cerrar">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
