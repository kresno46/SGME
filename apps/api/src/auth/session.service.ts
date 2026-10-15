import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CryptoService } from '../common/crypto/crypto.service';
import type { AccessTokenPayload } from '../common/guards/jwt-auth.guard';
import { RequestMeta } from '../common/utils/request';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface IssuedTokens {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  refreshExpiresAt: Date;
}

export type RotateResult =
  | { ok: true; userId: string; tokens: IssuedTokens }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'RACE' }
  | { ok: false; reason: 'REUSE_DETECTED'; userId: string };

/** Token sebelumnya dianggap race condition (multi-tab) bila dipakai ulang dalam jendela ini. */
const ROTATION_GRACE_MS = 30_000;

/**
 * Sesi login: refresh token acak (disimpan sebagai hash SHA-256) dengan rotasi setiap pemakaian
 * dan deteksi pemakaian ulang token lama (indikasi pencurian token → semua sesi dicabut).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
  ) {}

  async create(userId: string, meta: RequestMeta): Promise<IssuedTokens> {
    const refreshToken = this.crypto.randomToken();
    const refreshExpiresAt = new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const session = await this.prisma.userSession.create({
      data: {
        userId,
        refreshTokenHash: this.crypto.sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
    return {
      sessionId: session.id,
      accessToken: await this.signAccess(userId, session.id),
      refreshToken,
      csrfToken: this.crypto.randomToken(24),
      refreshExpiresAt,
    };
  }

  async rotate(refreshToken: string, meta: RequestMeta): Promise<RotateResult> {
    const hash = this.crypto.sha256(refreshToken);
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: { select: { status: true } } },
    });

    if (!session) {
      const reused = await this.prisma.userSession.findUnique({
        where: { previousTokenHash: hash },
      });
      if (!reused) return { ok: false, reason: 'NOT_FOUND' };
      if (!reused.revokedAt && Date.now() - reused.lastUsedAt.getTime() < ROTATION_GRACE_MS) {
        return { ok: false, reason: 'RACE' };
      }
      await this.revokeAllForUser(reused.userId, 'REFRESH_TOKEN_REUSE');
      return { ok: false, reason: 'REUSE_DETECTED', userId: reused.userId };
    }

    if (session.revokedAt || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') {
      return { ok: false, reason: 'EXPIRED' };
    }

    const nextRefresh = this.crypto.randomToken();
    // Optimistic concurrency: hanya berhasil jika hash belum dirotasi oleh request lain.
    const updated = await this.prisma.userSession.updateMany({
      where: { id: session.id, refreshTokenHash: hash, revokedAt: null },
      data: {
        previousTokenHash: hash,
        refreshTokenHash: this.crypto.sha256(nextRefresh),
        lastUsedAt: new Date(),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
    if (updated.count !== 1) return { ok: false, reason: 'RACE' };

    return {
      ok: true,
      userId: session.userId,
      tokens: {
        sessionId: session.id,
        accessToken: await this.signAccess(session.userId, session.id),
        refreshToken: nextRefresh,
        csrfToken: this.crypto.randomToken(24),
        refreshExpiresAt: session.expiresAt,
      },
    };
  }

  async revoke(sessionId: string, reason: string, userId?: string) {
    const r = await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null, ...(userId ? { userId } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return r.count > 0;
  }

  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string) {
    await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  listActive(userId: string) {
    return this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  private signAccess(userId: string, sessionId: string) {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, typ: 'access' };
    return this.jwt.signAsync(payload, { expiresIn: env().JWT_ACCESS_TTL_SECONDS });
  }
}
