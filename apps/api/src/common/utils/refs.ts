import type { Prisma } from '@smge/database';
import type { AccountRefDto, RefDto } from '@smge/types';

/** Select ringkas yang dipakai lintas modul untuk referensi relasi. */
export const USER_REF_SELECT = { id: true, name: true } satisfies Prisma.UserSelect;
export const ACCOUNT_REF_SELECT = {
  id: true,
  username: true,
  displayName: true,
  lane: true,
} satisfies Prisma.TikTokAccountSelect;
export const CAMPAIGN_REF_SELECT = { id: true, name: true } satisfies Prisma.CampaignSelect;

export const toRef = (r: { id: string; name: string } | null | undefined): RefDto | null =>
  r ? { id: r.id, name: r.name } : null;

export const toAccountRef = (
  a: Prisma.TikTokAccountGetPayload<{ select: typeof ACCOUNT_REF_SELECT }>,
): AccountRefDto => ({ id: a.id, username: a.username, displayName: a.displayName, lane: a.lane });

export const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** Zona waktu operasional bisnis (batas harian, laporan harian). */
export const BUSINESS_TIMEZONE = 'Asia/Jakarta';

/**
 * Mulai hari ini (00:00) menurut zona waktu bisnis, tidak bergantung pada zona waktu server
 * (container Docker umumnya berjalan dalam UTC).
 */
export function startOfToday(now = new Date(), timeZone = BUSINESS_TIMEZONE) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // "2026-10-16"
  const asUtc = (tz: string) => new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime();
  const offsetMs = asUtc(timeZone) - asUtc('UTC');
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - offsetMs);
}
