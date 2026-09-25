import { Briefcase, Database, Info, Palette, Sparkles, Store } from 'lucide-react';
import { useCurrentWorkspace } from '../state/hooks';
import { PageHeader } from '../components/ui';
import { CardSkeleton } from '../components/home/shared';
import { BusinessCard } from '../components/home/settings/BusinessCard';
import { AiCard } from '../components/home/settings/AiCard';
import { WorkspaceCard } from '../components/home/settings/WorkspaceCard';
import { DataCard } from '../components/home/settings/DataCard';
import { AboutCard, AppearanceCard } from '../components/home/settings/AboutCards';

const SECTIONS = [
  { id: 'ajustes-negocio', label: 'Negocio', icon: Briefcase },
  { id: 'ajustes-restaurante', label: 'Restaurante', icon: Store },
  { id: 'ajustes-ia', label: 'Inteligencia artificial', icon: Sparkles },
  { id: 'ajustes-datos', label: 'Datos', icon: Database },
  { id: 'ajustes-apariencia', label: 'Apariencia', icon: Palette },
  { id: 'ajustes-acerca', label: 'Acerca de', icon: Info },
];

export default function Settings() {
  const ws = useCurrentWorkspace();

  // Con HashRouter no podemos usar anclas (#id): desplazamos por código.
  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Ajustes"
        title="Configuración"
        subtitle={ws ? `Objetivos y datos de «${ws.name}», y preferencias de la app en este dispositivo.` : 'Preferencias de la app.'}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Secciones de ajustes" className="hidden lg:block">
          <ul className="sticky top-8 space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => goTo(s.id)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold text-ink-2 transition hover:bg-surface hover:text-ink"
                >
                  <s.icon className="size-4 text-muted" />
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 max-w-3xl space-y-5">
          <BusinessCard id="ajustes-negocio" />
          {ws ? <WorkspaceCard key={ws.id + ws.updatedAt} ws={ws} id="ajustes-restaurante" /> : <CardSkeleton lines={5} />}
          <AiCard id="ajustes-ia" />
          <DataCard workspaceId={ws?.id} id="ajustes-datos" />
          <AppearanceCard id="ajustes-apariencia" />
          <AboutCard id="ajustes-acerca" />
        </div>
      </div>
    </div>
  );
}
