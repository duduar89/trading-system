import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AppSettings } from '../types';
import { apiErrorBody, fake, reply } from './fakeSdk.testutil';
import {
  AIError,
  blobToBase64,
  buildRequestParams,
  callStructured,
  callStructuredDetailed,
  extractJson,
  FALLBACK_BETA,
  repairTruncatedJson,
  testApiKey,
  toAIError,
} from './client';

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const { createMockModule } = await import('./fakeSdk.testutil');
  return createMockModule(await importOriginal());
});

const sdk = await import('@anthropic-ai/sdk');

const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({
  id: 'app',
  apiKey: 'sk-ant-test',
  aiModel: 'claude-opus-5',
  aiEffort: 'medium',
  aiEnabled: true,
  theme: 'system',
  onboardingDone: true,
  ...patch,
});

const schema = z.object({ items: z.array(z.object({ name: z.string(), price: z.number() })) });
const jsonSchema = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number' } }, required: ['name', 'price'], additionalProperties: false } } },
  required: ['items'],
  additionalProperties: false,
};
const okJson = JSON.stringify({ items: [{ name: 'Croquetas', price: 9.5 }] });

beforeEach(() => fake.reset());

describe('buildRequestParams', () => {
  const base = {
    effort: 'high' as const,
    system: 'sys',
    messages: [{ role: 'user' as const, content: 'hola' }],
    maxTokens: 32000,
    jsonSchema,
    withFallbacks: true,
  };

  it('Opus 5: effort, respaldo en servidor, sin thinking explícito ni muestreo', () => {
    const p = buildRequestParams({ ...base, model: 'claude-opus-5' }) as unknown as Record<string, unknown>;
    expect(p.model).toBe('claude-opus-5');
    expect(p.output_config).toEqual({ format: { type: 'json_schema', schema: jsonSchema }, effort: 'high' });
    expect(p.betas).toEqual([FALLBACK_BETA]);
    expect(p.fallbacks).toBe('default');
    expect(p).not.toHaveProperty('thinking');
    for (const k of ['temperature', 'top_p', 'top_k']) expect(p).not.toHaveProperty(k);
  });

  it('Opus 5 sin respaldo cuando se desactiva', () => {
    const p = buildRequestParams({ ...base, model: 'claude-opus-5', withFallbacks: false }) as unknown as Record<string, unknown>;
    expect(p).not.toHaveProperty('betas');
    expect(p).not.toHaveProperty('fallbacks');
  });

  it('Sonnet 5: thinking adaptativo y effort; nunca respaldo', () => {
    const p = buildRequestParams({ ...base, model: 'claude-sonnet-5' }) as unknown as Record<string, unknown>;
    expect(p.thinking).toEqual({ type: 'adaptive' });
    expect((p.output_config as Record<string, unknown>).effort).toBe('high');
    expect(p).not.toHaveProperty('betas');
    expect(p).not.toHaveProperty('fallbacks');
  });

  it('Haiku 4.5: sin effort ni thinking, max_tokens limitado a 64K', () => {
    const p = buildRequestParams({ ...base, model: 'claude-haiku-4-5', maxTokens: 100_000 }) as unknown as Record<string, unknown>;
    expect(p.output_config).toEqual({ format: { type: 'json_schema', schema: jsonSchema } });
    expect(p).not.toHaveProperty('thinking');
    expect(p).not.toHaveProperty('fallbacks');
    expect(p.max_tokens).toBe(64_000);
  });

  it('modelo desconocido → Opus 5; effort no válido → medium', () => {
    const p = buildRequestParams({ ...base, model: 'gpt-4' as never, effort: 'max' as never }) as unknown as Record<string, unknown>;
    expect(p.model).toBe('claude-opus-5');
    expect((p.output_config as Record<string, unknown>).effort).toBe('medium');
  });

  it('bloques de sistema con cache_control en el prefijo estable', () => {
    const p = buildRequestParams({ ...base, model: 'claude-opus-5', system: [{ text: 'instrucciones' }, { text: 'catálogo', cache: true }, { text: '  ' }] });
    expect(p.system).toEqual([
      { type: 'text', text: 'instrucciones' },
      { type: 'text', text: 'catálogo', cache_control: { type: 'ephemeral' } },
    ]);
  });
});

