import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@smge/database';
import { phoneFromJid, shortWhatsappMessageId } from '@smge/shared';
import { z } from 'zod';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { WAHA_GATEWAY, type WahaGateway } from './waha-gateway';
import { deriveWebhookSecret, isSessionKey, verifyWahaSignature } from './waha-signature';
import { WhatsappSessionService } from './whatsapp-session.service';

const INVALID = 'Kredensial WAHA tidak valid.';
const DIRECT_CHAT = /@(c\.us|lid)$/;
const MAX_BODY = 5000;
/** Di atas ini dianggap milidetik (1e11 detik = tahun 5138). */
const MS_THRESHOLD = 100_000_000_000;

const envelope = z.object({
  event: z.string().min(1).max(100),
  session: z.string().min(1).max(255),
  payload: z.unknown().optional(),
});

const messagePayload = z.object({
  id: z.string().min(1).max(255),
  timestamp: z.coerce.number().finite(),
  from: z.string().min(1).max(255),
  fromMe: z.boolean().default(false),
  to: z.string().max(255).nullish(),
  body: z.string().nullish(),
  hasMedia: z.boolean().default(false),
  // Payload nyata bisa membawa tipe tak terduga di sini: lampiran dilewati, pesannya tetap masuk.
  media: z
    .object({ mimetype: z.string().max(255).nullish() })
    .nullish()
    .catch(null),
  ack: z.number().nullish().catch(null),
  _data: z
    .object({
      pushName: z.string().nullish(),
      notifyName: z.string().nullish(),
      key: z.object({ remoteJidAlt: z.string().nullish() }).nullish(),
    })
    .nullish()
    .catch(null),
});

const ackPayload = z.object({ id: z.string().min(1).max(255), ack: z.number() });
const statusPayload = z.object({ status: z.string().min(1).max(50) });

export type IngestResult = {
  ok: true;
  status: 'created' | 'duplicate' | 'updated' | 'ignored';
  reason?: string;
};

const RANK = { RECEIVED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4 } as const;
type Status = 'RECEIVED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

/** 0 menunggu, 1 diterima server, 2 sampai di perangkat, 3/4 dibaca, -1 gagal. */
export function statusFromAck(ack: number | null | undefined): Status | null {
  if (ack === undefined || ack === null) return null;
  if (ack < 0) return 'FAILED';
  if (ack >= 3) return 'READ';
  if (ack === 2) return 'DELIVERED';
  if (ack === 1) return 'SENT';
  return 'SENDING';
}

export const previewOf = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, 120);

export interface ParsedWahaMessage {
  jid: string;
  /** JID alternatif (nomor telepon) untuk chat @lid */
  altJid: string | null;
  externalId: string;
  fromMe: boolean;
  body: string;
  sentAt: Date;
  status: Status;
  pushName: string | null;
}

export type ParseResult =
  | { ok: true; msg: ParsedWahaMessage }
  | { ok: false; reason: 'invalid' | 'chat_not_supported' | 'no_text' };

/**
 * Satu aturan normalisasi pesan WAHA untuk webhook dan impor riwayat (`chatJid` = chat yang sedang diimpor): hanya chat 1:1, teks atau penanda lampiran,
 * ID pesan direduksi agar gema dan duplikat dikenali.
 */
