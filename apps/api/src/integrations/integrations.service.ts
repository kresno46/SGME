import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  AccountIntegration,
  IntegrationProvider,
  Prisma,
  TikTokAccount,
} from '@smge/database';
import { normalizeTikTokUsername } from '@smge/shared';
import type { IntegrationsOverviewDto, SyncResultDto } from '@smge/types';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../common/crypto/crypto.service';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { RequestMeta } from '../common/utils/request';
import { ACCOUNT_REF_SELECT, iso } from '../common/utils/refs';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationLogService } from './integration-log.service';
import {
  CallRecorder,
  TikTokAccountAdapter,
  TikTokApiError,
  TikTokProfile,
  TikTokTokenSet,
} from './tiktok/tiktok-adapter';
import { verifyTikTokSignature } from './webhook-signature';

export const TIKTOK_ADAPTERS = Symbol('TIKTOK_ADAPTERS');
export interface TikTokAdapters {
  loginKit: TikTokAccountAdapter | null;
  mock: TikTokAccountAdapter | null;
}

type ConnectProvider = 'TIKTOK_LOGIN_KIT' | 'MOCK';
interface OAuthState {
  typ: 'tiktok_oauth';
  acc: string;
  uid: string;
  prv: ConnectProvider;
  nonce: string;
}

