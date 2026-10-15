import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@smge/database';
import type { ListAuditLogsQuery } from '@smge/shared';
import type { AuditLogDto } from '@smge/types';
import { paginate, RequestMeta } from '../common/utils/request';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  actor?: { id: string; email: string } | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

const SENSITIVE_KEYS = /password|token|secret|code/i;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Mencatat aktivitas. Kegagalan pencatatan tidak boleh menggagalkan aksi utama. */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          actorId: entry.actor?.id ?? null,
          actorEmail: entry.actor?.email ?? null,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata ? (redact(entry.metadata) as Prisma.InputJsonValue) : undefined,
          ipAddress: entry.meta?.ipAddress ?? null,
          userAgent: entry.meta?.userAgent ?? null,
        },
      });
    } catch (e) {
      this.logger.error(`Gagal mencatat audit "${entry.action}": ${(e as Error).message}`);
    }
  }

  async list(q: ListAuditLogsQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.search
        ? {
            OR: [
              { actorEmail: { contains: q.search, mode: 'insensitive' } },
              { action: { contains: q.search, mode: 'insensitive' } },
              { entityId: { contains: q.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const items: AuditLogDto[] = rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorEmail: r.actorEmail,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: r.metadata,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
    }));
    return paginate(items, total, q.page, q.pageSize);
  }
}

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.test(k)
        ? '[DISENSOR]'
        : v && typeof v === 'object' && !Array.isArray(v)
          ? redact(v as Record<string, unknown>)
          : v,
    ]),
  );
}
