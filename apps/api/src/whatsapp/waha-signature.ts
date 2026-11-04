import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
export const MIN_MASTER_SECRET_LENGTH = 32;

/**
 * Nama sesi baru: `u-<32 hex UUID user>-<8 hex acak>`. Seluruh UUID user dipakai (awalan saja bisa kembar), dan
 * akhiran acak membedakan beberapa nomor milik user yang sama. `single` (WAHA_SESSION_NAME) = mode satu sesi
 * bersama untuk WAHA lama.
 */
export function newSessionName(userId: string, single?: string | null): string {
  return (
    single || `u-${userId.replaceAll('-', '').toLowerCase()}-${randomBytes(4).toString('hex')}`
  );
}

/** Kunci URL webhook yang boleh diproses. Keabsahan sebenarnya ditentukan tanda tangan dan baris sesi di database. */
export function isSessionKey(key: string): boolean {
  return SESSION_NAME_PATTERN.test(key);
}

/**
 * Secret HMAC webhook satu sesi = HMAC-SHA256(rahasia induk, nama sesi). Tidak disimpan di mana pun:
 * membocorkan satu secret sesi tidak membuka sesi lain, dan rahasia induk tidak meninggalkan API.
 */
export function deriveWebhookSecret(master: string, sessionName: string): string {
  if (master.length < MIN_MASTER_SECRET_LENGTH)
    throw new Error('Rahasia induk WAHA terlalu pendek');
  if (!SESSION_NAME_PATTERN.test(sessionName)) throw new Error('Nama sesi WhatsApp tidak valid');
  return createHmac('sha256', master).update(`waha-session-v1:${sessionName}`).digest('hex');
}

/** WAHA menandatangani body mentah dengan HMAC-SHA512 (hex) di header `X-Webhook-Hmac`. */
export function verifyWahaSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  secret: string,
): boolean {
  if (!rawBody) return false;
  let provided = (header ?? '').trim().toLowerCase();
  if (provided.startsWith('sha512=')) provided = provided.slice('sha512='.length);
  if (!/^[0-9a-f]{128}$/.test(provided)) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(provided, 'hex'));
}
