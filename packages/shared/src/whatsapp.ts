import { z } from 'zod';
import { normalizePhone } from './normalize';

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

const cleanOptOut = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * True bila seluruh pesan adalah permintaan berhenti (tanpa tanda baca).
 * Hanya pesan utuh yang dihitung: "kapan harus stop loss?" bukan permintaan berhenti.
 */
export function isOptOutMessage(text: string): boolean {
  return OPT_OUT_PHRASES.has(cleanOptOut(text));
}

/** Frasa yang bisa bermakna lain ("cukup", "hentikan"): cukup untuk memblokir balasan, belum untuk larangan permanen. */
const AMBIGUOUS_OPT_OUT = new Set(['cukup', 'hentikan']);

/** Permintaan berhenti yang tidak ambigu; hanya ini yang otomatis masuk daftar larangan kontak. */
export function isExplicitOptOut(text: string): boolean {
  const cleaned = cleanOptOut(text);
  return OPT_OUT_PHRASES.has(cleaned) && !AMBIGUOUS_OPT_OUT.has(cleaned);
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

/** Nomor per permintaan cek; dashboard membagi daftar lebih panjang jadi beberapa permintaan. */
export const WHATSAPP_CHECK_BATCH = 20;

export const whatsappCheckNumbersSchema = z.object({
  phones: z
    .array(
      z
        .string()
        .trim()
        .min(8, 'Nomor terlalu pendek')
        .max(24)
        .regex(/^\+?[\d\s().-]+$/, 'Nomor hanya boleh berisi angka'),
    )
    .min(1)
    .max(WHATSAPP_CHECK_BATCH),
});
export type WhatsappCheckNumbersInput = z.infer<typeof whatsappCheckNumbersSchema>;

export const WHATSAPP_BROADCAST_MAX_MESSAGE = 1000;

/** Batas teks (caption) pesan yang membawa lampiran; WhatsApp memotong/menolak yang lebih panjang. */
export const WHATSAPP_CAPTION_MAX_LENGTH = 1024;

/**
 * Lampiran yang didukung. Gambar hanya JPEG karena WAHA mewajibkan JPEG untuk sendImage dan tidak mengonversi;
 * PDF dikirim sebagai dokumen. Ukuran diperiksa sesudah tipe dikenali dari isi file.
 */
export const BROADCAST_ATTACHMENT_TYPES = {
  'image/jpeg': { kind: 'image', label: 'JPEG', ext: 'jpg', maxBytes: 5 * 1024 * 1024 },
  'application/pdf': { kind: 'document', label: 'PDF', ext: 'pdf', maxBytes: 10 * 1024 * 1024 },
} as const;
export type BroadcastAttachmentMime = keyof typeof BROADCAST_ATTACHMENT_TYPES;
export const BROADCAST_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** Tipe dari isi file (bukan nama atau tipe kiriman klien): JPEG dimulai FF D8 FF, PDF dimulai "%PDF-". */
export function detectAttachmentMime(bytes: Uint8Array): BroadcastAttachmentMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-')
    return 'application/pdf';
  return null;
}

/** Nama variabel dari kolom file: huruf kecil, angka, garis bawah; diawali huruf. `nama` dipakai nama penerima. */
export const BROADCAST_VAR_KEY = /^[a-z][a-z0-9_]{0,29}$/;
export const BROADCAST_MAX_VARS = 10;
export const BROADCAST_VAR_MAX_LENGTH = 200;

export type BroadcastVars = Record<string, string>;

const PLACEHOLDER = /\{\{\s*([^}]*?)\s*\}\}/g;

/** Semua isi `{{...}}` di template, unik, termasuk `nama`. */
export function broadcastPlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** Variabel yang dipakai template selain `nama` (yang berasal dari kolom file). */
export function broadcastUsedVars(template: string): string[] {
  return broadcastPlaceholders(template).filter((n) => n !== 'nama');
}

/** Placeholder yang bukan {{nama}} dan bukan salah satu variabel yang tersedia (mis. salah ketik {{name}}). */
export function unknownBroadcastPlaceholders(
  template: string,
  available: Iterable<string> = [],
): string[] {
  const ok = new Set(available);
  return broadcastUsedVars(template).filter((n) => !ok.has(n));
}

