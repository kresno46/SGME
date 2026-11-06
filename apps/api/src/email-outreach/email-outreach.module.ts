import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PERMISSIONS } from '@smge/shared';
import type { Prisma } from '@smge/database';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { CurrentUser, RequestUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ownerScope } from '../common/data-scope';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

const subject = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\r\n]+$/, 'Subjek tidak boleh berisi baris baru.');
const body = z.string().trim().min(5).max(10000);
const templateSchema = z.object({ name: z.string().trim().min(1).max(80), subject, body });
const sendSchema = z.object({
  requestId: z.string().uuid(),
  subject,
  body,
  confirmed: z.literal(true),
  recipients: z
    .array(
      z.object({
        email: z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
        name: z
          .string()
          .trim()
          .max(100)
          .regex(/^[^\r\n]*$/, 'Nama tidak boleh berisi baris baru.')
          .default(''),
      }),
    )
    .min(1)
    .max(30),
});
type SendInput = z.infer<typeof sendSchema>;

export const EMAIL_GATEWAY = Symbol('EMAIL_OUTREACH_GATEWAY');
export interface EmailGateway {
  send(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{ accepted: unknown[] }>;
}
function gateway(): EmailGateway | null {
  const e = env();
  if (!e.EMAIL_OUTREACH_ENABLED || !e.SMTP_HOST?.trim()) return null;
  const transport = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_PORT === 465,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
  });
  return { send: (message) => transport.sendMail(message) };
}

function render(text: string, name: string, email: string) {
  const result = text.replace(/\{\{\s*(nama|email)\s*\}\}/g, (_, key) =>
    key === 'nama' ? name || email.split('@')[0] : email,
  );
  if (/\{\{|\}\}/.test(result))
    throw new BadRequestException(
      'Variabel belum terisi. Gunakan {{nama}} dan {{email}} atau tulis link langsung.',
    );
  return result;
}

@Injectable()
export class EmailOutreachService {
  constructor(private readonly db: PrismaService) {}
  async list() {
    const where = ownerScope();
    const [items, counts] = await Promise.all([
      this.db.outreachEmail.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.db.outreachEmail.groupBy({ by: ['status'], where, _count: true }),
    ]);
    return { items, counts: Object.fromEntries(counts.map((row) => [row.status, row._count])) };
  }
  async enqueue(input: SendInput, user: RequestUser) {
    const e = env();
    if (!e.EMAIL_OUTREACH_ENABLED || !e.SMTP_HOST?.trim())
      throw new ServiceUnavailableException(
        'Email belum diaktifkan. Hubungi admin untuk menyiapkan SMTP perusahaan.',
      );
    const recipients = [...new Map(input.recipients.map((row) => [row.email, row])).values()];
    const messages = recipients.map((row) => ({
      ownerId: user.id,
      batchId: input.requestId,
      recipient: row.email,
      recipientName: row.name,
      sender: e.SMTP_FROM,
      subject: render(input.subject, row.name, row.email),
      body: render(input.body, row.name, row.email),
    }));
    if (
      messages.some(
        (message) => !subject.safeParse(message.subject).success || message.body.length > 10000,
      )
    )
      throw new BadRequestException(
        'Subjek atau pesan setelah personalisasi terlalu panjang. Periksa pratinjau.',
      );
    return this.db.$transaction(async (tx) => {
      // Serialize each owner's quota and idempotency checks, including concurrent tabs.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;
      const existing = await tx.outreachEmail.count({
        where: { ownerId: user.id, batchId: input.requestId },
      });
      if (existing) return { queued: existing };
      const blocked = await tx.doNotContactEntry.findFirst({
        where: { channel: 'EMAIL', valueNormalized: { in: recipients.map((row) => row.email) } },
      });
      if (blocked)
        throw new BadRequestException(
          'Ada penerima dalam daftar larangan kontak. Hapus penerima tersebut sebelum mengirim.',
        );
      const used = await tx.outreachEmail.count({
        where: { ownerId: user.id, createdAt: { gte: new Date(Date.now() - 86400000) } },
      });
      if (used + messages.length > 100)
        throw new BadRequestException(
          'Batas 100 email dalam 24 jam tercapai. Coba lagi setelah kuota tersedia.',
        );
      await tx.outreachEmail.createMany({ data: messages });
      return { queued: messages.length };
    });
  }
  async cancel(id: string) {
    const changed = await this.db.outreachEmail.updateMany({
      where: { id, ...ownerScope(), status: 'QUEUED' },
      data: { status: 'CANCELLED', detail: 'Dibatalkan operator.' },
    });
    if (!changed.count)
      throw new NotFoundException('Email menunggu tidak ditemukan atau sudah diproses.');
    return { ok: true };
  }
  templates() {
    return this.db.emailOutreachTemplate.findMany({
      where: ownerScope(),
      orderBy: { updatedAt: 'desc' },
    });
  }
  createTemplate(input: z.infer<typeof templateSchema>, user: RequestUser) {
    return this.db.emailOutreachTemplate.create({ data: { ...input, ownerId: user.id } });
  }
  async updateTemplate(id: string, input: z.infer<typeof templateSchema>) {
    const changed = await this.db.emailOutreachTemplate.updateMany({
      where: { id, ...ownerScope() },
      data: input,
    });
    if (!changed.count) throw new NotFoundException('Template tidak ditemukan.');
    return { ok: true };
  }
  async deleteTemplate(id: string) {
    const changed = await this.db.emailOutreachTemplate.deleteMany({
      where: { id, ...ownerScope() },
    });
    if (!changed.count) throw new NotFoundException('Template tidak ditemukan.');
    return { ok: true };
  }
}

