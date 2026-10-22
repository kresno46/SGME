import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDatabase, type Session } from './utils';

describe('Browser DM durable queue (no live TikTok messages)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let accountId: string;
  let ownerId: string;
  const clientId = randomUUID();
  const post = (path: string, body: object, session = admin) =>
    session.agent
      .post('/api/outbound/browser-dm/' + path)
      .set('x-csrf-token', session.csrf)
      .send(body);
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    admin = await loginAs(app, 'SUPER_ADMIN');
    ownerId = (await prisma.user.findUniqueOrThrow({ where: { email: 'super@test.local' } })).id;
    accountId = (
      await prisma.tikTokAccount.create({
        data: { ownerId, username: 'sender_test', displayName: 'Sender', lane: 'OUTBOUND' },
      })
    ).id;
  });
  afterAll(() => app.close());
  async function task(username = 'recipient_test', status: 'APPROVED' | 'DRAFT' = 'APPROVED') {
    const lead = await prisma.lead.create({
      data: {
        ownerId,
        tiktokUsername: username,
        tiktokUsernameNormalized: username,
        source: 'IMPORT',
        tags: [],
      },
    });
    return prisma.outreachTask.create({
      data: {
        ownerId,
        leadId: lead.id,
        tiktokAccountId: accountId,
        status,
        channel: 'TIKTOK_DM',
        finalMessage: 'Pesan yang sudah disetujui.',
        approvedAt: new Date(),
      },
    });
  }
  async function claimed() {
    await post('queue', { accountId }).expect(201);
    return (await post('claim', { accountId, clientId }).expect(201)).body;
  }
  const actTask = (id: string, body: object, session = admin) =>
    session.agent
      .post(`/api/outbound/tasks/${id}/actions`)
      .set('x-csrf-token', session.csrf)
      .send(body);
  async function sentInitial() {
    const row = await task();
    const item = await claimed();
    await post(`${item.id}/result`, {
      clientId,
      attemptId: item.attemptId,
      status: 'SENT',
      detail: 'Observed initial message on local fixture.',
    }).expect(201);
    await prisma.outreachTask.update({
      where: { id: row.id },
      data: { lastSentAt: new Date(Date.now() - 25 * 3600000) },
    });
    return { row, item };
  }
  async function scheduledFollowUp(id: string) {
    await actTask(id, {
      action: 'schedule_follow_up',
      followUpAt: new Date(Date.now() + 3600000).toISOString(),
      draftMessage: 'Halo lagi, apakah ingin menerima info singkatnya?',
    }).expect(200);
  }
  it('reviews and sends one unanswered follow-up after its due date, preserves history and rejects old attempts', async () => {
    const { row, item: initial } = await sentInitial();
    await scheduledFollowUp(row.id);
    expect((await post('queue', { accountId, taskIds: [row.id] }).expect(201)).body.queued).toBe(0);
    const operator = await loginAs(app, 'MARKETING_OPERATOR');
    await actTask(row.id, { action: 'approve' }, operator).expect(404);
    await actTask(row.id, { action: 'approve' }).expect(200);
    await post('queue', { accountId, taskIds: [row.id] }).expect(409);
    await prisma.outreachTask.update({
      where: { id: row.id },
      data: { followUpAt: new Date(Date.now() - 1000) },
    });
    const queued = await Promise.all([
      post('queue', { accountId, taskIds: [row.id] }),
      post('queue', { accountId, taskIds: [row.id] }),
    ]);
    expect(queued.map((r) => r.body.queued).sort()).toEqual([0, 1]);
    const next = (await post('claim', { accountId, clientId }).expect(201)).body;
    expect(next.attemptId).not.toBe(initial.attemptId);
    expect(next.message).toBe('Halo lagi, apakah ingin menerima info singkatnya?');
    await post(`${next.id}/authorize`, { clientId, attemptId: next.attemptId }).expect(201);
    await post(`${initial.id}/result`, {
      clientId,
      attemptId: initial.attemptId,
      status: 'SENT',
      detail: 'Stale initial report.',
    }).expect(409);
    const outcome = {
      clientId,
      attemptId: next.attemptId,
      status: 'SENT',
      detail: 'Observed follow-up on local fixture.',
    };
    await post(`${next.id}/result`, outcome).expect(201);
    await post(`${next.id}/result`, outcome).expect(201);
    const stored = await prisma.outreachTask.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.sentCount).toBe(2);
    expect(stored.followUpAt).toBeNull();
    expect(
      await prisma.leadActivity.count({ where: { type: 'MESSAGE_SENT', leadId: row.leadId } }),
    ).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'browser_dm.follow_up_queued' } })).toBe(
      1,
    );
    await actTask(row.id, {
      action: 'schedule_follow_up',
      followUpAt: new Date(Date.now() + 48 * 3600000).toISOString(),
      draftMessage: 'A third unanswered message.',
    }).expect(409);
  });
  it('rechecks follow-up eligibility at send time and keeps a failed retry from incrementing counts', async () => {
    const { row } = await sentInitial();
    await scheduledFollowUp(row.id);
    await actTask(row.id, { action: 'approve' }).expect(200);
    await prisma.outreachTask.update({
      where: { id: row.id },
      data: { followUpAt: new Date(Date.now() - 1000) },
    });
    const next = await claimed();
    await post(`${next.id}/result`, {
      clientId,
      attemptId: next.attemptId,
      status: 'FAILED',
      detail: 'Fixture stopped before input.',
    }).expect(201);
    expect((await prisma.outreachTask.findUniqueOrThrow({ where: { id: row.id } })).sentCount).toBe(
      1,
    );
    await post(`${next.id}/retry`, { confirmedNotSent: true }).expect(201);
    const retry = (await post('claim', { accountId, clientId }).expect(201)).body;
    await prisma.doNotContactEntry.create({
      data: { channel: 'TIKTOK_DM', valueNormalized: 'recipient_test' },
    });
    await post(`${retry.id}/authorize`, { clientId, attemptId: retry.attemptId }).expect(409);
  });
  async function batchLeads() {
    return Promise.all(
      ['batch_one', 'batch_two'].map((username, index) =>
        prisma.lead.create({
          data: {
            ownerId,
            name: `Nama ${index + 1}`,
            tiktokUsername: username,
            tiktokUsernameNormalized: username,
            source: 'IMPORT',
            tags: [],
          },
        }),
      ),
    );
  }
  const batchBody = (leadIds: string[]) => ({
    accountId,
    requestId: randomUUID(),
    leadIds,
    message: 'Halo {{nama}}, dari @{{akun}} untuk @{{username}}.',
    mode: 'approve',
    confirmed: true,
  });
  it('prepares only selected recipients atomically, personalizes messages and replays without duplicates', async () => {
    const unrelated = await task();
    const leads = await batchLeads();
    const body = batchBody(leads.map((l) => l.id));
    const responses = await Promise.all([
      post('prepare', body).expect(201),
      post('prepare', body).expect(201),
    ]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(responses[0].body.queued).toBe(2);
    expect(await prisma.browserDmDelivery.count()).toBe(2);
    expect(
      await prisma.browserDmDelivery.findUnique({ where: { taskId: unrelated.id } }),
    ).toBeNull();
    const deliveries = await prisma.browserDmDelivery.findMany({ orderBy: { username: 'asc' } });
    expect(deliveries[0].message).toBe('Halo Nama 1, dari @sender_test untuk @batch_one.');
    expect(await prisma.outreachTask.count({ where: { sentCount: { gt: 0 } } })).toBe(0);
    await post('prepare', { ...body, message: 'Changed message.' }).expect(409);
  });
  it('rolls the whole batch back if any recipient is blocked or the daily quota changed', async () => {
    const leads = await batchLeads();
    await prisma.doNotContactEntry.create({
      data: { channel: 'TIKTOK_DM', valueNormalized: 'batch_two' },
    });
    await post('prepare', batchBody(leads.map((l) => l.id))).expect(409);
    expect(await prisma.outreachTask.count()).toBe(0);
    expect(await prisma.browserDmDelivery.count()).toBe(0);
    await prisma.doNotContactEntry.deleteMany();
    await prisma.outreachTask.createMany({
      data: Array.from({ length: 29 }, () => ({
        leadId: leads[0].id,
        tiktokAccountId: accountId,
        status: 'COMPLETED' as const,
      })),
    });
    await post('prepare', batchBody(leads.map((l) => l.id))).expect(409);
    expect(await prisma.browserDmDelivery.count()).toBe(0);
  });
  it('lets operators submit a whole batch but requires review permission to approve and queue', async () => {
    const operator = await loginAs(app, 'MARKETING_OPERATOR');
    const leads = await batchLeads();
    const opId = (await prisma.user.findUniqueOrThrow({ where: { email: 'operator@test.local' } }))
      .id;
    await prisma.tikTokAccount.update({ where: { id: accountId }, data: { ownerId: opId } });
    await prisma.lead.updateMany({
      where: { id: { in: leads.map((l) => l.id) } },
      data: { ownerId: opId },
    });
    const body = batchBody(leads.map((l) => l.id));
    await post('prepare', body, operator).expect(403);
    expect(await prisma.outreachTask.count()).toBe(0);
    expect(
      (await post('prepare', { ...body, mode: 'submit' }, operator).expect(201)).body.submitted,
    ).toBe(2);
    expect(await prisma.outreachTask.count({ where: { status: 'WAITING_REVIEW' } })).toBe(2);
    expect(await prisma.browserDmDelivery.count()).toBe(0);
  });
  it('queues a single approved task without adding unrelated approved tasks', async () => {
    const chosen = await task('chosen_test');
    const other = await task('other_test');
    expect((await post('queue', { accountId, taskIds: [chosen.id] }).expect(201)).body.queued).toBe(
      1,
    );
    expect(await prisma.browserDmDelivery.findUnique({ where: { taskId: other.id } })).toBeNull();
  });
  it('rejects duplicate recipients, missing confirmation and unsupported template variables', async () => {
    const [lead] = await batchLeads();
    const body = batchBody([lead.id]);
    await post('prepare', { ...body, leadIds: [lead.id, lead.id] }).expect(400);
    await post('prepare', { ...body, confirmed: false }).expect(400);
    await post('prepare', { ...body, message: 'Klik {{link}} untuk daftar.' }).expect(400);
    expect(await prisma.outreachTask.count()).toBe(0);
  });
  it('serializes competing batches so a recipient gets only one open task', async () => {
    const [lead] = await batchLeads();
    const responses = await Promise.all([
      post('prepare', batchBody([lead.id])),
      post('prepare', batchBody([lead.id])),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.browserDmDelivery.count()).toBe(1);
    expect(await prisma.outreachTask.count()).toBe(1);
  });
  it('only queues approved messages, deduplicates queueing, and applies a reported result once', async () => {
    const approved = await task();
    await task('draft_test', 'DRAFT');
    expect((await post('queue', { accountId }).expect(201)).body.queued).toBe(1);
    expect((await post('queue', { accountId }).expect(201)).body.queued).toBe(0);
    const item = (await post('claim', { accountId, clientId }).expect(201)).body;
    expect(item.username).toBe('recipient_test');
    await post(`${item.id}/authorize`, { clientId, attemptId: item.attemptId }).expect(201);
    const result = {
      clientId,
      attemptId: item.attemptId,
      status: 'SENT',
      detail: 'Observed new outgoing message on test fixture.',
    };
    await post(`${item.id}/result`, result).expect(201);
    await post(`${item.id}/result`, result).expect(201);
    const stored = await prisma.outreachTask.findUniqueOrThrow({ where: { id: approved.id } });
    expect(stored.status).toBe('BROWSER_SENT');
    expect(stored.sentCount).toBe(1);
    expect(await prisma.leadActivity.count({ where: { type: 'MESSAGE_SENT' } })).toBe(1);
  });
  it('serializes claims from two clients and rejects a result from the wrong attempt', async () => {
    await task();
    await task('recipient_two');
    await post('queue', { accountId });
    const responses = await Promise.all([
      post('claim', { accountId, clientId }),
      post('claim', { accountId, clientId: randomUUID() }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.browserDmDelivery.count({ where: { status: 'PROCESSING' } })).toBe(1);
    const item = responses.find((r) => r.status === 201)!.body;
    await post(`${item.id}/result`, {
      clientId: randomUUID(),
      attemptId: item.attemptId,
      status: 'SENT',
      detail: 'Wrong client',
    }).expect(409);
  });
  it('rechecks DNC before authorizing the actual send and prevents manual actions during an attempt', async () => {
    const row = await task();
    const item = await claimed();
    await admin.agent
      .post(`/api/outbound/tasks/${row.id}/actions`)
      .set('x-csrf-token', admin.csrf)
      .send({ action: 'mark_sent', confirmed: true })
      .expect(409);
    await prisma.doNotContactEntry.create({
      data: { channel: 'TIKTOK_DM', valueNormalized: 'recipient_test' },
    });
    await post(`${item.id}/authorize`, { clientId, attemptId: item.attemptId }).expect(409);
  });
  it('marks expired attempts uncertain, blocks further claims, and requires explicit manual resolution', async () => {
    const row = await task();
    const item = await claimed();
    await prisma.browserDmDelivery.update({
      where: { id: item.id },
      data: { startedAt: new Date(Date.now() - 180_000) },
    });
    const listing = await admin.agent
      .get(`/api/outbound/browser-dm?accountId=${accountId}`)
      .expect(200);
    expect(listing.body[0].status).toBe('UNVERIFIED');
    await post('claim', { accountId, clientId }).expect(409);
    await post(`${item.id}/resolve`, { confirmed: true, sent: true }).expect(201);
    expect((await prisma.outreachTask.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      'MANUALLY_SENT',
    );
  });
  it('does not treat failure as sent and cancels only waiting deliveries', async () => {
    const row = await task();
    const item = await claimed();
    await task('recipient_two');
    await post('queue', { accountId });
    await post('cancel', { accountId }).expect(201);
    expect(await prisma.browserDmDelivery.count({ where: { status: 'PROCESSING' } })).toBe(1);
    await post(`${item.id}/result`, {
      clientId,
      attemptId: item.attemptId,
      status: 'FAILED',
      detail: 'No message button',
    }).expect(201);
    expect((await prisma.outreachTask.findUniqueOrThrow({ where: { id: row.id } })).sentCount).toBe(
      0,
    );
    expect(await prisma.browserDmDelivery.count({ where: { status: 'CANCELLED' } })).toBe(1);
  });
  it('retries only failed deliveries after explicit confirmation and invalidates the previous attempt', async () => {
    await task();
    const item = await claimed();
    await post(`${item.id}/retry`, { confirmedNotSent: true }).expect(409);
    await post(`${item.id}/result`, {
      clientId,
      attemptId: item.attemptId,
      status: 'FAILED',
      detail: 'Header not recognized before sending.',
    }).expect(201);
    await post(`${item.id}/retry`, {}).expect(400);
    const operator = await loginAs(app, 'MARKETING_OPERATOR');
    await post(`${item.id}/retry`, { confirmedNotSent: true }, operator).expect(404);
    await post(`${item.id}/retry`, { confirmedNotSent: true }).expect(201);
    await post(`${item.id}/retry`, { confirmedNotSent: true }).expect(409);
    const next = (await post('claim', { accountId, clientId }).expect(201)).body;
    expect(next.id).toBe(item.id);
    expect(next.attemptId).not.toBe(item.attemptId);
    await post(`${item.id}/result`, {
      clientId,
      attemptId: item.attemptId,
      status: 'SENT',
      detail: 'Stale result',
    }).expect(409);
    expect(await prisma.auditLog.count({ where: { action: 'browser_dm.retried' } })).toBe(1);
  });

  it('rechecks DNC and approval before a manual retry', async () => {
    await task();
    const item = await claimed();
    await post(`${item.id}/result`, {
      clientId,
      attemptId: item.attemptId,
      status: 'FAILED',
      detail: 'No message button.',
    }).expect(201);
    await prisma.doNotContactEntry.create({
      data: { channel: 'TIKTOK_DM', valueNormalized: 'recipient_test' },
    });
    await post(`${item.id}/retry`, { confirmedNotSent: true }).expect(409);
    expect(
      (await prisma.browserDmDelivery.findUniqueOrThrow({ where: { id: item.id } })).status,
    ).toBe('FAILED');
  });

  it('isolates queues by user and enforces session, permission, and CSRF', async () => {
    await task();
    await post('queue', { accountId });
    const op = await loginAs(app, 'MARKETING_OPERATOR');
    await post('claim', { accountId, clientId }, op).expect(404);
    const viewer = await loginAs(app, 'VIEWER');
    await post('claim', { accountId, clientId }, viewer).expect(403);
    await admin.agent
      .post('/api/outbound/browser-dm/claim')
      .send({ accountId, clientId })
      .expect(403);
  });
});
