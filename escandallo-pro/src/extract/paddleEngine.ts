import type { ProgressFn } from '../types';
import type { GrayImage } from './imageOps';
import type { TessPage } from './ocrLayout';
import type { PaddleWorkerRequest, PaddleWorkerResponse } from './paddleModel';

/**
 * Lector PaddleOCR del navegador (lado del hilo principal): arranca el worker (`paddle.worker.ts`) bajo demanda, le
 * pasa las páginas y devuelve la lectura con el mismo formato que Tesseract. Gratis y en el dispositivo: la foto no
 * sale del navegador; sólo la primera vez se descargan el motor y los modelos (~27 MB), que quedan en caché para
 * trabajar sin conexión.
 *
 * Si el navegador no puede (sin WebAssembly SIMD, sin workers de módulo, descarga fallida…) `getPaddleEngine` falla con
 * un error claro y el OCR sigue con Tesseract.
 */

export interface PaddleEngine {
  recognize(image: GrayImage, onProgress?: (fraction: number) => void): Promise<TessPage>;
}

/** Módulo WebAssembly mínimo con una instrucción SIMD (misma prueba que wasm-feature-detect). */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

/** ¿Puede este navegador usar el lector PaddleOCR? (WebAssembly con SIMD y workers). */
export function paddleSupported(): boolean {
  try {
    return typeof Worker !== 'undefined' && typeof WebAssembly === 'object' && typeof WebAssembly.validate === 'function' && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

const IDLE_MS = 90_000;
const DOWNLOAD_STAGE = 'Descargando el modelo de lectura (solo la primera vez)…';
const INIT_STAGE = 'Preparando el lector de texto…';

interface Pending {
  resolve: (page: TessPage) => void;
  reject: (err: Error) => void;
  onProgress?: (fraction: number) => void;
}

let worker: Worker | undefined;
let ready: Promise<PaddleEngine> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();
/** Destino del progreso de la carga en curso. */
let loadSink: ProgressFn | undefined;
/** Fallo permanente en esta sesión (p. ej. el navegador no puede compilar el motor): no se reintenta. */
let broken: Error | undefined;

function friendly(message: string): Error {
  if (/fetch|network|HTTP|descargar|Failed to/i.test(message)) {
    return new Error('No se ha podido descargar el modelo de lectura: la primera vez necesita conexión (unos 27 MB). Después funciona sin conexión.');
  }
  return new Error(message || 'Error del lector de texto');
}

function baseUrl(): string {
  if (typeof document !== 'undefined' && document.baseURI) return document.baseURI;
  return typeof location !== 'undefined' ? location.href : '/';
}

function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!pending.size) terminatePaddle();
  }, IDLE_MS);
}

/** Libera el worker y la memoria del motor. Se vuelve a crear cuando haga falta (los modelos ya están en caché). */
export function terminatePaddle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
  const err = new Error('Lectura cancelada');
  for (const p of pending.values()) p.reject(err);
  pending.clear();
  worker?.terminate();
  worker = undefined;
  ready = undefined;
}

function send(msg: PaddleWorkerRequest, transfer: Transferable[] = []): void {
  worker?.postMessage(msg, transfer);
}

/**
 * Motor listo para leer (arranca el worker, descarga o lee de la caché el motor y los modelos). `onLoad` recibe las
 * etapas de la carga («Descargando el modelo de lectura (solo la primera vez)… 40 %»).
 */
export function getPaddleEngine(onLoad?: ProgressFn): Promise<PaddleEngine> {
  loadSink = onLoad;
  if (broken) return Promise.reject(broken);
  if (ready) return ready;
  if (!paddleSupported()) {
    broken = new Error('Este navegador no admite el lector avanzado (WebAssembly SIMD)');
    return Promise.reject(broken);
  }
  const starting = new Promise<PaddleEngine>((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL('./paddle.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      broken = new Error(`No se ha podido iniciar el lector avanzado (${err instanceof Error ? err.message : String(err)})`);
      reject(broken);
      return;
    }
    worker = w;
    const engine: PaddleEngine = {
      recognize(image, onProgress) {
        if (!worker) return Promise.reject(new Error('El lector no está disponible'));
        const id = nextId++;
        if (idleTimer) clearTimeout(idleTimer);
        return new Promise<TessPage>((res, rej) => {
          pending.set(id, { resolve: res, reject: rej, onProgress });
          // Copia de la imagen: la original la siguen usando las demás pasadas
          const copy: GrayImage = { width: image.width, height: image.height, data: image.data.slice() };
          send({ type: 'recognize', id, image: copy }, [copy.data.buffer as ArrayBuffer]);
        });
      },
    };
    w.onmessage = (ev: MessageEvent<PaddleWorkerResponse>) => {
      const msg = ev.data;
      switch (msg.type) {
        case 'download':
          loadSink?.({ stage: msg.fraction === undefined ? DOWNLOAD_STAGE : `${DOWNLOAD_STAGE} ${Math.round(msg.fraction * 100)} %` });
          break;
        case 'stage':
          loadSink?.({ stage: INIT_STAGE });
          break;
        case 'ready':
          resolve(engine);
          // Si después no se le pide nada, se libera igualmente al cabo de un rato
          if (!pending.size) scheduleIdle();
          break;
        case 'progress':
          pending.get(msg.id)?.onProgress?.(msg.fraction);
          break;
        case 'result': {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          p?.resolve(msg.page);
          if (!pending.size) scheduleIdle();
          break;
        }
        case 'error': {
          if (msg.id === undefined) {
            // Fallo al cargar: el OCR seguirá con Tesseract
            const err = friendly(msg.message);
            terminatePaddle();
            reject(err);
            break;
          }
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          p?.reject(friendly(msg.message));
          if (!pending.size) scheduleIdle();
          break;
        }
      }
    };
    w.onerror = (e) => {
      e.preventDefault();
      // Un worker que no llega a arrancar (módulo que no carga, memoria) no se reintenta en esta sesión
      broken = new Error(`El lector avanzado no ha podido arrancar${e.message ? ` (${e.message})` : ''}`);
      const err = broken;
      terminatePaddle();
      reject(err);
    };
    send({ type: 'init', baseUrl: baseUrl() });
  });
  ready = starting;
  starting.catch(() => {
    if (ready === starting) ready = undefined;
  });
  return starting;
}
