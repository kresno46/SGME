import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  aiAskSchema,
  aiDraftSchema,
  aiReplySuggestionSchema,
  aiSettingsSchema,
  aiUsageQuerySchema,
  knowledgeDocumentSchema,
  listAiInteractionsQuerySchema,
  listKnowledgeQuerySchema,
  PERMISSIONS,
  updateKnowledgeDocumentSchema,
  type AiAskInput,
  type AiReplySuggestionInput,
  type AiSettings,
  type ListKnowledgeQuery,
} from '@smge/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentUser, RequestUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request';
import { env } from '../config/env';
import { LeadsModule } from '../leads/leads.module';
import { AiUsageService } from './ai-usage.service';
import { AiService } from './ai.service';
import { KnowledgeService } from './knowledge.service';
import { LLM_PROVIDER, LlmProvider } from './providers/llm-provider';
import { OpenAiProvider } from './providers/openai.provider';
import { SimulatedProvider } from './providers/simulated.provider';

/** Batas pemanggilan AI per menit (melindungi biaya & kuota). */
const aiThrottle = () => ({
  default: { limit: () => env().THROTTLE_AI_LIMIT_PER_MINUTE, ttl: 60_000 },
});

/**
 * Pemilihan provider:
 * - AI_PROVIDER=simulated → simulasi berlabel (harus eksplisit)
 * - OPENAI_API_KEY terisi → OpenAI
 * - selain itu → null (AI nonaktif, UI menampilkan "belum dikonfigurasi")
 */
export function createLlmProvider(): LlmProvider | null {
  const e = env();
  const logger = new Logger('AiProvider');
  if (e.AI_PROVIDER === 'simulated') {
    logger.warn('AI berjalan dalam mode SIMULASI — keluaran bukan dari model sungguhan.');
    return new SimulatedProvider();
  }
  if (e.OPENAI_API_KEY) {
    return new OpenAiProvider(e.OPENAI_API_KEY, e.OPENAI_MODEL ?? '', {
      baseURL: e.OPENAI_BASE_URL,
      timeoutMs: e.AI_TIMEOUT_MS,
    });
  }
  if (e.AI_PROVIDER === 'openai')
    logger.warn('AI_PROVIDER=openai tetapi OPENAI_API_KEY kosong — AI nonaktif.');
  return null;
}

@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly usage: AiUsageService,
  ) {}

  @Get('status')
  @RequirePermissions(PERMISSIONS.AI_USE)
  status() {
    return this.ai.status();
  }

  @Post('ask')
  @HttpCode(200)
  @Throttle(aiThrottle())
  @RequirePermissions(PERMISSIONS.AI_USE)
  ask(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(aiAskSchema)) body: AiAskInput,
  ) {
    return this.ai.ask(user, body.question, body.leadId);
  }

  @Post('reply-suggestion')
  @HttpCode(200)
  @Throttle(aiThrottle())
  @RequirePermissions(PERMISSIONS.AI_USE)
  replySuggestion(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(aiReplySuggestionSchema)) body: AiReplySuggestionInput,
  ) {
    return this.ai.suggestReply(user, body);
  }

  @Post('outreach-draft')
  @HttpCode(200)
  @Throttle(aiThrottle())
  @RequirePermissions(PERMISSIONS.AI_USE, PERMISSIONS.OUTREACH_WORK)
  draft(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(aiDraftSchema)) body: z.output<typeof aiDraftSchema>,
  ) {
    return this.ai.draftOutreach(user, body.taskId, body.instructions);
  }

  @Post('leads/:id/score')
  @HttpCode(200)
  @Throttle(aiThrottle())
  @RequirePermissions(PERMISSIONS.AI_USE, PERMISSIONS.LEADS_MANAGE)
  score(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.ai.scoreLead(user, id, requestMeta(req));
  }

  @Post('leads/:id/summary')
  @HttpCode(200)
  @Throttle(aiThrottle())
  @RequirePermissions(PERMISSIONS.AI_USE, PERMISSIONS.LEADS_READ)
  summary(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.summarizeLead(user, id);
  }

  @Get('usage')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  usageSummary(
    @Query(new ZodValidationPipe(aiUsageQuerySchema)) q: z.output<typeof aiUsageQuerySchema>,
  ) {
    return this.usage.usage(q.days);
  }

  @Get('interactions')
  @RequirePermissions(PERMISSIONS.ANALYTICS_READ)
  interactions(
    @Query(new ZodValidationPipe(listAiInteractionsQuerySchema))
    q: z.output<typeof listAiInteractionsQuerySchema>,
  ) {
    return this.usage.list(q);
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  settings() {
    return this.ai.getSettings();
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  updateSettings(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(aiSettingsSchema)) body: AiSettings,
    @Req() req: Request,
  ) {
    return this.ai.updateSettings(user, body, requestMeta(req));
  }
}

@Controller('knowledge-documents')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AI_USE)
  list(@Query(new ZodValidationPipe(listKnowledgeQuerySchema)) q: ListKnowledgeQuery) {
    return this.knowledge.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.AI_USE)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(knowledgeDocumentSchema))
    body: z.output<typeof knowledgeDocumentSchema>,
    @Req() req: Request,
  ) {
    return this.knowledge.create(user, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateKnowledgeDocumentSchema))
    body: z.output<typeof updateKnowledgeDocumentSchema>,
    @Req() req: Request,
  ) {
    return this.knowledge.update(user, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.knowledge.remove(user, id, requestMeta(req));
    return { ok: true };
  }
}

@Module({
  imports: [LeadsModule],
  controllers: [AiController, KnowledgeController],
  providers: [
    AiService,
    AiUsageService,
    KnowledgeService,
    { provide: LLM_PROVIDER, useFactory: createLlmProvider },
  ],
  exports: [AiService],
})
export class AiModule {}
