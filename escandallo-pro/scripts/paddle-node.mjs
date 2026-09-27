/**
 * Lector PaddleOCR para los bancos de pruebas en Node: EL MISMO motor que la app (onnxruntime-web con WebAssembly de un
 * hilo, los mismos modelos de public/ocr-models y la misma lógica de src/extract/paddleOcr.ts), para que la calidad
 * medida sea la que obtiene el usuario. Las lecturas se guardan en caché (clave = imagen + código del lector + modelos).
 *
 * Uso (desde un banco que ya tiene los módulos de la app cargados con Vite):
 *   const paddle = await createPaddleReader({ paddleOcr, paddleModel, imageOps, cacheDir });
 *   backend.recognizePaddle = paddle.recognize;
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));

/**
 * @param {{ paddleOcr: any, paddleModel: any, imageOps: any, cacheDir?: string, noCache?: boolean }} mods
 * @returns {Promise<{ recognize: (image: any) => Promise<any>, stats: { calls: number, cached: number, ms: number } }>}
 */
export async function createPaddleReader({ paddleOcr, paddleModel, imageOps, cacheDir, noCache = false }) {
  const files = paddleModel.paddleModelFiles(pathToFileURL(join(ROOT, 'public/')).href);
  const pathOf = (asset) => fileURLToPath(asset.url);
  const dir = cacheDir ?? join(ROOT, 'node_modules/.cache/escandallo-paddle-ocr');
  mkdirSync(dir, { recursive: true });
  // La clave cambia si cambian el código del lector, los modelos o sus parámetros
  const tag = createHash('sha1')
    .update(readFileSync(join(ROOT, 'src/extract/paddleOcr.ts')))
    .update(JSON.stringify({ det: files.det.sha256, rec: files.rec.sha256, options: files.options }))
    .digest('hex');
  const stats = { calls: 0, cached: 0, ms: 0 };
  let loaded;
  const load = async () => {
    const ort = await import(pathToFileURL(require.resolve('onnxruntime-web')).href);
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = 'error';
    const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 };
    const det = await ort.InferenceSession.create(readFileSync(pathOf(files.det)), opts);
    const rec = await ort.InferenceSession.create(readFileSync(pathOf(files.rec)), opts);
    const run = async (session, input, dims) => {
      const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, dims) });
      const t = out[session.outputNames[0]];
      return { data: t.data, dims: [...t.dims] };
    };
    return {
      runner: { detect: (input, h, w) => run(det, input, [1, 3, h, w]), recognize: (input, n, h, w) => run(rec, input, [n, 3, h, w]) },
      dict: paddleOcr.parseCharDict(readFileSync(pathOf(files.dict), 'utf8')),
    };
  };
  // Un solo lector a la vez (como el worker de la app)
  let queue = Promise.resolve();
  async function recognize(image) {
    const pgm = Buffer.from(imageOps.encodePgm(image));
    const key = createHash('sha1').update(pgm).update(tag).digest('hex');
    const file = join(dir, `${key}.json`);
    stats.calls++;
    if (!noCache && existsSync(file)) {
      stats.cached++;
      return JSON.parse(readFileSync(file, 'utf8'));
    }
    const job = queue.then(async () => {
      loaded ??= await load();
      const t0 = Date.now();
      const page = await paddleOcr.paddleRecognize(image, loaded.runner, loaded.dict, files.options);
      stats.ms += Date.now() - t0;
      writeFileSync(file, JSON.stringify(page));
      return page;
    });
    queue = job.catch(() => undefined);
    return job;
  }
  return { recognize, stats };
}
