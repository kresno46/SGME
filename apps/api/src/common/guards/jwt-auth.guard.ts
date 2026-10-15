import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { RoleCode } from '@smge/shared';
import { ACCESS_COOKIE } from '../../auth/cookies';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthedRequest, IS_PUBLIC_KEY } from '../decorators/auth.decorators';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  typ: 'access';
}

/**
 * Memverifikasi access token (cookie httpOnly atau header Bearer) DAN status sesi di database,
 * sehingga logout/penonaktifan pengguna berlaku seketika.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = extractAccessToken(req);
    if (!token) throw new UnauthorizedException();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (payload.typ !== 'access') throw new UnauthorizedException();

    const session = await this.prisma.userSession.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { role: true } } },
    });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException();
    }

    const { user } = session;
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.code as RoleCode,
      roleName: user.role.name,
      permissions: user.role.permissions,
      sessionId: session.id,
      twoFactorEnabled: user.twoFactorEnabled,
    };
    return true;
  }
}

export function extractAccessToken(req: AuthedRequest): string | null {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return (req.cookies?.[ACCESS_COOKIE] as string | undefined) ?? null;
}
