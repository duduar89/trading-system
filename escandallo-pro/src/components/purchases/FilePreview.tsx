import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ExternalLink, FileQuestion, FileText, ImageOff, Maximize2, Minimize2, ScanText } from 'lucide-react';
import { Segmented, Spinner } from '../ui';
import { fileKind } from '../../extract/index';
import { useObjectUrl } from './hooks';

/** Páginas de un PDF renderizadas a imagen con pdf.js (funciona igual en escritorio, Android e iOS). */
function usePdfPages(file: Blob | undefined, enabled: boolean): { pages: string[]; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ pages: string[]; loading: boolean; failed: boolean }>({ pages: [], loading: false, failed: false });
  useEffect(() => {
    if (!file || !enabled) {
      setState({ pages: [], loading: false, failed: false });
      return;
    }
    let cancelled = false;
    let urls: string[] = [];
    setState({ pages: [], loading: true, failed: false });
    import('../../extract/pdf')
      .then(({ pdfToImages }) => pdfToImages(file, { scale: 2, maxSide: 1800, maxPages: 12 }))
      .then((blobs) => {
        if (cancelled) return;
        urls = blobs.map((b) => URL.createObjectURL(b));
        setState({ pages: urls, loading: false, failed: urls.length === 0 });
      })
      .catch(() => {
        if (!cancelled) setState({ pages: [], loading: false, failed: true });
      });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [file, enabled]);
  return state;
}

/**
 * Visor del documento original de una factura: páginas del PDF, foto con zoom (clic para alternar
 * ajustar / tamaño real) y, como alternativa, el texto leído (útil para comprobar qué ha entendido el lector).
 */
export function FilePreview({
  file,
  fileName,
  fileType,
  rawText,
  className,
}: {
  file?: Blob;
  fileName?: string;
  fileType?: string;
  rawText?: string;
  className?: string;
}) {
  const url = useObjectUrl(file);
  const kind = file ? fileKind({ name: fileName, type: fileType || file.type }) : 'unknown';
  const viewable = !!file && (kind === 'pdf' || kind === 'image');
  const hasText = !!rawText?.trim();
  const [tab, setTab] = useState<'doc' | 'text'>(viewable ? 'doc' : 'text');
  const [zoom, setZoom] = useState(false);
  const [imgError, setImgError] = useState(false);
  const current = viewable ? tab : 'text';
  const pdf = usePdfPages(file, kind === 'pdf');
  const zoomable = current === 'doc' && ((kind === 'image' && !imgError) || (kind === 'pdf' && pdf.pages.length > 0));

  return (
    <div className={clsx('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card', className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          <FileText className="size-4 shrink-0 text-muted" />
          <span className="truncate" title={fileName}>
            {fileName || 'Documento'}
          </span>
          {kind === 'pdf' && pdf.pages.length > 1 && (
            <span className="shrink-0 text-xs font-medium text-muted">· {pdf.pages.length} páginas</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {viewable && hasText && (
            <Segmented
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'doc', label: 'Original' },
                { value: 'text', label: 'Texto leído' },
              ]}
            />
          )}
          {zoomable && (
            <button
              type="button"
              onClick={() => setZoom((z) => !z)}
              className="inline-flex size-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink"
              aria-label={zoom ? 'Ajustar a la ventana' : 'Ampliar'}
              title={zoom ? 'Ajustar a la ventana' : 'Ampliar'}
            >
              {zoom ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
          )}
          {url && viewable && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex size-9 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink"
              aria-label="Abrir en una pestaña nueva"
              title="Abrir en una pestaña nueva"
            >
              <ExternalLink className="size-4" />
            </a>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 bg-surface-2">
        {current === 'doc' && kind === 'pdf' && pdf.loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted">
            <Spinner className="size-6" /> Preparando la vista previa…
          </div>
        )}
        {current === 'doc' && kind === 'pdf' && pdf.pages.length > 0 && (
          <div className={clsx('absolute inset-0 overflow-auto p-3', zoom ? 'cursor-zoom-out' : 'cursor-zoom-in')} onClick={() => setZoom((z) => !z)}>
            <div className={clsx('mx-auto space-y-3', zoom ? 'w-[200%] max-w-none' : 'w-full max-w-3xl')}>
              {pdf.pages.map((src, i) => (
                <img
                  key={src}
                  src={src}
                  alt={`Página ${i + 1} de ${pdf.pages.length} de ${fileName ?? 'la factura'}`}
                  className="w-full select-none rounded-lg bg-white shadow-card"
                  draggable={false}
                />
              ))}
            </div>
          </div>
        )}
        {current === 'doc' && url && kind === 'pdf' && pdf.failed && (
          <iframe src={`${url}#view=FitH`} title={`Factura original ${fileName ?? ''}`} className="absolute inset-0 size-full border-0 bg-surface-2" />
        )}
        {current === 'doc' && url && kind === 'image' && !imgError && (
          <div
            className={clsx('absolute inset-0 overflow-auto', zoom ? 'cursor-zoom-out' : 'flex cursor-zoom-in items-start justify-center p-3')}
            onClick={() => setZoom((z) => !z)}
          >
            <img
              src={url}
              alt={`Factura original ${fileName ?? ''}`}
              onError={() => setImgError(true)}
              className={clsx('select-none', zoom ? 'max-w-none' : 'max-h-full max-w-full rounded-lg object-contain shadow-card')}
              draggable={false}
            />
          </div>
        )}
        {current === 'doc' && kind === 'image' && imgError && (
          <Placeholder icon={<ImageOff className="size-6" />} title="Tu navegador no puede mostrar esta foto">
            Algunos formatos (como HEIC del iPhone) no se previsualizan en todos los navegadores. La factura se ha leído igualmente: puedes ver el texto leído
            {url && (
              <>
                {' '}
                o{' '}
                <a href={url} download={fileName} className="font-semibold text-brand-600 underline dark:text-brand-400">
                  descargar el original
                </a>
              </>
            )}
            .
          </Placeholder>
        )}
        {current === 'text' &&
          (hasText ? (
            <pre className="absolute inset-0 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-relaxed text-ink-2">{rawText}</pre>
          ) : file ? (
            <Placeholder icon={<FileQuestion className="size-6" />} title="Vista previa no disponible">
              Este tipo de archivo (por ejemplo, una hoja de cálculo) no se puede mostrar aquí.
            </Placeholder>
          ) : (
            <Placeholder icon={<ScanText className="size-6" />} title="Sin documento original">
              Esta factura se ha introducido a mano. Copia los datos del papel en el formulario.
            </Placeholder>
          ))}
      </div>
    </div>
  );
}

function Placeholder({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-60 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-surface text-muted shadow-card">{icon}</div>
      <div className="font-display text-base font-bold text-ink">{title}</div>
      <p className="mt-1 max-w-xs text-sm text-muted">{children}</p>
    </div>
  );
}
