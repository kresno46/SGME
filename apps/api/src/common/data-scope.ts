import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ForbiddenException,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  NotFoundException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Prisma } from '@smge/database';
import type { RequestUser } from './decorators/auth.decorators';
import type { PrismaService } from '../prisma/prisma.service';

export const dataScope = new AsyncLocalStorage<RequestUser | null>();
export function scopeUser() {
  return dataScope.getStore();
}
export function ownerScope() {
  const user = scopeUser();
  return user && user.role !== 'SUPER_ADMIN' ? { ownerId: user.id } : {};
}
export function assertOwnOperator(id?: string | null) {
  const user = scopeUser();
  if (user && user.role !== 'SUPER_ADMIN' && id && id !== user.id)
    throw new ForbiddenException('Penugasan hanya boleh ke akun sendiri.');
}
export async function assertReferences(
  db: PrismaService | Prisma.TransactionClient,
  refs: {
    leadId?: string | null;
    accountId?: string | null;
    campaignId?: string | null;
    templateId?: string | null;
  },
) {
  if (
    refs.leadId &&
    !(await db.lead.findFirst({ where: { id: refs.leadId, ...ownerScope(), deletedAt: null } }))
  )
    throw new NotFoundException('Prospek tidak ditemukan');
  if (
    refs.accountId &&
    !(await db.tikTokAccount.findFirst({ where: { id: refs.accountId, ...ownerScope() } }))
  )
    throw new NotFoundException('Akun TikTok tidak ditemukan');
  const user = scopeUser();
  if (refs.campaignId && user && user.role !== 'SUPER_ADMIN')
    throw new ForbiddenException('Campaign tidak tersedia untuk akun ini.');
  if (
    refs.templateId &&
    !(await db.messageTemplate.findFirst({
      where: {
        id: refs.templateId,
        ...(user && user.role !== 'SUPER_ADMIN'
          ? { OR: [{ createdById: user.id }, { createdById: null }] }
          : {}),
      },
    }))
  )
    throw new NotFoundException('Template tidak ditemukan');
}

@Injectable()
export class DataScopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx
      .switchToHttp()
      .getRequest<{ user?: RequestUser; path: string; method: string }>();
    const user = req.user;
    if (user && user.role !== 'SUPER_ADMIN') {
      const path = req.path
        .replace(/^\/api(?=\/)/i, '')
        .toLowerCase()
        .replace(/\/+$/, '');
      if (
        ['/campaigns', '/integrations', '/conversations', '/tracking-links'].some(
          (p) => path === p || path.startsWith(`${p}/`),
        ) ||
        path === '/analytics/report'
      )
        throw new ForbiddenException('Halaman ini hanya tersedia untuk Super Admin.');
      if (
        path === '/users' ||
        (path.startsWith('/users/') && path !== '/users/assignable') ||
        path === '/roles' ||
        path.startsWith('/audit') ||
        path.startsWith('/retention') ||
        ((path.startsWith('/do-not-contact') ||
          (path.startsWith('/leads/') && path.endsWith('/do-not-contact'))) &&
          req.method === 'DELETE')
      )
        throw new ForbiddenException('Akses ini hanya untuk Super Admin.');
      if (path.startsWith('/knowledge-documents') && req.method !== 'GET')
        throw new ForbiddenException('Materi bersama dikelola Super Admin.');
    }
    return new Observable((subscriber) =>
      dataScope.run(user ?? null, () => next.handle().subscribe(subscriber)),
    );
  }
}
