import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDatabase, Session } from './utils';

describe('Akun TikTok, analitik & health (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    admin = await loginAs(app, 'ADMIN');
  });
  afterAll(() => app.close());

  const create = (body: Record<string, unknown>) =>
    admin.agent.post('/api/tiktok-accounts').set('x-csrf-token', admin.csrf).send(body);

  it('CRUD akun TikTok lengkap dengan audit log', async () => {
    const created = await create({
      username: '@Solid.Mini.Official',
      displayName: 'Solid Mini',
      lane: 'OFFICIAL',
      isVerified: true,
      followersCount: 250000,
      accountType: 'BUSINESS',
      profileUrl: 'https://www.tiktok.com/@solid.mini.official',
    }).expect(201);
    expect(created.body.username).toBe('solid.mini.official');
    expect(created.body.followersSource).toBe('MANUAL');
    expect(created.body.integrationStatus).toBe('NOT_CONNECTED');

    const id = created.body.id;
    const updated = await admin.agent
      .patch(`/api/tiktok-accounts/${id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ followersCount: 260000, status: 'PAUSED' })
      .expect(200);
    expect(updated.body.followersCount).toBe(260000);
    expect(updated.body.status).toBe('PAUSED');

    await admin.agent.get(`/api/tiktok-accounts/${id}`).expect(200);
    await admin.agent
      .delete(`/api/tiktok-accounts/${id}`)
      .set('x-csrf-token', admin.csrf)
      .expect(200);
    await admin.agent.get(`/api/tiktok-accounts/${id}`).expect(404);

    const actions = (
      await prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: 'asc' } })
    ).map((a) => a.action);
    expect(actions).toEqual([
      'tiktok_account.created',
      'tiktok_account.updated',
      'tiktok_account.deleted',
    ]);
  });

  it('menolak username duplikat (case-insensitive, dengan/tanpa @)', async () => {
    await create({ username: 'akun_satu', displayName: 'A', lane: 'OUTBOUND' }).expect(201);
    const dup = await create({ username: '@AKUN_SATU', displayName: 'B', lane: 'OUTBOUND' }).expect(
      409,
    );
    expect(dup.body.message).toMatch(/sudah terdaftar/);
  });

  it('daftar mendukung pencarian, filter jalur, sorting, dan pagination', async () => {
    for (let i = 1; i <= 5; i++) {
      await create({
        username: `outbound_${i}`,
        displayName: `Outbound ${i}`,
        lane: 'OUTBOUND',
        followersCount: i * 1000,
      }).expect(201);
    }
    await create({
      username: 'official_x',
      displayName: 'Official X',
      lane: 'OFFICIAL',
      followersCount: 99,
    }).expect(201);

    const page = await admin.agent
      .get('/api/tiktok-accounts?lane=OUTBOUND&pageSize=2&page=2')
      .expect(200);
    expect(page.body.total).toBe(5);
    expect(page.body.totalPages).toBe(3);
    expect(page.body.items.map((a: { username: string }) => a.username)).toEqual([
      'outbound_3',
      'outbound_2',
    ]);

    const search = await admin.agent.get('/api/tiktok-accounts?search=@official').expect(200);
    expect(search.body.items).toHaveLength(1);

    await admin.agent.get('/api/tiktok-accounts?lane=INVALID').expect(400);
  });

  it('tidak pernah mengirim token integrasi ke klien', async () => {
    const acc = await create({
      username: 'akun_token',
      displayName: 'Token',
      lane: 'OFFICIAL',
    }).expect(201);
    const crypto = app.get(CryptoService);
    await prisma.accountIntegration.create({
      data: {
        tiktokAccountId: acc.body.id,
        provider: 'MOCK',
        status: 'CONNECTED',
        isSimulation: true,
        accessTokenEncrypted: crypto.encrypt('access-token-rahasia'),
        refreshTokenEncrypted: crypto.encrypt('refresh-token-rahasia'),
      },
    });
    const res = await admin.agent.get(`/api/tiktok-accounts/${acc.body.id}`).expect(200);
    expect(res.body.integrationStatus).toBe('CONNECTED');
    expect(res.body.integrations[0].isSimulation).toBe(true);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/accessToken|refreshToken|rahasia/);
  });

  it('menolak penghapusan akun yang memiliki riwayat outbound', async () => {
    const acc = await create({
      username: 'akun_riwayat',
      displayName: 'R',
      lane: 'OUTBOUND',
    }).expect(201);
    const lead = await prisma.lead.create({ data: { name: 'Prospek', source: 'MANUAL' } });
    await prisma.outreachTask.create({ data: { leadId: lead.id, tiktokAccountId: acc.body.id } });
    const res = await admin.agent
      .delete(`/api/tiktok-accounts/${acc.body.id}`)
      .set('x-csrf-token', admin.csrf)
      .expect(409);
    expect(res.body.message).toMatch(/Diarsipkan/);
  });

  it('overview memisahkan followers aktual/manual dari data simulasi', async () => {
    await create({
      username: 'manual_a',
      displayName: 'A',
      lane: 'OFFICIAL',
      followersCount: 1000,
    }).expect(201);
    await create({
      username: 'manual_b',
      displayName: 'B',
      lane: 'OUTBOUND',
      followersCount: 500,
    }).expect(201);
    await prisma.tikTokAccount.create({
      data: {
        username: 'simulasi',
        displayName: 'Sim',
        lane: 'OUTBOUND',
        followersCount: 9999,
        followersSource: 'SIMULATED',
      },
    });

    const res = await admin.agent.get('/api/analytics/overview').expect(200);
    expect(res.body.accounts.total).toBe(3);
    expect(res.body.accounts.totalFollowers).toBe(1500);
    expect(res.body.accounts.followersBySource).toEqual({
      ACTUAL: 0,
      MANUAL: 1500,
      SIMULATED: 9999,
    });
    const outbound = res.body.accounts.byLane.find((l: { lane: string }) => l.lane === 'OUTBOUND');
    expect(outbound).toEqual({
      lane: 'OUTBOUND',
      accounts: 2,
      followers: 500,
      simulatedFollowers: 9999,
    });
    expect(res.body.metrics.registrations).toEqual({ value: null, source: null });
  });

  it('health check publik melaporkan status database', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.checks.database.status).toBe('up');
  });
});
