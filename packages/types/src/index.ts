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
  owner?: RefDto | null;
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

export interface DashboardDeliveryItem {
  id: string;
  taskId: string;
  accountId: string;
  accountUsername: string;
  username: string;
  status: 'QUEUED' | 'PROCESSING' | 'SENT' | 'FAILED' | 'UNVERIFIED' | 'CANCELLED';
  detail: string | null;
  updatedAt: string;
}

export interface DashboardOutreachOverview {
  activeAccounts: number;
  followersCollected: number;
  sentToday: number;
  sentLast7Days: number;
  deliveries: Record<DashboardDeliveryItem['status'], number>;
  accounts: Array<{
    id: string;
    username: string;
    displayName: string;
    status: TikTokAccountDto['status'];
    owner: RefDto | null;
    followersCollected: number;
    sentToday: number;
  }>;
  recent: DashboardDeliveryItem[];
  issues: DashboardDeliveryItem[];
}

export interface DashboardOverview {
  outreach: DashboardOutreachOverview;
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
    /** Registrasi terverifikasi (Conversion API backend Solid Mini) */
    registrations: MetricValue;
    /** Pengguna teraktivasi terverifikasi */
    activeUsers: MetricValue;
    /** Registrasi yang hanya dikonfirmasi operator (belum terverifikasi) */
    registrationsOperator: MetricValue;
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
  | 'BROWSER_SENT'
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
    /** Prospek berstatus Terdaftar/Aktif (termasuk konfirmasi operator) */
    registeredLeads: number;
    /** Registrasi terverifikasi backend Solid Mini, atribusi last-touch */
    registrationsVerified: number;
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
  owner?: RefDto | null;
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
  /** Jumlah aktivitas DM TikTok terkirim/dikonfirmasi hari ini, termasuk follow-up. */
  sentToday: number;
  sentLast7Days: number;
  repliesLast7Days: number;
  /** null bila belum ada pesan terkirim */
  replyRate: number | null;
}

// =====================================================================
// Fase 3 — AI Sales Agent
// =====================================================================

export interface KnowledgeDocumentDto {
  id: string;
  title: string;
  category: string;
  content: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  version: number;
  publishedAt: string | null;
  updatedBy: RefDto | null;
  updatedAt: string;
}

export interface AiStatusDto {
  /** Provider siap dipakai (API key tersedia, atau mode simulasi) */
  configured: boolean;
  provider: 'openai' | 'simulated' | null;
  /** true = keluaran AI adalah simulasi (bukan model sungguhan) */
  simulated: boolean;
  model: string | null;
  mode: 'COPILOT' | 'AUTO_REPLY';
  /** Alasan bila belum dapat dipakai */
  notReadyReason: string | null;
  publishedDocuments: number;
  monthlyBudgetUsd: number | null;
  spentThisMonthUsd: number;
  priceConfigured: boolean;
}

/** Bagian umum dari setiap hasil AI. */
export interface AiResultMeta {
  /** null bila AI tidak dipanggil (mis. Knowledge Base kosong) */
  interactionId: string | null;
  model: string;
  simulated: boolean;
  usage: { promptTokens: number; completionTokens: number; costUsd: number | null };
  /** Dokumen Knowledge Base yang dipakai sebagai konteks */
  sources: Array<{ id: string; title: string }>;
}

export interface AiAnswerDto extends AiResultMeta {
  answer: string;
  /** AI menyarankan ditangani manusia (pertanyaan di luar KB, keluhan, nasihat keuangan, dll.) */
  handoff: boolean;
  handoffReason: string | null;
}

export interface AiDraftDto extends AiResultMeta {
  message: string;
  rationale: string;
}

export interface AiReplySuggestionDto extends AiResultMeta {
  reply: string;
  handoff: boolean;
  handoffReason: string | null;
  detectedIntent: string;
}

export interface AiLeadScoreDto extends AiResultMeta {
  score: number;
  interestLevel: 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  recommendedAction: string;
}

export interface AiSummaryDto extends AiResultMeta {
  summary: string;
  keyPoints: string[];
  nextStep: string;
}

export interface AiUsageDto {
  days: number;
  totals: {
    interactions: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    failed: number;
    blocked: number;
    simulated: number;
  };
  byType: Array<{ type: string; interactions: number; costUsd: number }>;
  byDay: Array<{ date: string; interactions: number; costUsd: number; tokens: number }>;
  byModel: Array<{ model: string; interactions: number; tokens: number; costUsd: number }>;
}

