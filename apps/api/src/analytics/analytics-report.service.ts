import { Injectable } from '@nestjs/common';
import { Prisma } from '@smge/database';
import {
  CONVERSION_EVENT_TYPE_LABELS,
  type AnalyticsQuery,
  type DataSource,
  type MarketingLane,
} from '@smge/shared';
import type { AnalyticsReportDto, FunnelStageDto } from '@smge/types';
import { BUSINESS_TIMEZONE, startOfToday } from '../common/utils/refs';
import { PrismaService } from '../prisma/prisma.service';
import { percent, ratio } from '../tracking/attribution';

const CLIENT_TYPES = ['LANDING_VISIT', 'CTA_CLICK', 'STORE_CLICK'] as const;
const VERIFIED_TYPES = ['INSTALL_VERIFIED', 'REGISTRATION', 'ACTIVATION'] as const;
const LANES: MarketingLane[] = ['OFFICIAL', 'OUTBOUND'];

type Raw = Prisma.Sql;
const empty = Prisma.empty;

/**
 * Laporan analitik. Prinsip:
 * - Data simulasi tidak dihitung.
 * - Klik/kunjungan = tidak terverifikasi; instal/registrasi/aktivasi hanya dari Conversion API (terverifikasi).
 * - Registrasi yang hanya dikonfirmasi operator dilaporkan terpisah.
 * - Biaya = total biaya campaign yang berjalan dalam periode (biaya belum tersedia per hari).
 */
@Injectable()
export class AnalyticsReportService {
  constructor(private readonly prisma: PrismaService) {}

