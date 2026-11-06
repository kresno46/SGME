import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  EmailOutreachWorker,
  type EmailGateway,
} from '../src/email-outreach/email-outreach.module';
import { resetEnvCache } from '../src/config/env';
import { createTestApp, loginAs, resetDatabase, type Session } from './utils';

describe('Email outreach (mock SMTP only)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let operator: Session;
  let admin: Session;
  let root: Session;
  const send = jest.fn<ReturnType<EmailGateway['send']>, Parameters<EmailGateway['send']>>();
  const input = () => ({
    requestId: randomUUID(),
    recipients: [{ email: 'budi@example.invalid', name: 'Budi' }],
    subject: 'Halo {{nama}}',
    body: 'Informasi untuk {{email}}',
    confirmed: true,
  });
  const post = (session: Session, path: string, body: object = {}) =>
    session.agent
      .post('/api/email-outreach' + path)
      .set('x-csrf-token', session.csrf)
      .send(body);
  beforeAll(async () => {
    process.env.EMAIL_OUTREACH_ENABLED = 'true';
    process.env.SMTP_HOST = 'smtp.example.invalid';
    resetEnvCache();
    ({ app, prisma: db } = await createTestApp({ email: { send } }));
  });
  beforeEach(async () => {
    await resetDatabase(db);
    operator = await loginAs(app, 'MARKETING_OPERATOR');
    admin = await loginAs(app, 'ADMIN');
    root = await loginAs(app, 'SUPER_ADMIN');
    send.mockReset();
    send.mockImplementation(async (message) => ({ accepted: [message.to] }));
  });
  afterAll(async () => {
    await app.close();
  });
  it('isolates templates and messages, allows Super Admin oversight and denies Viewer', async () => {
    const t = await post(operator, '/templates', {
      name: 'Pribadi',
      subject: 'Halo',
      body: 'Pesan email pribadi',
    }).expect(201);
    expect((await admin.agent.get('/api/email-outreach/templates').expect(200)).body).toEqual([]);
    await admin.agent
      .patch(`/api/email-outreach/templates/${t.body.id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ name: 'Ubah', subject: 'Halo', body: 'Pesan berubah' })
      .expect(404);
    await admin.agent
      .delete(`/api/email-outreach/templates/${t.body.id}`)
      .set('x-csrf-token', admin.csrf)
      .expect(404);
    expect((await root.agent.get('/api/email-outreach/templates').expect(200)).body).toHaveLength(
      1,
    );
    await post(operator, '', input()).expect(201);
    expect((await admin.agent.get('/api/email-outreach').expect(200)).body.items).toHaveLength(0);
    expect((await root.agent.get('/api/email-outreach').expect(200)).body.items).toHaveLength(1);
    const viewer = await loginAs(app, 'VIEWER');
    await viewer.agent.get('/api/email-outreach/config').expect(403);
    await post(viewer, '', input()).expect(403);
  });
  it('requires confirmation, validates variables, deduplicates recipients and concurrent submissions', async () => {
    await post(operator, '', { ...input(), confirmed: false }).expect(400);
    await post(operator, '', { ...input(), body: 'Halo {{unknown}}' }).expect(400);
    const batch = input();
    batch.recipients.push({ ...batch.recipients[0], email: 'BUDI@example.invalid' });
    await Promise.all([
      post(operator, '', batch).expect(201),
      post(operator, '', batch).expect(201),
    ]);
    expect(await db.outreachEmail.count()).toBe(1);
    const row = await db.outreachEmail.findFirstOrThrow();
    expect(row.subject).toBe('Halo Budi');
    expect(row.body).toBe('Informasi untuk budi@example.invalid');
    expect(send).not.toHaveBeenCalled();
  });
  it('cancels only an owned queued message and enforces DNC again before sending', async () => {
    await post(operator, '', input()).expect(201);
    const row = await db.outreachEmail.findFirstOrThrow();
    await post(admin, `/${row.id}/cancel`).expect(404);
    await post(operator, `/${row.id}/cancel`).expect(201);
    await post(operator, '', input()).expect(201);
    await db.doNotContactEntry.create({
      data: { channel: 'EMAIL', valueNormalized: 'budi@example.invalid' },
    });
    await app.get(EmailOutreachWorker).tick();
    expect(send).not.toHaveBeenCalled();
    expect(await db.outreachEmail.count({ where: { status: 'CANCELLED' } })).toBe(2);
    await post(operator, '', input()).expect(400);
  });
  it('records accepted versus rejected outcomes and continues after a rejected recipient', async () => {
    const batch = input();
    batch.recipients.push({ email: 'sari@example.invalid', name: 'Sari' });
    await post(operator, '', batch).expect(201);
    send.mockRejectedValueOnce({ responseCode: 550 });
    await app.get(EmailOutreachWorker).tick();
    await app.get(EmailOutreachWorker).tick();
    expect(await db.outreachEmail.count({ where: { status: 'FAILED' } })).toBe(1);
    expect(await db.outreachEmail.count({ where: { status: 'ACCEPTED' } })).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('does not resend uncertain outcomes or interrupted claims and concurrent workers claim only once', async () => {
    await post(operator, '', input()).expect(201);
    send.mockRejectedValueOnce(new Error('Connection lost'));
    await Promise.all([
      new EmailOutreachWorker(db, { send }).tick(),
      new EmailOutreachWorker(db, { send }).tick(),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.outreachEmail.findFirstOrThrow()).status).toBe('UNVERIFIED');
    await db.outreachEmail.updateMany({
      data: { status: 'PROCESSING', updatedAt: new Date(Date.now() - 600000) },
    });
    await app.get(EmailOutreachWorker).tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.outreachEmail.findFirstOrThrow()).status).toBe('UNVERIFIED');
  });
  it('rejects queue submissions when outreach is disabled rather than pretending to send', async () => {
    process.env.EMAIL_OUTREACH_ENABLED = 'false';
    resetEnvCache();
    try {
      expect(
        (await operator.agent.get('/api/email-outreach/config').expect(200)).body.enabled,
      ).toBe(false);
      await post(operator, '', input()).expect(503);
      expect(await db.outreachEmail.count()).toBe(0);
    } finally {
      process.env.EMAIL_OUTREACH_ENABLED = 'true';
      resetEnvCache();
    }
  });
});
