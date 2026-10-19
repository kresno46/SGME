import { z } from 'zod';
import {
  ATTRIBUTION_MODELS,
  CLIENT_EVENT_TYPES,
  MARKETING_LANES,
  SERVER_EVENT_TYPES,
} from '../enums';
import { optionalText } from './common';

const utm = z
  .string()
  .trim()
  .max(100)
  .regex(/^[\w.-]*$/, 'Hanya huruf, angka, titik, garis bawah, dan tanda hubung')
  .nullish()
  .transform((v) => v || null);

// ---------------------------------------------------------------- link tracking (admin)

export const trackingLinkSchema = z.object({
  name: optionalText(100),
  destinationUrl: z
    .string()
    .trim()
    .url('URL tujuan tidak valid')
    .max(1000)
    .refine((u) => /^https?:\/\//i.test(u), 'URL harus diawali http(s)://'),
  tiktokAccountId: z
    .string()
    .uuid()
    .nullish()
    .or(z.literal(''))
    .transform((v) => v || null),
  utmSource: utm.default('tiktok'),
  utmMedium: utm,
  utmContent: utm,
});
export type TrackingLinkInput = z.input<typeof trackingLinkSchema>;

export const updateTrackingLinkSchema = z.object({
  name: optionalText(100).optional(),
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------- event dari landing page (publik)

/** ID pengunjung anonim (dibuat SMGE saat redirect, atau oleh skrip landing page). */
export const visitorIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, 'visitorId tidak valid');

export const publicTrackEventSchema = z.object({
  type: z.enum(CLIENT_EVENT_TYPES),
  /** Kode link tracking (parameter smge_ref) */
  ref: z.string().trim().max(64).nullish(),
  visitorId: visitorIdSchema.nullish(),
  utmSource: utm,
  utmMedium: utm,
  utmCampaign: utm,
  utmContent: utm,
});
export type PublicTrackEventInput = z.input<typeof publicTrackEventSchema>;

// ---------------------------------------------------------------- Conversion API (server-to-server)

export const conversionEventSchema = z.object({
  /** ID unik event di sistem Solid Mini — kunci idempotensi (kirim ulang aman) */
  eventId: z.string().trim().min(1).max(128),
  type: z.enum(SERVER_EVENT_TYPES),
  occurredAt: z.string().datetime({ offset: true, message: 'occurredAt harus ISO-8601' }),
  /** ID pengguna di Solid Mini */
  externalUserId: z.string().trim().min(1).max(128),
  /** Nilai smge_ref yang diteruskan dari link (kode link tracking atau tracking code campaign) */
  ref: z.string().trim().max(64).nullish(),
  visitorId: visitorIdSchema.nullish(),
  utmSource: utm,
  utmMedium: utm,
  utmCampaign: utm,
  utmContent: utm,
  /** Rupiah, untuk TRANSACTION/SUBSCRIPTION */
  value: z.number().min(0).max(1e12).nullish(),
  /** Opsional: untuk mencocokkan prospek CRM. Hanya dipakai untuk pencocokan, tidak disimpan ulang. */
  contact: z
    .object({
      email: z.string().trim().max(254).nullish(),
      phone: z.string().trim().max(30).nullish(),
      tiktokUsername: z.string().trim().max(30).nullish(),
    })
    .nullish(),
});
export type ConversionEventInput = z.input<typeof conversionEventSchema>;

// ---------------------------------------------------------------- filter analitik

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  lane: z.enum(MARKETING_LANES).optional(),
  campaignId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  model: z.enum(ATTRIBUTION_MODELS).default('LAST_TOUCH'),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
