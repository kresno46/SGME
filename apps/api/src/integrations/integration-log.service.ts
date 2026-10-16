import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@smge/database';
import type { IntegrationLogDirection, IntegrationProvider, LogLevel } from '@smge/database';
import { paginate } from '../common/utils/request';
import { PrismaService } from '../prisma/prisma.service';

const SECRET_KEYS = /token|secret|code|signature|authorization|password/i;

function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [
        k,
        SECRET_KEYS.test(k) ? '[DISENSOR]' : redact(val),
      ]),
    );
  }
  return v;
}

export interface IntegrationLogEntry {
  integrationId?: string | null;
  provider: IntegrationProvider;
  direction: IntegrationLogDirection;
  level?: LogLevel;
  operation: string;
  statusCode?: number | null;
  success: boolean;
  message?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  durationMs?: number | null;
  isSimulation?: boolean;
}

/** Log integrasi (append-only). Payload selalu disensor dari token/secret. */
@Injectable()
export class IntegrationLogService {
  private readonly logger = new Logger(IntegrationLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(e: IntegrationLogEntry): Promise<void> {
    try {
      await this.prisma.integrationLog.create({ data: this.toData(e) });
    } catch (err) {
      this.logger.error(`Gagal menulis log integrasi ${e.operation}: ${(err as Error).message}`);
    }
  }

  /**
   * Menulis log dengan kunci idempotensi. Mengembalikan false bila kunci sudah pernah dipakai
   * (webhook duplikat / state OAuth dipakai ulang).
   */
  async claim(e: IntegrationLogEntry & { idempotencyKey: string }): Promise<boolean> {
    try {
      await this.prisma.integrationLog.create({ data: this.toData(e) });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }

  async list(q: { page: number; pageSize: number; integrationId?: string; onlyErrors?: boolean }) {
    const where: Prisma.IntegrationLogWhereInput = {
      ...(q.integrationId ? { integrationId: q.integrationId } : {}),
      ...(q.onlyErrors ? { success: false } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.integrationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.integrationLog.count({ where }),
    ]);
    return paginate(
      rows.map((r) => ({
        id: r.id,
        integrationId: r.integrationId,
        provider: r.provider,
        direction: r.direction,
        level: r.level,
        operation: r.operation,
        statusCode: r.statusCode,
        success: r.success,
        message: r.message,
        durationMs: r.durationMs,
        isSimulation: r.isSimulation,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      q.page,
      q.pageSize,
    );
  }

  private toData(e: IntegrationLogEntry): Prisma.IntegrationLogUncheckedCreateInput {
    return {
      integrationId: e.integrationId ?? null,
      provider: e.provider,
      direction: e.direction,
      level: e.level ?? (e.success ? 'INFO' : 'ERROR'),
      operation: e.operation,
      statusCode: e.statusCode ?? null,
      success: e.success,
      message: e.message ?? null,
      payload: e.payload ? (redact(e.payload) as Prisma.InputJsonValue) : undefined,
      idempotencyKey: e.idempotencyKey,
      durationMs: e.durationMs ?? null,
      isSimulation: e.isSimulation ?? false,
    };
  }
}
