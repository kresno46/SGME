import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  browserDmQueueSchema,
  browserDmEnqueueSchema,
  browserDmPrepareSchema,
  browserDmClaimSchema,
  browserDmAttemptSchema,
  browserDmResultSchema,
  browserDmResolveSchema,
  browserDmRetrySchema,
  PERMISSIONS,
} from '@smge/shared';
import type { z } from 'zod';
import { CurrentUser, RequestUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BrowserDmService } from './browser-dm.service';

@Controller('outbound/browser-dm')
@RequirePermissions(PERMISSIONS.OUTREACH_WORK)
export class BrowserDmController {
  constructor(private readonly service: BrowserDmService) {}
  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(browserDmQueueSchema)) q: z.infer<typeof browserDmQueueSchema>,
  ) {
    return this.service.list(user, q.accountId);
  }
  @Post('queue')
  queue(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(browserDmEnqueueSchema))
    body: z.infer<typeof browserDmEnqueueSchema>,
  ) {
    return this.service.enqueue(user, body.accountId, body.taskIds);
  }
  @Post('prepare')
  prepare(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(browserDmPrepareSchema))
    body: z.infer<typeof browserDmPrepareSchema>,
  ) {
    return this.service.prepare(user, body);
  }
  @Post('claim')
  claim(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(browserDmClaimSchema)) body: z.infer<typeof browserDmClaimSchema>,
  ) {
    return this.service.claim(user, body.accountId, body.clientId);
  }
  @Post('cancel')
  cancel(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(browserDmQueueSchema)) body: z.infer<typeof browserDmQueueSchema>,
  ) {
    return this.service.cancel(user, body.accountId);
  }
  @Post(':id/authorize')
  authorize(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(browserDmAttemptSchema))
    body: z.infer<typeof browserDmAttemptSchema>,
  ) {
    return this.service.authorize(user, id, body.clientId, body.attemptId);
  }
  @Post(':id/result')
  result(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(browserDmResultSchema)) body: z.infer<typeof browserDmResultSchema>,
  ) {
    return this.service.result(user, id, body);
  }
  @Post(':id/resolve')
  resolve(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(browserDmResolveSchema))
    body: z.infer<typeof browserDmResolveSchema>,
  ) {
    return this.service.resolve(user, id, body.sent);
  }
  @Post(':id/retry')
  retry(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(browserDmRetrySchema)) _body: z.infer<typeof browserDmRetrySchema>,
  ) {
    return this.service.retry(user, id);
  }
}
