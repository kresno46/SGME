import { ownerScope } from '../common/data-scope';
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FollowerImport } from '@smge/shared';
import type { FollowerImportResultDto } from '@smge/types';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import type { RequestMeta } from '../common/utils/request';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FollowerImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async import(
    actor: RequestUser,
    input: FollowerImport,
    meta: RequestMeta,
  ): Promise<FollowerImportResultDto> {
    const account = await this.prisma.tikTokAccount.findFirst({
      where: { id: input.accountId, ...ownerScope() },
    });
    if (!account) throw new NotFoundException('Akun TikTok tidak ditemukan');
    if (account.status !== 'ACTIVE' || account.lane !== 'OUTBOUND') {
      throw new BadRequestException('Pilih akun Outbound yang aktif');
    }

    const unique = [...new Map(input.batch.followers.map((row) => [row.username, row])).values()];
    const result = await this.prisma.$transaction(async (tx) => {
      const usernames = unique.map((row) => row.username);
      const [existing, blocked] = await Promise.all([
        // Include deleted leads: importing must never restore a deleted identity.
        tx.lead.findMany({
          where: { ownerId: account.ownerId, tiktokUsernameNormalized: { in: usernames } },
          select: { tiktokUsernameNormalized: true },
        }),
        tx.doNotContactEntry.findMany({
          where: { channel: 'TIKTOK_DM', valueNormalized: { in: usernames } },
          select: { valueNormalized: true },
        }),
      ]);
      const existingNames = new Set(existing.map((row) => row.tiktokUsernameNormalized));
      const blockedNames = new Set(blocked.map((row) => row.valueNormalized));
      const counts: FollowerImportResultDto = {
        received: input.batch.followers.length,
        unique: unique.length,
        duplicateRows: input.batch.followers.length - unique.length,
        blocked: 0,
        existing: 0,
        self: 0,
        created: 0,
      };
      const rows = unique.flatMap((row) => {
        if (
          row.username === input.batch.accountUsername ||
          row.username === account.username.toLowerCase()
        ) {
          counts.self++;
          return [];
        }
        if (blockedNames.has(row.username)) {
          counts.blocked++;
          return [];
        }
        if (existingNames.has(row.username)) {
          counts.existing++;
          return [];
        }
        return [
          {
            id: randomUUID(),
            name: row.displayName || null,
            tiktokUsername: row.username,
            tiktokUsernameNormalized: row.username,
            source: 'IMPORT' as const,
            ownerId: account.ownerId ?? actor.id,
            operatorId: actor.id,
            sourceAccountId: account.id,
            tags: ['tiktok-followers', 'browser-collected'],
            notes: `Daftar followers @${input.batch.accountUsername}, dikumpulkan melalui browser pada ${input.batch.collectedAt}. Sumber dilaporkan operator; bukan hasil verifikasi API TikTok.`,
          },
        ];
      });
      if (rows.length) {
        // The unique identity index also protects concurrent uploads/retries.
        const inserted = await tx.lead.createMany({ data: rows, skipDuplicates: true });
        counts.created = inserted.count;
        counts.existing += rows.length - inserted.count;
        const saved = await tx.lead.findMany({
          where: { id: { in: rows.map((row) => row.id) } },
          select: { id: true },
        });
        if (saved.length)
          await tx.leadActivity.createMany({
            data: saved.map((lead) => ({
              leadId: lead.id,
              actorId: actor.id,
              type: 'IMPORT' as const,
              summary: `Diimpor dari daftar followers @${input.batch.accountUsername} (browser)`,
              metadata: {
                collectedAt: input.batch.collectedAt,
                sourceAccountId: account.id,
                collectedFromUsername: input.batch.accountUsername,
                senderUsername: account.username,
                collector: input.batch.format,
              },
            })),
          });
      }
      // No consent records are created: following an account is not DM consent.
      return counts;
    });
    await this.audit.log({
      action: 'lead.followers_imported',
      actor,
      entityType: 'tiktok_account',
      entityId: account.id,
      metadata: {
        ...result,
        collectedAt: input.batch.collectedAt,
        collectedFromUsername: input.batch.accountUsername,
        senderUsername: account.username,
      },
      meta,
    });
    return result;
  }
}
