import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@smge/database';
import { SettingsService } from '../common/settings.service';
import { LeadsService } from '../leads/leads.service';
import { PrismaService } from '../prisma/prisma.service';

export interface RetentionReport {
  dryRun: boolean;
  ranAt: string;
  leadsAnonymized: number;
  auditLogsDeleted: number;
  integrationLogsDeleted: number;
  sessionsDeleted: number;
  resetTokensDeleted: number;
}

const DAY = 86_400_000;

/**
 * Kebijakan retensi data (nilai di system_settings):
 * - Data pribadi prospek tanpa aktivitas dianonimkan (baris tetap ada untuk statistik).
 * - Log audit & log integrasi lama dihapus.
 * - Sesi dan token reset yang sudah tidak berlaku dibersihkan.
 * Daftar larangan kontak TIDAK dihapus agar permintaan "jangan hubungi" tetap dihormati.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async run(opts: { dryRun?: boolean; now?: Date } = {}): Promise<RetentionReport> {
    const now = opts.now ?? new Date();
    const dryRun = opts.dryRun ?? false;
    const [leadDays, auditDays, integrationDays] = await Promise.all([
      this.settings.getNumber('retention.lead_inactive_days', 730),
      this.settings.getNumber('retention.audit_log_days', 1095),
      this.settings.getNumber('retention.integration_log_days', 180),
    ]);
    const leadCutoff = new Date(now.getTime() - leadDays * DAY);

    const staleLeads: Prisma.LeadWhereInput = {
      anonymizedAt: null,
      updatedAt: { lt: leadCutoff },
      OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: leadCutoff } }],
      outreachTasks: { none: { updatedAt: { gte: leadCutoff } } },
    };
    const oldAudit = { createdAt: { lt: new Date(now.getTime() - auditDays * DAY) } };
    const oldIntegration = { createdAt: { lt: new Date(now.getTime() - integrationDays * DAY) } };
    const deadSessions: Prisma.UserSessionWhereInput = {
      OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: new Date(now.getTime() - 30 * DAY) } }],
    };
    const deadTokens: Prisma.PasswordResetTokenWhereInput = {
      OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }],
    };

    let report: RetentionReport;
    if (dryRun) {
      const [l, a, i, s, t] = await Promise.all([
        this.prisma.lead.count({ where: staleLeads }),
        this.prisma.auditLog.count({ where: oldAudit }),
        this.prisma.integrationLog.count({ where: oldIntegration }),
        this.prisma.userSession.count({ where: deadSessions }),
        this.prisma.passwordResetToken.count({ where: deadTokens }),
      ]);
      report = {
        dryRun,
        ranAt: now.toISOString(),
        leadsAnonymized: l,
        auditLogsDeleted: a,
        integrationLogsDeleted: i,
        sessionsDeleted: s,
        resetTokensDeleted: t,
      };
    } else {
      const leads = await this.prisma.lead.findMany({ where: staleLeads, select: { id: true } });
      for (const { id } of leads) {
        await this.prisma.$transaction([
          this.prisma.lead.update({ where: { id }, data: LeadsService.anonymizedData(now) }),
          this.prisma.leadActivity.deleteMany({ where: { leadId: id } }),
          this.prisma.leadConsent.deleteMany({ where: { leadId: id } }),
          this.prisma.outreachTask.updateMany({
            where: { leadId: id },
            data: { draftMessage: null, finalMessage: null, responseSummary: null },
          }),
        ]);
      }
      const [a, i, s, t] = await Promise.all([
        this.prisma.auditLog.deleteMany({ where: oldAudit }),
        this.prisma.integrationLog.deleteMany({ where: oldIntegration }),
        this.prisma.userSession.deleteMany({ where: deadSessions }),
        this.prisma.passwordResetToken.deleteMany({ where: deadTokens }),
      ]);
      report = {
        dryRun,
        ranAt: now.toISOString(),
        leadsAnonymized: leads.length,
        auditLogsDeleted: a.count,
        integrationLogsDeleted: i.count,
        sessionsDeleted: s.count,
        resetTokensDeleted: t.count,
      };
      await this.prisma.auditLog.create({
        data: {
          action: 'system.retention_run',
          metadata: report as unknown as Prisma.InputJsonValue,
        },
      });
    }
    this.logger.log(`Retensi data ${dryRun ? '(simulasi)' : ''}: ${JSON.stringify(report)}`);
    return report;
  }
}
