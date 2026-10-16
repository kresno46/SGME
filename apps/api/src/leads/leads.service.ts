import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Prisma } from '@smge/database';
import {
  CONTACT_CHANNEL_LABELS,
  INTEREST_LEVEL_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  normalizeEmail,
  normalizePhone,
  normalizeTikTokUsername,
  type ConsentInput,
  type CreateLeadData,
  type ExportLeadsQuery,
  type ListLeadsQuery,
  type UpdateLeadData,
} from '@smge/shared';
import type { DuplicateLeadDto, LeadDetailDto, LeadDto } from '@smge/types';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { paginate, RequestMeta } from '../common/utils/request';
import {
  ACCOUNT_REF_SELECT,
  CAMPAIGN_REF_SELECT,
  USER_REF_SELECT,
  iso,
  toAccountRef,
  toRef,
} from '../common/utils/refs';
import { OutreachMapper } from '../outbound/outreach.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { DncService } from './dnc.service';
import { LeadActivityService } from './lead-activity.service';

export const LEAD_INCLUDE = {
  sourceAccount: { select: ACCOUNT_REF_SELECT },
  sourceCampaign: { select: CAMPAIGN_REF_SELECT },
  operator: { select: USER_REF_SELECT },
  consents: { where: { status: 'GRANTED' }, select: { channel: true } },
} satisfies Prisma.LeadInclude;

/** Kolom nullable — urutkan nilai kosong di akhir. */
const NULLABLE_SORT = new Set(['lastContactedAt', 'nextFollowUpAt', 'name']);

export type LeadRow = Prisma.LeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

export function toLeadDto(l: LeadRow): LeadDto {
  return {
    id: l.id,
    name: l.name,
    tiktokUsername: l.tiktokUsername,
    email: l.email,
    phone: l.phone,
    source: l.source,
    status: l.status,
    interestLevel: l.interestLevel,
    score: l.score,
    tags: l.tags,
    doNotContact: l.doNotContact,
    dataSource: l.dataSource,
    sourceAccount: l.sourceAccount ? toAccountRef(l.sourceAccount) : null,
    sourceCampaign: toRef(l.sourceCampaign),
    operator: toRef(l.operator),
    lastContactedAt: iso(l.lastContactedAt),
    nextFollowUpAt: iso(l.nextFollowUpAt),
    registeredAt: iso(l.registeredAt),
    activatedAt: iso(l.activatedAt),
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
    consentChannels: l.consents.map((c) => c.channel),
  };
}

