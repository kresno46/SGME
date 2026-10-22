import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@smge/database';
import {
  CONVERSION_EVENT_TYPE_LABELS,
  normalizeEmail,
  normalizePhone,
  normalizeTikTokUsername,
  type conversionEventSchema,
} from '@smge/shared';
import type { ConversionResultDto } from '@smge/types';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { env } from '../config/env';
import { LeadActivityService } from '../leads/lead-activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { attribute, Touchpoint } from './attribution';

type ConversionInput = z.output<typeof conversionEventSchema>;
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verifikasi tanda tangan Conversion API:
 *   X-SMGE-Timestamp: <unix detik>
 *   X-SMGE-Signature: hex(HMAC_SHA256(CONVERSION_API_SECRET, `${timestamp}.${rawBody}`))
 */
export function verifyConversionSignature(
  timestamp: string | undefined,
  signature: string | undefined,
  rawBody: Buffer | string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { ok: true } | { ok: false; reason: string } {
  if (!timestamp || !signature)
    return { ok: false, reason: 'Header X-SMGE-Timestamp / X-SMGE-Signature wajib' };
  const t = Number(timestamp);
  if (!Number.isInteger(t)) return { ok: false, reason: 'Timestamp tidak valid' };
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS)
    return { ok: false, reason: 'Timestamp di luar toleransi (5 menit)' };
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${t}.${body}`).digest('hex'),
    'hex',
  );
  const given = /^[0-9a-f]{64}$/i.test(signature) ? Buffer.from(signature, 'hex') : Buffer.alloc(0);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return { ok: false, reason: 'Signature tidak cocok' };
  return { ok: true };
}

/**
 * Conversion API: menerima event TERVERIFIKASI dari backend Solid Mini (instal, registrasi, aktivasi, transaksi),
 * mencocokkan prospek CRM, dan menghitung atribusi first/last-touch.
 */
@Injectable()
export class ConversionsService {
  private readonly logger = new Logger(ConversionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: LeadActivityService,
  ) {}

  authenticate(rawBody: Buffer | undefined, timestamp?: string, signature?: string) {
    const secret = env().CONVERSION_API_SECRET;
    if (!secret)
      throw new ServiceUnavailableException(
        'Conversion API belum dikonfigurasi (CONVERSION_API_SECRET)',
      );
    if (!rawBody?.length) throw new BadRequestException('Body kosong');
    const check = verifyConversionSignature(timestamp, signature, rawBody, secret);
    if (!check.ok) throw new UnauthorizedException(check.reason);
  }

  async ingest(input: ConversionInput): Promise<ConversionResultDto> {
    const key = `s2s:${input.eventId}`;
    const existing = await this.prisma.conversionEvent.findUnique({
      where: { idempotencyKey: key },
      include: { attributions: { include: { campaign: { select: { id: true, name: true } } } } },
    });
    if (existing) return this.result(input.eventId, true, !!existing.leadId, existing.attributions);

    const occurredAt = new Date(input.occurredAt);
    if (occurredAt.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException('occurredAt berada di masa depan');

    // Referensi: kode link tracking, atau tracking code campaign
    const link = input.ref
      ? await this.prisma.trackingLink.findUnique({ where: { code: input.ref } })
      : null;
    const refCampaign =
      !link && input.ref
        ? await this.prisma.campaign.findUnique({
            where: { trackingCode: input.ref },
            select: { id: true },
          })
        : null;

    // Visitor: dari payload, atau dari event sebelumnya milik pengguna yang sama
    const prior = await this.prisma.conversionEvent.findFirst({
      where: { externalUserId: input.externalUserId, visitorId: { not: null } },
      orderBy: { occurredAt: 'asc' },
      select: { visitorId: true },
    });
    const visitorId = input.visitorId ?? prior?.visitorId ?? null;

    const lead = await this.matchLead(input);

    const lookback = env().ATTRIBUTION_LOOKBACK_DAYS;
    const since = new Date(occurredAt.getTime() - lookback * 86_400_000);
    const clicks = visitorId
      ? await this.prisma.conversionEvent.findMany({
          where: {
            visitorId,
            type: { in: ['LANDING_VISIT', 'CTA_CLICK', 'STORE_CLICK'] },
            campaignId: { not: null },
            occurredAt: { gte: since, lte: occurredAt },
          },
          select: { campaignId: true, occurredAt: true },
        })
      : [];
    const touchpoints: Touchpoint[] = [
      ...clicks.map((c) => ({
        campaignId: c.campaignId!,
        at: c.occurredAt,
        kind: 'click' as const,
      })),
      ...(link || refCampaign
        ? [
            {
              campaignId: (link?.campaignId ?? refCampaign!.id) as string,
              at: occurredAt,
              kind: 'referral' as const,
            },
          ]
        : []),
      ...(lead?.sourceCampaignId
        ? [{ campaignId: lead.sourceCampaignId, at: lead.createdAt, kind: 'lead_source' as const }]
        : []),
    ];
    const { firstTouch, lastTouch } = attribute(touchpoints, occurredAt, lookback);

    try {
      await this.prisma.$transaction(async (tx) => {
        const event = await tx.conversionEvent.create({
          data: {
            type: input.type,
            occurredAt,
            leadId: lead?.id ?? null,
            campaignId: lastTouch?.campaignId ?? null,
            tiktokAccountId: link?.tiktokAccountId ?? null,
            trackingLinkId: link?.id ?? null,
            visitorId,
            externalUserId: input.externalUserId,
            referralCode: input.ref ?? null,
            utmSource: input.utmSource,
            utmMedium: input.utmMedium,
            utmCampaign: input.utmCampaign,
            utmContent: input.utmContent,
            value: input.value ?? null,
            isVerified: true,
            dataSource: 'ACTUAL',
            idempotencyKey: key,
          },
        });
        const attr = [
          firstTouch && { model: 'FIRST_TOUCH' as const, t: firstTouch },
          lastTouch && { model: 'LAST_TOUCH' as const, t: lastTouch },
        ].filter(Boolean) as Array<{ model: 'FIRST_TOUCH' | 'LAST_TOUCH'; t: Touchpoint }>;
        for (const a of attr) {
          await tx.campaignAttribution.create({
            data: {
              conversionEventId: event.id,
              campaignId: a.t.campaignId,
              model: a.model,
              weight: 1,
              touchpointAt: a.t.at,
            },
          });
        }
        if (lead) await this.applyToLead(tx, lead.id, input, occurredAt);
      });
    } catch (e) {
      // Pengiriman ganda bersamaan → kembalikan hasil yang sudah tersimpan
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        return this.ingest(input);
      throw e;
    }

    const saved = await this.prisma.conversionEvent.findUniqueOrThrow({
      where: { idempotencyKey: key },
      include: { attributions: { include: { campaign: { select: { id: true, name: true } } } } },
    });
    return this.result(input.eventId, false, !!lead, saved.attributions);
  }

  /** Cocokkan prospek: ID pengguna Solid Mini → kontak ternormalisasi. */
  private async matchLead(input: ConversionInput) {
    const byUser = await this.prisma.lead.findFirst({
      where: { solidMiniUserId: input.externalUserId },
    });
    if (byUser && !byUser.deletedAt) return byUser;
    const c = input.contact;
    if (!c) return null;
    const or: Prisma.LeadWhereInput[] = [];
    const e = normalizeEmail(c.email);
    const p = normalizePhone(c.phone);
    const u = normalizeTikTokUsername(c.tiktokUsername);
    if (e) or.push({ emailNormalized: e });
    if (p) or.push({ phoneNormalized: p });
    if (u) or.push({ tiktokUsernameNormalized: u });
    if (!or.length) return null;
    const lead = await this.prisma.lead.findFirst({
      where: { OR: or, deletedAt: null, solidMiniUserId: null },
    });
    return lead;
  }

  private async applyToLead(
    tx: Prisma.TransactionClient,
    leadId: string,
    input: ConversionInput,
    at: Date,
  ) {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    const data: Prisma.LeadUpdateInput = { solidMiniUserId: input.externalUserId };
    if (input.type === 'REGISTRATION' || input.type === 'INSTALL_VERIFIED') {
      if (input.type === 'REGISTRATION') {
        data.registrationVerifiedAt = lead.registrationVerifiedAt ?? at;
        data.registeredAt = lead.registeredAt ?? at;
        if (!['REGISTERED', 'ACTIVE', 'DO_NOT_CONTACT'].includes(lead.status))
          data.status = 'REGISTERED';
      }
    }
    if (input.type === 'ACTIVATION') {
      data.activationVerifiedAt = lead.activationVerifiedAt ?? at;
      data.activatedAt = lead.activatedAt ?? at;
      data.registrationVerifiedAt = lead.registrationVerifiedAt ?? at;
      data.registeredAt = lead.registeredAt ?? at;
      if (lead.status !== 'DO_NOT_CONTACT') data.status = 'ACTIVE';
    }
    // Pengguna aktif tidak perlu lagi dijangkau: hentikan follow-up yang tertunda
    if (input.type === 'REGISTRATION' || input.type === 'ACTIVATION') data.nextFollowUpAt = null;
    await tx.lead.update({ where: { id: leadId }, data });
    await this.activities.log(
      leadId,
      'CONVERSION',
      `${CONVERSION_EVENT_TYPE_LABELS[input.type]} terverifikasi dari backend Solid Mini`,
      null,
      { eventId: input.eventId, type: input.type, verified: true },
      tx,
    );
  }

  private result(
    eventId: string,
    duplicate: boolean,
    leadMatched: boolean,
    attributions: Array<{ model: string; campaign: { id: string; name: string } }>,
  ): ConversionResultDto {
    const pick = (m: string) => attributions.find((a) => a.model === m)?.campaign ?? null;
    return {
      ok: true,
      eventId,
      duplicate,
      leadMatched,
      attribution: { firstTouch: pick('FIRST_TOUCH'), lastTouch: pick('LAST_TOUCH') },
    };
  }
}
