import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  canManageRole,
  changePasswordSchema,
  createTikTokAccountSchema,
  normalizeEmail,
  normalizePhone,
  normalizeTikTokUsername,
  passwordSchema,
  updateTikTokAccountSchema,
} from '../src';

describe('normalisasi kontak', () => {
  it('menormalkan username TikTok', () => {
    expect(normalizeTikTokUsername('  @@Solid.Mini ')).toBe('solid.mini');
    expect(normalizeTikTokUsername('')).toBeNull();
    expect(normalizeTikTokUsername(undefined)).toBeNull();
  });

  it('menormalkan email', () => {
    expect(normalizeEmail(' User@Example.COM ')).toBe('user@example.com');
  });

  it('menormalkan nomor telepon Indonesia ke format 62', () => {
    expect(normalizePhone('0812-3456-7890')).toBe('6281234567890');
    expect(normalizePhone('+62 812 3456 7890')).toBe('6281234567890');
    expect(normalizePhone('812 3456 7890')).toBe('6281234567890');
    expect(normalizePhone('123')).toBeNull();
  });
});

describe('RBAC', () => {
  it('Viewer tidak memiliki permission tulis', () => {
    const viewer = DEFAULT_ROLE_PERMISSIONS.VIEWER;
    expect(viewer).toContain(PERMISSIONS.ACCOUNTS_READ);
    expect(viewer).not.toContain(PERMISSIONS.ACCOUNTS_MANAGE);
    expect(viewer).not.toContain(PERMISSIONS.USERS_MANAGE);
  });

  it('hanya Super Admin yang dapat mengelola pengaturan sistem', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN).toContain(PERMISSIONS.SETTINGS_MANAGE);
    expect(DEFAULT_ROLE_PERMISSIONS.ADMIN).not.toContain(PERMISSIONS.SETTINGS_MANAGE);
  });

  it('admin tidak dapat mengelola sesama admin atau super admin', () => {
    expect(canManageRole('ADMIN', 'MARKETING_OPERATOR')).toBe(true);
    expect(canManageRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canManageRole('ADMIN', 'SUPER_ADMIN')).toBe(false);
    expect(canManageRole('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(true);
  });
});

describe('validasi password', () => {
  it('menolak password lemah', () => {
    expect(passwordSchema.safeParse('pendek').success).toBe(false);
    expect(passwordSchema.safeParse('semuahurufkecil1').success).toBe(false);
    expect(passwordSchema.safeParse('TanpaAngkaSama').success).toBe(false);
  });

  it('menerima password kuat', () => {
    expect(passwordSchema.safeParse('Rahasia12345').success).toBe(true);
  });

  it('password baru harus berbeda', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'Rahasia12345',
      newPassword: 'Rahasia12345',
      confirmPassword: 'Rahasia12345',
    });
    expect(r.success).toBe(false);
  });
});

describe('skema akun TikTok', () => {
  it('menormalkan username dan menerapkan default', () => {
    const r = createTikTokAccountSchema.parse({
      username: '@Solid.Mini',
      displayName: 'Solid Mini',
      lane: 'OFFICIAL',
      followersCount: '1500',
      profileUrl: 'https://www.tiktok.com/@solid.mini',
    });
    expect(r.username).toBe('solid.mini');
    expect(r.followersCount).toBe(1500);
    expect(r.profileUrl).toBe('https://www.tiktok.com/@solid.mini');
    expect(r.status).toBe('ACTIVE');
  });

  it('menolak username tidak valid dan URL non-https', () => {
    expect(
      createTikTokAccountSchema.safeParse({
        username: 'nama dengan spasi',
        displayName: 'x',
        lane: 'OUTBOUND',
      }).success,
    ).toBe(false);
    expect(
      createTikTokAccountSchema.safeParse({
        username: 'valid_user',
        displayName: 'x',
        lane: 'OUTBOUND',
        profileUrl: 'http://tiktok.com/@valid_user',
      }).success,
    ).toBe(false);
  });

  it('mewajibkan URL profil dan menolak pengosongan saat update', () => {
    const base = { username: 'valid_user', displayName: 'Akun', lane: 'OUTBOUND' };
    for (const profileUrl of [undefined, null, '', '   ']) {
      expect(createTikTokAccountSchema.safeParse({ ...base, profileUrl }).success).toBe(false);
    }
    expect(updateTikTokAccountSchema.safeParse({ profileUrl: '' }).success).toBe(false);
    expect(updateTikTokAccountSchema.safeParse({ displayName: 'Baru' }).success).toBe(true);
  });

  it('update kosong ditolak', () => {
    expect(updateTikTokAccountSchema.safeParse({}).success).toBe(false);
  });
});
