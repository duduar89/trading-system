import type { AIEffort, AIModel, AppSettings, ProgressFn } from '../types';
import type { z } from 'zod';
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaTextBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

/**
 * Cliente de Claude (SDK oficial @anthropic-ai/sdk, en el navegador con dangerouslyAllowBrowser: la clave
 * es del propio usuario y se guarda sólo en su dispositivo).
 * - Salida estructurada con `output_config.format` (JSON Schema a partir de zod) y validación zod.
 * - Streaming + finalMessage() para respuestas largas.
 * - Comprobar stop_reason ('refusal', 'max_tokens') antes de leer el contenido.
 *
 * La IA es un complemento OPCIONAL (desactivado por defecto): la extracción local es gratuita y no la necesita.
 * Si `settings.aiEnabled` es false, nunca se llama a la API.
 */

export type AIErrorKind = 'auth' | 'rate' | 'network' | 'refusal' | 'invalid' | 'overloaded' | 'too_large' | 'other';

export class AIError extends Error {
  kind: AIErrorKind;
  constructor(kind: AIErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'AIError';
  }
}

/** Bloque del prompt de sistema; `cache: true` marca el final de un prefijo estable reutilizable (caché de prompts). */
export interface AISystemBlock {
  text: string;
  cache?: boolean;
}

export interface StructuredCall<T> {
  settings: AppSettings;
  /** Prompt de sistema: texto o bloques (para poder cachear un prefijo estable, p. ej. el catálogo de productos). */
  system: string | AISystemBlock[];
  /** Bloques de contenido del mensaje de usuario (texto, imágenes base64, documentos PDF base64). */
  content: unknown[];
  schema: z.ZodType<T>;
  /** JSON Schema estricto enviado en output_config.format. Si falta se deriva de `schema`. */
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  onProgress?: ProgressFn;
  signal?: AbortSignal;
  /** Texto de la fase para la barra de progreso (p. ej. "Claude está leyendo la factura…"). */
  stage?: string;
  /** Tramo de la barra de progreso (0–1) que ocupa esta llamada. Por defecto [0.05, 0.95]. */
  progressRange?: [number, number];
  /** Caracteres de respuesta esperados, para estimar el avance. */
  expectedChars?: number;
  /** Si la respuesta se corta por longitud incluso tras ampliar el margen, devolver lo recuperable en lugar de fallar. */
  allowPartial?: boolean;
}

export interface StructuredResult<T> {
  data: T;
  /** true si la respuesta se cortó por longitud y sólo se ha recuperado la parte completa. */
  truncated: boolean;
  /** JSON devuelto por el modelo (para depurar o reprocesar). */
  rawText: string;
  /** Modelo que respondió (puede ser el de respaldo si Claude Opus 5 derivó la petición). */
  model: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
}

type SdkModule = typeof import('@anthropic-ai/sdk');
type AnthropicClient = InstanceType<SdkModule['default']>;
type SdkErrorClasses = Pick<
  SdkModule,
  | 'APIError'
  | 'APIUserAbortError'
  | 'APIConnectionError'
  | 'APIConnectionTimeoutError'
  | 'AuthenticationError'
  | 'PermissionDeniedError'
  | 'NotFoundError'
  | 'RateLimitError'
  | 'BadRequestError'
  | 'InternalServerError'
>;

export const AI_MODELS: readonly AIModel[] = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];

export const MODEL_LABELS: Record<AIModel, { label: string; hint: string }> = {
  'claude-opus-5': { label: 'Claude Opus 5', hint: 'Máxima precisión (recomendado)' },
  'claude-sonnet-5': { label: 'Claude Sonnet 5', hint: 'Equilibrio precisión / coste' },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5', hint: 'El más rápido y económico' },
};

/** Beta de respaldo en servidor (sólo Claude Opus 5): si el modelo declina por política, el servidor reintenta con otro. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Límite de una petición a la API (32 MB); se deja margen para el JSON de la petición. */
const MAX_REQUEST_BASE64_CHARS = 31_500_000;
const DEFAULT_MAX_TOKENS = 16_000;

export function resolveModel(model: unknown): AIModel {
  return AI_MODELS.includes(model as AIModel) ? (model as AIModel) : 'claude-opus-5';
}

/** `output_config.effort` está admitido en Opus 5 y Sonnet 5; en Haiku 4.5 da error. */
export function supportsEffort(model: AIModel): boolean {
  return model !== 'claude-haiku-4-5';
}

