import { resolve } from 'node:path';
import { config } from 'dotenv';

config({ path: resolve(__dirname, '../../../.env') });
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.COOKIE_SECURE = 'false';
process.env.LOGIN_MAX_ATTEMPTS = '3';
process.env.THROTTLE_LIMIT_PER_MINUTE = '100000';
process.env.THROTTLE_AUTH_LIMIT_PER_MINUTE = '100000';
// SMTP dimatikan: email reset password ditangkap lewat spy di test.
process.env.SMTP_HOST = '';
// Integrasi TikTok untuk test (adapter disuntikkan per test; secret dipakai verifikasi webhook)
process.env.TIKTOK_CLIENT_KEY = 'test-client-key';
process.env.TIKTOK_CLIENT_SECRET = 'test-client-secret';
process.env.TIKTOK_REDIRECT_URI = 'https://smge.test/api/integrations/tiktok/callback';
process.env.TIKTOK_USE_MOCK = 'false';
process.env.APP_PUBLIC_URL = 'http://dashboard.test';
