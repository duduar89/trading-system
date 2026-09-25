import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Check, Save, Store, Trash2 } from 'lucide-react';
import type { Workspace } from '../../../types';
import { deleteWorkspace, metaDb, setCurrentWorkspaceId, updateAppSettings } from '../../../db';
import { nowIso } from '../../../lib/id';
import { useWorkspaces } from '../../../state/hooks';
import { useUI, toast, errorMessage } from '../../../state/store';
import { WorkspaceAvatar, switchWorkspace } from '../../WorkspaceSwitcher';
import { Button, Card, CardHeader, Field, Input, Modal, cx } from '../../ui';
import { confirmNameMatches } from '../settingsLogic';

const COLORS = ['#ff5a1f', '#8b5cf6', '#10b981', '#3b82f6', '#f43f5e', '#f59e0b', '#0ea5e9', '#14b8a6', '#475569'];
const COLOR_NAMES: Record<string, string> = {
  '#ff5a1f': 'Tomate',
  '#8b5cf6': 'Violeta',
  '#10b981': 'Esmeralda',
  '#3b82f6': 'Azul',
  '#f43f5e': 'Frambuesa',
  '#f59e0b': 'Ámbar',
  '#0ea5e9': 'Cielo',
  '#14b8a6': 'Turquesa',
  '#475569': 'Pizarra',
};
const BUSINESS_TYPES = [
  'Restaurante',
  'Bar de tapas',
  'Cafetería',
  'Gastrobar',
  'Catering',
  'Hotel',
  'Grupo de restauración',
  'Cliente de consultoría',
];

type Draft = { name: string; businessType: string; city: string; color?: string };

function draftOf(ws: Workspace): Draft {
  return { name: ws.name, businessType: ws.businessType ?? '', city: ws.city ?? '', color: ws.color };
}

function DeleteWorkspaceDialog({ ws, open, onClose }: { ws: Workspace; open: boolean; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const workspaces = useWorkspaces() ?? [];
  const navigate = useNavigate();
  const matches = confirmNameMatches(typed, ws.name);

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      const other = workspaces.find((w) => w.id !== ws.id);
      // Primero salimos del espacio (para que ninguna pantalla siga leyendo su base de datos) y después lo borramos.
      if (other) {
        await switchWorkspace(other.id);
      } else {
        setCurrentWorkspaceId(null);
        await updateAppSettings({ currentWorkspaceId: undefined });
        useUI.getState().setWorkspaceId(null);
      }
      navigate('/');
      await deleteWorkspace(ws.id);
      toast.success(`«${ws.name}» eliminado`, other ? `Ahora estás en «${other.name}».` : undefined);
    } catch (e) {
      toast.error('No se pudo eliminar el restaurante', errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) {
          setTyped('');
          onClose();
        }
      }}
      title="Eliminar restaurante"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirm} disabled={!matches} loading={busy} icon={<Trash2 className="size-4" />}>
            Eliminar para siempre
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl bg-bad-soft p-3 text-sm text-ink-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" />
          <p>
            Se borrarán <strong className="text-ink">todas</strong> las facturas, ingredientes, escandallos y pruebas de merma de «{ws.name}» de este
            dispositivo. No se puede deshacer. Si quieres conservarlos, descarga antes una copia de seguridad.
          </p>
        </div>
        <Field label={<>Escribe «{ws.name}» para confirmar</>}>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirm()}
            autoComplete="off"
            placeholder={ws.name}
          />
        </Field>
      </div>
    </Modal>
  );
}

/** Datos del restaurante / cliente activo: nombre, tipo, ciudad y color; y su eliminación. */
export function WorkspaceCard({ ws, id }: { ws: Workspace; id?: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const d = draft ?? draftOf(ws);
  const base = draftOf(ws);
  const dirty =
    draft != null &&
    (d.name.trim() !== base.name || d.businessType.trim() !== base.businessType || d.city.trim() !== base.city || d.color !== base.color);
  const nameError = !d.name.trim() ? 'El nombre no puede quedar vacío' : undefined;
  const set = (patch: Partial<Draft>) => setDraft({ ...d, ...patch });

  const save = async () => {
    if (!dirty || nameError) return;
    setSaving(true);
    try {
      await metaDb.workspaces.update(ws.id, {
        name: d.name.trim(),
        businessType: d.businessType.trim() || undefined,
        city: d.city.trim() || undefined,
        color: d.color,
        updatedAt: nowIso(),
      });
      setDraft(null);
      toast.success('Datos del restaurante guardados');
    } catch (e) {
      toast.error('No se pudieron guardar los cambios', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader
        icon={<Store className="size-5" />}
        title="Restaurante o cliente"
        subtitle="Cómo se llama y cómo lo distingues de otros espacios."
      />
      <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
        <WorkspaceAvatar name={d.name || '?'} color={d.color} />
        <div className="min-w-0">
          <div className="truncate font-semibold text-ink">{d.name || 'Sin nombre'}</div>
          <div className="truncate text-xs text-muted">{[d.businessType, d.city].filter(Boolean).join(' · ') || 'Espacio de trabajo'}</div>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" error={draft ? nameError : undefined} className="sm:col-span-2">
          <Input value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Tipo de negocio">
          <Input
            value={d.businessType}
            onChange={(e) => set({ businessType: e.target.value })}
            list="ep-business-types"
            placeholder="Restaurante, bar, catering…"
            maxLength={60}
          />
          <datalist id="ep-business-types">
            {BUSINESS_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Ciudad">
          <Input value={d.city} onChange={(e) => set({ city: e.target.value })} placeholder="Madrid" maxLength={60} />
        </Field>
      </div>
      <div className="mt-4">
        <span className="mb-1.5 block text-xs font-semibold text-ink-2" id="ws-color-label">
          Color
        </span>
        <div role="radiogroup" aria-labelledby="ws-color-label" className="flex flex-wrap gap-2">
          {COLORS.map((c) => {
            const on = d.color === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={COLOR_NAMES[c] ?? c}
                title={COLOR_NAMES[c] ?? c}
                onClick={() => set({ color: c })}
                className={cx(
                  'flex size-10 items-center justify-center rounded-xl ring-offset-2 ring-offset-surface transition hover:scale-105',
                  on ? 'ring-2 ring-ink' : 'ring-1 ring-line',
                )}
                style={{ background: c }}
              >
                {on && <Check className="size-4 text-white" />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="ghost"
          className="text-bad! hover:bg-bad-soft! hover:text-bad!"
          icon={<Trash2 className="size-4" />}
          onClick={() => setDeleting(true)}
        >
          Eliminar restaurante
        </Button>
        <div className="flex gap-2">
          {dirty && (
            <Button variant="outline" onClick={() => setDraft(null)} className="flex-1 sm:flex-none">
              Descartar
            </Button>
          )}
          <Button onClick={save} loading={saving} disabled={!dirty || !!nameError} icon={<Save className="size-4" />} className="flex-1 sm:flex-none">
            Guardar cambios
          </Button>
        </div>
      </div>
      <DeleteWorkspaceDialog ws={ws} open={deleting} onClose={() => setDeleting(false)} />
    </Card>
  );
}
