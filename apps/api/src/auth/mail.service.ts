import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

/**
 * Pengirim email transaksional. Jika SMTP belum dikonfigurasi, isi email hanya
 * ditulis ke log server (development) — tidak ada email yang terkirim.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;

  constructor() {
    const e = env();
    this.transporter = e.SMTP_HOST
      ? nodemailer.createTransport({
          host: e.SMTP_HOST,
          port: e.SMTP_PORT,
          secure: e.SMTP_PORT === 465,
          auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
        })
      : null;
  }

  get isConfigured() {
    return this.transporter !== null;
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transporter) {
      if (env().NODE_ENV === 'production') {
        this.logger.error(`SMTP belum dikonfigurasi — email "${subject}" ke ${to} TIDAK terkirim.`);
      } else {
        this.logger.warn(`[SMTP nonaktif] Email ke ${to}\nSubjek: ${subject}\n${text}`);
      }
      return;
    }
    await this.transporter.sendMail({ from: env().SMTP_FROM, to, subject, text });
  }
}
