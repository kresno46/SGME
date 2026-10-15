import { z } from 'zod';
import { MARKETING_LANES, TIKTOK_ACCOUNT_STATUSES, TIKTOK_ACCOUNT_TYPES } from '../enums';
import { isValidTikTokUsername, normalizeTikTokUsername } from '../normalize';
import { optionalText, optionalUrl, paginationQuerySchema } from './common';

const usernameSchema = z
  .string()
  .trim()
  .min(1, 'Username wajib diisi')
  .refine(isValidTikTokUsername, 'Username hanya boleh huruf, angka, titik, dan garis bawah (2–24)')
  .transform((v) => normalizeTikTokUsername(v) as string);

export const tiktokAccountBaseSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1, 'Nama tampilan wajib diisi').max(100),
  profileUrl: optionalUrl,
  avatarUrl: optionalUrl,
  accountType: z.enum(TIKTOK_ACCOUNT_TYPES).default('PERSONAL'),
  isVerified: z.boolean().default(false),
  followersCount: z.coerce
    .number({ invalid_type_error: 'Jumlah followers harus angka' })
    .int('Jumlah followers harus bilangan bulat')
    .min(0, 'Jumlah followers tidak boleh negatif')
    .max(1_000_000_000)
    .default(0),
  lane: z.enum(MARKETING_LANES, { errorMap: () => ({ message: 'Pilih jalur pemasaran' }) }),
  status: z.enum(TIKTOK_ACCOUNT_STATUSES).default('ACTIVE'),
  notes: optionalText(1000),
});

export const createTikTokAccountSchema = tiktokAccountBaseSchema;
export type CreateTikTokAccountInput = z.input<typeof createTikTokAccountSchema>;

export const updateTikTokAccountSchema = tiktokAccountBaseSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Tidak ada perubahan');
export type UpdateTikTokAccountInput = z.input<typeof updateTikTokAccountSchema>;

export const listTikTokAccountsQuerySchema = paginationQuerySchema.extend({
  lane: z.enum(MARKETING_LANES).optional(),
  status: z.enum(TIKTOK_ACCOUNT_STATUSES).optional(),
  sortBy: z.enum(['followersCount', 'createdAt', 'username']).default('followersCount'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListTikTokAccountsQuery = z.infer<typeof listTikTokAccountsQuerySchema>;
