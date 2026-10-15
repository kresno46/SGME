import type { CookieOptions, Response } from 'express';
import { env } from '../config/env';

export const ACCESS_COOKIE = 'smge_at';
export const REFRESH_COOKIE = 'smge_rt';
/** Cookie CSRF (double-submit): dibaca JavaScript lalu dikirim ulang lewat header X-CSRF-Token. */
export const CSRF_COOKIE = 'smge_csrf';
export const CSRF_HEADER = 'x-csrf-token';

function base(): CookieOptions {
  return { secure: env().COOKIE_SECURE, sameSite: 'lax', path: '/' };
}

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string; refreshExpiresAt: Date },
) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(),
    httpOnly: true,
    maxAge: env().JWT_ACCESS_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(),
    httpOnly: true,
    expires: tokens.refreshExpiresAt,
  });
  res.cookie(CSRF_COOKIE, tokens.csrfToken, {
    ...base(),
    httpOnly: false,
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
    res.clearCookie(name, base());
  }
}
