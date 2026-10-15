import { Controller, Get, Module, OnModuleDestroy, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { HealthResponse } from '@smge/types';
import type { Response } from 'express';
import Redis from 'ioredis';
import { Public } from '../common/decorators/auth.decorators';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

const VERSION = process.env.npm_package_version ?? '0.1.0';

@Controller('health')
export class HealthController implements OnModuleDestroy {
  private redis: Redis | null = null;

  constructor(private readonly prisma: PrismaService) {
    const url = env().REDIS_URL;
    if (url) {
      this.redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      this.redis.on('error', () => undefined); // status dilaporkan lewat endpoint, bukan crash
    }
  }

  async onModuleDestroy() {
    this.redis?.disconnect();
  }

  /** Dipakai Docker healthcheck & monitoring. Tidak membocorkan detail konfigurasi. */
  @Public()
  @SkipThrottle()
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const checks: HealthResponse['checks'] = {};

    const t0 = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'up', latencyMs: Date.now() - t0 };
    } catch {
      checks.database = { status: 'down', message: 'Database tidak dapat dihubungi' };
    }

    if (this.redis) {
      const t1 = Date.now();
      try {
        if (this.redis.status !== 'ready') await this.redis.connect().catch(() => undefined);
        await this.redis.ping();
        checks.redis = { status: 'up', latencyMs: Date.now() - t1 };
      } catch {
        checks.redis = { status: 'down', message: 'Redis tidak dapat dihubungi' };
        // koneksi gagal: buat ulang pada pemeriksaan berikutnya
        this.redis.disconnect();
      }
    } else {
      checks.redis = { status: 'skipped', message: 'REDIS_URL belum diatur' };
    }

    const healthy = checks.database.status === 'up';
    const degraded = Object.values(checks).some((c) => c.status === 'down');
    if (!healthy) res.status(503);
    return {
      status: degraded ? 'degraded' : 'ok',
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
