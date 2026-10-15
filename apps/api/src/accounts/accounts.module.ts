import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createTikTokAccountSchema,
  listTikTokAccountsQuerySchema,
  ListTikTokAccountsQuery,
  PERMISSIONS,
  updateTikTokAccountSchema,
  UpdateTikTokAccountInput,
} from '@smge/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentUser, RequestUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request';
import { AccountsService } from './accounts.service';

@Controller('tiktok-accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ACCOUNTS_READ)
  list(@Query(new ZodValidationPipe(listTikTokAccountsQuerySchema)) q: ListTikTokAccountsQuery) {
    return this.accounts.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ACCOUNTS_MANAGE)
  create(
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(createTikTokAccountSchema))
    body: z.output<typeof createTikTokAccountSchema>,
    @Req() req: Request,
  ) {
    return this.accounts.create(actor, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_MANAGE)
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTikTokAccountSchema)) body: UpdateTikTokAccountInput,
    @Req() req: Request,
  ) {
    return this.accounts.update(actor, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_MANAGE)
  async remove(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.accounts.remove(actor, id, requestMeta(req));
    return { ok: true };
  }
}

@Module({
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
