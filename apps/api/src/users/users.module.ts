import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  adminResetPasswordSchema,
  createUserSchema,
  CreateUserInput,
  listUsersQuerySchema,
  ListUsersQuery,
  PERMISSIONS,
  updateUserSchema,
  UpdateUserInput,
} from '@smge/shared';
import type { Request } from 'express';
import { CurrentUser, RequestUser, RequirePermissions } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  list(@Query(new ZodValidationPipe(listUsersQuerySchema)) q: ListUsersQuery) {
    return this.users.list(q);
  }

  @Get('users/assignable')
  @RequirePermissions(PERMISSIONS.LEADS_READ)
  assignable() {
    return this.users.assignable();
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  roles() {
    return this.users.listRoles();
  }

  @Post('users')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  create(
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
    @Req() req: Request,
  ) {
    return this.users.create(actor, body, requestMeta(req));
  }

  @Patch('users/:id')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  update(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @Req() req: Request,
  ) {
    return this.users.update(actor, id, body, requestMeta(req));
  }

  @Post('users/:id/reset-password')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async resetPassword(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(adminResetPasswordSchema)) body: { password: string },
    @Req() req: Request,
  ) {
    await this.users.resetPassword(actor, id, body.password, requestMeta(req));
    return { ok: true };
  }

  @Post('users/:id/unlock')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async unlock(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.users.unlock(actor, id, requestMeta(req));
    return { ok: true };
  }

  @Post('users/:id/reset-2fa')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  async resetTwoFactor(
    @CurrentUser() actor: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.users.resetTwoFactor(actor, id, requestMeta(req));
    return { ok: true };
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
