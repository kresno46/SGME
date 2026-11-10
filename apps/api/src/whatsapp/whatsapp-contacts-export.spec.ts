import { BadGatewayException, ConflictException, NotFoundException } from '@nestjs/common';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { WahaError } from './waha-gateway';
import { WhatsappChatService } from './whatsapp-chat.service';

const user = { id: 'u1' } as RequestUser;
const meta = { ipAddress: null, userAgent: null };

function setup(opts: { owned?: boolean; contacts?: unknown[] | Error }) {
  const gw = {
    getSession: jest.fn().mockResolvedValue({ status: 'WORKING', meId: null }),
    listContacts: jest.fn(async () => {
      if (opts.contacts instanceof Error) throw opts.contacts;
      return opts.contacts ?? [];
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
  const svc = new WhatsappChatService(prisma as never, audit as never, gw as never);
  return { svc, audit };
}

describe('WhatsappChatService.exportContacts', () => {
  it('hanya kontak tersimpan, urut nama, rumus dinetralkan, dengan BOM dan header yang bisa diimpor ulang', async () => {
    const { svc } = setup({
      contacts: [
        { phone: '6281000000009', name: 'Zaki', saved: true },
        { phone: '6281000000008', name: '=HYPERLINK("http://x")', saved: true },
        { phone: '6281000000007', name: 'Hanya nama profil', saved: false },
        { phone: '6281000000006', name: 'andi', saved: true },
      ],
    });
    const csv = await svc.exportContacts(user, 's1', meta);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.replace('﻿', '').trim().split('\n')).toEqual([
      'Nama,Nomor',
      `"'=HYPERLINK(""http://x"")",6281000000008`,
      'andi,6281000000006',
      'Zaki,6281000000009',
    ]);
  });

  it('audit hanya mencatat jumlah kontak, tanpa nama atau nomor', async () => {
    const { svc, audit } = setup({
      contacts: [{ phone: '6281000000009', name: 'Zaki', saved: true }],
    });
    await svc.exportContacts(user, 's1', meta);
    const entry = audit.log.mock.calls[0][0];
    expect(entry).toMatchObject({ action: 'whatsapp.contacts.export', metadata: { contacts: 1 } });
    expect(JSON.stringify(entry)).not.toMatch(/Zaki|6281000000009/);
  });

  it('409 bila kontak belum tersinkron, 502 bila WAHA bermasalah, 404 bila bukan nomor sendiri', async () => {
    await expect(
      setup({ contacts: new WahaError('http_400') }).svc.exportContacts(user, 's1', meta),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup({ contacts: new WahaError('http_500') }).svc.exportContacts(user, 's1', meta),
    ).rejects.toBeInstanceOf(BadGatewayException);
    await expect(
      setup({ owned: false }).svc.exportContacts(user, 's1', meta),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