export interface AiInteractionDto {
  id: string;
  type: string;
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  model: string;
  user: RefDto | null;
  leadId: string | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

// =====================================================================
// Fase 4 — Integrasi TikTok
// =====================================================================

export interface FollowerImportResultDto {
  received: number;
  unique: number;
  duplicateRows: number;
  blocked: number;
  existing: number;
  self: number;
  created: number;
}

export type CapabilityStatus = 'READY' | 'NOT_CONFIGURED' | 'SIMULATION' | 'NOT_VERIFIED';

export interface IntegrationCapabilityDto {
  key:
    | 'LOGIN_KIT'
    | 'MOCK'
    | 'WEBHOOK'
    | 'BUSINESS_API'
    | 'LEAD_GENERATION'
    | 'MESSAGING'
    | 'CONVERSION_API';
  name: string;
  status: CapabilityStatus;
  description: string;
  /** Hal yang belum lengkap (env yang kosong, langkah verifikasi) */
  missing: string[];
}

export interface ConnectedAccountDto {
  account: AccountRefDto & {
    status: string;
    followersCount: number;
    followersSource: DataSource;
    lastSyncedAt: string | null;
  };
  integrations: Array<
    AccountIntegrationDto & { externalId: string | null; refreshExpiresAt: string | null }
  >;
}

export interface IntegrationsOverviewDto {
  capabilities: IntegrationCapabilityDto[];
  /** Provider yang boleh dipakai untuk menghubungkan akun saat ini */
  connectProviders: Array<'TIKTOK_LOGIN_KIT' | 'MOCK'>;
  callbackUrl: string | null;
  webhookUrl: string;
  scopes: string[];
  accounts: ConnectedAccountDto[];
  errorsLast24h: number;
}

export interface IntegrationLogDto {
  id: string;
  integrationId: string | null;
  provider: 'TIKTOK_LOGIN_KIT' | 'TIKTOK_BUSINESS_API' | 'MOCK';
  direction: 'OUTBOUND_REQUEST' | 'INBOUND_WEBHOOK' | 'INTERNAL';
  level: 'INFO' | 'WARN' | 'ERROR';
  operation: string;
  statusCode: number | null;
  success: boolean;
  message: string | null;
  durationMs: number | null;
  isSimulation: boolean;
  createdAt: string;
}

export interface SyncResultDto {
  integrationId: string;
  status: AccountIntegrationDto['status'];
  followersCount: number | null;
  message: string;
}

// =====================================================================
// Fase 5 — Tracking konversi & analitik
// =====================================================================

export interface TrackingLinkDto {
  id: string;
  code: string;
  name: string | null;
  campaign: RefDto;
  account: AccountRefDto | null;
  destinationUrl: string;
  /** Link pendek publik untuk dibagikan (bio, video, DM) */
  shortUrl: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  isActive: boolean;
  createdAt: string;
  stats: { clicks: number; uniqueVisitors: number; registrations: number };
}

export interface ConversionResultDto {
  ok: true;
  eventId: string;
  duplicate: boolean;
  leadMatched: boolean;
  attribution: { firstTouch: RefDto | null; lastTouch: RefDto | null };
}

export interface AnalyticsKpis {
  leads: number;
  contacted: number;
  replies: number;
  /** Pengunjung unik dari link/landing page (tidak terverifikasi) */
  visitors: number;
  storeClicks: number;
  installsVerified: number;
  registrationsVerified: number;
  /** Registrasi yang hanya dikonfirmasi operator (belum terverifikasi backend) */
  registrationsOperator: number;
  activationsVerified: number;
  /** registrasi terverifikasi / pengunjung, persen; null bila belum ada pengunjung */
  conversionRate: number | null;
  spend: number;
  spendSources: DataSource[];
  costPerLead: number | null;
  costPerRegistration: number | null;
  costPerActivatedUser: number | null;
  aiCostUsd: number;
}

export interface FunnelStageDto {
  type: string;
  label: string;
  count: number;
  verified: boolean;
}

export interface LanePerformanceDto {
  lane: MarketingLane;
  leads: number;
  contacted: number;
  replies: number;
  registrations: number;
  activations: number;
  spend: number;
  costPerLead: number | null;
  costPerRegistration: number | null;
}

export interface CampaignPerformanceDto {
  id: string;
  name: string;
  lane: MarketingLane;
  status: string;
  spend: number;
  spendSource: DataSource;
  leads: number;
  visitors: number;
  registrations: number;
  activations: number;
  costPerLead: number | null;
  costPerRegistration: number | null;
  costPerActivatedUser: number | null;
  conversionRate: number | null;
}

export interface AccountPerformanceDto {
  id: string;
  username: string;
  lane: MarketingLane;
  followers: number;
  followersSource: DataSource;
  leads: number;
  messagesSent: number;
  replies: number;
  replyRate: number | null;
  visitors: number;
  registrations: number;
}

export interface OperatorProductivityDto {
  id: string;
  name: string;
  leadsAssigned: number;
  tasksCreated: number;
  messagesSent: number;
  replies: number;
  tasksCompleted: number;
  registeredOutcomes: number;
}

export interface AnalyticsReportDto {
  range: { days: number; from: string; to: string; model: 'FIRST_TOUCH' | 'LAST_TOUCH' };
  kpis: AnalyticsKpis;
  funnel: FunnelStageDto[];
  lanes: LanePerformanceDto[];
  leadsGrowth: Array<{ date: string; OFFICIAL: number; OUTBOUND: number; NONE: number }>;
  leadStatus: Array<{ status: string; count: number }>;
  campaigns: CampaignPerformanceDto[];
  accounts: AccountPerformanceDto[];
  operators: OperatorProductivityDto[];
}
