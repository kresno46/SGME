import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { WahaSession } from '@smge/database';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { WAHA_GATEWAY, WahaError, type WahaGateway } from './waha-gateway';
import { WhatsappIngestService, parseWahaMessage, previewOf } from './whatsapp-ingest.service';

const LEASE_MS = 15 * 60_000;
/** Beberapa putaran pertama berdekatan: riwayat dari ponsel tiba bertahap setelah pemindaian. */
const EARLY_RUNS = 4;
const EARLY_GAP_MS = 10 * 60_000;
const CATCH_UP_MS = 6 * 3600_000;
const DIRECT = /@(c\.us|lid)$/;

export interface HistoryResult {
  chats: number;
  imported: number;
}

/**
 * Impor riwayat chat 1:1 dari NOWEB store WAHA setelah nomor ditautkan, supaya konteks percakapan sebelumnya ikut
 * terbawa. Aturan:
 *
 * - Hanya chat 1:1 dengan pesan dalam WAHA_HISTORY_DAYS terakhir, dibatasi jumlah chat dan pesan per chat.
 * - Idempoten: pesan yang sama (ID WhatsApp) tidak digandakan, juga terhadap webhook dan kiriman dari SMGE.
 * - Riwayat tidak menambah "belum dibaca" dan tidak memakai jatah chat baru per hari.
 * - Tidak ada isi pesan di log. Kegagalan hanya dicatat sebagai kode (mis. store_disabled).
 * - Lease di database mencegah dua proses (API/worker/replika) menyinkronkan nomor yang sama bersamaan.
 */