describe('toAIError', () => {
  const h = () => new Headers();
  it('traduce las clases de error del SDK', () => {
    const cases: [unknown, string, RegExp][] = [
      [new sdk.AuthenticationError(401, apiErrorBody('authentication_error', 'invalid x-api-key'), undefined, h()), 'auth', /clave de API no es válida/],
      [new sdk.PermissionDeniedError(403, apiErrorBody('permission_error', 'no'), undefined, h()), 'auth', /permiso/],
      [new sdk.RateLimitError(429, apiErrorBody('rate_limit_error', 'slow down'), undefined, h()), 'rate', /límite de uso/],
      [new sdk.APIConnectionError({ message: 'Connection error.' }), 'network', /conexión/],
      [new sdk.APIConnectionTimeoutError({ message: 'timeout' }), 'network', /tardado demasiado/],
      [new sdk.InternalServerError(500, apiErrorBody('api_error', 'boom'), undefined, h()), 'overloaded', /error temporal/],
      [new sdk.InternalServerError(529, apiErrorBody('overloaded_error', 'Overloaded'), undefined, h()), 'overloaded', /saturado/],
      [new sdk.BadRequestError(400, apiErrorBody('invalid_request_error', 'messages.0: bad thing'), undefined, h()), 'invalid', /messages\.0: bad thing/],
      [new sdk.BadRequestError(400, apiErrorBody('invalid_request_error', 'prompt is too long: 250000 tokens > 200000 maximum'), undefined, h()), 'too_large', /demasiado grande/],
      [new sdk.BadRequestError(400, apiErrorBody('invalid_request_error', 'Your credit balance is too low'), undefined, h()), 'invalid', /saldo/],
      [new sdk.APIError(413, apiErrorBody('request_too_large', 'Request exceeds the maximum size'), undefined, h()), 'too_large', /32 MB/],
      [new sdk.NotFoundError(404, apiErrorBody('not_found_error', 'model: x'), undefined, h()), 'other', /no está disponible/],
      [new Error('raro'), 'other', /raro/],
    ];
    for (const [err, kind, re] of cases) {
      const e = toAIError(err, sdk);
      expect(e).toBeInstanceOf(AIError);
      expect(e.kind, String(err)).toBe(kind);
      expect(e.message).toMatch(re);
    }
  });

  it('errores a mitad del streaming (sin estado HTTP) por tipo', () => {
    expect(toAIError(new sdk.APIConnectionError({ message: '{"type":"overloaded_error","message":"Overloaded"}' }), sdk).kind).toBe('overloaded');
  });

  it('deja pasar AIError tal cual', () => {
    const e = new AIError('refusal', 'x');
    expect(toAIError(e, sdk)).toBe(e);
  });
});

