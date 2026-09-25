import { useNavigate } from 'react-router';
import { ArrowRight, Camera, Check, ChefHat, FileText, Lock, PlayCircle, WifiOff, X } from 'lucide-react';
import { Button, Card, ProgressBar, cx } from '../../ui';
import { useDemoLoader } from '../shared';
import type { OnboardingStep } from '../insights';

const STEP_ICON: Record<OnboardingStep['key'], typeof FileText> = { facturas: FileText, carta: Camera, escandallos: ChefHat };

/** Lista de pasos de puesta en marcha (restaurante vacío). */
export function OnboardingChecklist({ steps, doneCount, workspaceName }: { steps: OnboardingStep[]; doneCount: number; workspaceName?: string }) {
  const navigate = useNavigate();
  const [loadDemo, demoLoading] = useDemoLoader();
  const nextKey = steps.find((s) => !s.done)?.key;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="relative overflow-hidden" padded={false}>
        <div className="hero-mesh pointer-events-none absolute inset-x-0 top-0 h-56 opacity-60" aria-hidden />
        <div className="relative p-5 sm:p-7">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-brand-500">Puesta en marcha</div>
          <h2 className="mt-1 font-display text-2xl font-extrabold text-ink sm:text-3xl">
            Vamos a calcular el food cost {workspaceName ? <>de «{workspaceName}»</> : 'de tu carta'}
          </h2>
          <p className="mt-2 max-w-xl text-sm text-ink-2 sm:text-[15px]">
            Tres pasos y tendrás el escandallo de cada plato. La lectura de facturas y cartas es gratis, funciona en tu dispositivo y no envía tus datos a
            nadie.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <ProgressBar value={doneCount / steps.length} className="h-2.5 max-w-xs" />
            <span className="tabular text-sm font-semibold text-ink-2">
              {doneCount} de {steps.length}
            </span>
          </div>

          <ol className="mt-6 space-y-3">
            {steps.map((s, i) => {
              const Icon = STEP_ICON[s.key];
              const isNext = s.key === nextKey;
              return (
                <li
                  key={s.key}
                  className={cx(
                    'flex flex-col gap-4 rounded-2xl border p-4 transition sm:flex-row sm:items-center',
                    isNext ? 'border-brand-500/50 bg-surface shadow-glow' : 'border-line bg-surface/70',
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <span
                      className={cx(
                        'flex size-11 shrink-0 items-center justify-center rounded-2xl',
                        s.done ? 'bg-ok text-white' : isNext ? 'bg-brand-500 text-white' : 'bg-surface-2 text-muted',
                      )}
                      aria-hidden
                    >
                      {s.done ? <Check className="size-5" /> : <Icon className="size-5" />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
                        Paso {i + 1}
                        {s.done && <span className="rounded-full bg-ok-soft px-1.5 py-0.5 text-[10px] text-ok">Hecho</span>}
                      </div>
                      <div className={cx('font-display text-base font-bold sm:text-lg', s.done ? 'text-muted line-through decoration-2' : 'text-ink')}>{s.title}</div>
                      <p className="mt-0.5 text-sm text-muted">{s.description}</p>
                    </div>
                  </div>
                  <Button
                    variant={isNext ? 'primary' : 'outline'}
                    size={isNext ? 'lg' : 'md'}
                    onClick={() => navigate(s.to)}
                    iconRight={<ArrowRight className="size-4" />}
                    className="w-full sm:w-auto"
                  >
                    {s.done ? 'Ver' : s.cta}
                  </Button>
                </li>
              );
            })}
          </ol>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="relative overflow-hidden">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-ai-soft text-ai">
            <PlayCircle className="size-6" />
          </div>
          <h3 className="mt-3 font-display text-lg font-bold text-ink">¿Prefieres verlo antes con datos?</h3>
          <p className="mt-1 text-sm text-muted">
            Cargamos un restaurante de ejemplo completo, con facturas, carta, escandallos y mermas. Se crea aparte: no toca tus datos.
          </p>
          <Button variant="outline" className="mt-4 w-full" loading={demoLoading} onClick={loadDemo} icon={<PlayCircle className="size-4" />}>
            Cargar datos de ejemplo
          </Button>
        </Card>
        <Card>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-ok-soft text-ok">
                <Lock className="size-4" />
              </span>
              <span>
                <span className="block font-semibold text-ink">Gratis y privado</span>
                <span className="text-muted">Tus facturas se leen en este dispositivo. No se envían a ningún servidor.</span>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info">
                <WifiOff className="size-4" />
              </span>
              <span>
                <span className="block font-semibold text-ink">También sin conexión</span>
                <span className="text-muted">Úsala en la cocina o en el almacén aunque no haya cobertura.</span>
              </span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

/** Aviso compacto de pasos pendientes cuando ya hay datos (se puede ocultar). */
export function OnboardingBanner({ steps, doneCount, onDismiss }: { steps: OnboardingStep[]; doneCount: number; onDismiss: () => void }) {
  const navigate = useNavigate();
  const next = steps.find((s) => !s.done);
  if (!next) return null;
  const Icon = STEP_ICON[next.key];
  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-brand-500/30 bg-surface p-4 shadow-card sm:flex-row sm:items-center">
      <div className="hero-mesh pointer-events-none absolute inset-0 opacity-30" aria-hidden />
      <div className="relative flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-glow">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide text-brand-500">
            Siguiente paso · {doneCount} de {steps.length} completados
          </div>
          <div className="font-semibold text-ink">{next.title}</div>
          <div className="hidden text-sm text-muted sm:block">{next.description}</div>
        </div>
      </div>
      <div className="relative flex items-center gap-2">
        <Button onClick={() => navigate(next.to)} iconRight={<ArrowRight className="size-4" />} className="flex-1 sm:flex-none">
          {next.cta}
        </Button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Ocultar aviso"
          title="Ocultar aviso"
          className="flex size-10 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
