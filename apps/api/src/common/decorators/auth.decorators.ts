import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, RoleCode } from '@smge/shared';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
/** Endpoint dapat diakses tanpa login. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'permissions';
/** Semua permission yang disebut wajib dimiliki. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const SKIP_CSRF_KEY = 'skipCsrf';
/** Lewati validasi CSRF (hanya untuk endpoint yang belum memiliki sesi, mis. login). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: RoleCode;
  roleName: string;
  permissions: string[];
  sessionId: string;
  twoFactorEnabled: boolean;
}

export type AuthedRequest = Request & { user: RequestUser };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.user;
});
