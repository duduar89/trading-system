import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Download, RefreshCw, X } from 'lucide-react';
import { Button } from './ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Aviso de nueva versión disponible + invitación a instalar la app. */
export function PwaPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('ep-install-dismissed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (needRefresh) {
    return (
      <div className="no-print fixed inset-x-4 bottom-24 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-elevated p-3.5 shadow-pop lg:bottom-6 lg:left-6 lg:right-auto">
        <RefreshCw className="size-5 shrink-0 text-brand-500" />
        <div className="min-w-0 flex-1 text-sm font-semibold text-ink">Hay una nueva versión disponible</div>
        <Button size="sm" onClick={() => updateServiceWorker(true)}>
          Actualizar
        </Button>
        <button type="button" aria-label="Cerrar" className="text-muted" onClick={() => setNeedRefresh(false)}>
          <X className="size-4" />
        </button>
      </div>
    );
  }

  if (installEvt && !dismissed) {
    return (
      <div className="no-print fixed inset-x-4 bottom-24 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-elevated p-3.5 shadow-pop lg:bottom-6 lg:left-6 lg:right-auto">
        <Download className="size-5 shrink-0 text-brand-500" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink">Instala Escandallo Pro</div>
          <div className="text-xs text-muted">Acceso directo, pantalla completa y uso sin conexión.</div>
        </div>
        <Button
          size="sm"
          onClick={async () => {
            await installEvt.prompt();
            setInstallEvt(null);
          }}
        >
          Instalar
        </Button>
        <button
          type="button"
          aria-label="Cerrar"
          className="text-muted"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem('ep-install-dismissed', '1');
            } catch {
              /* ignore */
            }
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return null;
}
