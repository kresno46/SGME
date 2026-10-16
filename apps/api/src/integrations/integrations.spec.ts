import { createHmac } from 'node:crypto';
import { LoginKitAdapter, TIKTOK_ENDPOINTS } from './tiktok/login-kit.adapter';
import { MockLoginKitAdapter } from './tiktok/mock-login-kit.adapter';
import { TikTokApiError, type CallRecord } from './tiktok/tiktok-adapter';
import { verifyTikTokSignature } from './webhook-signature';

const sign = (t: number, body: string, secret: string) =>
  `t=${t},s=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

describe('verifyTikTokSignature', () => {
  const secret = 'rahasia-klien';
  const body = '{"event":"authorization.removed"}';
  const now = 1_800_000_000;

  it('menerima signature yang benar', () => {
    expect(verifyTikTokSignature(sign(now, body, secret), body, secret, now)).toEqual({
      ok: true,
      timestamp: now,
    });
  });

  it('menolak signature salah, body diubah, header rusak, dan webhook kedaluwarsa', () => {
    expect(verifyTikTokSignature(sign(now, body, 'lain'), body, secret, now).ok).toBe(false);
    expect(verifyTikTokSignature(sign(now, body, secret), body + ' ', secret, now).ok).toBe(false);
    expect(verifyTikTokSignature('rusak', body, secret, now).ok).toBe(false);
    expect(verifyTikTokSignature(undefined, body, secret, now).ok).toBe(false);
    const old = verifyTikTokSignature(sign(now - 3600, body, secret), body, secret, now);
    expect(old).toEqual({ ok: false, reason: 'Webhook kedaluwarsa' });
  });
});

describe('LoginKitAdapter (sesuai dokumentasi resmi)', () => {
  type Call = { url: string; init: RequestInit };
  const calls: Call[] = [];
  let responses: Array<{ status: number; body: unknown }> = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  const records: CallRecord[] = [];
  const record = (r: CallRecord) => records.push(r);
  const adapter = new LoginKitAdapter(
    'ck_123',
    'cs_456',
    'https://smge.example/api/integrations/tiktok/callback',
    'user.info.basic,user.info.profile',
    fakeFetch,
  );

  beforeEach(() => {
    calls.length = 0;
    records.length = 0;
    responses = [];
  });

  it('URL otorisasi memakai endpoint v2 dan parameter wajib', () => {
    const url = new URL(adapter.authorizeUrl('state-xyz'));
    expect(`${url.origin}${url.pathname}`).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: 'ck_123',
      response_type: 'code',
      scope: 'user.info.basic,user.info.profile',
      redirect_uri: 'https://smge.example/api/integrations/tiktok/callback',
      state: 'state-xyz',
    });
  });

  it('tukar code: POST form-urlencoded ke /v2/oauth/token/ dan memetakan respons', async () => {
    responses = [
      {
        status: 200,
        body: {
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 86400,
          refresh_expires_in: 31536000,
          open_id: 'oid',
          scope: 'user.info.basic,user.info.profile',
          token_type: 'Bearer',
        },
      },
    ];
    const t = await adapter.exchangeCode('kode-1', record);
    expect(calls[0].url).toBe(TIKTOK_ENDPOINTS.token);
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(Object.fromEntries(calls[0].init.body as URLSearchParams)).toEqual({
      client_key: 'ck_123',
      client_secret: 'cs_456',
      grant_type: 'authorization_code',
      code: 'kode-1',
      redirect_uri: 'https://smge.example/api/integrations/tiktok/callback',
    });
    expect(t).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 86400,
      refreshExpiresIn: 31536000,
      openId: 'oid',
      scopes: ['user.info.basic', 'user.info.profile'],
    });
    // log tidak boleh berisi token
    expect(JSON.stringify(records)).not.toMatch(/"at"|"rt"|cs_456/);
  });

  it('refresh memakai grant_type refresh_token', async () => {
    responses = [
      {
        status: 200,
        body: { access_token: 'a2', refresh_token: 'r2', open_id: 'oid', scope: 'user.info.basic' },
      },
    ];
    await adapter.refresh('rt-lama', record);
    expect(Object.fromEntries(calls[0].init.body as URLSearchParams)).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'rt-lama',
    });
  });

  it('user info hanya meminta field yang scope-nya diberikan', async () => {
    responses = [
      {
        status: 200,
        body: {
          data: {
            user: {
              open_id: 'oid',
              username: 'solid.mini',
              display_name: 'Solid Mini',
              is_verified: true,
              follower_count: 1234,
            },
          },
          error: { code: 'ok', message: '', log_id: 'x' },
        },
      },
    ];
    const p = await adapter.fetchProfile('at', ['user.info.basic', 'user.info.profile'], record);
    const url = new URL(calls[0].url);
    expect(`${url.origin}${url.pathname}`).toBe(TIKTOK_ENDPOINTS.userInfo);
    expect(url.searchParams.get('fields')!.split(',')).toEqual([
      'open_id',
      'avatar_url',
      'display_name',
      'username',
      'is_verified',
      'profile_deep_link',
    ]);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer at');
    expect(p).toMatchObject({
      openId: 'oid',
      username: 'solid.mini',
      isVerified: true,
      followerCount: 1234,
    });
  });

  it('mencoba ulang 5xx lalu berhasil; 401 tidak diulang dan menandai token tidak berlaku', async () => {
    responses = [
      { status: 503, body: {} },
      { status: 200, body: { data: { user: { open_id: 'oid' } }, error: { code: 'ok' } } },
    ];
    await adapter.fetchProfile('at', ['user.info.basic'], record);
    expect(calls).toHaveLength(2);

    calls.length = 0;
    responses = [{ status: 401, body: {} }];
    await expect(adapter.fetchProfile('at', ['user.info.basic'], record)).rejects.toMatchObject({
      authInvalid: true,
    });
    expect(calls).toHaveLength(1);
  });

  it('error dari body user info dilaporkan', async () => {
    responses = [
      { status: 200, body: { error: { code: 'access_token_invalid', message: 'expired' } } },
    ];
    await expect(adapter.fetchProfile('at', ['user.info.basic'], record)).rejects.toBeInstanceOf(
      TikTokApiError,
    );
  });
});

describe('MockLoginKitAdapter', () => {
  it('mendukung username dengan titik dan konsisten antar refresh', async () => {
    const mock = new MockLoginKitAdapter('http://localhost:3000');
    const t = await mock.exchangeCode('mock:solid.mini', () => undefined);
    const p1 = await mock.fetchProfile(t.accessToken, t.scopes, () => undefined);
    const r = await mock.refresh(t.refreshToken, () => undefined);
    const p2 = await mock.fetchProfile(r.accessToken, r.scopes, () => undefined);
    expect(p1.username).toBe('solid.mini');
    expect(p2).toEqual(p1);
    expect(mock.authorizeUrl('s')).toBe(
      'http://localhost:3000/integrations/mock-authorize?state=s',
    );
  });
});
