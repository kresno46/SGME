import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Membaca nilai `system_settings` dengan fallback default. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getNumber(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const v = row?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }
}

@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