@Injectable()
export class WhatsappHistoryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('WhatsappHistory');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: WhatsappIngestService,
    @Inject(WAHA_GATEWAY) private readonly gateway: WahaGateway | null,
  ) {}

  onApplicationBootstrap() {
    const e = env();
    // Tes mengendalikan sinkronisasi sendiri lewat runDue()/sync().
    if (!this.gateway || !e.WAHA_HISTORY_SYNC || e.NODE_ENV === 'test') return;
    this.timer = setInterval(
      () =>
        void this.runDue().catch((err) =>
          this.logger.error(`Penjadwal gagal: ${(err as Error).name}`),
        ),
      e.WAHA_HISTORY_TICK_SECONDS * 1000,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Perlu disinkronkan: belum pernah, beberapa putaran awal setelah ditautkan, lalu penyusul berkala. */
  isDue(
    row: Pick<WahaSession, 'lastStatus' | 'historySyncedAt' | 'historySyncRuns'>,
    now = Date.now(),
  ) {
    if (row.lastStatus !== 'WORKING') return false;
    if (!row.historySyncedAt) return true;
    const age = now - row.historySyncedAt.getTime();
    return (row.historySyncRuns < EARLY_RUNS && age >= EARLY_GAP_MS) || age >= CATCH_UP_MS;
  }

  /** Menyinkronkan semua nomor yang perlu, satu per satu. */
  async runDue() {
    if (!this.gateway || !env().WAHA_HISTORY_SYNC) return { synced: 0 };
    const rows = await this.prisma.wahaSession.findMany({
      where: { lastStatus: 'WORKING', user: { status: 'ACTIVE' } },
    });
    let synced = 0;
    for (const row of rows) {
      if (!this.isDue(row)) continue;
      if ((await this.sync(row.id)) !== null) synced++;
    }
    return { synced };
  }

  /** Permintaan manual dari pemilik nomor; berjalan di latar belakang. */
  async request(user: RequestUser, sessionId: string) {
    if (!this.gateway || !env().WAHA_HISTORY_SYNC)
      throw new ServiceUnavailableException('Sinkronisasi riwayat belum diaktifkan di server ini.');
    const row = await this.prisma.wahaSession.findFirst({
      where: { id: sessionId, userId: user.id },
    });
    if (!row) throw new NotFoundException('Nomor WhatsApp tidak ditemukan.');
    if (row.lastStatus !== 'WORKING')
      throw new ConflictException(
        'Nomor belum tersambung. Sinkronisasi hanya untuk nomor yang tersambung.',
      );
    const leased =
      row.historySyncStartedAt && Date.now() - row.historySyncStartedAt.getTime() < LEASE_MS;
    if (leased) return { started: false };
    void this.sync(row.id).catch((e) =>
      this.logger.error(`Sinkron manual gagal: ${(e as Error).name}`),
    );
    return { started: true };
  }

  /**
   * Satu putaran impor untuk satu nomor. `null` bila nomor sedang disinkronkan proses lain (lease dipegang).
   * Kegagalan dicatat sebagai kode pada baris sesi, bukan dilempar.
   */
  async sync(sessionId: string): Promise<(HistoryResult & { error: string | null }) | null> {
    if (!this.gateway) return null;
    const claimed = await this.prisma.wahaSession.updateMany({
      where: {
        id: sessionId,
        OR: [
          { historySyncStartedAt: null },
          { historySyncStartedAt: { lt: new Date(Date.now() - LEASE_MS) } },
        ],
      },
      data: { historySyncStartedAt: new Date() },
    });
    if (claimed.count === 0) return null;
    const row = await this.prisma.wahaSession.findUniqueOrThrow({ where: { id: sessionId } });
    let result: HistoryResult = { chats: 0, imported: 0 };
    let error: string | null = null;
    try {
      result = await this.importHistory(row, this.gateway);
    } catch (e) {
      error =
        e instanceof WahaError ? (e.code === 'http_400' ? 'store_disabled' : e.code) : 'error';
      this.logger.warn(`Impor riwayat gagal (${error})`);
    }
    await this.prisma.wahaSession.update({
      where: { id: sessionId },
      data: {
        historySyncStartedAt: null,
        historySyncedAt: new Date(),
        historySyncRuns: { increment: 1 },
        historySyncError: error,
        ...(error ? {} : { historyChats: result.chats }),
      },
    });
    return { ...result, error };
  }

  /** Nomor atau LID ke nama dari kontak ponsel; kosong bila kontak tidak tersedia (store mati). */
  private async contactNames(gw: WahaGateway, session: string) {
    const names = new Map<string, string>();
    try {
      for (const c of await gw.listContacts(session)) {
        names.set(c.phone, c.name);
        if (c.lid) names.set(c.lid, c.name);
      }
    } catch {
      /* tanpa kontak, nama tetap dari sumber lain */
    }
    return names;
  }

  private async importHistory(row: WahaSession, gw: WahaGateway): Promise<HistoryResult> {
    const e = env();
    const cutoff = Date.now() - e.WAHA_HISTORY_DAYS * 86_400_000;
    const chats = await gw.listChats(row.sessionName, e.WAHA_HISTORY_MAX_CHATS);
    const names = await this.contactNames(gw, row.sessionName);
    let chatCount = 0;
    let imported = 0;
    for (const c of chats) {
      if (!DIRECT.test(c.id)) continue;
      if (c.lastTimestamp !== null && c.lastTimestamp * 1000 < cutoff) continue;
      let raw: unknown[];
      try {
        raw = await gw.listMessages(row.sessionName, c.id, e.WAHA_HISTORY_MESSAGES_PER_CHAT);
      } catch {
        continue; // satu chat bermasalah tidak menggagalkan yang lain
      }
      const msgs = raw.flatMap((m) => {
        const r = parseWahaMessage(m, c.id);
        return r.ok && r.msg.sentAt.getTime() >= cutoff ? [r.msg] : [];
      });
      if (!msgs.length) continue;

      const chat = await this.ingest.ensureChat(
        row,
        c.id,
        msgs.find((m) => m.altJid)?.altJid ?? null,
      );
      const res = await this.prisma.whatsappMessage.createMany({
        data: msgs.map((m) => ({
          chatId: chat.id,
          externalId: m.externalId,
          direction: m.fromMe ? ('OUTBOUND' as const) : ('INBOUND' as const),
          status: m.status,
          body: m.body,
          sentAt: m.sentAt,
        })),
        skipDuplicates: true,
      });
      imported += res.count;

      const newest = msgs.reduce((a, b) => (a.sentAt >= b.sentAt ? a : b));
      const lastInbound = msgs
        .filter((m) => !m.fromMe && m.pushName)
        .sort((a, b) => +b.sentAt - +a.sentAt)[0];
      // Pesan dari store tidak membawa nama; nama tersimpan di kontak ponsel lebih baik daripada nama profil.
      const name =
        c.name ??
        names.get(chat.contactPhone ?? '') ??
        names.get(c.id.split('@')[0]) ??
        lastInbound?.pushName ??
        null;
      await this.prisma.whatsappChat.update({
        where: { id: chat.id },
        data: {
          // Riwayat tidak menambah belum dibaca dan tidak menimpa chat yang lebih baru.
          ...(!chat.lastMessageAt || chat.lastMessageAt < newest.sentAt
            ? { lastMessageAt: newest.sentAt, lastMessagePreview: previewOf(newest.body) }
            : {}),
          ...(!chat.contactName && name ? { contactName: name } : {}),
        },
      });
      chatCount++;
    }
    return { chats: chatCount, imported };
  }
}
