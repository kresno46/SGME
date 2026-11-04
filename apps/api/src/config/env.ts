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
  /** WhatsApp lewat WAHA. Mati secara default; tiap user menautkan nomornya sendiri. */
  WAHA_ENABLED: bool,
  /** Alamat WAHA dari sisi API; boleh internal, mis. http://waha:3000 */
  WAHA_BASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Kunci API WAHA (plaintext; WAHA menyimpan hash-nya). Dikirim di header X-Api-Key. */
  WAHA_API_KEY: z.string().optional(),
  /**
   * URL webhook SMGE yang dijangkau WAHA, mis. http://api:4000/api/webhooks/waha (jaringan Docker internal)
   * atau https://domain/api/webhooks/waha. Webhook ditandatangani HMAC, jadi http internal aman.
   */
  WAHA_PUBLIC_WEBHOOK_BASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Rahasia induk; secret HMAC tiap sesi diturunkan darinya dan tidak disimpan. */
  WAHA_WEBHOOK_MASTER_SECRET: z.string().optional(),
  /**
   * Hanya untuk WAHA lama (sebelum 2026.6.1) yang membatasi satu sesi bernama "default": isi nama itu agar
   * server memakai satu sesi bersama. Kosong (disarankan) = banyak sesi, banyak nomor per user.
   */
  WAHA_SESSION_NAME: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,100}$/, 'WAHA_SESSION_NAME hanya boleh huruf, angka, titik, garis')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  WAHA_MAX_SESSIONS: z.coerce.number().int().min(1).max(1000).default(25),
  /** Batas jumlah nomor WhatsApp yang boleh ditautkan satu user */
  WAHA_MAX_SESSIONS_PER_USER: z.coerce.number().int().min(1).max(20).default(3),
  WAHA_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  /**
   * Sinkronkan kontak ponsel ke WAHA (NOWEB store + full sync) pada nomor yang BARU dipindai, agar kontak bisa
   * dipilih saat memulai chat. Konsekuensi: WAHA menyimpan seluruh riwayat chat ponsel di volumenya.
   * Nomor yang sudah tertaut harus dipindai ulang agar kontaknya tersinkron.
   */
  WAHA_CONTACTS_SYNC: bool,
  /**
   * Impor otomatis riwayat chat 1:1 dari ponsel (lewat NOWEB store WAHA) setelah nomor ditautkan, agar konteks
   * percakapan sebelumnya ikut terbawa. PRIVASI: semua chat 1:1 dalam jendela hari yang diatur akan masuk ke SMGE
   * dan terlihat oleh pemilik nomor dan Super Admin. Hanya berlaku pada nomor yang dipindai SETELAH opsi ini aktif.
   */
  WAHA_HISTORY_SYNC: bool,
  /** Hanya chat dengan pesan dalam sekian hari terakhir yang diimpor */
  WAHA_HISTORY_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  WAHA_HISTORY_MAX_CHATS: z.coerce.number().int().min(1).max(2000).default(200),
  WAHA_HISTORY_MESSAGES_PER_CHAT: z.coerce.number().int().min(1).max(500).default(50),
  /** Seberapa sering penjadwal memeriksa nomor yang perlu disinkronkan */
  WAHA_HISTORY_TICK_SECONDS: z.coerce.number().int().min(30).max(3600).default(120),
  /**
   * Kirim terjadwal satu pesan ke daftar kecil penerima terpilih. Mati secara default. WAHA bukan jalur resmi:
   * pengiriman beruntun ke banyak orang menaikkan risiko nomor diblokir, jadi dibatasi jumlah penerima, jeda acak,
   * dan batas harian per nomor.
   */
  WAHA_BROADCAST_ENABLED: bool,
  WAHA_BROADCAST_MAX_RECIPIENTS: z.coerce.number().int().min(1).max(200).default(50),
  /** Batas pesan blast terkirim per nomor per hari (WIB); sisanya lanjut keesokan harinya */
  WAHA_BROADCAST_PER_DAY: z.coerce.number().int().min(1).max(500).default(30),
  WAHA_BROADCAST_MIN_DELAY_SECONDS: z.coerce.number().int().min(5).max(3600).default(20),
  WAHA_BROADCAST_MAX_DELAY_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  /** Batas chat baru yang dimulai dari SMGE per nomor per hari (WIB); melindungi nomor dari blokir */
  WAHA_NEW_CHATS_PER_DAY: z.coerce.number().int().min(1).max(500).default(20),
  WAHA_SEND_MIN_INTERVAL_MS: z.coerce.number().int().min(0).max(60_000).default(1200),
  WAHA_SEND_JITTER_MS: z.coerce.number().int().min(0).max(60_000).default(800),
  WAHA_SEND_MAX_PER_CHAT_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(10),
  WAHA_SEND_MAX_PER_SESSION_PER_MINUTE: z.coerce.number().int().min(1).max(6000).default(30),
  /** Pesan keluar yang macet di "mengirim" lebih lama dari ini ditandai gagal oleh worker. */
  WAHA_SEND_STUCK_SECONDS: z.coerce.number().int().min(30).max(86_400).default(300),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('SMGE <no-reply@example.com>'),
});

