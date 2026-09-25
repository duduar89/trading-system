import { useEffect, useState } from 'react';
import { Info, Laptop, TabletSmartphone, Monitor, Moon, Palette, Smartphone, Sun, Wifi, WifiOff } from 'lucide-react';
import type { AppSettings } from '../../../types';
import { updateAppSettings } from '../../../db';
import { useAppSettings } from '../../../state/hooks';
import { toast, errorMessage } from '../../../state/store';
import { useOnline } from '../../../lib/useOnline';
import { LogoMark } from '../../Logo';
import { Badge, Card, CardHeader, Segmented } from '../../ui';

/** Tema claro / oscuro / según el sistema. */
export function AppearanceCard({ id }: { id?: string }) {
  const settings = useAppSettings();
  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader icon={<Palette className="size-5" />} title="Apariencia" subtitle="El modo oscuro descansa la vista en cocina y de noche." />
      <Segmented<AppSettings['theme']>
        value={settings.theme}
        onChange={async (theme) => {
          try {
            await updateAppSettings({ theme });
          } catch (e) {
            toast.error('No se pudo cambiar el tema', errorMessage(e));
          }
        }}
        options={[
          { value: 'system', label: 'Sistema', icon: <Monitor className="size-4" /> },
          { value: 'light', label: 'Claro', icon: <Sun className="size-4" /> },
          { value: 'dark', label: 'Oscuro', icon: <Moon className="size-4" /> },
        ]}
      />
    </Card>
  );
}

function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const nav = navigator as Navigator & { standalone?: boolean };
    const update = () => setStandalone(!!mq?.matches || nav.standalone === true);
    update();
    mq?.addEventListener?.('change', update);
    return () => mq?.removeEventListener?.('change', update);
  }, []);
  return standalone;
}

const INSTALL_STEPS = [
  { icon: TabletSmartphone, title: 'iPhone y iPad', text: 'Abre la app en Safari, toca Compartir (el cuadrado con la flecha) y elige «Añadir a pantalla de inicio».' },
  { icon: Smartphone, title: 'Android', text: 'En Chrome, abre el menú ⋮ y toca «Instalar aplicación» o «Añadir a pantalla de inicio».' },
  { icon: Laptop, title: 'Ordenador', text: 'En Chrome o Edge, pulsa el icono de instalar en la barra de direcciones (o menú → «Instalar Escandallo Pro»).' },
];

/** Versión, estado de conexión e instrucciones de instalación como app. */
export function AboutCard({ id }: { id?: string }) {
  const online = useOnline();
  const standalone = useStandalone();
  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader icon={<Info className="size-5" />} title="Acerca de" />
      <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-surface-2 p-4">
        <LogoMark className="size-12" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-extrabold text-ink">
            Escandallo<span className="text-brand-500">Pro</span> <span className="text-sm font-bold text-muted">versión 1.0</span>
          </div>
          <div className="text-sm text-muted">Food cost, escandallos y mermas para hostelería. Tus datos, en tu dispositivo.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {online ? (
            <Badge tone="ok" icon={<Wifi className="size-3" />}>
              Con conexión
            </Badge>
          ) : (
            <Badge tone="warn" icon={<WifiOff className="size-3" />}>
              Sin conexión · todo sigue funcionando
            </Badge>
          )}
          {standalone && <Badge tone="brand">App instalada</Badge>}
        </div>
      </div>

      <div className="mt-5">
        <div className="font-semibold text-ink">{standalone ? 'Ya la tienes instalada' : 'Instálala como app'}</div>
        <p className="mt-0.5 text-sm text-muted">
          Acceso directo desde la pantalla de inicio, a pantalla completa y funcionando sin conexión, incluida la lectura de facturas y cartas.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {INSTALL_STEPS.map((s) => (
            <div key={s.title} className="rounded-2xl border border-line p-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <s.icon className="size-4 text-brand-500" /> {s.title}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
