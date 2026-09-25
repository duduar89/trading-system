import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import clsx from 'clsx';
import { Check, ChevronsUpDown, Plus, Store } from 'lucide-react';
import { createWorkspace, setCurrentWorkspaceId, updateAppSettings } from '../db';
import { useCurrentWorkspace, useWorkspaces } from '../state/hooks';
import { useUI, toast } from '../state/store';
import { Button, Field, Input, Modal } from './ui';

export async function switchWorkspace(id: string) {
  setCurrentWorkspaceId(id);
  await updateAppSettings({ currentWorkspaceId: id });
  useUI.getState().setWorkspaceId(id);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function WorkspaceAvatar({ name, color, size = 'md' }: { name: string; color?: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={clsx('flex shrink-0 items-center justify-center rounded-lg font-display font-bold text-white', size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs')}
      style={{ background: color ?? '#0b0f14' }}
    >
      {initials(name) || <Store className="size-4" />}
    </span>
  );
}

const COLORS = ['#ff5a1f', '#8b5cf6', '#10b981', '#3b82f6', '#f43f5e', '#f59e0b', '#0ea5e9', '#14b8a6'];

export function NewWorkspaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const ws = await createWorkspace({ name: name.trim(), businessType: businessType.trim() || undefined, city: city.trim() || undefined, color: COLORS[Math.floor(Math.random() * COLORS.length)] });
      await switchWorkspace(ws.id);
      toast.success(`«${ws.name}» creado`, 'Empieza subiendo facturas o fotografiando la carta.');
      onClose();
      setName('');
      navigate('/');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo restaurante o cliente"
      subtitle="Cada espacio tiene sus propias facturas, ingredientes y escandallos."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim()}>
            Crear
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Taberna La Lonja" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo de negocio">
            <Input value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder="Restaurante, bar…" />
          </Field>
          <Field label="Ciudad">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Madrid" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function WorkspaceSwitcher({ compact }: { compact?: boolean }) {
  const workspaces = useWorkspaces() ?? [];
  const current = useCurrentWorkspace();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface-2 text-left transition hover:border-line-strong',
          compact ? 'px-2 py-1.5' : 'px-2.5 py-2',
        )}
      >
        <WorkspaceAvatar name={current?.name ?? '?'} color={current?.color} size={compact ? 'sm' : 'md'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-ink">{current?.name ?? '—'}</div>
          {!compact && <div className="truncate text-[11px] text-muted">{[current?.businessType, current?.city].filter(Boolean).join(' · ') || 'Espacio de trabajo'}</div>}
        </div>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-2 min-w-[240px] animate-slide-up rounded-2xl border border-line bg-elevated p-1.5 shadow-pop">
          <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">Restaurantes / clientes</div>
          <div className="max-h-72 overflow-y-auto">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={async () => {
                  setOpen(false);
                  if (w.id !== current?.id) {
                    await switchWorkspace(w.id);
                    navigate('/');
                  }
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-surface-2"
              >
                <WorkspaceAvatar name={w.name} color={w.color} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{w.name}</span>
                {w.id === current?.id && <Check className="size-4 text-brand-500" />}
              </button>
            ))}
          </div>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-semibold text-brand-600 hover:bg-surface-2 dark:text-brand-400"
          >
            <Plus className="size-4" /> Nuevo restaurante o cliente
          </button>
        </div>
      )}
      <NewWorkspaceModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
