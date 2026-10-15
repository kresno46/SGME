import type {
  CampaignStatus,
  CampaignType,
  ConversationStatus,
  DataSource,
  IntegrationProvider,
  IntegrationStatus,
  LeadStatus,
  MarketingLane,
  OutreachTaskStatus,
  RoleCode,
  TikTokAccountStatus,
  TikTokAccountType,
  UserStatus,
} from './enums';

/** Label bahasa Indonesia untuk ditampilkan di antarmuka. */

export const ROLE_LABELS: Record<RoleCode, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MARKETING_OPERATOR: 'Marketing Operator',
  VIEWER: 'Viewer',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Aktif',
  DISABLED: 'Nonaktif',
};

export const LANE_LABELS: Record<MarketingLane, string> = {
  OFFICIAL: 'Jalur A — Official',
  OUTBOUND: 'Jalur B — Outbound',
};

export const LANE_SHORT_LABELS: Record<MarketingLane, string> = {
  OFFICIAL: 'Official',
  OUTBOUND: 'Outbound',
};

export const TIKTOK_ACCOUNT_TYPE_LABELS: Record<TikTokAccountType, string> = {
  PERSONAL: 'Personal',
  CREATOR: 'Kreator',
  BUSINESS: 'Bisnis',
};

export const TIKTOK_ACCOUNT_STATUS_LABELS: Record<TikTokAccountStatus, string> = {
  ACTIVE: 'Aktif',
  PAUSED: 'Dijeda',
  RESTRICTED: 'Dibatasi',
  ARCHIVED: 'Diarsipkan',
};

export const INTEGRATION_PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  TIKTOK_LOGIN_KIT: 'TikTok Login Kit',
  TIKTOK_BUSINESS_API: 'TikTok Business API',
  MOCK: 'Mock Adapter (Simulasi)',
};

export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  NOT_CONNECTED: 'Belum terhubung',
  CONNECTED: 'Terhubung',
  TOKEN_EXPIRED: 'Token kedaluwarsa',
  ERROR: 'Error',
  REVOKED: 'Dicabut',
};

export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  ACTUAL: 'Data aktual',
  MANUAL: 'Input manual',
  SIMULATED: 'Simulasi',
};

export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  BRAND_AWARENESS: 'Brand Awareness',
  LEAD_ACQUISITION: 'Akuisisi Leads',
  APP_INSTALL: 'Instalasi Aplikasi',
  REGISTRATION: 'Registrasi',
  USER_ACTIVATION: 'Aktivasi Pengguna',
  ENGAGEMENT: 'Engagement',
  CONSENTED_FOLLOW_UP: 'Follow-up Prospek Berizin',
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Terjadwal',
  ACTIVE: 'Aktif',
  PAUSED: 'Dijeda',
  COMPLETED: 'Selesai',
  ARCHIVED: 'Diarsipkan',
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'Baru',
  CONTACTED: 'Sudah dihubungi',
  RESPONDED: 'Merespons',
  INTERESTED: 'Tertarik',
  QUALIFIED: 'Memenuhi syarat',
  REGISTERED: 'Terdaftar',
  ACTIVE: 'Aktif',
  NOT_INTERESTED: 'Tidak tertarik',
  DO_NOT_CONTACT: 'Jangan dihubungi',
};

export const OUTREACH_TASK_STATUS_LABELS: Record<OutreachTaskStatus, string> = {
  DRAFT: 'Draft',
  WAITING_REVIEW: 'Menunggu review',
  APPROVED: 'Disetujui',
  MANUALLY_SENT: 'Terkirim manual',
  REPLIED: 'Dibalas',
  FOLLOW_UP: 'Follow-up',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  OPEN: 'Terbuka',
  WAITING_CUSTOMER: 'Menunggu pelanggan',
  WAITING_AGENT: 'Menunggu agen',
  AI_HANDLING: 'Ditangani AI',
  RESOLVED: 'Selesai',
  CLOSED: 'Ditutup',
};
