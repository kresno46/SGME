import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@smge/shared';
import { AuthedRequest, PERMISSIONS_KEY } from '../decorators/auth.decorators';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const { user } = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!user) throw new ForbiddenException();
    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length) throw new ForbiddenException('Anda tidak memiliki akses ke fitur ini');
    return true;
  }
}
