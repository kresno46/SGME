import { LlmProvider, LlmRequest, LlmResponse } from './llm-provider';

/**
 * Provider SIMULASI untuk development tanpa API key. Keluarannya deterministik, selalu diawali
 * "[SIMULASI]", ditandai is_simulation di log, dan tidak dihitung sebagai biaya.
 * Tidak pernah dipilih otomatis — harus diaktifkan eksplisit dengan AI_PROVIDER=simulated.
 */
export class SimulatedProvider implements LlmProvider {
  readonly name = 'simulated' as const;
  readonly simulated = true;
  readonly defaultModel = 'simulasi';

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const tag = '[SIMULASI]';
    const outputs: Record<string, unknown> = {
      knowledge_answer: {
        answer: `${tag} Ini contoh jawaban. Dengan model sungguhan, jawaban disusun dari Knowledge Base Solid Mini.`,
        handoff: false,
        handoffReason: '',
        usedSourceNumbers: [],
      },
      reply_suggestion: {
        reply: `${tag} Makasih udah balas, Kak! Ini contoh saran balasan dari AI.`,
        detectedIntent: 'Contoh intent (simulasi)',
        handoff: false,
        handoffReason: '',
        usedSourceNumbers: [],
      },
      outreach_draft: {
        message: `${tag} Halo Kak! Ini contoh draft pesan personal dari AI. Boleh aku kirim info singkat soal Solid Mini?`,
        rationale: `${tag} Contoh alasan pemilihan gaya pesan.`,
      },
      lead_score: {
        score: 50,
        interestLevel: 'MEDIUM',
        reasons: [`${tag} Contoh alasan skor`],
        recommendedAction: `${tag} Contoh rekomendasi tindakan`,
      },
      lead_summary: {
        summary: `${tag} Contoh ringkasan riwayat prospek.`,
        keyPoints: [`${tag} Contoh poin penting`],
        nextStep: `${tag} Contoh langkah berikutnya`,
      },
    };
    const output = outputs[req.schemaName];
    if (!output) throw new Error(`Skema simulasi tidak dikenal: ${req.schemaName}`);
    const content = JSON.stringify(output);
    return {
      content,
      model: this.defaultModel,
      // Perkiraan kasar (≈4 karakter/token) agar alur pencatatan tetap teruji
      promptTokens: Math.ceil((req.system.length + req.user.length) / 4),
      completionTokens: Math.ceil(content.length / 4),
    };
  }
}
