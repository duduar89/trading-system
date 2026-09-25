import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ExternalLink, FileText, ImageOff, Minus, Plus, RotateCcw } from 'lucide-react';
import { IconButton } from '../ui';

/**
 * URLs temporales de varios Blobs (se liberan al desmontar). IndexedDB devuelve Blobs nuevos en cada lectura,
 * así que la identidad se basa en tamaño y tipo para no recrear (y hacer parpadear) las imágenes en cada guardado.
 */
export function useObjectUrls(blobs: Blob[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  const latest = useRef(blobs);
  latest.current = blobs;
  const key = blobs.map((b) => `${b.size}:${b.type}`).join('|');
  useEffect(() => {
    const list = latest.current.map((b) => URL.createObjectURL(b));
    setUrls(list);
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, [key]);
  return urls;
}

export function isPdf(b: Blob | undefined): boolean {
  return !!b && (b.type === 'application/pdf' || b.type.endsWith('/pdf'));
}

const ZOOMS = [1, 1.5, 2, 3];

/** Visor de las fotos de la carta: miniaturas, vista grande y zoom (clic para ampliar). */
export function MenuPhotoViewer({ images, className }: { images: Blob[]; className?: string }) {
  const urls = useObjectUrls(images);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(0);
  const i = Math.min(index, Math.max(0, images.length - 1));
  const blob = images[i];
  const url = urls[i];
  const z = ZOOMS[zoom];

  if (!images.length) {
    return (
      <div className={clsx('flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong bg-surface-2 text-sm text-muted', className)}>
        <ImageOff className="size-8" />
        Sin imágenes guardadas
      </div>
    );
  }

  return (
    <div className={clsx('space-y-3', className)}>
      <div className="relative overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-card">
        {isPdf(blob) ? (
          <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-bad-soft text-bad">
              <FileText className="size-8" />
            </div>
            <div className="text-sm font-semibold text-ink">Carta en PDF</div>
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Abrir el PDF <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        ) : (
          <div className="max-h-[72vh] overflow-auto overscroll-contain" style={{ touchAction: z > 1 ? 'pan-x pan-y' : undefined }}>
            {url ? (
              <img
                src={url}
                alt={`Página ${i + 1} de la carta`}
                onClick={() => setZoom((v) => (v === 0 ? 2 : 0))}
                className={clsx('block max-w-none select-none transition-[width] duration-200', z > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in')}
                style={{ width: `${z * 100}%` }}
                draggable={false}
              />
            ) : (
              <div className="aspect-[3/4] animate-pulse-soft bg-line" />
            )}
          </div>
        )}
        {!isPdf(blob) && (
          <div className="absolute bottom-2.5 right-2.5 flex items-center gap-0.5 rounded-xl border border-line bg-elevated/90 p-0.5 shadow-pop backdrop-blur">
            <IconButton label="Alejar" onClick={() => setZoom((v) => Math.max(0, v - 1))} disabled={zoom === 0}>
              <Minus className="size-4" />
            </IconButton>
            <span className="tabular w-11 text-center text-xs font-semibold text-ink-2">{Math.round(z * 100)} %</span>
            <IconButton label="Acercar" onClick={() => setZoom((v) => Math.min(ZOOMS.length - 1, v + 1))} disabled={zoom === ZOOMS.length - 1}>
              <Plus className="size-4" />
            </IconButton>
            {zoom > 0 && (
              <IconButton label="Tamaño original" onClick={() => setZoom(0)}>
                <RotateCcw className="size-4" />
              </IconButton>
            )}
          </div>
        )}
        {images.length > 1 && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-ink/75 px-2 py-0.5 text-[11px] font-semibold text-bg backdrop-blur">
            Página {i + 1} de {images.length}
          </span>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Páginas de la carta">
          {images.map((b, k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === i}
              aria-label={`Página ${k + 1}`}
              onClick={() => {
                setIndex(k);
                setZoom(0);
              }}
              className={clsx(
                'relative size-16 shrink-0 overflow-hidden rounded-xl border-2 bg-surface-2 transition',
                k === i ? 'border-brand-500 shadow-glow' : 'border-line opacity-70 hover:opacity-100',
              )}
            >
              {isPdf(b) ? (
                <FileText className="m-auto size-6 text-muted" />
              ) : urls[k] ? (
                <img src={urls[k]} alt="" className="size-full object-cover" />
              ) : null}
              <span className="absolute bottom-0.5 right-1 text-[10px] font-bold text-white drop-shadow">{k + 1}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
