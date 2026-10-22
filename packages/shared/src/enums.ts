/**
 * Enum domain yang dipakai bersama oleh API dan dashboard.
 * Nilai harus identik dengan enum di packages/database/prisma/schema.prisma.
 */

const values = <const T extends readonly [string, ...string[]]>(...v: T) => v;

export const ROLE_CODES = values('SUPER_ADMIN', 'ADMIN', 'MARKETING_OPERATOR', 'VIEWER');
export type RoleCode = (typeof ROLE_CODES)[number];

export const USER_STATUSES = values('ACTIVE', 'DISABLED');
export type UserStatus = (typeof USER_STATUSES)[number];

export const MARKETING_LANES = values('OFFICIAL', 'OUTBOUND');
export type MarketingLane = (typeof MARKETING_LANES)[number];

export const TIKTOK_ACCOUNT_TYPES = values('PERSONAL', 'CREATOR', 'BUSINESS');
export type TikTokAccountType = (typeof TIKTOK_ACCOUNT_TYPES)[number];

export const TIKTOK_ACCOUNT_STATUSES = values('ACTIVE', 'PAUSED', 'RESTRICTED', 'ARCHIVED');
export type TikTokAccountStatus = (typeof TIKTOK_ACCOUNT_STATUSES)[number];

export const INTEGRATION_PROVIDERS = values('TIKTOK_LOGIN_KIT', 'TIKTOK_BUSINESS_API', 'MOCK');
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_STATUSES = values(
  'NOT_CONNECTED',
  'CONNECTED',
  'TOKEN_EXPIRED',
  'ERROR',
  'REVOKED',
);
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const DATA_SOURCES = values('ACTUAL', 'MANUAL', 'SIMULATED');
export type DataSource = (typeof DATA_SOURCES)[number];

export const CAMPAIGN_TYPES = values(
  'BRAND_AWARENESS',
  'LEAD_ACQUISITION',
  'APP_INSTALL',
  'REGISTRATION',
  'USER_ACTIVATION',
  'ENGAGEMENT',
  'CONSENTED_FOLLOW_UP',
);
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const CAMPAIGN_STATUSES = values(
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
);
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const LEAD_STATUSES = values(
  'NEW',
  'CONTACTED',
  'RESPONDED',
  'INTERESTED',
  'QUALIFIED',
  'REGISTERED',
  'ACTIVE',
  'NOT_INTERESTED',
  'DO_NOT_CONTACT',
);
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const OUTREACH_TASK_STATUSES = values(
  'DRAFT',
  'WAITING_REVIEW',
  'APPROVED',
  'BROWSER_SENT',
  'MANUALLY_SENT',
  'REPLIED',
  'FOLLOW_UP',
  'COMPLETED',
  'CANCELLED',
);
export type OutreachTaskStatus = (typeof OUTREACH_TASK_STATUSES)[number];

export const CONVERSATION_STATUSES = values(
  'OPEN',
  'WAITING_CUSTOMER',
  'WAITING_AGENT',
  'AI_HANDLING',
  'RESOLVED',
  'CLOSED',
);
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const INTEREST_LEVELS = values('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH');
export type InterestLevel = (typeof INTEREST_LEVELS)[number];

export const LEAD_SOURCES = values(
  'TIKTOK_LEAD_GEN',
  'TIKTOK_MESSAGING_ADS',
  'INBOUND_DM',
  'LIVE',
  'LANDING_PAGE',
  'REFERRAL',
  'MANUAL',
  'IMPORT',
);
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const CONTACT_CHANNELS = values('TIKTOK_DM', 'WHATSAPP', 'EMAIL', 'PHONE', 'SMS');
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONSENT_STATUSES = values('GRANTED', 'WITHDRAWN');
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CONSENT_SOURCES = values(
  'LEAD_FORM',
  'CONVERSATION',
  'LANDING_PAGE',
  'MANUAL_ENTRY',
  'IMPORT',
);
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export const LEAD_ACTIVITY_TYPES = values(
  'CREATED',
  'NOTE',
  'STATUS_CHANGE',
  'ASSIGNMENT',
  'MESSAGE_SENT',
  'MESSAGE_RECEIVED',
  'CONSENT_CHANGE',
  'FOLLOW_UP_SCHEDULED',
  'CONVERSION',
  'AI_ANALYSIS',
  'IMPORT',
  'MERGE',
);
export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

export const TEMPLATE_PURPOSES = values(
  'INTRODUCTION',
  'FOLLOW_UP',
  'REPLY',
  'REGISTRATION_GUIDE',
  'REACTIVATION',
);
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number];

export const KNOWLEDGE_CATEGORIES = values(
  'PRODUCT_PROFILE',
  'FEATURES',
  'REGISTRATION',
  'INSTALLATION',
  'FAQ',
  'PRICING',
  'TERMS',
  'SERVICE_GUIDE',
  'PRIVACY_POLICY',
);
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const KNOWLEDGE_STATUSES = values('DRAFT', 'PUBLISHED', 'ARCHIVED');
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const AI_INTERACTION_TYPES = values(
  'MESSAGE_GENERATION',
  'LEAD_SCORING',
  'REPLY_SUGGESTION',
  'CONVERSATION_SUMMARY',
  'AUTO_REPLY',
  'KNOWLEDGE_QA',
);
export type AiInteractionType = (typeof AI_INTERACTION_TYPES)[number];

/** COPILOT = AI hanya memberi saran. AUTO_REPLY hanya boleh bila kanal resmi mengizinkan. */
export const AI_MODES = values('COPILOT', 'AUTO_REPLY');
export type AiMode = (typeof AI_MODES)[number];

export const CONVERSION_EVENT_TYPES = values(
  'LANDING_VISIT',
  'CTA_CLICK',
  'STORE_CLICK',
  'INSTALL_VERIFIED',
  'REGISTRATION',
  'ACTIVATION',
  'TRANSACTION',
  'SUBSCRIPTION',
);
export type ConversionEventType = (typeof CONVERSION_EVENT_TYPES)[number];

/** Event dari browser/landing page — tidak terverifikasi, tidak membuktikan instalasi. */
export const CLIENT_EVENT_TYPES = values('LANDING_VISIT', 'CTA_CLICK', 'STORE_CLICK');
/** Event yang hanya boleh datang dari server (Conversion API backend Solid Mini). */
export const SERVER_EVENT_TYPES = values(
  'INSTALL_VERIFIED',
  'REGISTRATION',
  'ACTIVATION',
  'TRANSACTION',
  'SUBSCRIPTION',
);

export const ATTRIBUTION_MODELS = values('FIRST_TOUCH', 'LAST_TOUCH');
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];
