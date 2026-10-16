/**
 * Guardrail konten AI: mendeteksi klaim yang DILARANG muncul dalam pesan pemasaran Solid Mini,
 * terutama janji keuntungan/profit trading. Dipakai API (memblokir keluaran AI) dan dashboard (peringatan
 * saat operator mengetik). Ini lapisan pengaman tambahan — instruksi sistem tetap menjadi lapisan pertama.
 */

export interface ProhibitedClaim {
  code: 'PROFIT_GUARANTEE' | 'RETURN_PROMISE' | 'RISK_FREE' | 'GET_RICH' | 'PRESSURE';
  label: string;
  match: string;
}

const RULES: Array<{ code: ProhibitedClaim['code']; label: string; pattern: RegExp }> = [
  {
    code: 'PROFIT_GUARANTEE',
    label: 'Menjanjikan keuntungan pasti',
    pattern:
      /\b(pasti|dijamin|jaminan|garansi|100\s?%)\s+(untung|profit|cuan|menang|balik modal|bertambah)|\b(untung|profit|cuan)\s+(pasti|dijamin|terjamin|konsisten setiap)/i,
  },
  {
    code: 'RETURN_PROMISE',
    label: 'Menjanjikan imbal hasil tertentu',
    pattern:
      /\b(profit|untung|cuan|return|imbal hasil|keuntungan)\b[^.\n]{0,25}\d+([.,]\d+)?\s?%\s*(per|\/|tiap|setiap)\s*(hari|minggu|bulan|tahun)|\d+([.,]\d+)?\s?%\s*(per|\/|tiap|setiap)\s*(hari|minggu|bulan)[^.\n]{0,25}\b(profit|untung|cuan)\b/i,
  },
  {
    code: 'RISK_FREE',
    label: 'Mengklaim tanpa risiko',
    pattern:
      /\b(tanpa|bebas|nol|zero)\s+(risiko|resiko|rugi|loss)\b|\b(tidak|gak|nggak|ga)\s+(mungkin|akan|bakal)\s+rugi\b/i,
  },
  {
    code: 'GET_RICH',
    label: 'Janji cepat kaya / passive income pasti',
    pattern:
      /\b(cepat|langsung|mendadak|auto)\s+kaya\b|\bpassive income\s+(pasti|dijamin)\b|\bmodal kecil,?\s+untung besar\b/i,
  },
  {
    code: 'PRESSURE',
    label: 'Tekanan berlebihan',
    pattern:
      /\b(kesempatan terakhir|sekarang juga atau|rugi kalau (tidak|gak|ga) (ikut|daftar)|jangan sampai menyesal)\b/i,
  },
];

export function detectProhibitedClaims(text: string): ProhibitedClaim[] {
  const found: ProhibitedClaim[] = [];
  for (const r of RULES) {
    const m = r.pattern.exec(text);
    if (m) found.push({ code: r.code, label: r.label, match: m[0] });
  }
  return found;
}
