import { createHmac } from 'node:crypto';
import {
  deriveWebhookSecret,
  isSessionKey,
  newSessionName,
  verifyWahaSignature,
} from './waha-signature';

const MASTER = 'm'.repeat(40);

describe('waha-signature', () => {
  it('membentuk nama sesi dari seluruh UUID user plus akhiran acak yang berbeda per nomor', () => {
    const id = '0F8FAD5B-D9CB-469F-A165-70867728950E';
    const a = newSessionName(id);
    const b = newSessionName(id);
    expect(a).toMatch(/^u-0f8fad5bd9cb469fa16570867728950e-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it('mode satu sesi memakai nama tetap', () => {
    expect(newSessionName('0F8FAD5B-D9CB-469F-A165-70867728950E', 'default')).toBe('default');
  });

  it('hanya mengenali kunci URL dengan karakter aman', () => {
    expect(isSessionKey('default')).toBe(true);
    expect(isSessionKey('u-' + 'a'.repeat(32) + '-0123abcd')).toBe(true);
    expect(isSessionKey('../etc')).toBe(false);
    expect(isSessionKey('a b')).toBe(false);
    expect(isSessionKey('')).toBe(false);
  });

  it('menurunkan secret berbeda per sesi dan menolak masukan lemah', () => {
    const a = deriveWebhookSecret(MASTER, 'u-' + 'a'.repeat(32) + '-00000001');
    const b = deriveWebhookSecret(MASTER, 'u-' + 'a'.repeat(32) + '-00000002');
    expect(a).toHaveLength(64);
    expect(a).not.toBe(b);
    expect(() => deriveWebhookSecret('pendek', 'default')).toThrow();
    expect(() => deriveWebhookSecret(MASTER, 'nama dengan spasi')).toThrow();
  });

  it('memverifikasi HMAC-SHA512 atas body mentah', () => {
    const body = Buffer.from('{"event":"message"}');
    const sig = createHmac('sha512', 's3cret').update(body).digest('hex');
    expect(verifyWahaSignature(body, sig, 's3cret')).toBe(true);
    expect(verifyWahaSignature(body, `sha512=${sig.toUpperCase()}`, 's3cret')).toBe(true);
    expect(verifyWahaSignature(body, sig, 'lain')).toBe(false);
    expect(verifyWahaSignature(Buffer.from('{"event":"x"}'), sig, 's3cret')).toBe(false);
    expect(verifyWahaSignature(body, undefined, 's3cret')).toBe(false);
    expect(verifyWahaSignature(body, 'abcd', 's3cret')).toBe(false);
    expect(verifyWahaSignature(undefined, sig, 's3cret')).toBe(false);
  });
});
