import { useEffect, useState } from 'react';
import { Database, HardDrive, PlayCircle, ShieldCheck } from 'lucide-react';
import { Button, Card, CardHeader, ProgressBar } from '../../ui';
import { toast } from '../../../state/store';
import { ExportBackupButton, RestoreBackupButton } from '../backup';
import { useDemoLoader } from '../shared';
import { fmtBytes } from '../settingsLogic';

interface StorageState {
  usage?: number;
  quota?: number;
  persisted?: boolean;
  supported: boolean;
}

function useStorageInfo(): [StorageState, () => Promise<void>] {
  const [state, setState] = useState<StorageState>({ supported: typeof navigator !== 'undefined' && !!navigator.storage });
  const refresh = async () => {
    if (typeof navigator === 'undefined' || !navigator.storage) return;
    try {
      const [est, persisted] = await Promise.all([
        navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve<StorageEstimate>({}),
        navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false),
      ]);
      setState({ usage: est.usage, quota: est.quota, persisted, supported: true });
    } catch {
      setState((s) => ({ ...s, supported: false }));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  return [state, refresh];
}

/** Copias de seguridad, restauración, datos de ejemplo y almacenamiento del dispositivo. */
export function DataCard({ workspaceId, id }: { workspaceId?: string; id?: string }) {
  const [loadDemo, demoLoading] = useDemoLoader();
  const [storage, refresh] = useStorageInfo();
  const [persisting, setPersisting] = useState(false);

  const persist = async () => {
    if (!navigator.storage?.persist) return;
    setPersisting(true);
    try {
      const ok = await navigator.storage.persist();
      await refresh();
      if (ok) toast.success('Datos protegidos', 'El navegador no borrará tus datos para liberar espacio.');
      else toast.info('El navegador no lo ha permitido', 'Suele concederse al instalar la app. Mientras tanto, haz copias de seguridad periódicas.');
    } finally {
      setPersisting(false);
    }
  };

  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader
        icon={<Database className="size-5" />}
        title="Datos y copias de seguridad"
        subtitle="Tus datos viven solo en este dispositivo. Haz copias para no perderlos y para pasarlos a otro."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line p-4">
          <div className="font-semibold text-ink">Exportar copia</div>
          <p className="mt-0.5 text-sm text-muted">Un archivo JSON con todo este restaurante (sin las fotos originales de facturas y cartas).</p>
          <ExportBackupButton workspaceId={workspaceId} className="mt-3 w-full" />
        </div>
        <div className="rounded-2xl border border-line p-4">
          <div className="font-semibold text-ink">Importar copia</div>
          <p className="mt-0.5 text-sm text-muted">Se restaura como un restaurante nuevo: nunca sobrescribe lo que ya tienes.</p>
          <RestoreBackupButton label="Importar copia (JSON)" className="mt-3 w-full" />
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-line p-4 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ai-soft text-ai">
          <PlayCircle className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">Restaurante de ejemplo</div>
          <p className="text-sm text-muted">Crea un espacio aparte con datos reales de ejemplo para explorar o hacer demostraciones.</p>
        </div>
        <Button variant="outline" onClick={loadDemo} loading={demoLoading}>
          Cargar ejemplo
        </Button>
      </div>

      {storage.supported && (
        <div className="mt-3 rounded-2xl bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <HardDrive className="size-4 text-muted" /> Espacio usado en este dispositivo
            </div>
            <span className="tabular text-sm text-ink-2">
              {fmtBytes(storage.usage)}
              {storage.quota ? <span className="text-muted"> de {fmtBytes(storage.quota)}</span> : null}
            </span>
          </div>
          {storage.quota ? <ProgressBar value={(storage.usage ?? 0) / storage.quota} className="mt-2 h-1.5" /> : null}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">
              {storage.persisted
                ? 'Almacenamiento protegido: el navegador no borrará tus datos por falta de espacio.'
                : 'Si el dispositivo se queda sin espacio, el navegador podría borrar datos. Protégelos o haz copias periódicas.'}
            </p>
            {storage.persisted ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-ok">
                <ShieldCheck className="size-4" /> Protegido
              </span>
            ) : (
              <Button size="sm" variant="outline" onClick={persist} loading={persisting} icon={<ShieldCheck className="size-4" />}>
                Proteger mis datos
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
