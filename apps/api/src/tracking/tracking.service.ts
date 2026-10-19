import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@smge/database';
import type { PublicTrackEventInput, TrackingLinkInput } from '@smge/shared';
import type { TrackingLinkDto } from '@smge/types';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import type { trackingLinkSchema } from '@smge/shared';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto/crypto.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { RequestMeta } from '../common/utils/request';
import { ACCOUNT_REF_SELECT, toAccountRef } from '../common/utils/refs';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/** Bot/preview link (mis. pratinjau chat) tidak dihitung sebagai kunjungan. */
const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|headless|python-requests|axios/i;
/** Klik berulang oleh pengunjung yang sama pada link yang sama dalam rentang ini dihitung sekali. */
const CLICK_DEDUP_MS = 30 * 60_000;

const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export function generateLinkCode(length = 7) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
export const newVisitorId = () => randomBytes(12).toString('base64url');

const LINK_INCLUDE = {
  campaign: { select: { id: true, name: true, trackingCode: true, lane: true } },
  tiktokAccount: { select: ACCOUNT_REF_SELECT },
} satisfies Prisma.TrackingLinkInclude;

type LinkRow = Prisma.TrackingLinkGetPayload<{ include: typeof LINK_INCLUDE }>;

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  shortUrl(code: string) {
    return `${env().APP_PUBLIC_URL}/api/t/${code}`;
  }

  /** IP tidak disimpan mentah — hanya hash bergaram untuk deteksi penyalahgunaan. */
  hashIp(ip: string | null) {
    return ip ? this.crypto.sha256(`${ip}:${env().ENCRYPTION_KEY}`).slice(0, 32) : null;
  }

  // ------------------------------------------------------------ admin: link

  async listForCampaign(campaignId: string): Promise<TrackingLinkDto[]> {
    const links = await this.prisma.trackingLink.findMany({
      where: { campaignId },
      include: LINK_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    if (!links.length) return [];
    const ids = links.map((l) => l.id);
    const [clicks, visitors, regs] = await Promise.all([
      this.prisma.conversionEvent.groupBy({
        by: ['trackingLinkId'],
        where: { trackingLinkId: { in: ids }, type: 'CTA_CLICK' },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ id: string; n: bigint }>>`
        SELECT tracking_link_id::text AS id, count(DISTINCT visitor_id) AS n
        FROM conversion_events
        WHERE tracking_link_id = ANY(${ids}::uuid[]) AND visitor_id IS NOT NULL
        GROUP BY 1`,
      this.prisma.conversionEvent.groupBy({
        by: ['trackingLinkId'],
        where: { trackingLinkId: { in: ids }, type: 'REGISTRATION', isVerified: true },
        _count: { _all: true },
      }),
    ]);
    const count = (
      rows: Array<{ trackingLinkId: string | null; _count: { _all: number } }>,
      id: string,
    ) => rows.find((r) => r.trackingLinkId === id)?._count._all ?? 0;
    return links.map((l) => ({
      ...this.toDto(l),
      stats: {
        clicks: count(clicks, l.id),
        uniqueVisitors: Number(visitors.find((v) => v.id === l.id)?.n ?? 0),
        registrations: count(regs, l.id),
      },
    }));
  }

  private toDto(l: LinkRow): Omit<TrackingLinkDto, 'stats'> {
    return {
      id: l.id,
      code: l.code,
      name: l.name,
      campaign: { id: l.campaign.id, name: l.campaign.name },
      account: l.tiktokAccount ? toAccountRef(l.tiktokAccount) : null,
      destinationUrl: l.destinationUrl,
      shortUrl: this.shortUrl(l.code),
      utmSource: l.utmSource,
      utmMedium: l.utmMedium,
      utmCampaign: l.utmCampaign,
      utmContent: l.utmContent,
      isActive: l.isActive,
      createdAt: l.createdAt.toISOString(),
    };
  }

  async create(
    actor: RequestUser,
    campaignId: string,
    input: z.output<typeof trackingLinkSchema>,
    meta: RequestMeta,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { accounts: true },
    });
    if (!campaign) throw new NotFoundException('Campaign tidak ditemukan');
    let accountUsername: string | null = null;
    if (input.tiktokAccountId) {
      const acc = await this.prisma.tikTokAccount.findUnique({
        where: { id: input.tiktokAccountId },
      });
      if (!acc) throw new BadRequestException('Akun TikTok tidak ditemukan');
      if (acc.lane !== campaign.lane)
        throw new BadRequestException('Akun harus sejalur dengan campaign');
      accountUsername = acc.username;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const link = await this.prisma.trackingLink.create({
          data: {
            code: generateLinkCode(),
            name: input.name,
            campaignId,
            tiktokAccountId: input.tiktokAccountId,
            destinationUrl: input.destinationUrl,
            utmSource: input.utmSource ?? 'tiktok',
            utmMedium: input.utmMedium ?? (campaign.lane === 'OFFICIAL' ? 'official' : 'outbound'),
            utmCampaign: campaign.trackingCode,
            utmContent: input.utmContent ?? accountUsername,
          },
          include: LINK_INCLUDE,
        });
        await this.audit.log({
          action: 'tracking_link.created',
          actor,
          entityType: 'tracking_link',
          entityId: link.id,
          metadata: { campaignId, code: link.code },
          meta,
        });
        return { ...this.toDto(link), stats: { clicks: 0, uniqueVisitors: 0, registrations: 0 } };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new BadRequestException('Gagal membuat kode link unik, coba lagi');
  }

  async update(
    actor: RequestUser,
    id: string,
    input: { name?: string | null; isActive?: boolean },
    meta: RequestMeta,
  ) {
    const link = await this.prisma.trackingLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Link tidak ditemukan');
    await this.prisma.trackingLink.update({ where: { id }, data: input });
    await this.audit.log({
      action: 'tracking_link.updated',
      actor,
      entityType: 'tracking_link',
      entityId: id,
      metadata: input,
      meta,
    });
    return (await this.listForCampaign(link.campaignId)).find((l) => l.id === id)!;
  }

  // ------------------------------------------------------------ publik: redirect & event

  /**
   * Klik link pendek: catat CTA_CLICK (kecuali bot / klik berulang), lalu arahkan ke tujuan dengan UTM,
   * `smge_ref` (kode link) dan `smge_vid` (ID pengunjung) agar dapat diteruskan sampai registrasi.
   */
  async resolveClick(
    code: string,
    visitorId: string | null,
    client: ClientMeta,
  ): Promise<{ url: string; visitorId: string } | null> {
    const link = await this.prisma.trackingLink.findUnique({
      where: { code },
      include: { campaign: { select: { status: true } } },
    });
    if (!link) return null;
    const vid = visitorId ?? newVisitorId();

    const url = new URL(link.destinationUrl);
    const set = (k: string, v: string | null) =>
      v && !url.searchParams.has(k) && url.searchParams.set(k, v);
    set('utm_source', link.utmSource);
    set('utm_medium', link.utmMedium);
    set('utm_campaign', link.utmCampaign);
    set('utm_content', link.utmContent);
    url.searchParams.set('smge_ref', link.code);
    url.searchParams.set('smge_vid', vid);

    const isBot = !!client.userAgent && BOT_UA.test(client.userAgent);
    if (link.isActive && !isBot) {
      const bucket = Math.floor(Date.now() / CLICK_DEDUP_MS);
      await this.prisma.conversionEvent
        .create({
          data: {
            type: 'CTA_CLICK',
            occurredAt: new Date(),
            campaignId: link.campaignId,
            tiktokAccountId: link.tiktokAccountId,
            trackingLinkId: link.id,
            visitorId: vid,
            utmSource: link.utmSource,
            utmMedium: link.utmMedium,
            utmCampaign: link.utmCampaign,
            utmContent: link.utmContent,
            isVerified: false,
            idempotencyKey: `click:${link.id}:${vid}:${bucket}`,
            ipHash: this.hashIp(client.ip),
            userAgent: client.userAgent?.slice(0, 300),
          },
        })
        .catch((e) => {
          // klik berulang dalam rentang yang sama → abaikan
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        });
    }
    return { url: url.toString(), visitorId: vid };
  }

  /** Event dari skrip landing page (tidak terverifikasi). */
  async recordClientEvent(
    input: PublicTrackEventInput & { type: 'LANDING_VISIT' | 'CTA_CLICK' | 'STORE_CLICK' },
    client: ClientMeta,
  ) {
    if (client.userAgent && BOT_UA.test(client.userAgent))
      return { recorded: false, reason: 'bot' };
    const link = input.ref
      ? await this.prisma.trackingLink.findUnique({ where: { code: input.ref } })
      : null;
    const campaign =
      !link && input.ref
        ? await this.prisma.campaign.findUnique({
            where: { trackingCode: input.ref },
            select: { id: true },
          })
        : null;
    const vid = input.visitorId ?? null;
    const bucket = Math.floor(Date.now() / CLICK_DEDUP_MS);
    try {
      await this.prisma.conversionEvent.create({
        data: {
          type: input.type,
          occurredAt: new Date(),
          campaignId: link?.campaignId ?? campaign?.id ?? null,
          tiktokAccountId: link?.tiktokAccountId ?? null,
          trackingLinkId: link?.id ?? null,
          visitorId: vid,
          utmSource: input.utmSource ?? link?.utmSource ?? null,
          utmMedium: input.utmMedium ?? link?.utmMedium ?? null,
          utmCampaign: input.utmCampaign ?? link?.utmCampaign ?? null,
          utmContent: input.utmContent ?? link?.utmContent ?? null,
          referralCode: input.ref ?? null,
          isVerified: false,
          idempotencyKey: vid
            ? `client:${input.type}:${link?.id ?? input.ref ?? '-'}:${vid}:${bucket}`
            : undefined,
          ipHash: this.hashIp(client.ip),
          userAgent: client.userAgent?.slice(0, 300),
        },
      });
      return { recorded: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        return { recorded: false, reason: 'duplikat' };
      throw e;
    }
  }
}
