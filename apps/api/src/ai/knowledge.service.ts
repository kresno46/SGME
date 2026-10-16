import { Injectable, NotFoundException } from '@nestjs/common';
import type { KnowledgeDocument, Prisma } from '@smge/database';
import {
  KNOWLEDGE_CATEGORY_LABELS,
  type KnowledgeCategory,
  type ListKnowledgeQuery,
  type knowledgeDocumentSchema,
  type updateKnowledgeDocumentSchema,
} from '@smge/shared';
import type { KnowledgeDocumentDto } from '@smge/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { paginate, RequestMeta } from '../common/utils/request';
import { USER_REF_SELECT, iso, toRef } from '../common/utils/refs';
import { PrismaService } from '../prisma/prisma.service';

/** Batas total konteks KB yang dikirim ke model, dan per dokumen. */
export const KB_CONTEXT_MAX_CHARS = 12_000;
const KB_DOC_MAX_CHARS = 4_000;

/** Kategori yang paling sering dibutuhkan diprioritaskan bila skor relevansi sama. */
const CATEGORY_PRIORITY: KnowledgeCategory[] = [
  'PRODUCT_PROFILE',
  'FAQ',
  'FEATURES',
  'REGISTRATION',
  'INSTALLATION',
  'PRICING',
  'SERVICE_GUIDE',
  'TERMS',
  'PRIVACY_POLICY',
];

const STOPWORDS = new Set(
  'yang dan atau untuk dengan dari pada ini itu ada apa bagaimana gimana kak saya aku kamu bisa mau ingin tidak gak juga sudah belum akan'.split(
    ' ',
  ),
);

export interface KnowledgeContext {
  /** Teks bernomor [1], [2], … untuk prompt */
  text: string;
  /** Urutan sesuai nomor pada teks */
  sources: Array<{ id: string; title: string }>;
}

function tokens(s: string) {
  return s
    .toLowerCase()
    .split(/[^a-z0-9à-ÿ]+/i)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

type Row = Prisma.KnowledgeDocumentGetPayload<{
  include: { updatedBy: { select: typeof USER_REF_SELECT } };
}>;

function toDto(d: Row): KnowledgeDocumentDto {
  return {
    id: d.id,
    title: d.title,
    category: d.category,
    content: d.content,
    status: d.status,
    version: d.version,
    publishedAt: iso(d.publishedAt),
    updatedBy: toRef(d.updatedBy),
    updatedAt: d.updatedAt.toISOString(),
  };
}

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListKnowledgeQuery) {
    const where: Prisma.KnowledgeDocumentWhereInput = {
      ...(q.category ? { category: q.category } : {}),
      ...(q.status ? { status: q.status } : { status: { not: 'ARCHIVED' } }),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: 'insensitive' } },
              { content: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.knowledgeDocument.findMany({
        where,
        include: { updatedBy: { select: USER_REF_SELECT } },
        orderBy: [{ category: 'asc' }, { title: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.knowledgeDocument.count({ where }),
    ]);
    return paginate(rows.map(toDto), total, q.page, q.pageSize);
  }

  async get(id: string) {
    const d = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
      include: { updatedBy: { select: USER_REF_SELECT } },
    });
    if (!d) throw new NotFoundException('Dokumen tidak ditemukan');
    return toDto(d);
  }

  async create(
    actor: RequestUser,
    input: z.output<typeof knowledgeDocumentSchema>,
    meta: RequestMeta,
  ) {
    const d = await this.prisma.knowledgeDocument.create({
      data: {
        ...input,
        updatedById: actor.id,
        publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
      },
    });
    await this.audit.log({
      action: 'knowledge.created',
      actor,
      entityType: 'knowledge_document',
      entityId: d.id,
      metadata: { title: d.title, status: d.status },
      meta,
    });
    return this.get(d.id);
  }

  async update(
    actor: RequestUser,
    id: string,
    input: z.output<typeof updateKnowledgeDocumentSchema>,
    meta: RequestMeta,
  ) {
    const existing = await this.prisma.knowledgeDocument.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Dokumen tidak ditemukan');
    const contentChanged =
      (input.content !== undefined && input.content !== existing.content) ||
      (input.title !== undefined && input.title !== existing.title);
    await this.prisma.knowledgeDocument.update({
      where: { id },
      data: {
        ...input,
        updatedById: actor.id,
        ...(contentChanged ? { version: { increment: 1 } } : {}),
        ...(input.status === 'PUBLISHED' && (existing.status !== 'PUBLISHED' || contentChanged)
          ? { publishedAt: new Date() }
          : {}),
      },
    });
    await this.audit.log({
      action: 'knowledge.updated',
      actor,
      entityType: 'knowledge_document',
      entityId: id,
      metadata: { fields: Object.keys(input), previousVersion: existing.version },
      meta,
    });
    return this.get(id);
  }

  async remove(actor: RequestUser, id: string, meta: RequestMeta) {
    const d = await this.prisma.knowledgeDocument.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Dokumen tidak ditemukan');
    await this.prisma.knowledgeDocument.delete({ where: { id } });
    await this.audit.log({
      action: 'knowledge.deleted',
      actor,
      entityType: 'knowledge_document',
      entityId: id,
      metadata: { title: d.title },
      meta,
    });
  }

  countPublished() {
    return this.prisma.knowledgeDocument.count({ where: { status: 'PUBLISHED' } });
  }

  /**
   * Memilih dokumen terbit yang paling relevan dengan pertanyaan (pencocokan kata kunci sederhana).
   * Cukup untuk KB berukuran kecil–menengah; retrieval berbasis embedding dapat ditambahkan bila KB membesar.
   */
  async buildContext(query: string, maxChars = KB_CONTEXT_MAX_CHARS): Promise<KnowledgeContext> {
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, title: true, category: true, content: true },
    });
    if (!docs.length) return { text: '', sources: [] };

    const q = new Set(tokens(query));
    const scored = docs
      .map((d) => {
        const body = new Set(tokens(`${d.title} ${d.content}`));
        let score = 0;
        q.forEach((t) => body.has(t) && score++);
        return { d, score };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          CATEGORY_PRIORITY.indexOf(a.d.category) - CATEGORY_PRIORITY.indexOf(b.d.category),
      );

    const parts: string[] = [];
    const sources: KnowledgeContext['sources'] = [];
    let used = 0;
    for (const { d } of scored) {
      const content =
        d.content.length > KB_DOC_MAX_CHARS
          ? `${d.content.slice(0, KB_DOC_MAX_CHARS)}…`
          : d.content;
      const block = `[${sources.length + 1}] ${d.title} (${KNOWLEDGE_CATEGORY_LABELS[d.category]})\n${content}`;
      if (used + block.length > maxChars && sources.length > 0) break;
      parts.push(block);
      sources.push({ id: d.id, title: d.title });
      used += block.length;
    }
    return { text: parts.join('\n\n'), sources };
  }
}

export type { KnowledgeDocument };
