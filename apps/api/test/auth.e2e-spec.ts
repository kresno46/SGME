import type { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';
import { MailService } from '../src/auth/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createTestApp,
  loginAs,
  readCookie,
  resetDatabase,
  TEST_PASSWORD,
  TEST_USERS,
} from './utils';

describe('Autentikasi (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  it('login berhasil menyetel cookie httpOnly dan /auth/me mengembalikan profil', async () => {
    const res = await http()
      .post('/api/auth/login')
      .send({ email: TEST_USERS.ADMIN, password: TEST_PASSWORD })
      .expect(200);
    expect(res.body.status).toBe('AUTHENTICATED');
    expect(res.body.user.role).toBe('ADMIN');

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((c) => c.startsWith('smge_at='))).toMatch(/HttpOnly/);
    expect(cookies.find((c) => c.startsWith('smge_rt='))).toMatch(/HttpOnly/);
    expect(cookies.find((c) => c.startsWith('smge_csrf='))).not.toMatch(/HttpOnly/);

    const { agent } = await loginAs(app, 'ADMIN');
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.email).toBe(TEST_USERS.ADMIN);
    expect(me.body).not.toHaveProperty('passwordHash');

    expect(await prisma.auditLog.count({ where: { action: 'auth.login' } })).toBe(2);
  });

  it('pesan error identik untuk email tidak terdaftar dan password salah', async () => {
    const a = await http()
      .post('/api/auth/login')
      .send({ email: 'tidakada@test.local', password: 'x' })
      .expect(401);
    const b = await http()
      .post('/api/auth/login')
      .send({ email: TEST_USERS.ADMIN, password: 'salah' })
      .expect(401);
    expect(a.body.message).toBe('Email atau password salah');
    expect(b.body.message).toBe(a.body.message);
  });

  it('endpoint terlindungi menolak request tanpa sesi', async () => {
    const res = await http().get('/api/tiktok-accounts').expect(401);
    expect(res.body.message).toMatch(/login kembali/);
  });

  it('mengunci akun setelah percobaan gagal berulang dan admin dapat membukanya', async () => {
    for (let i = 0; i < 3; i++) {
      await http().post('/api/auth/login').send({ email: TEST_USERS.VIEWER, password: 'salah' });
    }
    const locked = await http()
      .post('/api/auth/login')
      .send({ email: TEST_USERS.VIEWER, password: TEST_PASSWORD })
      .expect(423);
    expect(locked.body.message).toMatch(/dikunci sementara/);

    const viewer = await prisma.user.findUniqueOrThrow({ where: { email: TEST_USERS.VIEWER } });
    const { agent, csrf } = await loginAs(app, 'SUPER_ADMIN');
    await agent.post(`/api/users/${viewer.id}/unlock`).set('x-csrf-token', csrf).expect(200);
    await http()
      .post('/api/auth/login')
      .send({ email: TEST_USERS.VIEWER, password: TEST_PASSWORD })
      .expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'auth.account_locked' } })).toBe(1);
  });

  it('refresh token dirotasi; pemakaian ulang token lama mencabut semua sesi', async () => {
    const { cookies, csrf } = await loginAs(app, 'ADMIN');
    const oldRefresh = readCookie(cookies, 'smge_rt')!;

    const refreshed = await http()
      .post('/api/auth/refresh')
      .set('Cookie', [`smge_rt=${oldRefresh}`, `smge_csrf=${csrf}`])
      .set('x-csrf-token', csrf)
      .expect(200);
    const newCookies = refreshed.headers['set-cookie'] as unknown as string[];
    const newRefresh = readCookie(newCookies, 'smge_rt')!;
    const newAccess = readCookie(newCookies, 'smge_at')!;
    expect(newRefresh).not.toBe(oldRefresh);

    // Lewati jendela toleransi race condition multi-tab
    await prisma.userSession.updateMany({ data: { lastUsedAt: new Date(Date.now() - 60_000) } });

    await http()
      .post('/api/auth/refresh')
      .set('Cookie', [`smge_rt=${oldRefresh}`, `smge_csrf=${csrf}`])
      .set('x-csrf-token', csrf)
      .expect(401);

    // Sesi (termasuk access token baru) langsung tidak berlaku
    await http()
      .get('/api/auth/me')
      .set('Cookie', [`smge_at=${newAccess}`])
      .expect(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.refresh_token_reuse' } })).toBe(1);
  });

  it('logout mencabut sesi dan memerlukan token CSRF', async () => {
    const { agent, csrf } = await loginAs(app, 'VIEWER');
    await agent.post('/api/auth/logout').expect(403); // tanpa header CSRF
    await agent.post('/api/auth/logout').set('x-csrf-token', csrf).expect(200);
    await agent.get('/api/auth/me').expect(401);
  });

  it('klien Bearer token tidak memerlukan CSRF', async () => {
    const { cookies } = await loginAs(app, 'ADMIN');
    const token = readCookie(cookies, 'smge_at')!;
    await request(app.getHttpServer())
      .post('/api/tiktok-accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'akun_bearer', displayName: 'Akun Bearer', lane: 'OUTBOUND' })
      .expect(201);
  });

  it('alur 2FA: aktivasi, login meminta kode, kode salah ditolak, kode benar diterima', async () => {
    const { agent, csrf } = await loginAs(app, 'ADMIN');
    const setup = await agent.post('/api/auth/2fa/setup').set('x-csrf-token', csrf).expect(200);
    expect(setup.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    const secret: string = setup.body.secret;

    await agent
      .post('/api/auth/2fa/enable')
      .set('x-csrf-token', csrf)
      .send({ code: '000000' })
      .expect(400);
    await agent
      .post('/api/auth/2fa/enable')
      .set('x-csrf-token', csrf)
      .send({ code: authenticator.generate(secret) })
      .expect(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: TEST_USERS.ADMIN } });
    expect(stored.twoFactorEnabled).toBe(true);
    expect(stored.twoFactorSecret).not.toContain(secret); // tersimpan terenkripsi

    const step1 = await http()
      .post('/api/auth/login')
      .send({ email: TEST_USERS.ADMIN, password: TEST_PASSWORD })
      .expect(200);
    expect(step1.body.status).toBe('TWO_FACTOR_REQUIRED');
    expect(step1.headers['set-cookie']).toBeUndefined();

    await http()
      .post('/api/auth/2fa/verify')
      .send({ challengeToken: step1.body.challengeToken, code: '123456' })
      .expect(401);
    const ok = await http()
      .post('/api/auth/2fa/verify')
      .send({ challengeToken: step1.body.challengeToken, code: authenticator.generate(secret) })
      .expect(200);
    expect(ok.body.status).toBe('AUTHENTICATED');
  });

  it('reset password melalui link email, token hanya bisa dipakai sekali', async () => {
    const mail = app.get(MailService);
    const spy = jest.spyOn(mail, 'send').mockResolvedValue();

    await http()
      .post('/api/auth/forgot-password')
      .send({ email: 'tidakada@test.local' })
      .expect(200);
    expect(spy).not.toHaveBeenCalled();

    await http().post('/api/auth/forgot-password').send({ email: TEST_USERS.VIEWER }).expect(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(spy.mock.calls[0][2])![1]);

    await http()
      .post('/api/auth/reset-password')
      .send({ token, password: 'PasswordBaru123', confirmPassword: 'PasswordBaru123' })
      .expect(200);
    await http()
      .post('/api/auth/reset-password')
      .send({ token, password: 'PasswordLain123', confirmPassword: 'PasswordLain123' })
      .expect(400);

    await http()
      .post('/api/auth/login')
      .send({ email: TEST_USERS.VIEWER, password: TEST_PASSWORD })
      .expect(401);
    await http()
      .post('/api/auth/login')
      .send({ email: TEST_USERS.VIEWER, password: 'PasswordBaru123' })
      .expect(200);
    spy.mockRestore();
  });

  it('ganti password mengakhiri sesi di perangkat lain tetapi mempertahankan sesi saat ini', async () => {
    const other = await loginAs(app, 'MARKETING_OPERATOR');
    const current = await loginAs(app, 'MARKETING_OPERATOR');

    await current.agent
      .post('/api/auth/change-password')
      .set('x-csrf-token', current.csrf)
      .send({
        currentPassword: 'salah',
        newPassword: 'PasswordBaru123',
        confirmPassword: 'PasswordBaru123',
      })
      .expect(400);
    await current.agent
      .post('/api/auth/change-password')
      .set('x-csrf-token', current.csrf)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: 'PasswordBaru123',
        confirmPassword: 'PasswordBaru123',
      })
      .expect(200);

    await current.agent.get('/api/auth/me').expect(200);
    await other.agent.get('/api/auth/me').expect(401);
  });

  it('daftar sesi menandai sesi aktif dan sesi lain dapat dicabut', async () => {
    const other = await loginAs(app, 'ADMIN');
    const current = await loginAs(app, 'ADMIN');
    const list = await current.agent.get('/api/auth/sessions').expect(200);
    expect(list.body).toHaveLength(2);
    const otherSession = list.body.find((s: { current: boolean }) => !s.current);
    await current.agent
      .delete(`/api/auth/sessions/${otherSession.id}`)
      .set('x-csrf-token', current.csrf)
      .expect(200);
    await other.agent.get('/api/auth/me').expect(401);
  });
});
