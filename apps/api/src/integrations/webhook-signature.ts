import { createHmac, timingSafeEqual } from 'node:crypto';

/** Toleransi umur webhook (detik). Dokumentasi TikTok menyerahkan nilai ini ke penerima. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: string };

/**
 * Verifikasi header `TikTok-Signature: t=<unix>,s=<hex>`.
 * signed_payload = `${t}.${rawBody}`; HMAC-SHA256 dengan client_secret.
 * Sumber: https://developers.tiktok.com/doc/webhooks-verification
 */
export function verifyTikTokSignature(
  header: string | undefined,
  rawBody: Buffer | string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
): SignatureCheck {
  if (!header) return { ok: false, reason: 'Header TikTok-Signature tidak ada' };
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const s = parts.s;
  if (!Number.isFinite(t) || !s) return { ok: false, reason: 'Format signature tidak valid' };

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(s, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, reason: 'Signature tidak cocok' };
  if (Math.abs(nowSeconds - t) > toleranceSeconds)
    return { ok: false, reason: 'Webhook kedaluwarsa' };
  return { ok: true, timestamp: t };
}
