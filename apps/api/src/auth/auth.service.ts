import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User, Role } from '@smge/database';
import type { RoleCode } from '@smge/shared';
import type { AuthUser, SessionDto } from '@smge/types';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto/crypto.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { RequestMeta } from '../common/utils/request';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import { PasswordService } from './password.service';
import { IssuedTokens, SessionService } from './session.service';
import { TwoFactorService } from './two-factor.service';

const INVALID_CREDENTIALS = 'Email atau password salah';
const CHALLENGE_TTL_SECONDS = 300;
const RESET_TOKEN_TTL_MINUTES = 30;

type UserWithRole = User & { role: Role };

export type LoginResult =
  | { status: 'AUTHENTICATED'; user: AuthUser; tokens: IssuedTokens }
  | { status: 'TWO_FACTOR_REQUIRED'; challengeToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly twoFactor: TwoFactorService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ login

  async login(email: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { role: true } });
    if (!user) {
      await this.passwords.verifyDummy(password);
      await this.audit.log({
        action: 'auth.login_failed',
        metadata: { email, reason: 'UNKNOWN_EMAIL' },
        meta,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    this.assertNotLocked(user);

    if (!(await this.passwords.verify(user.passwordHash, password))) {
      await this.registerFailedAttempt(user, meta, 'WRONG_PASSWORD');
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.status !== 'ACTIVE') {
      await this.audit.log({
        action: 'auth.login_failed',
        actor: user,
        metadata: { reason: 'DISABLED' },
        meta,
      });
      throw new ForbiddenException('Akun Anda dinonaktifkan. Hubungi administrator.');
    }

    if (user.twoFactorEnabled) {
      const challengeToken = await this.jwt.signAsync(
        { sub: user.id, typ: '2fa' },
        { expiresIn: CHALLENGE_TTL_SECONDS },
      );
      return { status: 'TWO_FACTOR_REQUIRED', challengeToken };
    }

    return this.completeLogin(user, meta);
  }

  async verifyTwoFactorLogin(
    challengeToken: string,
    code: string,
    meta: RequestMeta,
  ): Promise<LoginResult> {
    let sub: string;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(challengeToken);
      if (payload.typ !== '2fa') throw new Error();
      sub = payload.sub;
    } catch {
      throw new UnauthorizedException('Sesi verifikasi sudah berakhir. Silakan login ulang.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: sub }, include: { role: true } });
    if (!user || user.status !== 'ACTIVE' || !user.twoFactorEnabled)
      throw new UnauthorizedException();
    this.assertNotLocked(user);

    if (!this.twoFactor.verify(user.twoFactorSecret, code)) {
      await this.registerFailedAttempt(user, meta, 'WRONG_2FA_CODE');
      throw new UnauthorizedException('Kode verifikasi salah');
    }
    return this.completeLogin(user, meta);
  }

  private async completeLogin(user: UserWithRole, meta: RequestMeta): Promise<LoginResult> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const tokens = await this.sessions.create(user.id, meta);
    await this.audit.log({
      action: 'auth.login',
      actor: user,
      entityType: 'session',
      entityId: tokens.sessionId,
      meta,
    });
    return { status: 'AUTHENTICATED', user: toAuthUser(user), tokens };
  }

  private assertNotLocked(user: User) {
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new HttpException(
        {
          statusCode: HttpStatus.LOCKED,
          message: `Akun dikunci sementara karena terlalu banyak percobaan login. Coba lagi dalam ${minutes} menit.`,
        },
        HttpStatus.LOCKED,
      );
    }
  }

  private async registerFailedAttempt(user: User, meta: RequestMeta, reason: string) {
    const { LOGIN_MAX_ATTEMPTS, LOGIN_LOCK_MINUTES } = env();
    const attempts = user.failedLoginCount + 1;
    const lock = attempts >= LOGIN_MAX_ATTEMPTS;
    await this.prisma.user.update({
      where: { id: user.id },
      data: lock
        ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000) }
        : { failedLoginCount: attempts },
    });
    await this.audit.log({
      action: lock ? 'auth.account_locked' : 'auth.login_failed',
      actor: user,
      entityType: 'user',
      entityId: user.id,
      metadata: { reason, attempts },
      meta,
    });
  }

  // ------------------------------------------------------------------ sesi

  async refresh(refreshToken: string | undefined, meta: RequestMeta) {
    if (!refreshToken) throw new UnauthorizedException();
    const result = await this.sessions.rotate(refreshToken, meta);
    if (result.ok) return result.tokens;
    if (result.reason === 'REUSE_DETECTED') {
      await this.audit.log({
        action: 'auth.refresh_token_reuse',
        entityType: 'user',
        entityId: result.userId,
        metadata: { note: 'Semua sesi pengguna dicabut' },
        meta,
      });
    }
    throw new UnauthorizedException();
  }

  async logout(user: RequestUser, meta: RequestMeta) {
    await this.sessions.revoke(user.sessionId, 'LOGOUT');
    await this.audit.log({
      action: 'auth.logout',
      actor: user,
      entityType: 'session',
      entityId: user.sessionId,
      meta,
    });
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { role: true },
    });
    return toAuthUser(user);
  }

  async listSessions(user: RequestUser): Promise<SessionDto[]> {
    const rows = await this.sessions.listActive(user.id);
    return rows.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === user.sessionId,
    }));
  }

  async revokeSession(user: RequestUser, sessionId: string, meta: RequestMeta) {
    const ok = await this.sessions.revoke(sessionId, 'REVOKED_BY_USER', user.id);
    if (!ok) throw new BadRequestException('Sesi tidak ditemukan atau sudah berakhir');
    await this.audit.log({
      action: 'auth.session_revoked',
      actor: user,
      entityType: 'session',
      entityId: sessionId,
      meta,
    });
  }

  // ------------------------------------------------------------------ password

  async changePassword(
    user: RequestUser,
    currentPassword: string,
    newPassword: string,
    meta: RequestMeta,
  ) {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.passwords.verify(record.passwordHash, currentPassword))) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Password saat ini salah',
        errors: { currentPassword: ['Password saat ini salah'] },
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(newPassword), passwordChangedAt: new Date() },
    });
    await this.sessions.revokeAllForUser(user.id, 'PASSWORD_CHANGED', user.sessionId);
    await this.audit.log({
      action: 'auth.password_changed',
      actor: user,
      entityType: 'user',
      entityId: user.id,
      meta,
    });
  }

  /** Selalu sukses dari sisi klien agar tidak membocorkan email yang terdaftar. */
  async requestPasswordReset(email: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;

    const token = this.crypto.randomToken();
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.crypto.sha256(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
      },
    });
    const link = `${env().APP_PUBLIC_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.send(
      user.email,
      'Reset password Solid Mini Growth Engine',
      `Halo ${user.name},\n\nKami menerima permintaan reset password untuk akun Anda.\n` +
        `Buka link berikut dalam ${RESET_TOKEN_TTL_MINUTES} menit:\n\n${link}\n\n` +
        `Abaikan email ini jika Anda tidak meminta reset password.`,
    );
    await this.audit.log({
      action: 'auth.password_reset_requested',
      actor: user,
      entityType: 'user',
      entityId: user.id,
      meta,
    });
  }

  async resetPassword(token: string, password: string, meta: RequestMeta) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.crypto.sha256(token) },
      include: { user: true },
    });
    if (
      !record ||
      record.usedAt ||
      record.expiresAt < new Date() ||
      record.user.status !== 'ACTIVE'
    ) {
      throw new BadRequestException('Link reset password tidak valid atau sudah kedaluwarsa');
    }
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash: await this.passwords.hash(password),
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
    ]);
    await this.sessions.revokeAllForUser(record.userId, 'PASSWORD_RESET');
    await this.audit.log({
      action: 'auth.password_reset',
      actor: record.user,
      entityType: 'user',
      entityId: record.userId,
      meta,
    });
  }

  // ------------------------------------------------------------------ 2FA

  async setupTwoFactor(user: RequestUser) {
    if (user.twoFactorEnabled) throw new BadRequestException('Autentikasi dua faktor sudah aktif');
    const setup = await this.twoFactor.createSetup(user.email);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: setup.encryptedSecret },
    });
    return {
      otpauthUrl: setup.otpauthUrl,
      qrCodeDataUrl: setup.qrCodeDataUrl,
      secret: setup.secret,
    };
  }

  async enableTwoFactor(user: RequestUser, code: string, meta: RequestMeta) {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (record.twoFactorEnabled)
      throw new BadRequestException('Autentikasi dua faktor sudah aktif');
    if (!this.twoFactor.verify(record.twoFactorSecret, code)) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Kode verifikasi salah',
        errors: { code: ['Kode verifikasi salah'] },
      });
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    await this.sessions.revokeAllForUser(user.id, 'TWO_FACTOR_ENABLED', user.sessionId);
    await this.audit.log({
      action: 'auth.2fa_enabled',
      actor: user,
      entityType: 'user',
      entityId: user.id,
      meta,
    });
  }

  async disableTwoFactor(user: RequestUser, password: string, code: string, meta: RequestMeta) {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!record.twoFactorEnabled)
      throw new BadRequestException('Autentikasi dua faktor belum aktif');
    const okPassword = await this.passwords.verify(record.passwordHash, password);
    if (!okPassword || !this.twoFactor.verify(record.twoFactorSecret, code)) {
      throw new BadRequestException('Password atau kode verifikasi salah');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    await this.audit.log({
      action: 'auth.2fa_disabled',
      actor: user,
      entityType: 'user',
      entityId: user.id,
      meta,
    });
  }
}

export function toAuthUser(user: UserWithRole): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role.code as RoleCode,
    roleName: user.role.name,
    permissions: user.role.permissions,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}
