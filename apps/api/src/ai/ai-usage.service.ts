import { Injectable } from '@nestjs/common';
import type { Prisma } from '@smge/database';
import type { AiInteractionDto, AiUsageDto } from '@smge/types';
import { paginate } from '../common/utils/request';
import { BUSINESS_TIMEZONE, USER_REF_SELECT, startOfToday, toRef } from '../common/utils/refs';
import { PrismaService } from '../prisma/prisma.service';

/** Monitoring penggunaan token & biaya AI. Interaksi simulasi dihitung terpisah dan tidak menambah biaya. */
@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async usage(days: number): Promise<AiUsageDto> {
    const since = new Date(startOfToday().getTime() - (days - 1) * 86_400_000);
    const real: Prisma.AiInteractionWhereInput = { createdAt: { gte: since }, isSimulation: false };

    const [totals, failed, blocked, simulated, byType, byModel, byDay] = await Promise.all([
      this.prisma.aiInteraction.aggregate({
        where: real,
        _count: { _all: true },
        _sum: { promptTokens: true, completionTokens: true, costUsd: true },
      }),
      this.prisma.aiInteraction.count({ where: { ...real, status: 'FAILED' } }),
      this.prisma.aiInteraction.count({ where: { ...real, status: 'BLOCKED' } }),
      this.prisma.aiInteraction.count({ where: { createdAt: { gte: since }, isSimulation: true } }),
      this.prisma.aiInteraction.groupBy({
        by: ['type'],
        where: real,
        _count: { _all: true },
        _sum: { costUsd: true },
      }),
      this.prisma.aiInteraction.groupBy({
        by: ['model'],
        where: real,
        _count: { _all: true },
        _sum: { totalTokens: true, costUsd: true },
      }),
      this.prisma.$queryRaw<
        Array<{ day: string; interactions: bigint; cost: number | null; tokens: bigint | null }>
      >`
        SELECT to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BUSINESS_TIMEZONE}, 'YYYY-MM-DD') AS day,
               count(*) AS interactions,
               sum(cost_usd)::float8 AS cost,
               sum(total_tokens) AS tokens
        FROM ai_interactions
        WHERE created_at >= ${since} AND is_simulation = false
        GROUP BY 1 ORDER BY 1`,
    ]);

    // Lengkapi hari tanpa aktivitas agar grafik kontinu
    const map = new Map(byDay.map((d) => [d.day, d]));
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE });
    const series: AiUsageDto['byDay'] = [];
    for (let i = 0; i < days; i++) {
      const date = fmt.format(new Date(since.getTime() + i * 86_400_000 + 3_600_000));
      const d = map.get(date);
      series.push({
        date,
        interactions: Number(d?.interactions ?? 0),
        costUsd: Number(d?.cost ?? 0),
        tokens: Number(d?.tokens ?? 0),
      });
    }

    return {
      days,
      totals: {
        interactions: totals._count._all,
        promptTokens: totals._sum.promptTokens ?? 0,
        completionTokens: totals._sum.completionTokens ?? 0,
        costUsd: Number(totals._sum.costUsd ?? 0),
        failed,
        blocked,
        simulated,
      },
      byType: byType
        .map((t) => ({
          type: t.type,
          interactions: t._count._all,
          costUsd: Number(t._sum.costUsd ?? 0),
        }))
        .sort((a, b) => b.interactions - a.interactions),
      byModel: byModel
        .map((m) => ({
          model: m.model,
          interactions: m._count._all,
          tokens: m._sum.totalTokens ?? 0,
          costUsd: Number(m._sum.costUsd ?? 0),
        }))
        .sort((a, b) => b.interactions - a.interactions),
      byDay: series,
    };
  }

  async list(q: { page: number; pageSize: number; type?: string; status?: string }) {
    const where: Prisma.AiInteractionWhereInput = {
      ...(q.type ? { type: q.type as Prisma.AiInteractionWhereInput['type'] } : {}),
      ...(q.status ? { status: q.status as Prisma.AiInteractionWhereInput['status'] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.aiInteraction.findMany({
        where,
        include: { user: { select: USER_REF_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.aiInteraction.count({ where }),
    ]);
    const items: Array<AiInteractionDto & { simulated: boolean }> = rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      model: r.model,
      user: toRef(r.user),
      leadId: r.leadId,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      costUsd: Number(r.costUsd),
      latencyMs: r.latencyMs,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt.toISOString(),
      simulated: r.isSimulation,
    }));
    return paginate(items, total, q.page, q.pageSize);
  }
}
