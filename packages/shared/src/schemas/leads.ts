import { z } from 'zod';
import {
  CONSENT_SOURCES,
  CONTACT_CHANNELS,
  INTEREST_LEVELS,
  LEAD_SOURCES,
  LEAD_STATUSES,
} from '../enums';
import { isValidTikTokUsername, normalizePhone } from '../normalize';
import { optionalDate } from './campaigns';
import { optionalText, paginationQuerySchema } from './common';

const optionalUuid = z
  .string()
  .uuid()
  .nullish()
  .or(z.literal(''))
  .transform((v) => v || null);

const tiktokUsername = optionalText(30).refine(
  (v) => v === null || isValidTikTokUsername(v),
  'Username TikTok tidak valid',
);
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || z.string().email().safeParse(v).success, 'Format email tidak valid');
const phone = optionalText(30).refine(
  (v) => v === null || normalizePhone(v) !== null,
  'Nomor telepon tidak valid',
);
const tags = z
  .array(z.string().trim().toLowerCase().min(1).max(30))
  .max(20, 'Maksimal 20 tag')
  .default([])
  .transform((t) => [...new Set(t)]);

export const consentInputSchema = z.object({
  channel: z.enum(CONTACT_CHANNELS),
  source: z.enum(CONSENT_SOURCES),
  /** Bukti persetujuan wajib, mis. "Mengisi form lead TikTok 12/10" atau ID pesan */
  evidence: z.string().trim().min(5, 'Jelaskan bukti persetujuan (min. 5 karakter)').max(500),
});
export type ConsentInput = z.infer<typeof consentInputSchema>;

const leadFields = z.object({
  name: optionalText(120),
  tiktokUsername,
  email,
  phone,
  source: z.enum(LEAD_SOURCES, { errorMap: () => ({ message: 'Pilih sumber prospek' }) }),
  sourceAccountId: optionalUuid,
  sourceCampaignId: optionalUuid,
  interestLevel: z.enum(INTEREST_LEVELS).default('UNKNOWN'),
  operatorId: optionalUuid,
  notes: optionalText(2000),
  tags,
  nextFollowUpAt: optionalDate,
});

const hasIdentifier = (d: {
  tiktokUsername?: string | null;
  email?: string | null;
  phone?: string | null;
}) => Boolean(d.tiktokUsername || d.email || d.phone);

export const createLeadSchema = leadFields
  .extend({ consents: z.array(consentInputSchema).max(5).default([]) })
  .refine(hasIdentifier, {
    message: 'Isi minimal satu kontak: username TikTok, email, atau telepon',
    path: ['tiktokUsername'],
  });
export type CreateLeadInput = z.input<typeof createLeadSchema>;
export type CreateLeadData = z.output<typeof createLeadSchema>;

export const updateLeadSchema = leadFields
  .partial()
  .extend({ status: z.enum(LEAD_STATUSES).optional() })
  .refine((d) => Object.keys(d).length > 0, 'Tidak ada perubahan');
export type UpdateLeadData = z.output<typeof updateLeadSchema>;

export const listLeadsQuerySchema = paginationQuerySchema.extend({
  status: z
    .union([z.enum(LEAD_STATUSES), z.string().transform((s) => s.split(','))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]))
    .pipe(z.array(z.enum(LEAD_STATUSES)).optional()),
  interestLevel: z.enum(INTEREST_LEVELS).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  sourceAccountId: z.string().uuid().optional(),
  sourceCampaignId: z.string().uuid().optional(),
  operatorId: z.union([z.string().uuid(), z.literal('me'), z.literal('none')]).optional(),
  consentChannel: z.enum(CONTACT_CHANNELS).optional(),
  tag: z.string().trim().toLowerCase().max(30).optional(),
  followUp: z.enum(['due', 'scheduled']).optional(),
  includeDoNotContact: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sortBy: z
    .enum(['createdAt', 'score', 'lastContactedAt', 'nextFollowUpAt', 'name'])
    .default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

/** Export memakai filter yang sama dengan daftar, tanpa pagination. */
export const exportLeadsQuerySchema = listLeadsQuerySchema
  .omit({ page: true, pageSize: true })
  .extend({ format: z.enum(['csv', 'xlsx']).default('csv') });
export type ExportLeadsQuery = z.infer<typeof exportLeadsQuerySchema>;

export const leadNoteSchema = z.object({
  note: z.string().trim().min(1, 'Catatan wajib diisi').max(2000),
});

export const withdrawConsentSchema = z.object({
  channel: z.enum(CONTACT_CHANNELS),
  reason: optionalText(500),
});

export const doNotContactSchema = z.object({
  reason: z.string().trim().min(3, 'Isi alasan (min. 3 karakter)').max(500),
});

export const dncEntrySchema = z.object({
  channel: z.enum(CONTACT_CHANNELS),
  value: z.string().trim().min(2).max(254),
  reason: optionalText(500),
});
export type DncEntryInput = z.infer<typeof dncEntrySchema>;

export const listDncQuerySchema = paginationQuerySchema.extend({
  channel: z.enum(CONTACT_CHANNELS).optional(),
});

// ---------------------------------------------------------------- import

/** Header CSV yang dikenali (huruf kecil). Kolom lain diabaikan. */
export const LEAD_IMPORT_COLUMNS = {
  name: ['name', 'nama'],
  tiktokUsername: ['tiktok', 'tiktok_username', 'username', 'username_tiktok'],
  email: ['email', 'e-mail'],
  phone: ['phone', 'telepon', 'no_hp', 'hp', 'whatsapp', 'wa'],
  tags: ['tags', 'tag'],
  notes: ['notes', 'catatan'],
  consentWhatsapp: ['consent_whatsapp', 'izin_whatsapp'],
  consentEmail: ['consent_email', 'izin_email'],
} as const;

export const leadImportOptionsSchema = z.object({
  /** Asal data — wajib dijelaskan agar import hanya untuk data yang diperoleh secara sah */
  sourceDescription: z
    .string()
    .trim()
    .min(10, 'Jelaskan asal data (min. 10 karakter), mis. "Form pendaftaran webinar 10 Okt"')
    .max(300),
  sourceAccountId: optionalUuid,
  sourceCampaignId: optionalUuid,
  tags: tags,
  /** Data ini sah & pemiliknya setuju dihubungi untuk kanal yang ditandai di kolom consent_* */
  lawfulBasisConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'Konfirmasi bahwa data diperoleh secara sah' }),
  }),
  duplicateStrategy: z.enum(['skip', 'update_empty']).default('skip'),
});
export type LeadImportOptions = z.infer<typeof leadImportOptionsSchema>;
