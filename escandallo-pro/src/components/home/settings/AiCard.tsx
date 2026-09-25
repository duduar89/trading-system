import { useState } from 'react';
import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Lock, PlugZap, Sparkles, Trash2, XCircle } from 'lucide-react';
import type { AIEffort, AIModel } from '../../../types';
import { updateAppSettings } from '../../../db';
import { MODEL_LABELS } from '../../../ai/client';
import { useAppSettings } from '../../../state/hooks';
import { toast, errorMessage } from '../../../state/store';
import { useOnline } from '../../../lib/useOnline';
import { Button, Callout, Card, CardHeader, Field, IconButton, Input, Segmented, Select, Switch, cx } from '../../ui';
import { looksLikeAnthropicKey, maskApiKey } from '../settingsLogic';

const FREE_FEATURES = [
  'Lectura de facturas en PDF, foto o Excel',
  'Lectura de cartas desde una foto',
  'Propuesta de recetas con la base de recetas local',
  'Cotejo de ingredientes, escandallos, mermas e informes',
];

const EFFORT_OPTIONS: { value: AIEffort; label: string }[] = [
  { value: 'low', label: 'Rápido' },
  { value: 'medium', label: 'Equilibrado' },
  { value: 'high', label: 'Preciso' },
];

/** IA opcional (desactivada por defecto): la extracción ya es gratuita y local. */
export function AiCard({ id }: { id?: string }) {
  const settings = useAppSettings();
  const online = useOnline();
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const hasKey = !!settings.apiKey;
  const draftTrim = keyDraft.trim();
  const keyWarning = draftTrim && !looksLikeAnthropicKey(draftTrim) ? 'No parece una clave de Anthropic: suelen empezar por «sk-ant-».' : undefined;

  const save = async (patch: Parameters<typeof updateAppSettings>[0], message?: string) => {
    try {
      await updateAppSettings(patch);
      if (message) toast.success(message);
    } catch (e) {
      toast.error('No se pudo guardar', errorMessage(e));
    }
  };

  const saveKey = async () => {
    if (!draftTrim) return;
    await save({ apiKey: draftTrim }, 'Clave guardada en este dispositivo');
    setKeyDraft('');
    setShowKey(false);
    setTestResult(null);
  };

  const test = async () => {
    const key = draftTrim || settings.apiKey;
    if (!key) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { testApiKey } = await import('../../../ai/client');
      const r = await testApiKey(key, settings.aiModel);
      setTestResult(r);
      if (r.ok) toast.ai('Conexión correcta', r.message);
      else toast.error('La conexión ha fallado', r.message);
    } catch (e) {
      const r = { ok: false, message: errorMessage(e) };
      setTestResult(r);
      toast.error('La conexión ha fallado', r.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader
        icon={<Sparkles className="size-5" />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Inteligencia artificial
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-muted">Opcional</span>
          </span>
        }
        subtitle="Un extra para los documentos más difíciles. No lo necesitas para usar la app."
      />

      <div className="rounded-2xl border border-ok/30 bg-ok-soft p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ok text-white">
            <Lock className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-ink">La lectura de facturas y cartas ya es gratis</div>
            <p className="mt-0.5 text-sm text-ink-2">
              Funciona en tu dispositivo, sin conexión y sin enviar tus datos a nadie. Esto es lo que ya tienes sin IA:
            </p>
            <ul className="mt-2 grid gap-1 text-sm text-ink-2 sm:grid-cols-2">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-1.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <Switch
          checked={settings.aiEnabled}
          onChange={(v) => save({ aiEnabled: v }, v ? 'IA activada para documentos difíciles' : 'IA desactivada: todo se procesa en tu dispositivo')}
          label="Usar la IA de Claude para casos difíciles"
          description="Más precisión con fotos muy dañadas, facturas manuscritas o formatos poco habituales, y propuestas de receta más afinadas. Necesita conexión y tu propia clave de Anthropic."
        />
      </div>

      {settings.aiEnabled && (
        <div className="mt-5 animate-slide-up space-y-5 border-t border-line pt-5">
          {!hasKey && (
            <Callout tone="warn" title="Falta tu clave de Anthropic">
              Mientras no la añadas, todo se sigue leyendo gratis en tu dispositivo.
            </Callout>
          )}
          {!online && (
            <Callout tone="info" title="Sin conexión">
              La IA no está disponible ahora mismo; la lectura local sigue funcionando con normalidad.
            </Callout>
          )}

          <div>
            <Field
              label="Clave de la API de Anthropic"
              error={keyWarning}
              hint={
                hasKey ? (
                  <>
                    Guardada: <span className="font-mono">{maskApiKey(settings.apiKey)}</span>. Escribe otra para sustituirla.
                  </>
                ) : (
                  'Se guarda solo en este dispositivo y únicamente se usa para hablar directamente con Anthropic.'
                )
              }
            >
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                    placeholder={hasKey ? maskApiKey(settings.apiKey) : 'sk-ant-…'}
                    autoComplete="off"
                    spellCheck={false}
                    className="pr-11 font-mono"
                  />
                  <IconButton label={showKey ? 'Ocultar clave' : 'Mostrar clave'} onClick={() => setShowKey((s) => !s)} className="absolute right-0.5 top-0.5">
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </IconButton>
                </div>
                <Button onClick={saveKey} disabled={!draftTrim} icon={<KeyRound className="size-4" />}>
                  Guardar
                </Button>
              </div>
            </Field>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={test} loading={testing} disabled={(!draftTrim && !hasKey) || !online} icon={<PlugZap className="size-4" />}>
                Probar conexión
              </Button>
              {hasKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 className="size-4" />}
                  onClick={async () => {
                    await save({ apiKey: undefined }, 'Clave eliminada de este dispositivo');
                    setTestResult(null);
                  }}
                >
                  Borrar clave
                </Button>
              )}
              <a
                href="https://console.anthropic.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1 px-2 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
              >
                Conseguir una clave en console.anthropic.com <ExternalLink className="size-3.5" />
              </a>
            </div>
            {testResult && (
              <div className={cx('mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-sm', testResult.ok ? 'bg-ok-soft text-ink-2' : 'bg-bad-soft text-ink-2')} role="status">
                {testResult.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" />}
                {testResult.message}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Modelo" hint={MODEL_LABELS[settings.aiModel]?.hint}>
              <Select value={settings.aiModel} onChange={(e) => save({ aiModel: e.target.value as AIModel })}>
                {(Object.keys(MODEL_LABELS) as AIModel[]).map((m) => (
                  <option key={m} value={m}>
                    {MODEL_LABELS[m].label}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-ink-2">Esfuerzo de análisis</span>
              <Segmented<AIEffort> value={settings.aiEffort} onChange={(v) => save({ aiEffort: v })} options={EFFORT_OPTIONS} />
              <span className="mt-1 block text-xs text-muted">Más esfuerzo = más precisión, pero tarda más.</span>
            </div>
          </div>

          <p className="text-xs text-muted">
            Con la IA activada, los documentos que se procesen con ella se envían a Anthropic para leerlos y el uso se factura en tu propia cuenta de Anthropic. Si
            la IA falla o no hay conexión, la app vuelve automáticamente a la lectura local gratuita.
          </p>
        </div>
      )}
    </Card>
  );
}