  async report(q: AnalyticsQuery): Promise<AnalyticsReportDto> {
    const to = new Date();
    const from = new Date(startOfToday().getTime() - (q.days - 1) * 86_400_000);
    const model = q.model;

    // ---------- fragmen SQL filter
    /** Filter event klik/kunjungan (campaign langsung pada event). */
    const clientFilter: Raw = Prisma.sql`
      ${q.campaignId ? Prisma.sql`AND ce.campaign_id = ${q.campaignId}::uuid` : empty}
      ${q.accountId ? Prisma.sql`AND ce.tiktok_account_id = ${q.accountId}::uuid` : empty}
      ${q.lane ? Prisma.sql`AND EXISTS (SELECT 1 FROM campaigns c WHERE c.id = ce.campaign_id AND c.lane = ${q.lane}::"MarketingLane")` : empty}`;
    /** Filter event terverifikasi (lewat atribusi model terpilih). */
    const verifiedFilter = (laneOverride?: MarketingLane | null): Raw => {
      const lane = laneOverride ?? q.lane;
      const needAttr = q.campaignId || lane;
      return Prisma.sql`
        ${q.accountId ? Prisma.sql`AND ce.tiktok_account_id = ${q.accountId}::uuid` : empty}
        ${
          needAttr
            ? Prisma.sql`AND EXISTS (
                SELECT 1 FROM campaign_attributions ca JOIN campaigns c ON c.id = ca.campaign_id
                WHERE ca.conversion_event_id = ce.id AND ca.model = ${model}::"AttributionModel"
                ${q.campaignId ? Prisma.sql`AND ca.campaign_id = ${q.campaignId}::uuid` : empty}
                ${lane ? Prisma.sql`AND c.lane = ${lane}::"MarketingLane"` : empty})`
            : empty
        }`;
    };
    /** Filter prospek (sumber akun/campaign). */
    const leadWhere = (lane?: MarketingLane | null): Prisma.LeadWhereInput => {
      const l = lane ?? q.lane;
      return {
        dataSource: { not: 'SIMULATED' },
        ...(q.campaignId ? { sourceCampaignId: q.campaignId } : {}),
        ...(q.accountId ? { sourceAccountId: q.accountId } : {}),
        ...(l
          ? {
              OR: [
                { sourceAccount: { lane: l } },
                { sourceAccountId: null, sourceCampaign: { lane: l } },
              ],
            }
          : {}),
      };
    };
    const taskWhere = (lane?: MarketingLane | null): Prisma.OutreachTaskWhereInput => {
      const l = lane ?? q.lane;
      return {
        ...(q.campaignId ? { campaignId: q.campaignId } : {}),
        ...(q.accountId ? { tiktokAccountId: q.accountId } : {}),
        ...(l ? { tiktokAccount: { lane: l } } : {}),
      };
    };
    const campaignWhere = (lane?: MarketingLane | null): Prisma.CampaignWhereInput => {
      const l = lane ?? q.lane;
      return {
        ...(q.campaignId ? { id: q.campaignId } : {}),
        ...(q.accountId ? { accounts: { some: { tiktokAccountId: q.accountId } } } : {}),
        ...(l ? { lane: l } : {}),
        AND: [
          { OR: [{ startDate: null }, { startDate: { lte: to } }] },
          { OR: [{ endDate: null }, { endDate: { gte: from } }] },
        ],
      };
    };

    // ---------- helper hitung
    const distinctClient = async (types: readonly string[], extra: Raw = empty) => {
      const r = await this.prisma.$queryRaw<[{ n: bigint }]>`
        SELECT count(DISTINCT coalesce(ce.visitor_id, ce.id::text)) AS n FROM conversion_events ce
        WHERE ce.type::text = ANY(${types as string[]}) AND ce.data_source <> 'SIMULATED'
          AND ce.occurred_at >= ${from} AND ce.occurred_at <= ${to} ${clientFilter} ${extra}`;
      return Number(r[0].n);
    };
    const distinctVerified = async (
      type: string,
      lane?: MarketingLane | null,
      extra: Raw = empty,
    ) => {
      const r = await this.prisma.$queryRaw<[{ n: bigint }]>`
        SELECT count(DISTINCT ce.external_user_id) AS n FROM conversion_events ce
        WHERE ce.type::text = ${type} AND ce.is_verified = true AND ce.data_source <> 'SIMULATED'
          AND ce.occurred_at >= ${from} AND ce.occurred_at <= ${to} ${verifiedFilter(lane)} ${extra}`;
      return Number(r[0].n);
    };
    const spendOf = async (lane?: MarketingLane | null) => {
      const rows = await this.prisma.campaign.findMany({
        where: campaignWhere(lane),
        select: { spend: true, spendSource: true },
      });
      return {
        spend: rows.reduce((n, r) => n + Number(r.spend), 0),
        sources: [
          ...new Set(rows.filter((r) => Number(r.spend) > 0).map((r) => r.spendSource)),
        ] as DataSource[],
      };
    };
    const inRange = { gte: from, lte: to };

    // ---------- KPI
    const [
      leads,
      contacted,
      replies,
      visitors,
      storeClicks,
      installs,
      regs,
      acts,
      regsOperator,
      spend,
      ai,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { ...leadWhere(), createdAt: inRange } }),
      this.prisma.outreachTask.count({ where: { ...taskWhere(), sentConfirmedAt: inRange } }),
      this.prisma.outreachTask.count({ where: { ...taskWhere(), repliedAt: inRange } }),
      distinctClient(CLIENT_TYPES),
      distinctClient(['STORE_CLICK']),
      distinctVerified('INSTALL_VERIFIED'),
      distinctVerified('REGISTRATION'),
      distinctVerified('ACTIVATION'),
      this.prisma.lead.count({
        where: { ...leadWhere(), registeredAt: inRange, registrationVerifiedAt: null },
      }),
      spendOf(),
      this.prisma.aiInteraction.aggregate({
        where: { createdAt: inRange, isSimulation: false },
        _sum: { costUsd: true },
      }),
    ]);

    // ---------- funnel
    const funnelTypes = ['LANDING_VISIT', 'CTA_CLICK', 'STORE_CLICK', ...VERIFIED_TYPES] as const;
    const funnel: FunnelStageDto[] = await Promise.all(
      funnelTypes.map(async (t) => {
        const verified = (VERIFIED_TYPES as readonly string[]).includes(t);
        return {
          type: t,
          label: CONVERSION_EVENT_TYPE_LABELS[t],
          count: verified ? await distinctVerified(t) : await distinctClient([t]),
          verified,
        };
      }),
    );

    // ---------- per jalur
    const lanes = await Promise.all(
      LANES.filter((l) => !q.lane || q.lane === l).map(async (lane) => {
        const [ld, ct, rp, rg, ac, sp] = await Promise.all([
          this.prisma.lead.count({ where: { ...leadWhere(lane), createdAt: inRange } }),
          this.prisma.outreachTask.count({
            where: { ...taskWhere(lane), sentConfirmedAt: inRange },
          }),
          this.prisma.outreachTask.count({ where: { ...taskWhere(lane), repliedAt: inRange } }),
          distinctVerified('REGISTRATION', lane),
          distinctVerified('ACTIVATION', lane),
          spendOf(lane),
        ]);
        return {
          lane,
          leads: ld,
          contacted: ct,
          replies: rp,
          registrations: rg,
          activations: ac,
          spend: sp.spend,
          costPerLead: ratio(sp.spend, ld),
          costPerRegistration: ratio(sp.spend, rg),
        };
      }),
    );

    // ---------- pertumbuhan prospek per hari & jalur
    const growthRows = await this.prisma.$queryRaw<
      Array<{ day: string; lane: string | null; n: bigint }>
    >`
      SELECT to_char(l.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BUSINESS_TIMEZONE}, 'YYYY-MM-DD') AS day,
             coalesce(a.lane::text, c.lane::text) AS lane, count(*) AS n
      FROM leads l
      LEFT JOIN tiktok_accounts a ON a.id = l.source_account_id
      LEFT JOIN campaigns c ON c.id = l.source_campaign_id
      WHERE l.created_at >= ${from} AND l.data_source <> 'SIMULATED'
        ${q.campaignId ? Prisma.sql`AND l.source_campaign_id = ${q.campaignId}::uuid` : empty}
        ${q.accountId ? Prisma.sql`AND l.source_account_id = ${q.accountId}::uuid` : empty}
      GROUP BY 1, 2`;
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE });
    const leadsGrowth = Array.from({ length: q.days }, (_, i) => {
      const date = fmt.format(new Date(from.getTime() + i * 86_400_000 + 3_600_000));
      const pick = (lane: string | null) =>
        growthRows
          .filter((r) => r.day === date && r.lane === lane)
          .reduce((n, r) => n + Number(r.n), 0);
      return { date, OFFICIAL: pick('OFFICIAL'), OUTBOUND: pick('OUTBOUND'), NONE: pick(null) };
    }).map((d) =>
      q.lane ? { ...d, [q.lane === 'OFFICIAL' ? 'OUTBOUND' : 'OFFICIAL']: 0, NONE: 0 } : d,
    );

    // ---------- status prospek (snapshot)
    const statusGroups = await this.prisma.lead.groupBy({
      by: ['status'],
      where: { ...leadWhere(), deletedAt: null },
      _count: { _all: true },
    });

    // ---------- campaign
    const campaignRows = await this.prisma.campaign.findMany({
      where: { ...campaignWhere(), status: { not: 'ARCHIVED' } },
      select: { id: true, name: true, lane: true, status: true, spend: true, spendSource: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const campaigns = await Promise.all(
      campaignRows.map(async (c) => {
        const cf = Prisma.sql`AND ce.campaign_id = ${c.id}::uuid`;
        const attr = (type: string) => this.prisma.$queryRaw<[{ n: bigint }]>`
          SELECT count(DISTINCT ce.external_user_id) AS n FROM conversion_events ce
          JOIN campaign_attributions ca ON ca.conversion_event_id = ce.id AND ca.model = ${model}::"AttributionModel"
          WHERE ca.campaign_id = ${c.id}::uuid AND ce.type::text = ${type} AND ce.is_verified = true
            AND ce.occurred_at >= ${from} AND ce.occurred_at <= ${to}`;
        const [ld, vis, rg, ac] = await Promise.all([
          this.prisma.lead.count({
            where: { sourceCampaignId: c.id, dataSource: { not: 'SIMULATED' }, createdAt: inRange },
          }),
          distinctClient(CLIENT_TYPES, cf),
          attr('REGISTRATION'),
          attr('ACTIVATION'),
        ]);
        const spendN = Number(c.spend);
        const registrations = Number(rg[0].n);
        const activations = Number(ac[0].n);
        return {
          id: c.id,
          name: c.name,
          lane: c.lane,
          status: c.status,
          spend: spendN,
          spendSource: c.spendSource,
          leads: ld,
          visitors: vis,
          registrations,
          activations,
          costPerLead: ratio(spendN, ld),
          costPerRegistration: ratio(spendN, registrations),
          costPerActivatedUser: ratio(spendN, activations),
          conversionRate: percent(registrations, vis),
        };
      }),
    );

    // ---------- akun TikTok
    const accountRows = await this.prisma.tikTokAccount.findMany({
      where: {
        ...(q.accountId ? { id: q.accountId } : {}),
        ...(q.lane ? { lane: q.lane } : {}),
        ...(q.campaignId ? { campaignLinks: { some: { campaignId: q.campaignId } } } : {}),
      },
      select: { id: true, username: true, lane: true, followersCount: true, followersSource: true },
      orderBy: { followersCount: 'desc' },
    });
    const accounts = await Promise.all(
      accountRows.map(async (a) => {
        const af = Prisma.sql`AND ce.tiktok_account_id = ${a.id}::uuid`;
        const [ld, sent, rp, vis, rg] = await Promise.all([
          this.prisma.lead.count({
            where: { sourceAccountId: a.id, dataSource: { not: 'SIMULATED' }, createdAt: inRange },
          }),
          this.prisma.outreachTask.count({
            where: { tiktokAccountId: a.id, sentConfirmedAt: inRange },
          }),
          this.prisma.outreachTask.count({ where: { tiktokAccountId: a.id, repliedAt: inRange } }),
          distinctClient(CLIENT_TYPES, af),
          this.prisma.$queryRaw<[{ n: bigint }]>`
            SELECT count(DISTINCT ce.external_user_id) AS n FROM conversion_events ce
            WHERE ce.type = 'REGISTRATION' AND ce.is_verified = true AND ce.tiktok_account_id = ${a.id}::uuid
              AND ce.occurred_at >= ${from} AND ce.occurred_at <= ${to}`,
        ]);
        return {
          id: a.id,
          username: a.username,
          lane: a.lane,
          followers: a.followersCount,
          followersSource: a.followersSource,
          leads: ld,
          messagesSent: sent,
          replies: rp,
          replyRate: percent(rp, sent),
          visitors: vis,
          registrations: Number(rg[0].n),
        };
      }),
    );

    // ---------- produktivitas operator
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        role: { code: { in: ['SUPER_ADMIN', 'ADMIN', 'MARKETING_OPERATOR'] } },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const operators = (
      await Promise.all(
        users.map(async (u) => {
          const base = { operatorId: u.id, ...taskWhere() };
          const [assigned, created, sent, rp, done, regOut] = await Promise.all([
            this.prisma.lead.count({
              where: { operatorId: u.id, deletedAt: null, ...leadWhere() },
            }),
            this.prisma.outreachTask.count({ where: { ...base, createdAt: inRange } }),
            this.prisma.outreachTask.count({ where: { ...base, sentConfirmedAt: inRange } }),
            this.prisma.outreachTask.count({ where: { ...base, repliedAt: inRange } }),
            this.prisma.outreachTask.count({ where: { ...base, completedAt: inRange } }),
            this.prisma.outreachTask.count({
              where: { ...base, completedAt: inRange, outcome: 'REGISTERED' },
            }),
          ]);
          return {
            id: u.id,
            name: u.name,
            leadsAssigned: assigned,
            tasksCreated: created,
            messagesSent: sent,
            replies: rp,
            tasksCompleted: done,
            registeredOutcomes: regOut,
          };
        }),
      )
    ).filter((o) => o.leadsAssigned + o.tasksCreated + o.messagesSent > 0);

    return {
      range: { days: q.days, from: from.toISOString(), to: to.toISOString(), model },
      kpis: {
        leads,
        contacted,
        replies,
        visitors,
        storeClicks,
        installsVerified: installs,
        registrationsVerified: regs,
        registrationsOperator: regsOperator,
        activationsVerified: acts,
        conversionRate: percent(regs, visitors),
        spend: spend.spend,
        spendSources: spend.sources,
        costPerLead: ratio(spend.spend, leads),
        costPerRegistration: ratio(spend.spend, regs),
        costPerActivatedUser: ratio(spend.spend, acts),
        aiCostUsd: Number(ai._sum.costUsd ?? 0),
      },
      funnel,
      lanes,
      leadsGrowth,
      leadStatus: statusGroups
        .map((g) => ({ status: g.status, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
      campaigns,
      accounts,
      operators,
    };
  }
}
