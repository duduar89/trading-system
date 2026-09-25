import type { AppSettings, ExtractedInvoice, ProgressFn } from '../types';
import { AIError, blobToBase64, callStructuredDetailed } from './client';
import { prepareImage, sniffImageType } from './image';
import { mapInvoice } from './normalize';
import { INVOICE_INSTRUCTION, INVOICE_SYSTEM } from './prompts';
import { invoiceParseSchema, invoiceWireJsonSchema } from './schemas';

/**
 * Extracción de facturas con Claude: PDF (bloque `document` base64) o imagen (bloque `image` base64).
 * Devuelve líneas con cantidad, unidad, formato, precio, dto, importe, IVA, nombre genérico sugerido y categoría,
 * más cabecera (proveedor, CIF, nº, fecha, base, IVA, total). Normaliza cada línea con core/pack.normalizeInvoiceLine.
 *
 * Es un complemento OPCIONAL: sólo se usa si el usuario ha activado la IA con su propia clave.
 */

type DocKind = 'pdf' | 'image' | 'unsupported';

async function detectKind(file: Blob, mediaType: string): Promise<DocKind> {
  const declared = (mediaType || file.type || '').toLowerCase();
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf'; // %PDF
  const sniffed = sniffImageType(head);
  if (sniffed !== 'unknown') return 'image';
  if (declared === 'application/pdf') return 'pdf';
  if (declared.startsWith('image/')) return 'image';
  return 'unsupported';
}

/** Caracteres de respuesta esperados (sólo para estimar la barra de progreso). */
function expectedChars(file: Blob, kind: DocKind): number {
  if (kind === 'image') return 7000;
  // Un PDF de factura típico (1–3 páginas) ocupa 30–300 KB; los escaneados pesan más por página.
  return Math.max(7000, Math.min(60_000, Math.round(file.size / 25)));
}

export async function aiExtractInvoice(
  file: Blob,
  mediaType: string,
  settings: AppSettings,
  onProgress?: ProgressFn,
  opts: { signal?: AbortSignal } = {},
): Promise<ExtractedInvoice> {
  onProgress?.({ stage: 'Preparando el documento…', progress: 0.01 });
  const kind = await detectKind(file, mediaType);
  let block: Record<string, unknown>;
  if (kind === 'pdf') {
    block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await blobToBase64(file) } };
  } else if (kind === 'image') {
    const img = await prepareImage(file);
    block = { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } };
  } else {
    throw new AIError('invalid', 'La IA sólo lee facturas en PDF o en foto (JPG, PNG o WebP). Los Excel y CSV se importan en local.');
  }

  const result = await callStructuredDetailed({
    settings,
    // Prompt estable marcado para caché: al leer varios documentos seguidos se reutiliza.
    system: [{ text: INVOICE_SYSTEM, cache: true }],
    // El documento va ANTES de la instrucción.
    content: [block, { type: 'text', text: INVOICE_INSTRUCTION }],
    schema: invoiceParseSchema,
    jsonSchema: invoiceWireJsonSchema(),
    maxTokens: 32_000,
    onProgress,
    signal: opts.signal,
    stage: 'Claude está leyendo la factura…',
    progressRange: [0.04, 0.94],
    expectedChars: expectedChars(file, kind),
    allowPartial: true,
  });

  onProgress?.({ stage: 'Comprobando importes…', progress: 0.96 });
  const invoice = mapInvoice(result.data, { truncated: result.truncated, rawText: result.rawText });
  onProgress?.({ stage: 'Factura leída', progress: 1 });
  return invoice;
}
