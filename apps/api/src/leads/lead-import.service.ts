import { BadRequestException, Injectable } from '@nestjs/common';
import type { ContactChannel, Prisma } from '@smge/database';
import {
  isValidTikTokUsername,
  LEAD_IMPORT_COLUMNS,
  normalizeEmail,
  normalizePhone,
  normalizeTikTokUsername,
  type LeadImportOptions,
} from '@smge/shared';
import type { ImportRowIssue, LeadImportPreviewDto, LeadImportResultDto } from '@smge/types';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { RequestMeta } from '../common/utils/request';
import { PrismaService } from '../prisma/prisma.service';
import { DncService } from './dnc.service';
import { LeadActivityService } from './lead-activity.service';

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

type Field = keyof typeof LEAD_IMPORT_COLUMNS;

interface ParsedRow {
  row: number;
  name: string | null;
  tiktokUsername: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  notes: string | null;
  consents: ContactChannel[];
  // ternormalisasi
  u: string | null;
  e: string | null;
  p: string | null;
}

interface Classified extends ParsedRow {
  status: 'new' | 'duplicate' | 'blocked';
  existingId?: string;
}

const TRUTHY = new Set(['ya', 'yes', 'y', '1', 'true', 'setuju', 'x']);
const emailCheck = z.string().email();

