import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER, REFRESH_COOKIE } from '../../auth/cookies';
import { SKIP_CSRF_KEY } from '../decorators/auth.decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Proteksi CSRF double-submit untuk request yang diautentikasi lewat cookie.
 * Klien API yang memakai header Authorization: Bearer tidak terdampak CSRF sehingga dilewati.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [ctx.getHandler(), ctx.getClass()])
    ) {
      return true;
    }
    if (req.get('authorization')?.startsWith('Bearer ')) return true;

    const usesCookieAuth = Boolean(req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE]);
    if (!usesCookieAuth) return true;

    const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
    const header = req.get(CSRF_HEADER);
    if (!cookie || !header || !safeEqual(cookie, header)) {
      throw new ForbiddenException('Token CSRF tidak valid. Muat ulang halaman lalu coba lagi.');
    }
    return true;
  }
}

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
