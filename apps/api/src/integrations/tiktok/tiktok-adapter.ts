/**
 * Kontrak adapter akun TikTok (Login Kit). Implementasi:
 * - LoginKitAdapter — API resmi TikTok (endpoint diverifikasi dari developers.tiktok.com)
 * - MockLoginKitAdapter — simulasi untuk development (data berlabel SIMULASI)
 */

export interface TikTokTokenSet {
  accessToken: string;
  refreshToken: string;
  /** detik */
  expiresIn: number;
  refreshExpiresIn: number;
  openId: string;
  scopes: string[];
}

export interface TikTokProfile {
  openId: string;
  /** null bila scope user.info.profile tidak diberikan */
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isVerified: boolean | null;
  /** null bila scope user.info.stats tidak diberikan */
  followerCount: number | null;
  profileDeepLink: string | null;
}

/** Catatan setiap panggilan HTTP keluar, untuk integration_logs (tanpa token). */
export interface CallRecord {
  operation: string;
  statusCode: number | null;
  success: boolean;
  durationMs: number;
  message?: string;
  /** Payload yang sudah disensor */
  payload?: Record<string, unknown>;
}

export type CallRecorder = (r: CallRecord) => void;

export interface TikTokAccountAdapter {
  readonly provider: 'TIKTOK_LOGIN_KIT' | 'MOCK';
  readonly simulated: boolean;
  authorizeUrl(state: string): string;
  exchangeCode(code: string, record: CallRecorder): Promise<TikTokTokenSet>;
  refresh(refreshToken: string, record: CallRecorder): Promise<TikTokTokenSet>;
  revoke(accessToken: string, record: CallRecorder): Promise<void>;
  fetchProfile(accessToken: string, scopes: string[], record: CallRecorder): Promise<TikTokProfile>;
}

/** Error dari TikTok yang aman ditampilkan. `retryable` untuk jaringan/5xx/rate limit. */
export class TikTokApiError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode: number | null = null,
    /** true bila token tidak berlaku lagi (perlu hubungkan ulang) */
    public readonly authInvalid = false,
  ) {
    super(message);
  }
}
