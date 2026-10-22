import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDatabase, Session } from './utils';

describe('Campaign (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let official: string;
  let outbound: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    admin = await loginAs(app, 'SUPER_ADMIN');
    official = (
      await prisma.tikTokAccount.create({
        data: { username: 'resmi', displayName: 'Resmi', lane: 'OFFICIAL' },
      })
    ).id;
    outbound = (
      await prisma.tikTokAccount.create({
        data: { username: 'luar', displayName: 'Luar', lane: 'OUTBOUND' },
      })
    ).id;
  });
  afterAll(() => app.close());

  const post = (body: object) =>
    admin.agent.post('/api/campaigns').set('x-csrf-token', admin.csrf).send(body);

  it('membuat campaign dengan kode tracking unik dan akun sejalur', async () => {
    const res = await post({
      name: 'Registrasi Oktober',
      lane: 'OFFICIAL',
      type: 'REGISTRATION',
      budget: '5000000',
      accountIds: [official],
    }).expect(201);
    expect(res.body.trackingCode).toMatch(/^registrasi-oktober-[0-9a-f]{6}$/);
    expect(res.body.accounts.map((a: { username: string }) => a.username)).toEqual(['resmi']);
    expect(res.body.budget).toBe('5000000');
    expect(res.body.status).toBe('DRAFT');
  });

  it('menolak akun dari jalur berbeda dan status aktif tanpa tanggal mulai', async () => {
    const lane = await post({
      name: 'Salah Jalur',
      lane: 'OFFICIAL',
      type: 'ENGAGEMENT',
      accountIds: [outbound],
    }).expect(400);
    expect(lane.body.errors.accountIds).toBeDefined();
    const status = await post({
      name: 'Aktif Tanpa Tanggal',
      lane: 'OUTBOUND',
      type: 'ENGAGEMENT',
      status: 'ACTIVE',
    }).expect(400);
    expect(status.body.errors.startDate).toBeDefined();
  });

  it('statistik campaign menghitung prospek dan biaya per lead (tanpa data simulasi)', async () => {
    const c = await post({
      name: 'Akuisisi',
      lane: 'OUTBOUND',
      type: 'LEAD_ACQUISITION',
      spend: 300000,
      accountIds: [outbound],
    }).expect(201);
    await prisma.lead.createMany({
      data: [
        { name: 'A', source: 'MANUAL', sourceCampaignId: c.body.id, status: 'INTERESTED' },
        { name: 'B', source: 'MANUAL', sourceCampaignId: c.body.id, status: 'REGISTERED' },
        { name: 'C', source: 'MANUAL', sourceCampaignId: c.body.id },
        { name: 'Sim', source: 'MANUAL', sourceCampaignId: c.body.id, dataSource: 'SIMULATED' },
      ],
    });
    const res = await admin.agent.get(`/api/campaigns/${c.body.id}`).expect(200);
    expect(res.body.stats).toEqual({
      leads: 3,
      interestedLeads: 1,
      registeredLeads: 1,
      registrationsVerified: 0,
      outreachTasks: 0,
      costPerLead: 100000,
    });
  });

  it('update, filter, dan arsip; campaign berisi prospek tidak dapat dihapus', async () => {
    const c = await post({ name: 'Brand', lane: 'OFFICIAL', type: 'BRAND_AWARENESS' }).expect(201);
    await admin.agent
      .patch(`/api/campaigns/${c.body.id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ status: 'ACTIVE', startDate: '2026-10-01', accountIds: [official] })
      .expect(200);
    const active = await admin.agent.get('/api/campaigns?status=ACTIVE&lane=OFFICIAL').expect(200);
    expect(active.body.total).toBe(1);
    expect(active.body.items[0].accounts).toHaveLength(1);

    await prisma.lead.create({
      data: { name: 'X', source: 'MANUAL', sourceCampaignId: c.body.id },
    });
    await admin.agent
      .delete(`/api/campaigns/${c.body.id}`)
      .set('x-csrf-token', admin.csrf)
      .expect(409);
    await admin.agent
      .patch(`/api/campaigns/${c.body.id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    const list = await admin.agent.get('/api/campaigns').expect(200);
    expect(list.body.total).toBe(0); // arsip disembunyikan secara default
  });

  it('Marketing Operator tidak mengakses campaign global', async () => {
    const op = await loginAs(app, 'MARKETING_OPERATOR');
    await op.agent.get('/api/campaigns').expect(403);
    await op.agent
      .post('/api/campaigns')
      .set('x-csrf-token', op.csrf)
      .send({ name: 'Tidak Boleh', lane: 'OFFICIAL', type: 'ENGAGEMENT' })
      .expect(403);
  });
});
