import { createHash, randomBytes } from 'node:crypto';
import {
  CallRecorder,
  TikTokAccountAdapter,
  TikTokProfile,
  TikTokTokenSet,
} from './tiktok-adapter';

/** Username di-encode hex di dalam token simulasi (username TikTok boleh mengandung titik). */
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex');
const usernameOf = (token: string) => {
  const part = token.split('.')[1];
  return part ? Buffer.from(part, 'hex').toString('utf8') : 'pengguna_simulasi';
};

/**
 * Mock Adapter — SIMULASI Login Kit untuk development tanpa akses API TikTok.
 * Halaman persetujuan disimulasikan oleh dashboard (/integrations/mock-authorize), bukan TikTok.
 * Semua data turunannya ditandai is_simulation / followers_source = SIMULATED.
 */
export class MockLoginKitAdapter implements TikTokAccountAdapter {
  readonly provider = 'MOCK' as const;
  readonly simulated = true;

  constructor(private readonly dashboardUrl: string) {}

  authorizeUrl(state: string): string {
    return `${this.dashboardUrl}/integrations/mock-authorize?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string, record: CallRecorder): Promise<TikTokTokenSet> {
    record({
      operation: 'oauth.exchange_code',
      statusCode: 200,
      success: true,
      durationMs: 0,
      payload: { simulated: true },
    });
    // code simulasi berisi username yang disetujui: "mock:<username>"
    const username = code.startsWith('mock:') ? code.slice(5) : 'pengguna_simulasi';
    return this.tokens(username);
  }

  async refresh(refreshToken: string, record: CallRecorder): Promise<TikTokTokenSet> {
    record({
      operation: 'oauth.refresh',
      statusCode: 200,
      success: true,
      durationMs: 0,
      payload: { simulated: true },
    });
    return this.tokens(usernameOf(refreshToken));
  }

  async revoke(_accessToken: string, record: CallRecorder): Promise<void> {
    record({
      operation: 'oauth.revoke',
      statusCode: 200,
      success: true,
      durationMs: 0,
      payload: { simulated: true },
    });
  }

  async fetchProfile(
    accessToken: string,
    _scopes: string[],
    record: CallRecorder,
  ): Promise<TikTokProfile> {
    record({
      operation: 'user.info',
      statusCode: 200,
      success: true,
      durationMs: 0,
      payload: { simulated: true },
    });
    const username = usernameOf(accessToken);
    // Angka followers deterministik dari username agar tampilan konsisten (tetap SIMULASI)
    const seed = parseInt(createHash('sha256').update(username).digest('hex').slice(0, 8), 16);
    return {
      openId: `mock-${username}`,
      username,
      displayName: `${username} (Simulasi)`,
      avatarUrl: null,
      isVerified: seed % 5 === 0,
      followerCount: 10_000 + (seed % 90_000),
      profileDeepLink: null,
    };
  }

  private tokens(username: string): TikTokTokenSet {
    const r = () => randomBytes(8).toString('hex');
    return {
      accessToken: `mockat.${hex(username)}.${r()}`,
      refreshToken: `mockrt.${hex(username)}.${r()}`,
      expiresIn: 86_400,
      refreshExpiresIn: 365 * 86_400,
      openId: `mock-${username}`,
      scopes: ['user.info.basic', 'user.info.profile', 'user.info.stats'],
    };
  }
}
