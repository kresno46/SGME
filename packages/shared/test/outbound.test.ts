import { describe, expect, it } from 'vitest';
import {
  canTransition,
  checkFollowUpAllowed,
  checkOutreachEligibility,
  computeLeadPriority,
  createCampaignSchema,
  createLeadSchema,
  findUnknownPlaceholders,
  listLeadsQuerySchema,
  renderTemplate,
  taskActionSchema,
  templateSchema,
  type EligibilityInput,
} from '../src';

const base: EligibilityInput = {
  status: 'NEW',
  doNotContact: false,
  onBlocklist: false,
  deleted: false,
  hasOpenTask: false,
  channel: 'TIKTOK_DM',
  hasContactForChannel: true,
  hasConsentForChannel: false,
};

describe('state machine tugas outbound', () => {
  it('tidak bisa langsung DRAFT → MANUALLY_SENT tanpa review', () => {
    expect(canTransition('DRAFT', 'MANUALLY_SENT')).toBe(false);
    expect(canTransition('DRAFT', 'WAITING_REVIEW')).toBe(true);
    expect(canTransition('APPROVED', 'MANUALLY_SENT')).toBe(true);
  });

  it('status akhir tidak dapat diubah', () => {
    expect(canTransition('COMPLETED', 'DRAFT')).toBe(false);
    expect(canTransition('CANCELLED', 'WAITING_REVIEW')).toBe(false);
  });
});

describe('kelayakan penjangkauan', () => {
  it('DM TikTok manual diizinkan untuk prospek sah tanpa larangan', () => {
    expect(checkOutreachEligibility(base)).toEqual({ eligible: true });
  });

  it('WhatsApp/email wajib memiliki izin komunikasi', () => {
    const r = checkOutreachEligibility({ ...base, channel: 'WHATSAPP' });
    expect(r.eligible).toBe(false);
    expect(
      checkOutreachEligibility({ ...base, channel: 'WHATSAPP', hasConsentForChannel: true })
        .eligible,
    ).toBe(true);
  });

  it('menolak prospek DNC, terdaftar, atau yang sudah punya tugas', () => {
    expect(checkOutreachEligibility({ ...base, onBlocklist: true }).eligible).toBe(false);
    expect(checkOutreachEligibility({ ...base, status: 'REGISTERED' }).eligible).toBe(false);
    expect(checkOutreachEligibility({ ...base, hasOpenTask: true }).eligible).toBe(false);
    expect(checkOutreachEligibility({ ...base, hasContactForChannel: false }).eligible).toBe(false);
  });

  it('follow-up tanpa balasan hanya dengan izin dan dibatasi jumlahnya', () => {
    expect(
      checkFollowUpAllowed({ replied: true, hasConsentForChannel: false, sentCount: 5 }).eligible,
    ).toBe(true);
    expect(
      checkFollowUpAllowed({ replied: false, hasConsentForChannel: false, sentCount: 1 }).eligible,
    ).toBe(false);
    expect(
      checkFollowUpAllowed({ replied: false, hasConsentForChannel: true, sentCount: 1 }).eligible,
    ).toBe(true);
    expect(
      checkFollowUpAllowed({ replied: false, hasConsentForChannel: true, sentCount: 2 }).eligible,
    ).toBe(false);
  });
  it('allows TikTok follow-ups without recorded replies while other channels require consent', () => {
    expect(
      checkFollowUpAllowed({
        channel: 'TIKTOK_DM',
        replied: false,
        hasConsentForChannel: false,
        sentCount: 1,
      }).eligible,
    ).toBe(true);
    expect(
      checkFollowUpAllowed({
        channel: 'TIKTOK_DM',
        replied: false,
        hasConsentForChannel: false,
        sentCount: 10,
      }).eligible,
    ).toBe(true);
    expect(
      checkFollowUpAllowed({
        channel: 'EMAIL',
        replied: false,
        hasConsentForChannel: false,
        sentCount: 1,
      }).eligible,
    ).toBe(false);
  });
});

describe('prioritas prospek', () => {
  const now = new Date('2026-10-15T10:00:00Z');
  it('prospek hangat & tertarik lebih tinggi dari prospek dingin', () => {
    const warm = computeLeadPriority(
      {
        status: 'INTERESTED',
        interestLevel: 'HIGH',
        source: 'TIKTOK_LEAD_GEN',
        score: 0,
        hasAnyConsent: true,
        createdAt: now,
        lastContactedAt: null,
      },
      now,
    );
    const cold = computeLeadPriority(
      {
        status: 'NEW',
        interestLevel: 'UNKNOWN',
        source: 'IMPORT',
        score: 0,
        hasAnyConsent: false,
        createdAt: '2026-01-01',
        lastContactedAt: null,
      },
      now,
    );
    expect(warm.score).toBeGreaterThan(cold.score);
    expect(warm.reasons).toContain('Memiliki izin komunikasi');
    expect(warm.score).toBeLessThanOrEqual(100);
  });

  it('menurunkan prioritas prospek yang baru saja dihubungi', () => {
    const p = computeLeadPriority(
      {
        status: 'NEW',
        interestLevel: 'UNKNOWN',
        source: 'MANUAL',
        score: 0,
        hasAnyConsent: false,
        createdAt: '2026-01-01',
        lastContactedAt: '2026-10-15T08:00:00Z',
      },
      now,
    );
    expect(p.reasons).toContain('Baru saja dihubungi');
    expect(p.score).toBe(0);
  });
});

