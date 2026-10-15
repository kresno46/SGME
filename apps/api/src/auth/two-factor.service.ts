import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { CryptoService } from '../common/crypto/crypto.service';

authenticator.options = { window: 1 }; // toleransi ±30 detik

/** TOTP (RFC 6238) — kompatibel dengan Google Authenticator, Authy, 1Password, dll. */
@Injectable()
export class TwoFactorService {
  constructor(private readonly crypto: CryptoService) {}

  async createSetup(email: string) {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(email, 'Solid Mini Growth Engine', secret);
    return {
      secret,
      encryptedSecret: this.crypto.encrypt(secret),
      otpauthUrl,
      qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl),
    };
  }

  verify(encryptedSecret: string | null, code: string): boolean {
    if (!encryptedSecret) return false;
    try {
      return authenticator.check(code, this.crypto.decrypt(encryptedSecret));
    } catch {
      return false;
    }
  }
}
