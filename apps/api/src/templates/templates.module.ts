import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Prisma } from '@smge/database';
import {
  MARKETING_LANES,
  PERMISSIONS,
  TEMPLATE_PURPOSES,
  templateSchema,
  updateTemplateSchema,
} from '@smge/shared';
import type { MessageTemplateDto } from '@smge/types';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, RequestUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { USER_REF_SELECT, toRef } from '../common/utils/refs';
import { RequestMeta, requestMeta } from '../common/utils/request';
import { PrismaService } from '../prisma/prisma.service';

const listQuery = z.object({
  lane: z.enum(MARKETING_LANES).optional(),
  purpose: z.enum(TEMPLATE_PURPOSES).optional(),
  activeOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const INCLUDE = {
  createdBy: { select: USER_REF_SELECT },
  _count: { select: { outreachTasks: true } },
} satisfies Prisma.MessageTemplateInclude;

function toDto(
  t: Prisma.MessageTemplateGetPayload<{ include: typeof INCLUDE }>,
): MessageTemplateDto {
  return {
    id: t.id,
    name: t.name,
    lane: t.lane,
    purpose: t.purpose,
    content: t.content,
    isActive: t.isActive,
    createdBy: toRef(t.createdBy),
    usageCount: t._count.outreachTasks,
    updatedAt: t.updatedAt.toISOString(),
  };
}

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: z.output<typeof listQuery>) {
    const rows = await this.prisma.messageTemplate.findMany({
      where: {
        ...(q.lane ? { OR: [{ lane: q.lane }, { lane: null }] } : {}),
        ...(q.purpose ? { purpose: q.purpose } : {}),
        ...(q.activeOnly ? { isActive: true } : {}),
      },
      include: INCLUDE,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(actor: RequestUser, input: z.output<typeof templateSchema>, meta: RequestMeta) {
    const t = await this.prisma.messageTemplate.create({
      data: { ...input, createdById: actor.id },
      include: INCLUDE,
    });
    await this.audit.log({
      action: 'template.created',
      actor,
      entityType: 'message_template',
      entityId: t.id,
      meta,
    });
    return toDto(t);
  }

  async update(
    actor: RequestUser,
    id: string,
    input: z.output<typeof updateTemplateSchema>,
    meta: RequestMeta,
  ) {
    await this.ensure(id);
    const t = await this.prisma.messageTemplate.update({
      where: { id },
      data: input,
      include: INCLUDE,
    });
    await this.audit.log({
      action: 'template.updated',
      actor,
      entityType: 'message_template',
      entityId: id,
      meta,
    });
    return toDto(t);
  }

  async remove(actor: RequestUser, id: string, meta: RequestMeta) {
    await this.ensure(id);
    await this.prisma.messageTemplate.delete({ where: { id } });
    await this.audit.log({
      action: 'template.deleted',
      actor,
      entityType: 'message_template',
      entityId: id,
      meta,
    });
  }

  private async ensure(id: string) {
    if (!(await this.prisma.messageTemplate.findUnique({ where: { id } }))) {
      throw new NotFoundException('Template tidak ditemukan');
    }
  }
}

@Controller('message-templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.OUTREACH_WORK)
  list(@Query(new ZodValidationPipe(listQuery)) q: z.output<typeof listQuery>) {
    return this.templates.list(q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(templateSchema)) body: z.output<typeof templateSchema>,
    @Req() req: Request,
  ) {
    return this.templates.create(user, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTemplateSchema)) body: z.output<typeof updateTemplateSchema>,
    @Req() req: Request,
  ) {
    return this.templates.update(user, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.TEMPLATES_MANAGE)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.templates.remove(user, id, requestMeta(req));
    return { ok: true };
  }
}

@Module({ controllers: [TemplatesController], providers: [TemplatesService] })
export class TemplatesModule {}
