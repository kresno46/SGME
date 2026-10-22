import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDatabase, type Session } from './utils';

describe('Follower browser import (HTTP + database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let accountId: string;
  const batch = () => ({
    format: 'smge-followers-v1',
    accountUsername: '@solid.mini',
    collectedAt: '2026-10-19T10:00:00.000Z',
    stopReason: 'Operator berhenti',
    followers: [{ username: '@Calon_1', displayName: 'Calon' }, { username: 'calon_1' }],
  });
  const upload = (session: Session, data = batch()) =>
    session.agent
      .post('/api/outbound/followers/import')
      .set('x-csrf-token', session.csrf)
      .send({ accountId, batch: data });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    admin = await loginAs(app, 'SUPER_ADMIN');
    const account = await prisma.tikTokAccount.create({
      data: {
        ownerId: (await prisma.user.findUniqueOrThrow({ where: { email: 'super@test.local' } })).id,
        username: 'solid.mini',
        displayName: 'Solid Mini',
        lane: 'OUTBOUND',
      },
    });
    accountId = account.id;
  });
  afterAll(() => app.close());

  it('stores normalized leads and provenance atomically, without consent; repeated upload creates no duplicates', async () => {
    const result = await upload(admin).expect(201);
    expect(result.body).toMatchObject({ received: 2, duplicateRows: 1, created: 1 });
    const saved = await prisma.lead.findFirstOrThrow({
      where: { tiktokUsernameNormalized: 'calon_1' },
      include: { activities: true, consents: true },
    });
    expect(saved.sourceAccountId).toBe(accountId);
    expect(saved.tags).toEqual(['tiktok-followers', 'browser-collected']);
    expect(saved.activities).toHaveLength(1);
    expect(saved.consents).toHaveLength(0);
    expect(saved.notes).toContain('bukan hasil verifikasi API');
    expect((await upload(admin).expect(201)).body).toMatchObject({ created: 0, existing: 1 });
    const queue = await admin.agent
      .get(`/api/outbound/queue?accountId=${accountId}&channel=TIKTOK_DM`)
      .expect(200);
    expect(queue.body.items.map((row: { lead: { id: string } }) => row.lead.id)).toContain(
      saved.id,
    );
    expect(await prisma.auditLog.count({ where: { action: 'lead.followers_imported' } })).toBe(2);
  });

  it('deduplicates concurrent uploads at the database boundary', async () => {
    const results = await Promise.all([upload(admin).expect(201), upload(admin).expect(201)]);
    expect(results.reduce((sum, result) => sum + result.body.created, 0)).toBe(1);
    expect(await prisma.lead.count()).toBe(1);
    expect(await prisma.leadActivity.count({ where: { type: 'IMPORT' } })).toBe(1);
  });

  it('rejects malformed data, another source account, and an inactive source without writes', async () => {
    const wrong = batch();
    wrong.accountUsername = 'akun_lain';
    await upload(admin, wrong).expect(400);
    const invalid = batch();
    invalid.followers[0].username = 'https://evil.test';
    await upload(admin, invalid).expect(400);
    await prisma.tikTokAccount.update({ where: { id: accountId }, data: { status: 'PAUSED' } });
    await upload(admin).expect(400);
    expect(await prisma.lead.count()).toBe(0);
  });

  it('enforces import permission, authenticated session, and CSRF', async () => {
    const operator = await loginAs(app, 'MARKETING_OPERATOR');
    const viewer = await loginAs(app, 'VIEWER');
    await upload(viewer).expect(403);
    await upload(operator).expect(404);
    await admin.agent
      .post('/api/outbound/followers/import')
      .send({ accountId, batch: batch() })
      .expect(403);
    await admin.agent.post('/api/auth/logout').set('x-csrf-token', admin.csrf).send().expect(200);
    await upload(admin).expect(401);
    expect(await prisma.lead.count()).toBe(0);
  });

  it('never restores a deleted username or imports identities on the DNC list', async () => {
    await prisma.lead.create({
      data: {
        tiktokUsername: 'calon_1',
        ownerId: (await prisma.user.findUniqueOrThrow({ where: { email: 'super@test.local' } })).id,
        tiktokUsernameNormalized: 'calon_1',
        source: 'MANUAL',
        deletedAt: new Date(),
        tags: [],
      },
    });
    await prisma.doNotContactEntry.create({
      data: { channel: 'TIKTOK_DM', valueNormalized: 'blokir_1', reason: 'Permintaan berhenti' },
    });
    const data = batch();
    data.followers.push({ username: 'blokir_1' });
    expect((await upload(admin, data).expect(201)).body).toMatchObject({
      created: 0,
      existing: 1,
      blocked: 1,
    });
    expect(await prisma.lead.count()).toBe(1);
    expect((await prisma.lead.findFirstOrThrow()).deletedAt).not.toBeNull();
  });
});
