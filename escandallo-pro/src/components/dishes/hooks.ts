import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/** true mientras la media query se cumple (reactivo). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * URL temporal de un Blob (se libera sola al desmontar o al cambiar el Blob). IndexedDB entrega un Blob nuevo
 * en cada lectura: la identidad se basa en tamaño y tipo para no recrear la URL en cada cambio de la BD.
 */
export function useObjectUrl(blob: Blob | undefined | null): string | undefined {
  const [url, setUrl] = useState<string>();
  const latest = useRef(blob);
  latest.current = blob;
  const key = blob ? `${blob.size}:${blob.type}` : '';
  useEffect(() => {
    const b = latest.current;
    if (!b) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(b);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [key]);
  return url;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Autoguardado con espera (debounce). `schedule(v)` programa el guardado del último valor;
 * `flush()` lo fuerza ya (antes de navegar o de lanzar una acción que lea de la BD).
 * `isPending()` indica si hay cambios locales aún no guardados (para no pisar el borrador con datos de la BD).
 * Los guardados se encadenan para respetar el orden aunque el usuario escriba muy rápido.
 */
export function useAutosave<T>(save: (value: T) => Promise<void>, delay = 400, onError?: (e: unknown) => void) {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<{ value: T } | null>(null);
  const version = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(false);
  const saveRef = useRef(save);
  const errRef = useRef(onError);
  useEffect(() => {
    saveRef.current = save;
    errRef.current = onError;
  });

  const run = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const job = latest.current;
    if (!job) return chain.current;
    latest.current = null;
    const v = version.current;
    const p = chain.current.then(async () => {
      try {
        await saveRef.current(job.value);
        if (v === version.current) {
          pending.current = false;
          setState('saved');
        }
      } catch (e) {
        // Se conserva el cambio sin guardar (no se pisa con datos de la BD) para poder reintentar.
        if (!latest.current) latest.current = job;
        setState('error');
        errRef.current?.(e);
      }
    });
    chain.current = p;
    return p;
  }, []);

  const schedule = useCallback(
    (value: T) => {
      latest.current = { value };
      version.current++;
      pending.current = true;
      setState('saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), delay);
    },
    [delay, run],
  );

  /** Guarda ya lo pendiente (también sirve para reintentar tras un error). */
  const flush = useCallback(() => run(), [run]);
  const isPending = useCallback(() => pending.current, []);

  // Al salir de la pantalla o cerrar la pestaña, guarda lo pendiente.
  useEffect(() => {
    const onHide = () => {
      if (latest.current) void run();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      if (latest.current) void run();
    };
  }, [run]);

  return { state, schedule, flush, isPending };
}
