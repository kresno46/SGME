import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type WahaSession } from '@smge/database';
import { maskPhone, type WahaSessionStatus, type WhatsappNumberInput } from '@smge/shared';
import type { WhatsappAdminSessionDto, WhatsappConfigDto, WhatsappSessionDto } from '@smge/types';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import type { RequestMeta } from '../common/utils/request';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { WAHA_GATEWAY, WahaError, type WahaGateway, type WahaSessionInfo } from './waha-gateway';
import { deriveWebhookSecret, newSessionName } from './waha-signature';

/** Event yang wajib dimiliki webhook sesi agar status koneksi dan centang pengiriman sampai ke SMGE. */
export const WEBHOOK_EVENTS = ['message', 'message.any', 'message.ack', 'session.status'];
/** Yang tidak relevan bagi CRM dan memakan penyimpanan: status, broadcast, channel, grup. */
const IGNORED_CHAT_KINDS = { status: true, broadcast: true, channels: true, groups: true };
/** Status yang benar-benar berasal dari WAHA; status masalah (WAHA mati, kunci ditolak) tidak dicatat. */
const KNOWN_STATUSES = new Set(['STOPPED', 'STARTING', 'SCAN_QR_CODE', 'WORKING', 'FAILED']);

export function problemStatus(code: string): WahaSessionStatus {
  if (code === 'unreachable') return 'UNREACHABLE';
  if (code === 'http_401' || code === 'http_403') return 'UNAUTHORIZED';
  if (code === 'not_configured') return 'NOT_CONFIGURED';
  return 'WAHA_ERROR';
}

function eventsOutdated(s: WahaSessionInfo | null) {
  return !!s && s.webhookCount > 0 && !WEBHOOK_EVENTS.every((e) => s.webhookEvents.includes(e));
}

type Row = WahaSession & { _count: { chats: number } };
const WITH_COUNT = { _count: { select: { chats: true } } } as const;

/**
 * WhatsApp per pengguna: tiap user menautkan nomornya sendiri, dan boleh punya beberapa nomor
 * (WAHA_MAX_SESSIONS_PER_USER). Operasi pengguna selalu lewat ID sesi milik user itu sendiri, jadi tidak ada jalur
 * menyentuh sesi orang lain. Super Admin melihat semua sesi dan boleh menghentikan/memutus sesi siapa pun.
 */
