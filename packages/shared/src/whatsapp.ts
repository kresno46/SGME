import { z } from 'zod';

export const WHATSAPP_MAX_MESSAGE_LENGTH = 4096;

/** Status sesi WhatsApp seperti dilaporkan WAHA, ditambah status yang ditentukan SMGE sendiri. */
export const WAHA_SESSION_STATUSES = [
  'NOT_CREATED',
  'STOPPED',
  'STARTING',
  'SCAN_QR_CODE',
  'WORKING',
  'FAILED',
  'UNREACHABLE',
  'UNAUTHORIZED',
  'NOT_CONFIGURED',
  'WAHA_ERROR',
] as const;
export type WahaSessionStatus = (typeof WAHA_SESSION_STATUSES)[number];

export const WAHA_SESSION_STATUS_LABELS: Record<WahaSessionStatus, string> = {
  NOT_CREATED: 'Belum ditautkan',
  STOPPED: 'Berhenti',
  STARTING: 'Memulai…',
  SCAN_QR_CODE: 'Menunggu pindai QR',
  WORKING: 'Terhubung',
  FAILED: 'Gagal',
  UNREACHABLE: 'WAHA tidak terjangkau',
  UNAUTHORIZED: 'Kunci API WAHA ditolak',
  NOT_CONFIGURED: 'Belum dikonfigurasi',
  WAHA_ERROR: 'WAHA bermasalah',
};

export const WHATSAPP_MESSAGE_STATUS_LABELS = {
  RECEIVED: 'Diterima',
  SENDING: 'Mengirim…',
  SENT: 'Terkirim',
  DELIVERED: 'Sampai',
  READ: 'Dibaca',
  FAILED: 'Gagal',
} as const;

export const whatsappSendSchema = z.object({
  text: z.string().trim().min(1, 'Pesan wajib diisi').max(WHATSAPP_MAX_MESSAGE_LENGTH),
  /** Dibuat dashboard per niat kirim; mengirim ulang dengan nilai sama tidak menggandakan pesan. */
  clientMessageId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
});
export type WhatsappSendInput = z.infer<typeof whatsappSendSchema>;

export const WHATSAPP_MAX_LABEL_LENGTH = 40;

/** Nama bebas untuk membedakan nomor milik satu user, mis. "CS 1". */
export const whatsappNumberSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Nama nomor wajib diisi')
    .max(WHATSAPP_MAX_LABEL_LENGTH, `Maksimal ${WHATSAPP_MAX_LABEL_LENGTH} karakter`),
});
export type WhatsappNumberInput = z.infer<typeof whatsappNumberSchema>;

/** Memulai chat dengan nomor/kontak. Nomor dinormalisasi di server (0812…, +62812…, 62812… sama saja). */
export const whatsappStartChatSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(8, 'Nomor terlalu pendek')
    .max(24, 'Nomor terlalu panjang')
    .regex(/^\+?[\d\s().-]+$/, 'Nomor hanya boleh berisi angka'),
  /** Nama kontak untuk tampilan; opsional */
  name: z.string().trim().max(100).optional(),
});
export type WhatsappStartChatInput = z.infer<typeof whatsappStartChatSchema>;

export const whatsappContactsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  /** Hanya kontak yang tersimpan di buku kontak ponsel (bukan sekadar nama profil) */
  savedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const whatsappChatsQuerySchema = z.object({
  /** Hanya chat di nomor ini */
  sessionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().trim().max(100).optional(),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type WhatsappChatsQuery = z.output<typeof whatsappChatsQuerySchema>;

const OPT_OUT_PHRASES = new Set([
  'stop',
  'berhenti',
  'unsubscribe',
  'jangan kirim lagi',
  'jangan kirim pesan lagi',
  'jangan hubungi lagi',
  'hentikan',
  'cukup',
]);

/**
 * True bila seluruh pesan adalah permintaan berhenti (tanpa tanda baca).
 * Hanya pesan utuh yang dihitung: "kapan harus stop loss?" bukan permintaan berhenti.
 */
export function isOptOutMessage(text: string): boolean {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return OPT_OUT_PHRASES.has(cleaned);
}

/** ID pesan WAHA bisa berbentuk `true_628…@c.us_3EB0…`; sendText hanya mengembalikan bagian terakhir. */
export function shortWhatsappMessageId(id: string): string {
  const i = id.lastIndexOf('_');
  return i === -1 ? id : id.slice(i + 1);
}

/** Digit nomor dari JID `6281…@c.us`; null untuk `@lid` atau bentuk lain. */
export function phoneFromJid(jid: string): string | null {
  const m = /^(\d{7,20})@c\.us$/.exec(jid);
  return m ? m[1] : null;
}

/** `6281234567890` -> `+62•••••••7890`. Cukup untuk mengenali nomor tanpa membukanya seluruhnya. */
export function maskPhone(digits: string | null | undefined): string | null {
  const d = (digits ?? '').replace(/\D/g, '');
  if (d.length < 8) return null;
  return `+${d.slice(0, 2)}${'•'.repeat(d.length - 6)}${d.slice(-4)}`;
}

export const WHATSAPP_BROADCAST_MAX_MESSAGE = 1000;

/** Placeholder di luar {{nama}} (mis. salah ketik {{name}}) dilaporkan, bukan dikirim apa adanya. */
export function unknownBroadcastPlaceholders(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)]
    .map((m) => m[1])
    .filter((n) => n !== 'nama');
}

/** `{{nama}}` diganti nama penerima; tanpa nama dipakai sapaan netral "kak". */
export function renderBroadcastMessage(template: string, name?: string | null): string {
  return template.replace(/\{\{\s*nama\s*\}\}/g, name?.trim() || 'kak');
}

export const whatsappBroadcastSchema = z.object({
  sessionId: z.string().uuid(),
  name: z.string().trim().min(1, 'Nama blast wajib diisi').max(80),
  message: z
    .string()
    .trim()
    .min(5, 'Pesan terlalu pendek')
    .max(WHATSAPP_BROADCAST_MAX_MESSAGE)
    .refine((m) => unknownBroadcastPlaceholders(m).length === 0, {
      message: 'Hanya {{nama}} yang dikenali sebagai variabel',
    }),
  recipients: z
    .array(
      z.object({
        phone: z
          .string()
          .trim()
          .min(8, 'Nomor terlalu pendek')
          .max(24)
          .regex(/^\+?[\d\s().-]+$/, 'Nomor hanya boleh berisi angka'),
        name: z.string().trim().max(100).optional(),
      }),
    )
    .min(1, 'Tambahkan minimal satu penerima')
    .max(200),
  /** Pemilik mengonfirmasi semua penerima mengenalnya dan setuju dihubungi */
  consent: z.boolean().refine((v) => v === true, {
    message: 'Konfirmasi bahwa semua penerima mengenal Anda dan setuju dihubungi wajib dicentang',
  }),
});
export type WhatsappBroadcastInput = z.infer<typeof whatsappBroadcastSchema>;
