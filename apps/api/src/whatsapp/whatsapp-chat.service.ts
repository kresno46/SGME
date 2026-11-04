import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@smge/database';
import {
  PERMISSIONS,
  isOptOutMessage,
  normalizePhone,
  shortWhatsappMessageId,
  type WhatsappChatsQuery,
  type WhatsappSendInput,
  type WhatsappStartChatInput,
} from '@smge/shared';
import type {
  WhatsappChatDto,
  WhatsappChatListDto,
  WhatsappContactsDto,
  WhatsappMessageDto,
  WhatsappSendResultDto,
  WhatsappThreadDto,
} from '@smge/types';
import { AuditService } from '../audit/audit.service';
import { ownerScope } from '../common/data-scope';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { USER_REF_SELECT, iso, startOfToday, toRef } from '../common/utils/refs';
import { RequestMeta, paginate } from '../common/utils/request';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SendLimiter } from './send-limiter';
import { WAHA_GATEWAY, WahaError, type WahaGateway } from './waha-gateway';
import { previewOf } from './whatsapp-ingest.service';

const THREAD_LIMIT = 200;
const RANK = { RECEIVED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: -1 } as const;

const CHAT_INCLUDE = {
  owner: { select: USER_REF_SELECT },
  session: { select: { id: true, label: true } },
} satisfies Prisma.WhatsappChatInclude;

type ChatRow = Prisma.WhatsappChatGetPayload<{ include: typeof CHAT_INCLUDE }>;

const toMessage = (m: Prisma.WhatsappMessageGetPayload<object>): WhatsappMessageDto => ({
  id: m.id,
  direction: m.direction,
  status: m.status,
  body: m.body,
  failureReason: m.failureReason,
  sentAt: m.sentAt.toISOString(),
});

