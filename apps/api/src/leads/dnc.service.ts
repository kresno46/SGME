import { ownerScope, scopeUser } from '../common/data-scope';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ContactChannel, Prisma } from '@smge/database';
import {
  normalizeEmail,
  normalizePhone,
  normalizeTikTokUsername,
  type DncEntryInput,
} from '@smge/shared';
import type { DncEntryDto } from '@smge/types';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { paginate, RequestMeta } from '../common/utils/request';
import { USER_REF_SELECT, toRef } from '../common/utils/refs';
import { PrismaService } from '../prisma/prisma.service';
import { LeadActivityService } from './lead-activity.service';

type Tx = Prisma.TransactionClient | PrismaService;

/**
 * Daftar larangan kontak (do-not-contact).
 * Entri disimpan per JENIS identitas: TIKTOK_DM = username, EMAIL = email, PHONE = nomor telepon
 * (dipakai juga untuk WhatsApp & SMS). Larangan berlaku untuk semua kanal.
 * Invarian: setiap prospek yang cocok dengan entri memiliki leads.do_not_contact = true.
 */
@Injectable()
export class DncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: LeadActivityService,
    private readonly audit: AuditService,
  ) {}

  /** Mengubah input bebas menjadi pasangan (jenis, nilai ternormalisasi). */
  static normalize(
    channel: ContactChannel,
    value: string,
  ): { channel: ContactChannel; value: string } | null {
    if (channel === 'TIKTOK_DM') {
      const v = normalizeTikTokUsername(value);
      return v ? { channel, value: v } : null;
    }
    if (channel === 'EMAIL') {
      const v = normalizeEmail(value);
      return v ? { channel, value: v } : null;
    }
    const v = normalizePhone(value);
    return v ? { channel: 'PHONE', value: v } : null;
  }

  /** Identitas ternormalisasi milik prospek dalam format entri DNC. */
  static identitiesOf(lead: {
    tiktokUsernameNormalized: string | null;
    emailNormalized: string | null;
    phoneNormalized: string | null;
  }) {
    const out: Array<{ channel: ContactChannel; valueNormalized: string }> = [];
    if (lead.tiktokUsernameNormalized)
      out.push({ channel: 'TIKTOK_DM', valueNormalized: lead.tiktokUsernameNormalized });
    if (lead.emailNormalized) out.push({ channel: 'EMAIL', valueNormalized: lead.emailNormalized });
    if (lead.phoneNormalized) out.push({ channel: 'PHONE', valueNormalized: lead.phoneNormalized });
    return out;
  }

  async isBlocked(
    identities: Array<{ channel: ContactChannel; valueNormalized: string }>,
    tx: Tx = this.prisma,
  ): Promise<boolean> {
    if (!identities.length) return false;
    const hit = await tx.doNotContactEntry.findFirst({
      where: {
        OR: identities.map((i) => ({ channel: i.channel, valueNormalized: i.valueNormalized })),
      },
      select: { id: true },
    });
    return !!hit;
  }

  async list(q: { page: number; pageSize: number; search?: string; channel?: ContactChannel }) {
    const where: Prisma.DoNotContactEntryWhereInput = {
      ...(scopeUser() && scopeUser()!.role !== 'SUPER_ADMIN' ? { addedById: scopeUser()!.id } : {}),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.search
        ? { valueNormalized: { contains: q.search.toLowerCase().replace(/^@/, '') } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.doNotContactEntry.findMany({
        where,
        include: { addedBy: { select: USER_REF_SELECT } },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.doNotContactEntry.count({ where }),
    ]);
    const items: DncEntryDto[] = rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      valueNormalized: r.valueNormalized,
      reason: r.reason,
      addedBy: toRef(r.addedBy),
      createdAt: r.createdAt.toISOString(),
    }));
    return paginate(items, total, q.page, q.pageSize);
  }

  /** Menambah entri manual dan menandai seluruh prospek yang cocok. */
  async add(actor: RequestUser, input: DncEntryInput, meta: RequestMeta) {
    const n = DncService.normalize(input.channel, input.value);
    if (!n) throw new BadRequestException('Nilai kontak tidak valid untuk jenis yang dipilih');

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.doNotContactEntry.upsert({
        where: { channel_valueNormalized: { channel: n.channel, valueNormalized: n.value } },
        create: {
          channel: n.channel,
          valueNormalized: n.value,
          reason: input.reason,
          addedById: actor.id,
        },
        update: {},
      });
      const field =
        n.channel === 'TIKTOK_DM'
          ? 'tiktokUsernameNormalized'
          : n.channel === 'EMAIL'
            ? 'emailNormalized'
            : 'phoneNormalized';
      const leads = await tx.lead.findMany({
        where: { ...ownerScope(), [field]: n.value, doNotContact: false },
        select: { id: true },
      });
      for (const l of leads) {
        await this.applyToLead(tx, l.id, actor.id, input.reason ?? 'Kontak masuk daftar larangan');
      }
      await this.audit.log({
        action: 'dnc.added',
        actor,
        entityType: 'dnc_entry',
        entityId: entry.id,
        metadata: { channel: n.channel, affectedLeads: leads.length },
        meta,
      });
      return { id: entry.id, affectedLeads: leads.length };
    });
  }

  /**
   * Menandai prospek "jangan dihubungi": status DNC, izin dicabut, tugas terbuka dibatalkan.
   * Dipanggil dari DNC manual, permintaan prospek, atau saat prospek baru cocok dengan daftar.
   */
  async applyToLead(
    tx: Prisma.TransactionClient,
    leadId: string,
    actorId: string | null,
    reason: string,
  ) {
    const now = new Date();
    await tx.lead.update({
      where: { id: leadId },
      data: { doNotContact: true, status: 'DO_NOT_CONTACT', nextFollowUpAt: null },
    });
    await tx.leadConsent.updateMany({
      where: { leadId, status: 'GRANTED' },
      data: { status: 'WITHDRAWN', withdrawnAt: now },
    });
    await tx.outreachTask.updateMany({
      where: { leadId, status: { in: ['DRAFT', 'WAITING_REVIEW', 'APPROVED', 'FOLLOW_UP'] } },
      data: {
        status: 'CANCELLED',
        cancelReason: 'Prospek masuk daftar larangan kontak',
        followUpAt: null,
      },
    });
    await this.activities.log(
      leadId,
      'CONSENT_CHANGE',
      `Ditandai jangan dihubungi: ${reason}`,
      actorId,
      undefined,
      tx,
    );
  }

  /** Menandai satu prospek DNC dan menyimpan identitasnya ke daftar larangan. */
  async markLead(actor: RequestUser, leadId: string, reason: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, ...ownerScope() } });
      if (!lead || lead.deletedAt) throw new NotFoundException('Prospek tidak ditemukan');
      for (const i of DncService.identitiesOf(lead)) {
        await tx.doNotContactEntry.upsert({
          where: {
            channel_valueNormalized: { channel: i.channel, valueNormalized: i.valueNormalized },
          },
          create: { ...i, reason, addedById: actor.id },
          update: {},
        });
      }
      await this.applyToLead(tx, leadId, actor.id, reason);
    });
    await this.audit.log({
      action: 'lead.do_not_contact',
      actor,
      entityType: 'lead',
      entityId: leadId,
      meta,
    });
  }

  /** Mencabut larangan (hanya permission dnc:manage). Izin komunikasi TIDAK dipulihkan otomatis. */
  async unmarkLead(actor: RequestUser, leadId: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id: leadId, ...ownerScope() } });
      if (!lead || lead.deletedAt) throw new NotFoundException('Prospek tidak ditemukan');
      const identities = DncService.identitiesOf(lead);
      if (identities.length) {
        await tx.doNotContactEntry.deleteMany({
          where: {
            OR: identities.map((i) => ({ channel: i.channel, valueNormalized: i.valueNormalized })),
          },
        });
      }
      await tx.lead.update({
        where: { id: leadId },
        data: { doNotContact: false, status: lead.lastContactedAt ? 'CONTACTED' : 'NEW' },
      });
      await this.activities.log(
        leadId,
        'CONSENT_CHANGE',
        'Larangan kontak dicabut',
        actor.id,
        undefined,
        tx,
      );
    });
    await this.audit.log({
      action: 'lead.do_not_contact_removed',
      actor,
      entityType: 'lead',
      entityId: leadId,
      meta,
    });
  }

  async remove(actor: RequestUser, id: string, meta: RequestMeta) {
    const entry = await this.prisma.doNotContactEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Entri tidak ditemukan');
    await this.prisma.doNotContactEntry.delete({ where: { id } });
    await this.audit.log({
      action: 'dnc.removed',
      actor,
      entityType: 'dnc_entry',
      entityId: id,
      metadata: { channel: entry.channel },
      meta,
    });
  }
}
