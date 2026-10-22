import { ownerScope, scopeUser } from '../common/data-scope';
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import {
  analyticsQuerySchema,
  DataSource,
  MARKETING_LANES,
  PERMISSIONS,
  type AnalyticsQuery,
} from '@smge/shared';
import type { DashboardOverview, MetricValue } from '@smge/types';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsReportService } from './analytics-report.service';

const NOT_SIMULATED = { not: 'SIMULATED' as const };

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<DashboardOverview> {
    const p = this.prisma;
    const scope = ownerScope();
    const scoped = !!scopeUser() && scopeUser()!.role !== 'SUPER_ADMIN';
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
      verifiedRegs,
      verifiedActs,
      operatorRegs,
    ] = await Promise.all([
      p.tikTokAccount.count({ where: scope }),
      p.tikTokAccount.count({ where: { ...scope, status: 'ACTIVE' } }),
      p.tikTokAccount.groupBy({
        where: scope,
        by: ['followersSource'],
        _sum: { followersCount: true },
      }),
      p.tikTokAccount.groupBy({
        where: scope,
        by: ['lane', 'followersSource'],
        _count: { _all: true },
        _sum: { followersCount: true },
      }),
      p.tikTokAccount.findMany({
        where: scope,
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
      scoped ? Promise.resolve(0) : p.campaign.count({ where: { status: 'ACTIVE' } }),
      p.lead.count({ where: { ...scope, deletedAt: null, dataSource: NOT_SIMULATED } }),
      p.lead.count({
        where: {
          ...scope,
          deletedAt: null,
          dataSource: NOT_SIMULATED,
          status: { in: ['INTERESTED', 'QUALIFIED'] },
        },
      }),
      scoped ? Promise.resolve(0) : p.conversation.count({ where: { dataSource: NOT_SIMULATED } }),
      p.outreachTask.count({ where: { ...scope, status: { notIn: ['COMPLETED', 'CANCELLED'] } } }),
      scoped ? Promise.resolve(1) : p.user.count(),
      scoped ? Promise.resolve(1) : p.user.count({ where: { status: 'ACTIVE' } }),
      scoped
        ? Promise.resolve([{ n: 0n }])
        : p.$queryRaw<
            [{ n: bigint }]
          >`SELECT count(DISTINCT external_user_id) AS n FROM conversion_events WHERE type = 'REGISTRATION' AND is_verified = true AND data_source <> 'SIMULATED'`,
      p.$queryRaw<
        [{ n: bigint }]
      >`SELECT count(DISTINCT external_user_id) AS n FROM conversion_events WHERE type = 'ACTIVATION' AND is_verified = true AND data_source <> 'SIMULATED'`,
      p.lead.count({
        where: {
          registeredAt: { not: null },
          registrationVerifiedAt: null,
          dataSource: NOT_SIMULATED,
        },
      }),
    ]);

    const followersBySource: Record<DataSource, number> = { ACTUAL: 0, MANUAL: 0, SIMULATED: 0 };
    for (const g of followerGroups)
      followersBySource[g.followersSource] = g._sum.followersCount ?? 0;

    const actual = (value: number): MetricValue => ({ value, source: 'ACTUAL' });

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
        // Hanya dari Conversion API backend Solid Mini (terverifikasi)
        registrations: actual(Number(verifiedRegs[0].n)),
        activeUsers: actual(Number(verifiedActs[0].n)),
        registrationsOperator: { value: operatorRegs, source: 'MANUAL' },
      },
      users: { total: usersTotal, active: usersActive },
    };
  }
}

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly reports: AnalyticsReportService,
  ) {}

  @Get('report')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  report(@Query(new ZodValidationPipe(analyticsQuerySchema)) q: AnalyticsQuery) {
    return this.reports.report(q);
  }

  @Get('overview')
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  overview() {
    return this.analytics.overview();
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsReportService],
})
export class AnalyticsModule {}
