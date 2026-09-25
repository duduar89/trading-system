import { AIError, bytesToBase64 } from './client';

/**
 * Preparación de fotos para la API de Claude: corrige la orientación EXIF, reduce el lado largo a 2000 px y
 * recomprime a JPEG cuando hace falta (fotos de móvil de 12–50 MP). Así la petición es más rápida y barata sin
 * perder legibilidad del texto de facturas y cartas.
 */

export type ApiImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface PreparedImage {
  data: string;
  mediaType: ApiImageType;
  width?: number;
  height?: number;
}

export const MAX_IMAGE_SIDE = 2000;
/** Límite de la API: 5 MB por imagen en base64 ≈ 3,75 MB de bytes. Se deja margen. */
const MAX_IMAGE_BYTES = 3_600_000;
const API_TYPES: readonly ApiImageType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

type SniffedType = ApiImageType | 'image/heic' | 'image/bmp' | 'image/tiff' | 'unknown';

/** Tipo real por los «números mágicos» del archivo (el `type` del Blob a veces viene vacío o mal). */
export function sniffImageType(head: Uint8Array): SniffedType {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return 'image/webp';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a))) return 'image/tiff';
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(brand)) return 'image/heic';
  }
  return 'unknown';
}

/** Orientación EXIF de un JPEG (1 = normal). Lee sólo la cabecera; ante cualquier duda devuelve 1. */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let off = 2;
  while (off + 4 <= bytes.length) {
    if (bytes[off] !== 0xff) return 1;
    const marker = bytes[off + 1];
    const size = (bytes[off + 2] << 8) | bytes[off + 3];
    if (marker === 0xda || size < 2) return 1; // inicio de la imagen: no hay EXIF
    if (marker === 0xe1 && off + 10 <= bytes.length && String.fromCharCode(...bytes.subarray(off + 4, off + 8)) === 'Exif') {
      const tiff = off + 10;
      if (tiff + 8 > bytes.length) return 1;
      const little = bytes[tiff] === 0x49;
      const u16 = (p: number) => (little ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1]);
      const u32 = (p: number) => (little ? u16(p) + u16(p + 2) * 0x10000 : u16(p) * 0x10000 + u16(p + 2));
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > bytes.length) return 1;
      const entries = u16(ifd);
      for (let i = 0; i < entries; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 10 > bytes.length) return 1;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    off += 2 + size;
  }
  return 1;
}

/** Dimensiones que caben en un cuadrado de `max` px conservando la proporción (nunca amplía). */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number; scale: number } {
  const long = Math.max(width, height);
  if (!(long > max)) return { width, height, scale: 1 };
  const scale = max / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

const HEIC_MESSAGE =
  'Esta foto está en formato HEIC (iPhone) y no se puede leer en este navegador. Hazla en JPG (Ajustes › Cámara › Formatos › «Más compatible») o expórtala como JPG.';

async function encodeJpeg(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible');
    ctx.fillStyle = '#ffffff'; // fondo blanco para PNG con transparencia
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen'))), 'image/jpeg', quality));
}

/**
 * Convierte una foto (Blob) en un bloque listo para la API. Lanza AIError('invalid') con un mensaje claro si el
 * formato no se puede leer (p. ej. HEIC en navegadores que no lo decodifican).
 */
export async function prepareImage(blob: Blob, opts: { maxSide?: number; quality?: number } = {}): Promise<PreparedImage> {
  const maxSide = opts.maxSide ?? MAX_IMAGE_SIDE;
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageType(head);
  const declared = (blob.type || '').toLowerCase();
  const type: SniffedType = sniffed !== 'unknown' ? sniffed : declared === 'image/jpg' ? 'image/jpeg' : (declared as SniffedType);
  const apiType = (API_TYPES as readonly string[]).includes(type) ? (type as ApiImageType) : undefined;

  const passthrough = async (): Promise<PreparedImage> => ({ data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())), mediaType: apiType as ApiImageType });

  if (typeof createImageBitmap !== 'function') {
    // Entorno sin decodificador (tests, navegadores muy antiguos): enviar tal cual si la API lo admite.
    if (apiType && blob.size <= MAX_IMAGE_BYTES) return passthrough();
    throw new AIError('invalid', type === 'image/heic' ? HEIC_MESSAGE : 'No se puede preparar esta imagen para la IA en este navegador. Usa una foto JPG o PNG.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    if (apiType && blob.size <= MAX_IMAGE_BYTES) return passthrough();
    throw new AIError('invalid', type === 'image/heic' ? HEIC_MESSAGE : 'No se ha podido leer la imagen: el archivo está dañado o su formato no es compatible. Usa JPG o PNG.');
  }

  try {
    const { width, height, scale } = fitWithin(bitmap.width, bitmap.height, maxSide);
    // Imágenes pequeñas, ya compatibles y sin rotación EXIF pendiente: se envían sin recomprimir (sin pérdida).
    const rotated = type === 'image/jpeg' && jpegOrientation(new Uint8Array(await blob.slice(0, 131_072).arrayBuffer())) !== 1;
    if (apiType && scale === 1 && blob.size <= MAX_IMAGE_BYTES && !rotated) {
      return { ...(await passthrough()), width, height };
    }
    let quality = opts.quality ?? 0.85;
    let out = await encodeJpeg(bitmap, width, height, quality);
    while (out.size > MAX_IMAGE_BYTES && quality > 0.5) {
      quality -= 0.12;
      out = await encodeJpeg(bitmap, width, height, quality);
    }
    return { data: bytesToBase64(new Uint8Array(await out.arrayBuffer())), mediaType: 'image/jpeg', width, height };
  } catch (err) {
    if (err instanceof AIError) throw err;
    if (apiType && blob.size <= MAX_IMAGE_BYTES) return passthrough();
    throw new AIError('invalid', 'No se ha podido preparar la imagen para la IA. Prueba con otra foto en JPG o PNG.');
  } finally {
    bitmap.close();
  }
}
