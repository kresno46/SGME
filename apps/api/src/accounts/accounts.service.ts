import { ownerScope } from '../common/data-scope';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AccountIntegration, Prisma, TikTokAccount } from '@smge/database';
import type {
  CreateTikTokAccountInput,
  IntegrationStatus,
  ListTikTokAccountsQuery,
  UpdateTikTokAccountInput,
} from '@smge/shared';
import type { AccountIntegrationDto, TikTokAccountDto } from '@smge/types';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { paginate, RequestMeta } from '../common/utils/request';
import { PrismaService } from '../prisma/prisma.service';
import { USER_REF_SELECT, toRef } from '../common/utils/refs';

/** Kolom integrasi yang aman dikirim ke frontend — token terenkripsi TIDAK pernah dipilih. */
const SAFE_INTEGRATION_SELECT = {
  id: true,
  provider: true,
  status: true,
  isSimulation: true,
  scopes: true,
  tokenExpiresAt: true,
  lastSyncAt: true,
  lastError: true,
} satisfies Prisma.AccountIntegrationSelect;

const ACCOUNT_INCLUDE = {
  owner: { select: USER_REF_SELECT },
  integrations: { select: SAFE_INTEGRATION_SELECT },
  _count: { select: { campaignLinks: true, sourcedLeads: true, outreachTasks: true } },
} satisfies Prisma.TikTokAccountInclude;

type AccountRow = Prisma.TikTokAccountGetPayload<{ include: typeof ACCOUNT_INCLUDE }>;

const STATUS_PRIORITY: IntegrationStatus[] = [
  'CONNECTED',
  'TOKEN_EXPIRED',
  'ERROR',
  'REVOKED',
  'NOT_CONNECTED',
];

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListTikTokAccountsQuery) {
    const where: Prisma.TikTokAccountWhereInput = {
      ...ownerScope(),
      ...(q.lane ? { lane: q.lane } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { username: { contains: q.search.replace(/^@/, ''), mode: 'insensitive' } },
              { displayName: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tikTokAccount.findMany({
        where,
        include: ACCOUNT_INCLUDE,
        orderBy: [{ [q.sortBy]: q.sortDir }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.tikTokAccount.count({ where }),
    ]);
    return paginate(rows.map(toAccountDto), total, q.page, q.pageSize);
  }

  async get(id: string) {
    const row = await this.prisma.tikTokAccount.findFirst({
      where: { id, ...ownerScope() },
      include: ACCOUNT_INCLUDE,
    });
    if (!row) throw new NotFoundException('Akun TikTok tidak ditemukan');
    return toAccountDto(row);
  }

  async create(
    actor: RequestUser,
    input: CreateTikTokAccountInput & { username: string },
    meta: RequestMeta,
  ) {
    await this.assertUsernameFree(input.username, actor.id);
    const row = await this.prisma.tikTokAccount.create({
      data: {
        ...(input as Prisma.TikTokAccountUncheckedCreateInput),
        followersSource: 'MANUAL',
        ownerId: actor.id,
      },
      include: ACCOUNT_INCLUDE,
    });
    await this.audit.log({
      action: 'tiktok_account.created',
      actor,
      entityType: 'tiktok_account',
      entityId: row.id,
      metadata: { username: row.username, lane: row.lane },
      meta,
    });
    return toAccountDto(row);
  }

  async update(actor: RequestUser, id: string, input: UpdateTikTokAccountInput, meta: RequestMeta) {
    const existing = await this.prisma.tikTokAccount.findFirst({ where: { id, ...ownerScope() } });
    if (!existing) throw new NotFoundException('Akun TikTok tidak ditemukan');
    if (input.username && input.username !== existing.username) {
      await this.assertUsernameFree(input.username, existing.ownerId);
    }
    const data = input as Prisma.TikTokAccountUpdateInput;
    // Angka followers yang diubah operator selalu ditandai sebagai input manual.
    if (input.followersCount !== undefined && input.followersCount !== existing.followersCount) {
      data.followersSource = 'MANUAL';
    }
    const row = await this.prisma.tikTokAccount.update({
      where: { id },
      data,
      include: ACCOUNT_INCLUDE,
    });
    await this.audit.log({
      action: 'tiktok_account.updated',
      actor,
      entityType: 'tiktok_account',
      entityId: id,
      metadata: { changes: diff(existing, input) },
      meta,
    });
    return toAccountDto(row);
  }

  async remove(actor: RequestUser, id: string, meta: RequestMeta) {
    const row = await this.prisma.tikTokAccount.findFirst({
      where: { id, ...ownerScope() },
      include: { _count: { select: { outreachTasks: true, conversations: true } } },
    });
    if (!row) throw new NotFoundException('Akun TikTok tidak ditemukan');
    if (row._count.outreachTasks > 0 || row._count.conversations > 0) {
      throw new ConflictException(
        'Akun ini memiliki riwayat percakapan atau tugas outbound. Ubah status menjadi "Diarsipkan" agar riwayat tetap tersimpan.',
      );
    }
    await this.prisma.tikTokAccount.delete({ where: { id } });
    await this.audit.log({
      action: 'tiktok_account.deleted',
      actor,
      entityType: 'tiktok_account',
      entityId: id,
      metadata: { username: row.username, lane: row.lane },
      meta,
    });
  }

  private async assertUsernameFree(username: string, ownerId: string | null) {
    const exists = await this.prisma.tikTokAccount.findFirst({ where: { username, ownerId } });
    if (exists) throw new ConflictException(`Akun @${username} sudah terdaftar`);
  }
}

function diff(before: TikTokAccount, changes: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(changes)) {
    const prev = (before as unknown as Record<string, unknown>)[k];
    if (prev !== v) out[k] = { from: prev, to: v };
  }
  return out;
}

export function summarizeIntegrationStatus(
  integrations: Pick<AccountIntegration, 'status'>[],
): IntegrationStatus {
  for (const s of STATUS_PRIORITY) {
    if (integrations.some((i) => i.status === s)) return s;
  }
  return 'NOT_CONNECTED';
}

function toAccountDto(a: AccountRow): TikTokAccountDto {
  const integrations: AccountIntegrationDto[] = a.integrations.map((i) => ({
    id: i.id,
    provider: i.provider,
    status: i.status,
    isSimulation: i.isSimulation,
    scopes: i.scopes,
    tokenExpiresAt: i.tokenExpiresAt?.toISOString() ?? null,
    lastSyncAt: i.lastSyncAt?.toISOString() ?? null,
    lastError: i.lastError,
  }));
  return {
    id: a.id,
    owner: toRef(a.owner),
    username: a.username,
    displayName: a.displayName,
    profileUrl: a.profileUrl,
    avatarUrl: a.avatarUrl,
    accountType: a.accountType,
    isVerified: a.isVerified,
    followersCount: a.followersCount,
    followersSource: a.followersSource,
    lane: a.lane,
    status: a.status,
    notes: a.notes,
    lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    integrationStatus: summarizeIntegrationStatus(a.integrations),
    integrations,
    stats: {
      campaigns: a._count.campaignLinks,
      leads: a._count.sourcedLeads,
      outreachTasks: a._count.outreachTasks,
    },
  };
}
