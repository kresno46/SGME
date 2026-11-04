import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma, WhatsappBroadcast } from '@smge/database';
import {
  PERMISSIONS,
  normalizePhone,
  renderBroadcastMessage,
  type WhatsappBroadcastInput,
} from '@smge/shared';
import type {
  WhatsappBroadcastDetailDto,
  WhatsappBroadcastDto,
  WhatsappBroadcastRecipientDto,
} from '@smge/types';
import { AuditService } from '../audit/audit.service';
import { dataScope } from '../common/data-scope';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { startOfToday } from '../common/utils/refs';
import type { RequestMeta } from '../common/utils/request';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappChatService } from './whatsapp-chat.service';

const TICK_MS = 5_000;
/** Selama diproses, `nextSendAt` dipindah ke depan: proses lain tidak mengambil penerima yang sama. */
const LEASE_MS = 2 * 60_000;
const SHORT_RETRY_MS = 30_000;
const SKIP_GAP_MS = 5_000;
const MAX_CONSECUTIVE_FAILURES = 3;

type Outcome =
  | { kind: 'sent'; chatId: string }
  | { kind: 'skipped'; reason: string; chatId?: string }
  | { kind: 'failed'; reason: string; chatId?: string }
  | { kind: 'defer' }
  | { kind: 'defer_tomorrow' }
  | { kind: 'pause'; reason: string };

const messageOf = (e: HttpException) => {
  const r = e.getResponse();
  return typeof r === 'string' ? r : String((r as { message?: unknown }).message ?? '');
};

/**
 * Kirim terjadwal satu pesan ke daftar kecil penerima terpilih. Bukan blast massal:
 *
 * - Penerima maksimal WAHA_BROADCAST_MAX_RECIPIENTS, dan pemilik wajib mengonfirmasi bahwa semuanya mengenalnya.
 * - Satu pesan per putaran dengan jeda acak; batas WAHA_BROADCAST_PER_DAY per nomor per hari, sisanya lanjut besok.
 * - Setiap penerima memakai alur "chat baru" lalu "kirim" yang sama dengan pengiriman manual, jadi cek terdaftar di
 *   WhatsApp, daftar larangan kontak, permintaan "stop", batas chat baru, dan pembatas kirim ikut berlaku.
 * - Tiga kegagalan berturut-turut menjeda blast otomatis (tanda nomor bermasalah), bukan terus mencoba.
 * - Idempoten per penerima (clientMessageId), aman terhadap proses yang mati di tengah jalan.
 */
