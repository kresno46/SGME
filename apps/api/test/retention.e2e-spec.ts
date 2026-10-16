import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { RetentionService } from '../src/retention/retention.service';
import { createTestApp, loginAs, resetDatabase } from './utils';

describe('Retensi data (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDatabase(prisma));
  afterAll(() => app.close());

  it('dry-run hanya menghitung; run sebenarnya menganonimkan prospek lama tetapi mempertahankan DNC', async () => {
    const old = new Date(Date.now() - 800 * 86_400_000);
    await prisma.systemSetting.create({
      data: { key: 'retention.lead_inactive_days', value: 730 },
    });
    const stale = await prisma.lead.create({
      data: { name: 'Lama', email: 'lama@x.co', emailNormalized: 'lama@x.co', source: 'MANUAL' },
    });
    await prisma.$executeRaw`UPDATE leads SET updated_at = ${old} WHERE id = ${stale.id}::uuid`;
    await prisma.lead.create({ data: { name: 'Baru', source: 'MANUAL' } });
    await prisma.doNotContactEntry.create({
      data: { channel: 'EMAIL', valueNormalized: 'lama@x.co' },
    });
    await prisma.auditLog.create({
      data: { action: 'kuno', createdAt: new Date(Date.now() - 1200 * 86_400_000) },
    });

    const svc = app.get(RetentionService);
    const dry = await svc.run({ dryRun: true });
    expect(dry).toMatchObject({ leadsAnonymized: 1, auditLogsDeleted: 1 });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: stale.id } })).name).toBe('Lama');

    const real = await svc.run();
    expect(real.leadsAnonymized).toBe(1);
    const row = await prisma.lead.findUniqueOrThrow({ where: { id: stale.id } });
    expect(row).toMatchObject({ name: null, email: null });
    expect(await prisma.lead.count({ where: { anonymizedAt: null } })).toBe(1);
    expect(await prisma.doNotContactEntry.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'system.retention_run' } })).toBe(1);
  });

  it('endpoint manual hanya untuk Super Admin dan default dry-run', async () => {
    const admin = await loginAs(app, 'ADMIN');
    await admin.agent
      .post('/api/maintenance/retention')
      .set('x-csrf-token', admin.csrf)
      .send({})
      .expect(403);
    const sa = await loginAs(app, 'SUPER_ADMIN');
    const res = await sa.agent
      .post('/api/maintenance/retention')
      .set('x-csrf-token', sa.csrf)
      .send({})
      .expect(200);
    expect(res.body.dryRun).toBe(true);
  });
});
