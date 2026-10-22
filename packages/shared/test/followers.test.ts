import { describe, expect, it } from 'vitest';
import { FOLLOWER_BATCH_LIMIT, followerBatchSchema } from '../src';

const batch = {
  format: 'smge-followers-v1',
  accountUsername: '@Solid.Mini',
  collectedAt: '2026-10-19T10:00:00.000Z',
  stopReason: 'Operator berhenti',
  followers: [{ username: '@Calon_1', displayName: 'Calon' }],
};

describe('file followers browser', () => {
  it('menormalkan akun dan username sebelum pengecekan duplikat', () => {
    const parsed = followerBatchSchema.parse(batch);
    expect(parsed.accountUsername).toBe('solid.mini');
    expect(parsed.followers[0].username).toBe('calon_1');
  });
  it('menolak identitas rusak, file kosong, dan batch berlebih', () => {
    expect(
      followerBatchSchema.safeParse({
        ...batch,
        followers: [{ username: 'https://evil.example/@foo' }],
      }).success,
    ).toBe(false);
    expect(followerBatchSchema.safeParse({ ...batch, followers: [] }).success).toBe(false);
    expect(
      followerBatchSchema.safeParse({
        ...batch,
        followers: Array.from({ length: FOLLOWER_BATCH_LIMIT + 1 }, (_, i) => ({
          username: `calon_${i}`,
        })),
      }).success,
    ).toBe(false);
  });
  it('tidak menerima status izin atau data login dari collector', () => {
    expect(followerBatchSchema.safeParse({ ...batch, token: 'never-accepted' }).success).toBe(
      false,
    );
    expect(
      followerBatchSchema.safeParse({
        ...batch,
        followers: [{ username: 'calon_1', consent: true }],
      }).success,
    ).toBe(false);
    expect(followerBatchSchema.safeParse({ ...batch, collectedAt: 'bukan-tanggal' }).success).toBe(
      false,
    );
  });
});
