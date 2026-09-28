import type { FetchAsset } from './modelCache';
import type { PaddleOptions } from './paddleOcr';
import type { GrayImage } from './imageOps';
import type { TessPage } from './ocrLayout';

/**
 * Modelos del lector PaddleOCR y protocolo con su worker (sin dependencias pesadas: lo importan el hilo principal y el
 * worker).
 *
 * PP-OCRv5 (PaddlePaddle, licencia Apache-2.0): detección «mobile» (4,8 MB) + reconocimiento LATINO «mobile» (8 MB,
 * 836 caracteres: tildes, ñ, ü, ç, €, cifras y signos). Se sirven con la propia app (public/ocr-models, fuera del
 * precache del service worker) y se guardan en caché la primera vez que se lee una foto.
 */

export interface PaddleModelFiles {
  det: FetchAsset;
  rec: FetchAsset;
  dict: FetchAsset;
  /** Parámetros de detección recomendados para este modelo. */
  options: PaddleOptions;
}

/** Rutas relativas a la raíz de la app (se resuelven con `paddleModelFiles`). */
const FILES = {
  det: { path: 'ocr-models/ppocrv5-mobile-det.onnx', size: 4826518, sha256: 'a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d' },
  rec: { path: 'ocr-models/ppocrv5-latin-mobile-rec.onnx', size: 8042023, sha256: '7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498' },
  dict: { path: 'ocr-models/ppocrv5-latin-dict.txt' },
} as const;

/** Archivos del modelo con URL absoluta a partir de la dirección base de la app. */
export function paddleModelFiles(baseUrl: string): PaddleModelFiles {
  const abs = (p: string) => new URL(p, baseUrl).href;
  return {
    det: { url: abs(FILES.det.path), size: FILES.det.size, sha256: FILES.det.sha256, strict: true },
    rec: { url: abs(FILES.rec.path), size: FILES.rec.size, sha256: FILES.rec.sha256, strict: true },
    dict: { url: abs(FILES.dict.path) },
    options: {},
  };
}

/** Tamaño aproximado del binario WebAssembly de ONNX Runtime (sólo para la barra de progreso). */
const ORT_WASM_SIZE = 14_239_897;

/** Ruta (relativa a la raíz de la app) del binario de ONNX Runtime Web, copiado de node_modules al construir. */
export const ORT_WASM_PATH = 'ocr-runtime/ort/ort-wasm-simd-threaded.wasm';

/**
 * Binario WebAssembly de ONNX Runtime Web, servido por la propia app (misma versión que el motor JS empaquetado,
 * sin depender de ningún CDN: funciona también en redes que bloquean servicios externos).
 */
export function ortWasmAsset(baseUrl: string): FetchAsset {
  return { url: new URL(ORT_WASM_PATH, baseUrl).href, size: ORT_WASM_SIZE };
}

/** Descarga total de la primera vez (para avisar al usuario): motor + modelos. */
export const PADDLE_DOWNLOAD_BYTES = ORT_WASM_SIZE + FILES.det.size + FILES.rec.size;

// ───────────────────────────── Protocolo con el worker ─────────────────────────────

export type PaddleWorkerRequest =
  | { type: 'init'; baseUrl: string }
  | { type: 'recognize'; id: number; image: GrayImage; options?: PaddleOptions };

export type PaddleWorkerResponse =
  | { type: 'download'; fraction?: number }
  | { type: 'stage'; stage: 'init' }
  | { type: 'ready' }
  | { type: 'progress'; id: number; fraction: number }
  | { type: 'result'; id: number; page: TessPage }
  | { type: 'error'; id?: number; message: string };
