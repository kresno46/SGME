CREATE TYPE "OutreachEmailStatus" AS ENUM ('QUEUED', 'PROCESSING', 'ACCEPTED', 'FAILED', 'UNVERIFIED', 'CANCELLED');
CREATE TABLE "outreach_emails" (
  "id" UUID NOT NULL, "owner_id" UUID NOT NULL, "batch_id" UUID NOT NULL,
  "recipient" TEXT NOT NULL, "recipient_name" TEXT NOT NULL, "sender" TEXT NOT NULL,
  "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
  "status" "OutreachEmailStatus" NOT NULL DEFAULT 'QUEUED', "detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outreach_emails_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outreach_emails_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "outreach_emails_owner_id_created_at_idx" ON "outreach_emails"("owner_id", "created_at");
CREATE INDEX "outreach_emails_status_created_at_idx" ON "outreach_emails"("status", "created_at");
CREATE TABLE "email_outreach_templates" (
  "id" UUID NOT NULL, "owner_id" UUID NOT NULL, "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_outreach_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_outreach_templates_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "email_outreach_templates_owner_id_idx" ON "email_outreach_templates"("owner_id");
