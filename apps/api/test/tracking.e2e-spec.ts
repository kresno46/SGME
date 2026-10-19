import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, readCookie, resetDatabase, Session } from './utils';

const SECRET = 'conversion-secret-untuk-test-0123456789';
const DAY = 86_400_000;

describe('Tracking konversi & analitik (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let campA: { id: string; trackingCode: string };
  let campB: { id: string };
  let accountId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    admin = await loginAs(app, 'ADMIN');
    accountId = (
      await prisma.tikTokAccount.create({
        data: { username: 'akun_b', displayName: 'B', lane: 'OUTBOUND' },
      })
    ).id;
    campA = await prisma.campaign.create({
      data: {
        name: 'Campaign A',
        lane: 'OUTBOUND',
        type: 'REGISTRATION',
        status: 'ACTIVE',
        trackingCode: 'camp-a-123456',
        spend: 600_000,
      },
    });
    campB = await prisma.campaign.create({
      data: {
        name: 'Campaign B',
        lane: 'OFFICIAL',
        type: 'LEAD_ACQUISITION',
        status: 'ACTIVE',
        trackingCode: 'camp-b-123456',
        spend: 0,
      },
    });
  });
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const createLink = async (body: Record<string, unknown> = {}) =>
    (
      await admin.agent
        .post(`/api/campaigns/${campA.id}/tracking-links`)
        .set('x-csrf-token', admin.csrf)
        .send({
          destinationUrl: 'https://solidmini.example/daftar?lang=id',
          tiktokAccountId: accountId,
          name: 'Bio akun B',
          ...body,
        })
        .expect(201)
    ).body;
  const sendConversion = (
    payload: Record<string, unknown>,
    opts: { t?: number; secret?: string } = {},
  ) => {
    const body = JSON.stringify(payload);
    const t = opts.t ?? Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', opts.secret ?? SECRET)
      .update(`${t}.${body}`)
      .digest('hex');
    return http()
      .post('/api/conversions')
      .set('Content-Type', 'application/json')
      .set('X-SMGE-Timestamp', String(t))
      .set('X-SMGE-Signature', sig)
      .send(body);
  };

  it('link pendek: redirect dengan UTM, smge_ref & ID pengunjung; klik dicatat sekali; bot diabaikan', async () => {
    const link = await createLink();
    expect(link.shortUrl).toMatch(new RegExp(`/api/t/${link.code}$`));
    expect(link).toMatchObject({
      utmSource: 'tiktok',
      utmMedium: 'outbound',
      utmCampaign: 'camp-a-123456',
      utmContent: 'akun_b',
    });

    const res = await http()
      .get(`/api/t/${link.code}`)
      .set('User-Agent', 'Mozilla/5.0 (iPhone)')
      .expect(302);
    const dest = new URL(res.headers.location);
    expect(dest.origin + dest.pathname).toBe('https://solidmini.example/daftar');
    expect(Object.fromEntries(dest.searchParams)).toMatchObject({
      lang: 'id',
      utm_source: 'tiktok',
      utm_medium: 'outbound',
      utm_campaign: 'camp-a-123456',
      utm_content: 'akun_b',
      smge_ref: link.code,
    });
    const vid = dest.searchParams.get('smge_vid')!;
    expect(readCookie(res.headers['set-cookie'] as unknown as string[], 'smge_vid')).toBe(vid);

    // klik ulang oleh pengunjung yang sama → tidak dihitung lagi
    await http()
      .get(`/api/t/${link.code}`)
      .set('Cookie', `smge_vid=${vid}`)
      .set('User-Agent', 'Mozilla/5.0')
      .expect(302);
    // bot pratinjau link → tidak dihitung
    await http()
      .get(`/api/t/${link.code}`)
      .set('User-Agent', 'facebookexternalhit/1.1')
      .expect(302);

    const clicks = await prisma.conversionEvent.findMany({ where: { type: 'CTA_CLICK' } });
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({
      visitorId: vid,
      campaignId: campA.id,
      tiktokAccountId: accountId,
      isVerified: false,
    });
    expect(clicks[0].ipHash).not.toBe('::ffff:127.0.0.1');

    // link nonaktif tetap mengarahkan, tapi tidak mencatat
    await admin.agent
      .patch(`/api/tracking-links/${link.id}`)
      .set('x-csrf-token', admin.csrf)
      .send({ isActive: false })
      .expect(200);
    await http().get(`/api/t/${link.code}`).set('User-Agent', 'Mozilla/5.0 Lain').expect(302);
    expect(await prisma.conversionEvent.count()).toBe(1);

    await http().get('/api/t/tidakada').expect(404);
    const list = await admin.agent.get(`/api/campaigns/${campA.id}/tracking-links`).expect(200);
    expect(list.body[0].stats).toEqual({ clicks: 1, uniqueVisitors: 1, registrations: 0 });
  });

  it('event landing page publik: tervalidasi, tidak terverifikasi, tanpa CSRF', async () => {
    const link = await createLink();
    await http()
      .post('/api/track/events')
      .send({ type: 'LANDING_VISIT', ref: link.code, visitorId: 'pengunjung_01' })
      .expect(200);
    await http()
      .post('/api/track/events')
      .send({ type: 'STORE_CLICK', ref: 'camp-a-123456', visitorId: 'pengunjung_01' })
      .expect(200);
    // event server tidak boleh dikirim dari browser
    await http()
      .post('/api/track/events')
      .send({ type: 'REGISTRATION', visitorId: 'pengunjung_01' })
      .expect(400);
    const events = await prisma.conversionEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => [e.type, e.campaignId, e.isVerified])).toEqual([
      ['LANDING_VISIT', campA.id, false],
      ['STORE_CLICK', campA.id, false],
    ]);
  });

  it('Conversion API: autentikasi HMAC wajib', async () => {
    const payload = {
      eventId: 'e-1',
      type: 'REGISTRATION',
      occurredAt: new Date().toISOString(),
      externalUserId: 'u-1',
    };
    await http().post('/api/conversions').send(payload).expect(401);
    await sendConversion(payload, { secret: 'secret-yang-salah-0000000000000000000' }).expect(401);
    await sendConversion(payload, { t: Math.floor(Date.now() / 1000) - 3600 }).expect(401);
    await sendConversion({ ...payload, type: 'CTA_CLICK' }).expect(400);
    expect(await prisma.conversionEvent.count()).toBe(0);
  });

  it('registrasi terverifikasi: cocokkan prospek, atribusi first/last-touch, idempoten', async () => {
    const link = await createLink();
    const now = Date.now();
    // prospek dari Campaign B (10 hari lalu), lalu pengunjung klik link Campaign A (3 hari lalu)
    const lead = await prisma.lead.create({
      data: {
        name: 'Rina',
        email: 'rina@contoh.co',
        emailNormalized: 'rina@contoh.co',
        source: 'TIKTOK_LEAD_GEN',
        sourceCampaignId: campB.id,
        createdAt: new Date(now - 10 * DAY),
        nextFollowUpAt: new Date(now + DAY),
      },
    });
    await prisma.conversionEvent.create({
      data: {
        type: 'CTA_CLICK',
        occurredAt: new Date(now - 3 * DAY),
        campaignId: campA.id,
        trackingLinkId: link.id,
        tiktokAccountId: accountId,
        visitorId: 'vid_rina_001',
      },
    });

    const payload = {
      eventId: 'reg-1001',
      type: 'REGISTRATION',
      occurredAt: new Date(now - 60_000).toISOString(),
      externalUserId: 'sm-user-1',
      visitorId: 'vid_rina_001',
      contact: { email: 'RINA@contoh.co' },
    };
    const res = await sendConversion(payload).expect(200);
    expect(res.body).toMatchObject({
      duplicate: false,
      leadMatched: true,
      attribution: { firstTouch: { id: campB.id }, lastTouch: { id: campA.id } },
    });

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated).toMatchObject({
      status: 'REGISTERED',
      solidMiniUserId: 'sm-user-1',
      nextFollowUpAt: null,
    });
    expect(updated.registrationVerifiedAt).not.toBeNull();
    expect(
      await prisma.leadActivity.count({ where: { leadId: lead.id, type: 'CONVERSION' } }),
    ).toBe(1);

    // kirim ulang (retry jaringan) → idempoten
    const dup = await sendConversion(payload).expect(200);
    expect(dup.body.duplicate).toBe(true);
    expect(await prisma.conversionEvent.count({ where: { type: 'REGISTRATION' } })).toBe(1);

    // aktivasi kemudian: dicocokkan lewat ID pengguna Solid Mini, visitor diambil dari event sebelumnya
    const act = await sendConversion({
      eventId: 'act-1001',
      type: 'ACTIVATION',
      occurredAt: new Date().toISOString(),
      externalUserId: 'sm-user-1',
    }).expect(200);
    expect(act.body.attribution.lastTouch.id).toBe(campA.id);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('ACTIVE');

    const links = await admin.agent.get(`/api/campaigns/${campA.id}/tracking-links`).expect(200);
    expect(links.body[0].stats.registrations).toBe(0); // registrasi via visitor, bukan link langsung di payload
  });

  it('laporan: registrasi terverifikasi vs konfirmasi operator, biaya per registrasi, model atribusi', async () => {
    const now = Date.now();
    const leadA = await prisma.lead.create({
      data: { name: 'X', source: 'MANUAL', sourceCampaignId: campA.id, sourceAccountId: accountId },
    });
    await prisma.lead.create({
      data: {
        name: 'Y',
        source: 'MANUAL',
        sourceCampaignId: campA.id,
        registeredAt: new Date(),
        status: 'REGISTERED',
      },
    }); // konfirmasi operator
    await prisma.lead.create({ data: { name: 'Sim', source: 'MANUAL', dataSource: 'SIMULATED' } });
    await prisma.conversionEvent.createMany({
      data: [
        {
          type: 'CTA_CLICK',
          occurredAt: new Date(now - 2 * DAY),
          campaignId: campA.id,
          visitorId: 'visitor_01',
        },
        {
          type: 'CTA_CLICK',
          occurredAt: new Date(now - 2 * DAY),
          campaignId: campA.id,
          visitorId: 'visitor_02',
        },
        {
          type: 'LANDING_VISIT',
          occurredAt: new Date(now - 2 * DAY),
          campaignId: campA.id,
          visitorId: 'visitor_01',
        },
      ],
    });
    await sendConversion({
      eventId: 'r1',
      type: 'REGISTRATION',
      occurredAt: new Date(now - DAY).toISOString(),
      externalUserId: 'u1',
      visitorId: 'visitor_01',
    }).expect(200);
    await sendConversion({
      eventId: 'r2',
      type: 'REGISTRATION',
      occurredAt: new Date(now - DAY).toISOString(),
      externalUserId: 'u2',
      ref: 'camp-b-123456',
    }).expect(200);

    const rep = await admin.agent.get('/api/analytics/report?days=30').expect(200);
    expect(rep.body.kpis).toMatchObject({
      leads: 2, // data simulasi tidak dihitung
      visitors: 2,
      registrationsVerified: 2,
      registrationsOperator: 1,
      spend: 600_000,
      costPerLead: 300_000,
      costPerRegistration: 300_000,
      conversionRate: 100,
    });
    const funnel = Object.fromEntries(
      rep.body.funnel.map((f: { type: string; count: number }) => [f.type, f.count]),
    );
    expect(funnel).toMatchObject({
      LANDING_VISIT: 1,
      CTA_CLICK: 2,
      REGISTRATION: 2,
      INSTALL_VERIFIED: 0,
    });

    const camp = (id: string) => rep.body.campaigns.find((c: { id: string }) => c.id === id);
    expect(camp(campA.id)).toMatchObject({
      leads: 2,
      visitors: 2,
      registrations: 1,
      costPerRegistration: 600_000,
      conversionRate: 50,
    });
    expect(camp(campB.id)).toMatchObject({ registrations: 1, costPerLead: null });

    const lanes = Object.fromEntries(
      rep.body.lanes.map((l: { lane: string; registrations: number }) => [l.lane, l.registrations]),
    );
    expect(lanes).toEqual({ OFFICIAL: 1, OUTBOUND: 1 });

    const filtered = await admin.agent
      .get(`/api/analytics/report?days=30&campaignId=${campA.id}`)
      .expect(200);
    expect(filtered.body.kpis.registrationsVerified).toBe(1);
    expect(rep.body.accounts[0]).toMatchObject({ username: 'akun_b', leads: 1 });
    expect(leadA).toBeDefined();

    const overview = await admin.agent.get('/api/analytics/overview').expect(200);
    expect(overview.body.metrics.registrations).toEqual({ value: 2, source: 'ACTUAL' });
    expect(overview.body.metrics.registrationsOperator).toEqual({ value: 1, source: 'MANUAL' });

    const viewer = await loginAs(app, 'VIEWER');
    await viewer.agent.get('/api/analytics/report').expect(200);
  });

  it('hanya pengelola campaign yang dapat membuat link', async () => {
    const op = await loginAs(app, 'MARKETING_OPERATOR');
    await op.agent.get(`/api/campaigns/${campA.id}/tracking-links`).expect(200);
    await op.agent
      .post(`/api/campaigns/${campA.id}/tracking-links`)
      .set('x-csrf-token', op.csrf)
      .send({ destinationUrl: 'https://x.example' })
      .expect(403);
  });
});
