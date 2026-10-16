import OpenAI, { APIError } from 'openai';
import { LlmProvider, LlmProviderError, LlmRequest, LlmResponse } from './llm-provider';

/** Provider OpenAI (Chat Completions + Structured Outputs). API key hanya ada di server. */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;
  readonly simulated = false;
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly defaultModel: string,
    opts: { baseURL?: string; timeoutMs: number },
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL: opts.baseURL,
      timeout: opts.timeoutMs,
      maxRetries: 2,
    });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    try {
      const res = await this.client.chat.completions.create({
        model: req.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: true },
        },
        max_completion_tokens: req.maxTokens,
      });
      const message = res.choices[0]?.message;
      if (message?.refusal)
        throw new LlmProviderError(`Model menolak permintaan: ${message.refusal}`, false);
      if (!message?.content) throw new LlmProviderError('Model tidak mengembalikan jawaban', true);
      return {
        content: message.content,
        model: res.model,
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
      };
    } catch (e) {
      if (e instanceof LlmProviderError) throw e;
      if (e instanceof APIError) {
        const status = e.status ?? 0;
        if (status === 401) throw new LlmProviderError('API key OpenAI tidak valid', false);
        if (status === 404)
          throw new LlmProviderError(`Model "${req.model}" tidak tersedia untuk akun ini`, false);
        if (status === 429)
          throw new LlmProviderError('Kuota/rate limit OpenAI tercapai. Coba lagi nanti.', true);
        throw new LlmProviderError(`OpenAI error (${status || 'jaringan'})`, true);
      }
      throw new LlmProviderError('Tidak dapat terhubung ke OpenAI', true);
    }
  }
}
