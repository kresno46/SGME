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