describe('callStructured', () => {
  it('construye el cliente, envía la petición y valida con zod', async () => {
    fake.responder = () => reply(okJson);
    const controller = new AbortController();
    const res = await callStructuredDetailed({ settings: settings(), system: 'sys', content: [{ type: 'text', text: 'lee' }], schema, jsonSchema, maxTokens: 32000, signal: controller.signal });
    expect(res.data).toEqual({ items: [{ name: 'Croquetas', price: 9.5 }] });
    expect(res.truncated).toBe(false);
    expect(res.rawText).toBe(okJson);
    expect(res.usage.outputTokens).toBe(340);
    expect(fake.clients[0]).toMatchObject({ apiKey: 'sk-ant-test', dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 600_000 });
    const req = fake.requests[0];
    expect(req.kind).toBe('stream');
    expect(req.options?.signal).toBe(controller.signal);
    expect(req.params).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 32000,
      system: 'sys',
      output_config: { format: { type: 'json_schema', schema: jsonSchema }, effort: 'medium' },
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'lee' }] }],
    });
    expect(req.params).not.toHaveProperty('temperature');
  });

  it('informa del progreso de forma creciente', async () => {
    fake.responder = () => reply(JSON.stringify({ items: Array.from({ length: 60 }, (_, i) => ({ name: `Plato ${i}`, price: i + 1 })) }));
    const events: { stage: string; progress?: number }[] = [];
    await callStructured({ settings: settings(), system: 's', content: [], schema, jsonSchema, onProgress: (p) => events.push(p), stage: 'Leyendo…', progressRange: [0.1, 0.9], expectedChars: 1000 });
    expect(events.length).toBeGreaterThan(3);
    const values = events.map((e) => e.progress ?? 0);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(values[0]).toBeGreaterThanOrEqual(0.1);
    expect(values[values.length - 1]).toBeLessThanOrEqual(0.9);
    expect(events.some((e) => e.stage === 'Leyendo…')).toBe(true);
  });

  it('une el texto de antes y después de un respaldo a mitad de respuesta', async () => {
    const half = Math.floor(okJson.length / 2);
    fake.responder = () => ({
      ...reply([okJson.slice(0, half), okJson.slice(half)]),
      content: [
        { type: 'text', text: okJson.slice(0, half) },
        { type: 'fallback', from: { model: 'claude-opus-5' }, to: { model: 'claude-opus-4-8' } },
        { type: 'text', text: okJson.slice(half) },
      ],
      model: 'claude-opus-4-8',
    });
    const res = await callStructuredDetailed({ settings: settings(), system: 's', content: [], schema, jsonSchema });
    expect(res.data.items[0].name).toBe('Croquetas');
    expect(res.model).toBe('claude-opus-4-8');
  });

  it('negativa → AIError refusal (sin leer el contenido)', async () => {
    fake.responder = () => reply('', { stopReason: 'refusal' });
    await expect(callStructured({ settings: settings(), system: 's', content: [], schema, jsonSchema })).rejects.toMatchObject({ kind: 'refusal' });
  });

  it('max_tokens → reintenta una vez con más margen', async () => {
    fake.responder = (_req, i) => (i === 0 ? reply('{"items":[{"name":"A","pr', { stopReason: 'max_tokens' }) : reply(okJson));
    const res = await callStructuredDetailed({ settings: settings(), system: 's', content: [], schema, jsonSchema, maxTokens: 16000 });
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[0].params.max_tokens).toBe(16000);
    expect(fake.requests[1].params.max_tokens).toBe(32000);
    expect(res.truncated).toBe(false);
  });

  it('max_tokens persistente → recupera la parte completa si se permite', async () => {
    fake.responder = () => reply('{"items":[{"name":"A","price":1},{"name":"B","price":2},{"name":"C","pri', { stopReason: 'max_tokens' });
    const res = await callStructuredDetailed({ settings: settings(), system: 's', content: [], schema, jsonSchema, maxTokens: 32000, allowPartial: true });
    expect(res.truncated).toBe(true);
    expect(res.data.items.map((x) => x.name)).toEqual(['A', 'B']);
    expect(fake.requests[1].params.max_tokens).toBe(64000);
  });

  it('max_tokens persistente sin recuperación → too_large', async () => {
    fake.responder = () => reply('{"items":[', { stopReason: 'max_tokens' });
    await expect(callStructured({ settings: settings(), system: 's', content: [], schema, jsonSchema, maxTokens: 64000 })).rejects.toMatchObject({
      kind: 'too_large',
      message: 'La respuesta es demasiado larga: divide el documento en partes más pequeñas.',
    });
    expect(fake.requests).toHaveLength(1);
  });

  it('JSON no válido → pide la corrección una vez con el error como nuevo turno', async () => {
    fake.responder = (_req, i) => (i === 0 ? reply('{"items": [{"name": "A"}]}') : reply(okJson));
    const res = await callStructured({ settings: settings(), system: 's', content: [{ type: 'text', text: 'lee' }], schema, jsonSchema });
    expect(res.items).toHaveLength(1);
    const messages = fake.requests[1].params.messages as { role: string; content: unknown }[];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1].content).toBe('{"items": [{"name": "A"}]}');
    expect(String(messages[2].content)).toMatch(/items\.0\.price/);
    expect(messages[messages.length - 1].role).toBe('user'); // nunca prefill del asistente
  });

  it('JSON no válido dos veces → AIError invalid', async () => {
    fake.responder = () => reply('esto no es JSON');
    await expect(callStructured({ settings: settings(), system: 's', content: [], schema, jsonSchema })).rejects.toMatchObject({ kind: 'invalid' });
    expect(fake.requests).toHaveLength(2);
  });

  it('errores del SDK → AIError traducido', async () => {
    fake.responder = () => new sdk.RateLimitError(429, apiErrorBody('rate_limit_error', 'rate'), undefined, new Headers());
    await expect(callStructured({ settings: settings(), system: 's', content: [], schema, jsonSchema })).rejects.toMatchObject({ kind: 'rate' });
  });

  it('IA desactivada o sin clave → no llama a la API', async () => {
    await expect(callStructured({ settings: settings({ aiEnabled: false }), system: 's', content: [], schema, jsonSchema })).rejects.toMatchObject({ kind: 'other' });
    await expect(callStructured({ settings: settings({ apiKey: '  ' }), system: 's', content: [], schema, jsonSchema })).rejects.toMatchObject({ kind: 'auth' });
    expect(fake.requests).toHaveLength(0);
  });

  it('cancelación → AbortError', async () => {
    const c = new AbortController();
    c.abort();
    await expect(callStructured({ settings: settings(), system: 's', content: [], schema, jsonSchema, signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const c2 = new AbortController();
    fake.responder = () => {
      c2.abort();
      return new sdk.APIUserAbortError();
    };
    await expect(callStructured({ settings: settings(), system: 's', content: [], schema, jsonSchema, signal: c2.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('petición de más de 32 MB → too_large sin llamar', async () => {
    const big = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'A'.repeat(32_000_000) } };
    await expect(callStructured({ settings: settings(), system: 's', content: [big], schema, jsonSchema })).rejects.toMatchObject({ kind: 'too_large' });
    expect(fake.requests).toHaveLength(0);
  });

  it('Haiku y Sonnet: parámetros por modelo en la petición real', async () => {
    fake.responder = () => reply(okJson);
    await callStructured({ settings: settings({ aiModel: 'claude-haiku-4-5', aiEffort: 'high' }), system: 's', content: [], schema, jsonSchema });
    await callStructured({ settings: settings({ aiModel: 'claude-sonnet-5', aiEffort: 'low' }), system: 's', content: [], schema, jsonSchema });
    const [haiku, sonnet] = fake.requests.map((r) => r.params);
    expect(haiku.output_config).toEqual({ format: { type: 'json_schema', schema: jsonSchema } });
    expect(haiku).not.toHaveProperty('thinking');
    expect(haiku).not.toHaveProperty('betas');
    expect(sonnet.thinking).toEqual({ type: 'adaptive' });
    expect(sonnet.output_config).toMatchObject({ effort: 'low' });
    expect(sonnet).not.toHaveProperty('fallbacks');
  });

  it('deriva el JSON Schema del esquema zod si no se pasa', async () => {
    fake.responder = () => reply(okJson);
    await callStructured({ settings: settings(), system: 's', content: [], schema });
    const sent = (fake.requests[0].params.output_config as { format: { schema: Record<string, unknown> } }).format.schema;
    expect(sent.type).toBe('object');
    expect(sent.additionalProperties).toBe(false);
    expect(sent).not.toHaveProperty('$schema');
  });

  it('si la API rechaza el respaldo en servidor, reintenta sin él y no lo vuelve a enviar', async () => {
    vi.resetModules();
    const fresh = await import('./client');
    fake.responder = (req) =>
      req.params.fallbacks
        ? new sdk.BadRequestError(400, apiErrorBody('invalid_request_error', 'fallbacks: Extra inputs are not permitted'), undefined, new Headers())
        : reply(okJson);
    await fresh.callStructured({ settings: settings(), system: 's', content: [], schema, jsonSchema });
    await fresh.callStructured({ settings: settings(), system: 's', content: [], schema, jsonSchema });
    expect(fake.requests.map((r) => 'fallbacks' in r.params)).toEqual([true, false, false]);
  });
});

describe('testApiKey', () => {
  it('petición mínima: max_tokens 64 y effort low cuando se admite', async () => {
    fake.responder = () => reply('OK');
    const r = await testApiKey(' sk-ant-xyz ', 'claude-opus-5');
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Claude Opus 5/);
    expect(fake.clients[0]).toMatchObject({ apiKey: 'sk-ant-xyz', dangerouslyAllowBrowser: true });
    expect(fake.requests[0]).toMatchObject({ kind: 'create', params: { model: 'claude-opus-5', max_tokens: 64, output_config: { effort: 'low' } } });
  });

  it('Haiku sin effort', async () => {
    fake.responder = () => reply('OK');
    await testApiKey('k', 'claude-haiku-4-5');
    expect(fake.requests[0].params).not.toHaveProperty('output_config');
  });

  it('clave inválida → mensaje claro', async () => {
    fake.responder = () => new sdk.AuthenticationError(401, apiErrorBody('authentication_error', 'invalid x-api-key'), undefined, new Headers());
    const r = await testApiKey('mala', 'claude-sonnet-5');
    expect(r).toEqual({ ok: false, message: 'La clave de API no es válida o ha sido revocada. Revísala en Ajustes.' });
  });

  it('clave vacía → sin petición', async () => {
    expect((await testApiKey('   ', 'claude-opus-5')).ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('utilidades', () => {
  it('blobToBase64 sin saltos de línea y correcto en archivos grandes', async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 7919) % 256);
    const b64 = await blobToBase64(new Blob([bytes]));
    expect(b64).toBe(Buffer.from(bytes).toString('base64'));
    expect(b64).not.toMatch(/\s/);
  });

  it('extractJson tolera vallas y texto alrededor', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Aquí tienes: {"a":[1,2]} ¡listo!')).toEqual({ a: [1, 2] });
    expect(extractJson('nada')).toBeUndefined();
  });

  it('repairTruncatedJson descarta el último elemento incompleto', () => {
    expect(repairTruncatedJson('{"a":1,"lines":[{"x":1},{"x":2},{"x":')).toEqual({ a: 1, lines: [{ x: 1 }, { x: 2 }] });
    expect(repairTruncatedJson('{"a":"hola, qué tal","b":[1,2,3')).toEqual({ a: 'hola, qué tal', b: [1, 2] });
    expect(repairTruncatedJson('{"lines":[{"d":"CAJA 6X1L, lote')).toEqual({ lines: [] });
    expect(repairTruncatedJson('{"a":1}')).toEqual({ a: 1 });
    expect(repairTruncatedJson('sin json')).toBeUndefined();
  });
});
