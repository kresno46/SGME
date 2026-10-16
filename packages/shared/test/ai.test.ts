import { describe, expect, it } from 'vitest';
import { aiSettingsSchema, detectProhibitedClaims, knowledgeDocumentSchema } from '../src';

const codes = (t: string) => detectProhibitedClaims(t).map((c) => c.code);

describe('guardrail klaim terlarang', () => {
  it.each([
    ['Gabung sekarang, dijamin untung tiap bulan!', 'PROFIT_GUARANTEE'],
    ['Profit pasti kalau ikut strategi ini', 'PROFIT_GUARANTEE'],
    ['Bisa dapat profit 5% per hari loh', 'RETURN_PROMISE'],
    ['Return 10%/bulan konsisten', 'RETURN_PROMISE'],
    ['Investasi tanpa risiko sama sekali', 'RISK_FREE'],
    ['Tenang, nggak mungkin rugi', 'RISK_FREE'],
    ['Modal kecil, untung besar!', 'GET_RICH'],
    ['Rugi kalau gak daftar hari ini', 'PRESSURE'],
  ])('memblokir: %s', (text, code) => {
    expect(codes(text)).toContain(code);
  });

  it.each([
    'Halo Kak! Mau aku kirimin info singkat soal Solid Mini?',
    'Solid Mini bisa diunduh gratis di Play Store dan App Store.',
    'Trading memiliki risiko. Pelajari dulu fiturnya sebelum memutuskan ya.',
    'Biaya langganan Rp49.000 per bulan, bisa dibatalkan kapan saja.',
    'Ada diskon 20% untuk pendaftar minggu ini.',
  ])('tidak memblokir pesan wajar: %s', (text) => {
    expect(detectProhibitedClaims(text)).toEqual([]);
  });
});

describe('skema AI', () => {
  it('knowledge base menolak isi terlalu pendek', () => {
    expect(
      knowledgeDocumentSchema.safeParse({ title: 'FAQ', category: 'FAQ', content: 'pendek' })
        .success,
    ).toBe(false);
  });

  it('pengaturan AI: budget kosong = tanpa batas, harga per model', () => {
    const s = aiSettingsSchema.parse({
      model: '',
      monthlyBudgetUsd: '',
      pricing: { 'model-a': { inputPer1M: '0.5', outputPer1M: 2 } },
    });
    expect(s).toEqual({
      model: null,
      mode: 'COPILOT',
      monthlyBudgetUsd: null,
      pricing: { 'model-a': { inputPer1M: 0.5, outputPer1M: 2 } },
    });
  });
});
