import { Injectable } from '@nestjs/common';
import type { Prisma } from '@smge/database';
import type { DashboardOutreachOverview } from '@smge/types';
import { ownerScope, scopeUser } from '../common/data-scope';
import { USER_REF_SELECT, startOfToday } from '../common/utils/refs';
import { PrismaService } from '../prisma/prisma.service';

const DELIVERY_SELECT = {
  id: true,
  taskId: true,
  accountId: true,
  username: true,
  status: true,
  detail: true,
  updatedAt: true,
  task: { select: { tiktokAccount: { select: { username: true } } } },
} satisfies Prisma.BrowserDmDeliverySelect;

@Injectable()
export class OutreachDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<DashboardOutreachOverview> {
    const scope = ownerScope();
    const actor = scopeUser();
    const ownerId = actor && actor.role !== 'SUPER_ADMIN' ? actor.id : null;
    const accountWhere = { ...scope, lane: 'OUTBOUND' as const };
    const followerWhere = {
      ...scope,
      deletedAt: null,
      dataSource: { not: 'SIMULATED' as const },
      tags: { has: 'tiktok-followers' },
    };
    const deliveryWhere = {
      task: { ...scope, channel: 'TIKTOK_DM' as const, tiktokAccount: accountWhere },
    };
    const today = startOfToday();
    const tomorrow = startOfToday(new Date(Date.now() + 86400000));
    const since7 = new Date(Date.now() - 7 * 86400000);
    const [activeAccounts, followersCollected, groups, accounts, sent, recent, issues] =
      await Promise.all([
        this.prisma.tikTokAccount.count({ where: { ...accountWhere, status: 'ACTIVE' } }),
        this.prisma.lead.count({ where: followerWhere }),
        this.prisma.browserDmDelivery.groupBy({
          by: ['status'],
          where: deliveryWhere,
          _count: { _all: true },
        }),
        this.prisma.tikTokAccount.findMany({
          where: accountWhere,
          take: 12,
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            username: true,
            displayName: true,
            status: true,
            owner: { select: USER_REF_SELECT },
            _count: { select: { sourcedLeads: { where: followerWhere } } },
          },
        }),
        this.prisma.$queryRaw<
          Array<{ accountId: string; sentToday: number; sentLast7Days: number }>
        >`
        SELECT t.tiktok_account_id AS "accountId",
          COUNT(*) FILTER (WHERE a.created_at >= (${today}::timestamptz AT TIME ZONE 'UTC'))::int AS "sentToday",
          COUNT(*)::int AS "sentLast7Days"
        FROM lead_activities a
        JOIN outreach_tasks t ON a.metadata->>'taskId' = t.id::text
        JOIN tiktok_accounts acc ON acc.id = t.tiktok_account_id
        JOIN leads l ON l.id = t.lead_id
        WHERE a.type = 'MESSAGE_SENT' AND t.channel = 'TIKTOK_DM' AND acc.lane = 'OUTBOUND'
          AND l.data_source <> 'SIMULATED'
          AND (${ownerId}::uuid IS NULL OR (t.owner_id = ${ownerId}::uuid AND acc.owner_id = ${ownerId}::uuid))
          AND a.created_at >= (${since7}::timestamptz AT TIME ZONE 'UTC') AND a.created_at < (${tomorrow}::timestamptz AT TIME ZONE 'UTC')
        GROUP BY t.tiktok_account_id
      `,
        this.prisma.browserDmDelivery.findMany({
          where: deliveryWhere,
          select: DELIVERY_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: 8,
        }),
        this.prisma.browserDmDelivery.findMany({
          where: { ...deliveryWhere, status: { in: ['FAILED', 'UNVERIFIED'] } },
          select: DELIVERY_SELECT,
          orderBy: { updatedAt: 'desc' },
          take: 5,
        }),
      ]);
    const deliveries: DashboardOutreachOverview['deliveries'] = {
      QUEUED: 0,
      PROCESSING: 0,
      SENT: 0,
      FAILED: 0,
      UNVERIFIED: 0,
      CANCELLED: 0,
    };
    for (const group of groups) deliveries[group.status] = group._count._all;
    const mapDelivery = (row: (typeof recent)[number]) => ({
      id: row.id,
      taskId: row.taskId,
      accountId: row.accountId,
      accountUsername: row.task.tiktokAccount.username,
      username: row.username,
      status: row.status,
      detail: row.detail,
      updatedAt: row.updatedAt.toISOString(),
    });
    return {
      activeAccounts,
      followersCollected,
      deliveries,
      sentToday: sent.reduce((sum, row) => sum + row.sentToday, 0),
      sentLast7Days: sent.reduce((sum, row) => sum + row.sentLast7Days, 0),
      accounts: accounts.map(({ _count, ...account }) => ({
        ...account,
        followersCollected: _count.sourcedLeads,
        sentToday: sent.find((row) => row.accountId === account.id)?.sentToday ?? 0,
      })),
      recent: recent.map(mapDelivery),
      issues: issues.map(mapDelivery),
    };
  }
}
