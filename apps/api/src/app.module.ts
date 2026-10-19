import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountsModule } from './accounts/accounts.module';
import { AiModule } from './ai/ai.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { SettingsModule } from './common/settings.service';
import { CryptoModule } from './common/crypto/crypto.service';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { CsrfGuard } from './common/guards/csrf.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { env } from './config/env';
import { HealthModule } from './health/health.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { LeadsModule } from './leads/leads.module';
import { OutboundModule } from './outbound/outbound.module';
import { PrismaModule } from './prisma/prisma.service';
import { RetentionModule } from './retention/retention.module';
import { TemplatesModule } from './templates/templates.module';
import { TrackingModule } from './tracking/tracking.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: () => env().THROTTLE_LIMIT_PER_MINUTE },
    ]),
    PrismaModule,
    CryptoModule,
    SettingsModule,
    AuditModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    CampaignsModule,
    LeadsModule,
    TemplatesModule,
    OutboundModule,
    RetentionModule,
    AiModule,
    IntegrationsModule,
    TrackingModule,
    AnalyticsModule,
    HealthModule,
  ],
  providers: [
    // Urutan guard: rate limit → autentikasi → CSRF → otorisasi (RBAC)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
