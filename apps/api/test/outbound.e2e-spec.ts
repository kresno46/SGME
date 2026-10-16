import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDatabase, Session } from './utils';

describe('Outbound Workstation (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let op: Session;
  let admin: Session;
  let accountId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    op = await loginAs(app, 'MARKETING_OPERATOR');
    admin = await loginAs(app, 'ADMIN');
    accountId = (
      await prisma.tikTokAccount.create({
        data: { username: 'akun_b', displayName: 'Akun B', lane: 'OUTBOUND' },
      })
    ).id;
  });
  afterAll(() => app.close());

  const lead = (data: Record<string, unknown> = {}) =>
    prisma.lead.create({
      data: {
        name: 'Prospek',
        tiktokUsername: 'calon',
        tiktokUsernameNormalized: 'calon',
        source: 'MANUAL',
        ...data,
      },
    });
  const createTask = (s: Session, body: Record<string, unknown>) =>
    s.agent
      .post('/api/outbound/tasks')
      .set('x-csrf-token', s.csrf)
      .send({ tiktokAccountId: accountId, ...body });
  const act = (s: Session, id: string, body: Record<string, unknown>) =>
    s.agent.post(`/api/outbound/tasks/${id}/actions`).set('x-csrf-token', s.csrf).send(body);

  it('antrean hanya berisi prospek yang memenuhi syarat, diurutkan berdasarkan prioritas', async () => {
    await lead({
      name: 'Hangat',
      tiktokUsernameNormalized: 'hangat',
      source: 'TIKTOK_LEAD_GEN',
      interestLevel: 'HIGH',
    });
    await lead({
      name: 'Dingin',
      tiktokUsernameNormalized: 'dingin',
      source: 'IMPORT',
      createdAt: new Date('2026-01-01'),
    });
    await lead({
      name: 'DNC',
      tiktokUsernameNormalized: 'dnc',
      doNotContact: true,
      status: 'DO_NOT_CONTACT',
    });
    await lead({ name: 'Terdaftar', tiktokUsernameNormalized: 'daftar', status: 'REGISTERED' });
    await lead({
      name: 'Tanpa TikTok',
      tiktokUsernameNormalized: null,
      email: 'x@y.co',
      emailNormalized: 'x@y.co',
    });

    const res = await op.agent.get(`/api/outbound/queue?accountId=${accountId}`).expect(200);
    expect(res.body.items.map((i: { lead: { name: string } }) => i.lead.name)).toEqual([
      'Hangat',
      'Dingin',
    ]);
    expect(res.body.items[0].priority.reasons).toContain('Prospek datang atas inisiatif sendiri');

    // Kanal email butuh izin → kosong
    const email = await op.agent
      .get(`/api/outbound/queue?accountId=${accountId}&channel=EMAIL`)
      .expect(200);
    expect(email.body.total).toBe(0);
  });

  it('hanya akun Jalur B yang aktif yang dapat dipakai', async () => {
    const official = await prisma.tikTokAccount.create({
      data: { username: 'resmi', displayName: 'R', lane: 'OFFICIAL' },
    });
    await op.agent.get(`/api/outbound/queue?accountId=${official.id}`).expect(400);
    await prisma.tikTokAccount.update({ where: { id: accountId }, data: { status: 'RESTRICTED' } });
    const l = await lead();
    const res = await createTask(op, { leadId: l.id }).expect(400);
    expect(res.body.message).toMatch(/tidak aktif/);
  });

  it('alur lengkap: draft dari template → review → kirim manual (konfirmasi) → balasan → selesai', async () => {
    const l = await lead({ name: 'Sari' });
    const tpl = await prisma.messageTemplate.create({
      data: {
        name: 'Intro',
        purpose: 'INTRODUCTION',
        content: 'Halo {{nama}}, salam dari @{{akun}}!',
      },
    });
    const created = await createTask(op, { leadId: l.id, templateId: tpl.id }).expect(201);
    const id = created.body.id;
    expect(created.body.draftMessage).toBe('Halo Sari, salam dari @akun_b!');
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.allowedActions).toEqual(
      expect.arrayContaining(['submit', 'edit_draft', 'cancel']),
    );
    expect(created.body.allowedActions).not.toContain('approve');

    // Satu prospek hanya satu tugas terbuka
    await createTask(op, { leadId: l.id }).expect(409);

    // Tidak bisa langsung ditandai terkirim sebelum disetujui
    await act(op, id, { action: 'mark_sent', confirmed: true }).expect(409);

    await act(op, id, { action: 'submit' }).expect(200);
    await act(op, id, { action: 'approve' }).expect(403); // operator tidak punya outreach:review
    const rejected = await act(admin, id, {
      action: 'reject',
      reviewNote: 'Terlalu kaku, buat lebih santai',
    }).expect(200);
    expect(rejected.body.status).toBe('DRAFT');
    expect(rejected.body.reviewNote).toMatch(/santai/);

    await op.agent
      .patch(`/api/outbound/tasks/${id}/draft`)
      .set('x-csrf-token', op.csrf)
      .send({ draftMessage: 'Hai Sari! Aku dari @akun_b 👋' })
      .expect(200);
    await act(op, id, { action: 'submit' }).expect(200);
    const approved = await act(admin, id, { action: 'approve' }).expect(200);
    expect(approved.body.finalMessage).toBe('Hai Sari! Aku dari @akun_b 👋');

    // Status terkirim WAJIB dengan konfirmasi eksplisit
    await act(op, id, { action: 'mark_sent' }).expect(400);
    const sent = await act(op, id, { action: 'mark_sent', confirmed: true }).expect(200);
    expect(sent.body.status).toBe('MANUALLY_SENT');
    expect(sent.body.sentCount).toBe(1);
    expect(sent.body.sentConfirmedAt).not.toBeNull();

    let stored = await prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(stored.status).toBe('CONTACTED');
    expect(stored.lastContactedAt).not.toBeNull();

    const replied = await act(op, id, {
      action: 'log_reply',
      responseSummary: 'Tertarik, tanya cara daftar',
      interestLevel: 'HIGH',
    }).expect(200);
    expect(replied.body.status).toBe('REPLIED');
    stored = await prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(stored.status).toBe('INTERESTED');

    const done = await act(op, id, { action: 'complete', outcome: 'REGISTERED' }).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    stored = await prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(stored.status).toBe('REGISTERED');
    expect(stored.registeredAt).not.toBeNull();

    const timeline = await prisma.leadActivity.findMany({
      where: { leadId: l.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(timeline.map((a) => a.type)).toEqual([
      'MESSAGE_SENT',
      'MESSAGE_RECEIVED',
      'STATUS_CHANGE',
      'CONVERSION',
    ]);
  });

  async function sentTask(leadData: Record<string, unknown> = {}) {
    const l = await lead(leadData);
    const t = await createTask(op, { leadId: l.id, draftMessage: 'Halo, boleh kenalan?' }).expect(
      201,
    );
    await act(op, t.body.id, { action: 'submit' }).expect(200);
    await act(admin, t.body.id, { action: 'approve' }).expect(200);
    await act(op, t.body.id, { action: 'mark_sent', confirmed: true }).expect(200);
    return { lead: l, taskId: t.body.id as string };
  }
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

  it('follow-up tanpa balasan ditolak bila prospek belum memberi izin', async () => {
    const { taskId } = await sentTask();
    const res = await act(op, taskId, {
      action: 'schedule_follow_up',
      followUpAt: tomorrow(),
    }).expect(409);
    expect(res.body.message).toMatch(/izin komunikasi/);
  });

  it('follow-up dengan izin dibatasi maksimal 2 pesan tanpa balasan', async () => {
    const { lead: l, taskId } = await sentTask();
    await prisma.leadConsent.create({
      data: {
        leadId: l.id,
        channel: 'TIKTOK_DM',
        status: 'GRANTED',
        source: 'CONVERSATION',
        evidence: 'ok',
      },
    });
    const fu = await act(op, taskId, {
      action: 'schedule_follow_up',
      followUpAt: tomorrow(),
      draftMessage: 'Hai lagi, cuma mau follow-up 🙂',
    }).expect(200);
    expect(fu.body.status).toBe('FOLLOW_UP');
    expect(
      (await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).nextFollowUpAt,
    ).not.toBeNull();

    // Muncul di daftar follow-up setelah jatuh tempo
    await prisma.outreachTask.update({
      where: { id: taskId },
      data: { followUpAt: new Date(Date.now() - 1000) },
    });
    const due = await op.agent.get('/api/outbound/tasks?followUpDue=true').expect(200);
    expect(due.body.items.map((t: { id: string }) => t.id)).toEqual([taskId]);

    const second = await act(op, taskId, { action: 'mark_sent', confirmed: true }).expect(200);
    expect(second.body.sentCount).toBe(2);
    expect(second.body.finalMessage).toBe('Hai lagi, cuma mau follow-up 🙂');
    const limited = await act(op, taskId, {
      action: 'schedule_follow_up',
      followUpAt: tomorrow(),
    }).expect(409);
    expect(limited.body.message).toMatch(/tanpa balasan/);
  });

  it('pemeriksaan ulang saat kirim: prospek yang masuk DNC setelah disetujui tidak boleh dikirimi', async () => {
    const l = await lead();
    const t = await createTask(op, { leadId: l.id, draftMessage: 'Halo, boleh kenalan?' }).expect(
      201,
    );
    await act(op, t.body.id, { action: 'submit' }).expect(200);
    await act(admin, t.body.id, { action: 'approve' }).expect(200);
    await op.agent
      .post(`/api/leads/${l.id}/do-not-contact`)
      .set('x-csrf-token', op.csrf)
      .send({ reason: 'Minta berhenti' })
      .expect(200);
    // Tugas otomatis dibatalkan oleh penandaan DNC
    const task = await op.agent.get(`/api/outbound/tasks/${t.body.id}`).expect(200);
    expect(task.body.status).toBe('CANCELLED');
    await act(op, t.body.id, { action: 'mark_sent', confirmed: true }).expect(409);
  });

  it('balasan "stop" (opt-out) langsung menandai prospek jangan dihubungi', async () => {
    const { lead: l, taskId } = await sentTask();
    const res = await act(op, taskId, {
      action: 'log_reply',
      responseSummary: 'Balas: stop',
      interestLevel: 'LOW',
      optOut: true,
    }).expect(200);
    expect(res.body.status).toBe('COMPLETED');
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: l.id } });
    expect(stored.doNotContact).toBe(true);
    expect(await prisma.doNotContactEntry.count({ where: { valueNormalized: 'calon' } })).toBe(1);
  });

  it('batas harian tugas per akun ditegakkan', async () => {
    await prisma.systemSetting.create({
      data: { key: 'outbound.daily_task_limit_per_account', value: 1 },
    });
    const a = await lead({ tiktokUsernameNormalized: 'satu' });
    const b = await lead({ tiktokUsernameNormalized: 'dua' });
    await createTask(op, { leadId: a.id }).expect(201);
    const res = await createTask(op, { leadId: b.id }).expect(409);
    expect(res.body.message).toMatch(/Batas 1 tugas/);

    const summary = await op.agent.get(`/api/outbound/summary/${accountId}`).expect(200);
    expect(summary.body).toMatchObject({ dailyLimit: 1, createdToday: 1 });
    expect(summary.body.byStatus.DRAFT).toBe(1);
  });

  it('Viewer tidak dapat mengakses workstation', async () => {
    const viewer = await loginAs(app, 'VIEWER');
    await viewer.agent.get(`/api/outbound/queue?accountId=${accountId}`).expect(403);
  });
});
