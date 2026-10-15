import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** Hash password dengan Argon2id (parameter default @node-rs/argon2: m=19MiB, t=2, p=1). */
@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Dipakai saat email tidak ditemukan, agar waktu respons tidak membocorkan keberadaan akun. */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= hash('dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
  }
}
