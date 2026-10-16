import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@smge/database';
import type { CreateCampaignData, ListCampaignsQuery, UpdateCampaignData } from '@smge/shared';
import type { CampaignDto } from '@smge/types';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { paginate, RequestMeta } from '../common/utils/request';
import {
  ACCOUNT_REF_SELECT,
  USER_REF_SELECT,
  iso,
  toAccountRef,
  toRef,
} from '../common/utils/refs';
import { PrismaService } from '../prisma/prisma.service';

const INCLUDE = {
  operator: { select: USER_REF_SELECT },
  accounts: { include: { tiktokAccount: { select: ACCOUNT_REF_SELECT } } },
  _count: { select: { leads: true, outreachTasks: true } },
} satisfies Prisma.CampaignInclude;

type Row = Prisma.CampaignGetPayload<{ include: typeof INCLUDE }>;

/** "Promo Akhir Tahun!" -> "promo-akhir-tahun-x7k2pq" */
export function generateTrackingCode(name: string) {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${slug || 'campaign'}-${randomBytes(4).toString('hex').slice(0, 6)}`;
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async toDto(rows: Row[]): Promise<CampaignDto[]> {
    const ids = rows.map((r) => r.id);
    const groups = ids.length
      ? await this.prisma.lead.groupBy({
          by: ['sourceCampaignId', 'status'],
          where: {
            sourceCampaignId: { in: ids },
            deletedAt: null,
            dataSource: { not: 'SIMULATED' },
          },
          _count: { _all: true },
        })
      : [];
    return rows.map((c) => {
      const mine = groups.filter((g) => g.sourceCampaignId === c.id);
      const sum = (statuses: string[]) =>
        mine.filter((g) => statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
      const leads = mine.reduce((n, g) => n + g._count._all, 0);
      const spend = Number(c.spend);
      return {
        id: c.id,
        name: c.name,
        lane: c.lane,
        type: c.type,
        status: c.status,
        target: c.target,
        description: c.description,
        startDate: iso(c.startDate),
        endDate: iso(c.endDate),
        budget: c.budget?.toString() ?? null,
        spend: c.spend.toString(),
        spendSource: c.spendSource,
        trackingCode: c.trackingCode,
        operator: toRef(c.operator),
        accounts: c.accounts.map((a) => toAccountRef(a.tiktokAccount)),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        stats: {
          leads,
          interestedLeads: sum(['INTERESTED', 'QUALIFIED']),
          registeredLeads: sum(['REGISTERED', 'ACTIVE']),
          outreachTasks: c._count.outreachTasks,
          costPerLead: leads > 0 && spend > 0 ? Math.round(spend / leads) : null,
        },
      };
    });
  }

  async list(q: ListCampaignsQuery) {
    const where: Prisma.CampaignWhereInput = {
      ...(q.lane ? { lane: q.lane } : {}),
      ...(q.status ? { status: q.status } : { status: { not: 'ARCHIVED' } }),
      ...(q.type ? { type: q.type } : {}),
      ...(q.accountId ? { accounts: { some: { tiktokAccountId: q.accountId } } } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { trackingCode: { contains: q.search.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        include: INCLUDE,
        orderBy: [
          { [q.sortBy]: q.sortBy === 'startDate' ? { sort: q.sortDir, nulls: 'last' } : q.sortDir },
          { id: 'asc' },
        ],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.campaign.count({ where }),
    ]);
    return paginate(await this.toDto(rows), total, q.page, q.pageSize);
  }

  async get(id: string) {
    const row = await this.prisma.campaign.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundException('Campaign tidak ditemukan');
    return (await this.toDto([row]))[0];
  }

  /** Akun harus ada, dan jalurnya sama dengan jalur campaign. */
  private async validateAccounts(accountIds: string[], lane: 'OFFICIAL' | 'OUTBOUND') {
    if (!accountIds.length) return;
    const accounts = await this.prisma.tikTokAccount.findMany({
      where: { id: { in: accountIds } },
    });
    if (accounts.length !== new Set(accountIds).size)
      throw new BadRequestException('Ada akun TikTok yang tidak ditemukan');
    const wrong = accounts.filter((a) => a.lane !== lane);
    if (wrong.length) {
      throw new BadRequestException({
        statusCode: 400,
        message: `Akun ${wrong.map((a) => '@' + a.username).join(', ')} bukan akun jalur yang sama dengan campaign`,
        errors: { accountIds: ['Pilih akun dengan jalur yang sama'] },
      });
    }
  }

  private validateStatus(status: string | undefined, startDate: Date | null | undefined) {
    if ((status === 'SCHEDULED' || status === 'ACTIVE') && !startDate) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Campaign terjadwal/aktif harus memiliki tanggal mulai',
        errors: { startDate: ['Tanggal mulai wajib untuk status ini'] },
      });
    }
  }

  async create(actor: RequestUser, input: CreateCampaignData, meta: RequestMeta) {
    await this.validateAccounts(input.accountIds, input.lane);
    this.validateStatus(input.status, input.startDate);
    const { accountIds, ...data } = input;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const c = await this.prisma.campaign.create({
          data: {
            ...data,
            budget: data.budget ?? null,
            spend: data.spend ?? 0,
            trackingCode: generateTrackingCode(input.name),
            accounts: { create: accountIds.map((tiktokAccountId) => ({ tiktokAccountId })) },
          },
        });
        await this.audit.log({
          action: 'campaign.created',
          actor,
          entityType: 'campaign',
          entityId: c.id,
          meta,
        });
        return this.get(c.id);
      } catch (e) {
        // Tabrakan tracking code (sangat jarang) → coba lagi dengan kode baru
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 2)
          continue;
        throw e;
      }
    }
    throw new ConflictException('Gagal membuat kode tracking unik');
  }

  async update(actor: RequestUser, id: string, input: UpdateCampaignData, meta: RequestMeta) {
    const existing = await this.prisma.campaign.findUnique({
      where: { id },
      include: { accounts: true },
    });
    if (!existing) throw new NotFoundException('Campaign tidak ditemukan');
    const lane = input.lane ?? existing.lane;
    const accountIds = input.accountIds ?? existing.accounts.map((a) => a.tiktokAccountId);
    await this.validateAccounts(accountIds, lane);
    this.validateStatus(
      input.status ?? existing.status,
      input.startDate !== undefined ? input.startDate : existing.startDate,
    );
    const start = input.startDate !== undefined ? input.startDate : existing.startDate;
    const end = input.endDate !== undefined ? input.endDate : existing.endDate;
    if (start && end && end < start) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Tanggal selesai harus setelah tanggal mulai',
        errors: { endDate: ['Tanggal selesai harus setelah tanggal mulai'] },
      });
    }

    const { accountIds: _ids, ...data } = input;
    await this.prisma.$transaction(async (tx) => {
      await tx.campaign.update({
        where: { id },
        data: { ...data, ...(input.spend !== undefined ? { spendSource: 'MANUAL' } : {}) },
      });
      if (input.accountIds) {
        await tx.campaignAccount.deleteMany({ where: { campaignId: id } });
        await tx.campaignAccount.createMany({
          data: input.accountIds.map((tiktokAccountId) => ({ campaignId: id, tiktokAccountId })),
        });
      }
    });
    await this.audit.log({
      action: 'campaign.updated',
      actor,
      entityType: 'campaign',
      entityId: id,
      metadata: { fields: Object.keys(input), previousStatus: existing.status },
      meta,
    });
    return this.get(id);
  }

  async remove(actor: RequestUser, id: string, meta: RequestMeta) {
    const c = await this.prisma.campaign.findUnique({
      where: { id },
      include: { _count: { select: { leads: true, outreachTasks: true, conversionEvents: true } } },
    });
    if (!c) throw new NotFoundException('Campaign tidak ditemukan');
    if (c._count.leads || c._count.outreachTasks || c._count.conversionEvents) {
      throw new ConflictException(
        'Campaign sudah memiliki prospek atau aktivitas. Ubah status menjadi "Diarsipkan".',
      );
    }
    await this.prisma.campaign.delete({ where: { id } });
    await this.audit.log({
      action: 'campaign.deleted',
      actor,
      entityType: 'campaign',
      entityId: id,
      metadata: { name: c.name },
      meta,
    });
  }
}
