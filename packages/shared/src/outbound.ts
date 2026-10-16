import type {
  ContactChannel,
  InterestLevel,
  LeadSource,
  LeadStatus,
  OutreachTaskStatus,
} from './enums';

/**
 * Aturan bisnis Outbound Workstation (Jalur B).
 * Prinsip: penjangkauan personal yang ditinjau manusia — bukan pengiriman massal.
 */

/** Transisi status tugas yang diizinkan. Status lain ditolak oleh API. */
export const OUTREACH_TRANSITIONS: Record<OutreachTaskStatus, OutreachTaskStatus[]> = {
  DRAFT: ['WAITING_REVIEW', 'CANCELLED'],
  WAITING_REVIEW: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['MANUALLY_SENT', 'DRAFT', 'CANCELLED'],
  MANUALLY_SENT: ['REPLIED', 'FOLLOW_UP', 'COMPLETED'],
  REPLIED: ['FOLLOW_UP', 'COMPLETED'],
  FOLLOW_UP: ['MANUALLY_SENT', 'REPLIED', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: OutreachTaskStatus, to: OutreachTaskStatus): boolean {
  return OUTREACH_TRANSITIONS[from].includes(to);
}

/** Status tugas yang masih berjalan (satu prospek hanya boleh punya satu tugas terbuka). */
export const OPEN_OUTREACH_STATUSES: OutreachTaskStatus[] = [
  'DRAFT',
  'WAITING_REVIEW',
  'APPROVED',
  'MANUALLY_SENT',
  'REPLIED',
  'FOLLOW_UP',
];

/** Prospek dengan status ini tidak masuk antrean outbound. */
export const NON_CONTACTABLE_LEAD_STATUSES: LeadStatus[] = [
  'NOT_INTERESTED',
  'DO_NOT_CONTACT',
  'REGISTERED',
  'ACTIVE',
];

/** Maksimum pesan tanpa balasan dalam satu tugas (pesan awal + 1 follow-up). */
export const MAX_UNANSWERED_MESSAGES = 2;

/** Batas default tugas baru per akun per hari — menjaga penjangkauan tetap personal. */
export const DEFAULT_DAILY_TASK_LIMIT_PER_ACCOUNT = 30;

export interface EligibilityInput {
  status: LeadStatus;
  doNotContact: boolean;
  onBlocklist: boolean;
  deleted: boolean;
  hasOpenTask: boolean;
  channel: ContactChannel;
  hasContactForChannel: boolean;
  hasConsentForChannel: boolean;
}

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string };

/**
 * Menentukan apakah prospek boleh dibuatkan tugas penjangkauan.
 * - DM TikTok manual (personal, ditinjau, dikirim manusia) boleh untuk prospek yang diperoleh secara sah.
 * - Kanal lain (WhatsApp, email, telepon, SMS) WAJIB memiliki izin komunikasi yang masih berlaku.
 */
export function checkOutreachEligibility(i: EligibilityInput): EligibilityResult {
  if (i.deleted) return { eligible: false, reason: 'Prospek sudah dihapus' };
  if (i.doNotContact || i.onBlocklist || i.status === 'DO_NOT_CONTACT') {
    return { eligible: false, reason: 'Prospek ada di daftar larangan kontak' };
  }
  if (NON_CONTACTABLE_LEAD_STATUSES.includes(i.status)) {
    return { eligible: false, reason: 'Status prospek tidak memerlukan penjangkauan' };
  }
  if (i.hasOpenTask) return { eligible: false, reason: 'Prospek sudah memiliki tugas yang berjalan' };
  if (!i.hasContactForChannel) {
    return { eligible: false, reason: 'Prospek tidak memiliki kontak untuk kanal ini' };
  }
  if (i.channel !== 'TIKTOK_DM' && !i.hasConsentForChannel) {
    return { eligible: false, reason: 'Belum ada izin komunikasi untuk kanal ini' };
  }
  return { eligible: true };
}

/**
 * Follow-up hanya boleh bila prospek sudah membalas, atau sudah memberi izin untuk kanal tsb.
 * Tanpa balasan, jumlah pesan dibatasi MAX_UNANSWERED_MESSAGES.
 */
