import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AiInteractionType, Prisma } from '@smge/database';
import {
  AI_INTERACTION_TYPE_LABELS,
  CONTACT_CHANNEL_LABELS,
  detectProhibitedClaims,
  INTEREST_LEVEL_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  type AiSettings,
} from '@smge/shared';
import type {
  AiAnswerDto,
  AiDraftDto,
  AiLeadScoreDto,
  AiReplySuggestionDto,
  AiResultMeta,
  AiStatusDto,
  AiSummaryDto,
} from '@smge/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { SettingsService } from '../common/settings.service';
import { RequestMeta } from '../common/utils/request';
import { startOfMonth } from '../common/utils/refs';
import { env } from '../config/env';
import { LeadActivityService } from '../leads/lead-activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from './knowledge.service';
import { LLM_PROVIDER, LlmProvider, LlmProviderError } from './providers/llm-provider';
import { BASE_RULES, data, HANDOFF_GUIDE, knowledgeSection, SCHEMAS, SchemaName } from './prompts';

const SETTING_KEYS = {
  model: 'ai.model',
  mode: 'ai.mode',
  budget: 'ai.monthly_budget_usd',
  pricing: 'ai.pricing',
} as const;

const answerOut = z.object({
  answer: z.string().min(1),
  handoff: z.boolean(),
  handoffReason: z.string(),
  usedSourceNumbers: z.array(z.number().int()),
});
const replyOut = z.object({
  reply: z.string().min(1),
  detectedIntent: z.string(),
  handoff: z.boolean(),
  handoffReason: z.string(),
  usedSourceNumbers: z.array(z.number().int()),
});
const draftOut = z.object({ message: z.string().min(1).max(2000), rationale: z.string() });
const scoreOut = z.object({
  score: z.number().int().min(0).max(100),
  interestLevel: z.enum(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH']),
  reasons: z.array(z.string()).max(10),
  recommendedAction: z.string(),
});
const summaryOut = z.object({
  summary: z.string().min(1),
  keyPoints: z.array(z.string()).max(10),
  nextStep: z.string(),
});

interface RunOptions<T> {
  type: AiInteractionType;
  user: RequestUser;
  leadId?: string | null;
  schemaName: SchemaName;
  output: z.ZodType<T>;
  system: string;
  prompt: string;
  maxTokens: number;
  /** Teks keluaran yang diperiksa guardrail */
  textOf: (out: T) => string;
  /** Ringkasan input untuk log (tanpa data kontak) */
  logInput: Record<string, unknown>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Optional() @Inject(LLM_PROVIDER) private readonly provider: LlmProvider | null,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly knowledge: KnowledgeService,
    private readonly activities: LeadActivityService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ pengaturan & status

  async getSettings(): Promise<AiSettings> {
    const [model, mode, budget, pricing] = await Promise.all([
      this.settings.getJson<string | null>(SETTING_KEYS.model, null),
      this.settings.getJson<'COPILOT' | 'AUTO_REPLY'>(SETTING_KEYS.mode, 'COPILOT'),
      this.settings.getJson<number | null>(SETTING_KEYS.budget, null),
      this.settings.getJson<AiSettings['pricing']>(SETTING_KEYS.pricing, {}),
    ]);
    return { model, mode, monthlyBudgetUsd: budget, pricing };
  }

  async updateSettings(actor: RequestUser, input: AiSettings, meta: RequestMeta) {
    if (input.mode === 'AUTO_REPLY') {
      // Belum ada kanal pesan resmi yang terhubung (Fase 4) → auto-reply tidak boleh diaktifkan.
      throw new BadRequestException({
        statusCode: 400,
        message:
          'Mode Auto-Reply hanya dapat diaktifkan setelah integrasi messaging resmi TikTok tersedia dan mengizinkan balasan otomatis.',
        errors: { mode: ['Belum ada kanal resmi yang mengizinkan auto-reply'] },
      });
    }
    await Promise.all([
      this.settings.set(SETTING_KEYS.model, input.model, actor.id),
      this.settings.set(SETTING_KEYS.mode, input.mode, actor.id),
      this.settings.set(SETTING_KEYS.budget, input.monthlyBudgetUsd, actor.id),
      this.settings.set(SETTING_KEYS.pricing, input.pricing, actor.id),
    ]);
    await this.audit.log({
      action: 'ai.settings_updated',
      actor,
      entityType: 'system_setting',
      metadata: {
        model: input.model,
        mode: input.mode,
        monthlyBudgetUsd: input.monthlyBudgetUsd,
        pricedModels: Object.keys(input.pricing),
      },
      meta,
    });
    return this.getSettings();
  }

  private resolveModel(s: AiSettings) {
    return s.model || env().OPENAI_MODEL || this.provider?.defaultModel || null;
  }

  async status(): Promise<AiStatusDto> {
    const [s, published, spent] = await Promise.all([
      this.getSettings(),
      this.knowledge.countPublished(),
      this.spentThisMonth(),
    ]);
    const model = this.provider ? this.resolveModel(s) : null;
    return {
      configured: !!this.provider,
      provider: this.provider?.name ?? null,
      simulated: this.provider?.simulated ?? false,
      model,
      mode: s.mode,
      notReadyReason: this.provider
        ? null
        : 'AI belum dikonfigurasi. Isi OPENAI_API_KEY di file .env server lalu restart API.',
      publishedDocuments: published,
      monthlyBudgetUsd: s.monthlyBudgetUsd,
      spentThisMonthUsd: spent,
      priceConfigured: !!(model && s.pricing[model]),
    };
  }

  private async spentThisMonth() {
    const r = await this.prisma.aiInteraction.aggregate({
      where: { createdAt: { gte: startOfMonth() }, isSimulation: false },
      _sum: { costUsd: true },
    });
    return Number(r._sum.costUsd ?? 0);
  }

  // ------------------------------------------------------------ pipeline

  private async run<T>(o: RunOptions<T>): Promise<{ out: T; meta: Omit<AiResultMeta, 'sources'> }> {
    if (!this.provider)
      throw new ServiceUnavailableException('AI belum dikonfigurasi. Hubungi administrator.');
    const settings = await this.getSettings();
    const model = this.resolveModel(settings);
    if (!model) throw new ServiceUnavailableException('Model AI belum ditentukan (OPENAI_MODEL).');

    if (settings.monthlyBudgetUsd !== null && !this.provider.simulated) {
      const spent = await this.spentThisMonth();
      if (spent >= settings.monthlyBudgetUsd) {
        throw new ForbiddenException(
          `Batas biaya AI bulan ini (US$${settings.monthlyBudgetUsd}) sudah tercapai. Hubungi Super Admin.`,
        );
      }
    }

    const started = Date.now();
    const base = {
      type: o.type,
      model,
      userId: o.user.id,
      leadId: o.leadId ?? null,
      input: o.logInput as Prisma.InputJsonValue,
      isSimulation: this.provider.simulated,
    };

    let raw: Awaited<ReturnType<LlmProvider['complete']>>;
    let out: T;
    try {
      raw = await this.provider.complete({
        model,
        system: o.system,
        user: o.prompt,
        schemaName: o.schemaName,
        jsonSchema: SCHEMAS[o.schemaName] as unknown as Record<string, unknown>,
        maxTokens: o.maxTokens,
      });
      out = o.output.parse(JSON.parse(raw.content));
    } catch (e) {
      const message =
        e instanceof LlmProviderError
          ? e.message
          : e instanceof SyntaxError || e instanceof z.ZodError
            ? 'Format jawaban AI tidak valid'
            : 'Kesalahan tidak terduga';
      this.logger.warn(`AI ${o.type} gagal: ${e instanceof Error ? e.message : String(e)}`);
      await this.prisma.aiInteraction.create({
        data: { ...base, status: 'FAILED', errorMessage: message, latencyMs: Date.now() - started },
      });
      throw new BadGatewayException(`${AI_INTERACTION_TYPE_LABELS[o.type]} gagal: ${message}`);
    }

    const promptTokens = raw.promptTokens;
    const completionTokens = raw.completionTokens;
    const price = settings.pricing[model];
    const costUsd =
      price && !this.provider.simulated
        ? (promptTokens * price.inputPer1M + completionTokens * price.outputPer1M) / 1_000_000
        : 0;
    const common = {
      ...base,
      model: raw.model || model,
      output: out as unknown as Prisma.InputJsonValue,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      costUsd,
      latencyMs: Date.now() - started,
    };

    const claims = detectProhibitedClaims(o.textOf(out));
    if (claims.length) {
      await this.prisma.aiInteraction.create({
        data: {
          ...common,
          status: 'BLOCKED',
          errorMessage: `Klaim terlarang: ${claims.map((c) => c.label).join(', ')}`,
        },
      });
      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          message:
            'Jawaban AI diblokir karena mengandung klaim yang dilarang. Coba lagi atau tulis manual.',
          details: { claims },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const row = await this.prisma.aiInteraction.create({ data: { ...common, status: 'SUCCESS' } });
    return {
      out,
      meta: {
        interactionId: row.id,
        model: common.model,
        simulated: this.provider.simulated,
        usage: { promptTokens, completionTokens, costUsd: price ? costUsd : null },
      },
    };
  }

  private mapSources(numbers: number[], sources: AiResultMeta['sources']) {
    return [...new Set(numbers)].map((n) => sources[n - 1]).filter(Boolean);
  }

  // ------------------------------------------------------------ konteks prospek (tanpa data kontak)

  private async leadContext(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        sourceCampaign: { select: { name: true } },
        consents: { where: { status: 'GRANTED' }, select: { channel: true } },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { type: true, summary: true, metadata: true, createdAt: true },
        },
      },
    });
    if (!lead || lead.deletedAt) throw new NotFoundException('Prospek tidak ditemukan');
    const firstName = lead.name?.trim().split(/\s+/)[0] ?? null;
    const history = lead.activities
      .reverse()
      .map((a) => {
        const msg = (a.metadata as { message?: string } | null)?.message;
        return `- ${a.createdAt.toISOString().slice(0, 10)} ${a.type}: ${a.summary}${msg ? `\n  Isi pesan: ${msg}` : ''}`;
      })
      .join('\n');
    // Email, telepon, dan username sengaja TIDAK dikirim ke penyedia AI (minimisasi data).
    const text = [
      `Nama panggilan: ${firstName ?? '(tidak diketahui)'}`,
      `Status: ${LEAD_STATUS_LABELS[lead.status]}`,
      `Ketertarikan: ${INTEREST_LEVEL_LABELS[lead.interestLevel]}`,
      `Sumber: ${LEAD_SOURCE_LABELS[lead.source]}`,
      `Campaign: ${lead.sourceCampaign?.name ?? '-'}`,
      `Tag: ${lead.tags.join(', ') || '-'}`,
      `Izin komunikasi: ${lead.consents.map((c) => CONTACT_CHANNEL_LABELS[c.channel]).join(', ') || 'belum ada'}`,
      `Riwayat (lama → baru):\n${history || '(belum ada)'}`,
    ].join('\n');
    return { lead, firstName, text };
  }

  // ------------------------------------------------------------ fitur

  async ask(user: RequestUser, question: string, leadId?: string | null): Promise<AiAnswerDto> {
    const kb = await this.knowledge.buildContext(question);
    if (!kb.sources.length) {
      return {
        answer:
          'Knowledge Base belum berisi dokumen yang dipublikasikan, jadi AI belum boleh menjawab pertanyaan tentang produk.',
        handoff: true,
        handoffReason: 'Knowledge Base kosong',
        interactionId: null,
        model: this.provider ? (this.resolveModel(await this.getSettings()) ?? '-') : '-',
        simulated: this.provider?.simulated ?? false,
        usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 },
        sources: [],
      };
    }
    const ctx = leadId ? await this.leadContext(leadId) : null;
    const { out, meta } = await this.run({
      type: 'KNOWLEDGE_QA',
      user,
      leadId,
      schemaName: 'knowledge_answer',
      output: answerOut,
      system: `${BASE_RULES}\n\n${HANDOFF_GUIDE}\n\n${knowledgeSection(kb.text)}`,
      prompt: [
        'Jawab pertanyaan calon pengguna berikut berdasarkan Knowledge Base. Jawaban maksimal 5 kalimat.',
        ctx ? data('Profil prospek', ctx.text) : '',
        data('Pertanyaan', question),
      ].join('\n\n'),
      maxTokens: 700,
      textOf: (o) => o.answer,
      logInput: { question, leadId: leadId ?? null, sources: kb.sources.map((s) => s.id) },
    });
    return {
      ...meta,
      answer: out.answer,
      handoff: out.handoff,
      handoffReason: out.handoffReason || null,
      sources: this.mapSources(out.usedSourceNumbers, kb.sources),
    };
  }

  async suggestReply(
    user: RequestUser,
    input: { incomingMessage: string; leadId?: string | null; taskId?: string | null },
  ): Promise<AiReplySuggestionDto> {
    let leadId = input.leadId ?? null;
    if (input.taskId) {
      const task = await this.prisma.outreachTask.findUnique({
        where: { id: input.taskId },
        select: { leadId: true },
      });
      if (!task) throw new NotFoundException('Tugas tidak ditemukan');
      leadId = task.leadId;
    }
    const ctx = leadId ? await this.leadContext(leadId) : null;
    if (ctx?.lead.doNotContact)
      throw new ConflictException('Prospek ada di daftar larangan kontak.');
    const kb = await this.knowledge.buildContext(input.incomingMessage);
    const { out, meta } = await this.run({
      type: 'REPLY_SUGGESTION',
      user,
      leadId,
      schemaName: 'reply_suggestion',
      output: replyOut,
      system: `${BASE_RULES}\n\n${HANDOFF_GUIDE}\n\n${knowledgeSection(kb.text)}`,
      prompt: [
        'Buat saran balasan untuk pesan calon pengguna berikut. Balasan akan ditinjau operator sebelum dikirim. Maksimal 4 kalimat.',
        ctx ? data('Profil & riwayat prospek', ctx.text) : '',
        data('Pesan masuk dari prospek', input.incomingMessage),
      ].join('\n\n'),
      maxTokens: 600,
      textOf: (o) => o.reply,
      logInput: { incomingMessage: input.incomingMessage, leadId, taskId: input.taskId ?? null },
    });
    return {
      ...meta,
      reply: out.reply,
      detectedIntent: out.detectedIntent,
      handoff: out.handoff,
      handoffReason: out.handoffReason || null,
      sources: this.mapSources(out.usedSourceNumbers, kb.sources),
    };
  }

  async draftOutreach(
    user: RequestUser,
    taskId: string,
    instructions: string | null,
  ): Promise<AiDraftDto> {
    const task = await this.prisma.outreachTask.findUnique({
      where: { id: taskId },
      include: {
        tiktokAccount: { select: { username: true } },
        campaign: { select: { name: true, description: true } },
      },
    });
    if (!task) throw new NotFoundException('Tugas tidak ditemukan');
    if (task.status !== 'DRAFT' && task.status !== 'FOLLOW_UP') {
      throw new ConflictException('Draft AI hanya untuk tugas berstatus Draft atau Follow-up');
    }
    const ctx = await this.leadContext(task.leadId);
    if (ctx.lead.doNotContact)
      throw new ConflictException('Prospek ada di daftar larangan kontak.');
    const purpose =
      task.status === 'FOLLOW_UP' ? 'pesan follow-up lanjutan' : 'pesan perkenalan pertama';
    const kb = await this.knowledge.buildContext(
      `${task.campaign?.name ?? ''} ${task.campaign?.description ?? ''} registrasi fitur`,
    );
    const { out, meta } = await this.run({
      type: 'MESSAGE_GENERATION',
      user,
      leadId: task.leadId,
      schemaName: 'outreach_draft',
      output: draftOut,
      system: `${BASE_RULES}\n\n${knowledgeSection(kb.text)}`,
      prompt: [
        `Tulis ${purpose} via ${CONTACT_CHANNEL_LABELS[task.channel]} dari akun TikTok @${task.tiktokAccount.username} untuk prospek ini.`,
        'Pesan harus personal (sesuaikan dengan riwayat), maksimal 600 karakter, tanpa klaim yang tidak ada di Knowledge Base,',
        'dan beri kesempatan prospek menolak dengan mudah. Jangan sertakan link kecuali disebut di arahan operator.',
        task.campaign
          ? data('Campaign', `${task.campaign.name}\n${task.campaign.description ?? ''}`)
          : '',
        data('Profil & riwayat prospek', ctx.text),
        instructions ? data('Arahan tambahan operator', instructions) : '',
      ].join('\n'),
      maxTokens: 500,
      textOf: (o) => o.message,
      logInput: { taskId, purpose, instructions },
    });
    return { ...meta, message: out.message, rationale: out.rationale, sources: kb.sources };
  }

  async scoreLead(user: RequestUser, leadId: string, meta: RequestMeta): Promise<AiLeadScoreDto> {
    const ctx = await this.leadContext(leadId);
    const { out, meta: m } = await this.run({
      type: 'LEAD_SCORING',
      user,
      leadId,
      schemaName: 'lead_score',
      output: scoreOut,
      system: `${BASE_RULES}\n\nKamu menilai kemungkinan calon pengguna mendaftar Solid Mini hanya dari riwayat interaksi. Jangan berasumsi di luar data.`,
      prompt: [
        'Beri skor 0-100, tingkat ketertarikan, maksimal 4 alasan singkat, dan satu rekomendasi tindakan untuk operator.',
        'Prospek yang meminta tidak dihubungi atau tidak tertarik harus mendapat skor rendah dan rekomendasi untuk berhenti menghubungi.',
        data('Profil & riwayat prospek', ctx.text),
      ].join('\n'),
      maxTokens: 400,
      textOf: (o) => `${o.reasons.join(' ')} ${o.recommendedAction}`,
      logInput: { leadId },
    });
    // Skor AI disimpan; tingkat ketertarikan hanya saran (diputuskan operator).
    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: leadId }, data: { score: out.score } });
      await this.activities.log(
        leadId,
        'AI_ANALYSIS',
        `Skor AI: ${out.score}/100 (${INTEREST_LEVEL_LABELS[out.interestLevel]}) — ${out.recommendedAction}`,
        user.id,
        {
          kind: 'score',
          interactionId: m.interactionId,
          simulated: m.simulated,
          reasons: out.reasons,
        },
        tx,
      );
    });
    await this.audit.log({
      action: 'ai.lead_scored',
      actor: user,
      entityType: 'lead',
      entityId: leadId,
      metadata: { score: out.score, simulated: m.simulated },
      meta,
    });
    return { ...m, ...out, sources: [] };
  }

  async summarizeLead(user: RequestUser, leadId: string): Promise<AiSummaryDto> {
    const ctx = await this.leadContext(leadId);
    const { out, meta } = await this.run({
      type: 'CONVERSATION_SUMMARY',
      user,
      leadId,
      schemaName: 'lead_summary',
      output: summaryOut,
      system: `${BASE_RULES}\n\nKamu merangkum riwayat interaksi untuk operator internal.`,
      prompt: [
        'Ringkas riwayat berikut untuk operator: ringkasan 2-4 kalimat, maksimal 5 poin penting, dan langkah berikutnya.',
        data('Profil & riwayat prospek', ctx.text),
      ].join('\n'),
      maxTokens: 500,
      textOf: (o) => `${o.summary} ${o.keyPoints.join(' ')} ${o.nextStep}`,
      logInput: { leadId },
    });
    await this.activities.log(leadId, 'AI_ANALYSIS', `Ringkasan AI: ${out.summary}`, user.id, {
      kind: 'summary',
      interactionId: meta.interactionId,
      simulated: meta.simulated,
      keyPoints: out.keyPoints,
      nextStep: out.nextStep,
    });
    return { ...meta, ...out, sources: [] };
  }
}
