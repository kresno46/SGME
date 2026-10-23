import { z } from 'zod';
import {
  CONTACT_CHANNELS,
  INTEREST_LEVELS,
  MARKETING_LANES,
  OUTREACH_TASK_STATUSES,
  TEMPLATE_PURPOSES,
} from '../enums';
import { findUnknownPlaceholders } from '../outbound';
import { optionalDate } from './campaigns';
import { optionalText, paginationQuerySchema } from './common';

const optionalUuid = z
  .string()
  .uuid()
  .nullish()
  .or(z.literal(''))
  .transform((v) => v || null);

const message = z
  .string()
  .trim()
  .min(5, 'Pesan minimal 5 karakter')
  .max(2000, 'Pesan maksimal 2000 karakter');

// ---------------------------------------------------------------- template

export const templateSchema = z.object({
  name: z.string().trim().min(3, 'Nama template minimal 3 karakter').max(100),
  lane: z
    .enum(MARKETING_LANES)
    .nullish()
    .or(z.literal(''))
    .transform((v) => v || null),
  purpose: z.enum(TEMPLATE_PURPOSES),
  content: message.refine((c) => findUnknownPlaceholders(c).length === 0, {
    message:
      'Ada placeholder yang tidak dikenal. Gunakan {{nama}}, {{username}}, {{akun}}, {{campaign}}, atau {{link}}.',
  }),
  isActive: z.boolean().default(true),
});
export type TemplateInput = z.input<typeof templateSchema>;
export const updateTemplateSchema = templateSchema.partial();

// ---------------------------------------------------------------- tugas

export const outboundQueueQuerySchema = paginationQuerySchema.extend({
  accountId: z.string().uuid({ message: 'Pilih akun TikTok' }),
  channel: z.enum(CONTACT_CHANNELS).default('TIKTOK_DM'),
  campaignId: z.string().uuid().optional(),
});
export type OutboundQueueQuery = z.infer<typeof outboundQueueQuerySchema>;

export const createTaskSchema = z.object({
  leadId: z.string().uuid(),
  tiktokAccountId: z.string().uuid(),
  campaignId: optionalUuid,
  templateId: optionalUuid,
  channel: z.enum(CONTACT_CHANNELS).default('TIKTOK_DM'),
  /** Bila kosong dan templateId diisi, draft dibuat dari template */
  draftMessage: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v || null),
});
export type CreateTaskInput = z.input<typeof createTaskSchema>;

export const updateTaskDraftSchema = z.object({
  draftMessage: message,
  /** true bila draft berasal dari saran AI (untuk pelaporan) */
  aiGenerated: z.boolean().optional(),
});

export const listTasksQuerySchema = paginationQuerySchema.extend({
  accountId: z.string().uuid().optional(),
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(z.enum(OUTREACH_TASK_STATUSES)).optional()),
  operatorId: z.union([z.string().uuid(), z.literal('me')]).optional(),
  followUpDue: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  leadId: z.string().uuid().optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/** Aksi transisi status. Setiap aksi divalidasi ulang terhadap OUTREACH_TRANSITIONS di API. */
export const taskActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit') }),
  z.object({ action: z.literal('approve'), finalMessage: message.optional() }),
  z.object({
    action: z.literal('reject'),
    reviewNote: z.string().trim().min(3, 'Isi catatan untuk operator').max(500),
  }),
  z.object({ action: z.literal('reopen') }),
  z.object({
    action: z.literal('mark_sent'),
    /** Operator wajib mencentang konfirmasi bahwa pesan BENAR-BENAR sudah terkirim */
    confirmed: z.literal(true, {
      errorMap: () => ({ message: 'Centang konfirmasi bahwa pesan sudah benar-benar terkirim' }),
    }),
    message: message.optional(),
  }),
  z.object({
    action: z.literal('log_reply'),
    responseSummary: z.string().trim().min(3, 'Ringkas balasan prospek').max(1000),
    interestLevel: z.enum(INTEREST_LEVELS),
    /** Prospek meminta tidak dihubungi lagi */
    optOut: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('schedule_follow_up'),
    // Accepted for legacy clients only; follow-ups are immediate and this date is ignored.
    followUpAt: optionalDate,
    draftMessage: message.optional(),
  }),
  z.object({
    action: z.literal('complete'),
    outcome: z.enum(['REGISTERED', 'INTERESTED', 'NOT_INTERESTED', 'NO_RESPONSE']),
    note: optionalText(500),
  }),
  z.object({
    action: z.literal('cancel'),
    reason: z.string().trim().min(3, 'Isi alasan pembatalan').max(500),
  }),
]);
export type TaskActionInput = z.input<typeof taskActionSchema>;
export type TaskAction = z.output<typeof taskActionSchema>;

export const OUTCOME_LABELS: Record<
  Extract<TaskAction, { action: 'complete' }>['outcome'],
  string
> = {
  REGISTERED: 'Prospek mendaftar',
  INTERESTED: 'Tertarik, lanjut di kanal lain',
  NOT_INTERESTED: 'Tidak tertarik',
  NO_RESPONSE: 'Tidak ada respons',
};
