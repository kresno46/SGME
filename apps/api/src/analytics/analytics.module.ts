import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { DataSource, MARKETING_LANES, PERMISSIONS } from '@smge/shared';
import type { DashboardOverview, MetricValue } from '@smge/types';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';

const NOT_SIMULATED = { not: 'SIMULATED' as const };

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<DashboardOverview> {
    const p = this.prisma;
    const [
      accountTotal,
      accountActive,
      followerGroups,
      laneGroups,
      top,
      activeCampaigns,
      totalLeads,
      interestedLeads,
      conversations,
      outreachTasks,
      usersTotal,
      usersActive,
    ] = await Promise.all([
      p.tikTokAccount.count(),
      p.tikTokAccount.count({ where: { status: 'ACTIVE' } }),
      p.tikTokAccount.groupBy({ by: ['followersSource'], _sum: { followersCount: true } }),
      p.tikTokAccount.groupBy({
        by: ['lane', 'followersSource'],
        _count: { _all: true },
        _sum: { followersCount: true },
      }),
      p.tikTokAccount.findMany({
        orderBy: { followersCount: 'desc' },
        take: 10,
        select: {
          id: true,
          username: true,
          displayName: true,
          lane: true,
          followersCount: true,
          isVerified: true,
          followersSource: true,
        },
      }),
      p.campaign.count({ where: { status: 'ACTIVE' } }),
      p.lead.count({ where: { deletedAt: null, dataSource: NOT_SIMULATED } }),
      p.lead.count({
        where: {
          deletedAt: null,
          dataSource: NOT_SIMULATED,
          status: { in: ['INTERESTED', 'QUALIFIED'] },
        },
      }),
      p.conversation.count({ where: { dataSource: NOT_SIMULATED } }),
      p.outreachTask.count({ where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
      p.user.count(),
      p.user.count({ where: { status: 'ACTIVE' } }),
    ]);

    const followersBySource: Record<DataSource, number> = { ACTUAL: 0, MANUAL: 0, SIMULATED: 0 };
    for (const g of followerGroups)
      followersBySource[g.followersSource] = g._sum.followersCount ?? 0;

    const actual = (value: number): MetricValue => ({ value, source: 'ACTUAL' });
    // Registrasi & pengguna aktif baru tersedia setelah integrasi backend Solid Mini (Fase 5).
    const unavailable: MetricValue = { value: null, source: null };

    return {
      generatedAt: new Date().toISOString(),
      accounts: {
        total: accountTotal,
        active: accountActive,
        totalFollowers: followersBySource.ACTUAL + followersBySource.MANUAL,
        followersBySource,
        byLane: MARKETING_LANES.map((lane) => {
          const groups = laneGroups.filter((x) => x.lane === lane);
          const sum = (simulated: boolean) =>
            groups
              .filter((g) => (g.followersSource === 'SIMULATED') === simulated)
              .reduce((n, g) => n + (g._sum.followersCount ?? 0), 0);
          return {
            lane,
            accounts: groups.reduce((n, g) => n + g._count._all, 0),
            followers: sum(false),
            simulatedFollowers: sum(true),
          };
        }),
        top,
      },
      metrics: {
        activeCampaigns: actual(activeCampaigns),
        totalLeads: actual(totalLeads),
        interestedLeads: actual(interestedLeads),
        conversations: actual(conversations),
        outreachTasks: actual(outreachTasks),
        registrations: unavailable,
        activeUsers: unavailable,
      },
      users: { total: usersTotal, active: usersActive },
    };
  }
}

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  overview() {
    return this.analytics.overview();
  }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AnalyticsModule {}
