import type { INestApplication } from '@nestjs/common';
import {
  LlmProvider,
  LlmProviderError,
  LlmRequest,
  LlmResponse,
} from '../src/ai/providers/llm-provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDatabase, Session } from './utils';

/** Provider palsu: jawaban diatur per test; mencatat request terakhir untuk diperiksa. */
class FakeProvider implements LlmProvider {
  readonly name = 'openai' as const;
  readonly simulated = false;
  readonly defaultModel = 'model-uji';
  next: unknown | Error = null;
  lastRequest: LlmRequest | null = null;

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.lastRequest = req;
    if (this.next instanceof Error) throw this.next;
    return {
      content: JSON.stringify(this.next),
      model: req.model,
      promptTokens: 1000,
      completionTokens: 200,
    };
  }
}

describe('AI Sales Agent (integration, provider palsu)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let op: Session;
  const fake = new FakeProvider();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ llm: fake }));
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    fake.next = null;
    fake.lastRequest = null;
    admin = await loginAs(app, 'ADMIN');
    op = await loginAs(app, 'MARKETING_OPERATOR');
  });
  afterAll(() => app.close());

  const publish = (title: string, content: string, category = 'FAQ') =>
    admin.agent
      .post('/api/knowledge-documents')
      .set('x-csrf-token', admin.csrf)
      .send({ title, category, content, status: 'PUBLISHED' })
      .expect(201);

  it('Knowledge Base: CRUD, versi naik saat isi berubah, operator hanya bisa membaca', async () => {
    const doc = await publish(
      'Cara daftar',
      'Unduh aplikasi Solid Mini lalu pilih menu Daftar dan isi data diri.',
      'REGISTRATION',
    );
    expect(doc.body.version).toBe(1);
    expect(doc.body.publishedAt).not.toBeNull();

    const updated = await admin.agent
      .patch(`/api/knowledge-documents/${doc.body.id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ content: 'Unduh aplikasi Solid Mini dari Play Store, lalu pilih menu Daftar.' })
      .expect(200);
    expect(updated.body.version).toBe(2);

    await op.agent.get('/api/knowledge-documents').expect(200);
    await op.agent
      .post('/api/knowledge-documents')
      .set('x-csrf-token', op.csrf)
      .send({ title: 'X', category: 'FAQ', content: 'x'.repeat(30) })
      .expect(403);
  });

  it('tanya jawab: KB kosong → handoff tanpa memanggil model', async () => {
    const res = await op.agent
      .post('/api/ai/ask')
      .set('x-csrf-token', op.csrf)
      .send({ question: 'Berapa biaya langganan Solid Mini?' })
      .expect(200);
    expect(res.body).toMatchObject({ handoff: true, interactionId: null });
    expect(fake.lastRequest).toBeNull();
  });

  it('tanya jawab memakai dokumen KB yang relevan, mencatat token & biaya sesuai harga yang diatur', async () => {
    await publish(
      'Biaya langganan',
      'Biaya langganan Solid Mini adalah contoh-harga-uji per bulan.',
      'PRICING',
    );
    await publish(
      'Cara instal',
      'Instal Solid Mini dari Play Store atau App Store.',
      'INSTALLATION',
    );
    await prisma.systemSetting.createMany({
      data: [
        { key: 'ai.model', value: 'model-uji' },
        { key: 'ai.pricing', value: { 'model-uji': { inputPer1M: 1, outputPer1M: 4 } } },
      ],
    });
    fake.next = {
      answer: 'Biayanya contoh-harga-uji per bulan, Kak.',
      handoff: false,
      handoffReason: '',
      usedSourceNumbers: [1],
    };

    const res = await op.agent
      .post('/api/ai/ask')
      .set('x-csrf-token', op.csrf)
      .send({ question: 'Berapa biaya langganan bulanan?' })
      .expect(200);
    expect(res.body.answer).toContain('contoh-harga-uji');
    expect(res.body.sources).toEqual([{ id: expect.any(String), title: 'Biaya langganan' }]);
    // (1000 × $1 + 200 × $4) / 1 juta
    expect(res.body.usage).toEqual({ promptTokens: 1000, completionTokens: 200, costUsd: 0.0018 });

    // Dokumen paling relevan diletakkan pertama; aturan & penanda data ada di prompt sistem
    expect(fake.lastRequest!.system).toMatch(/\[1\] Biaya langganan/);
    expect(fake.lastRequest!.system).toMatch(/Jangan pernah menjanjikan keuntungan/);
    expect(fake.lastRequest!.schemaName).toBe('knowledge_answer');

    const log = await prisma.aiInteraction.findFirstOrThrow();
    expect(log).toMatchObject({
      type: 'KNOWLEDGE_QA',
      status: 'SUCCESS',
      totalTokens: 1200,
      isSimulation: false,
    });
    expect(Number(log.costUsd)).toBeCloseTo(0.0018);
  });

  it('guardrail memblokir jawaban yang menjanjikan keuntungan', async () => {
    await publish(
      'Profil',
      'Solid Mini adalah aplikasi untuk membantu pengguna memantau pasar.',
      'PRODUCT_PROFILE',
    );
    fake.next = {
      answer: 'Tenang Kak, pakai Solid Mini dijamin untung tiap bulan!',
      handoff: false,
      handoffReason: '',
      usedSourceNumbers: [1],
    };
    const res = await op.agent
      .post('/api/ai/ask')
      .set('x-csrf-token', op.csrf)
      .send({ question: 'Apa itu Solid Mini?' })
      .expect(422);
    expect(res.body.message).toMatch(/diblokir/);
    expect(res.body.details.claims[0].code).toBe('PROFIT_GUARANTEE');
    expect(await prisma.aiInteraction.count({ where: { status: 'BLOCKED' } })).toBe(1);
  });

  it('kegagalan provider dicatat sebagai FAILED dan dikembalikan sebagai 502 yang jelas', async () => {
    await publish(
      'Profil',
      'Solid Mini adalah aplikasi untuk membantu pengguna memantau pasar.',
      'PRODUCT_PROFILE',
    );
    fake.next = new LlmProviderError('Kuota/rate limit OpenAI tercapai. Coba lagi nanti.', true);
    const res = await op.agent
      .post('/api/ai/ask')
      .set('x-csrf-token', op.csrf)
      .send({ question: 'Apa itu Solid Mini?' })
      .expect(502);
    expect(res.body.message).toMatch(/Kuota/);
    expect(await prisma.aiInteraction.count({ where: { status: 'FAILED' } })).toBe(1);

    fake.next = { tidak: 'sesuai skema' };
    await op.agent
      .post('/api/ai/ask')
      .set('x-csrf-token', op.csrf)
      .send({ question: 'Apa itu Solid Mini?' })
      .expect(502);
  });

  it('batas biaya bulanan menghentikan pemanggilan AI', async () => {
    await publish(
      'Profil',
      'Solid Mini adalah aplikasi untuk membantu pengguna memantau pasar.',
      'PRODUCT_PROFILE',
    );
    await prisma.systemSetting.create({ data: { key: 'ai.monthly_budget_usd', value: 0.001 } });
    await prisma.aiInteraction.create({
      data: { type: 'KNOWLEDGE_QA', model: 'model-uji', costUsd: 0.002 },
    });
    const res = await op.agent
      .post('/api/ai/ask')
      .set('x-csrf-token', op.csrf)
      .send({ question: 'Apa itu Solid Mini?' })
      .expect(403);
    expect(res.body.message).toMatch(/Batas biaya AI/);
  });

  it('draft outbound: data kontak prospek tidak dikirim ke penyedia AI; hanya untuk status Draft/Follow-up', async () => {
    const account = await prisma.tikTokAccount.create({
      data: { username: 'akun_b', displayName: 'B', lane: 'OUTBOUND' },
    });
    const lead = await prisma.lead.create({
      data: {
        name: 'Dewi Lestari',
        email: 'dewi@rahasia.co',
        emailNormalized: 'dewi@rahasia.co',
        phone: '081234500000',
        phoneNormalized: '6281234500000',
        tiktokUsername: 'dewi_rahasia',
        tiktokUsernameNormalized: 'dewi_rahasia',
        source: 'TIKTOK_LEAD_GEN',
      },
    });
    const task = await op.agent
      .post('/api/outbound/tasks')
      .set('x-csrf-token', op.csrf)
      .send({ leadId: lead.id, tiktokAccountId: account.id })
      .expect(201);
    fake.next = {
      message: 'Halo Kak Dewi! Aku dari @akun_b, boleh kenalan soal Solid Mini?',
      rationale: 'Sapaan ramah',
    };

    const res = await op.agent
      .post('/api/ai/outreach-draft')
      .set('x-csrf-token', op.csrf)
      .send({ taskId: task.body.id, instructions: 'santai' })
      .expect(200);
    expect(res.body.message).toMatch(/Kak Dewi/);
    const sent = `${fake.lastRequest!.system}\n${fake.lastRequest!.user}`;
    expect(sent).toContain('Nama panggilan: Dewi');
    expect(sent).not.toMatch(/dewi@rahasia\.co|0812345|6281234500000|dewi_rahasia|Lestari/);

    // Menerapkan saran AI ke draft menandai tugas aiGenerated
    const applied = await op.agent
      .patch(`/api/outbound/tasks/${task.body.id}/draft`)
      .set('x-csrf-token', op.csrf)
      .send({ draftMessage: res.body.message, aiGenerated: true })
      .expect(200);
    expect(applied.body.aiGenerated).toBe(true);

    await op.agent
      .post(`/api/outbound/tasks/${task.body.id}/actions`)
      .set('x-csrf-token', op.csrf)
      .send({ action: 'submit' })
      .expect(200);
    await op.agent
      .post('/api/ai/outreach-draft')
      .set('x-csrf-token', op.csrf)
      .send({ taskId: task.body.id })
      .expect(409);
  });

  it('skor prospek menyimpan skor & riwayat; ringkasan tercatat di timeline', async () => {
    const lead = await prisma.lead.create({ data: { name: 'Andi', source: 'INBOUND_DM' } });
    fake.next = {
      score: 72,
      interestLevel: 'HIGH',
      reasons: ['Bertanya cara daftar'],
      recommendedAction: 'Kirim panduan registrasi',
    };
    const score = await op.agent
      .post(`/api/ai/leads/${lead.id}/score`)
      .set('x-csrf-token', op.csrf)
      .send({})
      .expect(200);
    expect(score.body.score).toBe(72);
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored.score).toBe(72);
    expect(stored.interestLevel).toBe('UNKNOWN'); // ketertarikan tetap diputuskan operator

    fake.next = {
      summary: 'Andi bertanya cara daftar.',
      keyPoints: ['Tertarik'],
      nextStep: 'Kirim panduan',
    };
    await op.agent
      .post(`/api/ai/leads/${lead.id}/summary`)
      .set('x-csrf-token', op.csrf)
      .send({})
      .expect(200);
    const activities = await prisma.leadActivity.findMany({
      where: { leadId: lead.id, type: 'AI_ANALYSIS' },
    });
    expect(activities).toHaveLength(2);
  });

  it('pengaturan: hanya Super Admin; Auto-Reply ditolak selama belum ada kanal resmi', async () => {
    await admin.agent.get('/api/ai/settings').expect(403);
    const sa = await loginAs(app, 'SUPER_ADMIN');
    const bad = await sa.agent
      .put('/api/ai/settings')
      .set('x-csrf-token', sa.csrf)
      .send({ mode: 'AUTO_REPLY' })
      .expect(400);
    expect(bad.body.errors.mode).toBeDefined();
    const ok = await sa.agent
      .put('/api/ai/settings')
      .set('x-csrf-token', sa.csrf)
      .send({
        model: 'model-lain',
        mode: 'COPILOT',
        monthlyBudgetUsd: 25,
        pricing: { 'model-lain': { inputPer1M: 0.2, outputPer1M: 0.8 } },
      })
      .expect(200);
    expect(ok.body).toMatchObject({ model: 'model-lain', monthlyBudgetUsd: 25 });

    const status = await op.agent.get('/api/ai/status').expect(200);
    expect(status.body).toMatchObject({
      configured: true,
      model: 'model-lain',
      priceConfigured: true,
      simulated: false,
    });
  });

  it('laporan penggunaan memisahkan interaksi simulasi', async () => {
    await prisma.aiInteraction.createMany({
      data: [
        { type: 'KNOWLEDGE_QA', model: 'model-uji', totalTokens: 100, costUsd: 0.01 },
        {
          type: 'LEAD_SCORING',
          model: 'model-uji',
          totalTokens: 50,
          costUsd: 0.02,
          status: 'FAILED',
        },
        { type: 'KNOWLEDGE_QA', model: 'simulasi', totalTokens: 999, isSimulation: true },
      ],
    });
    const res = await admin.agent.get('/api/ai/usage?days=7').expect(200);
    expect(res.body.totals).toMatchObject({ interactions: 2, failed: 1, simulated: 1 });
    expect(res.body.totals.costUsd).toBeCloseTo(0.03);
    expect(res.body.byDay).toHaveLength(7);
    expect(res.body.byDay.at(-1).interactions).toBe(2);
  });
});

describe('AI tanpa provider', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app.close());

  it('status melaporkan belum dikonfigurasi dan fitur AI mengembalikan 503', async () => {
    const op = await loginAs(app, 'MARKETING_OPERATOR');
    const status = await op.agent.get('/api/ai/status').expect(200);
    expect(status.body).toMatchObject({ configured: false, provider: null });
    expect(status.body.notReadyReason).toMatch(/OPENAI_API_KEY/);
    await prisma.knowledgeDocument.create({
      data: {
        title: 'Profil',
        category: 'PRODUCT_PROFILE',
        content: 'Solid Mini adalah aplikasi.',
        status: 'PUBLISHED',
      },
    });
    await op.agent
      .post('/api/ai/ask')
      .set('x-csrf-token', op.csrf)
      .send({ question: 'Apa itu Solid Mini?' })
      .expect(503);
  });

  it('Viewer tidak dapat memakai AI', async () => {
    const viewer = await loginAs(app, 'VIEWER');
    await viewer.agent.get('/api/ai/status').expect(403);
  });
});
