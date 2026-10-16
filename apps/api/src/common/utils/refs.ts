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

/** Mulai hari ini (00:00) menurut zona waktu server. */
export function startOfToday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
