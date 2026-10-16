import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@smge/database';
import { PrismaService } from '../prisma/prisma.service';

/** Membaca & menulis `system_settings` dengan fallback default. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getNumber(key: string, fallback: number): Promise<number> {
    const v = await this.getRaw(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const v = await this.getRaw(key);
    return v === undefined || v === null ? fallback : (v as T);
  }

  async set(key: string, value: unknown, updatedById: string | null) {
    const json = (value ?? null) as Prisma.InputJsonValue;
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: json, updatedById },
      update: { value: json, updatedById },
    });
  }

  private async getRaw(key: string) {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row?.value;
  }
}

@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
