import { z } from 'zod';
import { isValidTikTokUsername, normalizeTikTokUsername } from '../normalize';

export const FOLLOWER_BATCH_LIMIT = 250;
const username = z
  .string()
  .trim()
  .max(30)
  .refine(isValidTikTokUsername, 'Username TikTok tidak valid')
  .transform((value) => normalizeTikTokUsername(value)!);

/** Browser-collected data is operator supplied, not verified by TikTok's API. */
export const followerBatchSchema = z
  .object({
    format: z.literal('smge-followers-v1'),
    accountUsername: username,
    collectedAt: z.string().datetime(),
    stopReason: z.string().max(160),
    followers: z
      .array(
        z
          .object({
            username,
            displayName: z.string().trim().max(80).optional(),
          })
          .strict(),
      )
      .min(1, 'File belum berisi followers')
      .max(FOLLOWER_BATCH_LIMIT),
  })
  .strict();

export const followerImportSchema = z
  .object({
    accountId: z.string().uuid(),
    batch: followerBatchSchema,
  })
  .strict();
export type FollowerBatch = z.infer<typeof followerBatchSchema>;
export type FollowerImport = z.infer<typeof followerImportSchema>;
