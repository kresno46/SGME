import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from './audit/audit.module';
import { CryptoModule } from './common/crypto/crypto.service';
import { SettingsModule } from './common/settings.service';
import { env } from './config/env';
import { PrismaModule } from './prisma/prisma.service';
import { IntegrationLogService } from './integrations/integration-log.service';
import { createTikTokAdapters } from './integrations/integrations.module';
import { IntegrationsService, TIKTOK_ADAPTERS } from './integrations/integrations.service';
import { RetentionService } from './retention/retention.service';

/**
 * Proses background (BullMQ). Dijalankan terpisah dari API: `pnpm --filter @smge/api worker`.
 * Job: retensi data & sinkron akun TikTok. TIDAK ada job pengirim pesan/DM.
 */
const QUEUE = 'smge-maintenance';
const RETENTION_JOB = 'retention';
const TIKTOK_SYNC_JOB = 'tiktok-sync';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    AuditModule,
    CryptoModule,
    JwtModule.registerAsync({ useFactory: () => ({ secret: env().JWT_ACCESS_SECRET }) }),
  ],
  providers: [
    RetentionService,
    IntegrationsService,
    IntegrationLogService,
    { provide: TIKTOK_ADAPTERS, useFactory: createTikTokAdapters },
  ],
})
class WorkerModule {}

async function main() {
  const e = env();
  const logger = new Logger('Worker');
  if (!e.REDIS_URL) throw new Error('REDIS_URL wajib diatur untuk menjalankan worker');
  const url = new URL(e.REDIS_URL);
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };

  const app = await NestFactory.createApplicationContext(WorkerModule);
  const retention = app.get(RetentionService);
  const integrations = app.get(IntegrationsService);

  const queue = new Queue(QUEUE, { connection });
  // Setiap hari pukul 02.00 WIB
  await queue.upsertJobScheduler(
    'daily-retention',
    { pattern: '0 2 * * *', tz: 'Asia/Jakarta' },
    { name: RETENTION_JOB, opts: { removeOnComplete: 30, removeOnFail: 100 } },
  );
  // Sinkron profil & followers akun TikTok yang terhubung (refresh token otomatis), tiap 6 jam
  await queue.upsertJobScheduler(
    'tiktok-sync',
    { pattern: '15 */6 * * *', tz: 'Asia/Jakarta' },
    {
      name: TIKTOK_SYNC_JOB,
      opts: {
        removeOnComplete: 30,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    },
  );

  const worker = new Worker(
    QUEUE,
    async (job) => {
      if (job.name === RETENTION_JOB) return retention.run();
      if (job.name === TIKTOK_SYNC_JOB) {
        const r = await integrations.syncAll();
        return { total: r.total, ok: r.ok };
      }
      logger.warn(`Job tidak dikenal: ${job.name}`);
    },
    { connection, concurrency: 1 },
  );
  worker.on('completed', (job) => logger.log(`Job ${job.name} selesai`));
  worker.on('failed', (job, err) => logger.error(`Job ${job?.name} gagal: ${err.message}`));
  logger.log(
    `Worker berjalan — antrean "${QUEUE}": retensi harian 02.00 WIB, sinkron TikTok tiap 6 jam`,
  );

  const shutdown = async () => {
    logger.log('Menghentikan worker…');
    await worker.close();
    await queue.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
