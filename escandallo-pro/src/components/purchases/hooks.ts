import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { subscribeInvoiceQueue, type QueueState } from '../../services/invoices';

/** URL temporal (blob:) para mostrar un archivo; se libera sola al cambiar o desmontar. */
export function useObjectUrl(blob: Blob | undefined | null): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** Media query reactiva (p. ej. '(min-width: 640px)'). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Estado en vivo de la cola de lectura de facturas (null si el servicio aún no está disponible). */
export function useInvoiceQueue(): QueueState | null {
  const [state, setState] = useState<QueueState | null>(null);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    try {
      unsub = subscribeInvoiceQueue(setState);
    } catch {
      // La cola aún no está disponible: la lista sigue funcionando con el estado de cada factura.
      unsub = undefined;
    }
    return () => unsub?.();
  }, []);
  return state;
}

/** true cuando la app está en tema oscuro (clase .dark en <html>). */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const obs = new MutationObserver(cb);
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      return () => obs.disconnect();
    },
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );
}

export interface ChartColors {
  series: string;
  grid: string;
  axis: string;
  surface: string;
  ink: string;
}

/**
 * Colores de gráfico resueltos desde los tokens del tema (SVG no hereda bien var() en atributos).
 * La serie usa el naranja de marca validado para cada fondo: #ff5a1f en claro y #f5501a en oscuro.
 */
export function useChartColors(): ChartColors {
  const dark = useIsDark();
  const read = (v: string, fallback: string) => {
    const s = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    return s || fallback;
  };
  return {
    series: dark ? '#f5501a' : '#ff5a1f',
    grid: read('--t-line', dark ? '#222c39' : '#e6e9ee'),
    axis: read('--t-muted', dark ? '#8a97a8' : '#677486'),
    surface: read('--t-surface', dark ? '#121821' : '#ffffff'),
    ink: read('--t-ink', dark ? '#f3f5f8' : '#0b0f14'),
  };
}

/**
 * Llama a `fn` tras `delay` ms sin nuevas llamadas. Devuelve [programar, ejecutar ya, cancelar].
 * Al desmontar ejecuta lo pendiente para no perder cambios.
 */
export function useDebouncedAction<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): [(...args: A) => void, () => void, () => void] {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<A | null>(null);
  const flush = useRef(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const args = pending.current;
    pending.current = null;
    if (args) fnRef.current(...args);
  });
  const schedule = useRef((...args: A) => {
    pending.current = args;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush.current, delay);
  });
  const cancel = useRef(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  });
  useEffect(() => {
    const f = flush.current;
    return () => f();
  }, []);
  return [schedule.current, flush.current, cancel.current];
}