/** Máximo de tokens de salida por modelo (con streaming). */
export function maxOutputTokens(model: AIModel): number {
  return model === 'claude-haiku-4-5' ? 64_000 : 128_000;
}

function resolveEffort(effort: unknown): AIEffort {
  return effort === 'low' || effort === 'medium' || effort === 'high' ? effort : 'medium';
}

// ───────────────────────────── Carga del SDK (import dinámico) ─────────────────────────────

let sdkPromise: Promise<SdkModule> | undefined;

function loadSdk(): Promise<SdkModule> {
  sdkPromise ??= import('@anthropic-ai/sdk').catch(() => {
    sdkPromise = undefined;
    throw new AIError('network', 'No se ha podido cargar el módulo de IA. Comprueba tu conexión a internet y vuelve a intentarlo.');
  });
  return sdkPromise;
}

function createClient(sdk: SdkModule, apiKey: string, opts: { maxRetries?: number; timeout?: number } = {}): AnthropicClient {
  const Anthropic = sdk.default;
  return new Anthropic({
    apiKey,
    // La clave es del usuario y vive sólo en su dispositivo: la llamada directa desde el navegador es intencionada.
    dangerouslyAllowBrowser: true,
    maxRetries: opts.maxRetries ?? 2,
    timeout: opts.timeout ?? 10 * 60 * 1000,
  });
}

// ───────────────────────────── Parámetros de la petición ─────────────────────────────

export interface RequestSpec {
  model: AIModel;
  effort: AIEffort;
  system: string | AISystemBlock[];
  messages: BetaMessageParam[];
  maxTokens: number;
  jsonSchema: Record<string, unknown>;
  /** Activar el respaldo en servidor (sólo tiene efecto en Claude Opus 5). */
  withFallbacks: boolean;
}

function toSystemParam(system: string | AISystemBlock[]): string | BetaTextBlockParam[] {
  if (typeof system === 'string') return system;
  return system
    .filter((b) => b.text.trim().length > 0)
    .map((b): BetaTextBlockParam => (b.cache ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } } : { type: 'text', text: b.text }));
}

/**
 * Construye los parámetros según el modelo:
 *  - Opus 5: pensamiento adaptativo por defecto (no se envía `thinking`), `effort`, respaldo en servidor opcional.
 *  - Sonnet 5: `thinking: { type: 'adaptive' }` y `effort`.
 *  - Haiku 4.5: sin `thinking` ni `effort` (daría error).
 * Nunca se envían temperature / top_p / top_k (rechazados en Opus 5 / Sonnet 5) ni prefill del asistente.
 */
