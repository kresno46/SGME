import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { LoginKitAdapter } from '../src/integrations/tiktok/login-kit.adapter';
import { MockLoginKitAdapter } from '../src/integrations/tiktok/mock-login-kit.adapter';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDatabase, Session } from './utils';

/** Server TikTok palsu untuk adapter resmi (meniru format respons dokumentasi). */
const tiktok = {
  username: 'solid.official',
  scope: 'user.info.basic,user.info.profile,user.info.stats',
  followers: 321_000,
};
const fakeFetch = (async (url: string) => {
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  if (url.startsWith('https://open.tiktokapis.com/v2/oauth/token/')) {
    return json({
      access_token: 'real-at',
      refresh_token: 'real-rt',
      expires_in: 86400,
      refresh_expires_in: 31536000,
      open_id: 'open-123',
      scope: tiktok.scope,
      token_type: 'Bearer',
    });
  }
  if (url.startsWith('https://open.tiktokapis.com/v2/oauth/revoke/'))
    return new Response('', { status: 200 });
  if (url.startsWith('https://open.tiktokapis.com/v2/user/info/')) {
    return json({
      data: {
        user: {
          open_id: 'open-123',
          username: tiktok.username,
          display_name: 'Solid Mini Official',
          is_verified: true,
          follower_count: tiktok.followers,
        },
      },
      error: { code: 'ok', message: '', log_id: 'log-1' },
    });
  }
  return new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

describe('Integrasi TikTok (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Session;
  let officialId: string;
  let outboundId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({
      tiktok: {
        loginKit: new LoginKitAdapter(
          'test-client-key',
          'test-client-secret',
          'https://smge.test/api/integrations/tiktok/callback',
          tiktok.scope,
          fakeFetch,
        ),
        mock: new MockLoginKitAdapter('http://dashboard.test'),
      },
    }));
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    tiktok.username = 'solid.official';
    tiktok.scope = 'user.info.basic,user.info.profile,user.info.stats';
    admin = await loginAs(app, 'ADMIN');
    officialId = (
      await prisma.tikTokAccount.create({
        data: {
          username: 'solid.official',
          displayName: 'Lama',
          lane: 'OFFICIAL',
          followersCount: 100,
        },
      })
    ).id;
    outboundId = (
      await prisma.tikTokAccount.create({
        data: { username: 'akun.b', displayName: 'B', lane: 'OUTBOUND' },
      })
    ).id;
  });
  afterAll(() => app.close());

  const startConnect = async (accountId: string, provider: 'TIKTOK_LOGIN_KIT' | 'MOCK') => {
    const res = await admin.agent
      .post(`/api/integrations/tiktok/accounts/${accountId}/connect`)
      .set('x-csrf-token', admin.csrf)
      .send({ provider })
      .expect(200);
    return new URL(res.body.authorizeUrl).searchParams.get('state')!;
  };
  const callback = (q: Record<string, string>) =>
    request(app.getHttpServer()).get('/api/integrations/tiktok/callback').query(q).expect(302);

  it('Login Kit resmi: otorisasi → token terenkripsi → profil & followers ACTUAL', async () => {
    const res = await admin.agent
      .post(`/api/integrations/tiktok/accounts/${officialId}/connect`)
      .set('x-csrf-token', admin.csrf)
      .send({ provider: 'TIKTOK_LOGIN_KIT' })
      .expect(200);
    expect(res.body.authorizeUrl).toMatch(
      /^https:\/\/www\.tiktok\.com\/v2\/auth\/authorize\/\?client_key=test-client-key/,
    );
    const state = new URL(res.body.authorizeUrl).searchParams.get('state')!;

    const cb = await callback({ code: 'kode-asli', state, scopes: tiktok.scope });
    expect(cb.headers.location).toBe(`http://dashboard.test/integrations?connected=${officialId}`);

    const i = await prisma.accountIntegration.findFirstOrThrow({
      where: { tiktokAccountId: officialId },
    });
    expect(i).toMatchObject({
      provider: 'TIKTOK_LOGIN_KIT',
      status: 'CONNECTED',
      externalId: 'open-123',
      isSimulation: false,
    });
    expect(i.accessTokenEncrypted).not.toContain('real-at'); // tersimpan terenkripsi
    const acc = await prisma.tikTokAccount.findUniqueOrThrow({ where: { id: officialId } });
    expect(acc).toMatchObject({
      followersCount: 321_000,
      followersSource: 'ACTUAL',
      isVerified: true,
      displayName: 'Solid Mini Official',
    });

    // token tidak pernah keluar lewat API
    const detail = await admin.agent.get(`/api/tiktok-accounts/${officialId}`).expect(200);
    expect(JSON.stringify(detail.body)).not.toMatch(/real-at|real-rt|Encrypted/);
    const logs = await admin.agent.get('/api/integrations/logs').expect(200);
    expect(JSON.stringify(logs.body)).not.toMatch(/real-at|real-rt|test-client-secret/);
  });

  it('menolak akun TikTok yang berbeda dan scope profil yang tidak disetujui', async () => {
    tiktok.username = 'akun.lain';
    let state = await startConnect(officialId, 'TIKTOK_LOGIN_KIT');
    let cb = await callback({ code: 'x', state });
    expect(decodeURIComponent(cb.headers.location)).toMatch(
      /@akun\.lain\) berbeda dengan @solid\.official/,
    );

    tiktok.username = 'solid.official';
    tiktok.scope = 'user.info.basic';
    state = await startConnect(officialId, 'TIKTOK_LOGIN_KIT');
    cb = await callback({ code: 'x', state });
    expect(decodeURIComponent(cb.headers.location)).toMatch(/user\.info\.profile/);
    expect(await prisma.accountIntegration.count()).toBe(0);
  });

  it('state hanya bisa dipakai sekali; state palsu & penolakan pengguna ditangani', async () => {
    const state = await startConnect(outboundId, 'MOCK');
    await callback({ code: 'mock:akun.b', state });
    const reuse = await callback({ code: 'mock:akun.b', state });
    expect(decodeURIComponent(reuse.headers.location)).toMatch(/sudah dipakai/);

    const fake = await callback({ code: 'x', state: 'palsu' });
    expect(decodeURIComponent(fake.headers.location)).toMatch(/tidak valid/);

    const denied = await callback({
      error: 'access_denied',
      state: await startConnect(outboundId, 'MOCK'),
    });
    expect(decodeURIComponent(denied.headers.location)).toMatch(/dibatalkan/);
  });

  it('Mock: data berlabel simulasi; sinkron me-refresh token kedaluwarsa; putus koneksi menghapus token', async () => {
    const state = await startConnect(outboundId, 'MOCK');
    await callback({ code: 'mock:akun.b', state });
    const i = await prisma.accountIntegration.findFirstOrThrow({
      where: { tiktokAccountId: outboundId },
    });
    expect(i).toMatchObject({ provider: 'MOCK', isSimulation: true, status: 'CONNECTED' });
    expect(
      (await prisma.tikTokAccount.findUniqueOrThrow({ where: { id: outboundId } })).followersSource,
    ).toBe('SIMULATED');

    await prisma.accountIntegration.update({
      where: { id: i.id },
      data: { tokenExpiresAt: new Date(Date.now() - 1000) },
    });
    const sync = await admin.agent
      .post(`/api/integrations/${i.id}/sync`)
      .set('x-csrf-token', admin.csrf)
      .send({})
      .expect(200);
    expect(sync.body.status).toBe('CONNECTED');
    expect(
      await prisma.integrationLog.count({
        where: { operation: 'oauth.refresh', integrationId: i.id },
      }),
    ).toBe(1);
    const refreshed = await prisma.accountIntegration.findUniqueOrThrow({ where: { id: i.id } });
    expect(refreshed.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    // refresh token kedaluwarsa → TOKEN_EXPIRED, perlu hubungkan ulang
    await prisma.accountIntegration.update({
      where: { id: i.id },
      data: { tokenExpiresAt: new Date(0), refreshExpiresAt: new Date(0) },
    });
    const expired = await admin.agent
      .post(`/api/integrations/${i.id}/sync`)
      .set('x-csrf-token', admin.csrf)
      .send({})
      .expect(200);
    expect(expired.body.status).toBe('TOKEN_EXPIRED');

    await admin.agent
      .post(`/api/integrations/${i.id}/disconnect`)
      .set('x-csrf-token', admin.csrf)
      .send({})
      .expect(200);
    const gone = await prisma.accountIntegration.findUniqueOrThrow({ where: { id: i.id } });
    expect(gone).toMatchObject({
      status: 'REVOKED',
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
    });
  });

  describe('webhook', () => {
    const post = (body: string, sig?: string) => {
      const r = request(app.getHttpServer())
        .post('/api/webhooks/tiktok')
        .set('Content-Type', 'application/json');
      if (sig) r.set('TikTok-Signature', sig);
      return r.send(body);
    };
    const sign = (body: string, t = Math.floor(Date.now() / 1000)) =>
      `t=${t},s=${createHmac('sha256', 'test-client-secret').update(`${t}.${body}`).digest('hex')}`;

    it('authorization.removed mencabut integrasi; duplikat diabaikan; signature salah ditolak', async () => {
      const state = await startConnect(officialId, 'TIKTOK_LOGIN_KIT');
      await callback({ code: 'x', state });

      const body = JSON.stringify({
        client_key: 'test-client-key',
        event: 'authorization.removed',
        create_time: Math.floor(Date.now() / 1000),
        user_openid: 'open-123',
        content: JSON.stringify({ reason: 1 }),
      });
      await post(body).expect(400);
      await post(body, sign(body + 'x')).expect(400);
      await post(body, sign(body, Math.floor(Date.now() / 1000) - 3600)).expect(400);

      const ok = await post(body, sign(body)).expect(200);
      expect(ok.body).toMatchObject({ handled: true, affected: 1 });
      const i = await prisma.accountIntegration.findFirstOrThrow({
        where: { tiktokAccountId: officialId },
      });
      expect(i.status).toBe('REVOKED');
      expect(i.lastError).toMatch(/pengguna memutus/);
      expect(i.accessTokenEncrypted).toBeNull();

      const dup = await post(body, sign(body)).expect(200);
      expect(dup.body.duplicate).toBe(true);
      expect(await prisma.integrationLog.count({ where: { operation: 'webhook.rejected' } })).toBe(
        3,
      );
    });

    it('client_key berbeda ditolak', async () => {
      const body = JSON.stringify({
        client_key: 'lain',
        event: 'video.publish.completed',
        create_time: 1,
      });
      await post(body, sign(body)).expect(400);
    });
  });

  it('ringkasan integrasi & hak akses', async () => {
    const overview = await admin.agent.get('/api/integrations/overview').expect(200);
    const cap = Object.fromEntries(
      overview.body.capabilities.map((c: { key: string; status: string }) => [c.key, c.status]),
    );
    expect(cap).toMatchObject({
      LOGIN_KIT: 'READY',
      WEBHOOK: 'READY',
      MOCK: 'SIMULATION',
      BUSINESS_API: 'NOT_VERIFIED',
      MESSAGING: 'NOT_VERIFIED',
      CONVERSION_API: 'READY',
    });
    expect(overview.body.connectProviders).toEqual(['TIKTOK_LOGIN_KIT', 'MOCK']);
    expect(overview.body.webhookUrl).toBe('http://dashboard.test/api/webhooks/tiktok');

    const viewer = await loginAs(app, 'VIEWER');
    await viewer.agent.get('/api/integrations/overview').expect(200);
    const op = await loginAs(app, 'MARKETING_OPERATOR');
    await op.agent
      .post(`/api/integrations/tiktok/accounts/${officialId}/connect`)
      .set('x-csrf-token', op.csrf)
      .send({ provider: 'MOCK' })
      .expect(403);
  });
});
