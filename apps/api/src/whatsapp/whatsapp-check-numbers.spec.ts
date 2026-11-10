import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { WahaError } from './waha-gateway';
import { WhatsappChatService } from './whatsapp-chat.service';

const user = { id: 'u1' } as RequestUser;
const meta = { ipAddress: null, userAgent: null };

class TestService extends WhatsappChatService {
  pauses = 0;
  protected override pauseBetweenChecks() {
    this.pauses++;
    return Promise.resolve();
  }
}

function setup(opts: {
  owned?: boolean;
  status?: string;
  exists?: (p: string) => boolean | Error;
}) {
  const exists = opts.exists ?? (() => true);
  const gw = {
    getSession: jest.fn().mockResolvedValue({ status: opts.status ?? 'WORKING', meId: null }),
    checkNumber: jest.fn(async (_s: string, phone: string) => {
      const r = exists(phone);
      if (r instanceof Error) throw r;
      return { exists: r, chatId: null };
    }),
  };
  const prisma = {
    wahaSession: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.owned === false ? null : { id: 's1', sessionName: 'u-1' }),
    },
  };
  const audit = { log: jest.fn() };
  const svc = new TestService(prisma as never, audit as never, gw as never);
  return { svc, gw, audit, prisma };
}

describe('WhatsappChatService.checkNumbers', () => {
  it('menandai terdaftar dan tidak, menormalkan, dan mendedupe nomor', async () => {
    const { svc, gw } = setup({ exists: (p) => p !== '6281300000000' });
    const r = await svc.checkNumbers(
      user,
      's1',
      ['0811-1111-1111', '+62 811 1111 1111', '081300000000'],
      meta,
    );
    expect(r.results).toEqual([
      { phone: '6281111111111', status: 'registered' },
      { phone: '6281300000000', status: 'not_registered' },
    ]);
    expect(gw.checkNumber).toHaveBeenCalledTimes(2);
    expect(svc.pauses).toBe(1); // jeda antar nomor, bukan sebelum yang pertama
  });

  it('berhenti saat WAHA gagal: sisanya unchecked dan tidak dipanggil lagi', async () => {
    const { svc, gw } = setup({
      exists: (p) => (p === '6281222222222' ? new WahaError('http_500') : true),
    });
    const r = await svc.checkNumbers(
      user,
      's1',
      ['081111111111', '081222222222', '081333333333'],
      meta,
    );
    expect(r.results.map((x) => x.status)).toEqual(['registered', 'unchecked', 'unchecked']);
    expect(gw.checkNumber).toHaveBeenCalledTimes(2);
  });

  it('audit hanya mencatat jumlah, tanpa nomor', async () => {
    const { svc, audit } = setup({ exists: (p) => p.endsWith('1') });
    await svc.checkNumbers(user, 's1', ['081111111111', '081222222222'], meta);
    const entry = audit.log.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'whatsapp.numbers.check',
      entityId: 's1',
      metadata: { checked: 2, notRegistered: 1, unchecked: 0 },
    });
    expect(JSON.stringify(entry)).not.toMatch(/62811|62812/);
  });

  it('menolak nomor tidak valid, nomor milik orang lain, dan nomor yang belum tersambung', async () => {
    await expect(
      setup({}).svc.checkNumbers(user, 's1', ['081111111111', '1234'], meta),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup({ owned: false }).svc.checkNumbers(user, 's1', ['081111111111'], meta),
    ).rejects.toBeInstanceOf(NotFoundException);
    const { svc, gw } = setup({ status: 'SCAN_QR_CODE' });
    await expect(svc.checkNumbers(user, 's1', ['081111111111'], meta)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(gw.checkNumber).not.toHaveBeenCalled();
  });
});
