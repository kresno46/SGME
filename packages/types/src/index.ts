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
  /** Informasi tambahan, mis. daftar prospek duplikat pada error 409 */
  details?: unknown;
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

// =====================================================================
// Fase 2 — Campaign, CRM, Outbound
// =====================================================================

type CampaignType =
  | 'BRAND_AWARENESS'
  | 'LEAD_ACQUISITION'
  | 'APP_INSTALL'
  | 'REGISTRATION'
  | 'USER_ACTIVATION'
  | 'ENGAGEMENT'
  | 'CONSENTED_FOLLOW_UP';
type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';
type LeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'RESPONDED'
  | 'INTERESTED'
  | 'QUALIFIED'
  | 'REGISTERED'
  | 'ACTIVE'
  | 'NOT_INTERESTED'
  | 'DO_NOT_CONTACT';
type InterestLevel = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';
type LeadSource =
  | 'TIKTOK_LEAD_GEN'
  | 'TIKTOK_MESSAGING_ADS'
  | 'INBOUND_DM'
  | 'LIVE'
  | 'LANDING_PAGE'
  | 'REFERRAL'
  | 'MANUAL'
  | 'IMPORT';
type ContactChannel = 'TIKTOK_DM' | 'WHATSAPP' | 'EMAIL' | 'PHONE' | 'SMS';
type OutreachTaskStatus =
  | 'DRAFT'
  | 'WAITING_REVIEW'
  | 'APPROVED'
  | 'MANUALLY_SENT'
  | 'REPLIED'
  | 'FOLLOW_UP'
  | 'COMPLETED'
  | 'CANCELLED';

export interface RefDto {
  id: string;
  name: string;
}

export interface AccountRefDto {
  id: string;
  username: string;
  displayName: string;
  lane: MarketingLane;
}

export interface CampaignDto {
  id: string;
  name: string;
  lane: MarketingLane;
  type: CampaignType;
  status: CampaignStatus;
  target: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Rupiah; string agar presisi desimal tidak hilang */
  budget: string | null;
  spend: string;
  spendSource: DataSource;
  trackingCode: string;
  operator: RefDto | null;
  accounts: AccountRefDto[];
  createdAt: string;
  updatedAt: string;
  stats: {
    leads: number;
    interestedLeads: number;
    registeredLeads: number;
    outreachTasks: number;
    /** null bila belum ada prospek */
    costPerLead: number | null;
  };
}

export interface ConsentDto {
  id: string;
  channel: ContactChannel;
  status: 'GRANTED' | 'WITHDRAWN';
  source: string;
  evidence: string | null;
  grantedAt: string | null;
  withdrawnAt: string | null;
  recordedBy: RefDto | null;
}

export interface LeadDto {
  id: string;
  name: string | null;
  tiktokUsername: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  status: LeadStatus;
  interestLevel: InterestLevel;
  score: number;
  tags: string[];
  doNotContact: boolean;
  dataSource: DataSource;
  sourceAccount: AccountRefDto | null;
  sourceCampaign: RefDto | null;
  operator: RefDto | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  registeredAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Kanal dengan izin komunikasi yang masih berlaku */
  consentChannels: ContactChannel[];
}

export interface LeadActivityDto {
  id: string;
  type: string;
  summary: string;
  metadata: unknown;
  actor: RefDto | null;
  createdAt: string;
}

export interface LeadDetailDto extends LeadDto {
  notes: string | null;
  consents: ConsentDto[];
  activities: LeadActivityDto[];
  tasks: OutreachTaskDto[];
  /** Kontak lead tercatat di daftar larangan kontak */
  onBlocklist: boolean;
}

export interface DuplicateLeadDto {
  id: string;
  name: string | null;
  matchedOn: Array<'tiktokUsername' | 'email' | 'phone'>;
}

export interface DncEntryDto {
  id: string;
  channel: ContactChannel;
  valueNormalized: string;
  reason: string | null;
  addedBy: RefDto | null;
  createdAt: string;
}

export interface ImportRowIssue {
  row: number;
  message: string;
}

export interface LeadImportPreviewDto {
  totalRows: number;
  validRows: number;
  newLeads: number;
  duplicates: number;
  blocked: number;
  invalid: ImportRowIssue[];
  detectedColumns: Record<string, string>;
  sample: Array<{
    row: number;
    name: string | null;
    tiktokUsername: string | null;
    email: string | null;
    phone: string | null;
    status: 'new' | 'duplicate' | 'blocked';
  }>;
}

export interface LeadImportResultDto {
  created: number;
  updated: number;
  skipped: number;
  blocked: number;
  invalid: number;
}

export interface MessageTemplateDto {
  id: string;
  name: string;
  lane: MarketingLane | null;
  purpose: string;
  content: string;
  isActive: boolean;
  createdBy: RefDto | null;
  usageCount: number;
  updatedAt: string;
}

export interface OutreachTaskDto {
  id: string;
  status: OutreachTaskStatus;
  channel: ContactChannel;
  lead: Pick<
    LeadDto,
    | 'id'
    | 'name'
    | 'tiktokUsername'
    | 'email'
    | 'phone'
    | 'status'
    | 'interestLevel'
    | 'consentChannels'
  >;
  account: AccountRefDto;
  campaign: RefDto | null;
  template: RefDto | null;
  operator: RefDto | null;
  reviewer: RefDto | null;
  draftMessage: string | null;
  finalMessage: string | null;
  aiGenerated: boolean;
  priority: number;
  reviewNote: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  sentConfirmedAt: string | null;
  lastSentAt: string | null;
  sentCount: number;
  repliedAt: string | null;
  responseSummary: string | null;
  followUpAt: string | null;
  completedAt: string | null;
  outcome: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Aksi yang diizinkan untuk pengguna saat ini pada status sekarang */
  allowedActions: string[];
}

export interface OutboundQueueItemDto {
  lead: LeadDto;
  priority: { score: number; reasons: string[] };
}

export interface OutboundSummaryDto {
  account: AccountRefDto;
  dailyLimit: number;
  createdToday: number;
  byStatus: Record<OutreachTaskStatus, number>;
  followUpsDue: number;
  sentLast7Days: number;
  repliesLast7Days: number;
  /** null bila belum ada pesan terkirim */
  replyRate: number | null;
}
