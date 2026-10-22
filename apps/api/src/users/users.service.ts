import { scopeUser } from '../common/data-scope';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role, User } from '@smge/database';
import {
  canManageRole,
  CreateUserInput,
  ListUsersQuery,
  RoleCode,
  UpdateUserInput,
} from '@smge/shared';
import type { RoleDto, UserDto } from '@smge/types';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { paginate, RequestMeta } from '../common/utils/request';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListUsersQuery) {
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: { code: q.role } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { role: true },
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(rows.map(toUserDto), total, q.page, q.pageSize);
  }

  /** Pengguna aktif yang dapat ditugaskan menangani prospek/campaign (data minimal). */
  async assignable() {
    return this.prisma.user.findMany({
      where: {
        ...(scopeUser() && scopeUser()!.role !== 'SUPER_ADMIN' ? { id: scopeUser()!.id } : {}),
        status: 'ACTIVE',
        role: { code: { in: ['SUPER_ADMIN', 'ADMIN', 'MARKETING_OPERATOR'] } },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async listRoles(): Promise<RoleDto[]> {
    const roles = await this.prisma.role.findMany({
      include: { _count: { select: { users: true } } },
    });
    const order: RoleCode[] = ['SUPER_ADMIN', 'ADMIN', 'MARKETING_OPERATOR', 'VIEWER'];
    return roles
      .sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code))
      .map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        permissions: r.permissions,
        userCount: r._count.users,
      }));
  }

  async create(actor: RequestUser, input: CreateUserInput, meta: RequestMeta) {
    this.assertCanAssign(actor, input.role);
    const exists = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new ConflictException('Email sudah digunakan pengguna lain');

    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: input.role } });
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        roleId: role.id,
        passwordHash: await this.passwords.hash(input.password),
        passwordChangedAt: new Date(),
      },
      include: { role: true },
    });
    await this.audit.log({
      action: 'user.created',
      actor,
      entityType: 'user',
      entityId: user.id,
      metadata: { email: user.email, role: input.role },
      meta,
    });
    return toUserDto(user);
  }

  async update(actor: RequestUser, id: string, input: UpdateUserInput, meta: RequestMeta) {
    const target = await this.findManageable(actor, id);
    if (target.id === actor.id && (input.role || input.status)) {
      throw new BadRequestException('Anda tidak dapat mengubah role atau status akun Anda sendiri');
    }
    if (input.role) this.assertCanAssign(actor, input.role);

    const role = input.role
      ? await this.prisma.role.findUniqueOrThrow({ where: { code: input.role } })
      : null;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(role ? { roleId: role.id } : {}),
      },
      include: { role: true },
    });
    if (input.status === 'DISABLED') {
      await this.sessions.revokeAllForUser(id, 'USER_DISABLED');
    }
    await this.audit.log({
      action: 'user.updated',
      actor,
      entityType: 'user',
      entityId: id,
      metadata: { changes: input, previousRole: target.role.code, previousStatus: target.status },
      meta,
    });
    return toUserDto(user);
  }

  async resetPassword(actor: RequestUser, id: string, password: string, meta: RequestMeta) {
    await this.findManageable(actor, id);
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await this.passwords.hash(password),
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.sessions.revokeAllForUser(id, 'PASSWORD_RESET_BY_ADMIN');
    await this.audit.log({
      action: 'user.password_reset_by_admin',
      actor,
      entityType: 'user',
      entityId: id,
      meta,
    });
  }

  async unlock(actor: RequestUser, id: string, meta: RequestMeta) {
    await this.findManageable(actor, id);
    await this.prisma.user.update({
      where: { id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    await this.audit.log({
      action: 'user.unlocked',
      actor,
      entityType: 'user',
      entityId: id,
      meta,
    });
  }

  async resetTwoFactor(actor: RequestUser, id: string, meta: RequestMeta) {
    await this.findManageable(actor, id);
    await this.prisma.user.update({
      where: { id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    await this.sessions.revokeAllForUser(id, 'TWO_FACTOR_RESET_BY_ADMIN');
    await this.audit.log({
      action: 'user.2fa_reset_by_admin',
      actor,
      entityType: 'user',
      entityId: id,
      meta,
    });
  }

  private async findManageable(actor: RequestUser, id: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw new NotFoundException('Pengguna tidak ditemukan');
    if (target.id !== actor.id && !canManageRole(actor.role, target.role.code)) {
      throw new ForbiddenException('Anda tidak dapat mengelola pengguna dengan role ini');
    }
    return target;
  }

  private assertCanAssign(actor: RequestUser, role: RoleCode) {
    if (!canManageRole(actor.role, role)) {
      throw new ForbiddenException('Anda tidak dapat memberikan role ini');
    }
  }
}

export function toUserDto(u: User & { role: Role }): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role.code,
    roleName: u.role.name,
    status: u.status,
    twoFactorEnabled: u.twoFactorEnabled,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}
