import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import clsx from 'clsx';
import { Camera, FileText, Images, Loader2, Lightbulb, ShieldCheck, Sparkles, Trash2, Upload, WifiOff, Infinity as InfinityIcon, ChevronRight } from 'lucide-react';
import type { MenuScan } from '../types';
import { useMenuScans } from '../state/hooks';
import { errorMessage, toast } from '../state/store';
import { addMenuScan, deleteMenuScan } from '../services/menus';
import { fmtDate } from '../lib/format';
import { Badge, ConfirmDialog, FileDrop, IconButton, PageHeader, Spinner } from '../components/ui';
import { useObjectUrl } from '../components/dishes/hooks';
import { isPdf } from '../components/dishes/MenuPhotoViewer';
import { SCAN_STATUS } from '../components/dishes/menuScanStore';

function acceptable(f: File): boolean {
  const n = f.name.toLowerCase();
  return f.type.startsWith('image/') || f.type === 'application/pdf' || /\.(jpe?g|png|webp|heic|heif|gif|bmp|pdf)$/.test(n);
}

export default function Menu() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const scans = useMenuScans();
  const [highlight] = useState(() => params.get('nuevo') === '1');
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<MenuScan | null>(null);

  useEffect(() => {
    if (params.get('nuevo') === '1') {
      const next = new URLSearchParams(params);
      next.delete('nuevo');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const onFiles = async (files: File[]) => {
    const ok = files.filter(acceptable);
    if (ok.length < files.length) toast.info('Algunos archivos no son fotos ni PDF', 'Los hemos dejado fuera.');
    if (!ok.length) return;
    setAdding(true);
    try {
      const id = await addMenuScan(ok);
      navigate(`/carta/${id}`);
    } catch (e) {
      toast.error('No se pudo leer la carta', errorMessage(e));
      setAdding(false);
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Carta" title="Tu carta, en escandallos" subtitle="De la foto de la carta a la receta y el food cost de cada plato." />

      {/* ── Hero ── */}
      <section className="hero-mesh relative mb-8 overflow-hidden rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-ok/30 bg-ok-soft px-2.5 py-1 text-[11px] font-bold text-ok">
              <ShieldCheck className="size-3.5" /> Gratis, en tu dispositivo, sin enviar tus datos a nadie
            </div>
            <h2 className="mt-3 font-display text-[26px] font-extrabold leading-tight text-ink sm:text-4xl">
              Fotografía tu carta y <span className="text-gradient-brand inline-block">te proponemos los escandallos</span>
            </h2>
            <p className="mt-3 max-w-lg text-sm text-ink-2 max-sm:hidden sm:text-[15px]">
              Leemos platos, secciones y precios; tú revisas en un minuto y creamos cada plato con su receta tipo, gramajes y mermas, cruzada con los precios de tus facturas.
            </p>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-ink-2">
              <li className="inline-flex items-center gap-1.5">
                <InfinityIcon className="size-4 text-brand-500" /> Sin límite de cartas
              </li>
              <li className="inline-flex items-center gap-1.5">
                <WifiOff className="size-4 text-brand-500" /> Funciona sin conexión
              </li>
              <li className="inline-flex items-center gap-1.5">
                <Images className="size-4 text-brand-500" /> Varias páginas a la vez
              </li>
            </ul>
          </div>

          <div className="relative">
            <div className={clsx('grid gap-3 sm:grid-cols-2', adding && 'pointer-events-none opacity-40')}>
              <div className={clsx('rounded-[1.4rem] transition', highlight && 'ring-4 ring-brand-500/35 shadow-glow')}>
                <FileDrop
                  accept="image/*"
                  capture="environment"
                  multiple
                  onFiles={onFiles}
                  compact
                  icon={<Camera className="size-6" />}
                  title="Hacer foto"
                  description="Con la cámara del móvil. Puedes añadir varias fotos (una por página)."
                  className={clsx('h-full border-brand-400! bg-brand-500/8! backdrop-blur', highlight && 'border-brand-500!')}
                />
              </div>
              <FileDrop
                accept="image/*,.pdf,application/pdf"
                multiple
                onFiles={onFiles}
                compact
                icon={<Upload className="size-6" />}
                title="Subir fotos o PDF"
                description="Arrastra aquí las imágenes o el PDF de tu carta."
                className="h-full bg-surface/80 backdrop-blur"
              />
            </div>
            {adding && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-ink" role="status">
                <Spinner className="size-7" />
                Preparando las fotos…
              </div>
            )}
            <p className="mt-3 flex items-start gap-2 text-xs text-muted">
              <Lightbulb className="mt-px size-4 shrink-0 text-warn" />
              Para una lectura perfecta: carta plana, de frente y con buena luz, sin reflejos y una página por foto.
            </p>
          </div>
        </div>
      </section>

      {/* ── Cartas leídas ── */}
      {scans === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-64 animate-pulse-soft rounded-2xl bg-surface shadow-card" />
          ))}
        </div>
      ) : scans.length ? (
        <section aria-labelledby="scans-title">
          <div className="mb-3 flex items-end justify-between">
            <h2 id="scans-title" className="font-display text-xl font-extrabold text-ink">
              Cartas leídas
            </h2>
            <span className="text-xs text-muted">
              {scans.length} {scans.length === 1 ? 'carta' : 'cartas'}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {scans.map((s) => (
              <ScanCard key={s.id} scan={s} onDelete={() => setToDelete(s)} />
            ))}
          </div>
        </section>
      ) : (
        <HowItWorks />
      )}

      <ConfirmDialog
        open={toDelete != null}
        onClose={() => setToDelete(null)}
        danger
        confirmLabel="Eliminar"
        title="¿Eliminar esta carta?"
        message="Se borrarán las fotos y la lista de platos detectados. Los platos que ya importaste se quedan en Escandallos."
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await deleteMenuScan(toDelete.id);
            toast.success('Carta eliminada');
          } catch (e) {
            toast.error('No se pudo eliminar', errorMessage(e));
          }
        }}
      />
    </div>
  );
}