export function parseWahaMessage(raw: unknown, chatJid?: string): ParseResult {
  const parsed = messagePayload.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const m = parsed.data;
  // Pesan dari store WAHA tidak membawa `to`; untuk riwayat, chat tujuannya sudah diketahui dari daftar chat.
  const jid = chatJid ?? (m.fromMe ? m.to : m.from);
  if (!jid || !DIRECT_CHAT.test(jid)) return { ok: false, reason: 'chat_not_supported' };
  const text = (m.body ?? '').trim();
  const body = text
    ? text.slice(0, MAX_BODY)
    : m.hasMedia
      ? `[Lampiran: ${m.media?.mimetype || 'berkas'}]`
      : '';
  if (!body) return { ok: false, reason: 'no_text' };
  const sentAt = new Date(m.timestamp > MS_THRESHOLD ? m.timestamp : m.timestamp * 1000);
  if (Number.isNaN(sentAt.getTime())) return { ok: false, reason: 'invalid' };
  return {
    ok: true,
    msg: {
      jid,
      altJid: m._data?.key?.remoteJidAlt ?? null,
      externalId: shortWhatsappMessageId(m.id),
      fromMe: m.fromMe,
      body,
      sentAt,
      status: m.fromMe ? (statusFromAck(m.ack) ?? 'SENT') : 'RECEIVED',
      pushName: (m._data?.pushName || m._data?.notifyName || '').trim() || null,
    },
  };
}

/**
 * Event webhook dari WAHA. Fail-closed: tanpa tanda tangan sah atau untuk sesi tak dikenal ditolak dengan
 * pesan yang sama. Pemilik chat selalu dari baris sesi di database, tidak pernah dari body.
 * Isi pesan, nomor, dan nama tidak ditulis ke log.
 */
