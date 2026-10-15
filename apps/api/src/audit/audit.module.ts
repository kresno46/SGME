import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { listAuditLogsQuerySchema, ListAuditLogsQuery, PERMISSIONS } from '@smge/shared';
import { RequirePermissions } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  list(@Query(new ZodValidationPipe(listAuditLogsQuerySchema)) q: ListAuditLogsQuery) {
    return this.audit.list(q);
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
