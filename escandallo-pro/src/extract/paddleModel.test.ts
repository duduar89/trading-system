import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedAsset, MODEL_CACHE, verifyAsset } from './modelCache';
import { ortWasmAsset, paddleModelFiles } from './paddleModel';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
// SHA-256 de «hola»
const HOLA_SHA = 'b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('archivos del modelo', () => {
  it('se resuelven junto a la app aunque esté en una subruta y con el enrutado por # (HashRouter)', () => {
    const f = paddleModelFiles('https://example.com/app/#/carta?nuevo=1');
    expect(f.det.url).toBe('https://example.com/app/ocr-models/ppocrv5-mobile-det.onnx');
    expect(f.rec.url).toBe('https://example.com/app/ocr-models/ppocrv5-latin-mobile-rec.onnx');
    expect(f.dict.url).toBe('https://example.com/app/ocr-models/ppocrv5-latin-dict.txt');
    expect(f.det).toMatchObject({ strict: true, size: 4826518 });
    expect(f.rec.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el binario WebAssembly sale de la CDN con la misma versión que el motor JS', () => {
    expect(ortWasmAsset('1.30.0').url).toBe('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm');
  });
});

describe('caché de modelos', () => {
  it('valida tamaño y SHA-256', async () => {
    expect(await verifyAsset(bytes('hola'), { url: 'x', size: 4, strict: true, sha256: HOLA_SHA })).toBe(true);
    expect(await verifyAsset(bytes('hola'), { url: 'x', size: 5, strict: true })).toBe(false);
    expect(await verifyAsset(bytes('hola'), { url: 'x', sha256: '0'.repeat(64) })).toBe(false);
    expect(await verifyAsset(new ArrayBuffer(0), { url: 'x' })).toBe(false);
    // Sin `strict`, el tamaño sólo sirve para el progreso
    expect(await verifyAsset(bytes('hola'), { url: 'x', size: 99 })).toBe(true);
  });

  it('sin Cache Storage (contexto no seguro) descarga, informa del progreso y valida', async () => {
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes('hola'))));
    const seen: [number, number | undefined, boolean][] = [];
    const buf = await cachedAsset({ url: 'https://e/x.onnx', size: 4, strict: true, sha256: HOLA_SHA }, (r, t, c) => seen.push([r, t, c]));
    expect(new TextDecoder().decode(buf)).toBe('hola');
    expect(seen[seen.length - 1]).toEqual([4, 4, false]);
  });

  it('una descarga dañada no se da por buena', async () => {
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes('hol'))));
    await expect(cachedAsset({ url: 'https://e/x.onnx', size: 4, strict: true })).rejects.toThrow(/incompleta o dañada/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 404 })));
    await expect(cachedAsset({ url: 'https://e/x.onnx' })).rejects.toThrow(/HTTP 404/);
  });

  it('abandona una descarga que se queda parada (para seguir con otro motor)', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('caches', undefined);
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init?: RequestInit) =>
            new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('abortada', 'AbortError')))),
        ),
      );
      const p = cachedAsset({ url: 'https://e/lento.onnx' });
      const check = expect(p).rejects.toThrow(/se ha detenido/);
      await vi.advanceTimersByTimeAsync(31_000);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });

  it('guarda en su caché la primera vez y después no vuelve a descargar', async () => {
    const store = new Map<string, Response>();
    const cache = {
      put: async (url: string, res: Response) => void store.set(url, res),
      delete: async (url: string) => store.delete(url),
    };
    vi.stubGlobal('caches', {
      open: async (name: string) => {
        expect(name).toBe(MODEL_CACHE);
        return cache;
      },
      match: async (url: string) => store.get(url)?.clone(),
    });
    const fetchMock = vi.fn(async () => new Response(bytes('hola')));
    vi.stubGlobal('fetch', fetchMock);
    const asset = { url: 'https://e/modelo.onnx', size: 4, strict: true, sha256: HOLA_SHA };
    await cachedAsset(asset);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.has(asset.url)).toBe(true);
    const fromCache: boolean[] = [];
    const again = await cachedAsset(asset, (_r, _t, c) => fromCache.push(c));
    expect(new TextDecoder().decode(again)).toBe('hola');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fromCache).toEqual([true]);
    // Copia dañada en caché: se descarta y se descarga de nuevo
    store.set(asset.url, new Response(bytes('xxxx')));
    await cachedAsset(asset);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
