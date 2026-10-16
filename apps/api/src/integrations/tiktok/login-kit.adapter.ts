import {
  CallRecorder,
  TikTokAccountAdapter,
  TikTokApiError,
  TikTokProfile,
  TikTokTokenSet,
} from './tiktok-adapter';

/**
 * Adapter resmi TikTok Login Kit (OAuth v2) + Display API user info.
 * Sumber (diverifikasi 16 Okt 2026):
 * - https://developers.tiktok.com/doc/login-kit-web
 * - https://developers.tiktok.com/doc/oauth-user-access-token-management
 * - https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info
 */
export const TIKTOK_ENDPOINTS = {
  authorize: 'https://www.tiktok.com/v2/auth/authorize/',
  token: 'https://open.tiktokapis.com/v2/oauth/token/',
  revoke: 'https://open.tiktokapis.com/v2/oauth/revoke/',
  userInfo: 'https://open.tiktokapis.com/v2/user/info/',
} as const;

/** Field user info beserta scope yang dibutuhkan (hanya field yang scope-nya diberikan yang diminta). */
const FIELD_SCOPES: Record<string, string> = {
  open_id: 'user.info.basic',
  avatar_url: 'user.info.basic',
  display_name: 'user.info.basic',
  username: 'user.info.profile',
  is_verified: 'user.info.profile',
  profile_deep_link: 'user.info.profile',
  follower_count: 'user.info.stats',
};

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 15_000;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export class LoginKitAdapter implements TikTokAccountAdapter {
  readonly provider = 'TIKTOK_LOGIN_KIT' as const;
  readonly simulated = false;

  constructor(
    private readonly clientKey: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    private readonly scopes: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  authorizeUrl(state: string): string {
    const q = new URLSearchParams({
      client_key: this.clientKey,
      response_type: 'code',
      scope: this.scopes,
      redirect_uri: this.redirectUri,
      state,
    });
    return `${TIKTOK_ENDPOINTS.authorize}?${q.toString()}`;
  }

  exchangeCode(code: string, record: CallRecorder) {
    return this.tokenRequest(
      'oauth.exchange_code',
      { grant_type: 'authorization_code', code, redirect_uri: this.redirectUri },
      record,
    );
  }

  refresh(refreshToken: string, record: CallRecorder) {
    return this.tokenRequest(
      'oauth.refresh',
      { grant_type: 'refresh_token', refresh_token: refreshToken },
      record,
    );
  }

  async revoke(accessToken: string, record: CallRecorder): Promise<void> {
    await this.call(
      'oauth.revoke',
      TIKTOK_ENDPOINTS.revoke,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: this.clientKey,
          client_secret: this.clientSecret,
          token: accessToken,
        }),
      },
      record,
    );
  }

  async fetchProfile(
    accessToken: string,
    scopes: string[],
    record: CallRecorder,
  ): Promise<TikTokProfile> {
    const fields = Object.entries(FIELD_SCOPES)
      .filter(([, scope]) => scopes.includes(scope))
      .map(([f]) => f);
    const url = `${TIKTOK_ENDPOINTS.userInfo}?fields=${encodeURIComponent(fields.join(','))}`;
    const body = (await this.call(
      'user.info',
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      record,
    )) as {
      data?: { user?: Record<string, unknown> };
      error?: { code?: string; message?: string };
    };
    if (body.error?.code && body.error.code !== 'ok') {
      const invalid =
        body.error.code === 'access_token_invalid' || body.error.code === 'scope_not_authorized';
      throw new TikTokApiError(
        `TikTok: ${body.error.message ?? body.error.code}`,
        false,
        null,
        invalid,
      );
    }
    const u = body.data?.user ?? {};
    const str = (k: string) => (typeof u[k] === 'string' && u[k] ? (u[k] as string) : null);
    return {
      openId: str('open_id') ?? '',
      username: str('username'),
      displayName: str('display_name'),
      avatarUrl: str('avatar_url'),
      isVerified: typeof u.is_verified === 'boolean' ? u.is_verified : null,
      followerCount: typeof u.follower_count === 'number' ? u.follower_count : null,
      profileDeepLink: str('profile_deep_link'),
    };
  }

  private async tokenRequest(
    operation: string,
    params: Record<string, string>,
    record: CallRecorder,
  ): Promise<TikTokTokenSet> {
    const body = (await this.call(
      operation,
      TIKTOK_ENDPOINTS.token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: this.clientKey,
          client_secret: this.clientSecret,
          ...params,
        }),
      },
      record,
    )) as TokenResponse;
    if (body.error || !body.access_token || !body.refresh_token || !body.open_id) {
      throw new TikTokApiError(
        `TikTok menolak permintaan token: ${body.error_description || body.error || 'respons tidak lengkap'}`,
        false,
        null,
        operation === 'oauth.refresh',
      );
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresIn: body.expires_in ?? 0,
      refreshExpiresIn: body.refresh_expires_in ?? 0,
      openId: body.open_id,
      scopes: (body.scope ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  /** HTTP dengan timeout & retry (jaringan, 429, 5xx) + exponential backoff. */
  private async call(
    operation: string,
    url: string,
    init: RequestInit,
    record: CallRecorder,
  ): Promise<unknown> {
    let lastError: TikTokApiError | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = Date.now();
      try {
        const res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const text = await res.text();
        const json = text ? (JSON.parse(text) as unknown) : {};
        const ok = res.ok;
        record({
          operation,
          statusCode: res.status,
          success: ok,
          durationMs: Date.now() - started,
          message: ok ? undefined : `HTTP ${res.status}`,
          payload: { attempt, logId: (json as { error?: { log_id?: string } })?.error?.log_id },
        });
        if (ok) return json;
        if (res.status === 401)
          throw new TikTokApiError('Token TikTok tidak berlaku', false, 401, true);
        const retryable = res.status === 429 || res.status >= 500;
        lastError = new TikTokApiError(
          `TikTok mengembalikan HTTP ${res.status}`,
          retryable,
          res.status,
        );
        if (!retryable) throw lastError;
      } catch (e) {
        if (e instanceof TikTokApiError && !e.retryable) throw e;
        if (!(e instanceof TikTokApiError)) {
          record({
            operation,
            statusCode: null,
            success: false,
            durationMs: Date.now() - started,
            message: 'Gagal terhubung ke TikTok',
            payload: { attempt },
          });
          lastError = new TikTokApiError('Gagal terhubung ke TikTok', true);
        }
      }
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
    }
    throw lastError ?? new TikTokApiError('Gagal terhubung ke TikTok', true);
  }
}
