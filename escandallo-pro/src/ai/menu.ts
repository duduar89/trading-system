import type { AppSettings, ExtractedMenu, ProgressFn } from '../types';
import { AIError, blobToBase64, callStructuredDetailed } from './client';
import { prepareImage } from './image';
import { mapMenu } from './normalize';
import { MENU_SYSTEM, menuInstruction } from './prompts';
import { menuParseSchema, menuWireJsonSchema } from './schemas';

/**
 * Lectura de cartas con visión: una o varias fotos (o páginas de PDF renderizadas) → secciones, platos, descripciones y PVP.
 * Todas las fotos van en una sola petición, en orden y etiquetadas («Foto 1», «Foto 2»…), para que Claude pueda
 * unir secciones partidas entre fotos y eliminar duplicados cuando las fotos se solapan.
 *
 * Es un complemento OPCIONAL: sólo se usa si el usuario ha activado la IA con su propia clave.
 */

/** Máximo de imágenes por petición que admite la API. */
const MAX_IMAGES = 100;

async function isPdf(blob: Blob): Promise<boolean> {
  if ((blob.type || '').toLowerCase() === 'application/pdf') return true;
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
}

export async function aiExtractMenu(
  images: Blob[],
  settings: AppSettings,
  onProgress?: ProgressFn,
  opts: { signal?: AbortSignal } = {},
): Promise<ExtractedMenu> {
  const files = images.filter((b) => b && b.size > 0);
  if (!files.length) throw new AIError('invalid', 'Añade al menos una foto de la carta.');
  if (files.length > MAX_IMAGES) throw new AIError('too_large', `Demasiadas fotos para una sola lectura (máximo ${MAX_IMAGES}). Lee la carta en varias tandas.`);

  const content: Record<string, unknown>[] = [];
  let pdfs = 0;
  for (let i = 0; i < files.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
    onProgress?.({ stage: files.length > 1 ? `Preparando foto ${i + 1} de ${files.length}…` : 'Preparando la foto…', progress: 0.01 + (0.04 * i) / files.length });
    const blob = files[i];
    if (await isPdf(blob)) {
      pdfs++;
      content.push({ type: 'text', text: `Documento ${i + 1}:` });
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await blobToBase64(blob) } });
    } else {
      const img = await prepareImage(blob);
      content.push({ type: 'text', text: `Foto ${i + 1}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
    }
  }
  content.push({ type: 'text', text: menuInstruction(files.length) });

  const result = await callStructuredDetailed({
    settings,
    // Prompt estable marcado para caché: al leer varios documentos seguidos se reutiliza.
    system: [{ text: MENU_SYSTEM, cache: true }],
    content,
    schema: menuParseSchema,
    jsonSchema: menuWireJsonSchema(),
    maxTokens: 16_000,
    onProgress,
    signal: opts.signal,
    stage: files.length > 1 ? `Claude está leyendo la carta (${files.length} ${pdfs === files.length ? 'documentos' : 'fotos'})…` : 'Claude está leyendo la carta…',
    progressRange: [0.06, 0.95],
    expectedChars: 4000 * files.length,
    allowPartial: true,
  });

  onProgress?.({ stage: 'Ordenando platos…', progress: 0.97 });
  const menu = mapMenu(result.data, { truncated: result.truncated, rawText: result.rawText });
  onProgress?.({ stage: 'Carta leída', progress: 1 });
  return menu;
}
