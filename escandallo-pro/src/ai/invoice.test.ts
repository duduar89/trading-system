import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, InvoiceLine, ProgressInfo } from '../types';
import { fake, reply } from './fakeSdk.testutil';
import { aiExtractInvoice } from './invoice';
import { INVOICE_INSTRUCTION, INVOICE_SYSTEM } from './prompts';
import { invoiceWireJsonSchema } from './schemas';

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const { createMockModule } = await import('./fakeSdk.testutil');
  return createMockModule(await importOriginal());
});

vi.mock('../core/pack', () => ({
  normalizeInvoiceLine: <T extends Pick<InvoiceLine, 'quantity' | 'unit' | 'total' | 'packSize'>>(line: T) => {
    const baseQuantity = line.unit === 'kg' ? line.quantity : line.packSize ? line.quantity * line.packSize.count * line.packSize.size : line.quantity;
    const baseUnit = line.unit === 'kg' ? 'kg' : line.packSize?.unit === 'l' ? 'l' : 'ud';
    return { ...line, baseUnit, baseQuantity, pricePerBase: line.total / baseQuantity, warnings: [] };
  },
}));

const settings: AppSettings = { id: 'app', apiKey: 'sk-ant-test', aiModel: 'claude-opus-5', aiEffort: 'high', aiEnabled: true, theme: 'system', onboardingDone: true };

const modelOutput = {
  supplierName: 'Frutas Hermanos López S.L.',
  supplierTaxId: 'B12345674',
  number: 'A-2031',
  date: '2025-09-18',
  subtotal: 49.2,
  vatTotal: 2.97,
  total: 52.17,
  lines: [
    {
      description: 'TOMATE PERA CAT.I',
      code: '1021',
      quantity: 6.4,
      unit: 'kg',
      unitPrice: 1.85,
      discountPct: 0,
      total: 11.84,
      vatPct: 4,
      suggestedName: 'Tomate pera',
      suggestedCategory: 'verdura',
      confidence: 0.97,
    },
    {
      description: 'LECHE ENTERA BRIK 6X1L',
      code: '2210',
      quantity: 7,
      unit: 'caja',
      unitPrice: 5.34,
      discountPct: 0,
      total: 37.38,
      vatPct: 4,
      packSize: { count: 6, size: 1, unit: 'l' },
      suggestedName: 'Leche entera',
      suggestedCategory: 'lacteo',
      confidence: 0.95,
    },
  ],
  nonProductLines: [{ description: 'Envases retornables' }],
  warnings: [],
};

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);

beforeEach(() => {
  fake.reset();
  fake.responder = () => reply(JSON.stringify(modelOutput));
});

describe('aiExtractInvoice', () => {
  it('PDF: documento antes de la instrucción, parámetros y resultado normalizado', async () => {
    const events: ProgressInfo[] = [];
    const r = await aiExtractInvoice(new Blob([PDF], { type: 'application/pdf' }), 'application/pdf', settings, (p) => events.push(p));
    const params = fake.requests[0].params as { messages: { content: Record<string, unknown>[] }[]; [k: string]: unknown };
    const content = params.messages[0].content;
    expect(content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(PDF).toString('base64') } });
    expect(content[1]).toEqual({ type: 'text', text: INVOICE_INSTRUCTION });
    expect(params.system).toEqual([{ type: 'text', text: INVOICE_SYSTEM, cache_control: { type: 'ephemeral' } }]);
    expect(params.max_tokens).toBe(32000);
    expect(params.output_config).toEqual({ format: { type: 'json_schema', schema: invoiceWireJsonSchema() }, effort: 'high' });

    expect(r).toMatchObject({ method: 'ia', supplierName: 'Frutas Hermanos López S.L.', supplierTaxId: 'B12345674', number: 'A-2031', date: '2025-09-18', subtotal: 49.2 });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1]).toMatchObject({ unit: 'caja', baseUnit: 'l', baseQuantity: 42 });
    expect(r.lines[1].pricePerBase).toBeCloseTo(0.89, 3);
    expect(r.warnings).toEqual(['Se han omitido líneas que no son producto: Envases retornables']);
    expect(r.rawText).toBe(JSON.stringify(modelOutput));

    expect(events[0].stage).toBe('Preparando el documento…');
    expect(events[events.length - 1]).toEqual({ stage: 'Factura leída', progress: 1 });
    const values = events.map((e) => e.progress ?? 0);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  });

  it('reconoce el PDF por su contenido aunque falte el tipo', async () => {
    await aiExtractInvoice(new Blob([PDF]), '', settings);
    const content = (fake.requests[0].params.messages as { content: Record<string, unknown>[] }[])[0].content;
    expect(content[0].type).toBe('document');
  });

  it('foto de factura (PNG) → bloque de imagen', async () => {
    await aiExtractInvoice(new Blob([PNG], { type: 'image/png' }), 'image/png', settings);
    const content = (fake.requests[0].params.messages as { content: Record<string, unknown>[] }[])[0].content;
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(PNG).toString('base64') } });
    expect(content[1].type).toBe('text');
  });

  it('formatos no admitidos → AIError invalid sin llamar a la API', async () => {
    await expect(aiExtractInvoice(new Blob(['a;b;c'], { type: 'text/csv' }), 'text/csv', settings)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(aiExtractInvoice(new Blob([HEIC], { type: 'image/heic' }), 'image/heic', settings)).rejects.toMatchObject({ kind: 'invalid', message: expect.stringMatching(/HEIC/) });
    expect(fake.requests).toHaveLength(0);
  });

  it('respuesta cortada dos veces → líneas completas y aviso', async () => {
    const full = JSON.stringify(modelOutput);
    const cut = full.slice(0, full.indexOf('LECHE ENTERA'));
    fake.responder = () => reply(cut, { stopReason: 'max_tokens' });
    const r = await aiExtractInvoice(new Blob([PDF], { type: 'application/pdf' }), 'application/pdf', settings);
    expect(fake.requests.map((q) => q.params.max_tokens)).toEqual([32000, 64000]);
    expect(r.lines).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/se cortó por ser muy larga/);
  });

  it('IA desactivada → no se llama nunca', async () => {
    await expect(aiExtractInvoice(new Blob([PDF], { type: 'application/pdf' }), 'application/pdf', { ...settings, aiEnabled: false })).rejects.toMatchObject({ kind: 'other' });
    expect(fake.requests).toHaveLength(0);
  });
});
