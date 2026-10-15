import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TwoFactorService } from './two-factor.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: env().JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', issuer: 'smge-api' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'smge-api' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, TwoFactorService, MailService],
  exports: [PasswordService, SessionService],
})
export class AuthModule {}