@Injectable()
export class WhatsappIngestService {
  private readonly logger = new Logger('WhatsappIngest');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: WhatsappSessionService,
    @Inject(WAHA_GATEWAY) private readonly gateway: WahaGateway | null,
  ) {}

  async handle(
    sessionKey: string,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<IngestResult> {
    const e = env();
    if (!this.gateway || !e.WAHA_ENABLED)
      throw new ServiceUnavailableException('Integrasi WAHA belum diaktifkan.');
    if (!isSessionKey(sessionKey)) throw new UnauthorizedException(INVALID);
    const secret = deriveWebhookSecret(e.WAHA_WEBHOOK_MASTER_SECRET ?? '', sessionKey);
    if (!verifyWahaSignature(rawBody, signature, secret)) throw new UnauthorizedException(INVALID);

    let parsed: z.infer<typeof envelope>;
    try {
      parsed = envelope.parse(JSON.parse((rawBody as Buffer).toString('utf8')));
    } catch {
      throw new UnprocessableEntityException('Payload WAHA tidak sesuai kontrak.');
    }

    // Tanda tangan sah tetapi pemilik sudah tidak ada: 200 supaya WAHA berhenti mengulang.
    const row = await this.prisma.wahaSession.findUnique({
      where: { sessionName: sessionKey },
      include: { user: { select: { status: true } } },
    });
    if (!row || row.user.status !== 'ACTIVE') return this.ignored('session_unavailable');
    if (parsed.session !== sessionKey) return this.ignored('session_mismatch');

    try {
      switch (parsed.event) {
        case 'message':
        case 'message.any':
          return await this.message(row, parsed.payload);
        case 'message.ack':
          return await this.ack(row.id, parsed.payload);
        case 'session.status': {
          const p = statusPayload.safeParse(parsed.payload);
          if (!p.success) return this.ignored('payload_invalid');
          await this.sessions.recordStatus(row, p.data.status, false);
          return { ok: true, status: 'updated' };
        }
        default:
          return this.ignored('event_not_supported');
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Gagal memproses event ${parsed.event}: ${(err as Error).name}`);
      throw err;
    }
  }

  private ignored(reason: string): IngestResult {
    return { ok: true, status: 'ignored', reason };
  }

  private async message(
    session: { id: string; userId: string; sessionName: string },
    raw: unknown,
  ): Promise<IngestResult> {
    const r = parseWahaMessage(raw);
    if (!r.ok) {
      if (r.reason === 'invalid')
        throw new UnprocessableEntityException('Payload WAHA tidak sesuai kontrak.');
      return this.ignored(r.reason);
    }
    const { jid, altJid, externalId, fromMe, body, sentAt, status, pushName } = r.msg;
    const chat = await this.ensureChat(session, jid, altJid);
    try {
      await this.prisma.whatsappMessage.create({
        data: {
          chatId: chat.id,
          externalId,
          direction: fromMe ? 'OUTBOUND' : 'INBOUND',
          status,
          body,
          // Pesan yang diketik langsung di ponsel pemilik nomor tidak punya pengirim di SMGE.
          sentAt,
        },
      });
    } catch (err) {
      // Event yang sama (termasuk `message` dan `message.any`) atau gema kiriman SMGE sendiri.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        return { ok: true, status: 'duplicate' };
      throw err;
    }

    await this.prisma.whatsappChat.update({
      where: { id: chat.id },
      data: {
        ...(!chat.lastMessageAt || chat.lastMessageAt < sentAt
          ? { lastMessageAt: sentAt, lastMessagePreview: previewOf(body) }
          : {}),
        ...(fromMe ? {} : { unreadCount: { increment: 1 } }),
        ...(!fromMe && pushName ? { contactName: pushName } : {}),
      },
    });
    return { ok: true, status: 'created' };
  }

  /** Chat untuk sebuah JID pada satu nomor: dipakai ulang bila ada, dibuat bila belum (aman terhadap balapan). */
  async ensureChat(
    session: { id: string; userId: string; sessionName: string },
    jid: string,
    altJid: string | null,
  ) {
    const existing = await this.prisma.whatsappChat.findUnique({
      where: { sessionId_chatId: { sessionId: session.id, chatId: jid } },
    });
    if (existing?.contactPhone) return existing;
    const phone = await this.phoneFor(session, jid, altJid);
    if (existing) {
      return phone
        ? this.prisma.whatsappChat.update({
            where: { id: existing.id },
            data: { contactPhone: phone },
          })
        : existing;
    }
    try {
      return await this.prisma.whatsappChat.create({
        data: { sessionId: session.id, ownerId: session.userId, chatId: jid, contactPhone: phone },
      });
    } catch (err) {
      // Dua event pertama tiba bersamaan: yang kalah memakai baris yang menang.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        return this.prisma.whatsappChat.findUniqueOrThrow({
          where: { sessionId_chatId: { sessionId: session.id, chatId: jid } },
        });
      throw err;
    }
  }

  /** Nomor dari JID `@c.us`; untuk `@lid` dari `remoteJidAlt` (NOWEB) atau pencarian ke WAHA. */
  private async phoneFor(session: { sessionName: string }, jid: string, altJid: string | null) {
    const direct = phoneFromJid(jid) ?? (altJid ? phoneFromJid(altJid) : null);
    if (direct || !jid.endsWith('@lid') || !this.gateway) return direct;
    try {
      return await this.gateway.resolveLid(session.sessionName, jid);
    } catch {
      return null;
    }
  }

  private async ack(sessionId: string, raw: unknown): Promise<IngestResult> {
    const parsed = ackPayload.safeParse(raw);
    if (!parsed.success) return this.ignored('payload_invalid');
    const next = statusFromAck(parsed.data.ack);
    if (!next) return this.ignored('ack_unknown');
    const msg = await this.prisma.whatsappMessage.findFirst({
      where: {
        externalId: shortWhatsappMessageId(parsed.data.id),
        direction: 'OUTBOUND',
        chat: { sessionId },
      },
    });
    if (!msg) return this.ignored('message_unknown');
    const cur = msg.status as Status;
    // Status hanya maju. Gagal boleh menimpa yang belum sampai, tetapi tidak yang sudah dibaca.
    const advance =
      next === 'FAILED'
        ? cur !== 'READ' && cur !== 'DELIVERED' && cur !== 'FAILED'
        : cur !== 'FAILED' && RANK[next] > RANK[cur as keyof typeof RANK];
    if (!advance) return { ok: true, status: 'duplicate' };
    await this.prisma.whatsappMessage.update({
      where: { id: msg.id },
      data: {
        status: next,
        ...(next === 'FAILED' ? { failureReason: 'ack_error' } : { failureReason: null }),
      },
    });
    return { ok: true, status: 'updated' };
  }
}
