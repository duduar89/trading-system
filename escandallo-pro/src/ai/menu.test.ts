import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../types';
import { fake, reply } from './fakeSdk.testutil';
import { aiExtractMenu } from './menu';
import { MENU_SYSTEM } from './prompts';

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const { createMockModule } = await import('./fakeSdk.testutil');
  return createMockModule(await importOriginal());
});

const settings: AppSettings = { id: 'app', apiKey: 'sk-ant-test', aiModel: 'claude-sonnet-5', aiEffort: 'medium', aiEnabled: true, theme: 'system', onboardingDone: true };

const JPEG = (n: number) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, n])], { type: 'image/jpeg' });
const PDF = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], { type: 'application/pdf' });

const output = {
  items: [
    { section: 'Entrantes', name: 'Pulpo a la gallega', description: 'Con cachelos', price: 18.5, confidence: 0.98 },
    { section: 'Entrantes', name: 'Croquetas de jamón', description: 'Media ración: 6 €', price: 10, confidence: 0.96 },
    { section: 'Entrantes', name: 'Pulpo a la gallega', description: '', price: 18.5, confidence: 0.9 },
    { section: 'Bebidas', name: 'Caña', description: '', price: 2.2, confidence: 0.99 },
  ],
  warnings: [],
};

beforeEach(() => {
  fake.reset();
  fake.responder = () => reply(JSON.stringify(output), { model: 'claude-sonnet-5' });
});

describe('aiExtractMenu', () => {
  it('varias fotos en una petición, etiquetadas y en orden, con la instrucción al final', async () => {
    const r = await aiExtractMenu([JPEG(1), JPEG(2), JPEG(3)], settings);
    expect(fake.requests).toHaveLength(1);
    const params = fake.requests[0].params as { messages: { content: Record<string, unknown>[] }[]; [k: string]: unknown };
    const content = params.messages[0].content;
    expect(content.map((b) => (b.type === 'text' ? b.text : b.type))).toEqual([
      'Foto 1:',
      'image',
      'Foto 2:',
      'image',
      'Foto 3:',
      'image',
      'Estas 3 fotos son partes de la misma carta, en orden. Extrae todos los platos y productos con su sección, descripción y precio, sin duplicados.',
    ]);
    expect((content[3].source as Record<string, unknown>).media_type).toBe('image/jpeg');
    expect(params.system).toEqual([{ type: 'text', text: MENU_SYSTEM, cache_control: { type: 'ephemeral' } }]);
    expect(params.max_tokens).toBe(16000);
    expect(params.thinking).toEqual({ type: 'adaptive' });

    expect(r.method).toBe('ia');
    expect(r.entries.map((e) => e.name)).toEqual(['Pulpo a la gallega', 'Croquetas de jamón', 'Caña']);
    expect(r.entries[1]).toMatchObject({ section: 'Entrantes', description: 'Media ración: 6 €', price: 10 });
  });

  it('una sola foto y PDF de carta', async () => {
    await aiExtractMenu([PDF], settings);
    const content = (fake.requests[0].params.messages as { content: Record<string, unknown>[] }[])[0].content;
    expect(content[0]).toEqual({ type: 'text', text: 'Documento 1:' });
    expect(content[1].type).toBe('document');
    expect(content[2]).toEqual({ type: 'text', text: 'Extrae todos los platos y productos de esta carta con su sección, descripción y precio.' });
  });

  it('sin fotos o demasiadas → error claro sin llamar', async () => {
    await expect(aiExtractMenu([], settings)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(aiExtractMenu(Array.from({ length: 101 }, (_, i) => JPEG(i)), settings)).rejects.toMatchObject({ kind: 'too_large' });
    expect(fake.requests).toHaveLength(0);
  });

  it('progreso: prepara cada foto y termina en 1', async () => {
    const stages: string[] = [];
    let last = 0;
    await aiExtractMenu([JPEG(1), JPEG(2)], settings, (p) => {
      stages.push(p.stage);
      expect(p.progress ?? 0).toBeGreaterThanOrEqual(last);
      last = p.progress ?? last;
    });
    expect(stages.slice(0, 2)).toEqual(['Preparando foto 1 de 2…', 'Preparando foto 2 de 2…']);
    expect(stages).toContain('Claude está leyendo la carta (2 fotos)…');
    expect(last).toBe(1);
  });
});
