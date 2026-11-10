import { createHmac, randomBytes } from 'node:crypto';
import { resetEnvCache } from '../config/env';
import { DncService } from '../leads/dnc.service';
import { deriveWebhookSecret } from './waha-signature';
import { WhatsappIngestService } from './whatsapp-ingest.service';

const MASTER = randomBytes(32).toString('hex');
const SESSION = 'u-0123456789abcdef0123456789abcdef-aabbccdd';
const PHONE = '6281234567890';

describe('DncService.addFromOptOut', () => {
  function setup(opts: { created: number; leads?: string[] }) {
    const tx = {
      doNotContactEntry: { createMany: jest.fn().mockResolvedValue({ count: opts.created }) },
      lead: { findMany: jest.fn().mockResolvedValue((opts.leads ?? []).map((id) => ({ id }))) },
    };
    const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    const audit = { log: jest.fn() };
    const svc = new DncService(prisma as never, {} as never, audit as never);
    const apply = jest.spyOn(svc, 'applyToLead').mockResolvedValue(undefined);
    return { svc, tx, audit, apply };
  }

  it('membuat entri PHONE, menandai prospek yang cocok, dan audit tanpa nomor', async () => {
    const { svc, tx, audit, apply } = setup({ created: 1, leads: ['l1', 'l2'] });
    expect(await svc.addFromOptOut('owner1', '0812-3456-7890', 'WhatsApp')).toBe(true);

    expect(tx.doNotContactEntry.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ channel: 'PHONE', valueNormalized: PHONE })],
      skipDuplicates: true,
    });
    // Tanpa cakupan pemilik: prospek milik siapa pun yang cocok ikut ditandai, hanya yang belum DNC.
    expect(tx.lead.findMany).toHaveBeenCalledWith({
      where: { phoneNormalized: PHONE, doNotContact: false },
      select: { id: true },
    });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith(tx, 'l1', null, expect.stringContaining('WhatsApp'));
    const entry = audit.log.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'dnc.added_by_opt_out',
      metadata: { affectedLeads: 2 },
    });
    expect(JSON.stringify(entry)).not.toContain(PHONE);
  });

  it('idempoten: entri yang sudah ada tidak menyentuh prospek maupun audit', async () => {
    const { svc, tx, audit, apply } = setup({ created: 0 });
    expect(await svc.addFromOptOut('owner1', PHONE, 'WhatsApp')).toBe(false);
    expect(tx.lead.findMany).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('mengabaikan nomor yang tidak bisa dinormalkan', async () => {
    const { svc, tx } = setup({ created: 1 });
    expect(await svc.addFromOptOut('owner1', 'abc', 'WhatsApp')).toBe(false);
    expect(tx.doNotContactEntry.createMany).not.toHaveBeenCalled();
  });
});

describe('webhook WhatsApp: permintaan berhenti', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = {
      ...saved,
      WAHA_ENABLED: 'true',
      WAHA_BASE_URL: 'http://waha:3000',
      WAHA_API_KEY: 'k'.repeat(16),
      WAHA_PUBLIC_WEBHOOK_BASE_URL: 'http://api:4000/api/webhooks/waha',
      WAHA_WEBHOOK_MASTER_SECRET: MASTER,
    } as NodeJS.ProcessEnv;
    resetEnvCache();
  });
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });

  function setup(addFromOptOut = jest.fn().mockResolvedValue(true)) {
    const prisma = {
      wahaSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1',
          userId: 'owner1',
          sessionName: SESSION,
          user: { status: 'ACTIVE' },
        }),
      },
      whatsappChat: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'c1', contactPhone: PHONE, lastMessageAt: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      whatsappMessage: { create: jest.fn().mockResolvedValue({}) },
    };
    const svc = new WhatsappIngestService(
      prisma as never,
      {} as never,
      { addFromOptOut } as never,
      {} as never,
    );
    const send = (body: string, over: { fromMe?: boolean; ageMs?: number } = {}) => {
      const fromMe = over.fromMe ?? false;
      const raw = Buffer.from(
        JSON.stringify({
          event: 'message',
          session: SESSION,
          payload: {
            id: `${fromMe}_${PHONE}@c.us_ABC${Math.random().toString(16).slice(2)}`,
            timestamp: Math.floor((Date.now() - (over.ageMs ?? 0)) / 1000),
            from: fromMe ? 'saya@c.us' : `${PHONE}@c.us`,
            to: fromMe ? `${PHONE}@c.us` : 'saya@c.us',
            fromMe,
            body,
          },
        }),
      );
      const sig = createHmac('sha512', deriveWebhookSecret(MASTER, SESSION))
        .update(raw)
        .digest('hex');
      return svc.handle(SESSION, raw, sig);
    };
    return { prisma, addFromOptOut, send };
  }

  it('"STOP" dari pelanggan masuk daftar larangan sebelum pesan disimpan', async () => {
    const { prisma, addFromOptOut, send } = setup();
    expect(await send('STOP')).toMatchObject({ ok: true, status: 'created' });
    expect(addFromOptOut).toHaveBeenCalledWith('owner1', PHONE, 'WhatsApp');
    expect(addFromOptOut.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.whatsappMessage.create.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ['frasa ambigu', 'cukup', {}],
    ['pesan biasa', 'kapan stop loss?', {}],
    ['pesan dari pemilik nomor sendiri', 'stop', { fromMe: true }],
    ['pesan lama (diputar ulang)', 'stop', { ageMs: 2 * 24 * 3600_000 }],
  ])('tidak memasukkan ke larangan: %s', async (_name, body, over) => {
    const { addFromOptOut, send } = setup();
    await send(body, over);
    expect(addFromOptOut).not.toHaveBeenCalled();
  });

  it('gagal mencatat larangan: webhook gagal dan pesan tidak disimpan, supaya WAHA mengulang', async () => {
    const { prisma, send } = setup(jest.fn().mockRejectedValue(new Error('db down')));
    await expect(send('stop')).rejects.toThrow('db down');
    expect(prisma.whatsappMessage.create).not.toHaveBeenCalled();
  });
});