export type Env = z.infer<typeof envSchema>;

/** Pemeriksaan tambahan khusus produksi (dipisah agar dapat diuji). */
export function productionProblems(e: Env): string[] {
  const problems: string[] = [];
  const placeholder = /ganti|changeme|contoh|example/i;
  if (placeholder.test(e.JWT_ACCESS_SECRET))
    problems.push('JWT_ACCESS_SECRET masih berisi nilai contoh');
  if (e.CONVERSION_API_SECRET && placeholder.test(e.CONVERSION_API_SECRET)) {
    problems.push('CONVERSION_API_SECRET masih berisi nilai contoh');
  }
  if (!e.APP_PUBLIC_URL.startsWith('https://'))
    problems.push('APP_PUBLIC_URL wajib https di produksi');
  if (e.TIKTOK_REDIRECT_URI && !e.TIKTOK_REDIRECT_URI.startsWith('https://')) {
    problems.push('TIKTOK_REDIRECT_URI wajib https');
  }
  if (/localhost|127\.0\.0\.1/.test(e.CORS_ORIGINS))
    problems.push('CORS_ORIGINS masih berisi localhost');
  if (e.WAHA_ENABLED) {
    if (placeholder.test(e.WAHA_WEBHOOK_MASTER_SECRET ?? ''))
      problems.push('WAHA_WEBHOOK_MASTER_SECRET masih berisi nilai contoh');
    if (placeholder.test(e.WAHA_API_KEY ?? ''))
      problems.push('WAHA_API_KEY masih berisi nilai contoh');
  }
  return problems;
}

/** Konfigurasi WAHA yang wajib lengkap bila WAHA_ENABLED=true (semua lingkungan). */
export function wahaProblems(e: Env): string[] {
  if (!e.WAHA_ENABLED) return [];
  const problems: string[] = [];
  if (!e.WAHA_BASE_URL) problems.push('WAHA_BASE_URL wajib diisi');
  if (!e.WAHA_API_KEY) problems.push('WAHA_API_KEY wajib diisi');
  if (!e.WAHA_PUBLIC_WEBHOOK_BASE_URL) problems.push('WAHA_PUBLIC_WEBHOOK_BASE_URL wajib diisi');
  if (e.WAHA_BROADCAST_MIN_DELAY_SECONDS > e.WAHA_BROADCAST_MAX_DELAY_SECONDS)
    problems.push('WAHA_BROADCAST_MIN_DELAY_SECONDS tidak boleh lebih besar dari MAX');
  if ((e.WAHA_WEBHOOK_MASTER_SECRET ?? '').length < 32)
    problems.push('WAHA_WEBHOOK_MASTER_SECRET minimal 32 karakter');
  return problems;
}

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
  const waha = wahaProblems(parsed.data);
  if (waha.length) {
    const list = waha.map((p) => `  - ${p}`).join('\n');
    throw new Error(`Konfigurasi WAHA tidak lengkap:\n${list}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE wajib true di produksi (HTTPS).');
  }
  if (parsed.data.NODE_ENV === 'production') {
    const problems = productionProblems(parsed.data);
    if (problems.length) {
      const list = problems.map((p) => `  - ${p}`).join('\n');
      throw new Error(`Konfigurasi produksi tidak aman:\n${list}`);
    }
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