function ScanCard({ scan, onDelete }: { scan: MenuScan; onDelete: () => void }) {
  const first = scan.images[0];
  const url = useObjectUrl(first && !isPdf(first) ? first : undefined);
  const status = SCAN_STATUS[scan.status];
  const imported = scan.entries.filter((e) => e.dishId).length;
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop">
      <div className="relative aspect-[16/10] overflow-hidden bg-surface-2">
        {url ? (
          <img src={url} alt="" className="size-full object-cover object-top transition duration-500 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted">{first && isPdf(first) ? <FileText className="size-10" /> : <Camera className="size-10" />}</div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent" aria-hidden />
        <div className="absolute left-3 top-3">
          <Badge tone={status.tone} className="shadow-card" icon={scan.status === 'procesando' ? <Loader2 className="size-3 animate-spin" /> : undefined}>
            {status.label}
          </Badge>
        </div>
        {scan.images.length > 1 && (
          <span className="absolute bottom-2.5 left-3 inline-flex items-center gap-1 text-[11px] font-semibold text-white">
            <Images className="size-3.5" /> {scan.images.length} páginas
          </span>
        )}
        {scan.method === 'ia' && (
          <span className="absolute bottom-2.5 right-3 inline-flex items-center gap-1 text-[11px] font-semibold text-white">
            <Sparkles className="size-3.5" /> IA
          </span>
        )}
      </div>
      <div className="flex items-start gap-2 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base font-bold text-ink">
            <Link to={`/carta/${scan.id}`} className="outline-none after:absolute after:inset-0 after:z-[1] after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-brand-500">
              {scan.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {fmtDate(scan.createdAt)}
            {scan.status !== 'procesando' && (
              <>
                {' · '}
                {scan.entries.length} {scan.entries.length === 1 ? 'plato' : 'platos'}
                {imported > 0 && ` · ${imported} importados`}
              </>
            )}
          </p>
        </div>
        <IconButton label={`Eliminar ${scan.name}`} onClick={onDelete} className="relative z-[2] -mr-1 size-10 hover:text-bad">
          <Trash2 className="size-4" />
        </IconButton>
        <ChevronRight className="mt-2.5 size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
      </div>
    </article>
  );
}

function HowItWorks() {
  const steps = [
    { n: 1, icon: <Camera className="size-5" />, t: 'Foto de la carta', d: 'Una foto por página, o el PDF. La leemos en tu propio móvil u ordenador.' },
    { n: 2, icon: <FileText className="size-5" />, t: 'Revisa en un minuto', d: 'Platos agrupados por sección con su precio, al lado de la foto para comparar.' },
    { n: 3, icon: <Sparkles className="size-5" />, t: 'Escandallos propuestos', d: 'Cada plato con su receta tipo, mermas y food cost, listo para ajustar.' },
  ];
  return (
    <section aria-labelledby="how-title">
      <h2 id="how-title" className="mb-3 font-display text-xl font-extrabold text-ink">
        Cómo funciona
      </h2>
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card">
            <span className="absolute right-4 top-3 font-display text-[64px] font-extrabold leading-none text-brand-500/12" aria-hidden>
              {s.n}
            </span>
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-500/12 text-brand-500">{s.icon}</span>
            <h3 className="mt-3 font-display text-base font-bold text-ink">{s.t}</h3>
            <p className="mt-1 text-sm text-muted">{s.d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