const STATE_TTL_SECONDS = 600;
/** Token di-refresh bila akan kedaluwarsa dalam rentang ini. */
const REFRESH_MARGIN_MS = 10 * 60_000;
const REQUIRED_SCOPE = 'user.info.profile';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @Inject(TIKTOK_ADAPTERS) private readonly adapters: TikTokAdapters,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
    private readonly logs: IntegrationLogService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ util

  private adapter(provider: IntegrationProvider): TikTokAccountAdapter {
    const a =
      provider === 'MOCK'
        ? this.adapters.mock
        : provider === 'TIKTOK_LOGIN_KIT'
          ? this.adapters.loginKit
          : null;
    if (!a) {
      throw new ServiceUnavailableException(
        provider === 'MOCK'
          ? 'Mock Adapter tidak aktif (TIKTOK_USE_MOCK=false).'
          : 'Integrasi TikTok Login Kit belum dikonfigurasi (TIKTOK_CLIENT_KEY/SECRET/REDIRECT_URI).',
      );
    }
    return a;
  }

  /** Perekam panggilan HTTP → integration_logs. */
  private recorder(
    provider: IntegrationProvider,
    integrationId: string | null,
    simulated: boolean,
  ): CallRecorder {
    return (r) =>
      void this.logs.write({
        integrationId,
        provider,
        direction: 'OUTBOUND_REQUEST',
        operation: r.operation,
        statusCode: r.statusCode,
        success: r.success,
        message: r.message,
        payload: r.payload,
        durationMs: r.durationMs,
        isSimulation: simulated,
      });
  }

  private dashboardUrl(path: string) {
    return `${env().APP_PUBLIC_URL}${path}`;
  }

  // ------------------------------------------------------------ ringkasan

  async overview(): Promise<IntegrationsOverviewDto> {
    const e = env();
    const missing = [
      !e.TIKTOK_CLIENT_KEY && 'TIKTOK_CLIENT_KEY',
      !e.TIKTOK_CLIENT_SECRET && 'TIKTOK_CLIENT_SECRET',
      !e.TIKTOK_REDIRECT_URI && 'TIKTOK_REDIRECT_URI',
    ].filter(Boolean) as string[];
    const accounts = await this.prisma.tikTokAccount.findMany({
      orderBy: [{ lane: 'asc' }, { username: 'asc' }],
      include: { integrations: true },
    });
    const errorsLast24h = await this.prisma.integrationLog.count({
      where: { success: false, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    });
    const businessNote =
      'Endpoint belum dapat diverifikasi dari dokumentasi resmi TikTok API for Business. Diimplementasikan setelah akun developer bisnis disetujui dan dokumentasi resminya dapat diakses.';
    return {
      capabilities: [
        {
          key: 'LOGIN_KIT',
          name: 'TikTok Login Kit (OAuth)',
          status: missing.length ? 'NOT_CONFIGURED' : 'READY',
          description:
            'Menghubungkan akun TikTok secara resmi dan menyinkronkan profil, status verifikasi, dan jumlah followers.',
          missing: missing.length
            ? [...missing, 'Daftarkan Redirect URI (https) di portal developers.tiktok.com']
            : [],
        },
        {
          key: 'WEBHOOK',
          name: 'Webhook TikTok',
          status: e.TIKTOK_CLIENT_SECRET ? 'READY' : 'NOT_CONFIGURED',
          description:
            'Menerima event pencabutan otorisasi (authorization.removed) dengan verifikasi signature.',
          missing: e.TIKTOK_CLIENT_SECRET
            ? []
            : ['TIKTOK_CLIENT_SECRET', 'Atur Callback URL webhook di portal TikTok'],
        },
        {
          key: 'CONVERSION_API',
          name: 'Conversion API Solid Mini',
          status: e.CONVERSION_API_SECRET ? 'READY' : 'NOT_CONFIGURED',
          description:
            'Menerima registrasi, aktivasi, dan transaksi terverifikasi dari backend Solid Mini (HMAC). Spesifikasi: docs/CONVERSION-API.md.',
          missing: e.CONVERSION_API_SECRET
            ? []
            : ['CONVERSION_API_SECRET', 'Backend Solid Mini memanggil POST /api/conversions'],
        },
        {
          key: 'MOCK',
          name: 'Mock Adapter (Simulasi)',
          status: this.adapters.mock ? 'SIMULATION' : 'NOT_CONFIGURED',
          description:
            'Simulasi koneksi untuk development. Data yang dihasilkan selalu berlabel SIMULASI.',
          missing: this.adapters.mock ? [] : ['TIKTOK_USE_MOCK=true (development saja)'],
        },
        {
          key: 'BUSINESS_API',
          name: 'TikTok API for Business (Ads Reporting)',
          status: 'NOT_VERIFIED',
          description: 'Sinkron biaya & performa iklan ke campaign.',
          missing: [businessNote],
        },
        {
          key: 'LEAD_GENERATION',
          name: 'TikTok Lead Generation',
          status: 'NOT_VERIFIED',
          description:
            'Mengambil prospek dari formulir iklan. Sementara ini gunakan export CSV dari TikTok Ads Manager lalu Import CSV di CRM.',
          missing: [businessNote],
        },
        {
          key: 'MESSAGING',
          name: 'TikTok Business Messaging',
          status: 'NOT_VERIFIED',
          description:
            'Inbox & auto-reply resmi. Auto-reply tetap terkunci sampai kanal ini tersedia dan mengizinkannya.',
          missing: ['Dokumentasi developer resmi & kebijakan akses belum dapat diverifikasi'],
        },
      ],
      connectProviders: [
        ...(this.adapters.loginKit ? (['TIKTOK_LOGIN_KIT'] as const) : []),
        ...(this.adapters.mock ? (['MOCK'] as const) : []),
      ],
      callbackUrl: e.TIKTOK_REDIRECT_URI ?? null,
      webhookUrl: `${e.APP_PUBLIC_URL}/api/webhooks/tiktok`,
      scopes: e.TIKTOK_SCOPES.split(',').map((s) => s.trim()),
      errorsLast24h,
      accounts: accounts.map((a) => ({
        account: {
          id: a.id,
          username: a.username,
          displayName: a.displayName,
          lane: a.lane,
          status: a.status,
          followersCount: a.followersCount,
          followersSource: a.followersSource,
          lastSyncedAt: iso(a.lastSyncedAt),
        },
        integrations: a.integrations.map((i) => ({
          id: i.id,
          provider: i.provider,
          status: i.status,
          isSimulation: i.isSimulation,
          scopes: i.scopes,
          tokenExpiresAt: iso(i.tokenExpiresAt),
          refreshExpiresAt: iso(i.refreshExpiresAt),
          lastSyncAt: iso(i.lastSyncAt),
          lastError: i.lastError,
          externalId: i.externalId,
        })),
      })),
    };
  }

  // ------------------------------------------------------------ OAuth

  async startConnect(
    user: RequestUser,
    accountId: string,
    provider: ConnectProvider,
    meta: RequestMeta,
  ) {
    const adapter = this.adapter(provider);
    const account = await this.prisma.tikTokAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Akun TikTok tidak ditemukan');
    const payload: OAuthState = {
      typ: 'tiktok_oauth',
      acc: account.id,
      uid: user.id,
      prv: provider,
      nonce: randomBytes(16).toString('hex'),
    };
    const state = await this.jwt.signAsync(payload, { expiresIn: STATE_TTL_SECONDS });
    await this.audit.log({
      action: 'integration.connect_started',
      actor: user,
      entityType: 'tiktok_account',
      entityId: account.id,
      metadata: { provider },
      meta,
    });
    return { authorizeUrl: adapter.authorizeUrl(state) };
  }

  /** Info state untuk halaman persetujuan simulasi (hanya Mock). */
  async mockStateInfo(state: string) {
    const s = await this.verifyState(state);
    if (s.prv !== 'MOCK') throw new BadRequestException('State bukan untuk Mock Adapter');
    const account = await this.prisma.tikTokAccount.findUniqueOrThrow({
      where: { id: s.acc },
      select: ACCOUNT_REF_SELECT,
    });
    return { account, scopes: env().TIKTOK_SCOPES.split(',') };
  }

  private async verifyState(state: string): Promise<OAuthState> {
    try {
      const s = await this.jwt.verifyAsync<OAuthState>(state);
      if (s.typ !== 'tiktok_oauth') throw new Error();
      return s;
    } catch {
      throw new BadRequestException(
        'Sesi otorisasi tidak valid atau sudah kedaluwarsa. Ulangi dari halaman Integrasi.',
      );
    }
  }

  /**
   * Callback OAuth (browser diarahkan TikTok ke sini). Selalu mengembalikan URL dashboard tujuan redirect.
   * Tidak pernah melempar ke browser — kesalahan diteruskan sebagai ?error= di halaman Integrasi.
   */
  async handleCallback(q: {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
    scopes?: string;
  }): Promise<string> {
    const fail = (msg: string, accountId?: string) =>
      this.dashboardUrl(
        `/integrations?error=${encodeURIComponent(msg)}${accountId ? `&account=${accountId}` : ''}`,
      );

    if (!q.state) return fail('Parameter state tidak ada');
    let s: OAuthState;
    try {
      s = await this.verifyState(q.state);
    } catch (e) {
      return fail((e as Error).message);
    }
    const provider = s.prv;
    const simulated = provider === 'MOCK';

    // state hanya boleh dipakai sekali
    const fresh = await this.logs.claim({
      provider,
      direction: 'INBOUND_WEBHOOK',
      operation: 'oauth.callback',
      success: !q.error,
      message: q.error ? `${q.error}: ${q.error_description ?? ''}` : null,
      idempotencyKey: `oauth_state:${s.nonce}`,
      isSimulation: simulated,
    });
    if (!fresh) return fail('Link otorisasi sudah dipakai. Ulangi dari halaman Integrasi.', s.acc);
    if (q.error)
      return fail(
        q.error === 'access_denied'
          ? 'Otorisasi dibatalkan di TikTok'
          : `TikTok: ${q.error_description || q.error}`,
        s.acc,
      );
    if (!q.code) return fail('Kode otorisasi tidak ada', s.acc);

    let adapter: TikTokAccountAdapter;
    try {
      adapter = this.adapter(provider);
    } catch (e) {
      return fail((e as Error).message, s.acc);
    }
    const account = await this.prisma.tikTokAccount.findUnique({ where: { id: s.acc } });
    if (!account) return fail('Akun TikTok tidak ditemukan');

    const record = this.recorder(provider, null, simulated);
    let tokens: TikTokTokenSet;
    let profile: TikTokProfile;
    try {
      tokens = await adapter.exchangeCode(q.code, record);
      if (!tokens.scopes.includes(REQUIRED_SCOPE)) {
        await adapter.revoke(tokens.accessToken, record).catch(() => undefined);
        return fail(`Izin "${REQUIRED_SCOPE}" wajib disetujui agar akun dapat diverifikasi`, s.acc);
      }
      profile = await adapter.fetchProfile(tokens.accessToken, tokens.scopes, record);
    } catch (e) {
      return fail(e instanceof TikTokApiError ? e.message : 'Gagal menghubungkan ke TikTok', s.acc);
    }

    // Akun yang diotorisasi harus sama dengan akun yang dipilih di SMGE
    const authorized = normalizeTikTokUsername(profile.username);
    if (authorized !== account.username) {
      await adapter.revoke(tokens.accessToken, record).catch(() => undefined);
      return fail(
        `Akun yang diotorisasi (@${authorized ?? '?'}) berbeda dengan @${account.username}`,
        s.acc,
      );
    }
    const linkedElsewhere = await this.prisma.accountIntegration.findFirst({
      where: {
        provider,
        externalId: tokens.openId,
        tiktokAccountId: { not: account.id },
        status: { not: 'REVOKED' },
      },
    });
    if (linkedElsewhere) {
      await adapter.revoke(tokens.accessToken, record).catch(() => undefined);
      return fail('Akun TikTok ini sudah terhubung ke akun lain di SMGE', s.acc);
    }

    const integration = await this.prisma.$transaction(async (tx) => {
      const data = {
        status: 'CONNECTED' as const,
        externalId: tokens.openId,
        isSimulation: simulated,
        lastError: null,
        ...this.tokenColumns(tokens),
      };
      const i = await tx.accountIntegration.upsert({
        where: { tiktokAccountId_provider: { tiktokAccountId: account.id, provider } },
        create: { tiktokAccountId: account.id, provider, ...data },
        update: data,
      });
      await this.applyProfile(tx, account, i, profile, simulated);
      return i;
    });
    await this.audit.log({
      action: 'integration.connected',
      actor: {
        id: s.uid,
        email:
          (await this.prisma.user.findUnique({ where: { id: s.uid }, select: { email: true } }))
            ?.email ?? '',
      },
      entityType: 'account_integration',
      entityId: integration.id,
      metadata: { provider, account: account.username, scopes: tokens.scopes, simulated },
    });
    return this.dashboardUrl(`/integrations?connected=${account.id}`);
  }

  private tokenColumns(t: TikTokTokenSet) {
    const now = Date.now();
    return {
      accessTokenEncrypted: this.crypto.encrypt(t.accessToken),
      refreshTokenEncrypted: this.crypto.encrypt(t.refreshToken),
      tokenExpiresAt: new Date(now + t.expiresIn * 1000),
      refreshExpiresAt: new Date(now + t.refreshExpiresIn * 1000),
      scopes: t.scopes,
    };
  }

  /** Menerapkan profil TikTok ke akun SMGE. Angka dari Mock selalu SIMULATED. */
  private async applyProfile(
    tx: Prisma.TransactionClient,
    account: TikTokAccount,
    integration: AccountIntegration,
    p: TikTokProfile,
    simulated: boolean,
  ) {
    const now = new Date();
    await tx.tikTokAccount.update({
      where: { id: account.id },
      data: {
        ...(p.displayName && !simulated ? { displayName: p.displayName } : {}),
        ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}),
        ...(p.isVerified !== null && !simulated ? { isVerified: p.isVerified } : {}),
        ...(p.followerCount !== null
          ? { followersCount: p.followerCount, followersSource: simulated ? 'SIMULATED' : 'ACTUAL' }
          : {}),
        lastSyncedAt: now,
      },
    });
    await tx.accountIntegration.update({
      where: { id: integration.id },
      data: { lastSyncAt: now, lastError: null },
    });
  }

  // ------------------------------------------------------------ sinkronisasi & token

  private async freshAccessToken(
    i: AccountIntegration,
    adapter: TikTokAccountAdapter,
    record: CallRecorder,
  ) {
    if (!i.accessTokenEncrypted || !i.refreshTokenEncrypted)
      throw new TikTokApiError('Token tidak tersedia', false, null, true);
    if (i.tokenExpiresAt && i.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
      return this.crypto.decrypt(i.accessTokenEncrypted);
    }
    if (i.refreshExpiresAt && i.refreshExpiresAt < new Date()) {
      throw new TikTokApiError(
        'Refresh token kedaluwarsa — hubungkan ulang akun',
        false,
        null,
        true,
      );
    }
    const tokens = await adapter.refresh(this.crypto.decrypt(i.refreshTokenEncrypted), record);
    await this.prisma.accountIntegration.update({
      where: { id: i.id },
      data: { ...this.tokenColumns(tokens), status: 'CONNECTED' },
    });
    return tokens.accessToken;
  }

  async sync(integrationId: string, actor?: RequestUser): Promise<SyncResultDto> {
    const i = await this.prisma.accountIntegration.findUnique({
      where: { id: integrationId },
      include: { tiktokAccount: true },
    });
    if (!i) throw new NotFoundException('Integrasi tidak ditemukan');
    if (i.status === 'REVOKED' || i.status === 'NOT_CONNECTED') {
      throw new ConflictException('Integrasi tidak aktif. Hubungkan ulang akun.');
    }
    const adapter = this.adapter(i.provider);
    const record = this.recorder(i.provider, i.id, i.isSimulation);
    try {
      const token = await this.freshAccessToken(i, adapter, record);
      const fresh = await this.prisma.accountIntegration.findUniqueOrThrow({ where: { id: i.id } });
      const profile = await adapter.fetchProfile(token, fresh.scopes, record);
      await this.prisma.$transaction((tx) =>
        this.applyProfile(tx, i.tiktokAccount, fresh, profile, i.isSimulation),
      );
      if (actor) {
        await this.audit.log({
          action: 'integration.synced',
          actor,
          entityType: 'account_integration',
          entityId: i.id,
        });
      }
      return {
        integrationId: i.id,
        status: 'CONNECTED',
        followersCount: profile.followerCount,
        message: 'Sinkronisasi berhasil',
      };
    } catch (e) {
      const err =
        e instanceof TikTokApiError ? e : new TikTokApiError('Kesalahan tidak terduga', true);
      const status = err.authInvalid ? 'TOKEN_EXPIRED' : 'ERROR';
      await this.prisma.accountIntegration.update({
        where: { id: i.id },
        data: { status, lastError: err.message },
      });
      this.logger.warn(`Sinkron @${i.tiktokAccount.username} gagal: ${err.message}`);
      return { integrationId: i.id, status, followersCount: null, message: err.message };
    }
  }

  /** Dipanggil worker: sinkron semua integrasi aktif (berurutan, agar ramah rate limit). */
  async syncAll() {
    const rows = await this.prisma.accountIntegration.findMany({
      where: { status: { in: ['CONNECTED', 'ERROR'] }, provider: { in: this.activeProviders() } },
      select: { id: true },
    });
    const results: SyncResultDto[] = [];
    for (const r of rows) results.push(await this.sync(r.id));
    return {
      total: rows.length,
      ok: results.filter((r) => r.status === 'CONNECTED').length,
      results,
    };
  }

  private activeProviders(): IntegrationProvider[] {
    return [
      ...(this.adapters.loginKit ? (['TIKTOK_LOGIN_KIT'] as const) : []),
      ...(this.adapters.mock ? (['MOCK'] as const) : []),
    ];
  }

  async disconnect(actor: RequestUser, integrationId: string, meta: RequestMeta) {
    const i = await this.prisma.accountIntegration.findUnique({ where: { id: integrationId } });
    if (!i) throw new NotFoundException('Integrasi tidak ditemukan');
    const adapter =
      i.provider === 'MOCK'
        ? this.adapters.mock
        : i.provider === 'TIKTOK_LOGIN_KIT'
          ? this.adapters.loginKit
          : null;
    if (adapter && i.accessTokenEncrypted) {
      await adapter
        .revoke(
          this.crypto.decrypt(i.accessTokenEncrypted),
          this.recorder(i.provider, i.id, i.isSimulation),
        )
        .catch((e: Error) =>
          this.logger.warn(`Revoke gagal (tetap diputus di SMGE): ${e.message}`),
        );
    }
    await this.prisma.accountIntegration.update({
      where: { id: i.id },
      data: {
        status: 'REVOKED',
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
        refreshExpiresAt: null,
        lastError: null,
      },
    });
    await this.audit.log({
      action: 'integration.disconnected',
      actor,
      entityType: 'account_integration',
      entityId: i.id,
      metadata: { provider: i.provider },
      meta,
    });
  }

  // ------------------------------------------------------------ webhook

  /**
   * Webhook TikTok. Signature diverifikasi dengan client_secret; event duplikat diabaikan (idempotensi
   * berdasarkan hash body). Mengembalikan ringkasan untuk log/test.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = env().TIKTOK_CLIENT_SECRET;
    if (!secret) throw new ServiceUnavailableException('Webhook TikTok belum dikonfigurasi');
    if (!rawBody?.length) throw new BadRequestException('Body kosong');

    const check = verifyTikTokSignature(signature, rawBody, secret);
    if (!check.ok) {
      await this.logs.write({
        provider: 'TIKTOK_LOGIN_KIT',
        direction: 'INBOUND_WEBHOOK',
        level: 'WARN',
        operation: 'webhook.rejected',
        success: false,
        message: check.reason,
      });
      throw new BadRequestException(check.reason);
    }

    let body: {
      client_key?: string;
      event?: string;
      create_time?: number;
      user_openid?: string;
      content?: string;
    };
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Body bukan JSON');
    }
    if (env().TIKTOK_CLIENT_KEY && body.client_key !== env().TIKTOK_CLIENT_KEY) {
      throw new BadRequestException('client_key tidak cocok');
    }

    const fresh = await this.logs.claim({
      provider: 'TIKTOK_LOGIN_KIT',
      direction: 'INBOUND_WEBHOOK',
      operation: `webhook.${body.event ?? 'unknown'}`,
      success: true,
      payload: { event: body.event, createTime: body.create_time, userOpenId: body.user_openid },
      idempotencyKey: `webhook:${this.crypto.sha256(rawBody.toString('utf8'))}`,
    });
    if (!fresh) return { handled: false, duplicate: true };

    if (body.event === 'authorization.removed' && body.user_openid) {
      let reason: number | undefined;
      try {
        reason = (JSON.parse(body.content ?? '{}') as { reason?: number }).reason;
      } catch {
        reason = undefined;
      }
      const REASONS: Record<number, string> = {
        0: 'tidak diketahui',
        1: 'pengguna memutus dari aplikasi TikTok',
        2: 'akun dihapus',
        3: 'perubahan usia akun',
        4: 'akun diblokir',
        5: 'otorisasi dicabut developer',
      };
      const updated = await this.prisma.accountIntegration.updateMany({
        where: {
          provider: 'TIKTOK_LOGIN_KIT',
          externalId: body.user_openid,
          status: { not: 'REVOKED' },
        },
        data: {
          status: 'REVOKED',
          accessTokenEncrypted: null,
          refreshTokenEncrypted: null,
          tokenExpiresAt: null,
          refreshExpiresAt: null,
          lastError: `Otorisasi dicabut dari TikTok (${REASONS[reason ?? 0] ?? 'tidak diketahui'})`,
        },
      });
      return { handled: true, duplicate: false, event: body.event, affected: updated.count };
    }
    return { handled: false, duplicate: false, event: body.event };
  }
}
