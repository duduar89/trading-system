import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AlertTriangle, ArrowLeft, Camera, ChefHat, Download, Image as ImageIcon, ListChecks, RefreshCw, Sparkles, Trash2, XCircle } from 'lucide-react';
import type { MenuEntry } from '../types';
import { useAppSettings, useDishes, useMenuScans } from '../state/hooks';
import { errorMessage, toast } from '../state/store';
import { deleteMenuScan, importMenuEntries, processMenuScan } from '../services/menus';
import { aiAvailable } from '../extract/index';
import { db } from '../db';
import { METHOD_LABELS } from '../lib/labels';
import { fmtDate } from '../lib/format';
import { Badge, Button, Callout, Card, ConfirmDialog, EmptyState, IconButton, Segmented, Switch } from '../components/ui';
import { MenuPhotoViewer } from '../components/dishes/MenuPhotoViewer';
import { MenuEntriesEditor } from '../components/dishes/MenuEntriesEditor';
import { ScanningState } from '../components/dishes/ScanningState';
import { TaskProgressModal, type TaskProgress } from '../components/dishes/ProposeModal';
import { useAutosave, useMediaQuery } from '../components/dishes/hooks';
import { entriesSummary, sectionsOf } from '../components/dishes/logic';
import { SCAN_STATUS, saveMenuScanPatch, scanWarnings } from '../components/dishes/menuScanStore';

