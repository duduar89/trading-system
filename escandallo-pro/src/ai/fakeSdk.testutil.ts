/**
 * SDK de Anthropic falso para los tests de src/ai (sin red). Uso en un test:
 *
 *   vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
 *     const { createMockModule } = await import('./fakeSdk.testutil');
 *     return createMockModule(await importOriginal());
 *   });
 *
 * Conserva las clases de error reales del SDK y sustituye el cliente por uno que registra cada petición y responde
 * con lo que devuelva `fake.responder`.
 */

type SdkModule = typeof import('@anthropic-ai/sdk');
type Listener = (...args: unknown[]) => void;

export interface RecordedRequest {
  kind: 'stream' | 'create';
  params: Record<string, unknown>;
  options?: { signal?: AbortSignal };
  clientOptions: Record<string, unknown>;
}

export interface FakeMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Record<string, unknown>[];
  stop_reason: string;
  stop_sequence: null;
  stop_details: null;
  usage: Record<string, number>;
}

export type FakeReply = FakeMessage | Error;
export type Responder = (req: RecordedRequest, index: number) => FakeReply | Promise<FakeReply>;

export const fake = {
  requests: [] as RecordedRequest[],
  clients: [] as Record<string, unknown>[],
  responder: ((): FakeReply => reply('{}')) as Responder,
  reset(): void {
    this.requests = [];
    this.clients = [];
    this.responder = () => reply('{}');
  },
};

/** Respuesta del modelo con un bloque de pensamiento vacío (como Opus 5 por defecto) y el texto dado. */
export function reply(text: string | string[], opts: { stopReason?: string; model?: string; extraBlocks?: Record<string, unknown>[] } = {}): FakeMessage {
  const texts = Array.isArray(text) ? text : [text];
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: opts.model ?? 'claude-opus-5',
    content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...(opts.extraBlocks ?? []), ...texts.map((t) => ({ type: 'text', text: t }))],
    stop_reason: opts.stopReason ?? 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

export function createMockModule(actual: SdkModule): SdkModule {
  class FakeAnthropic {
    readonly options: Record<string, unknown>;
    readonly beta: { messages: { stream: (p: Record<string, unknown>, o?: { signal?: AbortSignal }) => unknown; create: (p: Record<string, unknown>) => Promise<FakeMessage> } };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      fake.clients.push(options);
      this.beta = {
        messages: {
          stream: (params, reqOptions) => {
            const req: RecordedRequest = { kind: 'stream', params: structuredClone(params), options: reqOptions, clientOptions: options };
            const index = fake.requests.push(req) - 1;
            const listeners: Record<string, Listener[]> = {};
            const emit = (event: string, ...args: unknown[]) => (listeners[event] ?? []).forEach((l) => l(...args));
            const stream = {
              on(event: string, cb: Listener) {
                (listeners[event] ??= []).push(cb);
                return stream;
              },
              async finalMessage(): Promise<FakeMessage> {
                if (reqOptions?.signal?.aborted) throw new actual.APIUserAbortError();
                const r = await fake.responder(req, index);
                if (r instanceof Error) throw r;
                r.content.forEach((block, i) => {
                  if (block.type === 'thinking') emit('streamEvent', { type: 'content_block_start', index: i, content_block: block }, r);
                  if (block.type === 'text' && typeof block.text === 'string') {
                    let soFar = '';
                    for (let k = 0; k < block.text.length; k += 40) {
                      const chunk = block.text.slice(k, k + 40);
                      soFar += chunk;
                      emit('text', chunk, soFar);
                    }
                  }
                });
                return r;
              },
            };
            return stream;
          },
          create: async (params) => {
            const req: RecordedRequest = { kind: 'create', params: structuredClone(params), clientOptions: options };
            const index = fake.requests.push(req) - 1;
            const r = await fake.responder(req, index);
            if (r instanceof Error) throw r;
            return r;
          },
        },
      };
    }
  }
  return { ...actual, default: FakeAnthropic as unknown as SdkModule['default'] };
}

/** Cuerpo de error con la forma de la API de Anthropic. */
export function apiErrorBody(type: string, message: string): { type: 'error'; error: { type: string; message: string } } {
  return { type: 'error', error: { type, message } };
}
