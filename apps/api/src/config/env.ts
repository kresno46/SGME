import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Di development .env berada di root monorepo; di produksi variabel datang dari Docker.
loadDotenv({ path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')] });

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  APP_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  /** URL halaman registrasi/landing Solid Mini (dipakai placeholder {{link}}) */
  SOLID_MINI_REGISTRATION_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET minimal 32 karakter'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(14),
  COOKIE_SECURE: bool,
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
  THROTTLE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  THROTTLE_AUTH_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY harus 32 byte (base64)'),
  /** openai = model sungguhan; simulated = keluaran simulasi berlabel (development). Kosong = otomatis. */
  AI_PROVIDER: z
    .enum(['openai', 'simulated'])
    .optional()
    .or(z.literal('').transform(() => undefined)),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  /** Opsional: endpoint kompatibel OpenAI (mis. proxy/gateway internal) */
  OPENAI_BASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  THROTTLE_AI_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(30),
  /** Login Kit (developers.tiktok.com). Kosong = integrasi resmi nonaktif. */
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  /** Harus https, statis, dan terdaftar di portal TikTok, mis. https://domain/api/integrations/tiktok/callback */
  TIKTOK_REDIRECT_URI: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  TIKTOK_SCOPES: z.string().default('user.info.basic,user.info.profile,user.info.stats'),
  /** Mock Adapter berlabel SIMULASI untuk development. Ditolak di produksi. */
  TIKTOK_USE_MOCK: bool,
  /** Secret HMAC untuk Conversion API (backend Solid Mini → SMGE). Kosong = endpoint nonaktif. */
  CONVERSION_API_SECRET: z
    .string()
    .min(32, 'CONVERSION_API_SECRET minimal 32 karakter')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Origin landing page yang boleh mengirim event tracking dari browser (dipisah koma) */
  TRACKING_ALLOWED_ORIGINS: z.string().default(''),
  /** Jendela atribusi (hari) */
  ATTRIBUTION_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(180).default(30),
  THROTTLE_TRACKING_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('SMGE <no-reply@example.com>'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Konfigurasi environment tidak valid:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE wajib true di produksi (HTTPS).');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.TIKTOK_USE_MOCK) {
    throw new Error('TIKTOK_USE_MOCK tidak boleh aktif di produksi (data simulasi).');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.AI_PROVIDER === 'simulated') {
    throw new Error('AI_PROVIDER=simulated tidak boleh dipakai di produksi.');
  }
  cached = parsed.data;
  return cached;
}

/** Hanya untuk test: paksa baca ulang process.env. */
export function resetEnvCache() {
  cached = null;
}
