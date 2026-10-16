import { Body, Controller, HttpCode, Module, Post, Req } from '@nestjs/common';
import { PERMISSIONS } from '@smge/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, RequestUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request';
import { RetentionService } from './retention.service';

const runSchema = z.object({ dryRun: z.boolean().default(true) });

@Controller('maintenance')
export class RetentionController {
  constructor(
    private readonly retention: RetentionService,
    private readonly audit: AuditService,
  ) {}

  /** Menjalankan retensi secara manual. Default dry-run (hanya menghitung). */
  @Post('retention')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async run(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(runSchema)) body: z.output<typeof runSchema>,
    @Req() req: Request,
  ) {
    const report = await this.retention.run({ dryRun: body.dryRun });
    await this.audit.log({
      action: 'maintenance.retention',
      actor: user,
      metadata: { dryRun: body.dryRun },
      meta: requestMeta(req),
    });
    return report;
  }
}

@Module({
  controllers: [RetentionController],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
