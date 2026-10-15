-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MARKETING_OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "MarketingLane" AS ENUM ('OFFICIAL', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "TikTokAccountType" AS ENUM ('PERSONAL', 'CREATOR', 'BUSINESS');

-- CreateEnum
CREATE TYPE "TikTokAccountStatus" AS ENUM ('ACTIVE', 'PAUSED', 'RESTRICTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('TIKTOK_LOGIN_KIT', 'TIKTOK_BUSINESS_API', 'MOCK');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'TOKEN_EXPIRED', 'ERROR', 'REVOKED');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('ACTUAL', 'MANUAL', 'SIMULATED');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('BRAND_AWARENESS', 'LEAD_ACQUISITION', 'APP_INSTALL', 'REGISTRATION', 'USER_ACTIVATION', 'ENGAGEMENT', 'CONSENTED_FOLLOW_UP');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'RESPONDED', 'INTERESTED', 'QUALIFIED', 'REGISTERED', 'ACTIVE', 'NOT_INTERESTED', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "InterestLevel" AS ENUM ('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('TIKTOK_LEAD_GEN', 'TIKTOK_MESSAGING_ADS', 'INBOUND_DM', 'LIVE', 'LANDING_PAGE', 'REFERRAL', 'MANUAL', 'IMPORT');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('TIKTOK_DM', 'WHATSAPP', 'EMAIL', 'PHONE', 'SMS');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('LEAD_FORM', 'CONVERSATION', 'LANDING_PAGE', 'MANUAL_ENTRY', 'IMPORT');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('CREATED', 'NOTE', 'STATUS_CHANGE', 'ASSIGNMENT', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'CONSENT_CHANGE', 'FOLLOW_UP_SCHEDULED', 'CONVERSION', 'AI_ANALYSIS', 'IMPORT', 'MERGE');

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('TIKTOK_DM', 'TIKTOK_MESSAGING_ADS', 'WHATSAPP', 'MANUAL_LOG');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'WAITING_CUSTOMER', 'WAITING_AGENT', 'AI_HANDLING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('LEAD', 'OPERATOR', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('DRAFT', 'PENDING', 'SENT', 'DELIVERED', 'FAILED', 'MANUALLY_LOGGED');

-- CreateEnum
CREATE TYPE "OutreachTaskStatus" AS ENUM ('DRAFT', 'WAITING_REVIEW', 'APPROVED', 'MANUALLY_SENT', 'REPLIED', 'FOLLOW_UP', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TemplatePurpose" AS ENUM ('INTRODUCTION', 'FOLLOW_UP', 'REPLY', 'REGISTRATION_GUIDE', 'REACTIVATION');

-- CreateEnum
CREATE TYPE "AiInteractionType" AS ENUM ('MESSAGE_GENERATION', 'LEAD_SCORING', 'REPLY_SUGGESTION', 'CONVERSATION_SUMMARY', 'AUTO_REPLY', 'KNOWLEDGE_QA');

-- CreateEnum
CREATE TYPE "AiInteractionStatus" AS ENUM ('SUCCESS', 'FAILED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "KnowledgeCategory" AS ENUM ('PRODUCT_PROFILE', 'FEATURES', 'REGISTRATION', 'INSTALLATION', 'FAQ', 'PRICING', 'TERMS', 'SERVICE_GUIDE', 'PRIVACY_POLICY');

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConversionEventType" AS ENUM ('LANDING_VISIT', 'CTA_CLICK', 'STORE_CLICK', 'INSTALL_VERIFIED', 'REGISTRATION', 'ACTIVATION', 'TRANSACTION', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "AttributionModel" AS ENUM ('FIRST_TOUCH', 'LAST_TOUCH');

-- CreateEnum
CREATE TYPE "IntegrationLogDirection" AS ENUM ('OUTBOUND_REQUEST', 'INBOUND_WEBHOOK', 'INTERNAL');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "two_factor_secret" TEXT,
    "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "previous_token_hash" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiktok_accounts" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "profile_url" TEXT,
    "avatar_url" TEXT,
    "account_type" "TikTokAccountType" NOT NULL DEFAULT 'PERSONAL',
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "followers_count" INTEGER NOT NULL DEFAULT 0,
    "followers_source" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "lane" "MarketingLane" NOT NULL,
    "status" "TikTokAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tiktok_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_integrations" (
    "id" UUID NOT NULL,
    "tiktok_account_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "external_id" TEXT,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "refresh_expires_at" TIMESTAMP(3),
    "scopes" TEXT[],
    "is_simulation" BOOLEAN NOT NULL DEFAULT false,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "lane" "MarketingLane" NOT NULL,
    "type" "CampaignType" NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "target" TEXT,
    "description" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "budget" DECIMAL(14,2),
    "spend" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "spend_source" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "operator_id" UUID,
    "tracking_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_accounts" (
    "campaign_id" UUID NOT NULL,
    "tiktok_account_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_accounts_pkey" PRIMARY KEY ("campaign_id","tiktok_account_id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "tiktok_username" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "tiktok_username_normalized" TEXT,
    "email_normalized" TEXT,
    "phone_normalized" TEXT,
    "source" "LeadSource" NOT NULL,
    "source_account_id" UUID,
    "source_campaign_id" UUID,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "interest_level" "InterestLevel" NOT NULL DEFAULT 'UNKNOWN',
    "score" INTEGER NOT NULL DEFAULT 0,
    "operator_id" UUID,
    "notes" TEXT,
    "tags" TEXT[],
    "last_contacted_at" TIMESTAMP(3),
    "next_follow_up_at" TIMESTAMP(3),
    "solid_mini_user_id" TEXT,
    "registered_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "do_not_contact" BOOLEAN NOT NULL DEFAULT false,
    "data_source" "DataSource" NOT NULL DEFAULT 'ACTUAL',
    "retention_until" TIMESTAMP(3),
    "anonymized_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_consents" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "evidence" TEXT,
    "granted_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "do_not_contact_entries" (
    "id" UUID NOT NULL,
    "channel" "ContactChannel" NOT NULL,
    "value_normalized" TEXT NOT NULL,
    "reason" TEXT,
    "added_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "do_not_contact_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "tiktok_account_id" UUID,
    "campaign_id" UUID,
    "channel" "ConversationChannel" NOT NULL,
    "external_conversation_id" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "ai_auto_reply_enabled" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT,
    "tags" TEXT[],
    "internal_notes" TEXT,
    "last_message_at" TIMESTAMP(3),
    "data_source" "DataSource" NOT NULL DEFAULT 'ACTUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "sender_type" "MessageSenderType" NOT NULL,
    "sender_user_id" UUID,
    "content" TEXT NOT NULL,
    "delivery_status" "MessageDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "external_message_id" TEXT,
    "idempotency_key" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "lane" "MarketingLane",
    "purpose" "TemplatePurpose" NOT NULL,
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_tasks" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "tiktok_account_id" UUID NOT NULL,
    "campaign_id" UUID,
    "template_id" UUID,
    "operator_id" UUID,
    "reviewer_id" UUID,
    "status" "OutreachTaskStatus" NOT NULL DEFAULT 'DRAFT',
    "channel" "ContactChannel" NOT NULL DEFAULT 'TIKTOK_DM',
    "draft_message" TEXT,
    "final_message" TEXT,
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "sent_confirmed_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "response_summary" TEXT,
    "follow_up_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_interactions" (
    "id" UUID NOT NULL,
    "type" "AiInteractionType" NOT NULL,
    "status" "AiInteractionStatus" NOT NULL DEFAULT 'SUCCESS',
    "model" TEXT NOT NULL,
    "user_id" UUID,
    "lead_id" UUID,
    "conversation_id" UUID,
    "input" JSONB,
    "output" JSONB,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "KnowledgeCategory" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMP(3),
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_links" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "campaign_id" UUID NOT NULL,
    "tiktok_account_id" UUID,
    "destination_url" TEXT NOT NULL,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracking_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_events" (
    "id" UUID NOT NULL,
    "type" "ConversionEventType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "lead_id" UUID,
    "campaign_id" UUID,
    "tiktok_account_id" UUID,
    "tracking_link_id" UUID,
    "visitor_id" TEXT,
    "external_user_id" TEXT,
    "referral_code" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_content" TEXT,
    "value" DECIMAL(14,2),
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "data_source" "DataSource" NOT NULL DEFAULT 'ACTUAL',
    "idempotency_key" TEXT,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_attributions" (
    "id" UUID NOT NULL,
    "conversion_event_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "model" "AttributionModel" NOT NULL,
    "weight" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "touchpoint_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_logs" (
    "id" UUID NOT NULL,
    "integration_id" UUID,
    "provider" "IntegrationProvider" NOT NULL,
    "direction" "IntegrationLogDirection" NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "operation" TEXT NOT NULL,
    "status_code" INTEGER,
    "success" BOOLEAN NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "idempotency_key" TEXT,
    "duration_ms" INTEGER,
    "is_simulation" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_previous_token_hash_key" ON "user_sessions"("previous_token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_revoked_at_idx" ON "user_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tiktok_accounts_username_key" ON "tiktok_accounts"("username");

-- CreateIndex
CREATE INDEX "tiktok_accounts_lane_status_idx" ON "tiktok_accounts"("lane", "status");

-- CreateIndex
CREATE INDEX "account_integrations_status_idx" ON "account_integrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "account_integrations_tiktok_account_id_provider_key" ON "account_integrations"("tiktok_account_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_tracking_code_key" ON "campaigns"("tracking_code");

-- CreateIndex
CREATE INDEX "campaigns_lane_status_idx" ON "campaigns"("lane", "status");

-- CreateIndex
CREATE INDEX "campaigns_type_idx" ON "campaigns"("type");

-- CreateIndex
CREATE INDEX "campaigns_start_date_idx" ON "campaigns"("start_date");

-- CreateIndex
CREATE INDEX "campaign_accounts_tiktok_account_id_idx" ON "campaign_accounts"("tiktok_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tiktok_username_normalized_key" ON "leads"("tiktok_username_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "leads_email_normalized_key" ON "leads"("email_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "leads_phone_normalized_key" ON "leads"("phone_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "leads_solid_mini_user_id_key" ON "leads"("solid_mini_user_id");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_source_account_id_idx" ON "leads"("source_account_id");

-- CreateIndex
CREATE INDEX "leads_source_campaign_id_idx" ON "leads"("source_campaign_id");

-- CreateIndex
CREATE INDEX "leads_operator_id_idx" ON "leads"("operator_id");

-- CreateIndex
CREATE INDEX "leads_next_follow_up_at_idx" ON "leads"("next_follow_up_at");

-- CreateIndex
CREATE INDEX "leads_score_idx" ON "leads"("score");

-- CreateIndex
CREATE INDEX "leads_deleted_at_idx" ON "leads"("deleted_at");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "lead_consents_status_idx" ON "lead_consents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "lead_consents_lead_id_channel_key" ON "lead_consents"("lead_id", "channel");

-- CreateIndex
CREATE INDEX "lead_activities_lead_id_created_at_idx" ON "lead_activities"("lead_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "do_not_contact_entries_channel_value_normalized_key" ON "do_not_contact_entries"("channel", "value_normalized");

-- CreateIndex
CREATE INDEX "conversations_status_last_message_at_idx" ON "conversations"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_assignee_id_idx" ON "conversations"("assignee_id");

-- CreateIndex
CREATE INDEX "conversations_lead_id_idx" ON "conversations"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_channel_external_conversation_id_key" ON "conversations"("channel", "external_conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_idempotency_key_key" ON "messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "message_templates_purpose_is_active_idx" ON "message_templates"("purpose", "is_active");

-- CreateIndex
CREATE INDEX "outreach_tasks_tiktok_account_id_status_idx" ON "outreach_tasks"("tiktok_account_id", "status");

-- CreateIndex
CREATE INDEX "outreach_tasks_operator_id_status_idx" ON "outreach_tasks"("operator_id", "status");

-- CreateIndex
CREATE INDEX "outreach_tasks_follow_up_at_idx" ON "outreach_tasks"("follow_up_at");

-- CreateIndex
CREATE INDEX "outreach_tasks_lead_id_idx" ON "outreach_tasks"("lead_id");

-- CreateIndex
CREATE INDEX "ai_interactions_type_created_at_idx" ON "ai_interactions"("type", "created_at");

-- CreateIndex
CREATE INDEX "ai_interactions_created_at_idx" ON "ai_interactions"("created_at");

-- CreateIndex
CREATE INDEX "knowledge_documents_category_status_idx" ON "knowledge_documents"("category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_links_code_key" ON "tracking_links"("code");

-- CreateIndex
CREATE INDEX "tracking_links_campaign_id_idx" ON "tracking_links"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversion_events_idempotency_key_key" ON "conversion_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "conversion_events_type_occurred_at_idx" ON "conversion_events"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "conversion_events_campaign_id_type_idx" ON "conversion_events"("campaign_id", "type");

-- CreateIndex
CREATE INDEX "conversion_events_visitor_id_idx" ON "conversion_events"("visitor_id");

-- CreateIndex
CREATE INDEX "conversion_events_external_user_id_idx" ON "conversion_events"("external_user_id");

-- CreateIndex
CREATE INDEX "campaign_attributions_campaign_id_model_idx" ON "campaign_attributions"("campaign_id", "model");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_attributions_conversion_event_id_model_key" ON "campaign_attributions"("conversion_event_id", "model");

-- CreateIndex
CREATE UNIQUE INDEX "integration_logs_idempotency_key_key" ON "integration_logs"("idempotency_key");

-- CreateIndex
CREATE INDEX "integration_logs_provider_created_at_idx" ON "integration_logs"("provider", "created_at");

-- CreateIndex
CREATE INDEX "integration_logs_integration_id_created_at_idx" ON "integration_logs"("integration_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_integrations" ADD CONSTRAINT "account_integrations_tiktok_account_id_fkey" FOREIGN KEY ("tiktok_account_id") REFERENCES "tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_accounts" ADD CONSTRAINT "campaign_accounts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_accounts" ADD CONSTRAINT "campaign_accounts_tiktok_account_id_fkey" FOREIGN KEY ("tiktok_account_id") REFERENCES "tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "tiktok_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_campaign_id_fkey" FOREIGN KEY ("source_campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_consents" ADD CONSTRAINT "lead_consents_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_consents" ADD CONSTRAINT "lead_consents_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "do_not_contact_entries" ADD CONSTRAINT "do_not_contact_entries_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tiktok_account_id_fkey" FOREIGN KEY ("tiktok_account_id") REFERENCES "tiktok_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_tasks" ADD CONSTRAINT "outreach_tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_tasks" ADD CONSTRAINT "outreach_tasks_tiktok_account_id_fkey" FOREIGN KEY ("tiktok_account_id") REFERENCES "tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_tasks" ADD CONSTRAINT "outreach_tasks_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_tasks" ADD CONSTRAINT "outreach_tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_tasks" ADD CONSTRAINT "outreach_tasks_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_tasks" ADD CONSTRAINT "outreach_tasks_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_tiktok_account_id_fkey" FOREIGN KEY ("tiktok_account_id") REFERENCES "tiktok_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_tiktok_account_id_fkey" FOREIGN KEY ("tiktok_account_id") REFERENCES "tiktok_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_tracking_link_id_fkey" FOREIGN KEY ("tracking_link_id") REFERENCES "tracking_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_attributions" ADD CONSTRAINT "campaign_attributions_conversion_event_id_fkey" FOREIGN KEY ("conversion_event_id") REFERENCES "conversion_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_attributions" ADD CONSTRAINT "campaign_attributions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_logs" ADD CONSTRAINT "integration_logs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "account_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