@Controller('email-outreach')
@RequirePermissions(PERMISSIONS.OUTREACH_WORK)
export class EmailOutreachController {
  constructor(private readonly service: EmailOutreachService) {}
  @Get('config') config() {
    const e = env();
    return {
      enabled: !!(e.EMAIL_OUTREACH_ENABLED && e.SMTP_HOST?.trim()),
      sender: e.SMTP_FROM,
      maxRecipients: 30,
      dailyLimit: 100,
    };
  }
  @Get() list() {
    return this.service.list();
  }
  @Post() enqueue(
    @Body(new ZodValidationPipe(sendSchema)) input: SendInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.enqueue(input, user);
  }
  @Post(':id/cancel') cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancel(id);
  }
  @Get('templates') templates() {
    return this.service.templates();
  }
  @Post('templates') create(
    @Body(new ZodValidationPipe(templateSchema)) input: z.infer<typeof templateSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.createTemplate(input, user);
  }
  @Patch('templates/:id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(templateSchema)) input: z.infer<typeof templateSchema>,
  ) {
    return this.service.updateTemplate(id, input);
  }
  @Delete('templates/:id') remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteTemplate(id);
  }
}

// Each tick claims one durable row. A claim is never resent automatically after interruption.
@Injectable()
export class EmailOutreachWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailOutreachWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly db: PrismaService,
    @Inject(EMAIL_GATEWAY) private readonly mail: EmailGateway | null,
  ) {}
  onModuleInit() {
    if (env().NODE_ENV !== 'test' && this.mail)
      this.timer = setInterval(() => {
        void this.tick().catch(() =>
          this.logger.error('Antrean email belum dapat diproses. Periksa koneksi database.'),
        );
      }, 5000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (!this.mail || this.running) return;
    this.running = true;
    try {
      await this.db.outreachEmail.updateMany({
        where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - 300000) } },
        data: {
          status: 'UNVERIFIED',
          detail: 'Proses terputus. Periksa email keluar sebelum membuat kiriman baru.',
        },
      });
      const row = await this.db.$transaction(async (tx) => {
        const candidates = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM outreach_emails WHERE status = 'QUEUED' ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1`;
        if (!candidates[0]) return null;
        return tx.outreachEmail.update({
          where: { id: candidates[0].id },
          data: { status: 'PROCESSING' },
        });
      });
      if (!row) return;
      // Recheck DNC and owner status immediately before handing the message to SMTP.
      const [blocked, owner] = await Promise.all([
        this.db.doNotContactEntry.findFirst({
          where: { channel: 'EMAIL', valueNormalized: row.recipient },
        }),
        this.db.user.findUnique({ where: { id: row.ownerId }, select: { status: true } }),
      ]);
      if (blocked || owner?.status !== 'ACTIVE') {
        await this.db.outreachEmail.update({
          where: { id: row.id },
          data: {
            status: 'CANCELLED',
            detail: 'Penerima dilarang dihubungi atau pengguna tidak aktif.',
          },
        });
        return;
      }
      let result: Prisma.OutreachEmailUpdateInput;
      try {
        const response = await this.mail.send({
          from: row.sender,
          to: row.recipient,
          subject: row.subject,
          text: row.body,
        });
        result = response.accepted.some((value) => String(value).toLowerCase() === row.recipient)
          ? {
              status: 'ACCEPTED',
              detail: 'Diterima server email. Belum membuktikan masuk inbox atau dibaca.',
            }
          : { status: 'FAILED', detail: 'Server email menolak penerima. Periksa alamat email.' };
      } catch (error) {
        const code = (error as { responseCode?: number }).responseCode;
        result =
          code && code >= 400 && code < 600
            ? {
                status: 'FAILED',
                detail: `Server email menolak pengiriman (SMTP ${code}). Hubungi admin.`,
              }
            : {
                status: 'UNVERIFIED',
                detail:
                  'Koneksi email terputus atau hasil belum pasti. Periksa email keluar sebelum mengirim ulang.',
              };
      }
      await this.db.outreachEmail.update({ where: { id: row.id }, data: result });
    } finally {
      this.running = false;
    }
  }
}

@Module({
  controllers: [EmailOutreachController],
  providers: [
    EmailOutreachService,
    EmailOutreachWorker,
    { provide: EMAIL_GATEWAY, useFactory: gateway },
  ],
})
export class EmailOutreachModule {}
