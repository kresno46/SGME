import { ownerScope, assertReferences } from '../common/data-scope';
import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@smge/database';
import {
  NON_CONTACTABLE_LEAD_STATUSES,
  OPEN_OUTREACH_STATUSES,
  PERMISSIONS,
  DEFAULT_DAILY_TASK_LIMIT_PER_ACCOUNT,
  checkOutreachEligibility,
  checkFollowUpAllowed,
  browserDmPrepareSchema,
} from '@smge/shared';
import type { z } from 'zod';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../common/settings.service';
import { startOfToday } from '../common/utils/refs';
import { DncService } from '../leads/dnc.service';
import { registrationLink, renderOutboundMessage } from './message-template';

@Injectable()
export class BrowserDmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** One reviewed batch: no intermediate drafts or partially queued recipients. */
  async prepare(actor: RequestUser, input: z.infer<typeof browserDmPrepareSchema>) {
    // Legacy submit/approve modes both queue after the sender confirms the preview.
    if (!actor.permissions.includes(PERMISSIONS.OUTREACH_WORK))
      throw new ForbiddenException('Pengiriman membutuhkan izin outreach.');
    const limit = await this.settings.getNumber(
      'outbound.daily_task_limit_per_account',
      DEFAULT_DAILY_TASK_LIMIT_PER_ACCOUNT,
    );
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ ...input, leadIds: [...input.leadIds].sort() }))
      .digest('hex');
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestId}))`;
        const previous = await tx.auditLog.findFirst({
          where: { action: 'browser_dm.prepared', entityId: input.requestId },
        });
        if (previous) {
          const data = previous.metadata as {
            fingerprint: string;
            taskIds: string[];
            queued: number;
            submitted: number;
          };
          if (previous.actorId !== actor.id || data.fingerprint !== fingerprint)
            throw new ConflictException('Identitas batch sudah dipakai untuk permintaan berbeda.');
          return { taskIds: data.taskIds, queued: data.queued, submitted: data.submitted };
        }
        await this.lock(tx, input.accountId);
        const account = await tx.tikTokAccount.findFirst({
          where: { id: input.accountId, ...ownerScope() },
        });
        if (!account || account.status !== 'ACTIVE' || account.lane !== 'OUTBOUND')
          throw new ConflictException('Pilih akun Outbound yang aktif.');
        const today = await tx.outreachTask.count({
          where: { tiktokAccountId: account.id, createdAt: { gte: startOfToday() } },
        });
        if (today + input.leadIds.length > limit)
          throw new ConflictException(
            `Kuota berubah. Sisa ${Math.max(0, limit - today)} penerima hari ini; kurangi pilihan lalu coba lagi.`,
          );
        // Stable lock order also protects batches targeting the same leads from different accounts.
        for (const id of [...input.leadIds].sort())
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outreach-lead:${id}`}))`;
        const taskIds: string[] = [];
        const now = new Date();
        for (const id of input.leadIds) {
          const lead = await tx.lead.findFirst({
            where: { id, ...ownerScope() },
            include: {
              outreachTasks: {
                where: { status: { in: OPEN_OUTREACH_STATUSES } },
                select: { id: true },
              },
            },
          });
          if (!lead) throw new NotFoundException('Penerima tidak ditemukan. Perbarui daftar.');
          if (account.ownerId !== lead.ownerId)
            throw new ConflictException('Akun dan prospek harus memiliki pemilik yang sama.');
          const identities = DncService.identitiesOf(lead);
          const blocked =
            identities.length > 0 &&
            !!(await tx.doNotContactEntry.findFirst({ where: { OR: identities } }));
          const eligibility = checkOutreachEligibility({
            status: lead.status,
            doNotContact: lead.doNotContact,
            onBlocklist: blocked,
            deleted: !!lead.deletedAt,
            hasOpenTask: lead.outreachTasks.length > 0,
            channel: 'TIKTOK_DM',
            hasContactForChannel: !!lead.tiktokUsernameNormalized,
            hasConsentForChannel: false,
          });
          if (!eligibility.eligible)
            throw new ConflictException(
              `@${lead.tiktokUsername}: ${eligibility.reason}. Perbarui pilihan penerima.`,
            );
          if (lead.tiktokUsernameNormalized === account.username.replace(/^@/, '').toLowerCase())
            throw new ConflictException('Akun pengirim tidak boleh menjadi penerima.');
          const message = renderOutboundMessage(input.message, {
            nama: lead.name || lead.tiktokUsername,
            username: lead.tiktokUsername,
            akun: account.username,
            link: registrationLink(),
          });
          if (message.trim().length < 5 || message.length > 2000)
            throw new ConflictException(
              `Pesan untuk @${lead.tiktokUsername} harus 5–2000 karakter setelah personalisasi.`,
            );
          const task = await tx.outreachTask.create({
            data: {
              leadId: id,
              ownerId: lead.ownerId ?? actor.id,
              tiktokAccountId: account.id,
              channel: 'TIKTOK_DM',
              status: 'APPROVED',
              draftMessage: message,
              finalMessage: message,
              operatorId: actor.id,
              reviewerId: actor.id,
              submittedAt: now,
              approvedAt: now,
            },
          });
          taskIds.push(task.id);
          await tx.browserDmDelivery.create({
            data: {
              taskId: task.id,
              accountId: account.id,
              requestedById: actor.id,
              username: lead.tiktokUsernameNormalized!,
              senderUsername: account.username,
              message,
            },
          });
        }
        const result = {
          taskIds,
          queued: taskIds.length,
          submitted: 0,
        };
        await tx.auditLog.create({
          data: {
            action: 'browser_dm.prepared',
            actorId: actor.id,
            actorEmail: actor.email,
            entityType: 'browser_dm_batch',
            entityId: input.requestId,
            metadata: { ...result, fingerprint, accountId: account.id, mode: input.mode },
          },
        });
        return result;
      },
      { timeout: 15000 },
    );
  }

  private async lock(tx: Prisma.TransactionClient, accountId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`;
    await tx.browserDmDelivery.updateMany({
      where: { accountId, status: 'PROCESSING', startedAt: { lt: new Date(Date.now() - 120_000) } },
      data: {
        status: 'UNVERIFIED',
        completedAt: new Date(),
        detail: 'Percobaan terputus/kedaluwarsa. Periksa TikTok; tidak dicoba ulang otomatis.',
      },
    });
  }

  private async eligible(tx: Prisma.TransactionClient, taskId: string, allowUnqueuedDraft = false) {
    const task = await tx.outreachTask.findFirst({
      where: { id: taskId, ...ownerScope() },
      include: {
        lead: { include: { consents: { where: { status: 'GRANTED' } } } },
        tiktokAccount: true,
        campaign: true,
      },
    });
    const direct =
      allowUnqueuedDraft && task && ['DRAFT', 'WAITING_REVIEW', 'FOLLOW_UP'].includes(task.status);
    if (task && direct) task.finalMessage = task.draftMessage;
    if (task?.finalMessage)
      task.finalMessage = renderOutboundMessage(task.finalMessage, {
        nama: task.lead.name || task.lead.tiktokUsername,
        username: task.lead.tiktokUsername,
        akun: task.tiktokAccount.username,
        campaign: task.campaign?.name,
        link: registrationLink(),
      });
    if (
      !task ||
      (task.status !== 'APPROVED' && !direct) ||
      task.ownerId !== task.lead.ownerId ||
      task.ownerId !== task.tiktokAccount.ownerId ||
      task.channel !== 'TIKTOK_DM' ||
      !task.finalMessage?.trim() ||
      task.finalMessage.trim().length < 5 ||
      task.finalMessage.length > 2000 ||
      !task.lead.tiktokUsernameNormalized ||
      task.lead.deletedAt ||
      task.lead.doNotContact ||
      NON_CONTACTABLE_LEAD_STATUSES.includes(task.lead.status) ||
      task.tiktokAccount.status !== 'ACTIVE' ||
      task.tiktokAccount.lane !== 'OUTBOUND'
    ) {
      throw new ConflictException('Tugas, akun, atau prospek tidak lagi memenuhi syarat.');
    }
    const blocked = await tx.doNotContactEntry.findFirst({
      where: { channel: 'TIKTOK_DM', valueNormalized: task.lead.tiktokUsernameNormalized },
    });
    if (blocked) throw new ConflictException('Penerima masuk daftar larangan kontak.');
    if (task.sentCount > 0) {
      const allowed = checkFollowUpAllowed({
        channel: task.channel,
        replied: !!task.repliedAt,
        hasConsentForChannel: task.lead.consents.some((c) => c.channel === task.channel),
        sentCount: task.sentCount,
      });
      if (!allowed.eligible) throw new ConflictException(allowed.reason);
    }
    return task;
  }

  async enqueue(actor: RequestUser, accountId: string, taskIds?: string[]) {
    await assertReferences(this.prisma, { accountId });
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, accountId);
      const tasks = await tx.outreachTask.findMany({
        where: {
          ...ownerScope(),
          ...(taskIds ? { id: { in: taskIds } } : {}),
          tiktokAccountId: accountId,
          status: { in: ['APPROVED', 'DRAFT', 'WAITING_REVIEW', 'FOLLOW_UP'] },
          channel: 'TIKTOK_DM',
          OR: [
            { browserDelivery: null },
            { sentCount: { gt: 0 }, browserDelivery: { is: { status: 'SENT' } } },
          ],
          lead: {
            deletedAt: null,
            doNotContact: false,
            status: { notIn: NON_CONTACTABLE_LEAD_STATUSES },
            tiktokUsernameNormalized: { not: null },
          },
        },
        orderBy: { approvedAt: 'asc' },
        take: 30,
      });
      let queued = 0;
      for (const row of tasks) {
        let task;
        try {
          task = await this.eligible(tx, row.id, true);
        } catch (error) {
          if (error instanceof ConflictException) {
            if (taskIds?.length === 1) throw error;
            continue;
          }
          throw error;
        }
        if (task.status !== 'APPROVED' || task.finalMessage !== row.finalMessage) {
          await tx.outreachTask.update({
            where: { id: task.id },
            data: {
              status: 'APPROVED',
              followUpAt: null,
              finalMessage: task.finalMessage,
              submittedAt: new Date(),
              approvedAt: new Date(),
              reviewerId: actor.id,
              reviewNote: null,
            },
          });
        }
        // Legacy dates never delay a follow-up; clear them when preparing its delivery.
        if (task.followUpAt)
          await tx.outreachTask.update({ where: { id: task.id }, data: { followUpAt: null } });
        if (task.sentCount > 0)
          await tx.lead.update({ where: { id: task.leadId }, data: { nextFollowUpAt: null } });
        const previous = await tx.browserDmDelivery.findUnique({ where: { taskId: task.id } });
        const data = {
          accountId,
          requestedById: actor.id,
          username: task.lead.tiktokUsernameNormalized!,
          senderUsername: task.tiktokAccount.username,
          message: task.finalMessage!,
        };
        if (previous) {
          // Preserve the original send before reusing the task's delivery slot.
          await tx.auditLog.create({
            data: {
              action: 'browser_dm.follow_up_queued',
              actorId: actor.id,
              actorEmail: actor.email,
              entityType: 'browser_dm_delivery',
              entityId: previous.id,
              metadata: {
                taskId: task.id,
                previousMessage: previous.message,
                previousStatus: previous.status,
                previousAttemptId: previous.attemptId,
                previousClientId: previous.clientId,
                previousCompletedAt: previous.completedAt?.toISOString() ?? null,
                sentCount: task.sentCount,
              },
            },
          });
          await tx.browserDmDelivery.update({
            where: { id: previous.id },
            data: {
              ...data,
              status: 'QUEUED',
              clientId: null,
              attemptId: null,
              startedAt: null,
              completedAt: null,
              detail: 'Follow-up disetujui dan diantrekan.',
            },
          });
        } else await tx.browserDmDelivery.create({ data: { ...data, taskId: task.id } });
        queued++;
      }
      await tx.auditLog.create({
        data: {
          action: 'browser_dm.queued',
          actorId: actor.id,
          actorEmail: actor.email,
          entityType: 'tiktok_account',
          entityId: accountId,
          metadata: { queued },
        },
      });
      return { queued };
    });
  }

  async list(actor: RequestUser, accountId: string) {
    await assertReferences(this.prisma, { accountId });
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, accountId);
      return tx.browserDmDelivery.findMany({
        where: { accountId, ...(actor.role === 'SUPER_ADMIN' ? {} : { requestedById: actor.id }) },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          taskId: true,
          username: true,
          status: true,
          detail: true,
          createdAt: true,
        },
      });
    });
  }

  async claim(actor: RequestUser, accountId: string, clientId: string) {
    await assertReferences(this.prisma, { accountId });
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, accountId);
      if (
        await tx.browserDmDelivery.findFirst({
          where: { accountId, status: { in: ['PROCESSING', 'UNVERIFIED'] } },
        })
      ) {
        throw new ConflictException(
          'Ada pengiriman berjalan atau belum terverifikasi. Periksa TikTok sebelum melanjutkan.',
        );
      }
      const delivery = await tx.browserDmDelivery.findFirst({
        where: { accountId, requestedById: actor.id, status: 'QUEUED' },
        orderBy: { createdAt: 'asc' },
      });
      if (!delivery) return null;
      let task;
      try {
        task = await this.eligible(tx, delivery.taskId);
        const original = renderOutboundMessage(delivery.message, {
          nama: task.lead.name || task.lead.tiktokUsername,
          username: task.lead.tiktokUsername,
          akun: task.tiktokAccount.username,
          campaign: task.campaign?.name,
          link: registrationLink(),
        });
        if (original !== task.finalMessage)
          throw new ConflictException('Pesan antrean berubah. Periksa kembali sebelum mengirim.');
      } catch {
        await tx.browserDmDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            detail: 'Kelayakan tugas/prospek berubah; tidak dikirim.',
            completedAt: new Date(),
          },
        });
        return { skipped: true };
      }
      if (task.finalMessage !== delivery.message) {
        await tx.outreachTask.update({
          where: { id: task.id },
          data: { finalMessage: task.finalMessage },
        });
      }
      return tx.browserDmDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'PROCESSING',
          message: task.finalMessage!,
          clientId,
          attemptId: randomUUID(),
          startedAt: new Date(),
        },
      });
    });
  }

  async authorize(actor: RequestUser, id: string, clientId: string, attemptId: string) {
    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.browserDmDelivery.findUnique({ where: { id } });
      if (!delivery || delivery.requestedById !== actor.id) throw new NotFoundException();
      await this.lock(tx, delivery.accountId);
      const current = await tx.browserDmDelivery.findUniqueOrThrow({ where: { id } });
      if (
        current.status !== 'PROCESSING' ||
        current.clientId !== clientId ||
        current.attemptId !== attemptId
      )
        throw new ConflictException('Percobaan pengiriman tidak aktif.');
      const task = await this.eligible(tx, current.taskId);
      if (
        task.finalMessage !== current.message ||
        task.lead.tiktokUsernameNormalized !== current.username ||
        task.tiktokAccount.username !== current.senderUsername
      )
        throw new ConflictException('Pesan atau identitas berubah; hentikan pengiriman.');
      return { allowed: true };
    });
  }

  async result(
    actor: RequestUser,
    id: string,
    input: {
      clientId: string;
      attemptId: string;
      status: 'SENT' | 'FAILED' | 'UNVERIFIED';
      detail: string;
    },
    manual = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.browserDmDelivery.findUnique({ where: { id } });
      if (!row || row.requestedById !== actor.id) throw new NotFoundException();
      await this.lock(tx, row.accountId);
      const delivery = await tx.browserDmDelivery.findUniqueOrThrow({ where: { id } });
      if (delivery.clientId !== input.clientId || delivery.attemptId !== input.attemptId)
        throw new ConflictException('Percobaan berbeda.');
      if (delivery.status === input.status) return { saved: true }; // Idempotent report after a lost response.
      if (!['PROCESSING', 'UNVERIFIED'].includes(delivery.status))
        throw new ConflictException('Hasil sudah final.');
      // Expired/uncertain attempts can only be confirmed by the same sender attempt; never auto-retry.
      await tx.browserDmDelivery.update({
        where: { id },
        data: { status: input.status, detail: input.detail, completedAt: new Date() },
      });
      if (input.status === 'SENT') {
        const task = await tx.outreachTask.findUniqueOrThrow({ where: { id: delivery.taskId } });
        await tx.outreachTask.update({
          where: { id: task.id },
          data: {
            status: manual ? 'MANUALLY_SENT' : 'BROWSER_SENT',
            sentCount: { increment: 1 },
            lastSentAt: new Date(),
            sentConfirmedAt: task.sentConfirmedAt ?? new Date(),
            followUpAt: null,
          },
        });
        await tx.lead.update({
          where: { id: task.leadId },
          data: {
            lastContactedAt: new Date(),
            nextFollowUpAt: null,
            ...((await tx.lead.findUniqueOrThrow({ where: { id: task.leadId } })).status === 'NEW'
              ? { status: 'CONTACTED' }
              : {}),
          },
        });
        await tx.leadActivity.create({
          data: {
            leadId: task.leadId,
            actorId: actor.id,
            type: 'MESSAGE_SENT',
            summary: 'Pesan terlihat pada chat browser TikTok (bukan bukti sudah dibaca).',
            metadata: {
              deliveryId: id,
              taskId: task.id,
              attemptId: input.attemptId,
              message: delivery.message,
              messageNumber: task.sentCount + 1,
              evidence: input.detail,
            },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          action: 'browser_dm.result',
          actorId: actor.id,
          actorEmail: actor.email,
          entityType: 'browser_dm_delivery',
          entityId: id,
          metadata: { status: input.status, detail: input.detail },
        },
      });
      return { saved: true };
    });
  }

  async cancel(actor: RequestUser, accountId: string) {
    await assertReferences(this.prisma, { accountId });
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, accountId);
      return tx.browserDmDelivery.updateMany({
        where: { accountId, requestedById: actor.id, status: 'QUEUED' },
        data: {
          status: 'CANCELLED',
          detail: 'Antrean dibatalkan operator.',
          completedAt: new Date(),
        },
      });
    });
  }

  async removeCancelled(actor: RequestUser, id: string) {
    const row = await this.prisma.browserDmDelivery.findUnique({ where: { id } });
    if (!row || (row.requestedById !== actor.id && actor.role !== 'SUPER_ADMIN'))
      throw new NotFoundException('Pengiriman tidak ditemukan.');
    await assertReferences(this.prisma, { accountId: row.accountId });
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, row.accountId);
      const current = await tx.browserDmDelivery.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Pengiriman tidak ditemukan.');
      if (current.status !== 'CANCELLED')
        throw new ConflictException('Hanya pengiriman yang dibatalkan dapat dihapus dari daftar.');
      // Keep the task and sent-message history, but prevent accidental requeueing after removal.
      await tx.outreachTask.updateMany({
        where: {
          id: current.taskId,
          status: { in: ['DRAFT', 'WAITING_REVIEW', 'APPROVED', 'FOLLOW_UP'] },
        },
        data: {
          status: 'CANCELLED',
          cancelReason: 'Antrean dibatalkan dan dihapus dari daftar.',
          followUpAt: null,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'browser_dm.cancelled_removed',
          actorId: actor.id,
          actorEmail: actor.email,
          entityType: 'browser_dm_delivery',
          entityId: id,
          metadata: {
            taskId: current.taskId,
            accountId: current.accountId,
            username: current.username,
            status: current.status,
            detail: current.detail,
            requestedById: current.requestedById,
          },
        },
      });
      await tx.browserDmDelivery.delete({ where: { id } });
      return { deleted: true };
    });
  }

  async resolve(actor: RequestUser, id: string, sent: boolean) {
    const row = await this.prisma.browserDmDelivery.findUnique({ where: { id } });
    if (!row || row.requestedById !== actor.id) throw new NotFoundException();
    if (row.status !== 'UNVERIFIED' || !row.clientId || !row.attemptId)
      throw new ConflictException('Hanya hasil belum terverifikasi yang bisa dikonfirmasi.');
    return this.result(
      actor,
      id,
      {
        clientId: row.clientId,
        attemptId: row.attemptId,
        status: sent ? 'SENT' : 'FAILED',
        detail: `Operator memeriksa chat TikTok dan mengonfirmasi ${sent ? 'terkirim' : 'tidak terkirim'}.`,
      },
      true,
    );
  }
  async retry(actor: RequestUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.browserDmDelivery.findUnique({ where: { id } });
      if (!row || row.requestedById !== actor.id) throw new NotFoundException();
      await this.lock(tx, row.accountId);
      const current = await tx.browserDmDelivery.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'FAILED')
        throw new ConflictException(
          'Hanya pengiriman gagal yang sudah diperiksa dapat diantrekan ulang.',
        );
      const task = await this.eligible(tx, current.taskId);
      await tx.browserDmDelivery.update({
        where: { id },
        data: {
          status: 'QUEUED',
          clientId: null,
          attemptId: null,
          startedAt: null,
          completedAt: null,
          username: task.lead.tiktokUsernameNormalized!,
          senderUsername: task.tiktokAccount.username,
          message: task.finalMessage!,
          detail: 'Diantrekan ulang setelah operator memastikan pesan belum terkirim.',
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'browser_dm.retried',
          actorId: actor.id,
          actorEmail: actor.email,
          entityType: 'browser_dm_delivery',
          entityId: id,
          metadata: { previousAttemptId: current.attemptId, previousDetail: current.detail },
        },
      });
      return { queued: 1 };
    });
  }
}
