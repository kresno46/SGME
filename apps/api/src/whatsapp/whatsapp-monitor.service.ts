import { Inject, Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { WAHA_GATEWAY, WahaError, type WahaGateway } from './waha-gateway';
import { WhatsappSessionService } from './whatsapp-session.service';

/**
 * Pemantauan berkala (worker): membaca status semua sesi dari WAHA dalam satu panggilan untuk mendeteksi nomor
 * yang terputus tanpa disengaja, dan menandai pesan keluar yang macet di "mengirim" sebagai gagal.
 */
@Injectable()
export class WhatsappMonitorService {
  private readonly logger = new Logger('WhatsappMonitor');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: WhatsappSessionService,
    @Inject(WAHA_GATEWAY) private readonly gateway: WahaGateway | null,
  ) {}

  async run() {
    if (!this.gateway) return { sessions: 0, stuck: 0, abandoned: 0 };
    const rows = await this.prisma.wahaSession.findMany();
    let checked = 0;
    if (rows.length) {
      try {
        const bulk = await this.gateway.listSessions();
        for (const row of rows) {
          await this.sessions.recordStatus(
            row,
            bulk.get(row.sessionName)?.status ?? 'STOPPED',
            false,
          );
          checked++;
        }
      } catch (e) {
        // WAHA mati bukan berarti nomor terputus: status tidak diketahui, jadi tidak dicatat.
        if (!(e instanceof WahaError)) throw e;
        this.logger.warn(`WAHA tidak dapat dibaca (${e.code}); pemeriksaan status dilewati.`);
      }
    }
    const cutoff = new Date(Date.now() - env().WAHA_SEND_STUCK_SECONDS * 1000);
    const stuck = await this.prisma.whatsappMessage.updateMany({
      where: { status: 'SENDING', createdAt: { lt: cutoff } },
      data: { status: 'FAILED', failureReason: 'stuck' },
    });
    // Chat yang dimulai dari SMGE tetapi tidak pernah dikirimi pesan dibersihkan setelah sehari.
    const abandoned = await this.prisma.whatsappChat.deleteMany({
      where: {
        initiatedAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) },
        messages: { none: {} },
      },
    });
    return { sessions: checked, stuck: stuck.count, abandoned: abandoned.count };
  }
}
