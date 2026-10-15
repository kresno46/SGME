/**
 * Bentuk respons API (DTO) yang dikonsumsi dashboard.
 * Tanggal dikirim sebagai string ISO-8601.
 */

type RoleCode = 'SUPER_ADMIN' | 'ADMIN' | 'MARKETING_OPERATOR' | 'VIEWER';
type MarketingLane = 'OFFICIAL' | 'OUTBOUND';
type DataSource = 'ACTUAL' | 'MANUAL' | 'SIMULATED';

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  /** Detail error validasi per field */
  errors?: Record<string, string[]>;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: RoleCode;
  roleName: string;
  permissions: string[];
  twoFactorEnabled: boolean;
}

export type LoginResponse =
  | { status: 'AUTHENTICATED'; user: AuthUser }
  | { status: 'TWO_FACTOR_REQUIRED'; challengeToken: string };

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: RoleCode;
  roleName: string;
  status: 'ACTIVE' | 'DISABLED';
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
}

export interface RoleDto {
  id: string;
  code: RoleCode;
  name: string;
  description: string | null;
  permissions: string[];
  userCount: number;
}

export interface SessionDto {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface AuditLogDto {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
}

export interface AccountIntegrationDto {
  id: string;
  provider: 'TIKTOK_LOGIN_KIT' | 'TIKTOK_BUSINESS_API' | 'MOCK';
  status: 'NOT_CONNECTED' | 'CONNECTED' | 'TOKEN_EXPIRED' | 'ERROR' | 'REVOKED';
  isSimulation: boolean;
  scopes: string[];
  tokenExpiresAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface TikTokAccountDto {
  id: string;
  username: string;
  displayName: string;
  profileUrl: string | null;
  avatarUrl: string | null;
  accountType: 'PERSONAL' | 'CREATOR' | 'BUSINESS';
  isVerified: boolean;
  followersCount: number;
  followersSource: DataSource;
  lane: MarketingLane;
  status: 'ACTIVE' | 'PAUSED' | 'RESTRICTED' | 'ARCHIVED';
  notes: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Status integrasi ringkas: integrasi terbaik yang dimiliki akun */
  integrationStatus: AccountIntegrationDto['status'];
  integrations: AccountIntegrationDto[];
  stats: {
    campaigns: number;
    leads: number;
    outreachTasks: number;
  };
}

export interface LaneSummary {
  lane: MarketingLane;
  accounts: number;
  /** Followers aktual + manual (tanpa simulasi) */
  followers: number;
  simulatedFollowers: number;
}

/** Nilai metrik selalu disertai asal datanya. null = belum tersedia di fase ini. */
export interface MetricValue {
  value: number | null;
  source: DataSource | null;
}

export interface DashboardOverview {
  generatedAt: string;
  accounts: {
    total: number;
    active: number;
    /** Total followers dari data aktual + input manual (data simulasi TIDAK dijumlahkan) */
    totalFollowers: number;
    followersBySource: Record<DataSource, number>;
    byLane: LaneSummary[];
    top: Array<
      Pick<
        TikTokAccountDto,
        | 'id'
        | 'username'
        | 'displayName'
        | 'lane'
        | 'followersCount'
        | 'followersSource'
        | 'isVerified'
      >
    >;
  };
  metrics: {
    activeCampaigns: MetricValue;
    totalLeads: MetricValue;
    interestedLeads: MetricValue;
    conversations: MetricValue;
    outreachTasks: MetricValue;
    registrations: MetricValue;
    activeUsers: MetricValue;
  };
  users: { total: number; active: number };
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: Record<
    string,
    { status: 'up' | 'down' | 'skipped'; latencyMs?: number; message?: string }
  >;
}