/** `{{nama}}` diganti nama penerima (sapaan netral "kak" bila kosong); `{{kunci}}` diambil dari variabel penerima. */
export function renderBroadcastMessage(
  template: string,
  name?: string | null,
  vars?: BroadcastVars | null,
): string {
  return template.replace(PLACEHOLDER, (whole, key: string) =>
    key === 'nama' ? name?.trim() || 'kak' : (vars?.[key] ?? whole),
  );
}

/**
 * Masalah template terhadap daftar penerima, dalam bahasa pengguna: variabel yang tidak ada di data mana pun,
 * penerima yang nilainya kosong (pesan tidak boleh terkirim dengan `{{kota}}` mentah atau celah), dan hasil render
 * yang melewati batas panjang pesan WhatsApp. Dipakai server (schema) dan dashboard (pratinjau) supaya sama.
 */
export function broadcastTemplateProblems(
  template: string,
  recipients: Array<{ name?: string; vars?: BroadcastVars }>,
  maxLength = WHATSAPP_MAX_MESSAGE_LENGTH,
): string[] {
  const problems: string[] = [];
  const available = new Set(recipients.flatMap((r) => Object.keys(r.vars ?? {})));
  const unknown = unknownBroadcastPlaceholders(template, available);
  if (unknown.length > 0)
    problems.push(
      `Variabel tidak dikenal: ${unknown.map((u) => `{{${u}}}`).join(', ')}. Yang tersedia: {{nama}}${[
        ...available,
      ]
        .map((v) => `, {{${v}}}`)
        .join('')}`,
    );
  for (const key of broadcastUsedVars(template).filter((k) => available.has(k))) {
    const missing = recipients.filter((r) => !r.vars?.[key]?.trim()).length;
    if (missing > 0) problems.push(`${missing} penerima tidak punya nilai untuk {{${key}}}`);
  }
  if (
    problems.length === 0 &&
    recipients.some((r) => renderBroadcastMessage(template, r.name, r.vars).length > maxLength)
  )
    problems.push(`Pesan hasil variabel melebihi ${maxLength} karakter`);
  return problems;
}

const BROADCAST_REASON_TEXT: Record<string, string> = {
  dnc: 'Ada di daftar larangan kontak',
  opt_out: 'Pernah minta berhenti',
  not_registered: 'Tidak terdaftar di WhatsApp',
  self: 'Nomor Anda sendiri',
  cancelled: 'Dibatalkan',
};

/** Alasan penerima dilewati/gagal dalam bahasa pengguna; dipakai tampilan dan laporan unduhan. */
export function broadcastReasonText(reason: string | null): string {
  if (!reason) return '';
  if (BROADCAST_REASON_TEXT[reason]) return BROADCAST_REASON_TEXT[reason];
  if (reason === 'send_failed:timeout' || reason === 'send_failed:response_without_message_id')
    return 'Waktu habis, status tidak pasti: periksa ponsel sebelum mengirim ulang';
  return `Gagal kirim (${reason.replace('send_failed:', '')})`;
}

/** Baris file penerima yang dibaca; lebih banyak dari ini ditolak, bukan dipotong diam-diam. */
export const RECIPIENT_FILE_MAX_ROWS = 1000;

const PHONE_HEADER =
  /(^|_)(nomor|no_?hp|no_?wa|hp|telepon|telp|phone|whatsapp|wa|number|mobile)(_|$)/;
const NAME_HEADERS = new Set(['nama', 'name', 'nama_lengkap', 'full_name']);

const looksLikePhone = (s: string) =>
  /^\+?[\d\s().-]+$/.test(s) && (normalizePhone(s)?.length ?? 0) >= 8;
const headerKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '_');
/** Header kolom jadi nama variabel yang sah, atau null bila tidak bisa (kosong, diawali angka, "nama"). */
const varKey = (header: string) => {
  const k = header.replace(/[^a-z0-9_]/g, '');
  return BROADCAST_VAR_KEY.test(k) && k !== 'nama' ? k : null;
};

export interface ExtractedRecipient {
  phone: string;
  name?: string;
  vars?: BroadcastVars;
}

