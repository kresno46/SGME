import { randomBytes } from 'node:crypto';
import { env, productionProblems, resetEnvCache, type Env } from './env';

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://smge:x@postgres:5432/smge',
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  COOKIE_SECURE: 'true',
  APP_PUBLIC_URL: 'https://smge.example.id',
  CORS_ORIGINS: 'https://smge.example.id',
};

describe('konfigurasi produksi', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });

  const load = (overrides: Record<string, string>) => {
    process.env = { ...base, ...overrides } as NodeJS.ProcessEnv;
    resetEnvCache();
    return () => env();
  };

  it('menerima konfigurasi produksi yang benar', () => {
    expect(load({})()).toMatchObject({ NODE_ENV: 'production', COOKIE_SECURE: true });
  });

  it('menolak secret contoh, URL http, localhost, cookie tidak aman, mock & AI simulasi', () => {
    expect(load({ JWT_ACCESS_SECRET: 'ganti-dengan-string-acak-minimal-32-karakter' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(load({ APP_PUBLIC_URL: 'http://smge.example.id' })).toThrow(/https/);
    expect(load({ CORS_ORIGINS: 'http://localhost:3000' })).toThrow(/localhost/);
    expect(load({ COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(load({ TIKTOK_USE_MOCK: 'true' })).toThrow(/TIKTOK_USE_MOCK/);
    expect(load({ AI_PROVIDER: 'simulated' })).toThrow(/simulated/);
  });

  it('WAHA aktif wajib lengkap, dan di produksi tanpa nilai contoh', () => {
    const waha = {
      WAHA_ENABLED: 'true',
      WAHA_BASE_URL: 'http://waha:3000',
      WAHA_API_KEY: randomBytes(16).toString('hex'),
      WAHA_PUBLIC_WEBHOOK_BASE_URL: 'https://smge.example.id/api/webhooks/waha',
      WAHA_WEBHOOK_MASTER_SECRET: randomBytes(32).toString('hex'),
    };
    expect(load(waha)()).toMatchObject({ WAHA_ENABLED: true });
    expect(load({ ...waha, WAHA_WEBHOOK_MASTER_SECRET: 'pendek' })).toThrow(
      /WAHA_WEBHOOK_MASTER_SECRET/,
    );
    expect(load({ ...waha, WAHA_BASE_URL: '' })).toThrow(/WAHA_BASE_URL/);
    expect(load({ ...waha, WAHA_API_KEY: 'ganti-dengan-kunci-acak' })).toThrow(/WAHA_API_KEY/);
    // Webhook lewat jaringan Docker internal (http) diperbolehkan: ditandatangani HMAC.
    expect(
      load({ ...waha, WAHA_PUBLIC_WEBHOOK_BASE_URL: 'http://api:4000/api/webhooks/waha' })(),
    ).toMatchObject({ WAHA_ENABLED: true });
  });

  it('productionProblems mendaftar semua masalah sekaligus', () => {
    const problems = productionProblems({
      ...(base as unknown as Env),
      JWT_ACCESS_SECRET: 'changeme-changeme-changeme-changeme',
      APP_PUBLIC_URL: 'http://x.id',
      TIKTOK_REDIRECT_URI: 'http://x.id/cb',
    } as Env);
    expect(problems).toHaveLength(3);
  });
});
