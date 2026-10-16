import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  consentInputSchema,
  createLeadSchema,
  dncEntrySchema,
  doNotContactSchema,
  exportLeadsQuerySchema,
  leadImportOptionsSchema,
  leadNoteSchema,
  listDncQuerySchema,
  listLeadsQuerySchema,
  PERMISSIONS,
  updateLeadSchema,
  withdrawConsentSchema,
  type ConsentInput,
  type CreateLeadData,
  type DncEntryInput,
  type ExportLeadsQuery,
  type ListLeadsQuery,
  type UpdateLeadData,
} from '@smge/shared';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { CurrentUser, RequestUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request';
import { DncService } from './dnc.service';
import { LeadActivityService } from './lead-activity.service';
import { IMPORT_MAX_BYTES, LeadImportService } from './lead-import.service';
import { LeadsService } from './leads.service';

const upload = () =>
  FileInterceptor('file', {
    limits: { fileSize: IMPORT_MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ok = /\.(csv|txt)$/i.test(file.originalname) || /csv|text\/plain/.test(file.mimetype);
      cb(ok ? null : new BadRequestException('Hanya file CSV yang didukung'), ok);
    },
  });

function requireFile(file: Express.Multer.File | undefined) {
  if (!file) throw new BadRequestException('Pilih file CSV untuk diimpor');
  return file.buffer;
}

/** Field multipart datang sebagai string — ubah ke bentuk yang diharapkan skema. */
function importOptionsFromForm(body: Record<string, string>) {
  return {
    ...body,
    tags: body.tags
      ? body.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    lawfulBasisConfirmed: body.lawfulBasisConfirmed === 'true',
  };
}

@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly dnc: DncService,
    private readonly importer: LeadImportService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LEADS_READ)
  list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(listLeadsQuerySchema)) q: ListLeadsQuery,
  ) {
    return this.leads.list(q, user);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.LEADS_EXPORT)
  async export(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(exportLeadsQuerySchema)) q: ExportLeadsQuery,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { header, data } = await this.leads.exportRows(q, user, requestMeta(req));
    const stamp = new Date().toISOString().slice(0, 10);
    if (q.format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Prospek');
      ws.addRow(header).font = { bold: true };
      data.forEach((r) => ws.addRow(r));
      ws.columns.forEach((c) => (c.width = 20));
      const buf = await wb.xlsx.writeBuffer();
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="prospek-${stamp}.xlsx"`);
      return res.send(Buffer.from(buf));
    }
    const csv = stringify([header, ...data]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="prospek-${stamp}.csv"`);
    return res.send('﻿' + csv); // BOM agar Excel membaca UTF-8
  }

  @Get('duplicates')
  @RequirePermissions(PERMISSIONS.LEADS_READ)
  duplicates(
    @Query() q: { tiktokUsername?: string; email?: string; phone?: string; excludeId?: string },
  ) {
    return this.leads.findDuplicates(q, q.excludeId);
  }

  @Post('import/preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.LEADS_IMPORT)
  @UseInterceptors(upload())
  importPreview(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.importer.preview(requireFile(file));
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.LEADS_IMPORT)
  @UseInterceptors(upload())
  importCommit(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string>,
    @Req() req: Request,
  ) {
    const opts = new ZodValidationPipe(leadImportOptionsSchema).transform(
      importOptionsFromForm(body),
    );
    return this.importer.commit(user, requireFile(file), opts, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.LEADS_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.LEADS_MANAGE)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createLeadSchema)) body: CreateLeadData,
    @Req() req: Request,
  ) {
    return this.leads.create(user, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.LEADS_MANAGE)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateLeadSchema)) body: UpdateLeadData,
    @Req() req: Request,
  ) {
    return this.leads.update(user, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.LEADS_DELETE)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.leads.anonymize(user, id, requestMeta(req));
    return { ok: true };
  }

  @Post(':id/notes')
  @RequirePermissions(PERMISSIONS.LEADS_MANAGE)
  addNote(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(leadNoteSchema)) body: { note: string },
  ) {
    return this.leads.addNote(user, id, body.note);
  }

  @Post(':id/consents')
  @RequirePermissions(PERMISSIONS.LEADS_MANAGE)
  grantConsent(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(consentInputSchema)) body: ConsentInput,
    @Req() req: Request,
  ) {
    return this.leads.grantConsent(user, id, body, requestMeta(req));
  }

  @Post(':id/consents/withdraw')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.LEADS_MANAGE)
  withdrawConsent(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(withdrawConsentSchema))
    body: z.output<typeof withdrawConsentSchema>,
    @Req() req: Request,
  ) {
    return this.leads.withdrawConsent(user, id, body.channel, body.reason, requestMeta(req));
  }

  @Post(':id/do-not-contact')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.LEADS_MANAGE)
  async markDnc(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(doNotContactSchema)) body: { reason: string },
    @Req() req: Request,
  ) {
    await this.dnc.markLead(user, id, body.reason, requestMeta(req));
    return this.leads.get(id);
  }

  @Delete(':id/do-not-contact')
  @RequirePermissions(PERMISSIONS.DNC_MANAGE)
  async unmarkDnc(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.dnc.unmarkLead(user, id, requestMeta(req));
    return this.leads.get(id);
  }
}

@Controller('do-not-contact')
export class DncController {
  constructor(private readonly dnc: DncService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.LEADS_READ)
  list(@Query(new ZodValidationPipe(listDncQuerySchema)) q: z.output<typeof listDncQuerySchema>) {
    return this.dnc.list(q);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.LEADS_MANAGE)
  add(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(dncEntrySchema)) body: DncEntryInput,
    @Req() req: Request,
  ) {
    return this.dnc.add(user, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DNC_MANAGE)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.dnc.remove(user, id, requestMeta(req));
    return { ok: true };
  }
}

@Module({
  controllers: [LeadsController, DncController],
  providers: [LeadsService, DncService, LeadActivityService, LeadImportService],
  exports: [LeadsService, DncService, LeadActivityService],
})
export class LeadsModule {}
