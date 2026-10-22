import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDatabase, TEST_PASSWORD, type Session } from './utils';

describe('Marketing data ownership (real HTTP, no live TikTok sends)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let a: Session;
  let b: Session;
  let root: Session;
  let accountA: string;
  let accountB: string;
  let leadA: string;
  let leadB: string;
  const post = (s: Session, path: string, body: object) =>
    s.agent
      .post('/api' + path)
      .set('x-csrf-token', s.csrf)
      .send(body);
  const patch = (s: Session, path: string, body: object) =>
    s.agent
      .patch('/api' + path)
      .set('x-csrf-token', s.csrf)
      .send(body);
  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
    db = setup.prisma;
    await app.listen(0);
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await resetDatabase(db);
    const operator = await db.user.findUniqueOrThrow({ where: { email: 'operator@test.local' } });
    await db.user.create({
      data: {
        email: 'marketing-b@test.local',
        name: 'Marketing B',
        passwordHash: operator.passwordHash,
        roleId: operator.roleId,
      },
    });
    a = await loginAs(app, 'MARKETING_OPERATOR');
    b = await loginAs(app, { email: 'marketing-b@test.local', password: TEST_PASSWORD });
    root = await loginAs(app, 'SUPER_ADMIN');
    accountA = (
      await post(a, '/tiktok-accounts', {
        username: 'sender_a',
        displayName: 'A',
        lane: 'OUTBOUND',
        ownerId: randomUUID(),
      }).expect(201)
    ).body.id;
    accountB = (
      await post(b, '/tiktok-accounts', {
        username: 'sender_b',
        displayName: 'B',
        lane: 'OUTBOUND',
      }).expect(201)
    ).body.id;
    leadA = (
      await post(a, '/leads', {
        name: 'Private A',
        tiktokUsername: 'same_recipient',
        source: 'MANUAL',
        sourceAccountId: accountA,
      }).expect(201)
    ).body.id;
    leadB = (
      await post(b, '/leads', {
        name: 'Private B',
        tiktokUsername: 'same_recipient',
        source: 'MANUAL',
        sourceAccountId: accountB,
      }).expect(201)
    ).body.id;
  });
  it('isolates lists, details and exports, permits the same contact per marketing, and gives Super Admin all rows', async () => {
    for (const [s, accountId, leadId] of [
      [a, accountA, leadA],
      [b, accountB, leadB],
    ] as const) {
      expect(
        (await s.agent.get('/api/tiktok-accounts').expect(200)).body.items.map(
          (x: { id: string }) => x.id,
        ),
      ).toEqual([accountId]);
      expect(
        (await s.agent.get('/api/leads').expect(200)).body.items.map((x: { id: string }) => x.id),
      ).toEqual([leadId]);
      const csv = await s.agent.get('/api/leads/export?format=csv').expect(200);
      expect(csv.text).toContain(leadId);
      expect(csv.text).not.toContain(leadId === leadA ? leadB : leadA);
    }
    expect((await root.agent.get('/api/leads').expect(200)).body.total).toBe(2);
    expect((await root.agent.get('/api/tiktok-accounts').expect(200)).body.total).toBe(2);
    await root.agent.get(`/api/leads/${leadA}`).expect(200);
    await root.agent.get(`/api/tiktok-accounts/${accountB}`).expect(200);
    expect(
      (
        await root.agent.get(`/api/outbound/queue?accountId=${accountA}`).expect(200)
      ).body.items.map((x: { lead: { id: string } }) => x.lead.id),
    ).toEqual([leadA]);
    const ownerA = (await a.agent.get('/api/auth/me').expect(200)).body.id;
    expect((await db.tikTokAccount.findUniqueOrThrow({ where: { id: accountA } })).ownerId).toBe(
      ownerA,
    );
  });
  it('rejects foreign IDs for read, mutation, consent, opt-out, AI and sending, including forged filters', async () => {
    await b.agent.get(`/api/leads/${leadA}`).expect(404);
    await b.agent.get(`/api/tiktok-accounts/${accountA}`).expect(404);
    await patch(b, `/leads/${leadA}`, { name: 'Hijacked' }).expect(404);
    await patch(b, `/tiktok-accounts/${accountA}`, { displayName: 'Hijacked' }).expect(404);
    await post(b, `/leads/${leadA}/notes`, { note: 'Hijacked note' }).expect(404);
    await post(b, `/leads/${leadA}/consents`, {
      channel: 'TIKTOK_DM',
      source: 'CONVERSATION',
      evidence: 'forged',
    }).expect(404);
    await post(b, `/leads/${leadA}/do-not-contact`, { reason: 'forged opt-out' }).expect(404);
    await post(b, '/ai/ask', { question: 'Summarize this lead', leadId: leadA }).expect(404);
    await post(b, '/outbound/tasks', {
      leadId: leadA,
      tiktokAccountId: accountB,
      channel: 'TIKTOK_DM',
      draftMessage: 'Forged outgoing DM.',
    }).expect(404);
    await b.agent.get(`/api/outbound/queue?accountId=${accountA}`).expect(404);
    await b.agent.get(`/api/outbound/summary/${accountA}`).expect(404);
    await b.agent.get(`/api/outbound/browser-dm?accountId=${accountA}`).expect(404);
    await post(b, '/outbound/browser-dm/queue', { accountId: accountA }).expect(404);
    await post(b, '/outbound/browser-dm/claim', {
      accountId: accountA,
      clientId: randomUUID(),
    }).expect(404);
    await post(b, '/outbound/browser-dm/cancel', { accountId: accountA }).expect(404);
    const ownerA = (await a.agent.get('/api/auth/me')).body.id;
    expect((await b.agent.get(`/api/leads?operatorId=${ownerA}`).expect(200)).body.total).toBe(0);
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadA } })).name).toBe('Private A');
  });
  it('separates follower import and CSV duplicate detection between owners', async () => {
    const batch = (name: string) => ({
      format: 'smge-followers-v1',
      accountUsername: name,
      collectedAt: new Date().toISOString(),
      stopReason: 'Fixture',
      followers: [{ username: 'imported_recipient' }],
    });
    await post(a, '/outbound/followers/import', {
      accountId: accountA,
      batch: batch('sender_a'),
    }).expect(201);
    await post(b, '/outbound/followers/import', {
      accountId: accountA,
      batch: batch('sender_a'),
    }).expect(404);
    expect(
      (
        await post(b, '/outbound/followers/import', {
          accountId: accountB,
          batch: batch('sender_b'),
        }).expect(201)
      ).body.created,
    ).toBe(1);
    const records = await db.lead.findMany({
      where: { tiktokUsernameNormalized: 'imported_recipient' },
    });
    expect(new Set(records.map((l) => l.ownerId)).size).toBe(2);
    await post(a, '/leads', { source: 'MANUAL', tiktokUsername: 'only_a_contact' }).expect(201);
    const preview = await b.agent
      .post('/api/leads/import/preview')
      .set('x-csrf-token', b.csrf)
      .attach('file', Buffer.from('username\nonly_a_contact\n'), 'leads.csv')
      .expect(200);
    expect(preview.body.newLeads).toBe(1);
    expect(preview.body.duplicates).toBe(0);
  });
  it('keeps private templates isolated and shared system templates readable but not editable', async () => {
    const template = (
      await post(a, '/message-templates', {
        name: 'Private template A',
        purpose: 'INTRODUCTION',
        lane: 'OUTBOUND',
        content: 'Private greeting for A.',
      }).expect(201)
    ).body;
    const shared = await db.messageTemplate.create({
      data: {
        name: 'System template',
        purpose: 'INTRODUCTION',
        content: 'Common greeting.',
        createdById: null,
      },
    });
    const rows = (await b.agent.get('/api/message-templates').expect(200)).body as Array<{
      id: string;
    }>;
    expect(rows.some((t) => t.id === template.id)).toBe(false);
    expect(rows.some((t) => t.id === shared.id)).toBe(true);
    await patch(b, `/message-templates/${template.id}`, {
      content: 'Overwrite private text.',
    }).expect(404);
    await patch(a, `/message-templates/${shared.id}`, { content: 'Overwrite shared text.' }).expect(
      404,
    );
    await post(b, '/outbound/tasks', {
      leadId: leadB,
      tiktokAccountId: accountB,
      templateId: template.id,
      channel: 'TIKTOK_DM',
    }).expect(404);
  });
  it('isolates concurrent request contexts and dashboard totals', async () => {
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        const [one, two] = await Promise.all([
          a.agent.get('/api/leads'),
          b.agent.get('/api/leads'),
        ]);
        expect(one.body.items.map((l: { id: string }) => l.id)).toEqual([leadA]);
        expect(two.body.items.map((l: { id: string }) => l.id)).toEqual([leadB]);
      }),
    );
    const overview = (await a.agent.get('/api/analytics/overview').expect(200)).body;
    expect(overview.accounts.total).toBe(1);
    expect(overview.metrics.totalLeads.value).toBe(1);
    expect(overview.accounts.top.map((x: { id: string }) => x.id)).toEqual([accountA]);
    await a.agent.get('/api/analytics/report').expect(403);
    await a.agent.get('/api/ANALYTICS/report/').expect(403);
  });
  it('applies the same ownership boundary to Admin and refuses forged source references', async () => {
    const admin = await loginAs(app, 'ADMIN');
    expect((await admin.agent.get('/api/leads').expect(200)).body.total).toBe(0);
    await admin.agent.get(`/api/tiktok-accounts/${accountA}`).expect(404);
    await admin.agent.get(`/api/leads/${leadB}`).expect(404);
    await post(b, '/leads', {
      source: 'MANUAL',
      name: 'Forged source',
      tiktokUsername: 'forged_source_contact',
      sourceAccountId: accountA,
    }).expect(404);
    await patch(b, `/leads/${leadB}`, { sourceAccountId: accountA }).expect(404);
    await patch(a, `/leads/${leadA}`, {
      ownerId: (await b.agent.get('/api/auth/me')).body.id,
    }).expect(400);
    expect((await a.agent.get(`/api/leads/${leadA}`).expect(200)).body.owner.id).toBe(
      (await a.agent.get('/api/auth/me')).body.id,
    );
  });
  it('allows the same TikTok username for another owner without sharing account rows', async () => {
    const separate = (
      await post(b, '/tiktok-accounts', {
        username: 'sender_a',
        displayName: 'Private copy B',
        lane: 'OUTBOUND',
      }).expect(201)
    ).body;
    expect(separate.id).not.toBe(accountA);
    await a.agent.get(`/api/tiktok-accounts/${separate.id}`).expect(404);
    await post(b, '/tiktok-accounts', {
      username: 'sender_a',
      displayName: 'Duplicate B',
      lane: 'OUTBOUND',
    }).expect(409);
    expect((await b.agent.get('/api/tiktok-accounts').expect(200)).body.total).toBe(2);
  });
  it('checks multipart CSV commit references and keeps AI history and cost private', async () => {
    const commit = (sourceAccountId: string) =>
      b.agent
        .post('/api/leads/import')
        .set('x-csrf-token', b.csrf)
        .field('sourceAccountId', sourceAccountId)
        .field('sourceDescription', 'Fixture CSV marketing B')
        .field('lawfulBasisConfirmed', 'true')
        .attach('file', Buffer.from('username\ncsv_owned_b\n'), 'leads.csv');
    await commit(accountA).expect(404);
    expect((await commit(accountB).expect(200)).body.created).toBe(1);
    const created = await db.lead.findFirstOrThrow({
      where: { tiktokUsernameNormalized: 'csv_owned_b' },
    });
    expect(created.ownerId).toBe((await b.agent.get('/api/auth/me')).body.id);
    const ownerA = (await a.agent.get('/api/auth/me')).body.id;
    await db.aiInteraction.create({
      data: {
        type: 'KNOWLEDGE_QA',
        model: 'fixture-model',
        userId: ownerA,
        leadId: leadA,
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        costUsd: 1,
      },
    });
    expect((await b.agent.get('/api/ai/interactions').expect(200)).body.total).toBe(0);
    expect((await b.agent.get('/api/ai/usage?days=7').expect(200)).body.totals.interactions).toBe(
      0,
    );
    expect((await root.agent.get('/api/ai/interactions').expect(200)).body.total).toBe(1);
  });
  it('allows Super Admin review, keeps marketing task access private, and records an owned browser attempt', async () => {
    const task = (
      await post(a, '/outbound/tasks', {
        leadId: leadA,
        tiktokAccountId: accountA,
        channel: 'TIKTOK_DM',
        draftMessage: 'Reviewed fixture message.',
      }).expect(201)
    ).body;
    await b.agent.get(`/api/outbound/tasks/${task.id}`).expect(404);
    await post(b, `/outbound/tasks/${task.id}/actions`, { action: 'submit' }).expect(404);
    expect(
      (await b.agent.get(`/api/outbound/tasks?accountId=${accountA}`).expect(200)).body.total,
    ).toBe(0);
    await post(a, `/outbound/tasks/${task.id}/actions`, { action: 'submit' }).expect(200);
    await post(root, `/outbound/tasks/${task.id}/actions`, { action: 'approve' }).expect(200);
    expect(
      (
        await post(a, '/outbound/browser-dm/queue', {
          accountId: accountA,
          taskIds: [task.id],
        }).expect(201)
      ).body.queued,
    ).toBe(1);
    expect(
      (await root.agent.get(`/api/outbound/browser-dm?accountId=${accountA}`).expect(200)).body,
    ).toHaveLength(1);
    const clientId = randomUUID();
    const item = (
      await post(a, '/outbound/browser-dm/claim', { accountId: accountA, clientId }).expect(201)
    ).body;
    await post(b, `/outbound/browser-dm/${item.id}/authorize`, {
      clientId,
      attemptId: item.attemptId,
    }).expect(404);
    await post(a, `/outbound/browser-dm/${item.id}/authorize`, {
      clientId,
      attemptId: item.attemptId,
    }).expect(201);
    await post(a, `/outbound/browser-dm/${item.id}/result`, {
      clientId,
      attemptId: item.attemptId,
      status: 'SENT',
      detail: 'Local fixture observed only; no live TikTok send.',
    }).expect(201);
    expect(
      (await root.agent.get(`/api/outbound/tasks/${task.id}`).expect(200)).body.sentCount,
    ).toBe(1);
  });
});