@Injectable()
export class WhatsappChatService {
  private readonly limiter: SendLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(WAHA_GATEWAY) private readonly gateway: WahaGateway | null,
  ) {
    const e = env();
    this.limiter = new SendLimiter({
      minIntervalMs: e.WAHA_SEND_MIN_INTERVAL_MS,
      jitterMs: e.WAHA_SEND_JITTER_MS,
      perChatPerMinute: e.WAHA_SEND_MAX_PER_CHAT_PER_MINUTE,
      perSessionPerMinute: e.WAHA_SEND_MAX_PER_SESSION_PER_MINUTE,
    });
  }

  private toChat(c: ChatRow, user: RequestUser): WhatsappChatDto {
    return {
      id: c.id,
      contactName: c.contactName,
      contactPhone: c.contactPhone,
      unreadCount: c.unreadCount,
      lastMessageAt: iso(c.lastMessageAt),
      lastMessagePreview: c.lastMessagePreview,
      session: { id: c.session.id, label: c.session.label },
      owner: toRef(c.owner),
      mine: c.ownerId === user.id,
    };
  }

  /** Chat yang boleh dilihat user: miliknya sendiri; Super Admin melihat semuanya. */
  private async find(id: string) {
    const chat = await this.prisma.whatsappChat.findFirst({
      where: { id, ...ownerScope() },
      include: {
        owner: { select: USER_REF_SELECT },
        session: { select: { id: true, label: true, userId: true, sessionName: true } },
      },
    });
    if (!chat) throw new NotFoundException('Chat tidak ditemukan');
    return chat;
  }

  async list(user: RequestUser, q: WhatsappChatsQuery): Promise<WhatsappChatListDto> {
    const digits = q.search?.replace(/\D/g, '');
    const where: Prisma.WhatsappChatWhereInput = {
      ...ownerScope(),
      ...(q.sessionId ? { sessionId: q.sessionId } : {}),
      ...(q.unreadOnly ? { unreadCount: { gt: 0 } } : {}),
      ...(q.search
        ? {
            OR: [
              { contactName: { contains: q.search, mode: 'insensitive' } },
              { lastMessagePreview: { contains: q.search, mode: 'insensitive' } },
              ...(digits && digits.length >= 3 ? [{ contactPhone: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
    const [rows, total, unread] = await this.prisma.$transaction([
      this.prisma.whatsappChat.findMany({
        where,
        include: CHAT_INCLUDE,
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.whatsappChat.count({ where }),
      this.prisma.whatsappChat.aggregate({ where: ownerScope(), _sum: { unreadCount: true } }),
    ]);
    return {
      ...paginate(
        rows.map((c) => this.toChat(c, user)),
        total,
        q.page,
        q.pageSize,
      ),
      unreadTotal: unread._sum.unreadCount ?? 0,
    };
  }

  /** Alasan balasan tidak boleh dikirim saat ini, atau null bila boleh. */
  private async blockedReason(
    chat: { id: string; contactPhone: string | null; session: { userId: string } },
    user: RequestUser,
  ): Promise<string | null> {
    if (!user.permissions.includes(PERMISSIONS.WHATSAPP_USE))
      return 'Role Anda tidak boleh mengirim WhatsApp.';
    if (chat.session.userId !== user.id)
      return 'Hanya pemilik nomor WhatsApp ini yang dapat membalas.';
    const lastInbound = await this.prisma.whatsappMessage.findFirst({
      where: { chatId: chat.id, direction: 'INBOUND' },
      orderBy: { sentAt: 'desc' },
      select: { body: true },
    });
    if (lastInbound && isOptOutMessage(lastInbound.body))
      return 'Pelanggan meminta berhenti. Balasan dibuka lagi setelah pelanggan menulis hal lain.';
    const phone = normalizePhone(chat.contactPhone);
    if (phone) {
      const dnc = await this.prisma.doNotContactEntry.findFirst({
        where: { channel: 'PHONE', valueNormalized: phone },
        select: { id: true },
      });
      if (dnc) return 'Nomor ini ada di daftar larangan kontak.';
    }
    return null;
  }

  async thread(user: RequestUser, id: string): Promise<WhatsappThreadDto> {
    const chat = await this.find(id);
    const rows = await this.prisma.whatsappMessage.findMany({
      where: { chatId: id },
      orderBy: { sentAt: 'desc' },
      take: THREAD_LIMIT,
    });
    const reason = await this.blockedReason(chat, user);
    return {
      chat: this.toChat(chat, user),
      messages: rows.reverse().map(toMessage),
      canReply: reason === null,
      replyBlockedReason: reason,
    };
  }

  async markRead(user: RequestUser, id: string) {
    const chat = await this.find(id);
    if (chat.unreadCount > 0)
      await this.prisma.whatsappChat.update({ where: { id }, data: { unreadCount: 0 } });
    return { ok: true };
  }

  /** Nomor milik user sendiri yang sedang tersambung; selain itu tidak boleh memulai chat. */
  private async ownWorkingSession(user: RequestUser, sessionId: string) {
    const gw = this.gateway;
    if (!gw) throw new ServiceUnavailableException('WhatsApp belum diaktifkan di server ini.');
    const session = await this.prisma.wahaSession.findFirst({
      where: { id: sessionId, userId: user.id },
    });
    if (!session) throw new NotFoundException('Nomor WhatsApp tidak ditemukan.');
    const live = await gw.getSession(session.sessionName).catch((e: unknown) => {
      throw new BadGatewayException(
        `WAHA bermasalah (${e instanceof WahaError ? e.code : 'error'}).`,
      );
    });
    if (live?.status !== 'WORKING')
      throw new ConflictException(
        'Nomor WhatsApp belum tersambung. Buka tab "Nomor saya" untuk menautkan atau memulai ulang sesi.',
      );
    return { session, gw, meDigits: live.meId?.split('@')[0] ?? null };
  }

  /**
   * Kontak ponsel yang tersinkron ke WAHA, difilter di server (maks. 50). Bila sinkronisasi kontak mati pada
   * nomor ini (sesi dibuat tanpa store), `available=false` dan pengguna memasukkan nomor manual.
   */
  async contacts(
    user: RequestUser,
    sessionId: string,
    search?: string,
    savedOnly = false,
  ): Promise<WhatsappContactsDto> {
    const { session, gw } = await this.ownWorkingSession(user, sessionId);
    let all;
    try {
      all = await gw.listContacts(session.sessionName);
    } catch (e) {
      if (e instanceof WahaError && (e.code === 'http_400' || e.code === 'http_501'))
        return { available: false, items: [] };
      throw new BadGatewayException(
        `WAHA bermasalah (${e instanceof WahaError ? e.code : 'error'}).`,
      );
    }
    const q = search?.trim().toLowerCase();
    const digits = search?.replace(/\D/g, '');
    const items = all
      .filter((c) => !savedOnly || c.saved)
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          (!!digits && digits.length >= 3 && c.phone.includes(digits)),
      )
      .slice(0, 50)
      .map(({ phone, name, saved }) => ({ phone, name, saved }));
    return { available: true, items };
  }

  /**
   * Memulai chat dengan satu nomor (dari kontak atau diketik). Hanya membuat ruang chat; pesan pertama tetap
   * ditulis dan dikirim manusia lewat alur kirim biasa, dengan semua pengaman yang sama. Satu per satu: tidak ada
   * kirim massal, dan jumlah chat baru per nomor per hari dibatasi.
   */
  async start(
    user: RequestUser,
    sessionId: string,
    input: WhatsappStartChatInput,
    meta: RequestMeta,
  ): Promise<WhatsappChatDto> {
    const phone = normalizePhone(input.phone);
    if (!phone || phone.length < 8) throw new BadRequestException('Nomor tidak valid.');
    const { session, gw, meDigits } = await this.ownWorkingSession(user, sessionId);
    if (meDigits && meDigits === phone)
      throw new ConflictException('Itu nomor WhatsApp Anda sendiri.');

    const include = { ...CHAT_INCLUDE };
    // Orang yang sama bisa sudah punya chat (dari pesan masuk, juga yang berbentuk @lid): pakai itu.
    const existing = await this.prisma.whatsappChat.findFirst({
      where: {
        sessionId: session.id,
        OR: [{ chatId: `${phone}@c.us` }, { contactPhone: phone }],
      },
      include,
    });
    if (existing) return this.toChat(existing, user);

    const dnc = await this.prisma.doNotContactEntry.findFirst({
      where: { channel: 'PHONE', valueNormalized: phone },
      select: { id: true },
    });
    if (dnc) throw new ConflictException('Nomor ini ada di daftar larangan kontak.');

    const cap = env().WAHA_NEW_CHATS_PER_DAY;
    const today = await this.prisma.whatsappChat.count({
      where: { sessionId: session.id, initiatedAt: { gte: startOfToday() } },
    });
    if (today >= cap)
      throw new HttpException(
        {
          statusCode: 429,
          message: `Batas chat baru hari ini (${cap} per nomor) tercapai. Coba lagi besok, atau balas chat yang sudah ada.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );

    let found;
    try {
      found = await gw.checkNumber(session.sessionName, phone);
    } catch (e) {
      throw new BadGatewayException(
        `WAHA bermasalah (${e instanceof WahaError ? e.code : 'error'}).`,
      );
    }
    if (!found.exists)
      throw new UnprocessableEntityException('Nomor ini tidak terdaftar di WhatsApp.');

    const chatId = found.chatId ?? `${phone}@c.us`;
    let chat: ChatRow;
    try {
      chat = await this.prisma.whatsappChat.create({
        data: {
          sessionId: session.id,
          ownerId: user.id,
          chatId,
          contactName: input.name || null,
          contactPhone: phone,
          initiatedById: user.id,
          initiatedAt: new Date(),
          lastMessageAt: new Date(),
        },
        include,
      });
    } catch (e) {
      // Dua permintaan bersamaan untuk nomor yang sama: yang kalah memakai baris yang menang.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        chat = await this.prisma.whatsappChat.findUniqueOrThrow({
          where: { sessionId_chatId: { sessionId: session.id, chatId } },
          include,
        });
      else throw e;
    }
    // Nomor tidak dicatat di audit; ID chat sudah cukup.
    await this.audit.log({
      action: 'whatsapp.chat.start',
      actor: user,
      entityType: 'whatsapp_chat',
      entityId: chat.id,
      meta,
    });
    return this.toChat(chat, user);
  }

  async send(
    user: RequestUser,
    id: string,
    input: WhatsappSendInput,
    meta: RequestMeta,
  ): Promise<WhatsappSendResultDto> {
    if (!this.gateway)
      throw new ServiceUnavailableException('WhatsApp belum diaktifkan di server ini.');
    const chat = await this.find(id);
    if (chat.session.userId !== user.id)
      throw new ForbiddenException('Hanya pemilik nomor WhatsApp ini yang dapat membalas.');

    // Idempotensi: ID yang sama tidak mengirim dua kali. Yang gagal boleh dicoba lagi di baris yang sama.
    let row = await this.prisma.whatsappMessage.findUnique({
      where: { chatId_clientMessageId: { chatId: id, clientMessageId: input.clientMessageId } },
    });
    if (row) {
      if (row.body !== input.text)
        throw new ConflictException('ID pengiriman ini sudah dipakai untuk pesan lain.');
      if (row.status === 'SENDING') throw new ConflictException('Pesan sedang dikirim.');
      if (row.status !== 'FAILED') return { message: toMessage(row), status: 'duplicate' };
    }

    const blocked = await this.blockedReason(chat, user);
    if (blocked) throw new ConflictException(blocked);
    // WAHA baru menolak kirim dengan 422 setelah menunggu ±10 detik bila sesi belum siap; cek dulu agar jelas dan cepat.
    const live = await this.gateway.getSession(chat.session.sessionName).catch((e: unknown) => {
      throw new BadGatewayException(
        `WAHA bermasalah (${e instanceof WahaError ? e.code : 'error'}).`,
      );
    });
    if (live?.status !== 'WORKING')
      throw new ConflictException(
        'Nomor WhatsApp belum tersambung. Buka tab "Nomor saya" untuk menautkan atau memulai ulang sesi.',
      );
    this.limiter.take(chat.session.sessionName, chat.id);

    // Tulis dulu, kirim kemudian: pesan yang macet terlihat (dan ditandai gagal oleh worker), bukan hilang.
    try {
      row = row
        ? await this.prisma.whatsappMessage.update({
            where: { id: row.id },
            data: { status: 'SENDING', failureReason: null },
          })
        : await this.prisma.whatsappMessage.create({
            data: {
              chatId: id,
              direction: 'OUTBOUND',
              status: 'SENDING',
              body: input.text,
              clientMessageId: input.clientMessageId,
              sentByUserId: user.id,
              sentAt: new Date(),
            },
          });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new ConflictException('Pesan sedang dikirim.');
      throw e;
    }

    let waId: string;
    try {
      waId = shortWhatsappMessageId(
        await this.gateway.sendText(chat.session.sessionName, chat.chatId, input.text),
      );
    } catch (e) {
      const code = e instanceof WahaError ? e.code : 'error';
      await this.prisma.whatsappMessage.update({
        where: { id: row.id },
        data: { status: 'FAILED', failureReason: code },
      });
      // Isi pesan tidak masuk pesan error, log, atau audit.
      throw new BadGatewayException(
        code === 'timeout'
          ? 'WAHA tidak menjawab tepat waktu. Pesan mungkin sudah terkirim; periksa ponsel sebelum mengirim ulang.'
          : `WhatsApp gagal mengirim (${code}).`,
      );
    }

    const sent = await this.adopt(row.id, id, waId);
    await this.prisma.whatsappChat.update({
      where: { id },
      data: {
        lastMessageAt: sent.sentAt,
        lastMessagePreview: previewOf(input.text),
        unreadCount: 0,
      },
    });
    // Centang biru untuk chat yang baru dibalas; kegagalannya tidak memengaruhi pengiriman.
    void this.gateway.sendSeen(chat.session.sessionName, chat.chatId).catch(() => undefined);
    await this.audit.log({
      action: 'whatsapp.send',
      actor: user,
      entityType: 'whatsapp_chat',
      entityId: id,
      metadata: { messageId: sent.id, length: input.text.length },
      meta,
    });
    return { message: toMessage(sent), status: 'sent' };
  }

  /**
   * Menyimpan ID WhatsApp pada baris kiriman. Bila gema webhook sudah lebih dulu membuat baris dengan ID itu,
   * gema dibuang dan statusnya (mis. sudah DELIVERED) dibawa ke baris kita.
   */
  private async adopt(rowId: string, chatId: string, externalId: string) {
    try {
      return await this.prisma.whatsappMessage.update({
        where: { id: rowId },
        data: { status: 'SENT', externalId },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const echo = await this.prisma.whatsappMessage.findUniqueOrThrow({
        where: { chatId_externalId: { chatId, externalId } },
      });
      const status = RANK[echo.status] > RANK.SENT ? echo.status : 'SENT';
      const [, merged] = await this.prisma.$transaction([
        this.prisma.whatsappMessage.delete({ where: { id: echo.id } }),
        this.prisma.whatsappMessage.update({ where: { id: rowId }, data: { status, externalId } }),
      ]);
      return merged;
    }
  }
}
