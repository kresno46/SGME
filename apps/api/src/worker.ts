import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './common/settings.service';
import { env } from './config/env';
import { PrismaModule } from './prisma/prisma.service';
import { RetentionService } from './retention/retention.service';

/**
 * Proses background (BullMQ). Dijalankan terpisah dari API: `pnpm --filter @smge/api worker`.
 * Saat ini hanya job pemeliharaan. TIDAK ada job pengirim pesan/DM.
 */
const QUEUE = 'smge-maintenance';
const RETENTION_JOB = 'retention';

@Module({ imports: [PrismaModule, SettingsModule, AuditModule], providers: [RetentionService] })
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

  const queue = new Queue(QUEUE, { connection });
  // Setiap hari pukul 02.00 WIB
  await queue.upsertJobScheduler(
    'daily-retention',
    { pattern: '0 2 * * *', tz: 'Asia/Jakarta' },
    { name: RETENTION_JOB, opts: { removeOnComplete: 30, removeOnFail: 100 } },
  );

  const worker = new Worker(
    QUEUE,
    async (job) => {
      if (job.name === RETENTION_JOB) return retention.run();
      logger.warn(`Job tidak dikenal: ${job.name}`);
    },
    { connection, concurrency: 1 },
  );
  worker.on('completed', (job) => logger.log(`Job ${job.name} selesai`));
  worker.on('failed', (job, err) => logger.error(`Job ${job?.name} gagal: ${err.message}`));
  logger.log(`Worker berjalan — antrean "${QUEUE}", retensi harian 02.00 WIB`);

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
