import { ownerScope, assertReferences } from '../common/data-scope';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ContactChannel, Lead, OutreachTaskStatus, Prisma } from '@smge/database';
import {
  checkFollowUpAllowed,
  checkOutreachEligibility,
  computeLeadPriority,
  CONTACT_CHANNEL_LABELS,
  DEFAULT_DAILY_TASK_LIMIT_PER_ACCOUNT,
  INTEREST_LEVEL_LABELS,
  NON_CONTACTABLE_LEAD_STATUSES,
  OPEN_OUTREACH_STATUSES,
  OUTCOME_LABELS,
  OUTREACH_TASK_STATUSES,
  renderTemplate,
  createTaskSchema,
  type ListTasksQuery,
  type OutboundQueueQuery,
  type TaskAction,
} from '@smge/shared';
import type { OutboundQueueItemDto, OutboundSummaryDto } from '@smge/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { SettingsService } from '../common/settings.service';
import { paginate, RequestMeta } from '../common/utils/request';
import { startOfToday, toAccountRef } from '../common/utils/refs';
import { registrationLink, renderOutboundMessage } from './message-template';
import { DncService } from '../leads/dnc.service';
import { LeadActivityService } from '../leads/lead-activity.service';
import { LEAD_INCLUDE, toLeadDto } from '../leads/leads.service';
import { PrismaService } from '../prisma/prisma.service';
import { ACTION_RULES, ActionName, OutreachMapper, type OutreachTaskRow } from './outreach.mapper';

export const DAILY_LIMIT_SETTING = 'outbound.daily_task_limit_per_account';
/** Jumlah kandidat maksimum yang diurutkan per permintaan antrean. */
const QUEUE_SCAN_LIMIT = 500;

type TaskRow = OutreachTaskRow;

function contactWhere(channel: ContactChannel): Prisma.LeadWhereInput {
  if (channel === 'TIKTOK_DM') return { tiktokUsernameNormalized: { not: null } };
  if (channel === 'EMAIL') return { emailNormalized: { not: null } };
  return { phoneNormalized: { not: null } };
}

function hasContact(
  lead: Pick<Lead, 'tiktokUsernameNormalized' | 'emailNormalized' | 'phoneNormalized'>,
  channel: ContactChannel,
) {
  if (channel === 'TIKTOK_DM') return !!lead.tiktokUsernameNormalized;
  if (channel === 'EMAIL') return !!lead.emailNormalized;
  return !!lead.phoneNormalized;
}

