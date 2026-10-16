import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createTaskSchema,
  listTasksQuerySchema,
  outboundQueueQuerySchema,
  PERMISSIONS,
  taskActionSchema,
  updateTaskDraftSchema,
  type ListTasksQuery,
  type OutboundQueueQuery,
  type TaskAction,
} from '@smge/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentUser, RequestUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request';
import { LeadsModule } from '../leads/leads.module';
import { OutboundService } from './outbound.service';

@Controller('outbound')
export class OutboundController {
  constructor(private readonly outbound: OutboundService) {}

  @Get('summary/:accountId')
  @RequirePermissions(PERMISSIONS.OUTREACH_WORK)
  summary(@Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.outbound.summary(accountId);
  }

  @Get('queue')
  @RequirePermissions(PERMISSIONS.OUTREACH_WORK)
  queue(@Query(new ZodValidationPipe(outboundQueueQuerySchema)) q: OutboundQueueQuery) {
    return this.outbound.queue(q);
  }

  @Get('tasks')
  @RequirePermissions(PERMISSIONS.OUTREACH_WORK)
  list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(listTasksQuerySchema)) q: ListTasksQuery,
  ) {
    return this.outbound.list(q, user);
  }

  @Get('tasks/:id')
  @RequirePermissions(PERMISSIONS.OUTREACH_WORK)
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.outbound.get(id, user);
  }

  @Post('tasks')
  @RequirePermissions(PERMISSIONS.OUTREACH_WORK)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createTaskSchema)) body: z.output<typeof createTaskSchema>,
    @Req() req: Request,
  ) {
    return this.outbound.create(user, body, requestMeta(req));
  }

  @Patch('tasks/:id/draft')
  @RequirePermissions(PERMISSIONS.OUTREACH_WORK)
  updateDraft(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTaskDraftSchema))
    body: { draftMessage: string; aiGenerated?: boolean },
  ) {
    return this.outbound.updateDraft(user, id, body.draftMessage, body.aiGenerated);
  }

  /** Permission spesifik per aksi (mis. approve butuh outreach:review) dicek di service. */
  @Post('tasks/:id/actions')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.OUTREACH_WORK)
  act(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(taskActionSchema)) body: TaskAction,
    @Req() req: Request,
  ) {
    return this.outbound.act(user, id, body, requestMeta(req));
  }
}

@Module({ imports: [LeadsModule], controllers: [OutboundController], providers: [OutboundService] })
export class OutboundModule {}
