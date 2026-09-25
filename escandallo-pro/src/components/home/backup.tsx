import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Download, Upload } from 'lucide-react';
import { exportWorkspace, importWorkspace } from '../../db';
import { downloadBlob } from '../../lib/export';
import { toast, errorMessage } from '../../state/store';
import { switchWorkspace } from '../WorkspaceSwitcher';
import { Button, type ButtonProps } from '../ui';
import { backupFileName, backupSummary, parseBackup } from './settingsLogic';

/** Descarga la copia de seguridad JSON de un espacio de trabajo. */
export async function downloadWorkspaceBackup(workspaceId: string): Promise<void> {
  const backup = await exportWorkspace(workspaceId);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  downloadBlob(blob, backupFileName(backup.workspace.name));
  const s = backupSummary(backup);
  toast.success(
    'Copia de seguridad descargada',
    `${s.products} ingredientes, ${s.dishes} platos y ${s.invoices} facturas. Guárdala en un lugar seguro.`,
  );
}

/** Botón que descarga la copia de seguridad del espacio indicado. */
export function ExportBackupButton({
  workspaceId,
  label = 'Descargar copia (JSON)',
  ...rest
}: Omit<ButtonProps, 'onClick'> & { workspaceId: string | undefined; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      icon={<Download className="size-4" />}
      {...rest}
      loading={busy}
      disabled={!workspaceId || rest.disabled}
      onClick={async () => {
        if (!workspaceId) return;
        setBusy(true);
        try {
          await downloadWorkspaceBackup(workspaceId);
        } catch (e) {
          toast.error('No se pudo exportar la copia', errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

/**
 * Botón para restaurar una copia de seguridad (.json). Siempre crea un espacio NUEVO, nunca sobrescribe.
 * Tras restaurar, activa el espacio y lleva al panel.
 */
export function RestoreBackupButton({ label = 'Restaurar copia', ...rest }: Omit<ButtonProps, 'onClick'> & { label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const backup = parseBackup(await file.text());
      const ws = await importWorkspace(backup);
      await switchWorkspace(ws.id);
      navigate('/');
      const s = backupSummary(backup);
      toast.success(`«${ws.name}» restaurado`, `${s.products} ingredientes y ${s.dishes} platos recuperados.`);
    } catch (e) {
      toast.error('No se pudo restaurar la copia', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" icon={<Upload className="size-4" />} {...rest} loading={busy} onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void onFile(f);
        }}
      />
    </>
  );
}
