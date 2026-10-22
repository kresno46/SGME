import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDatabase, Session } from './utils';

describe('CRM prospek (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let op: Session;
  let admin: Session;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    op = await loginAs(app, 'MARKETING_OPERATOR');
    admin = await loginAs(app, 'SUPER_ADMIN');
  });
  afterAll(() => app.close());

  const create = (s: Session, body: object) =>
    s.agent.post('/api/leads').set('x-csrf-token', s.csrf).send(body);

  it('membuat prospek, menormalkan kontak, dan mencatat izin + aktivitas', async () => {
    const res = await create(op, {
      name: 'Budi',
      tiktokUsername: '@Budi.Trader',
      phone: '0812-3456-7890',
      source: 'TIKTOK_LEAD_GEN',
      tags: ['Webinar', 'webinar'],
      consents: [
        {
          channel: 'WHATSAPP',
          source: 'LEAD_FORM',
          evidence: 'Centang izin WA di form lead TikTok',
        },
      ],
    }).expect(201);
    expect(res.body.tiktokUsername).toBe('budi.trader');
    expect(res.body.tags).toEqual(['webinar']);
    expect(res.body.consentChannels).toEqual(['WHATSAPP']);
    expect(res.body.activities.map((a: { type: string }) => a.type)).toEqual(
      expect.arrayContaining(['CREATED', 'CONSENT_CHANGE']),
    );
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.phoneNormalized).toBe('6281234567890');
  });

  it('mendeteksi duplikat lintas format dan mengembalikan detailnya', async () => {
    const first = await create(op, {
      name: 'Ani',
      phone: '+62 812 1111 2222',
      source: 'MANUAL',
    }).expect(201);
    const dup = await create(op, {
      name: 'Ani Lagi',
      phone: '0812-1111-2222',
      source: 'MANUAL',
    }).expect(409);
    expect(dup.body.details.duplicates).toEqual([
      { id: first.body.id, name: 'Ani', matchedOn: ['phone'] },
    ]);

    const check = await op.agent.get('/api/leads/duplicates?phone=081211112222').expect(200);
    expect(check.body).toHaveLength(1);
  });

  it('prospek yang kontaknya ada di daftar larangan langsung ditandai DNC', async () => {
    await admin.agent
      .post('/api/do-not-contact')
      .set('x-csrf-token', admin.csrf)
      .send({ channel: 'EMAIL', value: 'Stop@Contoh.com', reason: 'Permintaan via email' })
      .expect(201);
    const res = await create(op, {
      email: 'stop@contoh.com',
      source: 'LANDING_PAGE',
      consents: [{ channel: 'EMAIL', source: 'LANDING_PAGE', evidence: 'Form landing page' }],
    }).expect(201);
    expect(res.body.doNotContact).toBe(true);
    expect(res.body.status).toBe('DO_NOT_CONTACT');
    expect(res.body.consentChannels).toEqual([]);
    expect(res.body.onBlocklist).toBe(true);
  });

  it('DNC: operator bisa menandai, hanya admin yang bisa mencabut; DNC tidak bisa diubah via update', async () => {
    const lead = await create(op, { tiktokUsername: 'calon_1', source: 'INBOUND_DM' }).expect(201);
    await op.agent
      .patch(`/api/leads/${lead.body.id}`)
      .set('x-csrf-token', op.csrf)
      .send({ status: 'DO_NOT_CONTACT' })
      .expect(400);
    const marked = await op.agent
      .post(`/api/leads/${lead.body.id}/do-not-contact`)
      .set('x-csrf-token', op.csrf)
      .send({ reason: 'Minta tidak dihubungi' })
      .expect(200);
    expect(marked.body.doNotContact).toBe(true);
    expect(await prisma.doNotContactEntry.count({ where: { valueNormalized: 'calon_1' } })).toBe(1);

    // Disembunyikan dari daftar default
    expect((await op.agent.get('/api/leads').expect(200)).body.total).toBe(0);
    expect((await op.agent.get('/api/leads?includeDoNotContact=true').expect(200)).body.total).toBe(
      1,
    );

    await op.agent
      .delete(`/api/leads/${lead.body.id}/do-not-contact`)
      .set('x-csrf-token', op.csrf)
      .expect(403);
    const restored = await admin.agent
      .delete(`/api/leads/${lead.body.id}/do-not-contact`)
      .set('x-csrf-token', admin.csrf)
      .expect(200);
    expect(restored.body.doNotContact).toBe(false);
    expect(restored.body.status).toBe('NEW');
  });

  it('izin komunikasi: wajib bukti, bisa dicabut, tercatat di timeline', async () => {
    const lead = await create(op, { email: 'izin@contoh.com', source: 'MANUAL' }).expect(201);
    await op.agent
      .post(`/api/leads/${lead.body.id}/consents`)
      .set('x-csrf-token', op.csrf)
      .send({ channel: 'EMAIL', source: 'CONVERSATION', evidence: '' })
      .expect(400);
    const granted = await op.agent
      .post(`/api/leads/${lead.body.id}/consents`)
      .set('x-csrf-token', op.csrf)
      .send({ channel: 'EMAIL', source: 'CONVERSATION', evidence: 'Setuju lewat chat 15/10' })
      .expect(201);
    expect(granted.body.consentChannels).toEqual(['EMAIL']);
    const withdrawn = await op.agent
      .post(`/api/leads/${lead.body.id}/consents/withdraw`)
      .set('x-csrf-token', op.csrf)
      .send({ channel: 'EMAIL', reason: 'Unsubscribe' })
      .expect(200);
    expect(withdrawn.body.consentChannels).toEqual([]);
    expect(withdrawn.body.consents[0].status).toBe('WITHDRAWN');
  });

  it('segmentasi: filter status, tag, izin, follow-up jatuh tempo, dan "prospek saya"', async () => {
    const me = await prisma.user.findFirstOrThrow({ where: { email: 'operator@test.local' } });
    await prisma.lead.createMany({
      data: [
        {
          ownerId: me.id,
          name: 'A',
          source: 'MANUAL',
          status: 'INTERESTED',
          tags: ['vip'],
          operatorId: me.id,
        },
        {
          ownerId: me.id,
          name: 'B',
          source: 'MANUAL',
          status: 'NEW',
          nextFollowUpAt: new Date(Date.now() - 3600_000),
        },
        { ownerId: me.id, name: 'C', source: 'MANUAL', status: 'QUALIFIED', tags: ['vip'] },
      ],
    });
    const byStatus = await op.agent.get('/api/leads?status=INTERESTED,QUALIFIED').expect(200);
    expect(byStatus.body.total).toBe(2);
    expect(
      (await op.agent.get('/api/leads?tag=vip&status=QUALIFIED').expect(200)).body.items[0].name,
    ).toBe('C');
    expect((await op.agent.get('/api/leads?followUp=due').expect(200)).body.items[0].name).toBe(
      'B',
    );
    expect((await op.agent.get('/api/leads?operatorId=me').expect(200)).body.items[0].name).toBe(
      'A',
    );
    expect((await op.agent.get('/api/leads?consentChannel=EMAIL').expect(200)).body.total).toBe(0);
  });

  it('perubahan status & catatan tercatat di riwayat aktivitas', async () => {
    const lead = await create(op, { tiktokUsername: 'riwayat', source: 'LIVE' }).expect(201);
    await op.agent
      .patch(`/api/leads/${lead.body.id}`)
      .set('x-csrf-token', op.csrf)
      .send({ status: 'QUALIFIED', interestLevel: 'HIGH' })
      .expect(200);
    const noted = await op.agent
      .post(`/api/leads/${lead.body.id}/notes`)
      .set('x-csrf-token', op.csrf)
      .send({ note: 'Tanya soal cara daftar' })
      .expect(201);
    const types = noted.body.activities.map((a: { type: string; summary: string }) => a.summary);
    expect(types).toEqual(
      expect.arrayContaining(['Tanya soal cara daftar', 'Status: Baru → Memenuhi syarat']),
    );
  });

  it('hapus prospek = anonimisasi data pribadi (hanya role berwenang)', async () => {
    const lead = await create(op, {
      name: 'Rahasia',
      email: 'hapus@contoh.com',
      source: 'MANUAL',
    }).expect(201);
    const viewer = await loginAs(app, 'VIEWER');
    await viewer.agent
      .delete(`/api/leads/${lead.body.id}`)
      .set('x-csrf-token', viewer.csrf)
      .expect(403);
    await admin.agent
      .delete(`/api/leads/${lead.body.id}`)
      .set('x-csrf-token', admin.csrf)
      .expect(200);
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: lead.body.id } });
    expect(row).toMatchObject({ name: null, email: null, emailNormalized: null });
    expect(row.anonymizedAt).not.toBeNull();
    expect(await prisma.leadActivity.count({ where: { leadId: lead.body.id } })).toBe(0);
    await admin.agent.get(`/api/leads/${lead.body.id}`).expect(404);
    // Email boleh didaftarkan lagi sebagai prospek baru
    await create(op, { email: 'hapus@contoh.com', source: 'MANUAL' }).expect(201);
  });

  it('export CSV & Excel hanya untuk role berwenang dan tercatat di audit', async () => {
    await create(op, { name: 'Ekspor', tiktokUsername: 'ekspor_1', source: 'MANUAL' }).expect(201);
    await op.agent.get('/api/leads/export').expect(200);

    const csv = await admin.agent.get('/api/leads/export?format=csv').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain('@ekspor_1');

    const xlsx = await admin.agent
      .get('/api/leads/export?format=xlsx')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as Buffer);
    expect(wb.getWorksheet('Prospek')!.getRow(2).getCell(2).value).toBe('Ekspor');
    expect(await prisma.auditLog.count({ where: { action: 'lead.exported' } })).toBe(3);
  });

  describe('import CSV', () => {
    const csv = [
      'nama;tiktok_username;email;no_hp;tags;izin_whatsapp',
      'Citra;@citra_01;;0813-0000-1111;webinar;ya',
      'Dodi;dodi_02;dodi@contoh.com;;;',
      'Duplikat file;citra_01;;;;',
      'Tidak valid;nama dengan spasi;;;;',
      'Sudah ada;;lama@contoh.com;;;',
      'Diblokir;;;0899-9999-0000;;',
    ].join('\n');
    const file = () => Buffer.from(csv, 'utf8');

    beforeEach(async () => {
      await prisma.lead.create({
        data: {
          name: 'Lama',
          email: 'lama@contoh.com',
          emailNormalized: 'lama@contoh.com',
          source: 'MANUAL',
        },
      });
      await prisma.doNotContactEntry.create({
        data: { channel: 'PHONE', valueNormalized: '6289999990000' },
      });
    });

    it('pratinjau mengklasifikasi baris baru, duplikat, diblokir, dan tidak valid', async () => {
      const res = await admin.agent
        .post('/api/leads/import/preview')
        .set('x-csrf-token', admin.csrf)
        .attach('file', file(), 'prospek.csv')
        .expect(200);
      expect(res.body).toMatchObject({
        totalRows: 6,
        validRows: 5,
        newLeads: 2,
        duplicates: 2,
        blocked: 1,
      });
      expect(res.body.invalid).toEqual([{ row: 5, message: 'username TikTok tidak valid' }]);
      expect(await prisma.lead.count()).toBe(1); // pratinjau tidak menyimpan apa pun
    });

    it('commit wajib menyatakan dasar hukum data dan hanya untuk role berwenang', async () => {
      await op.agent
        .post('/api/leads/import')
        .set('x-csrf-token', op.csrf)
        .attach('file', file(), 'p.csv')
        .expect(400);
      const noBasis = await admin.agent
        .post('/api/leads/import')
        .set('x-csrf-token', admin.csrf)
        .field('sourceDescription', 'Form pendaftaran webinar 10 Oktober')
        .attach('file', file(), 'p.csv')
        .expect(400);
      expect(noBasis.body.errors.lawfulBasisConfirmed).toBeDefined();
    });

    it('commit membuat prospek baru beserta izin, melewati duplikat & yang diblokir', async () => {
      const res = await admin.agent
        .post('/api/leads/import')
        .set('x-csrf-token', admin.csrf)
        .field('sourceDescription', 'Form pendaftaran webinar 10 Oktober')
        .field('lawfulBasisConfirmed', 'true')
        .field('tags', 'import-okt')
        .field('duplicateStrategy', 'update_empty')
        .attach('file', file(), 'p.csv')
        .expect(200);
      expect(res.body).toEqual({ created: 2, updated: 1, skipped: 1, blocked: 1, invalid: 1 });

      const citra = await prisma.lead.findFirstOrThrow({
        where: { tiktokUsernameNormalized: 'citra_01' },
        include: { consents: true },
      });
      expect(citra.source).toBe('IMPORT');
      expect(citra.tags).toEqual(['import-okt', 'webinar']);
      expect(citra.consents.map((c) => [c.channel, c.evidence])).toEqual([
        ['WHATSAPP', 'Import: Form pendaftaran webinar 10 Oktober'],
      ]);
      const lama = await prisma.lead.findFirstOrThrow({
        where: { emailNormalized: 'lama@contoh.com' },
      });
      expect(lama.tags).toEqual(['import-okt']); // dilengkapi, data lama tidak ditimpa
      expect(lama.name).toBe('Lama');
    });

    it('menolak file tanpa kolom kontak', async () => {
      const res = await admin.agent
        .post('/api/leads/import/preview')
        .set('x-csrf-token', admin.csrf)
        .attach('file', Buffer.from('nama,kota\nA,Jakarta'), 'x.csv')
        .expect(400);
      expect(res.body.message).toMatch(/Kolom kontak tidak ditemukan/);
    });
  });
});
