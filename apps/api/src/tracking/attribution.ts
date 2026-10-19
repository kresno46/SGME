/**
 * Atribusi konversi ke campaign.
 * Touchpoint berasal dari: klik/kunjungan pengunjung yang sama (link tracking / landing page),
 * kode referral pada event konversi itu sendiri, dan campaign sumber prospek CRM.
 * Hanya touchpoint dalam jendela lookback SEBELUM konversi yang dihitung.
 */

export interface Touchpoint {
  campaignId: string;
  at: Date;
  kind: 'click' | 'referral' | 'lead_source';
}

export interface AttributionResult {
  firstTouch: Touchpoint | null;
  lastTouch: Touchpoint | null;
}

export function attribute(
  touchpoints: Touchpoint[],
  conversionAt: Date,
  lookbackDays: number,
): AttributionResult {
  const since = conversionAt.getTime() - lookbackDays * 86_400_000;
  const valid = touchpoints
    .filter((t) => t.at.getTime() <= conversionAt.getTime() && t.at.getTime() >= since)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!valid.length) return { firstTouch: null, lastTouch: null };
  return { firstTouch: valid[0], lastTouch: valid[valid.length - 1] };
}

/**
 * Metrik biaya (mis. biaya per lead). null bila biaya belum diisi atau pembagi nol —
 * agar dashboard menampilkan "—", bukan Rp0 yang menyesatkan.
 */
export const ratio = (num: number, den: number): number | null =>
  den > 0 && num > 0 ? Math.round(num / den) : null;

export const percent = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;
