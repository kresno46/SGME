import { startOfToday } from './refs';

describe('startOfToday (zona waktu bisnis)', () => {
  it('memakai tengah malam WIB, bukan UTC', () => {
    // 16 Okt 2026 01:30 WIB = 15 Okt 2026 18:30 UTC → hari bisnisnya 16 Okt
    expect(startOfToday(new Date('2026-10-15T18:30:00Z')).toISOString()).toBe(
      '2026-10-15T17:00:00.000Z',
    );
  });

  it('sore hari WIB tetap di hari yang sama', () => {
    expect(startOfToday(new Date('2026-10-16T10:00:00Z')).toISOString()).toBe(
      '2026-10-15T17:00:00.000Z',
    );
  });

  it('mendukung zona waktu lain', () => {
    expect(startOfToday(new Date('2026-10-16T10:00:00Z'), 'UTC').toISOString()).toBe(
      '2026-10-16T00:00:00.000Z',
    );
  });
});
