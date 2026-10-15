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
