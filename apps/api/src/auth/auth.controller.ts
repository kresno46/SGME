import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordSchema,
  ChangePasswordInput,
  disableTwoFactorSchema,
  enableTwoFactorSchema,
  forgotPasswordSchema,
  ForgotPasswordInput,
  loginSchema,
  LoginInput,
  resetPasswordSchema,
  ResetPasswordInput,
  twoFactorLoginSchema,
  TwoFactorLoginInput,
} from '@smge/shared';
import type { LoginResponse } from '@smge/types';
import type { Request, Response } from 'express';
import { CurrentUser, Public, RequestUser, SkipCsrf } from '../common/decorators/auth.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { requestMeta } from '../common/utils/request';
import { env } from '../config/env';
import { AuthService, LoginResult } from './auth.service';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './cookies';

/** Batas ketat untuk endpoint yang rawan brute force. */
const authThrottle = () => ({
  default: { limit: () => env().THROTTLE_AUTH_LIMIT_PER_MINUTE, ttl: 60_000 },
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @SkipCsrf()
  @Throttle(authThrottle())
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    return this.respond(await this.auth.login(body.email, body.password, requestMeta(req)), res);
  }

  @Public()
  @SkipCsrf()
  @Throttle(authThrottle())
  @Post('2fa/verify')
  @HttpCode(200)
  async verifyTwoFactor(
    @Body(new ZodValidationPipe(twoFactorLoginSchema)) body: TwoFactorLoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    return this.respond(
      await this.auth.verifyTwoFactorLogin(body.challengeToken, body.code, requestMeta(req)),
      res,
    );
  }

  /** Rotasi refresh token. Dilindungi CSRF karena memakai cookie. */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const tokens = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], requestMeta(req));
      setAuthCookies(res, tokens);
      return { ok: true };
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(user, requestMeta(req));
    clearAuthCookies(res);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.auth.me(user.id);
  }

  @Get('sessions')
  sessions(@CurrentUser() user: RequestUser) {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  async revokeSession(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    await this.auth.revokeSession(user, id, requestMeta(req));
    return { ok: true };
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
  ) {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword, requestMeta(req));
    return {
      ok: true,
      message: 'Password berhasil diubah. Sesi di perangkat lain telah diakhiri.',
    };
  }

  @Public()
  @SkipCsrf()
  @Throttle(authThrottle())
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
    @Req() req: Request,
  ) {
    await this.auth.requestPasswordReset(body.email, requestMeta(req));
    return {
      ok: true,
      message: 'Jika email terdaftar, link reset password telah dikirim. Periksa kotak masuk Anda.',
    };
  }

  @Public()
  @SkipCsrf()
  @Throttle(authThrottle())
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @Req() req: Request,
  ) {
    await this.auth.resetPassword(body.token, body.password, requestMeta(req));
    return { ok: true, message: 'Password berhasil direset. Silakan login dengan password baru.' };
  }

  @Post('2fa/setup')
  @HttpCode(200)
  setupTwoFactor(@CurrentUser() user: RequestUser) {
    return this.auth.setupTwoFactor(user);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  async enableTwoFactor(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(enableTwoFactorSchema)) body: { code: string },
    @Req() req: Request,
  ) {
    await this.auth.enableTwoFactor(user, body.code, requestMeta(req));
    return { ok: true };
  }

  @Post('2fa/disable')
  @HttpCode(200)
  async disableTwoFactor(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(disableTwoFactorSchema)) body: { password: string; code: string },
    @Req() req: Request,
  ) {
    await this.auth.disableTwoFactor(user, body.password, body.code, requestMeta(req));
    return { ok: true };
  }

  private respond(result: LoginResult, res: Response): LoginResponse {
    if (result.status === 'TWO_FACTOR_REQUIRED') return result;
    setAuthCookies(res, result.tokens);
    return { status: 'AUTHENTICATED', user: result.user };
  }
}
