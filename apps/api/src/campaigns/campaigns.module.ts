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
  createCampaignSchema,
  listCampaignsQuerySchema,
  PERMISSIONS,
  updateCampaignSchema,
  type CreateCampaignData,
  type ListCampaignsQuery,
  type UpdateCampaignData,
} from '@smge/shared';
import type { Request } from 'express';
import { CurrentUser, RequestUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request';
import { CampaignsService } from './campaigns.service';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_READ)
  list(@Query(new ZodValidationPipe(listCampaignsQuerySchema)) q: ListCampaignsQuery) {
    return this.campaigns.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_MANAGE)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createCampaignSchema)) body: CreateCampaignData,
    @Req() req: Request,
  ) {
    return this.campaigns.create(user, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_MANAGE)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCampaignSchema)) body: UpdateCampaignData,
    @Req() req: Request,
  ) {
    return this.campaigns.update(user, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CAMPAIGNS_MANAGE)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.campaigns.remove(user, id, requestMeta(req));
    return { ok: true };
  }
}

@Module({ controllers: [CampaignsController], providers: [CampaignsService] })
export class CampaignsModule {}