export function buildRequestParams(spec: RequestSpec): BetaMessageStreamParams {
  const model = resolveModel(spec.model);
  const params: BetaMessageStreamParams = {
    model,
    max_tokens: Math.min(spec.maxTokens, maxOutputTokens(model)),
    system: toSystemParam(spec.system),
    messages: spec.messages,
    output_config: {
      format: { type: 'json_schema', schema: spec.jsonSchema },
      ...(supportsEffort(model) ? { effort: resolveEffort(spec.effort) } : {}),
    },
  };
  if (model === 'claude-sonnet-5') params.thinking = { type: 'adaptive' };
  if (spec.withFallbacks && model === 'claude-opus-5') {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
}

// ───────────────────────────── Errores ─────────────────────────────

function abortError(): DOMException {
  return new DOMException('Operación cancelada', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function isAbortError(err: unknown, sdk?: Pick<SdkModule, 'APIUserAbortError'>): boolean {
  if (sdk && err instanceof sdk.APIUserAbortError) return true;
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError';
}

/** Mensaje de la API ("error.error.message") sin el prefijo de estado que añade el SDK. */
function apiMessage(err: { message: string; error?: unknown }): string {
  const body = err.error as { error?: { message?: unknown }; message?: unknown } | undefined;
  const inner = body?.error?.message ?? body?.message;
  if (typeof inner === 'string' && inner.trim()) return inner.trim();
  return err.message.replace(/^\d{3}\s+/, '').trim();
}

function apiErrorType(err: { error?: unknown; type?: unknown }): string {
  const body = err.error as { error?: { type?: unknown } } | undefined;
  const t = err.type ?? body?.error?.type;
  return typeof t === 'string' ? t : '';
}

const TOO_LARGE_RE = /too large|too long|exceeds?|maximum|too many (pages|images)|request_too_large|prompt is too long|límite/i;

/** Traduce cualquier error (del SDK u otro) a un AIError con un mensaje en español y accionable. */
export function toAIError(err: unknown, sdk?: SdkErrorClasses): AIError {
  if (err instanceof AIError) return err;
  if (sdk) {
    if (err instanceof sdk.AuthenticationError) return new AIError('auth', 'La clave de API no es válida o ha sido revocada. Revísala en Ajustes.');
    if (err instanceof sdk.PermissionDeniedError)
      return new AIError('auth', 'Tu clave de API no tiene permiso para usar este modelo. Revisa tu cuenta de Anthropic o elige otro modelo en Ajustes.');
    if (err instanceof sdk.NotFoundError) return new AIError('other', 'El modelo elegido no está disponible para tu cuenta. Elige otro modelo en Ajustes.');
    if (err instanceof sdk.RateLimitError)
      return new AIError('rate', 'Has alcanzado el límite de uso de tu cuenta de Anthropic. Espera un minuto y vuelve a intentarlo, o usa la extracción local (gratis).');
    if (err instanceof sdk.BadRequestError) {
      const msg = apiMessage(err);
      if (/credit balance|billing|saldo/i.test(msg))
        return new AIError('invalid', 'Tu cuenta de Anthropic no tiene saldo suficiente. Recarga créditos en tu cuenta o usa la extracción local, que es gratis.');
      if (TOO_LARGE_RE.test(msg))
        return new AIError('too_large', `El documento es demasiado grande para la IA: divídelo en partes más pequeñas o usa la extracción local. (${msg})`);
      return new AIError('invalid', `La IA ha rechazado la petición: ${msg}`);
    }
    if (err instanceof sdk.InternalServerError || (err instanceof sdk.APIError && err.status === 529)) {
      return err.status === 529 || /overloaded/i.test(apiErrorType(err) + err.message)
        ? new AIError('overloaded', 'Claude está saturado en este momento. Inténtalo de nuevo en unos minutos o usa la extracción local (gratis).')
        : new AIError('overloaded', 'El servicio de Claude ha tenido un error temporal. Inténtalo de nuevo en unos minutos.');
    }
    if (err instanceof sdk.APIConnectionTimeoutError)
      return new AIError('network', 'La IA ha tardado demasiado en responder. Comprueba tu conexión y vuelve a intentarlo.');
    if (err instanceof sdk.APIConnectionError) {
      // Los errores emitidos a mitad del streaming llegan sin estado HTTP: se distinguen por el tipo de error.
      if (/overloaded/i.test(err.message))
        return new AIError('overloaded', 'Claude está saturado en este momento. Inténtalo de nuevo en unos minutos o usa la extracción local (gratis).');
      if (/rate_limit/i.test(err.message)) return new AIError('rate', 'Has alcanzado el límite de uso de tu cuenta de Anthropic. Espera un minuto y vuelve a intentarlo.');
      return new AIError('network', 'No se ha podido conectar con Claude. Comprueba tu conexión a internet y vuelve a intentarlo.');
    }
    if (err instanceof sdk.APIError) {
      if (err.status === 413 || apiErrorType(err) === 'request_too_large')
        return new AIError('too_large', 'El documento es demasiado grande para la IA (máx. 32 MB por petición): divídelo en partes o usa la extracción local.');
      return new AIError('other', `Error de la IA${err.status ? ` (${err.status})` : ''}: ${apiMessage(err)}`);
    }
  }
  if (err instanceof TypeError && /fetch|network|load failed/i.test(err.message))
    return new AIError('network', 'No se ha podido conectar con Claude. Comprueba tu conexión a internet y vuelve a intentarlo.');
  const message = err instanceof Error ? err.message : String(err);
  return new AIError('other', `Error inesperado de la IA: ${message}`);
}

function isFallbackRejection(err: unknown, sdk: SdkErrorClasses): boolean {
  return err instanceof sdk.BadRequestError && /fallback|beta/i.test(apiMessage(err));
}

// ───────────────────────────── Progreso ─────────────────────────────

class ProgressReporter {
  private chars = 0;
  private last = 0;
  private lastStage = '';
  private readonly fn?: ProgressFn;
  private readonly stage: string;
  private readonly from: number;
  private readonly to: number;
  private readonly expected: number;

  constructor(fn: ProgressFn | undefined, stage: string, range: [number, number], expectedChars: number) {
    this.fn = fn;
    this.stage = stage;
    this.from = Math.max(0, Math.min(1, range[0]));
    this.to = Math.max(this.from, Math.min(1, range[1]));
    this.expected = Math.max(500, expectedChars);
  }

  private emit(stage: string, fraction: number, force = false): void {
    if (!this.fn) return;
    const p = this.from + (this.to - this.from) * Math.max(0, Math.min(1, fraction));
    const progress = Math.max(this.last, p);
    if (!force && stage === this.lastStage && progress - this.last < 0.01) return;
    this.last = progress;
    this.lastStage = stage;
    try {
      this.fn({ stage, progress });
    } catch {
      // Un fallo de la UI al pintar el progreso no debe interrumpir la extracción.
    }
  }

  connecting(): void {
    this.emit('Conectando con Claude…', 0.02, true);
  }
  thinking(): void {
    this.emit(this.stage, 0.08);
  }
  /** Mientras Claude piensa (sin texto visible todavía) la barra avanza despacio para que no parezca parada. */
  tick(elapsedMs: number): void {
    if (this.chars === 0) this.emit(this.stage, 0.03 + 0.09 * (1 - Math.exp(-elapsedMs / 30_000)));
  }
  text(n: number): void {
    this.chars += n;
    // Curva asintótica: avanza rápido al principio y nunca «llega» antes de terminar.
    this.emit(this.stage, 0.12 + 0.83 * (1 - Math.exp(-this.chars / this.expected)));
  }
  info(stage: string): void {
    this.emit(stage, (this.last - this.from) / Math.max(1e-9, this.to - this.from), true);
  }
  validating(): void {
    this.emit('Comprobando los datos…', 0.98, true);
  }
}

// ───────────────────────────── Streaming ─────────────────────────────

async function runStream(client: AnthropicClient, params: BetaMessageStreamParams, signal: AbortSignal | undefined, progress: ProgressReporter): Promise<BetaMessage> {
  progress.connecting();
  const stream = client.beta.messages.stream(params, signal ? { signal } : undefined);
  if (typeof stream.on === 'function') {
    stream.on('streamEvent', (event) => {
      if (event.type === 'content_block_start' && (event.content_block.type === 'thinking' || event.content_block.type === 'redacted_thinking')) progress.thinking();
    });
    stream.on('text', (delta) => progress.text(typeof delta === 'string' ? delta.length : 0));
  }
  const started = Date.now();
  const timer = setInterval(() => progress.tick(Date.now() - started), 1000);
  try {
    return await stream.finalMessage();
  } finally {
    clearInterval(timer);
  }
}

/** Envía la petición; en Claude Opus 5 activa el respaldo en servidor y, si la API no lo acepta, reintenta sin él. */
let fallbacksRejected = false;

async function send(
  sdk: SdkModule,
  client: AnthropicClient,
  spec: Omit<RequestSpec, 'withFallbacks'>,
  signal: AbortSignal | undefined,
  progress: ProgressReporter,
): Promise<BetaMessage> {
  const withFallbacks = spec.model === 'claude-opus-5' && !fallbacksRejected;
  try {
    return await runStream(client, buildRequestParams({ ...spec, withFallbacks }), signal, progress);
  } catch (err) {
    if (withFallbacks && isFallbackRejection(err, sdk)) {
      fallbacksRejected = true;
      return runStream(client, buildRequestParams({ ...spec, withFallbacks: false }), signal, progress);
    }
    throw err;
  }
}

// ───────────────────────────── Lectura y validación de la respuesta ─────────────────────────────

function textBlocks(message: BetaMessage): string[] {
  const out: string[] = [];
  for (const block of message.content ?? []) if (block.type === 'text' && typeof block.text === 'string') out.push(block.text);
  return out;
}

/** Extrae el primer objeto JSON de un texto (tolera vallas ```json y texto alrededor). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

/**
 * Recupera la parte completa de un JSON cortado por longitud: descarta el último elemento incompleto y cierra los
 * contenedores abiertos. Prueba primero los cortes entre elementos de un array (nunca deja un objeto a medias) y
 * devuelve el primer candidato que acepte `accept` (p. ej. la validación zod). undefined si no hay nada aprovechable.
 */
export function repairTruncatedJson(text: string, accept: (value: unknown) => boolean = () => true): unknown {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  const s = text.slice(start);
  const stack: string[] = [];
  // Puntos de corte seguros: justo antes de una coma (el elemento anterior está completo) o tras cerrar un contenedor.
  const cuts: { pos: number; stack: string[] }[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') stack.push(c);
    else if (c === '[') {
      stack.push(c);
      cuts.push({ pos: i + 1, stack: [...stack] }); // array vacío: «"lines":[» → «"lines":[]»
    } else if (c === '}' || c === ']') {
      stack.pop();
      if (stack.length === 0) return tryParse(s.slice(0, i + 1));
      cuts.push({ pos: i + 1, stack: [...stack] });
    } else if (c === ',') cuts.push({ pos: i, stack: [...stack] });
  }
  // Primero los cortes entre elementos de array (los menos anidados antes: mejor perder un elemento entero que dejarlo
  // a medias) y después el resto; a igual profundidad, del más tardío (más datos) al primero.
  const seenPos = new Set<number>();
  const arrayCuts = cuts.filter((c) => c.stack[c.stack.length - 1] === '[').sort((a, b) => a.stack.length - b.stack.length || b.pos - a.pos);
  const objectCuts = cuts.filter((c) => c.stack[c.stack.length - 1] !== '[').reverse();
  let tries = 0;
  for (const cut of [...arrayCuts, ...objectCuts]) {
    if (seenPos.has(cut.pos) || tries++ > 300) continue;
    seenPos.add(cut.pos);
    const closing = cut.stack
      .slice()
      .reverse()
      .map((b) => (b === '{' ? '}' : ']'))
      .join('');
    const parsed = tryParse(s.slice(0, cut.pos) + closing);
    if (parsed !== undefined && accept(parsed)) return parsed;
  }
  return undefined;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((i) => `${i.path.length ? i.path.join('.') : '(raíz)'}: ${i.message}`)
    .join('; ');
}

type Validation<T> = { ok: true; data: T } | { ok: false; error: string };

function validate<T>(candidates: string[], schema: z.ZodType<T>): Validation<T> {
  let lastError = 'la respuesta no contiene un objeto JSON válido.';
  for (const text of candidates) {
    const json = extractJson(text);
    if (json === undefined) continue;
    const r = schema.safeParse(json);
    if (r.success) return { ok: true, data: r.data };
    lastError = `no cumple el esquema (${describeIssues(r.error)}).`;
  }
  return { ok: false, error: lastError };
}

function payloadChars(content: unknown[]): number {
  let total = 0;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { text?: unknown; source?: { data?: unknown } };
    if (typeof b.text === 'string') total += b.text.length;
    if (typeof b.source?.data === 'string') total += b.source.data.length;
  }
  return total;
}

async function deriveJsonSchema(schema: z.ZodType): Promise<Record<string, unknown>> {
  // Import dinámico: quien sólo usa testApiKey / MODEL_LABELS (Ajustes) no carga zod ni los prompts.
  const { toWireJsonSchema } = await import('./schemas');
  const json = toWireJsonSchema(schema);
  if (json.type !== 'object') throw new Error('callStructured: el esquema debe ser un objeto (pasa jsonSchema explícito si usa transformaciones).');
  return json;
}

// ───────────────────────────── API pública ─────────────────────────────

/**
 * Llamada con salida estructurada que devuelve también metadatos (si se cortó, JSON bruto, modelo y uso de tokens).
 * Reintentos: el SDK reintenta 2 veces errores transitorios; si la respuesta se corta por longitud se reintenta una vez
 * con más margen; si el JSON no valida se pide a Claude una vez que lo corrija con el error como nuevo turno.
 */
export async function callStructuredDetailed<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
  const { settings } = call;
  if (!settings.aiEnabled)
    throw new AIError('other', 'La IA opcional está desactivada. La extracción local es gratuita y no la necesita; puedes activarla en Ajustes con tu propia clave.');
  const apiKey = settings.apiKey?.trim();
  if (!apiKey) throw new AIError('auth', 'Para usar la IA opcional añade tu clave de API de Anthropic en Ajustes.');
  throwIfAborted(call.signal);
  if (payloadChars(call.content) > MAX_REQUEST_BASE64_CHARS)
    throw new AIError('too_large', 'El archivo es demasiado grande para la IA (máx. 32 MB por petición): divídelo en partes o usa la extracción local, que es gratis.');

  const model = resolveModel(settings.aiModel);
  const effort = resolveEffort(settings.aiEffort);
  const progress = new ProgressReporter(call.onProgress, call.stage ?? 'Claude está leyendo el documento…', call.progressRange ?? [0.05, 0.95], call.expectedChars ?? 6000);
  const baseMessages: BetaMessageParam[] = [{ role: 'user', content: call.content as BetaContentBlockParam[] }];

  let sdk: SdkModule | undefined;
  try {
    const jsonSchema = call.jsonSchema ?? (await deriveJsonSchema(call.schema));
    sdk = await loadSdk();
    throwIfAborted(call.signal);
    const client = createClient(sdk, apiKey);
    let messages = baseMessages;
    let maxTokens = Math.min(call.maxTokens ?? DEFAULT_MAX_TOKENS, maxOutputTokens(model));
    let escalated = false;
    let correctionAsked = false;

    for (;;) {
      const message = await send(sdk, client, { model, effort, system: call.system, messages, maxTokens, jsonSchema }, call.signal, progress);

      // stop_reason SIEMPRE antes de leer el contenido.
      if (message.stop_reason === 'refusal') {
        throw new AIError('refusal', 'Claude ha declinado procesar este contenido. Revisa que el archivo sea correcto o usa la extracción local (gratis).');
      }
      const blocks = textBlocks(message);
      const joined = blocks.join('');
      if (message.stop_reason === 'max_tokens') {
        const cap = maxOutputTokens(model);
        if (!escalated && maxTokens < Math.min(64_000, cap)) {
          escalated = true;
          maxTokens = Math.min(maxTokens * 2, 64_000, cap);
          progress.info('La respuesta es muy larga: reintentando con más margen…');
          continue;
        }
        if (call.allowPartial) {
          const repaired = repairTruncatedJson(joined, (v) => call.schema.safeParse(v).success);
          if (repaired !== undefined) {
            const r = call.schema.safeParse(repaired);
            if (r.success) return { data: r.data, truncated: true, rawText: joined, model: message.model, usage: usageOf(message) };
          }
        }
        throw new AIError('too_large', 'La respuesta es demasiado larga: divide el documento en partes más pequeñas.');
      }

      progress.validating();
      const candidates = blocks.length > 1 ? [joined, blocks[blocks.length - 1]] : [joined];
      const outcome = validate(candidates, call.schema);
      if (outcome.ok) return { data: outcome.data, truncated: false, rawText: joined, model: message.model, usage: usageOf(message) };
      if (correctionAsked) {
        throw new AIError('invalid', 'La IA ha devuelto datos con un formato inesperado. Vuelve a intentarlo o usa la extracción local (gratis).');
      }
      correctionAsked = true;
      progress.info('Corrigiendo el formato de la respuesta…');
      const { invalidOutputFeedback } = await import('./prompts');
      messages = [
        ...baseMessages,
        { role: 'assistant', content: joined.trim() || '(respuesta vacía)' },
        { role: 'user', content: invalidOutputFeedback(outcome.error) },
      ];
    }
  } catch (err) {
    if (isAbortError(err, sdk) || call.signal?.aborted) throw abortError();
    throw toAIError(err, sdk);
  }
}

function usageOf(message: BetaMessage): StructuredResult<unknown>['usage'] {
  const u = message.usage;
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

export async function callStructured<T>(call: StructuredCall<T>): Promise<T> {
  return (await callStructuredDetailed(call)).data;
}

/** Comprueba que la clave funciona con una llamada mínima. */
export async function testApiKey(apiKey: string, model: AIModel): Promise<{ ok: boolean; message: string }> {
  const key = apiKey.trim();
  if (!key) return { ok: false, message: 'Introduce tu clave de API de Anthropic.' };
  const m = resolveModel(model);
  let sdk: SdkModule | undefined;
  try {
    sdk = await loadSdk();
    const client = createClient(sdk, key, { maxRetries: 1, timeout: 60_000 });
    await client.beta.messages.create({
      model: m,
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Responde únicamente: OK' }],
      ...(supportsEffort(m) ? { output_config: { effort: 'low' as const } } : {}),
    });
    // Cualquier respuesta 200 (incluso una negativa o un corte por longitud) demuestra que la clave y el modelo funcionan.
    return { ok: true, message: `Clave válida: ${MODEL_LABELS[m].label} responde correctamente.` };
  } catch (err) {
    return { ok: false, message: toAIError(err, sdk).message };
  }
}

/** Codifica bytes en base64 (sin saltos de línea), por trozos para no desbordar la pila con archivos grandes. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}
