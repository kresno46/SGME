/**
 * Abstraksi penyedia model bahasa. Implementasi: OpenAI (sungguhan) dan Simulated (development).
 * Provider dapat diganti di test lewat token LLM_PROVIDER.
 */

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  /** Nama & JSON Schema keluaran terstruktur (strict) */
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
}

export interface LlmResponse {
  /** Teks JSON sesuai jsonSchema */
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmProvider {
  readonly name: 'openai' | 'simulated';
  /** Keluaran bukan dari model sungguhan — wajib diberi label SIMULASI */
  readonly simulated: boolean;
  readonly defaultModel: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Kesalahan dari provider (jaringan, kuota, model tidak ada) yang aman ditampilkan ke operator. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}