@Injectable()
export class WhatsappBroadcastService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('WhatsappBroadcast');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chats: WhatsappChatService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    const e = env();
    if (!e.WAHA_BROADCAST_ENABLED || e.NODE_ENV === 'test') return;
    this.timer = setInterval(
      () =>
        void this.tick().catch((err) =>
          this.logger.error(`Penjadwal gagal: ${(err as Error).name}`),
        ),
      TICK_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private assertEnabled() {
    if (!env().WAHA_BROADCAST_ENABLED)
      throw new ServiceUnavailableException('Kirim terjadwal belum diaktifkan di server ini.');
  }

  // ── Pemilik ──

  async create(
    user: RequestUser,
    input: WhatsappBroadcastInput,
    meta: RequestMeta,
  ): Promise<WhatsappBroadcastDetailDto> {
    this.assertEnabled();
    const e = env();
    const session = await this.prisma.wahaSession.findFirst({
      where: { id: input.sessionId, userId: user.id },
    });
    if (!session) throw new NotFoundException('Nomor WhatsApp tidak ditemukan.');
    if (session.lastStatus !== 'WORKING')
      throw new ConflictException('Nomor belum tersambung. Tautkan nomor terlebih dahulu.');

    const byPhone = new Map<string, string | null>();
    let invalid = 0;
    for (const r of input.recipients) {
      const phone = normalizePhone(r.phone);
      if (!phone) invalid++;
      else if (!byPhone.has(phone)) byPhone.set(phone, r.name || null);
    }
    if (invalid > 0)
      throw new BadRequestException(`${invalid} nomor tidak valid. Periksa daftar penerima.`);
    if (byPhone.size > e.WAHA_BROADCAST_MAX_RECIPIENTS)
      throw new BadRequestException(
        `Maksimal ${e.WAHA_BROADCAST_MAX_RECIPIENTS} penerima per pengiriman (ada ${byPhone.size}).`,
      );

    const now = new Date();
    const broadcast = await this.prisma.whatsappBroadcast.create({
      data: {
        ownerId: user.id,
        sessionId: session.id,
        name: input.name,
        message: input.message,
        consentConfirmedAt: now,
        nextSendAt: new Date(now.getTime() + SKIP_GAP_MS),
        recipients: { create: [...byPhone].map(([phone, name]) => ({ phone, name })) },
      },
    });
    await this.audit.log({
      action: 'whatsapp.broadcast.create',
      actor: user,
      entityType: 'whatsapp_broadcast',
      entityId: broadcast.id,
      metadata: { recipients: byPhone.size, consentConfirmed: true },
      meta,
    });
    return this.detail(user, broadcast.id);
  }

  async list(user: RequestUser): Promise<WhatsappBroadcastDto[]> {
    const rows = await this.prisma.whatsappBroadcast.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { session: { select: { label: true } } },
    });
    const counts = await this.counts(rows.map((r) => r.id));
    return rows.map((r) => this.toDto(r, r.session.label, counts.get(r.id)));
  }

  async detail(user: RequestUser, id: string): Promise<WhatsappBroadcastDetailDto> {
    const b = await this.prisma.whatsappBroadcast.findFirst({
      where: { id, ownerId: user.id },
      include: {
        session: { select: { label: true } },
        recipients: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!b) throw new NotFoundException('Pengiriman tidak ditemukan.');
    const counts = await this.counts([id]);
    return {
      ...this.toDto(b, b.session.label, counts.get(id)),
      recipients: b.recipients.map((r): WhatsappBroadcastRecipientDto => ({
        id: r.id,
        phone: r.phone,
        name: r.name,
        status: r.status,
        reason: r.reason,
        chatId: r.chatId,
        sentAt: r.sentAt?.toISOString() ?? null,
      })),
    };
  }

  private async own(user: RequestUser, id: string) {
    const b = await this.prisma.whatsappBroadcast.findFirst({ where: { id, ownerId: user.id } });
    if (!b) throw new NotFoundException('Pengiriman tidak ditemukan.');
    return b;
  }

  async pause(user: RequestUser, id: string, meta: RequestMeta) {
    const b = await this.own(user, id);
    if (b.status !== 'RUNNING')
      throw new ConflictException('Hanya pengiriman yang berjalan yang bisa dijeda.');
    await this.prisma.whatsappBroadcast.update({
      where: { id },
      data: { status: 'PAUSED', pauseReason: 'manual', nextSendAt: null },
    });
    await this.log('pause', user, id, meta);
    return this.detail(user, id);
  }

  async resume(user: RequestUser, id: string, meta: RequestMeta) {
    this.assertEnabled();
    const b = await this.own(user, id);
    if (b.status !== 'PAUSED')
      throw new ConflictException('Hanya pengiriman yang dijeda yang bisa dilanjutkan.');
    await this.prisma.whatsappBroadcast.update({
      where: { id },
      data: {
        status: 'RUNNING',
        pauseReason: null,
        consecutiveFailures: 0,
        nextSendAt: new Date(Date.now() + SKIP_GAP_MS),
      },
    });
    await this.log('resume', user, id, meta);
    return this.detail(user, id);
  }

  /** Penerima yang belum dikirimi ditandai dilewati; yang sudah terkirim tidak bisa ditarik. */
  async cancel(user: RequestUser, id: string, meta: RequestMeta) {
    const b = await this.own(user, id);
    if (b.status === 'DONE' || b.status === 'CANCELLED')
      throw new ConflictException('Pengiriman ini sudah selesai.');
    await this.prisma.$transaction([
      this.prisma.whatsappBroadcastRecipient.updateMany({
        where: { broadcastId: id, status: 'PENDING' },
        data: { status: 'SKIPPED', reason: 'cancelled' },
      }),
      this.prisma.whatsappBroadcast.update({
        where: { id },
        data: { status: 'CANCELLED', nextSendAt: null, finishedAt: new Date() },
      }),
    ]);
    await this.log('cancel', user, id, meta);
    return this.detail(user, id);
  }

  private log(action: string, user: RequestUser, id: string, meta: RequestMeta) {
    return this.audit.log({
      action: `whatsapp.broadcast.${action}`,
      actor: user,
      entityType: 'whatsapp_broadcast',
      entityId: id,
      meta,
    });
  }

  private async counts(ids: string[]) {
    const out = new Map<string, Record<string, number>>();
    if (!ids.length) return out;
    const rows = await this.prisma.whatsappBroadcastRecipient.groupBy({
      by: ['broadcastId', 'status'],
      where: { broadcastId: { in: ids } },
      _count: { _all: true },
    });
    for (const r of rows) {
      const m = out.get(r.broadcastId) ?? {};
      m[r.status] = r._count._all;
      out.set(r.broadcastId, m);
    }
    return out;
  }

  private toDto(
    b: WhatsappBroadcast,
    sessionLabel: string,
    c: Record<string, number> = {},
  ): WhatsappBroadcastDto {
    const sent = c.SENT ?? 0;
    const failed = c.FAILED ?? 0;
    const skipped = c.SKIPPED ?? 0;
    const pending = c.PENDING ?? 0;
    return {
      id: b.id,
      name: b.name,
      message: b.message,
      status: b.status,
      pauseReason: b.pauseReason,
      sessionId: b.sessionId,
      sessionLabel,
      total: sent + failed + skipped + pending,
      sent,
      failed,
      skipped,
      pending,
      nextSendAt: b.nextSendAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      finishedAt: b.finishedAt?.toISOString() ?? null,
    };
  }

  // ── Penjadwal ──

  /** Memproses satu penerima untuk tiap pengiriman yang sudah jatuh tempo. `now` bisa disuntikkan untuk tes. */
  async tick(now = new Date()) {
    if (!env().WAHA_BROADCAST_ENABLED) return { processed: 0 };
    const due = await this.prisma.whatsappBroadcast.findMany({
      where: { status: 'RUNNING', nextSendAt: { lte: now } },
      select: { id: true },
      take: 20,
    });
    let processed = 0;
    for (const { id } of due) if (await this.step(id, now)) processed++;
    return { processed };
  }

  private async setNext(
    id: string,
    at: Date | null,
    extra: Prisma.WhatsappBroadcastUpdateManyMutationInput = {},
  ) {
    // Hanya bila masih berjalan: jeda/pembatalan dari pemilik saat penerima diproses tidak ditimpa.
    await this.prisma.whatsappBroadcast.updateMany({
      where: { id, status: 'RUNNING' },
      data: { nextSendAt: at, ...extra },
    });
  }

  private delayMs() {
    const e = env();
    const min = e.WAHA_BROADCAST_MIN_DELAY_SECONDS;
    const max = Math.max(min, e.WAHA_BROADCAST_MAX_DELAY_SECONDS);
    return (min + Math.random() * (max - min)) * 1000;
  }

  private async step(id: string, now: Date): Promise<boolean> {
    const claimed = await this.prisma.whatsappBroadcast.updateMany({
      where: { id, status: 'RUNNING', nextSendAt: { lte: now } },
      data: { nextSendAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (claimed.count === 0) return false;
    const b = await this.prisma.whatsappBroadcast.findUniqueOrThrow({
      where: { id },
      include: { owner: { include: { role: true } } },
    });

    const owner = b.owner;
    if (owner.status !== 'ACTIVE' || !owner.role.permissions.includes(PERMISSIONS.WHATSAPP_USE)) {
      await this.pauseWith(id, 'owner_unavailable');
      return true;
    }

    const sentToday = await this.prisma.whatsappBroadcastRecipient.count({
      where: {
        status: 'SENT',
        sentAt: { gte: startOfToday(now) },
        broadcast: { sessionId: b.sessionId },
      },
    });
    if (sentToday >= env().WAHA_BROADCAST_PER_DAY) {
      await this.setNext(id, this.tomorrow(now));
      return true;
    }

    const r = await this.prisma.whatsappBroadcastRecipient.findFirst({
      where: { broadcastId: id, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (!r) {
      await this.finish(id);
      return true;
    }

    const actor: RequestUser = {
      id: owner.id,
      email: owner.email,
      name: owner.name,
      role: owner.role.code,
      roleName: owner.role.name,
      permissions: owner.role.permissions,
      sessionId: 'broadcast',
      twoFactorEnabled: owner.twoFactorEnabled,
    };
    // Mengikuti cakupan data pemilik, seperti permintaan HTTP biasa.
    const outcome = await dataScope.run(actor, () => this.deliver(b, r, actor));
    await this.apply(b, r.id, outcome, now);
    return true;
  }

  private tomorrow(now: Date) {
    // Jam 00:01 sampai 00:06 WIB berikutnya, supaya beberapa blast tidak serentak.
    return new Date(startOfToday(now).getTime() + 24 * 3600_000 + 60_000 + Math.random() * 300_000);
  }

  private async deliver(
    b: WhatsappBroadcast,
    r: { id: string; phone: string; name: string | null },
    actor: RequestUser,
  ): Promise<Outcome> {
    const meta: RequestMeta = { ipAddress: null, userAgent: 'broadcast' };
    let chatId: string;
    try {
      chatId = (
        await this.chats.start(
          actor,
          b.sessionId,
          { phone: r.phone, name: r.name ?? undefined },
          meta,
        )
      ).id;
    } catch (e) {
      return this.classify(e);
    }
    try {
      await this.chats.send(
        actor,
        chatId,
        {
          text: renderBroadcastMessage(b.message, r.name),
          clientMessageId: `bc${r.id.replaceAll('-', '')}`,
        },
        meta,
      );
    } catch (e) {
      const o = this.classify(e);
      return o.kind === 'skipped' || o.kind === 'failed' ? { ...o, chatId } : o;
    }
    return { kind: 'sent', chatId };
  }

  /** Memetakan penolakan alur chat biasa menjadi tindakan untuk penerima ini. */
  private classify(e: unknown): Outcome {
    if (!(e instanceof HttpException)) return { kind: 'failed', reason: 'send_failed:error' };
    const status = e.getStatus();
    const msg = messageOf(e);
    if (status === 429)
      return /Batas chat baru/.test(msg) ? { kind: 'defer_tomorrow' } : { kind: 'defer' };
    if (status === 422) return { kind: 'failed', reason: 'not_registered' };
    if (status === 503) return { kind: 'pause', reason: 'waha_unavailable' };
    if (status === 409) {
      if (/larangan kontak/.test(msg)) return { kind: 'skipped', reason: 'dnc' };
      if (/sendiri/.test(msg)) return { kind: 'skipped', reason: 'self' };
      if (/berhenti/.test(msg)) return { kind: 'skipped', reason: 'opt_out' };
      if (/belum tersambung/.test(msg)) return { kind: 'pause', reason: 'session_not_connected' };
      if (/sedang dikirim/.test(msg)) return { kind: 'defer' };
      return { kind: 'failed', reason: 'send_failed:conflict' };
    }
    if (status === 502) {
      if (/tidak menjawab/.test(msg)) return { kind: 'failed', reason: 'send_failed:timeout' };
      const code = /\(([^)]+)\)/.exec(msg)?.[1] ?? 'error';
      return { kind: 'failed', reason: `send_failed:${code}` };
    }
    return { kind: 'failed', reason: `send_failed:${status}` };
  }

  private async pauseWith(id: string, reason: string) {
    await this.prisma.whatsappBroadcast.updateMany({
      where: { id, status: 'RUNNING' },
      data: { status: 'PAUSED', pauseReason: reason, nextSendAt: null },
    });
  }

  private async finish(id: string) {
    await this.prisma.whatsappBroadcast.updateMany({
      where: { id, status: 'RUNNING' },
      data: { status: 'DONE', nextSendAt: null, finishedAt: new Date() },
    });
  }

  private async apply(b: WhatsappBroadcast, recipientId: string, o: Outcome, now: Date) {
    const at = (ms: number) => new Date(now.getTime() + ms);
    switch (o.kind) {
      case 'defer':
        return this.setNext(b.id, at(SHORT_RETRY_MS));
      case 'defer_tomorrow':
        return this.setNext(b.id, this.tomorrow(now));
      case 'pause':
        return this.pauseWith(b.id, o.reason);
      case 'sent':
        await this.prisma.whatsappBroadcastRecipient.update({
          where: { id: recipientId },
          data: { status: 'SENT', sentAt: new Date(), chatId: o.chatId, reason: null },
        });
        await this.afterRecipient(b.id, at(this.delayMs()), { consecutiveFailures: 0 });
        return;
      case 'skipped':
        await this.prisma.whatsappBroadcastRecipient.update({
          where: { id: recipientId },
          data: { status: 'SKIPPED', reason: o.reason, chatId: o.chatId ?? null },
        });
        // Tidak ada yang dikirim, jadi tidak perlu menunggu lama; cek nomor tetap diberi jarak.
        await this.afterRecipient(b.id, at(SKIP_GAP_MS));
        return;
      case 'failed': {
        await this.prisma.whatsappBroadcastRecipient.update({
          where: { id: recipientId },
          data: { status: 'FAILED', reason: o.reason, chatId: o.chatId ?? null },
        });
        const failures = b.consecutiveFailures + 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          await this.prisma.whatsappBroadcast.updateMany({
            where: { id: b.id, status: 'RUNNING' },
            data: {
              status: 'PAUSED',
              pauseReason: 'too_many_failures',
              consecutiveFailures: failures,
              nextSendAt: null,
            },
          });
          return;
        }
        await this.afterRecipient(b.id, at(this.delayMs()), { consecutiveFailures: failures });
        return;
      }
    }
  }

  /** Selesai bila tidak ada lagi yang menunggu; selain itu jadwalkan penerima berikutnya. */
  private async afterRecipient(
    id: string,
    next: Date,
    extra: Prisma.WhatsappBroadcastUpdateManyMutationInput = {},
  ) {
    const pending = await this.prisma.whatsappBroadcastRecipient.count({
      where: { broadcastId: id, status: 'PENDING' },
    });
    if (pending === 0) {
      await this.prisma.whatsappBroadcast.updateMany({
        where: { id, status: 'RUNNING' },
        data: { status: 'DONE', nextSendAt: null, finishedAt: new Date(), ...extra },
      });
      return;
    }
    await this.setNext(id, next, extra);
  }
}
