import type * as Ort from 'onnxruntime-web';
// El motor JS de ONNX Runtime se emite tal cual (?url) y se importa bajo demanda: así Vite no copia a la build el
// binario WebAssembly de 14 MB (se descarga una vez de cdn.jsdelivr.net y queda en caché, ver `cachedAsset`)
import ortModuleUrl from 'onnxruntime-web/wasm?url';
import { cachedAsset } from './modelCache';
import { paddleRecognize, parseCharDict, type PaddleOptions, type PaddleRunner, type PaddleTensor } from './paddleOcr';
import { ortWasmAsset, paddleModelFiles, type PaddleWorkerRequest, type PaddleWorkerResponse } from './paddleModel';

/**
 * Worker del lector PaddleOCR: carga ONNX Runtime Web (WebAssembly, un hilo), descarga los modelos (sólo la primera
 * vez; después, de la caché) y lee las páginas que le manda `paddleEngine.ts`. Todo el cálculo pesado (redes,
 * preparación de tensores, cajas, CTC) ocurre aquí, sin congelar la interfaz.
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope;

interface Loaded {
  runner: PaddleRunner;
  dict: string[];
  options: PaddleOptions;
}

let loading: Promise<Loaded> | undefined;

function post(msg: PaddleWorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

async function load(baseUrl: string): Promise<Loaded> {
  const ort = (await import(/* @vite-ignore */ ortModuleUrl)) as typeof Ort;
  const model = paddleModelFiles(baseUrl);
  const files = [ortWasmAsset(ort.env.versions.web ?? ort.env.versions.common), model.det, model.rec, model.dict];
  const total = files.reduce((s, f) => s + (f.size ?? 0), 0);
  const done = new Map<string, number>();
  let downloading = false;
  const bytes = await Promise.all(
    files.map((f) =>
      cachedAsset(f, (received, _total, fromCache) => {
        done.set(f.url, Math.min(received, f.size ?? received));
        // Sólo se informa de descargas reales (lo que ya está en caché se lee en un instante)
        if (fromCache && !downloading) return;
        downloading = true;
        const sum = [...done.values()].reduce((s, v) => s + v, 0);
        post({ type: 'download', fraction: total ? Math.min(1, sum / total) : undefined });
      }),
    ),
  );
  const [wasm, det, rec, dict] = bytes;
  post({ type: 'stage', stage: 'init' });
  ort.env.wasm.wasmBinary = wasm;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';
  const opts: Ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 };
  const detSession = await ort.InferenceSession.create(new Uint8Array(det), opts);
  const recSession = await ort.InferenceSession.create(new Uint8Array(rec), opts);
  const run = async (session: Ort.InferenceSession, input: Float32Array, dims: number[]): Promise<PaddleTensor> => {
    const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, dims) };
    const out = await session.run(feeds);
    const t = out[session.outputNames[0]];
    const data = t.data as Float32Array;
    const res = { data, dims: [...t.dims] };
    for (const k of Object.keys(out)) if (out[k] !== t) out[k].dispose();
    return res;
  };
  return {
    runner: {
      detect: (input, h, w) => run(detSession, input, [1, 3, h, w]),
      recognize: (input, n, h, w) => run(recSession, input, [n, 3, h, w]),
    },
    dict: parseCharDict(new TextDecoder().decode(dict)),
    options: model.options,
  };
}

let baseUrl = '';

ctx.onmessage = async (ev: MessageEvent<PaddleWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    baseUrl = msg.baseUrl;
    try {
      loading ??= load(baseUrl);
      await loading;
      post({ type: 'ready' });
    } catch (err) {
      loading = undefined;
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (msg.type === 'recognize') {
    try {
      if (!baseUrl) throw new Error('El lector no está preparado');
      loading ??= load(baseUrl);
      const { runner, dict, options } = await loading;
      const page = await paddleRecognize(msg.image, runner, dict, { ...options, ...msg.options }, (fraction) => post({ type: 'progress', id: msg.id, fraction }));
      post({ type: 'result', id: msg.id, page });
    } catch (err) {
      post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
};
