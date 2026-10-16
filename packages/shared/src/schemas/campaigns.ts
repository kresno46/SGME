import { z } from 'zod';
import { CAMPAIGN_STATUSES, CAMPAIGN_TYPES, MARKETING_LANES } from '../enums';
import { optionalText, paginationQuerySchema } from './common';

/** Tanggal dari input form ("2026-10-15") atau ISO; string kosong = null. */
export const optionalDate = z
  .union([z.string(), z.date()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === '') return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tanggal tidak valid' });
      return z.NEVER;
    }
    return d;
  });

const money = z.coerce
  .number({ invalid_type_error: 'Harus berupa angka' })
  .min(0, 'Tidak boleh negatif')
  .max(1e12, 'Nilai terlalu besar');

const campaignFields = z.object({
  name: z.string().trim().min(3, 'Nama campaign minimal 3 karakter').max(150),
  lane: z.enum(MARKETING_LANES, { errorMap: () => ({ message: 'Pilih jalur pemasaran' }) }),
  type: z.enum(CAMPAIGN_TYPES, { errorMap: () => ({ message: 'Pilih jenis campaign' }) }),
  status: z.enum(CAMPAIGN_STATUSES).default('DRAFT'),
  target: optionalText(300),
  description: optionalText(2000),
  startDate: optionalDate,
  endDate: optionalDate,
  budget: z
    .union([money, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  spend: money.optional(),
  operatorId: z
    .string()
    .uuid()
    .nullish()
    .or(z.literal(''))
    .transform((v) => v || null),
  accountIds: z.array(z.string().uuid()).max(50).default([]),
});

const dateOrder = (d: { startDate?: Date | null; endDate?: Date | null }) =>
  !d.startDate || !d.endDate || d.endDate >= d.startDate;
const dateOrderError = {
  message: 'Tanggal selesai harus setelah tanggal mulai',
  path: ['endDate'],
};

export const createCampaignSchema = campaignFields.refine(dateOrder, dateOrderError);
export type CreateCampaignInput = z.input<typeof createCampaignSchema>;
export type CreateCampaignData = z.output<typeof createCampaignSchema>;

export const updateCampaignSchema = campaignFields
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Tidak ada perubahan')
  .refine(dateOrder, dateOrderError);
export type UpdateCampaignData = z.output<typeof updateCampaignSchema>;

export const listCampaignsQuerySchema = paginationQuerySchema.extend({
  lane: z.enum(MARKETING_LANES).optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  type: z.enum(CAMPAIGN_TYPES).optional(),
  accountId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'startDate', 'name']).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;
