import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PERMISSIONS } from '@smge/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  CurrentUser,
  Public,
  RequestUser,
  RequirePermissions,
  SkipCsrf,
} from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { paginationQuerySchema } from '@smge/shared';
import { requestMeta } from '../common/utils/request';
import { env } from '../config/env';
import { IntegrationLogService } from './integration-log.service';
import { IntegrationsService, TIKTOK_ADAPTERS, TikTokAdapters } from './integrations.service';
import { LoginKitAdapter } from './tiktok/login-kit.adapter';
import { MockLoginKitAdapter } from './tiktok/mock-login-kit.adapter';

export function createTikTokAdapters(): TikTokAdapters {
  const e = env();
  const logger = new Logger('TikTokIntegration');
  const loginKit =
    e.TIKTOK_CLIENT_KEY && e.TIKTOK_CLIENT_SECRET && e.TIKTOK_REDIRECT_URI
      ? new LoginKitAdapter(
          e.TIKTOK_CLIENT_KEY,
          e.TIKTOK_CLIENT_SECRET,
          e.TIKTOK_REDIRECT_URI,
          e.TIKTOK_SCOPES,
        )
      : null;
  const mock = e.TIKTOK_USE_MOCK ? new MockLoginKitAdapter(e.APP_PUBLIC_URL) : null;
  if (mock) logger.warn('TikTok Mock Adapter aktif — koneksi & data akun berlabel SIMULASI.');
  return { loginKit, mock };
}

const connectSchema = z.object({ provider: z.enum(['TIKTOK_LOGIN_KIT', 'MOCK']) });
const logsQuery = paginationQuerySchema.extend({
  integrationId: z.string().uuid().optional(),
  onlyErrors: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    private readonly logs: IntegrationLogService,
  ) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  overview() {
    return this.integrations.overview();
  }

  @Get('logs')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_READ)
  list(@Query(new ZodValidationPipe(logsQuery)) q: z.output<typeof logsQuery>) {
    return this.logs.list(q);
  }

  @Post('tiktok/accounts/:accountId/connect')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  connect(
    @CurrentUser() user: RequestUser,
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body(new ZodValidationPipe(connectSchema)) body: z.output<typeof connectSchema>,
    @Req() req: Request,
  ) {
    return this.integrations.startConnect(user, accountId, body.provider, requestMeta(req));
  }

  /** Redirect OAuth dari TikTok (navigasi browser). */
  @Public()
  @Get('tiktok/callback')
  async callback(
    @Query()
    q: {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
      scopes?: string;
    },
    @Res() res: Response,
  ) {
    res.redirect(302, await this.integrations.handleCallback(q));
  }

  @Get('tiktok/mock/state')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  mockState(@Query('state') state: string) {
    return this.integrations.mockStateInfo(state ?? '');
  }

  @Post(':id/sync')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  sync(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.sync(id, user);
  }

  @Post(':id/disconnect')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async disconnect(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.integrations.disconnect(user, id, requestMeta(req));
    return { ok: true };
  }
}

/** Webhook dari TikTok: publik, tanpa CSRF, diverifikasi dengan signature HMAC. */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Public()
  @SkipCsrf()
  @SkipThrottle()
  @Post('tiktok')
  @HttpCode(200)
  async tiktok(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('tiktok-signature') signature?: string,
  ) {
    const r = await this.integrations.handleWebhook(req.rawBody, signature);
    return { ok: true, ...r };
  }
}

@Module({
  controllers: [IntegrationsController, WebhooksController],
  providers: [
    IntegrationsService,
    IntegrationLogService,
    { provide: TIKTOK_ADAPTERS, useFactory: createTikTokAdapters },
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
