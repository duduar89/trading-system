import type { AIModel, AppSettings, ProgressFn } from '../types';
import type { z } from 'zod';
import { todo } from '../lib/todo';

/**
 * Cliente de Claude (SDK oficial @anthropic-ai/sdk, en el navegador con dangerouslyAllowBrowser: la clave
 * es del propio usuario y se guarda sólo en su dispositivo).
 * - Salida estructurada con `output_config.format` (JSON Schema a partir de zod) y validación zod.
 * - Streaming + finalMessage() para respuestas largas.
 * - Comprobar stop_reason ('refusal', 'max_tokens') antes de leer el contenido.
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

export interface StructuredCall<T> {
  settings: AppSettings;
  system: string;
  /** Bloques de contenido del mensaje de usuario (texto, imágenes base64, documentos PDF base64). */
  content: unknown[];
  schema: z.ZodType<T>;
  maxTokens?: number;
  onProgress?: ProgressFn;
  signal?: AbortSignal;
}

export async function callStructured<T>(call: StructuredCall<T>): Promise<T> {
  void call;
  return todo('callStructured');
}

/** Comprueba que la clave funciona con una llamada mínima. */
export async function testApiKey(apiKey: string, model: AIModel): Promise<{ ok: boolean; message: string }> {
  void apiKey;
  void model;
  return todo('testApiKey');
}

export async function blobToBase64(blob: Blob): Promise<string> {
  void blob;
  return todo('blobToBase64');
}

export const MODEL_LABELS: Record<AIModel, { label: string; hint: string }> = {
  'claude-opus-5': { label: 'Claude Opus 5', hint: 'Máxima precisión (recomendado)' },
  'claude-sonnet-5': { label: 'Claude Sonnet 5', hint: 'Equilibrio precisión / coste' },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5', hint: 'El más rápido y económico' },
};