@Injectable()
export class WhatsappSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(WAHA_GATEWAY) private readonly gateway: WahaGateway | null,
  ) {}

  get enabled() {
    return this.gateway !== null;
  }

  config(): WhatsappConfigDto {
    const e = env();
    return {
      enabled: this.enabled,
      maxSessionsPerUser: e.WAHA_SESSION_NAME ? 1 : e.WAHA_MAX_SESSIONS_PER_USER,
      singleSession: !!e.WAHA_SESSION_NAME,
      contactsSync: e.WAHA_CONTACTS_SYNC,
      newChatsPerDay: e.WAHA_NEW_CHATS_PER_DAY,
      historySync: e.WAHA_HISTORY_SYNC,
      historyDays: e.WAHA_HISTORY_DAYS,
      broadcast: {
        enabled: e.WAHA_BROADCAST_ENABLED,
        maxRecipients: e.WAHA_BROADCAST_MAX_RECIPIENTS,
        perDay: e.WAHA_BROADCAST_PER_DAY,
        minDelaySeconds: e.WAHA_BROADCAST_MIN_DELAY_SECONDS,
        maxDelaySeconds: e.WAHA_BROADCAST_MAX_DELAY_SECONDS,
      },
    };
  }

  private gw(): WahaGateway {
    if (!this.gateway)
      throw new ServiceUnavailableException('WhatsApp belum diaktifkan di server ini.');
    return this.gateway;
  }

  private fail(e: unknown): never {
    if (e instanceof WahaError) throw new BadGatewayException(`WAHA bermasalah (${e.code}).`);
    throw e;
  }

  /** Sesi milik user itu sendiri; milik orang lain (termasuk bagi Super Admin) dianggap tidak ada. */
  private async own(user: RequestUser, id: string): Promise<Row> {
    const row = await this.prisma.wahaSession.findFirst({
      where: { id, userId: user.id },
      include: WITH_COUNT,
    });
    if (!row) throw new NotFoundException('Nomor WhatsApp tidak ditemukan.');
    return row;
  }

  /**
   * Mencatat status terbaru dan mengembalikan penanda putus. `expected` = akibat tindakan user sendiri
   * (bukan putus tak disengaja).
   */
  async recordStatus(
    row: Pick<WahaSession, 'id' | 'lastStatus' | 'connectionLostAt'>,
    status: string,
    expected: boolean,
  ): Promise<Date | null> {
    if (!KNOWN_STATUSES.has(status)) return row.connectionLostAt;
    const now = new Date();
    let lost = row.connectionLostAt;
    if (status === 'WORKING' || expected) lost = null;
    else if (row.lastStatus === 'WORKING') lost = row.connectionLostAt ?? now;
    await this.prisma.wahaSession.update({
      where: { id: row.id },
      data: {
        lastStatus: status,
        lastStatusAt: now,
        connectionLostAt: lost,
        // Menunggu pemindaian = pasangan baru: riwayat dari ponsel yang baru perlu disinkronkan dari awal.
        ...(status === 'SCAN_QR_CODE' && row.lastStatus !== 'SCAN_QR_CODE'
          ? { historySyncedAt: null, historySyncRuns: 0, historyChats: 0, historySyncError: null }
          : {}),
      },
    });
    return lost;
  }

  private dto(
    row: Row,
    info: WahaSessionInfo | null,
    problem: string | null,
    lost: boolean,
  ): WhatsappSessionDto {
    return {
      id: row.id,
      label: row.label,
      chatCount: row._count.chats,
      historySyncedAt: row.historySyncedAt?.toISOString() ?? null,
      historySyncing:
        !!row.historySyncStartedAt && Date.now() - row.historySyncStartedAt.getTime() < 15 * 60_000,
      historyChats: row.historyChats,
      historyError: row.historySyncError,
      status: problem ? problemStatus(problem) : (info?.status ?? 'NOT_CREATED'),
      connectedNumber: maskPhone(info?.meId?.split('@')[0]),
      connectedName: info?.mePushName ?? null,
      problem,
      eventsOutdated: eventsOutdated(info),
      connectionLost: lost,
    };
  }

  /** Status satu nomor langsung dari WAHA, dipakai setelah tindakan. */
  private async liveOne(row: Row, expected: boolean): Promise<WhatsappSessionDto> {
    if (!this.gateway) return this.dto(row, null, 'not_configured', false);
    try {
      const info = await this.gateway.getSession(row.sessionName);
      const lost = info
        ? await this.recordStatus(row, info.status, expected)
        : row.connectionLostAt;
      return this.dto(row, info, null, lost != null);
    } catch (e) {
      if (!(e instanceof WahaError)) throw e;
      return this.dto(row, null, e.code, false);
    }
  }

  /** Semua nomor milik user, dengan status langsung dari WAHA (satu panggilan untuk semuanya). */
  async list(user: RequestUser): Promise<WhatsappSessionDto[]> {
    const rows = await this.prisma.wahaSession.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      include: WITH_COUNT,
    });
    if (!rows.length) return [];
    if (!this.gateway) return rows.map((r) => this.dto(r, null, 'not_configured', false));
    let bulk: Map<string, WahaSessionInfo>;
    try {
      bulk = await this.gateway.listSessions();
    } catch (e) {
      if (!(e instanceof WahaError)) throw e;
      return rows.map((r) => this.dto(r, null, e.code, false));
    }
    return Promise.all(
      rows.map(async (r) => {
        const info = bulk.get(r.sessionName) ?? null;
        const lost = info ? await this.recordStatus(r, info.status, false) : r.connectionLostAt;
        return this.dto(r, info, null, lost != null);
      }),
    );
  }

  /** Keadaan tersimpan tanpa memanggil WAHA; aman dipanggil sering untuk spanduk "terputus". */
  async health(user: RequestUser) {
    const rows = await this.prisma.wahaSession.findMany({
      where: { userId: user.id },
      select: { id: true, label: true, connectionLostAt: true },
    });
    return {
      linked: rows.length > 0,
      connectionLost: rows.some((r) => r.connectionLostAt),
      lostLabels: rows.filter((r) => r.connectionLostAt).map((r) => r.label),
    };
  }

  private creationConfig(name: string) {
    const e = env();
    const base = (e.WAHA_PUBLIC_WEBHOOK_BASE_URL ?? '').replace(/\/+$/, '');
    return {
      ignore: IGNORED_CHAT_KINDS,
      // Kontak ponsel hanya tersedia bila store NOWEB aktif sejak sesi dibuat; WAHA menyimpan riwayat chatnya.
      ...(e.WAHA_CONTACTS_SYNC || e.WAHA_HISTORY_SYNC
        ? { noweb: { store: { enabled: true, fullSync: true } } }
        : {}),
      webhooks: [
        {
          url: `${base}/${name}`,
          events: WEBHOOK_EVENTS,
          hmac: { key: deriveWebhookSecret(e.WAHA_WEBHOOK_MASTER_SECRET ?? '', name) },
        },
      ],
    };
  }

  /** Membuat sesi di WAHA bila belum ada lalu menjalankannya. Aman dipanggil berulang. */
  private async launch(row: Row) {
    const gw = this.gw();
    try {
      await gw.createSession(row.sessionName, this.creationConfig(row.sessionName));
      await gw.startSession(row.sessionName);
    } catch (e) {
      this.fail(e);
    }
  }

  private log(action: string, user: RequestUser, row: { id: string }, meta: RequestMeta) {
    return this.audit.log({
      action: `whatsapp.session.${action}`,
      actor: user,
      entityType: 'waha_session',
      entityId: row.id,
      meta,
    });
  }

  /** Menambah nomor baru (dan langsung menjalankannya agar QR muncul). */
  async create(user: RequestUser, input: WhatsappNumberInput, meta: RequestMeta) {
    this.gw();
    const e = env();
    const mine = await this.prisma.wahaSession.count({ where: { userId: user.id } });
    const limit = e.WAHA_SESSION_NAME ? 1 : e.WAHA_MAX_SESSIONS_PER_USER;
    if (mine >= limit)
      throw new ConflictException(
        e.WAHA_SESSION_NAME
          ? 'Server WAHA ini hanya mendukung satu nomor.'
          : `Maksimal ${limit} nomor WhatsApp per pengguna.`,
      );
    if ((await this.prisma.wahaSession.count()) >= e.WAHA_MAX_SESSIONS)
      throw new ConflictException('Batas jumlah nomor WhatsApp di server ini sudah tercapai.');
    let row: Row;
    try {
      row = await this.prisma.wahaSession.create({
        data: {
          userId: user.id,
          label: input.label,
          sessionName: newSessionName(user.id, e.WAHA_SESSION_NAME),
        },
        include: WITH_COUNT,
      });
    } catch (err) {
      // Mode satu sesi: nama sesi tunggal sudah dipakai pengguna lain.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw new ConflictException(
          'Server WAHA ini hanya mendukung satu nomor dan sudah dipakai.',
        );
      throw err;
    }
    await this.log('create', user, row, meta);
    await this.launch(row);
    return this.liveOne(row, true);
  }

  async rename(user: RequestUser, id: string, input: WhatsappNumberInput) {
    const row = await this.own(user, id);
    const updated = await this.prisma.wahaSession.update({
      where: { id: row.id },
      data: { label: input.label },
      include: WITH_COUNT,
    });
    return this.liveOne(updated, true);
  }

  /** Menjalankan sesi yang berhenti/gagal. Aman dipanggil berulang. */
  async start(user: RequestUser, id: string, meta: RequestMeta) {
    const row = await this.own(user, id);
    await this.launch(row);
    await this.log('start', user, row, meta);
    return this.liveOne(row, true);
  }

  async stop(user: RequestUser, id: string, meta: RequestMeta) {
    const gw = this.gw();
    const row = await this.own(user, id);
    try {
      await gw.stopSession(row.sessionName);
    } catch (e) {
      this.fail(e);
    }
    await this.log('stop', user, row, meta);
    return this.liveOne(row, true);
  }

  /** Memutuskan nomor dari sesi (perlu pindai QR lagi untuk menautkan). */
  async logout(user: RequestUser, id: string, meta: RequestMeta) {
    const gw = this.gw();
    const row = await this.own(user, id);
    try {
      await gw.logoutSession(row.sessionName);
    } catch (e) {
      this.fail(e);
    }
    await this.log('logout', user, row, meta);
    return this.liveOne(row, true);
  }

  /**
   * Menghapus dan membuat ulang sesi yang macet (mis. terjebak di STARTING). Ditolak bila nomor sedang
   * tersambung: putuskan dulu supaya nomor tidak terlepas tanpa disengaja.
   */
  async reset(user: RequestUser, id: string, meta: RequestMeta) {
    const gw = this.gw();
    const row = await this.own(user, id);
    try {
      const s = await gw.getSession(row.sessionName);
      if (s?.meId)
        throw new ConflictException('Nomor masih tersambung. Putuskan nomor terlebih dahulu.');
      if (s) await gw.stopSession(row.sessionName).catch(() => undefined);
      await gw.deleteSession(row.sessionName);
    } catch (e) {
      this.fail(e);
    }
    await this.log('reset', user, row, meta);
    await this.launch(row);
    return this.liveOne(row, true);
  }

  /**
   * Menghapus nomor dari SMGE dan WAHA. Hanya bila belum tersambung dan tidak punya chat: riwayat chat tidak
   * pernah ikut terhapus diam-diam.
   */
  async remove(user: RequestUser, id: string, meta: RequestMeta) {
    const gw = this.gw();
    const row = await this.own(user, id);
    if (row._count.chats > 0)
      throw new ConflictException('Nomor ini punya chat tersimpan, jadi tidak dapat dihapus.');
    try {
      const s = await gw.getSession(row.sessionName);
      if (s?.meId)
        throw new ConflictException('Nomor masih tersambung. Putuskan nomor terlebih dahulu.');
      if (s) await gw.stopSession(row.sessionName).catch(() => undefined);
      await gw.deleteSession(row.sessionName);
    } catch (e) {
      this.fail(e);
    }
    await this.prisma.wahaSession.delete({ where: { id: row.id } });
    await this.log('delete', user, row, meta);
    return { ok: true };
  }

  async qr(user: RequestUser, id: string) {
    const gw = this.gw();
    const row = await this.own(user, id);
    try {
      return await gw.getQr(row.sessionName);
    } catch (e) {
      if (e instanceof WahaError && (e.code === 'http_404' || e.code === 'http_422'))
        throw new NotFoundException('QR belum siap. Tunggu beberapa detik lalu coba lagi.');
      this.fail(e);
    }
  }

  // ── Super Admin ──

  private assertSuperAdmin(actor: RequestUser) {
    if (actor.role !== 'SUPER_ADMIN')
      throw new ForbiddenException('Akses ini hanya untuk Super Admin.');
  }

  async adminList(actor: RequestUser): Promise<WhatsappAdminSessionDto[]> {
    this.assertSuperAdmin(actor);
    const rows = await this.prisma.wahaSession.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: { name: true, email: true, status: true, role: { select: { code: true } } },
        },
        _count: { select: { chats: true } },
      },
    });
    let bulk: Map<string, WahaSessionInfo> | null = null;
    let bulkProblem: string | null = null;
    if (rows.length) {
      if (!this.gateway) bulkProblem = 'not_configured';
      else
        try {
          bulk = await this.gateway.listSessions();
        } catch (e) {
          if (!(e instanceof WahaError)) throw e;
          bulkProblem = e.code;
        }
    }
    return rows.map((r) => {
      const s = bulk?.get(r.sessionName) ?? null;
      return {
        sessionId: r.id,
        label: r.label,
        userId: r.userId,
        userName: r.user.name,
        userEmail: r.user.email,
        userRole: r.user.role.code,
        userActive: r.user.status === 'ACTIVE',
        status: bulkProblem ? problemStatus(bulkProblem) : (s?.status ?? 'NOT_CREATED'),
        connectedNumber: maskPhone(s?.meId?.split('@')[0]),
        connectedName: s?.mePushName ?? null,
        problem: bulkProblem,
        connectionLost: r.connectionLostAt != null,
        chatCount: r._count.chats,
      };
    });
  }

  private async adminTarget(actor: RequestUser, sessionId: string) {
    this.assertSuperAdmin(actor);
    const row = await this.prisma.wahaSession.findUnique({ where: { id: sessionId } });
    if (!row) throw new NotFoundException('Sesi tidak ditemukan.');
    return row;
  }

  async adminStop(actor: RequestUser, sessionId: string, meta: RequestMeta) {
    const gw = this.gw();
    const row = await this.adminTarget(actor, sessionId);
    try {
      await gw.stopSession(row.sessionName);
    } catch (e) {
      this.fail(e);
    }
    await this.log('admin_stop', actor, row, meta);
    await this.prisma.wahaSession.update({
      where: { id: row.id },
      data: { connectionLostAt: null },
    });
  }

  async adminLogout(actor: RequestUser, sessionId: string, meta: RequestMeta) {
    const gw = this.gw();
    const row = await this.adminTarget(actor, sessionId);
    try {
      await gw.logoutSession(row.sessionName);
    } catch (e) {
      this.fail(e);
    }
    await this.log('admin_logout', actor, row, meta);
    await this.prisma.wahaSession.update({
      where: { id: row.id },
      data: { connectionLostAt: null },
    });
  }
}
