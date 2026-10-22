import { z } from 'zod';

export const browserDmQueueSchema = z.object({ accountId: z.string().uuid() });
export const browserDmEnqueueSchema = browserDmQueueSchema.extend({
  taskIds: z.array(z.string().uuid()).min(1).max(30).optional(),
});
export const browserDmPrepareSchema = browserDmQueueSchema.extend({
  requestId: z.string().uuid(),
  leadIds: z
    .array(z.string().uuid())
    .min(1)
    .max(30)
    .refine((ids) => new Set(ids).size === ids.length, 'Penerima duplikat'),
  message: z
    .string()
    .trim()
    .min(5)
    .max(2000)
    .refine(
      (value) =>
        [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].every((match) =>
          ['nama', 'username', 'akun'].includes(match[1]),
        ),
      'Gunakan variabel nama, username, atau akun; ganti variabel lain dengan teks.',
    ),
  mode: z.enum(['approve', 'submit']),
  confirmed: z.literal(true),
});
export const browserDmClaimSchema = browserDmQueueSchema.extend({ clientId: z.string().uuid() });
export const browserDmAttemptSchema = z.object({
  clientId: z.string().uuid(),
  attemptId: z.string().uuid(),
});
export const browserDmResultSchema = browserDmAttemptSchema.extend({
  status: z.enum(['SENT', 'FAILED', 'UNVERIFIED']),
  detail: z.string().trim().min(1).max(500),
});
export const browserDmResolveSchema = z.object({ confirmed: z.literal(true), sent: z.boolean() });
export const browserDmRetrySchema = z.object({ confirmedNotSent: z.literal(true) });
