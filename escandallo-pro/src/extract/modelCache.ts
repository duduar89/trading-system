/**
 * Descarga con caché persistente de los archivos grandes del lector de texto (modelos y motor WebAssembly), para que
 * se descarguen UNA vez y funcionen después sin conexión. Funciona en el hilo principal y en workers.
 *
 * Se guarda en Cache Storage propio (no depende de que el service worker controle ya la página: en la primera visita
 * aún no la controla). Si el archivo ya está en cualquier caché del origen (p. ej. la del service worker para
 * cdn.jsdelivr.net) se reutiliza sin duplicarlo. Se comprueba la integridad (tamaño y SHA-256 cuando se conocen)
 * antes de guardarlo: una descarga cortada nunca queda en caché.
 */

export const MODEL_CACHE = 'escandallo-lector-v1';

/** Tiempo máximo sin recibir datos durante una descarga antes de abandonarla. */
const STALL_MS = 30_000;

export interface FetchAsset {
  url: string;
  /** Tamaño esperado en bytes (sirve para el progreso; si `strict`, también para validar). */
  size?: number;
  /** SHA-256 en hexadecimal (validación estricta del contenido). */
  sha256?: string;
  /** El tamaño tiene que coincidir exactamente. */
  strict?: boolean;
}

function cachesAvailable(): boolean {
  try {
    return typeof caches !== 'undefined' && typeof caches.open === 'function';
  } catch {
    // Contextos no seguros (http:// en una IP de la red local): sin Cache Storage
    return false;
  }
}

async function sha256Hex(buf: ArrayBuffer): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** ¿El contenido es el esperado? */
export async function verifyAsset(buf: ArrayBuffer, asset: FetchAsset): Promise<boolean> {
  if (!buf.byteLength) return false;
  if (asset.strict && asset.size !== undefined && buf.byteLength !== asset.size) return false;
  if (asset.sha256) {
    const hex = await sha256Hex(buf);
    if (hex !== undefined && hex !== asset.sha256.toLowerCase()) return false;
  }
  return true;
}

/** Lee el cuerpo informando del avance (bytes recibidos / tamaño esperado o Content-Length). */
async function readBody(res: Response, expected: number | undefined, onBytes?: (received: number, total: number | undefined) => void): Promise<ArrayBuffer> {
  const header = Number(res.headers.get('content-length') ?? '');
  // Con compresión, Content-Length es el tamaño comprimido: el tamaño conocido del archivo manda
  const total = expected ?? (Number.isFinite(header) && header > 0 ? header : undefined);
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = await res.arrayBuffer();
    onBytes?.(buf.byteLength, total);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onBytes?.(received, total);
    }
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

/** Avance de una descarga: bytes recibidos, total esperado y si venía de la caché (sin descarga real). */
export type BytesFn = (received: number, total: number | undefined, fromCache: boolean) => void;

/**
 * Bytes de un archivo grande: de la caché si ya se descargó (y es íntegro); si no, se descarga (con progreso), se valida
 * y se guarda.
 */
export async function cachedAsset(asset: FetchAsset, onBytes?: BytesFn): Promise<ArrayBuffer> {
  const useCache = cachesAvailable();
  if (useCache) {
    try {
      const hit = await caches.match(asset.url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        if (await verifyAsset(buf, asset)) {
          onBytes?.(buf.byteLength, buf.byteLength, true);
          return buf;
        }
        // Copia dañada (o de otra versión): se borra de nuestra caché y se vuelve a descargar
        await (await caches.open(MODEL_CACHE)).delete(asset.url);
      }
    } catch {
      // Caché inaccesible (modo privado, cuota): se descarga sin guardar
    }
  }
  // Descarga vigilada: si la conexión se queda parada (sin recibir nada en STALL_MS), se aborta y quien llama sigue con
  // otro motor en vez de esperar indefinidamente
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (!ctrl) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      ctrl.abort();
    }, STALL_MS);
  };
  let buf: ArrayBuffer;
  let res: Response;
  try {
    arm();
    res = await fetch(asset.url, { credentials: 'omit', signal: ctrl?.signal });
    if (!res.ok) throw new Error(`No se ha podido descargar ${asset.url.split('/').pop()} (HTTP ${res.status})`);
    buf = await readBody(res, asset.size, (received, total) => {
      arm();
      onBytes?.(received, total, false);
    });
  } catch (err) {
    if (stalled) throw new Error(`La descarga de ${asset.url.split('/').pop()} se ha detenido: revisa la conexión`);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!(await verifyAsset(buf, asset))) throw new Error(`La descarga de ${asset.url.split('/').pop()} está incompleta o dañada`);
  if (useCache) {
    try {
      // Si el service worker ya lo ha guardado en su caché, no se duplica
      if (!(await caches.match(asset.url))) {
        const cache = await caches.open(MODEL_CACHE);
        await cache.put(asset.url, new Response(buf.slice(0), { headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', 'content-length': String(buf.byteLength) } }));
      }
    } catch {
      // Sin espacio o sin permiso: funciona igual, sólo que se volverá a descargar la próxima vez
    }
  }
  return buf;
}

/** ¿Están ya descargados (y en caché) todos estos archivos? Sirve para avisar de la descarga sólo la primera vez. */
export async function assetsCached(urls: readonly string[]): Promise<boolean> {
  if (!cachesAvailable()) return false;
  try {
    for (const url of urls) if (!(await caches.match(url))) return false;
    return true;
  } catch {
    return false;
  }
}
