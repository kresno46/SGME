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
// Conversion API (secret uji, min. 32 karakter)
process.env.CONVERSION_API_SECRET = 'conversion-secret-untuk-test-0123456789';
process.env.ATTRIBUTION_LOOKBACK_DAYS = '30';
// WhatsApp (WAHA): gateway disuntikkan per test; konfigurasi ini hanya memenuhi validasi env
process.env.WAHA_ENABLED = 'true';
process.env.WAHA_BASE_URL = 'http://waha.test:3000';
process.env.WAHA_API_KEY = 'waha-api-key-untuk-test';
process.env.WAHA_PUBLIC_WEBHOOK_BASE_URL = 'https://smge.test/api/webhooks/waha';
process.env.WAHA_WEBHOOK_MASTER_SECRET = 'master-secret-untuk-test-0123456789abcdef';
process.env.WAHA_SEND_MIN_INTERVAL_MS = '0';
process.env.WAHA_SEND_JITTER_MS = '0';
process.env.WAHA_SESSION_NAME = '';
process.env.WAHA_MAX_SESSIONS = '25';
process.env.WAHA_SEND_MAX_PER_CHAT_PER_MINUTE = '10';
process.env.WAHA_SEND_MAX_PER_SESSION_PER_MINUTE = '30';
process.env.WAHA_MAX_SESSIONS_PER_USER = '3';
process.env.WAHA_CONTACTS_SYNC = 'false';
process.env.WAHA_NEW_CHATS_PER_DAY = '20';
process.env.WAHA_HISTORY_SYNC = 'true';
process.env.WAHA_HISTORY_DAYS = '30';
process.env.WAHA_HISTORY_MAX_CHATS = '200';
process.env.WAHA_HISTORY_MESSAGES_PER_CHAT = '50';
process.env.WAHA_BROADCAST_ENABLED = 'true';
process.env.WAHA_BROADCAST_MAX_RECIPIENTS = '50';
process.env.WAHA_BROADCAST_PER_DAY = '30';
process.env.WAHA_BROADCAST_MIN_DELAY_SECONDS = '20';
process.env.WAHA_BROADCAST_MAX_DELAY_SECONDS = '60';