export default function MenuReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const scans = useMenuScans();
  const dishes = useDishes();
  const settings = useAppSettings();
  const aiOn = aiAvailable(settings);
  const wide = useMediaQuery('(min-width: 640px)');
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [pane, setPane] = useState<'platos' | 'foto'>('platos');
  const scan = scans?.find((s) => s.id === id);

  const [entries, setEntriesState] = useState<MenuEntry[] | null>(null);
  const entriesRef = useRef<MenuEntry[] | null>(null);
  const setEntries = useCallback((e: MenuEntry[] | null) => {
    entriesRef.current = e;
    setEntriesState(e);
  }, []);
  const saver = useAutosave<MenuEntry[]>(
    (list) => (id ? saveMenuScanPatch(id, { entries: list }) : Promise.resolve()),
    400,
    (e) => toast.error('No se pudieron guardar los cambios', errorMessage(e)),
  );
  const { isPending, schedule, flush } = saver;

  // Sincroniza con la BD sin pisar lo que se está editando.
  const scanEntries = scan?.entries;
  const scanStatus = scan?.status;
  useEffect(() => {
    if (!scanEntries) return;
    if (!entriesRef.current || !isPending()) setEntries(scanEntries);
  }, [scanEntries, scanStatus, isPending, setEntries]);

  const change = (list: MenuEntry[]) => {
    setEntries(list);
    schedule(list);
  };

  const [propose, setPropose] = useState(true);
  const [createMissing, setCreateMissing] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<TaskProgress>({ done: 0, total: 0, stage: '' });
  const [reprocess, setReprocess] = useState<null | 'local' | 'ai'>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const knownSections = useMemo(() => sectionsOf(dishes ?? []), [dishes]);
  const list = entries ?? scan?.entries ?? [];
  const summary = useMemo(() => entriesSummary(list), [list]);
  const importable = list.filter((e) => e.selected && e.name.trim()).length;
  const unnamed = list.filter((e) => e.selected && !e.name.trim()).length;

  if (scans && !scan) {
    return (
      <EmptyState
        icon={<Camera className="size-7" />}
        title="No encontramos esta carta"
        description="Puede que se haya eliminado."
        action={
          <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/carta')}>
            Volver a Carta
          </Button>
        }
      />
    );
  }
  if (!scan) return <ReviewSkeleton />;

  const runReprocess = (mode: 'local' | 'ai') => {
    processMenuScan(scan.id, { forceLocal: mode === 'local' }).catch((e) => toast.error('No se pudo leer la carta', errorMessage(e)));
    setEntries(null);
  };

  const doImport = async () => {
    if (!importable) return;
    await flush();
    if (unnamed) {
      const cleaned = list.map((e) => (e.selected && !e.name.trim() ? { ...e, selected: false } : e));
      setEntries(cleaned);
      await saveMenuScanPatch(scan.id, { entries: cleaned });
    }
    setImporting(true);
    setProgress({ done: 0, total: importable, stage: 'Creando platos…' });
    try {
      const ids = await importMenuEntries(scan.id, {
        propose,
        createMissing: propose && createMissing,
        onProgress: (done, total, stage) => setProgress({ done, total, stage }),
      });
      // Cuántos han salido con receta propuesta (lectura puntual para dar el mensaje exacto).
      const imported = await db().dishes.bulkGet(ids);
      const withRecipe = imported.filter((d) => d && d.items.length > 0).length;
      toast.success(
        `${ids.length} ${ids.length === 1 ? 'plato importado' : 'platos importados'}`,
        withRecipe ? `${withRecipe} con receta propuesta: revísalas.` : 'Ábrelos para añadir o proponer su receta.',
      );
      navigate(`/platos?recientes=1&propuestos=${withRecipe}`);
    } catch (e) {
      toast.error('No se pudo importar la carta', errorMessage(e));
    } finally {
      setImporting(false);
    }
  };

  const warnings = scanWarnings(scan);
  const status = SCAN_STATUS[scan.status];

  return (
    <div>
      {/* ── Cabecera ── */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link to="/carta" className="mb-2 inline-flex h-9 items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-ink">
            <ArrowLeft className="size-4" /> Carta
          </Link>
          <h1 className="truncate font-display text-2xl font-extrabold text-ink sm:text-3xl">{scan.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone={status.tone}>{status.label}</Badge>
            {scan.method && <Badge tone={scan.method === 'ia' ? 'ai' : 'neutral'}>Leída con {METHOD_LABELS[scan.method]}</Badge>}
            <span>{fmtDate(scan.createdAt)}</span>
            <span>·</span>
            <span>
              {scan.images.length} {scan.images.length === 1 ? 'foto' : 'fotos'}
            </span>
          </div>
        </div>
        {scan.status !== 'procesando' && (
          <div className="flex flex-wrap items-center gap-2">
            {scan.status !== 'error' && (
              <Button variant="outline" icon={<RefreshCw className="size-4" />} onClick={() => setReprocess('local')}>
                Volver a leer
              </Button>
            )}
            {aiOn && (
              <Button variant="outline" icon={<Sparkles className="size-4 text-ai" />} onClick={() => setReprocess('ai')}>
                Leer con IA
              </Button>
            )}
            <IconButton label="Eliminar esta carta" onClick={() => setConfirmDelete(true)} className="size-10 border border-line text-bad hover:bg-bad-soft hover:text-bad">
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        )}
      </div>

      {scan.status === 'procesando' ? (
        <ScanningState scanId={scan.id} image={scan.images[0]} pages={scan.images.length} ai={aiOn} startedAt={scan.createdAt} onRetry={() => runReprocess('local')} />
      ) : scan.status === 'error' ? (
        <Card className="mx-auto max-w-2xl text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-bad-soft text-bad">
            <XCircle className="size-7" />
          </div>
          <h2 className="mt-4 font-display text-xl font-extrabold text-ink">No hemos podido leer esta carta</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{scan.error || 'La imagen no se ha podido procesar.'}</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted">Consejo: foto de frente, con buena luz, sin reflejos y una página por foto.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button icon={<RefreshCw className="size-4" />} onClick={() => runReprocess('local')}>
              Volver a leer
            </Button>
            <Button variant="outline" icon={<Camera className="size-4" />} onClick={() => navigate('/carta?nuevo=1')}>
              Hacer otras fotos
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-5 space-y-3">
            {warnings.map((w, i) => (
              <Callout key={i} tone="warn" icon={<AlertTriangle className="size-4" />}>
                {w}
              </Callout>
            ))}
            {scan.status === 'importada' && (
              <Callout tone="ok" title="Carta ya importada">
                {summary.imported} {summary.imported === 1 ? 'plato está' : 'platos están'} en tus escandallos. Si vuelves a importar, los que ya existen sólo actualizan PVP y sección.
              </Callout>
            )}
            {(summary.withoutPrice > 0 || summary.lowConfidence > 0) && (
              <Callout tone="info" title="Compara con la foto antes de importar">
                {summary.lowConfidence > 0 && `${summary.lowConfidence} ${summary.lowConfidence === 1 ? 'línea marcada' : 'líneas marcadas'} con «Revisa» por lectura dudosa. `}
                {summary.withoutPrice > 0 && `${summary.withoutPrice} ${summary.withoutPrice === 1 ? 'plato seleccionado no tiene' : 'platos seleccionados no tienen'} PVP: sin él no podremos calcular su food cost.`}
              </Callout>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
            {!desktop && (
              <Segmented<'platos' | 'foto'>
                value={pane}
                onChange={setPane}
                className="w-full [&>button]:flex-1 [&>button]:justify-center"
                options={[
                  { value: 'platos', label: `Platos (${summary.total})`, icon: <ListChecks className="size-4" /> },
                  { value: 'foto', label: scan.images.length > 1 ? `Fotos (${scan.images.length})` : 'Foto', icon: <ImageIcon className="size-4" /> },
                ]}
              />
            )}
            {(desktop || pane === 'foto') && (
              <div className="lg:sticky lg:top-4">
                <MenuPhotoViewer images={scan.images} />
              </div>
            )}
            {(desktop || pane === 'platos') && <MenuEntriesEditor entries={list} onChange={change} knownSections={knownSections} />}
          </div>

          {/* ── Barra de importación ── */}
          <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 mt-6 lg:bottom-4 lg:mr-20">
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated/95 p-3 shadow-pop backdrop-blur-xl sm:p-3.5 lg:flex-row lg:items-center lg:gap-6 lg:p-4">
              <div className="grid flex-1 grid-cols-2 gap-3 sm:gap-6">
                <Switch
                  checked={propose}
                  onChange={setPropose}
                  label={wide ? 'Proponer ingredientes automáticamente' : 'Proponer receta'}
                  description={wide ? (aiOn ? 'Con tu IA opcional o la base de recetas local' : 'Receta tipo con gramajes y mermas. Gratis, en tu dispositivo.') : undefined}
                />
                <div className={propose ? '' : 'pointer-events-none opacity-50'}>
                  <Switch
                    checked={createMissing}
                    onChange={setCreateMissing}
                    label={wide ? 'Crear ingredientes que falten con precio estimado' : 'Crear los que falten'}
                    description={wide ? 'Se corrige solo al subir tus facturas' : undefined}
                  />
                </div>
              </div>
              <Button size="lg" icon={<Download className="size-5" />} onClick={doImport} disabled={!importable || importing} className="lg:min-w-60">
                Importar {importable} {importable === 1 ? 'plato' : 'platos'}
              </Button>
            </div>
          </div>
        </>
      )}

      <TaskProgressModal
        open={importing}
        title={
          <span className="inline-flex items-center gap-2">
            <ChefHat className="size-5 text-brand-500" /> Importando la carta
          </span>
        }
        progress={progress}
        ai={propose && aiOn}
      />
      <ConfirmDialog
        open={reprocess != null}
        onClose={() => setReprocess(null)}
        onConfirm={() => reprocess && runReprocess(reprocess)}
        title={reprocess === 'ai' ? '¿Leer la carta con IA?' : '¿Volver a leer la carta?'}
        confirmLabel={reprocess === 'ai' ? 'Leer con IA' : 'Volver a leer'}
        message={
          reprocess === 'ai'
            ? 'Usaremos la IA opcional que has activado en Ajustes. Se sustituirán los platos detectados y los cambios que hayas hecho aquí.'
            : 'Se volverá a leer en tu dispositivo, gratis. Se sustituirán los platos detectados y los cambios que hayas hecho aquí.'
        }
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        confirmLabel="Eliminar"
        title="¿Eliminar esta carta?"
        message="Se borrarán las fotos y la lista de platos detectados. Los platos que ya importaste se quedan en Escandallos."
        onConfirm={async () => {
          try {
            await deleteMenuScan(scan.id);
            toast.success('Carta eliminada');
            navigate('/carta', { replace: true });
          } catch (e) {
            toast.error('No se pudo eliminar', errorMessage(e));
          }
        }}
      />
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="animate-pulse-soft space-y-5" aria-busy="true" aria-label="Cargando carta">
      <div className="h-5 w-20 rounded bg-line" />
      <div className="h-8 w-1/2 rounded-xl bg-line" />
      <div className="grid gap-6 lg:grid-cols-[5fr_7fr]">
        <div className="aspect-[3/4] rounded-2xl bg-surface shadow-card" />
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-surface shadow-card" />
          ))}
        </div>
      </div>
    </div>
  );
}
