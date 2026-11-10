import { NotFoundException } from '@nestjs/common';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { WhatsappBroadcastService } from './whatsapp-broadcast.service';

const user = { id: 'u1' } as RequestUser;
const meta = { ipAddress: null, userAgent: null };

function setup(found: boolean) {
  const at = new Date('2026-11-09T03:00:00Z');
  const broadcast = {
    id: 'b1',
    name: 'Promo',
    message: 'rahasia pesan',
    status: 'DONE',
    pauseReason: null,
    sessionId: 's1',
    consecutiveFailures: 0,
    nextSendAt: null,
    createdAt: at,
    finishedAt: at,
    session: { label: 'CS 1' },
    recipients: [
      {
        id: 'r1',
        phone: '6281234567890',
        name: 'Budi',
        status: 'SENT',
        reason: null,
        chatId: 'c1',
        sentAt: at,
      },
      {
        id: 'r2',
        phone: '6281300000000',
        name: '=HYPERLINK("http://x")',
        status: 'SKIPPED',
        reason: 'opt_out',
        chatId: null,
        sentAt: null,
      },
      {
        id: 'r3',
        phone: '6281400000000',
        name: null,
        status: 'FAILED',
        reason: 'send_failed:timeout',
        chatId: null,
        sentAt: null,
      },
    ],
  };
  const audit = { log: jest.fn() };
  const prisma = {
    whatsappBroadcast: { findFirst: jest.fn().mockResolvedValue(found ? broadcast : null) },
    whatsappBroadcastRecipient: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  const svc = new WhatsappBroadcastService(prisma as never, {} as never, audit as never);
  return { svc, audit, prisma };
}

describe('WhatsappBroadcastService.exportCsv', () => {
  it('membuat CSV berbahasa Indonesia, menetralkan rumus, dan audit tanpa nomor', async () => {
    const { svc, audit } = setup(true);
    const csv = await svc.exportCsv(user, 'b1', meta);
    const lines = csv.replace('﻿', '').trim().split('\n');

    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('Nomor,Nama,Status,Keterangan,Waktu kirim (WIB)');
    expect(lines[1]).toMatch(/^6281234567890,Budi,Terkirim,,.+/);
    // Nama dari file pengguna: diawali rumus harus diberi kutip agar Excel tidak menjalankannya.
    expect(lines[2]).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(lines[2]).toContain('Dilewati,Pernah minta berhenti');
    expect(lines[3]).toContain('Gagal,"Waktu habis, status tidak pasti');

    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'whatsapp.broadcast.export',
      entityId: 'b1',
      metadata: { recipients: 3 },
    });
    expect(JSON.stringify(entry)).not.toMatch(/6281234567890|rahasia pesan/);
  });

  it('404 untuk pengiriman milik orang lain dan tidak mencatat audit', async () => {
    const { svc, audit, prisma } = setup(false);
    await expect(svc.exportCsv(user, 'b1', meta)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.whatsappBroadcast.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1', ownerId: 'u1' } }),
    );
    expect(audit.log).not.toHaveBeenCalled();
  });
});
