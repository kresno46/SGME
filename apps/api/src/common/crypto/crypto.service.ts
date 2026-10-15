import { Global, Injectable, Module } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env';

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

/**
 * Enkripsi simetris untuk data sensitif at-rest (token integrasi, secret 2FA).
 * Format ciphertext: v1:<iv>:<authTag>:<data> (base64url).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    this.key = Buffer.from(env().ENCRYPTION_KEY, 'base64');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split(':');
    if (version !== VERSION || !iv || !tag || !data)
      throw new Error('Format ciphertext tidak dikenal');
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Token acak aman untuk refresh token, reset password, CSRF. */
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** Hash satu arah untuk menyimpan token (bukan password). */
  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

@Global()
@Module({ providers: [CryptoService], exports: [CryptoService] })
export class CryptoModule {}
