import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  PERMISSIONS,
  whatsappBroadcastSchema,
  whatsappChatsQuerySchema,
  whatsappContactsQuerySchema,
  whatsappNumberSchema,
  whatsappSendSchema,
  whatsappStartChatSchema,
  type WhatsappBroadcastInput,
  type WhatsappChatsQuery,
  type WhatsappNumberInput,
  type WhatsappSendInput,
  type WhatsappStartChatInput,
} from '@smge/shared';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  Public,
  RequestUser,
  RequirePermissions,
  SkipCsrf,
} from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request';
import { WAHA_GATEWAY, createWahaGateway } from './waha-gateway';
import { WhatsappBroadcastService } from './whatsapp-broadcast.service';
import { WhatsappChatService } from './whatsapp-chat.service';
import { WhatsappHistoryService } from './whatsapp-history.service';
import { WhatsappIngestService } from './whatsapp-ingest.service';
import { WhatsappMonitorService } from './whatsapp-monitor.service';
import { WhatsappSessionService } from './whatsapp-session.service';

const USE = PERMISSIONS.WHATSAPP_USE;

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly sessions: WhatsappSessionService,
    private readonly chats: WhatsappChatService,
    private readonly history: WhatsappHistoryService,
    private readonly broadcasts: WhatsappBroadcastService,
  ) {}

  @Get('config')
  @RequirePermissions(USE)
  config() {
    return this.sessions.config();
  }

  // ── Nomor milik user yang sedang login ──

  @Get('sessions')
  @RequirePermissions(USE)
  listSessions(@CurrentUser() user: RequestUser) {
    return this.sessions.list(user);
  }

  @Get('sessions/health')
  @RequirePermissions(USE)
  health(@CurrentUser() user: RequestUser) {
    return this.sessions.health(user);
  }

  @Post('sessions')
  @HttpCode(200)
  @RequirePermissions(USE)
  createSession(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(whatsappNumberSchema)) body: WhatsappNumberInput,
    @Req() req: Request,
  ) {
    return this.sessions.create(user, body, requestMeta(req));
  }

  @Patch('sessions/:id')
  @RequirePermissions(USE)
  renameSession(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(whatsappNumberSchema)) body: WhatsappNumberInput,
  ) {
    return this.sessions.rename(user, id, body);
  }

  @Delete('sessions/:id')
  @RequirePermissions(USE)
  removeSession(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.sessions.remove(user, id, requestMeta(req));
  }

  @Post('sessions/:id/start')
  @HttpCode(200)
  @RequirePermissions(USE)
  start(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.sessions.start(user, id, requestMeta(req));
  }

  @Post('sessions/:id/stop')
  @HttpCode(200)
  @RequirePermissions(USE)
  stop(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.sessions.stop(user, id, requestMeta(req));
  }

  @Post('sessions/:id/logout')
  @HttpCode(200)
  @RequirePermissions(USE)
  logout(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.sessions.logout(user, id, requestMeta(req));
  }

  @Post('sessions/:id/reset')
  @HttpCode(200)
  @RequirePermissions(USE)
  reset(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.sessions.reset(user, id, requestMeta(req));
  }

  @Post('sessions/:id/sync-history')
  @HttpCode(200)
  @RequirePermissions(USE)
  syncHistory(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.history.request(user, id);
  }

  @Get('sessions/:id/qr')
  @RequirePermissions(USE)
  async qr(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { image, contentType } = await this.sessions.qr(user, id);
    // QR berlaku sebentar dan setara kunci masuk ke WhatsApp orang ini: jangan di-cache siapa pun.
    res
      .set({
        'Content-Type': contentType,
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      })
      .send(image);
  }

  // ── Kirim terjadwal ke daftar terpilih ──

  @Get('broadcasts')
  @RequirePermissions(USE)
  listBroadcasts(@CurrentUser() user: RequestUser) {
    return this.broadcasts.list(user);
  }

  @Post('broadcasts')
  @HttpCode(200)
  @RequirePermissions(USE)
  createBroadcast(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(whatsappBroadcastSchema)) body: WhatsappBroadcastInput,
    @Req() req: Request,
  ) {
    return this.broadcasts.create(user, body, requestMeta(req));
  }

  @Get('broadcasts/:id')
  @RequirePermissions(USE)
  getBroadcast(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.detail(user, id);
  }

  @Post('broadcasts/:id/pause')
  @HttpCode(200)
  @RequirePermissions(USE)
  pauseBroadcast(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.broadcasts.pause(user, id, requestMeta(req));
  }

  @Post('broadcasts/:id/resume')
  @HttpCode(200)
  @RequirePermissions(USE)
  resumeBroadcast(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.broadcasts.resume(user, id, requestMeta(req));
  }

  @Post('broadcasts/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(USE)
  cancelBroadcast(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.broadcasts.cancel(user, id, requestMeta(req));
  }

  // ── Memulai chat ──

  @Get('sessions/:id/contacts')
  @RequirePermissions(USE)
  contacts(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(whatsappContactsQuerySchema))
    q: { search?: string; savedOnly: boolean },
  ) {
    return this.chats.contacts(user, id, q.search, q.savedOnly);
  }

  @Post('sessions/:id/chats')
  @HttpCode(200)
  @RequirePermissions(USE)
  startChat(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(whatsappStartChatSchema)) body: WhatsappStartChatInput,
    @Req() req: Request,
  ) {
    return this.chats.start(user, id, body, requestMeta(req));
  }

  // ── Chat ──

  @Get('chats')
  @RequirePermissions(USE)
  listChats(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(whatsappChatsQuerySchema)) q: WhatsappChatsQuery,
  ) {
    return this.chats.list(user, q);
  }

  @Get('chats/:id')
  @RequirePermissions(USE)
  thread(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.thread(user, id);
  }

  @Post('chats/:id/read')
  @HttpCode(200)
  @RequirePermissions(USE)
  read(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chats.markRead(user, id);
  }

  @Post('chats/:id/send')
  @HttpCode(200)
  @RequirePermissions(USE)
  send(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(whatsappSendSchema)) body: WhatsappSendInput,
    @Req() req: Request,
  ) {
    return this.chats.send(user, id, body, requestMeta(req));
  }

  // ── Super Admin ──

  @Get('admin/sessions')
  @RequirePermissions(USE)
  adminList(@CurrentUser() user: RequestUser) {
    return this.sessions.adminList(user);
  }

  @Post('admin/sessions/:sessionId/stop')
  @HttpCode(200)
  @RequirePermissions(USE)
  async adminStop(
    @CurrentUser() user: RequestUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Req() req: Request,
  ) {
    await this.sessions.adminStop(user, sessionId, requestMeta(req));
    return { ok: true };
  }

  @Post('admin/sessions/:sessionId/logout')
  @HttpCode(200)
  @RequirePermissions(USE)
  async adminLogout(
    @CurrentUser() user: RequestUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Req() req: Request,
  ) {
    await this.sessions.adminLogout(user, sessionId, requestMeta(req));
    return { ok: true };
  }
}

/** Webhook dari WAHA: publik, tanpa CSRF, diverifikasi dengan HMAC-SHA512 per sesi. */
@Controller('webhooks/waha')
export class WahaWebhookController {
  constructor(private readonly ingest: WhatsappIngestService) {}

  @Public()
  @SkipCsrf()
  @SkipThrottle()
  @Post(':sessionKey')
  @HttpCode(200)
  receive(
    @Param('sessionKey') sessionKey: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-webhook-hmac') signature?: string,
  ) {
    return this.ingest.handle(sessionKey, req.rawBody, signature);
  }
}

@Module({
  controllers: [WhatsappController, WahaWebhookController],
  providers: [
    { provide: WAHA_GATEWAY, useFactory: createWahaGateway },
    WhatsappSessionService,
    WhatsappChatService,
    WhatsappIngestService,
    WhatsappHistoryService,
    WhatsappBroadcastService,
    WhatsappMonitorService,
  ],
  exports: [WhatsappMonitorService],
})
export class WhatsappModule {}
