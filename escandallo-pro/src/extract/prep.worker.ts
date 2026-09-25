import { prepareForOcr, rgbaToGray, type OcrPrepInfo, type OcrPrepOptions } from './imageOps';

/**
 * Worker de preparación de imágenes para OCR: decodifica la foto (orientación EXIF incluida), la pasa a escala de
 * grises y aplica el canal completo de `imageOps` (perspectiva, fondo, contraste, enderezado, escala) fuera del hilo
 * principal, para que la interfaz no se congele con fotos de 12 MP. Si algo no se puede hacer aquí (navegador sin
 * OffscreenCanvas, formato que sólo decodifica <img>), responde con error y ocr.ts lo hace en el hilo principal.
 */

export interface PrepRequest {
  id: number;
  blobs: Blob[];
  maxSide: number;
  prep?: OcrPrepOptions;
}

export type PrepResponse =
  | { id: number; ok: true; pages: { width: number; height: number; data: Uint8ClampedArray; info: OcrPrepInfo }[] }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function decodeGray(blob: Blob, maxSide: number) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * s));
    const h = Math.max(1, Math.round(bmp.height * s));
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('Sin contexto 2D');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    return rgbaToGray(g.getImageData(0, 0, w, h).data, w, h);
  } finally {
    bmp.close();
  }
}

ctx.onmessage = async (ev: MessageEvent<PrepRequest>) => {
  const { id, blobs, maxSide, prep } = ev.data;
  try {
    const pages = [];
    for (const b of blobs) {
      // Mismo canal que preparePages (ocrPipeline) sin arrastrar el parser al worker
      const { image, info } = prepareForOcr(await decodeGray(b, maxSide), { ...prep, binarize: false });
      pages.push({ width: image.width, height: image.height, data: image.data, info });
    }
    const msg: PrepResponse = { id, ok: true, pages };
    ctx.postMessage(msg, pages.map((p) => p.data.buffer as ArrayBuffer));
  } catch (err) {
    const msg: PrepResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    ctx.postMessage(msg);
  }
};
