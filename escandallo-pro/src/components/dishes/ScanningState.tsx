import { useEffect, useState } from 'react';
import { ShieldCheck, Sparkles, ScanText, Wand2, ListChecks, RefreshCw } from 'lucide-react';
import type { ID } from '../../types';
import { subscribeMenuScanProgress, type MenuScanProgress } from '../../services/menus';
import { Badge, Button, Card } from '../ui';
import { useObjectUrl } from './hooks';
import { isPdf } from './MenuPhotoViewer';

const KEYFRAMES = `
@keyframes ep-scan-line { 0% { top: 0%; } 50% { top: calc(100% - 3px); } 100% { top: 0%; } }
@keyframes ep-scan-glow { 0%, 100% { opacity: .35; } 50% { opacity: .7; } }
@keyframes ep-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
@media (prefers-reduced-motion: reduce) { .ep-scan-line, .ep-scan-glow, .ep-indeterminate { animation: none !important; } }
`;

const STEPS = [
  { icon: Wand2, text: 'Mejoramos la imagen para leerla mejor' },
  { icon: ScanText, text: 'Reconocemos el texto de la carta' },
  { icon: ListChecks, text: 'Detectamos secciones, platos y precios' },
];

/** Estado "leyendo la carta": foto con línea de escaneo animada, tiempo transcurrido y qué estamos haciendo. */
export function ScanningState({
  scanId,
  image,
  pages,
  ai,
  startedAt,
  onRetry,
}: {
  scanId: ID;
  image?: Blob;
  pages: number;
  ai: boolean;
  startedAt: string;
  onRetry: () => void;
}) {
  const [live, setLive] = useState<MenuScanProgress | null>(null);
  useEffect(() => subscribeMenuScanProgress(setLive), []);
  const mine = live?.scanId === scanId ? live : null;
  const queued = !!live && live.scanId !== scanId;
  const url = useObjectUrl(image && !isPdf(image) ? image : undefined);
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(mountedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Al reprocesar, createdAt es antiguo: contamos desde lo más reciente entre la creación y la apertura de la pantalla.
  const started = Math.max(Date.parse(startedAt) || 0, mountedAt);
  const secs = Math.max(0, Math.round((now - started) / 1000));
  // Sin progreso en vivo durante mucho rato: probablemente se cerró la app mientras leía.
  const slow = !mine && !queued && secs > 45;
  const pct = mine?.progress != null && Number.isFinite(mine.progress) ? Math.max(0.03, Math.min(1, mine.progress)) : undefined;

  return (
    <Card className="hero-mesh overflow-hidden" padded={false}>
      <style>{KEYFRAMES}</style>
      <div className="grid gap-6 p-5 sm:p-8 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-center">
        <div className="relative mx-auto aspect-[3/4] w-full max-w-[320px] overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-pop">
          {url ? (
            <img src={url} alt="Carta que se está leyendo" className="size-full object-cover" />
          ) : (
            <div className="flex size-full flex-col gap-2 p-6">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="h-2.5 rounded bg-line" style={{ width: `${45 + ((i * 37) % 50)}%` }} />
              ))}
            </div>
          )}
          <div className="ep-scan-glow pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-500/0 via-brand-500/10 to-brand-500/0" style={{ animation: 'ep-scan-glow 2.4s ease-in-out infinite' }} />
          <div
            className="ep-scan-line pointer-events-none absolute inset-x-0 h-[3px] bg-brand-500 shadow-[0_0_24px_6px_rgb(255_90_31/0.55)]"
            style={{ animation: 'ep-scan-line 2.8s ease-in-out infinite' }}
          />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {ai ? (
              <Badge tone="ai" icon={<Sparkles className="size-3" />}>
                Con IA
              </Badge>
            ) : (
              <Badge tone="ok" icon={<ShieldCheck className="size-3" />}>
                Gratis · en tu dispositivo
              </Badge>
            )}
            <span className="tabular text-xs font-semibold text-muted">{formatElapsed(secs)}</span>
          </div>
          <h2 className="mt-3 font-display text-2xl font-extrabold text-ink sm:text-3xl">Leyendo tu carta…</h2>
          <p className="mt-1 max-w-md text-sm text-ink-2">
            {pages > 1 ? `${pages} páginas. ` : ''}Suele tardar entre 10 y 40 segundos por página. Tus fotos no salen de este dispositivo
            {ai ? ' salvo para la IA que has activado' : ''}.
          </p>
          <ul className="mt-5 space-y-2.5">
            {STEPS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-ink-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface text-brand-500 shadow-card">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <div className="mt-6 max-w-md">
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs font-semibold">
              <span className="truncate text-ink-2" aria-live="polite">
                {queued ? 'En cola: terminando de leer otra carta…' : mine?.stage || 'Preparando la lectura…'}
              </span>
              {pct != null && <span className="tabular text-muted">{Math.round(pct * 100)} %</span>}
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-label="Leyendo la carta"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct != null ? Math.round(pct * 100) : undefined}
            >
              {pct != null ? (
                <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${pct * 100}%` }} />
              ) : (
                <div className="ep-indeterminate h-full w-1/3 rounded-full bg-brand-500" style={{ animation: 'ep-indeterminate 1.6s ease-in-out infinite' }} />
              )}
            </div>
          </div>
          {slow && (
            <div className="mt-5 flex flex-col gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between">
              <span>No detectamos avance. Si cerraste la app mientras leía, vuelve a lanzar la lectura.</span>
              <Button size="sm" variant="outline" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
                Volver a leer
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