describe('template pesan', () => {
  it('mengganti placeholder dan memberi sapaan default', () => {
    expect(
      renderTemplate('Halo {{nama}}, salam dari @{{akun}}', { nama: null, akun: 'solidmini' }),
    ).toBe('Halo Kak, salam dari @solidmini');
    expect(renderTemplate('Hai {{ nama }}!', { nama: 'Budi' })).toBe('Hai Budi!');
  });

  it('menampilkan URL literal tanpa kurung kurawal dan tetap mengganti nama', () => {
    expect(
      renderTemplate('Hai {{nama}}, lihat {{https://www.sg-berjangka.com/id}}', { nama: 'Sarah' }),
    ).toBe('Hai Sarah, lihat https://www.sg-berjangka.com/id');
    expect(renderTemplate('Link {https://example.com/path?a=1&b=2}', {})).toBe(
      'Link https://example.com/path?a=1&b=2',
    );
    expect(findUnknownPlaceholders('Hai {{nama}} {{https://example.com/id}}')).toEqual([]);
    expect(findUnknownPlaceholders('Halo {{nama salah}}')).toEqual(['nama salah']);
  });

  it('mendeteksi placeholder tidak dikenal', () => {
    expect(findUnknownPlaceholders('Halo {{nama}} {{diskon}}')).toEqual(['diskon']);
    expect(
      templateSchema.safeParse({
        name: 'Uji',
        purpose: 'INTRODUCTION',
        content: 'Halo {{bonus}} ya',
      }).success,
    ).toBe(false);
  });
});

describe('skema Fase 2', () => {
  it('prospek wajib punya minimal satu kontak', () => {
    expect(createLeadSchema.safeParse({ name: 'Tanpa kontak', source: 'MANUAL' }).success).toBe(
      false,
    );
    const ok = createLeadSchema.parse({ name: 'Budi', phone: '0812 3456 7890', source: 'MANUAL' });
    expect(ok.tags).toEqual([]);
  });

  it('izin komunikasi wajib menyertakan bukti', () => {
    const r = createLeadSchema.safeParse({
      email: 'a@b.co',
      source: 'LANDING_PAGE',
      consents: [{ channel: 'EMAIL', source: 'LANDING_PAGE', evidence: '' }],
    });
    expect(r.success).toBe(false);
  });

  it('campaign: tanggal selesai tidak boleh sebelum tanggal mulai', () => {
    const r = createCampaignSchema.safeParse({
      name: 'Campaign Uji',
      lane: 'OFFICIAL',
      type: 'REGISTRATION',
      startDate: '2026-10-20',
      endDate: '2026-10-10',
    });
    expect(r.success).toBe(false);
  });

  it('campaign: anggaran kosong = tidak ada anggaran (bukan Rp0)', () => {
    const base = { name: 'Campaign Uji', lane: 'OFFICIAL', type: 'REGISTRATION' } as const;
    expect(createCampaignSchema.parse({ ...base, budget: '' }).budget).toBeNull();
    expect(createCampaignSchema.parse({ ...base, budget: '1500000' }).budget).toBe(1500000);
  });

  it('filter status prospek menerima beberapa nilai dipisah koma', () => {
    expect(listLeadsQuerySchema.parse({ status: 'NEW,INTERESTED' }).status).toEqual([
      'NEW',
      'INTERESTED',
    ]);
    expect(listLeadsQuerySchema.safeParse({ status: 'NGAWUR' }).success).toBe(false);
  });

  it('follow-up bisa disiapkan tanpa tanggal', () => {
    const result = taskActionSchema.parse({
      action: 'schedule_follow_up',
      draftMessage: 'Halo lagi, boleh kirim info?',
    });
    expect(result.action).toBe('schedule_follow_up');
    if (result.action === 'schedule_follow_up') expect(result.followUpAt).toBeNull();
  });

  it('tandai terkirim wajib dengan konfirmasi eksplisit', () => {
    expect(taskActionSchema.safeParse({ action: 'mark_sent' }).success).toBe(false);
    expect(taskActionSchema.safeParse({ action: 'mark_sent', confirmed: false }).success).toBe(
      false,
    );
    expect(taskActionSchema.safeParse({ action: 'mark_sent', confirmed: true }).success).toBe(true);
  });
});
