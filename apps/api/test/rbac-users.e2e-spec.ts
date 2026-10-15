import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDatabase, TEST_USERS } from './utils';

describe('RBAC & manajemen pengguna (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app.close());

  const account = { username: 'akun_rbac', displayName: 'Akun RBAC', lane: 'OUTBOUND' };

  it('Viewer hanya dapat membaca', async () => {
    const { agent, csrf } = await loginAs(app, 'VIEWER');
    await agent.get('/api/tiktok-accounts').expect(200);
    await agent.get('/api/analytics/overview').expect(200);
    await agent.post('/api/tiktok-accounts').set('x-csrf-token', csrf).send(account).expect(403);
    await agent.get('/api/users').expect(403);
    await agent.get('/api/audit-logs').expect(403);
  });

  it('Marketing Operator tidak dapat mengelola akun TikTok atau pengguna', async () => {
    const { agent, csrf } = await loginAs(app, 'MARKETING_OPERATOR');
    await agent.post('/api/tiktok-accounts').set('x-csrf-token', csrf).send(account).expect(403);
    await agent.get('/api/users').expect(403);
  });

  it('Admin dapat membuat Operator tetapi tidak dapat membuat Admin/Super Admin', async () => {
    const { agent, csrf } = await loginAs(app, 'ADMIN');
    const user = { name: 'Operator Baru', email: 'baru@test.local', password: 'PasswordKuat123' };

    const created = await agent
      .post('/api/users')
      .set('x-csrf-token', csrf)
      .send({ ...user, role: 'MARKETING_OPERATOR' })
      .expect(201);
    expect(created.body).not.toHaveProperty('passwordHash');
    expect(created.body.role).toBe('MARKETING_OPERATOR');

    await agent
      .post('/api/users')
      .set('x-csrf-token', csrf)
      .send({ ...user, email: 'x@test.local', role: 'ADMIN' })
      .expect(403);
    await agent
      .post('/api/users')
      .set('x-csrf-token', csrf)
      .send({ ...user, email: 'y@test.local', role: 'SUPER_ADMIN' })
      .expect(403);

    // email duplikat
    await agent
      .post('/api/users')
      .set('x-csrf-token', csrf)
      .send({ ...user, role: 'VIEWER' })
      .expect(409);

    // password lemah ditolak dengan pesan per field
    const weak = await agent
      .post('/api/users')
      .set('x-csrf-token', csrf)
      .send({ ...user, email: 'z@test.local', role: 'VIEWER', password: 'lemah' })
      .expect(400);
    expect(weak.body.errors.password).toBeDefined();
  });

  it('Admin tidak dapat mengubah Super Admin maupun role/status dirinya sendiri', async () => {
    const { agent, csrf } = await loginAs(app, 'ADMIN');
    const sa = await prisma.user.findUniqueOrThrow({ where: { email: TEST_USERS.SUPER_ADMIN } });
    const self = await prisma.user.findUniqueOrThrow({ where: { email: TEST_USERS.ADMIN } });

    await agent
      .patch(`/api/users/${sa.id}`)
      .set('x-csrf-token', csrf)
      .send({ status: 'DISABLED' })
      .expect(403);
    await agent
      .patch(`/api/users/${self.id}`)
      .set('x-csrf-token', csrf)
      .send({ role: 'VIEWER' })
      .expect(400);
    await agent
      .patch(`/api/users/${self.id}`)
      .set('x-csrf-token', csrf)
      .send({ name: 'Nama Baru' })
      .expect(200);
  });

  it('menonaktifkan pengguna langsung mengakhiri sesinya', async () => {
    const viewer = await loginAs(app, 'VIEWER');
    await viewer.agent.get('/api/auth/me').expect(200);

    const { agent, csrf } = await loginAs(app, 'SUPER_ADMIN');
    const target = await prisma.user.findUniqueOrThrow({ where: { email: TEST_USERS.VIEWER } });
    const res = await agent
      .patch(`/api/users/${target.id}`)
      .set('x-csrf-token', csrf)
      .send({ status: 'DISABLED' })
      .expect(200);
    expect(res.body.status).toBe('DISABLED');

    await viewer.agent.get('/api/auth/me').expect(401);
    const login = await loginAs(app, 'VIEWER').catch((e: Error) => e);
    expect(login).toBeInstanceOf(Error);
  });

  it('daftar pengguna mendukung pencarian & filter, dan role dapat dilihat', async () => {
    const { agent } = await loginAs(app, 'SUPER_ADMIN');
    const all = await agent.get('/api/users').expect(200);
    expect(all.body.total).toBe(4);
    const filtered = await agent.get('/api/users?role=VIEWER').expect(200);
    expect(filtered.body.items).toHaveLength(1);
    const searched = await agent.get('/api/users?search=operator').expect(200);
    expect(searched.body.items[0].email).toBe(TEST_USERS.MARKETING_OPERATOR);

    const roles = await agent.get('/api/roles').expect(200);
    expect(roles.body.map((r: { code: string }) => r.code)).toEqual([
      'SUPER_ADMIN',
      'ADMIN',
      'MARKETING_OPERATOR',
      'VIEWER',
    ]);
  });

  it('log audit dapat dibaca Admin dan menyensor data sensitif', async () => {
    const { agent, csrf } = await loginAs(app, 'ADMIN');
    const target = await prisma.user.findUniqueOrThrow({ where: { email: TEST_USERS.VIEWER } });
    await agent
      .post(`/api/users/${target.id}/reset-password`)
      .set('x-csrf-token', csrf)
      .send({ password: 'PasswordReset123' })
      .expect(200);
    const logs = await agent.get('/api/audit-logs?action=user.').expect(200);
    expect(logs.body.items[0].action).toBe('user.password_reset_by_admin');
    expect(JSON.stringify(logs.body)).not.toContain('PasswordReset123');
  });
});