/** Kolom identitas mentah + ternormalisasi untuk disimpan. */
export function contactColumns(d: {
  tiktokUsername?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  const out: Prisma.LeadUncheckedUpdateInput = {};
  if (d.tiktokUsername !== undefined) {
    const n = normalizeTikTokUsername(d.tiktokUsername);
    out.tiktokUsername = n;
    out.tiktokUsernameNormalized = n;
  }
  if (d.email !== undefined) {
    out.email = d.email;
    out.emailNormalized = normalizeEmail(d.email);
  }
  if (d.phone !== undefined) {
    out.phone = d.phone;
    out.phoneNormalized = normalizePhone(d.phone);
  }
  return out;
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: LeadActivityService,
    private readonly dnc: DncService,
    private readonly audit: AuditService,
  ) {}

  buildWhere(
    q: Omit<ListLeadsQuery, 'page' | 'pageSize' | 'sortBy' | 'sortDir'>,
    actor: RequestUser,
  ) {
    const now = new Date();
    const and: Prisma.LeadWhereInput[] = [{ deletedAt: null }];
    if (!q.includeDoNotContact) and.push({ doNotContact: false });
    if (q.status?.length) and.push({ status: { in: q.status } });
    if (q.interestLevel) and.push({ interestLevel: q.interestLevel });
    if (q.source) and.push({ source: q.source });
    if (q.sourceAccountId) and.push({ sourceAccountId: q.sourceAccountId });
    if (q.sourceCampaignId) and.push({ sourceCampaignId: q.sourceCampaignId });
    if (q.operatorId === 'me') and.push({ operatorId: actor.id });
    else if (q.operatorId === 'none') and.push({ operatorId: null });
    else if (q.operatorId) and.push({ operatorId: q.operatorId });
    if (q.consentChannel)
      and.push({ consents: { some: { channel: q.consentChannel, status: 'GRANTED' } } });
    if (q.tag) and.push({ tags: { has: q.tag } });
    if (q.followUp === 'due') and.push({ nextFollowUpAt: { lte: now } });
    if (q.followUp === 'scheduled') and.push({ nextFollowUpAt: { gt: now } });
    if (q.search) {
      const s = q.search;
      and.push({
        OR: [
          { name: { contains: s, mode: 'insensitive' } },
          { tiktokUsernameNormalized: { contains: s.replace(/^@/, '').toLowerCase() } },
          { emailNormalized: { contains: s.toLowerCase() } },
          ...(normalizePhone(s) ? [{ phoneNormalized: { contains: normalizePhone(s)! } }] : []),
        ],
      });
    }
    return { AND: and } satisfies Prisma.LeadWhereInput;
  }

  async list(q: ListLeadsQuery, actor: RequestUser) {
    const where = this.buildWhere(q, actor);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        include: LEAD_INCLUDE,
        orderBy: [
          {
            [q.sortBy]: NULLABLE_SORT.has(q.sortBy)
              ? { sort: q.sortDir, nulls: 'last' }
              : q.sortDir,
          },
          { id: 'asc' },
        ],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);
    return paginate(rows.map(toLeadDto), total, q.page, q.pageSize);
  }

  async get(id: string): Promise<LeadDetailDto> {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        ...LEAD_INCLUDE,
        consents: {
          include: { recordedBy: { select: USER_REF_SELECT } },
          orderBy: { updatedAt: 'desc' },
        },
        activities: {
          include: { actor: { select: USER_REF_SELECT } },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        outreachTasks: {
          include: OutreachMapper.include,
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!lead || lead.deletedAt) throw new NotFoundException('Prospek tidak ditemukan');
    const base = toLeadDto({
      ...lead,
      consents: lead.consents.filter((c) => c.status === 'GRANTED'),
    });
    return {
      ...base,
      notes: lead.notes,
      onBlocklist: await this.dnc.isBlocked(DncService.identitiesOf(lead)),
      consents: lead.consents.map((c) => ({
        id: c.id,
        channel: c.channel,
        status: c.status,
        source: c.source,
        evidence: c.evidence,
        grantedAt: iso(c.grantedAt),
        withdrawnAt: iso(c.withdrawnAt),
        recordedBy: toRef(c.recordedBy),
      })),
      activities: lead.activities.map((a) => ({
        id: a.id,
        type: a.type,
        summary: a.summary,
        metadata: a.metadata,
        actor: toRef(a.actor),
        createdAt: a.createdAt.toISOString(),
      })),
      tasks: lead.outreachTasks.map((t) => OutreachMapper.toDto(t, null)),
    };
  }

  /** Mencari prospek lain dengan identitas yang sama (deteksi duplikasi). */
  async findDuplicates(
    d: { tiktokUsername?: string | null; email?: string | null; phone?: string | null },
    excludeId?: string,
  ): Promise<DuplicateLeadDto[]> {
    const u = normalizeTikTokUsername(d.tiktokUsername);
    const e = normalizeEmail(d.email);
    const p = normalizePhone(d.phone);
    const or: Prisma.LeadWhereInput[] = [];
    if (u) or.push({ tiktokUsernameNormalized: u });
    if (e) or.push({ emailNormalized: e });
    if (p) or.push({ phoneNormalized: p });
    if (!or.length) return [];
    const rows = await this.prisma.lead.findMany({
      where: { OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: {
        id: true,
        name: true,
        tiktokUsernameNormalized: true,
        emailNormalized: true,
        phoneNormalized: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      matchedOn: [
        ...(u && r.tiktokUsernameNormalized === u ? (['tiktokUsername'] as const) : []),
        ...(e && r.emailNormalized === e ? (['email'] as const) : []),
        ...(p && r.phoneNormalized === p ? (['phone'] as const) : []),
      ],
    }));
  }

  private async assertNoDuplicates(
    d: Parameters<LeadsService['findDuplicates']>[0],
    excludeId?: string,
  ) {
    const dups = await this.findDuplicates(d, excludeId);
    if (dups.length) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Prospek dengan kontak yang sama sudah ada',
        details: { duplicates: dups },
      });
    }
  }

  async create(actor: RequestUser, input: CreateLeadData, meta: RequestMeta) {
    await this.assertNoDuplicates(input);
    const contacts = contactColumns(input);
    const blocked = await this.dnc.isBlocked(
      DncService.identitiesOf({
        tiktokUsernameNormalized: (contacts.tiktokUsernameNormalized as string | null) ?? null,
        emailNormalized: (contacts.emailNormalized as string | null) ?? null,
        phoneNormalized: (contacts.phoneNormalized as string | null) ?? null,
      }),
    );

    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          ...(contacts as Prisma.LeadUncheckedCreateInput),
          name: input.name,
          source: input.source,
          sourceAccountId: input.sourceAccountId,
          sourceCampaignId: input.sourceCampaignId,
          interestLevel: input.interestLevel,
          operatorId: input.operatorId,
          notes: input.notes,
          tags: input.tags,
          nextFollowUpAt: input.nextFollowUpAt,
        },
      });
      await this.activities.log(
        created.id,
        'CREATED',
        `Prospek ditambahkan (${LEAD_SOURCE_LABELS[input.source]})`,
        actor.id,
        undefined,
        tx,
      );
      if (blocked) {
        await this.dnc.applyToLead(
          tx,
          created.id,
          actor.id,
          'Kontak sudah ada di daftar larangan kontak',
        );
      } else {
        for (const c of input.consents) await this.upsertConsent(tx, created.id, c, actor.id);
      }
      return created;
    });

    await this.audit.log({
      action: 'lead.created',
      actor,
      entityType: 'lead',
      entityId: lead.id,
      meta,
    });
    return this.get(lead.id);
  }

  async update(actor: RequestUser, id: string, input: UpdateLeadData, meta: RequestMeta) {
    const existing = await this.prisma.lead.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new NotFoundException('Prospek tidak ditemukan');
    if (input.status === 'DO_NOT_CONTACT') {
      throw new BadRequestException(
        'Gunakan aksi "Jangan hubungi" agar alasan dan daftar larangan tercatat',
      );
    }
    if (existing.doNotContact && input.status) {
      throw new BadRequestException(
        'Prospek ada di daftar larangan kontak. Cabut larangan terlebih dahulu.',
      );
    }
    if (
      input.tiktokUsername !== undefined ||
      input.email !== undefined ||
      input.phone !== undefined
    ) {
      await this.assertNoDuplicates(
        {
          tiktokUsername:
            input.tiktokUsername !== undefined ? input.tiktokUsername : existing.tiktokUsername,
          email: input.email !== undefined ? input.email : existing.email,
          phone: input.phone !== undefined ? input.phone : existing.phone,
        },
        id,
      );
    }

    const { tiktokUsername, email, phone, ...rest } = input;
    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id },
        data: {
          ...rest,
          ...contactColumns({ tiktokUsername, email, phone }),
          ...(input.status === 'REGISTERED' && !existing.registeredAt
            ? { registeredAt: new Date() }
            : {}),
          ...(input.status === 'ACTIVE' && !existing.activatedAt
            ? { activatedAt: new Date() }
            : {}),
        },
      });
      if (input.status && input.status !== existing.status) {
        await this.activities.log(
          id,
          'STATUS_CHANGE',
          `Status: ${LEAD_STATUS_LABELS[existing.status]} → ${LEAD_STATUS_LABELS[input.status]}`,
          actor.id,
          { from: existing.status, to: input.status, source: 'MANUAL' },
          tx,
        );
      }
      if (input.operatorId !== undefined && input.operatorId !== existing.operatorId) {
        const op = input.operatorId
          ? await tx.user.findUnique({ where: { id: input.operatorId }, select: { name: true } })
          : null;
        await this.activities.log(
          id,
          'ASSIGNMENT',
          op ? `Ditugaskan ke ${op.name}` : 'Penugasan dilepas',
          actor.id,
          undefined,
          tx,
        );
      }
      if (input.interestLevel && input.interestLevel !== existing.interestLevel) {
        await this.activities.log(
          id,
          'STATUS_CHANGE',
          `Ketertarikan: ${INTEREST_LEVEL_LABELS[existing.interestLevel]} → ${INTEREST_LEVEL_LABELS[input.interestLevel]}`,
          actor.id,
          undefined,
          tx,
        );
      }
      if (
        input.nextFollowUpAt &&
        input.nextFollowUpAt.getTime() !== existing.nextFollowUpAt?.getTime()
      ) {
        await this.activities.log(
          id,
          'FOLLOW_UP_SCHEDULED',
          `Follow-up dijadwalkan ${input.nextFollowUpAt.toISOString()}`,
          actor.id,
          { at: input.nextFollowUpAt.toISOString() },
          tx,
        );
      }
    });
    await this.audit.log({
      action: 'lead.updated',
      actor,
      entityType: 'lead',
      entityId: id,
      metadata: { fields: Object.keys(input) },
      meta,
    });
    return this.get(id);
  }

  async addNote(actor: RequestUser, id: string, note: string) {
    await this.assertExists(id);
    await this.activities.log(id, 'NOTE', note, actor.id);
    return this.get(id);
  }

  async grantConsent(actor: RequestUser, id: string, input: ConsentInput, meta: RequestMeta) {
    const lead = await this.assertExists(id);
    if (lead.doNotContact) {
      throw new BadRequestException(
        'Prospek ada di daftar larangan kontak. Cabut larangan terlebih dahulu.',
      );
    }
    await this.prisma.$transaction((tx) => this.upsertConsent(tx, id, input, actor.id));
    await this.audit.log({
      action: 'lead.consent_granted',
      actor,
      entityType: 'lead',
      entityId: id,
      metadata: { channel: input.channel, source: input.source },
      meta,
    });
    return this.get(id);
  }

  async withdrawConsent(
    actor: RequestUser,
    id: string,
    channel: ConsentInput['channel'],
    reason: string | null,
    meta: RequestMeta,
  ) {
    await this.assertExists(id);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.leadConsent.updateMany({
        where: { leadId: id, channel, status: 'GRANTED' },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      });
      if (!r.count) throw new BadRequestException('Tidak ada izin aktif untuk kanal ini');
      // Tugas pada kanal ini yang belum terkirim tidak boleh dilanjutkan
      await tx.outreachTask.updateMany({
        where: {
          leadId: id,
          channel,
          status: { in: ['DRAFT', 'WAITING_REVIEW', 'APPROVED', 'FOLLOW_UP'] },
        },
        data: { status: 'CANCELLED', cancelReason: 'Izin komunikasi dicabut', followUpAt: null },
      });
      await this.activities.log(
        id,
        'CONSENT_CHANGE',
        `Izin ${CONTACT_CHANNEL_LABELS[channel]} dicabut${reason ? `: ${reason}` : ''}`,
        actor.id,
        { channel },
        tx,
      );
    });
    await this.audit.log({
      action: 'lead.consent_withdrawn',
      actor,
      entityType: 'lead',
      entityId: id,
      metadata: { channel },
      meta,
    });
    return this.get(id);
  }

  async upsertConsent(
    tx: Prisma.TransactionClient,
    leadId: string,
    c: ConsentInput,
    actorId: string | null,
  ) {
    const now = new Date();
    await tx.leadConsent.upsert({
      where: { leadId_channel: { leadId, channel: c.channel } },
      create: {
        leadId,
        channel: c.channel,
        status: 'GRANTED',
        source: c.source,
        evidence: c.evidence,
        grantedAt: now,
        recordedById: actorId,
      },
      update: {
        status: 'GRANTED',
        source: c.source,
        evidence: c.evidence,
        grantedAt: now,
        withdrawnAt: null,
        recordedById: actorId,
      },
    });
    await this.activities.log(
      leadId,
      'CONSENT_CHANGE',
      `Izin ${CONTACT_CHANNEL_LABELS[c.channel]} diberikan`,
      actorId,
      { channel: c.channel, source: c.source },
      tx,
    );
  }

  /**
   * Menghapus data pribadi prospek (hak penghapusan data). Baris tetap ada tanpa identitas
   * agar statistik agregat & atribusi campaign tidak rusak.
   */
  async anonymize(actor: RequestUser, id: string, meta: RequestMeta) {
    await this.assertExists(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id }, data: LeadsService.anonymizedData() });
      await tx.leadActivity.deleteMany({ where: { leadId: id } });
      await tx.leadConsent.deleteMany({ where: { leadId: id } });
      await tx.outreachTask.updateMany({
        where: { leadId: id },
        data: { draftMessage: null, finalMessage: null, responseSummary: null },
      });
      await tx.outreachTask.updateMany({
        where: {
          leadId: id,
          status: {
            in: ['DRAFT', 'WAITING_REVIEW', 'APPROVED', 'FOLLOW_UP', 'MANUALLY_SENT', 'REPLIED'],
          },
        },
        data: { status: 'CANCELLED', cancelReason: 'Data prospek dihapus', followUpAt: null },
      });
    });
    await this.audit.log({
      action: 'lead.anonymized',
      actor,
      entityType: 'lead',
      entityId: id,
      meta,
    });
  }

  static anonymizedData(now = new Date()): Prisma.LeadUpdateInput {
    return {
      name: null,
      tiktokUsername: null,
      tiktokUsernameNormalized: null,
      email: null,
      emailNormalized: null,
      phone: null,
      phoneNormalized: null,
      notes: null,
      tags: [],
      nextFollowUpAt: null,
      anonymizedAt: now,
      deletedAt: now,
    };
  }

  async exportRows(q: ExportLeadsQuery, actor: RequestUser, meta: RequestMeta) {
    const where = this.buildWhere(q, actor);
    const rows = await this.prisma.lead.findMany({
      where,
      include: LEAD_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50_000,
    });
    await this.audit.log({
      action: 'lead.exported',
      actor,
      entityType: 'lead',
      metadata: { count: rows.length, format: q.format, filters: { ...q, format: undefined } },
      meta,
    });
    const header = [
      'ID',
      'Nama',
      'Username TikTok',
      'Email',
      'Telepon',
      'Sumber',
      'Akun sumber',
      'Campaign sumber',
      'Status',
      'Ketertarikan',
      'Skor',
      'Izin komunikasi',
      'Jangan dihubungi',
      'Operator',
      'Tag',
      'Kontak terakhir',
      'Follow-up berikutnya',
      'Terdaftar',
      'Dibuat',
    ];
    const data = rows.map((l) => [
      l.id,
      l.name ?? '',
      l.tiktokUsername ? `@${l.tiktokUsername}` : '',
      l.email ?? '',
      l.phone ?? '',
      LEAD_SOURCE_LABELS[l.source],
      l.sourceAccount ? `@${l.sourceAccount.username}` : '',
      l.sourceCampaign?.name ?? '',
      LEAD_STATUS_LABELS[l.status],
      INTEREST_LEVEL_LABELS[l.interestLevel],
      l.score,
      l.consents.map((c) => CONTACT_CHANNEL_LABELS[c.channel]).join(', '),
      l.doNotContact ? 'Ya' : 'Tidak',
      l.operator?.name ?? '',
      l.tags.join(', '),
      iso(l.lastContactedAt) ?? '',
      iso(l.nextFollowUpAt) ?? '',
      iso(l.registeredAt) ?? '',
      l.createdAt.toISOString(),
    ]);
    return { header, data };
  }

  private async assertExists(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead || lead.deletedAt) throw new NotFoundException('Prospek tidak ditemukan');
    return lead;
  }
}