export function checkFollowUpAllowed(i: {
  replied: boolean;
  hasConsentForChannel: boolean;
  sentCount: number;
}): EligibilityResult {
  if (i.replied) return { eligible: true };
  if (!i.hasConsentForChannel) {
    return {
      eligible: false,
      reason: 'Follow-up tanpa balasan hanya boleh untuk prospek yang sudah memberi izin komunikasi',
    };
  }
  if (i.sentCount >= MAX_UNANSWERED_MESSAGES) {
    return {
      eligible: false,
      reason: `Sudah ${i.sentCount} pesan tanpa balasan. Hentikan penjangkauan agar tidak dianggap spam.`,
    };
  }
  return { eligible: true };
}

// ---------------------------------------------------------------- prioritas

export interface PriorityInput {
  status: LeadStatus;
  interestLevel: InterestLevel;
  source: LeadSource;
  score: number;
  hasAnyConsent: boolean;
  createdAt: Date | string;
  lastContactedAt: Date | string | null;
}

const INTEREST_POINTS: Record<InterestLevel, number> = { UNKNOWN: 0, LOW: 5, MEDIUM: 15, HIGH: 30 };
const STATUS_POINTS: Partial<Record<LeadStatus, number>> = {
  QUALIFIED: 25,
  INTERESTED: 20,
  RESPONDED: 15,
  NEW: 5,
};
/** Sumber yang menunjukkan inisiatif dari calon pengguna sendiri. */
const WARM_SOURCES: LeadSource[] = [
  'TIKTOK_LEAD_GEN',
  'TIKTOK_MESSAGING_ADS',
  'INBOUND_DM',
  'LANDING_PAGE',
  'REFERRAL',
];

/**
 * Skor prioritas berbasis aturan (0–100) beserta alasannya, agar operator memahami urutan antrean.
 * Pada Fase 3 skor AI (kolom `score`) ikut diperhitungkan.
 */
export function computeLeadPriority(
  i: PriorityInput,
  now: Date = new Date(),
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const interest = INTEREST_POINTS[i.interestLevel];
  if (interest) {
    score += interest;
    reasons.push(`Ketertarikan ${i.interestLevel === 'HIGH' ? 'tinggi' : i.interestLevel === 'MEDIUM' ? 'sedang' : 'rendah'}`);
  }
  const status = STATUS_POINTS[i.status] ?? 0;
  if (status >= 15) reasons.push('Sudah berinteraksi sebelumnya');
  score += status;

  if (WARM_SOURCES.includes(i.source)) {
    score += 15;
    reasons.push('Prospek datang atas inisiatif sendiri');
  }
  if (i.hasAnyConsent) {
    score += 10;
    reasons.push('Memiliki izin komunikasi');
  }

  const ageDays = (now.getTime() - new Date(i.createdAt).getTime()) / 86_400_000;
  if (ageDays <= 3) {
    score += 10;
    reasons.push('Prospek baru (≤ 3 hari)');
  }
  if (i.lastContactedAt) {
    const sinceContact = (now.getTime() - new Date(i.lastContactedAt).getTime()) / 86_400_000;
    if (sinceContact < 2) {
      score -= 20;
      reasons.push('Baru saja dihubungi');
    }
  }
  if (i.score > 0) score += Math.round(i.score * 0.1);

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// ---------------------------------------------------------------- template

export const TEMPLATE_PLACEHOLDERS = {
  nama: 'Nama prospek (atau "Kak" bila kosong)',
  username: 'Username TikTok prospek',
  akun: 'Username akun TikTok pengirim',
  campaign: 'Nama campaign',
  link: 'Link campaign / registrasi',
} as const;

export type TemplateVariables = Partial<Record<keyof typeof TEMPLATE_PLACEHOLDERS, string | null>>;

/** Mengganti {{placeholder}}; placeholder yang tidak dikenal dibiarkan apa adanya agar terlihat saat review. */
export function renderTemplate(content: string, vars: TemplateVariables): string {
  return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    if (!(key in TEMPLATE_PLACEHOLDERS)) return match;
    const v = vars[key as keyof TemplateVariables];
    if (key === 'nama') return v?.trim() || 'Kak';
    return v?.trim() || '';
  });
}

export function findUnknownPlaceholders(content: string): string[] {
  const found = [...content.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((k) => !(k in TEMPLATE_PLACEHOLDERS)))];
}
