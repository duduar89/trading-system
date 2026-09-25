import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ChefHat, Sparkles, ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ID } from '../../types';
import { proposeForDishes } from '../../services/dishes';
import { aiAvailable } from '../../extract/index';
import { useAppSettings } from '../../state/hooks';
import { errorMessage, toast } from '../../state/store';
import { Badge, Button, Callout, Modal, ProgressBar, Switch } from '../ui';

export interface TaskProgress {
  done: number;
  total: number;
  stage: string;
}

/** Cuerpo de progreso de una tarea larga (importar carta, proponer recetas…). */
export function ProgressBody({ progress, ai, noun = 'platos' }: { progress: TaskProgress; ai?: boolean; noun?: string }) {
  const value = progress.total > 0 ? progress.done / progress.total : 0;
  return (
    <div className="py-2">
      <div className="flex items-center gap-4">
        <div className={clsx('relative flex size-14 shrink-0 items-center justify-center rounded-2xl', ai ? 'bg-ai-soft text-ai' : 'bg-brand-500/12 text-brand-500')}>
          {ai ? <Sparkles className="size-7 animate-pulse-soft" /> : <ChefHat className="size-7 animate-pulse-soft" />}
          <span className={clsx('absolute inset-0 animate-ping rounded-2xl opacity-20', ai ? 'bg-ai' : 'bg-brand-500')} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular font-display text-2xl font-extrabold text-ink">
              {progress.done} <span className="text-base font-bold text-muted">de {progress.total || '…'} {noun}</span>
            </span>
            {ai ? (
              <Badge tone="ai" icon={<Sparkles className="size-3" />}>
                IA
              </Badge>
            ) : (
              <Badge tone="ok" icon={<ShieldCheck className="size-3" />}>
                Gratis · en tu dispositivo
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted" aria-live="polite">
            {progress.stage || 'Preparando…'}
          </p>
        </div>
      </div>
      <ProgressBar value={value} tone={ai ? 'ai' : 'brand'} className="mt-4 h-2.5" />
      <p className="mt-3 text-xs text-muted">Puedes seguir aquí: no cierres la pestaña hasta que termine.</p>
    </div>
  );
}

/** Modal de progreso no cancelable. */
export function TaskProgressModal({ open, title, progress, ai, noun }: { open: boolean; title: ReactNode; progress: TaskProgress; ai?: boolean; noun?: string }) {
  return (
    <Modal open={open} onClose={() => undefined} title={title} size="sm">
      <ProgressBody progress={progress} ai={ai} noun={noun} />
    </Modal>
  );
}

type Phase = 'options' | 'running' | 'done';

/**
 * Proponer ingredientes para uno o varios platos: opciones → progreso → resultado.
 * Funciona gratis con la base de recetas local; si el usuario activó la IA opcional, la usa (y cae a local si falla).
 */
export function ProposeModal({
  open,
  dishIds,
  withItems,
  single,
  onClose,
  onDone,
}: {
  open: boolean;
  dishIds: ID[];
  /** Varios platos: cuántos ya tienen ingredientes. Modo `single`: nº de líneas actuales del plato. */
  withItems: number;
  /** Modo editor (un único plato): siempre sustituye. */
  single?: boolean;
  onClose: () => void;
  onDone?: (res: { proposed: number; usedAI: boolean; warnings: string[] }) => void;
}) {
  const settings = useAppSettings();
  const aiOn = aiAvailable(settings);
  const [phase, setPhase] = useState<Phase>('options');
  const [replace, setReplace] = useState(false);
  const [createMissing, setCreateMissing] = useState(true);
  const [localOnly, setLocalOnly] = useState(false);
  const [progress, setProgress] = useState<TaskProgress>({ done: 0, total: dishIds.length, stage: '' });
  const [result, setResult] = useState<{ proposed: number; usedAI: boolean; warnings: string[] } | null>(null);

  const reset = () => {
    setPhase('options');
    setResult(null);
    setReplace(false);
    setProgress({ done: 0, total: dishIds.length, stage: '' });
  };
  const close = () => {
    if (phase === 'running') return;
    onClose();
    reset();
  };

  const run = async () => {
    setPhase('running');
    setProgress({ done: 0, total: dishIds.length, stage: 'Buscando recetas…' });
    try {
      const res = await proposeForDishes(dishIds, {
        replace: single ? true : replace,
        createMissing,
        forceLocal: localOnly || !aiOn,
        onProgress: (done, total, stage) => setProgress({ done, total, stage }),
      });
      setResult(res);
      setPhase('done');
      onDone?.(res);
    } catch (e) {
      toast.error('No se pudieron proponer los ingredientes', errorMessage(e));
      setPhase('options');
    }
  };

  const willUseAI = aiOn && !localOnly;
  const skipped = !single && !replace ? withItems : 0;
  const targets = dishIds.length - skipped;

  return (
    <Modal
      open={open}
      onClose={close}
      title={phase === 'done' ? 'Propuesta lista' : single ? 'Proponer ingredientes' : `Proponer ingredientes para ${dishIds.length} ${dishIds.length === 1 ? 'plato' : 'platos'}`}
      subtitle={phase === 'options' ? 'Te proponemos la receta con gramajes y mermas, y la cruzamos con los productos de tus facturas.' : undefined}
      size="md"
      footer={
        phase === 'options' ? (
          <>
            <Button variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button variant={willUseAI ? 'ai' : 'primary'} icon={<Sparkles className="size-4" />} onClick={run} disabled={targets <= 0}>
              {single && withItems ? 'Sustituir y proponer' : 'Proponer ingredientes'}
            </Button>
          </>
        ) : phase === 'done' ? (
          <Button onClick={close}>Revisar propuestas</Button>
        ) : undefined
      }
    >
      {phase === 'options' && (
        <div className="space-y-4">
          <div className={clsx('flex items-start gap-3 rounded-2xl border p-3.5', willUseAI ? 'border-ai/30 bg-ai-soft' : 'border-ok/30 bg-ok-soft')}>
            {willUseAI ? <Sparkles className="mt-0.5 size-5 shrink-0 text-ai" /> : <ShieldCheck className="mt-0.5 size-5 shrink-0 text-ok" />}
            <div className="text-sm text-ink-2">
              {willUseAI ? (
                <>
                  <span className="font-semibold text-ink">Con tu IA opcional (Claude).</span> Si falla o no hay conexión, seguimos con la base de recetas local.
                </>
              ) : (
                <>
                  <span className="font-semibold text-ink">Gratis, en tu dispositivo.</span> Usamos nuestra base de recetas de hostelería española: sin enviar tus datos a
                  nadie.
                </>
              )}
            </div>
          </div>

          {single && withItems > 0 && (
            <Callout tone="warn" icon={<AlertTriangle className="size-4" />} title="Se sustituirán los ingredientes actuales">
              Este escandallo tiene {withItems} {withItems === 1 ? 'línea' : 'líneas'}: la propuesta {withItems === 1 ? 'la reemplazará' : 'las reemplazará'} por completo.
            </Callout>
          )}

          <div className="space-y-4 rounded-2xl border border-line p-4">
            {!single && withItems > 0 && (
              <Switch
                checked={replace}
                onChange={setReplace}
                label="Sustituir los que ya tienen ingredientes"
                description={
                  replace
                    ? `Se rehará el escandallo de los ${withItems} que ya tienen líneas.`
                    : `${withItems} ${withItems === 1 ? 'plato ya tiene' : 'platos ya tienen'} ingredientes: se dejarán como están.`
                }
              />
            )}
            <Switch
              checked={createMissing}
              onChange={setCreateMissing}
              label="Crear ingredientes que falten con precio estimado"
              description="Así el escandallo sale completo desde el primer momento; el precio se corrige solo al subir tus facturas."
            />
            {aiOn && (
              <Switch checked={localOnly} onChange={setLocalOnly} label="Usar sólo la base local" description="Sin IA: gratis e instantáneo, sin conexión." />
            )}
          </div>
          {targets <= 0 && <p className="text-sm text-muted">Todos los platos elegidos ya tienen ingredientes. Activa «Sustituir» para rehacerlos.</p>}
        </div>
      )}

      {phase === 'running' && <ProgressBody progress={progress} ai={willUseAI} />}

      {phase === 'done' && result && (
        <div className="space-y-4 py-1">
          <div className="flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-ok-soft text-ok">
              <CheckCircle2 className="size-7" />
            </div>
            <div>
              <div className="font-display text-2xl font-extrabold text-ink">
                {result.proposed} {result.proposed === 1 ? 'escandallo propuesto' : 'escandallos propuestos'}
              </div>
              <p className="text-sm text-muted">
                {result.usedAI ? 'Con IA.' : 'Con la base de recetas local, gratis.'} Las líneas nuevas aparecen en violeta hasta que las aceptes.
              </p>
            </div>
          </div>
          {result.warnings.length > 0 && (
            <Callout tone="warn" title="Revisa estos avisos">
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {result.warnings.slice(0, 8).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {result.warnings.length > 8 && <li>… y {result.warnings.length - 8} más</li>}
              </ul>
            </Callout>
          )}
        </div>
      )}
    </Modal>
  );
}
