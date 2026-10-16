import { Injectable } from '@nestjs/common';
import type { LeadActivityType, Prisma } from '@smge/database';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

/** Mencatat riwayat interaksi prospek (timeline di halaman detail prospek). */
@Injectable()
export class LeadActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    leadId: string,
    type: LeadActivityType,
    summary: string,
    actorId: string | null,
    metadata?: Record<string, unknown>,
    tx: Tx = this.prisma,
  ) {
    return tx.leadActivity.create({
      data: {
        leadId,
        type,
        summary,
        actorId,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
