import type {
  AiInteractionType,
  AiMode,
  KnowledgeCategory,
  KnowledgeStatus,
  CampaignStatus,
  ConsentSource,
  ConsentStatus,
  ContactChannel,
  InterestLevel,
  LeadActivityType,
  LeadSource,
  TemplatePurpose,
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

export const INTEREST_LEVEL_LABELS: Record<InterestLevel, string> = {
  UNKNOWN: 'Belum diketahui',
  LOW: 'Rendah',
  MEDIUM: 'Sedang',
  HIGH: 'Tinggi',
};

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  TIKTOK_LEAD_GEN: 'TikTok Lead Generation',
  TIKTOK_MESSAGING_ADS: 'TikTok Messaging Ads',
  INBOUND_DM: 'DM masuk',
  LIVE: 'TikTok LIVE',
  LANDING_PAGE: 'Landing page',
  REFERRAL: 'Referral',
  MANUAL: 'Input manual',
  IMPORT: 'Import file',
};

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  TIKTOK_DM: 'DM TikTok',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
  PHONE: 'Telepon',
  SMS: 'SMS',
};

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  GRANTED: 'Diizinkan',
  WITHDRAWN: 'Dicabut',
};

export const CONSENT_SOURCE_LABELS: Record<ConsentSource, string> = {
  LEAD_FORM: 'Formulir lead',
  CONVERSATION: 'Percakapan',
  LANDING_PAGE: 'Landing page',
  MANUAL_ENTRY: 'Dicatat operator',
  IMPORT: 'Import file',
};

export const LEAD_ACTIVITY_TYPE_LABELS: Record<LeadActivityType, string> = {
  CREATED: 'Prospek dibuat',
  NOTE: 'Catatan',
  STATUS_CHANGE: 'Perubahan status',
  ASSIGNMENT: 'Penugasan operator',
  MESSAGE_SENT: 'Pesan terkirim',
  MESSAGE_RECEIVED: 'Balasan diterima',
  CONSENT_CHANGE: 'Perubahan izin',
  FOLLOW_UP_SCHEDULED: 'Follow-up dijadwalkan',
  CONVERSION: 'Konversi',
  AI_ANALYSIS: 'Analisis AI',
  IMPORT: 'Import',
  MERGE: 'Penggabungan data',
};

export const TEMPLATE_PURPOSE_LABELS: Record<TemplatePurpose, string> = {
  INTRODUCTION: 'Perkenalan',
  FOLLOW_UP: 'Follow-up',
  REPLY: 'Balasan',
  REGISTRATION_GUIDE: 'Panduan registrasi',
  REACTIVATION: 'Reaktivasi',
};

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  PRODUCT_PROFILE: 'Profil produk',
  FEATURES: 'Fitur aplikasi',
  REGISTRATION: 'Cara registrasi',
  INSTALLATION: 'Cara instalasi',
  FAQ: 'FAQ',
  PRICING: 'Harga / biaya',
  TERMS: 'Syarat & ketentuan',
  SERVICE_GUIDE: 'Panduan layanan',
  PRIVACY_POLICY: 'Kebijakan privasi',
};

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Dipublikasikan',
  ARCHIVED: 'Diarsipkan',
};

export const AI_INTERACTION_TYPE_LABELS: Record<AiInteractionType, string> = {
  MESSAGE_GENERATION: 'Pembuat pesan',
  LEAD_SCORING: 'Skor prospek',
  REPLY_SUGGESTION: 'Saran balasan',
  CONVERSATION_SUMMARY: 'Ringkasan',
  AUTO_REPLY: 'Auto-reply',
  KNOWLEDGE_QA: 'Tanya jawab',
};

export const AI_MODE_LABELS: Record<AiMode, string> = {
  COPILOT: 'Copilot (saran, perlu persetujuan operator)',
  AUTO_REPLY: 'Auto-reply resmi',
};
