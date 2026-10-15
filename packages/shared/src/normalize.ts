/**
 * Normalisasi identitas kontak untuk deteksi duplikasi prospek & daftar larangan kontak.
 */

/** "@Solid.Mini " -> "solid.mini" */
export function normalizeTikTokUsername(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().replace(/^@+/, '').toLowerCase();
  return v.length ? v : null;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  return v.length ? v : null;
}

/**
 * Normalisasi nomor telepon Indonesia ke format E.164 tanpa "+": 0812… / +62812… / 62812… -> 62812…
 * Nomor non-Indonesia dipertahankan digitnya saja.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  digits = digits.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  else if (digits.startsWith('8')) digits = '62' + digits;
  return digits.length >= 8 ? digits : null;
}

const TIKTOK_USERNAME_RE = /^[a-z0-9._]{2,24}$/;

export function isValidTikTokUsername(input: string): boolean {
  const n = normalizeTikTokUsername(input);
  return !!n && TIKTOK_USERNAME_RE.test(n);
}