/**
 * Mengambil penerima dari baris tabel (CSV/Excel). Baris pertama dianggap header bila tidak ada sel yang
 * berbentuk nomor; kolom nomor dan nama lalu dicari lewat nama header. Tanpa header (atau kolom tidak
 * dikenali), nomor = sel pertama yang berbentuk nomor dan nama = sel terisi lainnya.
 * Dengan header, kolom lain (maks. BROADCAST_MAX_VARS) menjadi variabel pesan bernama sesuai headernya,
 * mis. kolom "Kota" menjadi {{kota}}. Baris tanpa nilai untuk suatu kolom tidak memiliki variabel itu.
 */
export function extractRecipients(rows: string[][]): {
  recipients: ExtractedRecipient[];
  invalid: number;
  variables: string[];
} {
  const cleaned = rows.map((r) => r.map((c) => (c ?? '').trim())).filter((r) => r.some(Boolean));
  const hasHeader = cleaned.length > 0 && !cleaned[0].some(looksLikePhone);
  const header = hasHeader ? cleaned[0].map(headerKey) : [];
  const phoneCol = header.findIndex((h) => PHONE_HEADER.test(h));
  const nameCol = header.findIndex((h) => NAME_HEADERS.has(h));

  const varCols: Array<{ col: number; key: string }> = [];
  if (hasHeader)
    header.forEach((h, col) => {
      const key = varKey(h);
      if (
        col !== phoneCol &&
        col !== nameCol &&
        key &&
        varCols.length < BROADCAST_MAX_VARS &&
        !varCols.some((v) => v.key === key)
      )
        varCols.push({ col, key });
    });

  const recipients: ExtractedRecipient[] = [];
  let invalid = 0;
  for (const row of hasHeader ? cleaned.slice(1) : cleaned) {
    // Kolom bernama dipakai bila isinya nomor; kalau tidak (mis. "nomor urut"), cari di sel lain pada baris itu.
    const phone = looksLikePhone(row[phoneCol] ?? '') ? row[phoneCol] : row.find(looksLikePhone);
    if (!phone) {
      invalid++;
      continue;
    }
    const name = (nameCol >= 0 ? row[nameCol] : row.find((c) => c && c !== phone))?.slice(0, 100);
    const vars: BroadcastVars = {};
    for (const { col, key } of varCols)
      if (row[col]) vars[key] = row[col].slice(0, BROADCAST_VAR_MAX_LENGTH);
    recipients.push({
      phone,
      ...(name ? { name } : {}),
      ...(Object.keys(vars).length > 0 ? { vars } : {}),
    });
  }
  return { recipients, invalid, variables: varCols.map((v) => v.key) };
}

export const whatsappBroadcastSchema = z
  .object({
    sessionId: z.string().uuid(),
    name: z.string().trim().min(1, 'Nama blast wajib diisi').max(80),
    message: z.string().trim().min(5, 'Pesan terlalu pendek').max(WHATSAPP_BROADCAST_MAX_MESSAGE),
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
          vars: z
            .record(
              z.string().regex(BROADCAST_VAR_KEY),
              z.string().trim().max(BROADCAST_VAR_MAX_LENGTH),
            )
            .refine((v) => Object.keys(v).length <= BROADCAST_MAX_VARS, {
              message: `Maksimal ${BROADCAST_MAX_VARS} variabel per penerima`,
            })
            .optional(),
        }),
      )
      .min(1, 'Tambahkan minimal satu penerima')
      .max(200),
    /** Lampiran yang diunggah lewat /broadcasts/attachments; dikirim bersama pesan sebagai caption. */
    attachmentId: z.string().uuid().optional(),
    /** Pemilik mengonfirmasi semua penerima mengenalnya dan setuju dihubungi */
    consent: z.boolean().refine((v) => v === true, {
      message: 'Konfirmasi bahwa semua penerima mengenal Anda dan setuju dihubungi wajib dicentang',
    }),
  })
  .superRefine((v, ctx) => {
    const limit = v.attachmentId ? WHATSAPP_CAPTION_MAX_LENGTH : WHATSAPP_MAX_MESSAGE_LENGTH;
    for (const message of broadcastTemplateProblems(v.message, v.recipients, limit))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['message'], message });
  });
export type WhatsappBroadcastInput = z.infer<typeof whatsappBroadcastSchema>;
