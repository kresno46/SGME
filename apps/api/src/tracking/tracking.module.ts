import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  conversionEventSchema,
  PERMISSIONS,
  publicTrackEventSchema,
  trackingLinkSchema,
  updateTrackingLinkSchema,
  visitorIdSchema,
} from '@smge/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import {
  CurrentUser,
  Public,
  RequestUser,
  RequirePermissions,
  SkipCsrf,
} from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request';
import { env } from '../config/env';
import { LeadsModule } from '../leads/leads.module';
import { ConversionsService } from './conversions.service';
import { TrackingService } from './tracking.service';

const VISITOR_COOKIE = 'smge_vid';
const trackingThrottle = () => ({
  default: { limit: () => env().THROTTLE_TRACKING_LIMIT_PER_MINUTE, ttl: 60_000 },
});
const client = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null });

@Controller()
export class TrackingLinksController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('campaigns/:id/tracking-links')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_READ)
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.tracking.listForCampaign(id);
  }

  @Post('campaigns/:id/tracking-links')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_MANAGE)
  create(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(trackingLinkSchema)) body: z.output<typeof trackingLinkSchema>,
    @Req() req: Request,
  ) {
    return this.tracking.create(user, id, body, requestMeta(req));
  }

  @Patch('tracking-links/:id')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_MANAGE)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTrackingLinkSchema))
    body: z.output<typeof updateTrackingLinkSchema>,
    @Req() req: Request,
  ) {
    return this.tracking.update(user, id, body, requestMeta(req));
  }
}

/** Endpoint publik: link pendek, event landing page, dan Conversion API server-to-server. */
@Controller()
export class PublicTrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly conversions: ConversionsService,
  ) {}

  @Public()
  @Throttle(trackingThrottle())
  @Get('t/:code')
  async redirect(@Param('code') code: string, @Req() req: Request, @Res() res: Response) {
    const cookie = req.cookies?.[VISITOR_COOKIE] as string | undefined;
    const vid = cookie && visitorIdSchema.safeParse(cookie).success ? cookie : null;
    const r = await this.tracking.resolveClick(code.slice(0, 64), vid, client(req));
    if (!r) throw new NotFoundException('Link tidak ditemukan');
    res.cookie(VISITOR_COOKIE, r.visitorId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env().COOKIE_SECURE,
      maxAge: 365 * 86_400_000,
      path: '/api/t',
    });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(302, r.url);
  }

  @Public()
  @SkipCsrf()
  @Throttle(trackingThrottle())
  @Post('track/events')
  @HttpCode(200)
  event(
    @Body(new ZodValidationPipe(publicTrackEventSchema))
    body: z.output<typeof publicTrackEventSchema>,
    @Req() req: Request,
  ) {
    return this.tracking.recordClientEvent(body, client(req));
  }

  /** Conversion API untuk backend Solid Mini — diautentikasi HMAC, bukan sesi. */
  @Public()
  @SkipCsrf()
  @Post('conversions')
  @HttpCode(200)
  async conversion(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-smge-timestamp') timestamp?: string,
    @Headers('x-smge-signature') signature?: string,
  ) {
    this.conversions.authenticate(req.rawBody, timestamp, signature);
    const body = new ZodValidationPipe(conversionEventSchema).transform(req.body);
    return this.conversions.ingest(body);
  }
}

@Module({
  imports: [LeadsModule],
  controllers: [TrackingLinksController, PublicTrackingController],
  providers: [TrackingService, ConversionsService],
})
export class TrackingModule {}
