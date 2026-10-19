import { createHmac } from 'node:crypto';
import { attribute, percent, ratio } from './attribution';
import { verifyConversionSignature } from './conversions.service';
import { generateLinkCode } from './tracking.service';

const d = (s: string) => new Date(s);

describe('atribusi first/last-touch', () => {
  const conv = d('2026-10-20T10:00:00Z');

  it('memilih touchpoint paling awal & paling akhir dalam jendela', () => {
    const r = attribute(
      [
        { campaignId: 'B', at: d('2026-10-10T00:00:00Z'), kind: 'lead_source' },
        { campaignId: 'A', at: d('2026-10-18T00:00:00Z'), kind: 'click' },
        { campaignId: 'C', at: d('2026-10-15T00:00:00Z'), kind: 'click' },
      ],
      conv,
      30,
    );
    expect(r.firstTouch?.campaignId).toBe('B');
    expect(r.lastTouch?.campaignId).toBe('A');
  });

  it('mengabaikan touchpoint di luar jendela atau setelah konversi', () => {
    const r = attribute(
      [
        { campaignId: 'LAMA', at: d('2026-08-01T00:00:00Z'), kind: 'click' },
        { campaignId: 'SESUDAH', at: d('2026-10-21T00:00:00Z'), kind: 'click' },
      ],
      conv,
      30,
    );
    expect(r).toEqual({ firstTouch: null, lastTouch: null });
  });

  it('metrik biaya: kosong bila biaya belum diisi atau pembagi nol', () => {
    expect(ratio(300_000, 3)).toBe(100_000);
    expect(ratio(0, 3)).toBeNull();
    expect(ratio(300_000, 0)).toBeNull();
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(1, 0)).toBeNull();
  });
});

describe('verifyConversionSignature', () => {
  const secret = 'x'.repeat(40);
  const body = '{"eventId":"e1"}';
  const now = 1_800_000_000;
  const sig = (t: number, b = body, s = secret) =>
    createHmac('sha256', s).update(`${t}.${b}`).digest('hex');

  it('menerima signature valid', () => {
    expect(verifyConversionSignature(String(now), sig(now), body, secret, now)).toEqual({
      ok: true,
    });
  });

  it('menolak header hilang, signature salah, body diubah, dan timestamp kedaluwarsa', () => {
    expect(verifyConversionSignature(undefined, sig(now), body, secret, now).ok).toBe(false);
    expect(
      verifyConversionSignature(String(now), sig(now, body, 'lain'.repeat(10)), body, secret, now)
        .ok,
    ).toBe(false);
    expect(verifyConversionSignature(String(now), sig(now), body + ' ', secret, now).ok).toBe(
      false,
    );
    expect(verifyConversionSignature(String(now - 600), sig(now - 600), body, secret, now).ok).toBe(
      false,
    );
    expect(verifyConversionSignature(String(now), 'bukan-hex', body, secret, now).ok).toBe(false);
  });
});

describe('kode link', () => {
  it('pendek, tanpa karakter ambigu', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateLinkCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[a-km-np-z2-9]{7}$/);
  });
});