@Injectable()
export class LeadImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: LeadActivityService,
    private readonly audit: AuditService,
  ) {}

  /** Parsing & validasi baris. Kolom dikenali dari header (lihat LEAD_IMPORT_COLUMNS). */
  parse(buffer: Buffer): {
    rows: ParsedRow[];
    invalid: ImportRowIssue[];
    detected: Record<string, string>;
  } {
    if (buffer.length > IMPORT_MAX_BYTES)
      throw new BadRequestException('Ukuran file maksimal 5 MB');
    let records: string[][];
    try {
      records = parse(buffer, {
        bom: true,
        delimiter: [',', ';', '\t'],
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      }) as string[][];
    } catch {
      throw new BadRequestException('File CSV tidak dapat dibaca. Pastikan formatnya CSV (UTF-8).');
    }
    if (records.length < 2) throw new BadRequestException('File kosong atau hanya berisi header');
    if (records.length - 1 > IMPORT_MAX_ROWS) {
      throw new BadRequestException(`Maksimal ${IMPORT_MAX_ROWS} baris per import`);
    }

    const header = records[0].map((h) => h.toLowerCase().trim().replace(/\s+/g, '_'));
    const index: Partial<Record<Field, number>> = {};
    const detected: Record<string, string> = {};
    for (const [field, aliases] of Object.entries(LEAD_IMPORT_COLUMNS) as [
      Field,
      readonly string[],
    ][]) {
      const i = header.findIndex((h) => aliases.includes(h));
      if (i >= 0) {
        index[field] = i;
        detected[field] = records[0][i];
      }
    }
    if (
      index.tiktokUsername === undefined &&
      index.email === undefined &&
      index.phone === undefined
    ) {
      throw new BadRequestException(
        'Kolom kontak tidak ditemukan. Sertakan minimal satu kolom: tiktok_username, email, atau phone.',
      );
    }

    const rows: ParsedRow[] = [];
    const invalid: ImportRowIssue[] = [];
    records.slice(1).forEach((rec, i) => {
      const rowNo = i + 2; // baris 1 = header
      const get = (f: Field) => {
        const idx = index[f];
        const v = idx === undefined ? '' : (rec[idx] ?? '').trim();
        return v.length ? v : null;
      };
      const username = get('tiktokUsername');
      const email = get('email');
      const phone = get('phone');
      const problems: string[] = [];
      if (username && !isValidTikTokUsername(username))
        problems.push('username TikTok tidak valid');
      if (email && !emailCheck.safeParse(email).success) problems.push('email tidak valid');
      if (phone && !normalizePhone(phone)) problems.push('nomor telepon tidak valid');
      if (!username && !email && !phone) problems.push('tidak ada kontak');
      if (problems.length) {
        invalid.push({ row: rowNo, message: problems.join(', ') });
        return;
      }
      const consents: ContactChannel[] = [];
      if (TRUTHY.has((get('consentWhatsapp') ?? '').toLowerCase()) && phone)
        consents.push('WHATSAPP');
      if (TRUTHY.has((get('consentEmail') ?? '').toLowerCase()) && email) consents.push('EMAIL');
      rows.push({
        row: rowNo,
        name: get('name')?.slice(0, 120) ?? null,
        tiktokUsername: username,
        email,
        phone,
        tags: (get('tags') ?? '')
          .split(/[,|]/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 20),
        notes: get('notes')?.slice(0, 2000) ?? null,
        consents,
        u: normalizeTikTokUsername(username),
        e: normalizeEmail(email),
        p: normalizePhone(phone),
      });
    });
    return { rows, invalid, detected };
  }

  /** Menandai setiap baris: baru, duplikat (di DB atau di file), atau diblokir (DNC). */
  private async classify(rows: ParsedRow[]): Promise<Classified[]> {
    const us = rows.map((r) => r.u).filter(Boolean) as string[];
    const es = rows.map((r) => r.e).filter(Boolean) as string[];
    const ps = rows.map((r) => r.p).filter(Boolean) as string[];

    const [existing, blocked] = await Promise.all([
      this.prisma.lead.findMany({
        where: {
          OR: [
            { tiktokUsernameNormalized: { in: us } },
            { emailNormalized: { in: es } },
            { phoneNormalized: { in: ps } },
          ],
        },
        select: {
          id: true,
          tiktokUsernameNormalized: true,
          emailNormalized: true,
          phoneNormalized: true,
        },
      }),
      this.prisma.doNotContactEntry.findMany({
        where: {
          OR: [
            { channel: 'TIKTOK_DM', valueNormalized: { in: us } },
            { channel: 'EMAIL', valueNormalized: { in: es } },
            { channel: 'PHONE', valueNormalized: { in: ps } },
          ],
        },
        select: { channel: true, valueNormalized: true },
      }),
    ]);

    const byKey = new Map<string, string>();
    for (const l of existing) {
      if (l.tiktokUsernameNormalized) byKey.set(`u:${l.tiktokUsernameNormalized}`, l.id);
      if (l.emailNormalized) byKey.set(`e:${l.emailNormalized}`, l.id);
      if (l.phoneNormalized) byKey.set(`p:${l.phoneNormalized}`, l.id);
    }
    const blockedKeys = new Set(
      blocked.map(
        (b) =>
          `${b.channel === 'TIKTOK_DM' ? 'u' : b.channel === 'EMAIL' ? 'e' : 'p'}:${b.valueNormalized}`,
      ),
    );
    const seenInFile = new Set<string>();

    return rows.map((r) => {
      const keys = [r.u && `u:${r.u}`, r.e && `e:${r.e}`, r.p && `p:${r.p}`].filter(
        Boolean,
      ) as string[];
      if (keys.some((k) => blockedKeys.has(k))) return { ...r, status: 'blocked' };
      const existingId = keys.map((k) => byKey.get(k)).find(Boolean);
      const dupInFile = keys.some((k) => seenInFile.has(k));
      keys.forEach((k) => seenInFile.add(k));
      if (existingId) return { ...r, status: 'duplicate', existingId };
      if (dupInFile) return { ...r, status: 'duplicate' };
      return { ...r, status: 'new' };
    });
  }

  async preview(buffer: Buffer): Promise<LeadImportPreviewDto> {
    const { rows, invalid, detected } = this.parse(buffer);
    const classified = await this.classify(rows);
    const count = (s: Classified['status']) => classified.filter((r) => r.status === s).length;
    return {
      totalRows: rows.length + invalid.length,
      validRows: rows.length,
      newLeads: count('new'),
      duplicates: count('duplicate'),
      blocked: count('blocked'),
      invalid: invalid.slice(0, 100),
      detectedColumns: detected,
      sample: classified.slice(0, 20).map((r) => ({
        row: r.row,
        name: r.name,
        tiktokUsername: r.tiktokUsername,
        email: r.email,
        phone: r.phone,
        status: r.status,
      })),
    };
  }

  async commit(
    actor: RequestUser,
    buffer: Buffer,
    opts: LeadImportOptions,
    meta: RequestMeta,
  ): Promise<LeadImportResultDto> {
    const { rows, invalid } = this.parse(buffer);
    const classified = await this.classify(rows);
    const result: LeadImportResultDto = {
      created: 0,
      updated: 0,
      skipped: 0,
      blocked: 0,
      invalid: invalid.length,
    };
    const evidence = `Import: ${opts.sourceDescription}`;

    for (const r of classified) {
      if (r.status === 'blocked') {
        result.blocked++;
        continue;
      }
      if (r.status === 'duplicate') {
        if (opts.duplicateStrategy === 'update_empty' && r.existingId) {
          const merged = await this.mergeInto(r.existingId, r, opts, actor.id);
          if (merged) result.updated++;
          else result.skipped++;
        } else {
          result.skipped++;
        }
        continue;
      }
      await this.prisma.$transaction(async (tx) => {
        const lead = await tx.lead.create({
          data: {
            name: r.name,
            tiktokUsername: r.u,
            tiktokUsernameNormalized: r.u,
            email: r.email,
            emailNormalized: r.e,
            phone: r.phone,
            phoneNormalized: r.p,
            notes: r.notes,
            tags: [...new Set([...opts.tags, ...r.tags])],
            source: 'IMPORT',
            sourceAccountId: opts.sourceAccountId,
            sourceCampaignId: opts.sourceCampaignId,
          },
        });
        await this.activities.log(
          lead.id,
          'IMPORT',
          `Diimpor dari: ${opts.sourceDescription}`,
          actor.id,
          { row: r.row },
          tx,
        );
        for (const channel of r.consents) {
          await tx.leadConsent.create({
            data: {
              leadId: lead.id,
              channel,
              status: 'GRANTED',
              source: 'IMPORT',
              evidence,
              grantedAt: new Date(),
              recordedById: actor.id,
            },
          });
        }
      });
      result.created++;
    }

    await this.audit.log({
      action: 'lead.imported',
      actor,
      entityType: 'lead',
      metadata: {
        ...result,
        sourceDescription: opts.sourceDescription,
        duplicateStrategy: opts.duplicateStrategy,
      },
      meta,
    });
    return result;
  }

  /** Mengisi kolom kosong prospek lama tanpa menimpa data yang sudah ada. */
  private async mergeInto(leadId: string, r: ParsedRow, opts: LeadImportOptions, actorId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.deletedAt || lead.doNotContact) return false;
    const data: Prisma.LeadUpdateInput = {};
    const filled: string[] = [];
    const free = async (
      field: 'tiktokUsernameNormalized' | 'emailNormalized' | 'phoneNormalized',
      v: string,
    ) =>
      !(await this.prisma.lead.findFirst({
        where: { [field]: v, id: { not: leadId } },
        select: { id: true },
      }));

    if (!lead.name && r.name) {
      data.name = r.name;
      filled.push('nama');
    }
    if (!lead.tiktokUsernameNormalized && r.u && (await free('tiktokUsernameNormalized', r.u))) {
      Object.assign(data, { tiktokUsername: r.u, tiktokUsernameNormalized: r.u });
      filled.push('username TikTok');
    }
    if (!lead.emailNormalized && r.e && (await free('emailNormalized', r.e))) {
      Object.assign(data, { email: r.email, emailNormalized: r.e });
      filled.push('email');
    }
    if (!lead.phoneNormalized && r.p && (await free('phoneNormalized', r.p))) {
      Object.assign(data, { phone: r.phone, phoneNormalized: r.p });
      filled.push('telepon');
    }
    const tags = [...new Set([...lead.tags, ...opts.tags, ...r.tags])];
    if (tags.length !== lead.tags.length) data.tags = tags;
    if (!Object.keys(data).length) return false;

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: leadId }, data });
      await this.activities.log(
        leadId,
        'MERGE',
        filled.length
          ? `Data dilengkapi dari import: ${filled.join(', ')}`
          : 'Tag ditambahkan dari import',
        actorId,
        { row: r.row, source: opts.sourceDescription },
        tx,
      );
    });
    return true;
  }
}