@Injectable()
export class OutboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: LeadActivityService,
    private readonly dnc: DncService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ akun & ringkasan

  private async getOutboundAccount(id: string) {
    const account = await this.prisma.tikTokAccount.findFirst({ where: { id, ...ownerScope() } });
    if (!account) throw new NotFoundException('Akun TikTok tidak ditemukan');
    if (account.lane !== 'OUTBOUND') {
      throw new BadRequestException('Outbound Workstation hanya untuk akun Jalur B (Outbound)');
    }
    return account;
  }

  async templateContext(accountId: string) {
    const account = await this.getOutboundAccount(accountId);
    return { akun: account.username, link: registrationLink() };
  }

  async summary(accountId: string): Promise<OutboundSummaryDto> {
    const account = await this.getOutboundAccount(accountId);
    const since7 = new Date(Date.now() - 7 * 86_400_000);
    const today = startOfToday();
    const tomorrow = startOfToday(new Date(Date.now() + 86400000));
    const [groups, createdToday, followUpsDue, sent7, replies7, dailyLimit, dailySends] =
      await Promise.all([
        this.prisma.outreachTask.groupBy({
          by: ['status'],
          where: { tiktokAccountId: accountId },
          _count: { _all: true },
        }),
        this.prisma.outreachTask.count({
          where: { tiktokAccountId: accountId, createdAt: { gte: startOfToday() } },
        }),
        this.prisma.outreachTask.count({
          where: { tiktokAccountId: accountId, status: 'FOLLOW_UP' },
        }),
        this.prisma.outreachTask.count({
          where: { tiktokAccountId: accountId, lastSentAt: { gte: since7 } },
        }),
        this.prisma.outreachTask.count({
          where: { tiktokAccountId: accountId, repliedAt: { gte: since7 } },
        }),
        this.settings.getNumber(DAILY_LIMIT_SETTING, DEFAULT_DAILY_TASK_LIMIT_PER_ACCOUNT),
        // Count actual send events: each follow-up counts once, idempotent results do not duplicate it.
        this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM lead_activities a
        JOIN outreach_tasks t ON a.metadata->>'taskId' = t.id::text
        WHERE t.tiktok_account_id = ${accountId}::uuid
          AND t.channel = 'TIKTOK_DM'
          AND a.type = 'MESSAGE_SENT'
          AND a.created_at >= (${today}::timestamptz AT TIME ZONE 'UTC') AND a.created_at < (${tomorrow}::timestamptz AT TIME ZONE 'UTC')
      `,
      ]);
    const byStatus = Object.fromEntries(
      OUTREACH_TASK_STATUSES.map((s) => [s, 0]),
    ) as OutboundSummaryDto['byStatus'];
    for (const g of groups) byStatus[g.status] = g._count._all;
    return {
      account: toAccountRef(account),
      dailyLimit,
      createdToday,
      followUpsDue,
      sentToday: dailySends[0]?.count ?? 0,
      sentLast7Days: sent7,
      repliesLast7Days: replies7,
      replyRate: sent7 ? Math.round((replies7 / sent7) * 1000) / 10 : null,
      byStatus,
    };
  }

  // ------------------------------------------------------------ antrean

  /**
   * Prospek yang memenuhi syarat untuk dijangkau dari akun ini, diurutkan dengan skor prioritas
   * berbasis aturan. Prospek DNC, terdaftar, tanpa kontak, atau yang punya tugas terbuka dikecualikan.
   */
  async queue(q: OutboundQueueQuery) {
    const account = await this.getOutboundAccount(q.accountId);
    const where: Prisma.LeadWhereInput = {
      ownerId: account.ownerId,
      deletedAt: null,
      doNotContact: false,
      status: { notIn: NON_CONTACTABLE_LEAD_STATUSES },
      outreachTasks: { none: { status: { in: OPEN_OUTREACH_STATUSES } } },
      ...contactWhere(q.channel),
      ...(q.channel !== 'TIKTOK_DM'
        ? { consents: { some: { channel: q.channel, status: 'GRANTED' } } }
        : {}),
      ...(q.campaignId ? { sourceCampaignId: q.campaignId } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { tiktokUsernameNormalized: { contains: q.search.replace(/^@/, '').toLowerCase() } },
              { tags: { has: q.search.toLowerCase() } },
            ],
          }
        : {}),
    };
    const candidates = await this.prisma.lead.findMany({
      where,
      include: LEAD_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: QUEUE_SCAN_LIMIT,
    });
    const now = new Date();
    const ranked: OutboundQueueItemDto[] = candidates
      .map((l) => ({
        lead: toLeadDto(l),
        priority: computeLeadPriority(
          {
            status: l.status,
            interestLevel: l.interestLevel,
            source: l.source,
            score: l.score,
            hasAnyConsent: l.consents.length > 0,
            createdAt: l.createdAt,
            lastContactedAt: l.lastContactedAt,
          },
          now,
        ),
      }))
      .sort((a, b) => b.priority.score - a.priority.score);
    const page = ranked.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    return {
      ...paginate(page, ranked.length, q.page, q.pageSize),
      truncated: candidates.length === QUEUE_SCAN_LIMIT,
    };
  }

  // ------------------------------------------------------------ tugas

  async list(q: ListTasksQuery, user: RequestUser) {
    const where: Prisma.OutreachTaskWhereInput = {
      ...ownerScope(),
      ...(q.accountId ? { tiktokAccountId: q.accountId } : {}),
      ...(q.status?.length ? { status: { in: q.status } } : {}),
      ...(q.operatorId === 'me'
        ? { operatorId: user.id }
        : q.operatorId
          ? { operatorId: q.operatorId }
          : {}),
      ...(q.followUpDue ? { status: 'FOLLOW_UP' } : {}),
      ...(q.leadId ? { leadId: q.leadId } : {}),
      ...(q.search
        ? {
            lead: {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                {
                  tiktokUsernameNormalized: { contains: q.search.replace(/^@/, '').toLowerCase() },
                },
              ],
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.outreachTask.findMany({
        where,
        include: OutreachMapper.include,
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.outreachTask.count({ where }),
    ]);
    return paginate(
      rows.map((t) => OutreachMapper.toDto(t, user)),
      total,
      q.page,
      q.pageSize,
    );
  }

  async get(id: string, user: RequestUser) {
    return OutreachMapper.toDto(await this.findTask(id), user);
  }

  async create(user: RequestUser, input: z.output<typeof createTaskSchema>, meta: RequestMeta) {
    const account = await this.getOutboundAccount(input.tiktokAccountId);
    if (account.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Akun sedang tidak aktif (dijeda/dibatasi). Penjangkauan dihentikan sementara.',
      );
    }
    await assertReferences(this.prisma, {
      leadId: input.leadId,
      templateId: input.templateId,
      campaignId: input.campaignId,
    });
    const channel = input.channel;
    const lead = await this.prisma.lead.findFirst({
      where: { id: input.leadId, ...ownerScope() },
      include: {
        consents: { where: { status: 'GRANTED' } },
        outreachTasks: { where: { status: { in: OPEN_OUTREACH_STATUSES } }, select: { id: true } },
      },
    });
    if (!lead) throw new NotFoundException('Prospek tidak ditemukan');
    if (account.ownerId !== lead.ownerId)
      throw new ConflictException('Akun dan prospek harus memiliki pemilik yang sama.');

    const eligibility = checkOutreachEligibility({
      status: lead.status,
      doNotContact: lead.doNotContact,
      onBlocklist: await this.dnc.isBlocked(DncService.identitiesOf(lead)),
      deleted: !!lead.deletedAt,
      hasOpenTask: lead.outreachTasks.length > 0,
      channel,
      hasContactForChannel: hasContact(lead, channel),
      hasConsentForChannel: lead.consents.some((c) => c.channel === channel),
    });
    if (!eligibility.eligible) throw new ConflictException(eligibility.reason);

    const limit = await this.settings.getNumber(
      DAILY_LIMIT_SETTING,
      DEFAULT_DAILY_TASK_LIMIT_PER_ACCOUNT,
    );
    const today = await this.prisma.outreachTask.count({
      where: { tiktokAccountId: account.id, createdAt: { gte: startOfToday() } },
    });
    if (today >= limit) {
      throw new ConflictException(
        `Batas ${limit} tugas baru per hari untuk @${account.username} sudah tercapai. Lanjutkan besok agar penjangkauan tetap personal.`,
      );
    }

    let draft = input.draftMessage ?? null;
    let templateId: string | null = input.templateId ?? null;
    const campaign = input.campaignId
      ? await this.prisma.campaign.findUnique({ where: { id: input.campaignId } })
      : null;
    if (input.campaignId && !campaign) throw new NotFoundException('Campaign tidak ditemukan');
    if (templateId) {
      const tpl = await this.prisma.messageTemplate.findUnique({ where: { id: templateId } });
      if (!tpl || !tpl.isActive)
        throw new BadRequestException('Template tidak ditemukan atau nonaktif');
      templateId = tpl.id;
      draft ??= tpl.content;
    }

    if (draft) {
      const vars = {
        nama: lead.name || lead.tiktokUsername,
        username: lead.tiktokUsername,
        akun: account.username,
        campaign: campaign?.name,
        link: registrationLink(campaign?.trackingCode),
      };
      draft =
        channel === 'TIKTOK_DM' ? renderOutboundMessage(draft, vars) : renderTemplate(draft, vars);
    }
    const priority = computeLeadPriority({
      status: lead.status,
      interestLevel: lead.interestLevel,
      source: lead.source,
      score: lead.score,
      hasAnyConsent: lead.consents.length > 0,
      createdAt: lead.createdAt,
      lastContactedAt: lead.lastContactedAt,
    });

    const task = await this.prisma.outreachTask.create({
      data: {
        leadId: lead.id,
        ownerId: lead.ownerId ?? user.id,
        tiktokAccountId: account.id,
        campaignId: campaign?.id ?? null,
        templateId,
        channel,
        draftMessage: draft,
        operatorId: user.id,
        priority: priority.score,
      },
      include: OutreachMapper.include,
    });
    await this.audit.log({
      action: 'outreach_task.created',
      actor: user,
      entityType: 'outreach_task',
      entityId: task.id,
      metadata: { leadId: lead.id, account: account.username, channel },
      meta,
    });
    return OutreachMapper.toDto(task, user);
  }

  async updateDraft(user: RequestUser, id: string, draftMessage: string, aiGenerated?: boolean) {
    const task = await this.findTask(id);
    this.assertAction(task.status, 'edit_draft', user);
    if (task.channel === 'TIKTOK_DM')
      draftMessage = renderOutboundMessage(draftMessage, {
        nama: task.lead.name || task.lead.tiktokUsername,
        username: task.lead.tiktokUsername,
        akun: task.tiktokAccount.username,
        campaign: task.campaign?.name,
        link: registrationLink(),
      });
    const updated = await this.prisma.outreachTask.update({
      where: { id },
      data: { draftMessage, ...(aiGenerated !== undefined ? { aiGenerated } : {}) },
      include: OutreachMapper.include,
    });
    return OutreachMapper.toDto(updated, user);
  }

  /** Menjalankan aksi transisi status. Seluruh perubahan prospek & riwayat dilakukan atomik. */
  async act(user: RequestUser, id: string, action: TaskAction, meta: RequestMeta) {
    const browser = await this.prisma.browserDmDelivery.findUnique({ where: { taskId: id } });
    if (browser && ['QUEUED', 'PROCESSING', 'UNVERIFIED'].includes(browser.status)) {
      throw new ConflictException(
        'Tugas sedang berada pada antrean browser. Hentikan/periksa pengiriman di panel Pengiriman browser terlebih dahulu.',
      );
    }
    const task = await this.findTask(id);
    this.assertAction(task.status, action.action, user);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${task.tiktokAccountId}))`;
      const fresh = await tx.outreachTask.findUniqueOrThrow({
        where: { id },
        include: OutreachMapper.include,
      });
      this.assertAction(fresh.status, action.action, user);
      const pendingBrowser = await tx.browserDmDelivery.findUnique({ where: { taskId: id } });
      if (pendingBrowser && ['QUEUED', 'PROCESSING', 'UNVERIFIED'].includes(pendingBrowser.status))
        throw new ConflictException(
          'Tugas masih dalam pengiriman browser; hentikan/periksa terlebih dahulu.',
        );
      Object.assign(task, fresh);
      const lead = await tx.lead.findUniqueOrThrow({
        where: { id: task.leadId },
        include: { consents: { where: { status: 'GRANTED' } } },
      });
      const hasConsent = lead.consents.some((c) => c.channel === task.channel);
      const via = `@${task.tiktokAccount.username} (${CONTACT_CHANNEL_LABELS[task.channel]})`;
      const set = (data: Prisma.OutreachTaskUncheckedUpdateInput) =>
        tx.outreachTask.update({ where: { id }, data });

      switch (action.action) {
        case 'submit': {
          if (!task.draftMessage?.trim())
            throw new BadRequestException('Tulis draft pesan sebelum diajukan');
          await set({ status: 'WAITING_REVIEW', submittedAt: now, reviewNote: null });
          break;
        }
        case 'approve': {
          if (!(action.finalMessage ?? task.draftMessage)?.trim())
            throw new BadRequestException('Isi pesan sebelum menyetujui.');
          await set({
            status: 'APPROVED',
            approvedAt: now,
            reviewerId: user.id,
            finalMessage: action.finalMessage ?? task.draftMessage,
          });
          break;
        }
        case 'reject': {
          await set({ status: 'DRAFT', reviewerId: user.id, reviewNote: action.reviewNote });
          break;
        }
        case 'reopen': {
          await set({ status: 'DRAFT', approvedAt: null, finalMessage: null });
          break;
        }
        case 'mark_sent': {
          if (task.sentCount > 0) {
            const allowed = checkFollowUpAllowed({
              channel: task.channel,
              replied: !!task.repliedAt,
              hasConsentForChannel: hasConsent,
              sentCount: task.sentCount,
            });
            if (!allowed.eligible) throw new ConflictException(allowed.reason);
          }
          // Pemeriksaan ulang saat pengiriman: larangan kontak bisa muncul setelah tugas dibuat.
          if (lead.doNotContact || lead.deletedAt) {
            throw new ConflictException(
              'Prospek kini ada di daftar larangan kontak. Pesan tidak boleh dikirim.',
            );
          }
          if (task.channel !== 'TIKTOK_DM' && !hasConsent) {
            throw new ConflictException('Izin komunikasi untuk kanal ini sudah dicabut.');
          }
          const message =
            action.message ??
            (task.status === 'FOLLOW_UP'
              ? task.draftMessage
              : (task.finalMessage ?? task.draftMessage));
          if (!message?.trim()) throw new BadRequestException('Isi pesan yang dikirim');
          await set({
            status: 'MANUALLY_SENT',
            finalMessage: message,
            sentConfirmedAt: task.sentConfirmedAt ?? now,
            lastSentAt: now,
            sentCount: { increment: 1 },
            followUpAt: null,
          });
          await tx.lead.update({
            where: { id: lead.id },
            data: {
              lastContactedAt: now,
              nextFollowUpAt: null,
              ...(lead.status === 'NEW' ? { status: 'CONTACTED' } : {}),
            },
          });
          await this.activities.log(
            lead.id,
            'MESSAGE_SENT',
            `${task.sentCount > 0 ? 'Follow-up' : 'Pesan'} dikirim manual via ${via}`,
            user.id,
            { taskId: id, message, channel: task.channel },
            tx,
          );
          break;
        }
        case 'log_reply': {
          await set({
            status: 'REPLIED',
            repliedAt: now,
            responseSummary: action.responseSummary,
            followUpAt: null,
          });
          await this.activities.log(
            lead.id,
            'MESSAGE_RECEIVED',
            `Balasan via ${via}: ${action.responseSummary}`,
            user.id,
            { taskId: id, interestLevel: action.interestLevel },
            tx,
          );
          if (action.optOut) {
            await set({ status: 'COMPLETED', completedAt: now, outcome: 'NOT_INTERESTED' });
            await this.markLeadDnc(tx, lead.id, user, 'Prospek meminta tidak dihubungi lagi');
            break;
          }
          const status =
            action.interestLevel === 'HIGH' || action.interestLevel === 'MEDIUM'
              ? 'INTERESTED'
              : ['NEW', 'CONTACTED'].includes(lead.status)
                ? 'RESPONDED'
                : lead.status;
          await tx.lead.update({
            where: { id: lead.id },
            data: { interestLevel: action.interestLevel, status },
          });
          if (action.interestLevel !== lead.interestLevel) {
            await this.activities.log(
              lead.id,
              'STATUS_CHANGE',
              `Ketertarikan: ${INTEREST_LEVEL_LABELS[lead.interestLevel]} → ${INTEREST_LEVEL_LABELS[action.interestLevel]}`,
              user.id,
              undefined,
              tx,
            );
          }
          break;
        }
        case 'schedule_follow_up': {
          const allowed = checkFollowUpAllowed({
            channel: task.channel,
            replied: !!task.repliedAt,
            hasConsentForChannel: hasConsent,
            sentCount: task.sentCount,
          });
          if (!allowed.eligible) throw new ConflictException(allowed.reason);
          if (
            lead.doNotContact ||
            lead.deletedAt ||
            NON_CONTACTABLE_LEAD_STATUSES.includes(lead.status) ||
            (await this.dnc.isBlocked(DncService.identitiesOf(lead), tx))
          )
            throw new ConflictException('Prospek tidak lagi dapat dihubungi.');
          if (task.channel === 'TIKTOK_DM' && !action.draftMessage?.trim())
            throw new BadRequestException('Tulis pesan baru untuk follow-up.');
          const followUpMessage =
            task.channel === 'TIKTOK_DM'
              ? renderOutboundMessage(action.draftMessage!, {
                  nama: lead.name || lead.tiktokUsername,
                  username: lead.tiktokUsername,
                  akun: task.tiktokAccount.username,
                  campaign: task.campaign?.name,
                  link: registrationLink(),
                })
              : action.draftMessage;
          await set({
            status: 'FOLLOW_UP',
            followUpAt: null,
            finalMessage: null,
            approvedAt: null,
            reviewerId: null,
            submittedAt: null,
            ...(followUpMessage ? { draftMessage: followUpMessage } : {}),
          });
          await tx.lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: null } });
          await this.activities.log(
            lead.id,
            'FOLLOW_UP_SCHEDULED',
            `Follow-up disiapkan via ${via}`,
            user.id,
            { taskId: id, immediate: true },
            tx,
          );
          break;
        }
        case 'complete': {
          await set({
            status: 'COMPLETED',
            completedAt: now,
            outcome: action.outcome,
            followUpAt: null,
          });
          const leadStatus =
            action.outcome === 'REGISTERED'
              ? 'REGISTERED'
              : action.outcome === 'INTERESTED'
                ? 'INTERESTED'
                : action.outcome === 'NOT_INTERESTED'
                  ? 'NOT_INTERESTED'
                  : null;
          await tx.lead.update({
            where: { id: lead.id },
            data: {
              nextFollowUpAt: null,
              ...(leadStatus ? { status: leadStatus } : {}),
              ...(leadStatus === 'REGISTERED' && !lead.registeredAt ? { registeredAt: now } : {}),
            },
          });
          await this.activities.log(
            lead.id,
            action.outcome === 'REGISTERED' ? 'CONVERSION' : 'STATUS_CHANGE',
            `Tugas outbound selesai: ${OUTCOME_LABELS[action.outcome]}${action.note ? ` — ${action.note}` : ''}`,
            user.id,
            { taskId: id, outcome: action.outcome, verified: false },
            tx,
          );
          break;
        }
        case 'cancel': {
          await set({ status: 'CANCELLED', cancelReason: action.reason, followUpAt: null });
          if (task.status === 'FOLLOW_UP')
            await tx.lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: null } });
          break;
        }
      }
    });

    await this.audit.log({
      action: `outreach_task.${action.action}`,
      actor: user,
      entityType: 'outreach_task',
      entityId: id,
      metadata: { from: task.status },
      meta,
    });
    return this.get(id, user);
  }

  private async markLeadDnc(
    tx: Prisma.TransactionClient,
    leadId: string,
    user: RequestUser,
    reason: string,
  ) {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
    for (const i of DncService.identitiesOf(lead)) {
      await tx.doNotContactEntry.upsert({
        where: {
          channel_valueNormalized: { channel: i.channel, valueNormalized: i.valueNormalized },
        },
        create: { ...i, reason, addedById: user.id },
        update: {},
      });
    }
    await this.dnc.applyToLead(tx, leadId, user.id, reason);
  }

  private assertAction(status: OutreachTaskStatus, action: ActionName, user: RequestUser) {
    const rule = ACTION_RULES[action];
    if (!user.permissions.includes(rule.permission)) {
      throw new ForbiddenException('Anda tidak memiliki akses untuk aksi ini');
    }
    if (!rule.from.includes(status)) {
      throw new ConflictException('Aksi ini tidak dapat dilakukan pada status tugas saat ini');
    }
  }

  private async findTask(id: string): Promise<TaskRow> {
    const task = await this.prisma.outreachTask.findFirst({
      where: { id, ...ownerScope() },
      include: OutreachMapper.include,
    });
    if (!task) throw new NotFoundException('Tugas tidak ditemukan');
    return task;
  }
}
