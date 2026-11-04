import { ExecutionContext, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createTikTokAccountSchema, PERMISSIONS } from '@smge/shared';
import { randomBytes } from 'node:crypto';
import { summarizeIntegrationStatus } from '../accounts/accounts.service';
import { CryptoService } from './crypto/crypto.service';
import { CsrfGuard } from './guards/csrf.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { ZodValidationPipe } from './pipes/zod-validation.pipe';

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.JWT_ACCESS_SECRET ??= randomBytes(32).toString('hex');
process.env.DATABASE_URL ??= 'postgresql://unit-test';

function httpContext(
  req: Record<string, unknown>,
  handlerMeta: Record<string, unknown> = {},
): {
  ctx: ExecutionContext;
  reflector: Reflector;
} {
  const handler = () => undefined;
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key: unknown) => handlerMeta[key as string]);
  const ctx = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

function fakeRequest(opts: {
  method: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}) {
  const headers = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    method: opts.method,
    cookies: opts.cookies ?? {},
    get: (h: string) => headers[h.toLowerCase()],
  };
}

describe('CryptoService', () => {
  const crypto = new CryptoService();

  it('mengenkripsi dan mendekripsi kembali (round-trip)', () => {
    const secret = 'token-rahasia-tiktok';
    const enc = crypto.encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(crypto.decrypt(enc)).toBe(secret);
  });

  it('menghasilkan ciphertext berbeda untuk plaintext sama (IV acak)', () => {
    expect(crypto.encrypt('x')).not.toBe(crypto.encrypt('x'));
  });

  it('menolak ciphertext yang dimodifikasi', () => {
    const parts = crypto.encrypt('data').split(':');
    parts[3] = Buffer.from('dirusak').toString('base64url');
    expect(() => crypto.decrypt(parts.join(':'))).toThrow();
  });

  it('sha256 deterministik', () => {
    expect(crypto.sha256('abc')).toBe(crypto.sha256('abc'));
    expect(crypto.sha256('abc')).toHaveLength(64);
  });
});

describe('CsrfGuard', () => {
  const run = (req: ReturnType<typeof fakeRequest>, meta = {}) => {
    const { ctx, reflector } = httpContext(req, meta);
    return new CsrfGuard(reflector).canActivate(ctx);
  };

  it('mengizinkan GET tanpa token', () => {
    expect(run(fakeRequest({ method: 'GET', cookies: { smge_at: 'x' } }))).toBe(true);
  });

  it('menolak POST berbasis cookie tanpa header CSRF', () => {
    expect(() =>
      run(fakeRequest({ method: 'POST', cookies: { smge_at: 'x', smge_csrf: 'abc' } })),
    ).toThrow(ForbiddenException);
  });

  it('menolak header CSRF yang tidak cocok', () => {
    expect(() =>
      run(
        fakeRequest({
          method: 'PATCH',
          cookies: { smge_at: 'x', smge_csrf: 'abc' },
          headers: { 'x-csrf-token': 'xyz' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('menerima header CSRF yang cocok', () => {
    expect(
      run(
        fakeRequest({
          method: 'DELETE',
          cookies: { smge_at: 'x', smge_csrf: 'abc' },
          headers: { 'x-csrf-token': 'abc' },
        }),
      ),
    ).toBe(true);
  });

  it('melewati klien Bearer token dan endpoint @SkipCsrf', () => {
    expect(
      run(
        fakeRequest({
          method: 'POST',
          cookies: { smge_at: 'x' },
          headers: { authorization: 'Bearer t' },
        }),
      ),
    ).toBe(true);
    expect(
      run(fakeRequest({ method: 'POST', cookies: { smge_at: 'x' } }), { skipCsrf: true }),
    ).toBe(true);
  });
});

describe('PermissionsGuard', () => {
  const run = (permissions: string[], required?: string[]) => {
    const { ctx, reflector } = httpContext({ user: { permissions } }, { permissions: required });
    return new PermissionsGuard(reflector).canActivate(ctx);
  };

  it('mengizinkan bila tidak ada permission yang disyaratkan', () => {
    expect(run([])).toBe(true);
  });

  it('mengizinkan bila semua permission dimiliki', () => {
    expect(
      run([PERMISSIONS.ACCOUNTS_READ, PERMISSIONS.ACCOUNTS_MANAGE], [PERMISSIONS.ACCOUNTS_MANAGE]),
    ).toBe(true);
  });

  it('menolak bila permission kurang', () => {
    expect(() => run([PERMISSIONS.ACCOUNTS_READ], [PERMISSIONS.ACCOUNTS_MANAGE])).toThrow(
      ForbiddenException,
    );
  });
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(createTikTokAccountSchema);

  it('mengembalikan data yang sudah ditransformasi', () => {
    const out = pipe.transform({
      username: '@Akun.Satu',
      displayName: 'Akun',
      lane: 'OUTBOUND',
      profileUrl: 'https://www.tiktok.com/@akun.satu',
    });
    expect(out.username).toBe('akun.satu');
  });

  it('mengembalikan error per field dalam bahasa Indonesia', () => {
    try {
      pipe.transform({ username: 'x y' });
      fail('seharusnya error');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = (e as BadRequestException).getResponse() as { errors: Record<string, string[]> };
      expect(body.errors.displayName).toEqual(['Wajib diisi']);
      expect(body.errors.lane).toBeDefined();
    }
  });
});

describe('summarizeIntegrationStatus', () => {
  it('NOT_CONNECTED bila tidak ada integrasi', () => {
    expect(summarizeIntegrationStatus([])).toBe('NOT_CONNECTED');
  });

  it('memilih status paling relevan', () => {
    expect(summarizeIntegrationStatus([{ status: 'ERROR' }, { status: 'CONNECTED' }])).toBe(
      'CONNECTED',
    );
    expect(
      summarizeIntegrationStatus([{ status: 'NOT_CONNECTED' }, { status: 'TOKEN_EXPIRED' }]),
    ).toBe('TOKEN_EXPIRED');
  });
});
