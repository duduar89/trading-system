import { useState, type ReactNode } from 'react';
import { ChefHat, Database, FileSpreadsheet, Info, Printer, ShieldCheck, Tags } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast, errorMessage } from '../../../state/store';
import { Button, Callout, Card, cx } from '../../ui';
import { downloadWorkspaceBackup } from '../backup';
import { backupFileName } from '../settingsLogic';
import type { ReportsData } from './useReportsData';

function ExportCard({
  icon,
  tone,
  title,
  description,
  meta,
  action,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  description: ReactNode;
  meta?: ReactNode;
  action: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <span className={cx('flex size-12 items-center justify-center rounded-2xl', tone)}>{icon}</span>
      <h3 className="mt-4 font-display text-lg font-bold text-ink">{title}</h3>
      <p className="mt-1 flex-1 text-sm text-muted">{description}</p>
      {meta && <div className="mt-3 text-xs font-semibold text-ink-2">{meta}</div>}
      <div className="mt-4">{action}</div>
    </Card>
  );
}

export function ExportTab({ data }: { data: ReportsData }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<'escandallos' | 'ingredientes' | 'backup' | null>(null);
  const wsName = data.workspace?.name ?? 'restaurante';
  const platos = data.dishes.filter((d) => d.kind === 'plato').length;
  const elaboraciones = data.dishes.length - platos;

  const run = async (kind: 'escandallos' | 'ingredientes' | 'backup') => {
    setBusy(kind);
    try {
      if (kind === 'backup') {
        if (!data.workspace) throw new Error('No hay restaurante activo');
        await downloadWorkspaceBackup(data.workspace.id);
        return;
      }
      const { exportEscandallosXlsx, exportProductsXlsx, downloadBlob } = await import('../../../lib/export');
      if (kind === 'escandallos') {
        if (!data.workspace) throw new Error('No hay restaurante activo');
        const blob = await exportEscandallosXlsx({ workspace: data.workspace, dishes: data.dishes, costs: data.costs, ctx: data.ctx, business: data.business });
        downloadBlob(blob, backupFileName(wsName, new Date(), 'xlsx').replace('escandallo-pro_', 'escandallos_'));
        toast.success('Excel de escandallos descargado', `${platos} platos y ${elaboraciones} elaboraciones, con una hoja por ficha técnica.`);
      } else {
        const blob = await exportProductsXlsx(data.products, data.suppliers);
        downloadBlob(blob, backupFileName(wsName, new Date(), 'xlsx').replace('escandallo-pro_', 'ingredientes_'));
        toast.success('Excel de ingredientes descargado', `${data.products.length} ingredientes con su precio y merma.`);
      }
    } catch (e) {
      toast.error('No se pudo exportar', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ExportCard
          icon={<FileSpreadsheet className="size-6" />}
          tone="bg-ok-soft text-ok"
          title="Excel de escandallos"
          description="Resumen de toda la carta (PVP, coste, food cost, margen, merma y PVP sugerido) y una hoja con la ficha técnica de cada plato."
          meta={`${platos} platos · ${elaboraciones} elaboraciones`}
          action={
            <Button block loading={busy === 'escandallos'} disabled={!data.dishes.length || busy != null} onClick={() => run('escandallos')} icon={<ChefHat className="size-4" />}>
              Descargar Excel
            </Button>
          }
        />
        <ExportCard
          icon={<Tags className="size-6" />}
          tone="bg-brand-500/12 text-brand-500"
          title="Excel de ingredientes"
          description="Tu base de precios: cada ingrediente con su categoría, precio por unidad, proveedor, última compra, mermas y alérgenos."
          meta={`${data.products.length} ingredientes · ${data.suppliers.length} proveedores`}
          action={
            <Button block variant="outline" loading={busy === 'ingredientes'} disabled={!data.products.length || busy != null} onClick={() => run('ingredientes')} icon={<FileSpreadsheet className="size-4" />}>
              Descargar Excel
            </Button>
          }
        />
        <ExportCard
          icon={<Database className="size-6" />}
          tone="bg-info-soft text-info"
          title="Copia de seguridad"
          description="Todo el restaurante en un archivo JSON para guardarlo, pasarlo a otro dispositivo o restaurarlo desde Ajustes."
          meta={`${data.invoices.length} facturas · ${data.yieldTests.length} pruebas de rendimiento`}
          action={
            <Button block variant="outline" loading={busy === 'backup'} disabled={busy != null} onClick={() => run('backup')} icon={<ShieldCheck className="size-4" />}>
              Descargar copia (JSON)
            </Button>
          }
        />
      </div>

      <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-ink-2">
          <Printer className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-base font-bold text-ink">Fichas técnicas para cocina</div>
          <p className="text-sm text-muted">Abre cualquier escandallo y pulsa «Imprimir» para obtener su ficha técnica con ingredientes, gramajes, alérgenos y elaboración.</p>
        </div>
        <Button variant="outline" onClick={() => navigate('/platos')}>
          Ir a escandallos
        </Button>
      </Card>

      <Callout tone="info" icon={<Info className="size-4" />}>
        Los archivos se generan en tu dispositivo: no se sube nada a ningún servidor. La copia de seguridad no incluye las fotos y PDF originales de facturas y
        cartas.
      </Callout>
    </div>
  );
}
