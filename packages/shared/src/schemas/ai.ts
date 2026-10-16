import { z } from 'zod';
import { AI_INTERACTION_TYPES, AI_MODES, KNOWLEDGE_CATEGORIES, KNOWLEDGE_STATUSES } from '../enums';
import { optionalText, paginationQuerySchema } from './common';

// ---------------------------------------------------------------- knowledge base

export const knowledgeDocumentSchema = z.object({
  title: z.string().trim().min(3, 'Judul minimal 3 karakter').max(200),
  category: z.enum(KNOWLEDGE_CATEGORIES, { errorMap: () => ({ message: 'Pilih kategori' }) }),
  content: z
    .string()
    .trim()
    .min(20, 'Isi minimal 20 karakter')
    .max(20_000, 'Isi maksimal 20.000 karakter'),
  status: z.enum(KNOWLEDGE_STATUSES).default('DRAFT'),
});
export type KnowledgeDocumentInput = z.input<typeof knowledgeDocumentSchema>;
export const updateKnowledgeDocumentSchema = knowledgeDocumentSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Tidak ada perubahan');

export const listKnowledgeQuerySchema = paginationQuerySchema.extend({
  category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
  status: z.enum(KNOWLEDGE_STATUSES).optional(),
});
export type ListKnowledgeQuery = z.infer<typeof listKnowledgeQuerySchema>;

// ---------------------------------------------------------------- pengaturan AI

const price = z.coerce.number().min(0).max(10_000);

export const aiSettingsSchema = z.object({
  /** Kosong = memakai OPENAI_MODEL dari environment */
  model: optionalText(100),
  mode: z.enum(AI_MODES).default('COPILOT'),
  /** Batas biaya per bulan (USD). null = tanpa batas. */
  monthlyBudgetUsd: z
    .union([z.literal(''), z.null(), z.coerce.number().min(0).max(1_000_000)])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  /** Harga per 1 juta token, diisi admin dari halaman harga resmi penyedia */
  pricing: z
    .record(z.string().trim().min(1).max(100), z.object({ inputPer1M: price, outputPer1M: price }))
    .default({}),
});
export type AiSettingsInput = z.input<typeof aiSettingsSchema>;
export type AiSettings = z.output<typeof aiSettingsSchema>;

// ---------------------------------------------------------------- permintaan AI

export const aiAskSchema = z.object({
  question: z.string().trim().min(3, 'Tulis pertanyaan').max(2000),
  /** Opsional: konteks prospek yang sedang ditangani */
  leadId: z.string().uuid().nullish(),
});
export type AiAskInput = z.infer<typeof aiAskSchema>;

export const aiReplySuggestionSchema = z.object({
  incomingMessage: z.string().trim().min(1, 'Tempel pesan dari prospek').max(2000),
  leadId: z.string().uuid().nullish(),
  taskId: z.string().uuid().nullish(),
});
export type AiReplySuggestionInput = z.infer<typeof aiReplySuggestionSchema>;

export const aiDraftSchema = z.object({
  taskId: z.string().uuid(),
  /** Arahan tambahan operator, mis. "lebih santai", "sebut webinar Sabtu" */
  instructions: optionalText(500),
});
export type AiDraftInput = z.input<typeof aiDraftSchema>;

export const aiUsageQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const listAiInteractionsQuerySchema = paginationQuerySchema.extend({
  type: z.enum(AI_INTERACTION_TYPES).optional(),
  status: z.enum(['SUCCESS', 'FAILED', 'BLOCKED']).optional(),
});
