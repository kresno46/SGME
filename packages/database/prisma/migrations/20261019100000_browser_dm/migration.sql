ALTER TYPE "OutreachTaskStatus" ADD VALUE 'BROWSER_SENT';
CREATE TYPE "BrowserDmStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'UNVERIFIED', 'CANCELLED');
CREATE TABLE "browser_dm_deliveries" (
  "id" UUID NOT NULL, "task_id" UUID NOT NULL, "account_id" UUID NOT NULL,
  "requested_by_id" UUID NOT NULL, "username" TEXT NOT NULL,
  "sender_username" TEXT NOT NULL, "message" TEXT NOT NULL,
  "status" "BrowserDmStatus" NOT NULL DEFAULT 'QUEUED',
  "client_id" UUID, "attempt_id" UUID, "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3), "detail" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "browser_dm_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "browser_dm_deliveries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "outreach_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "browser_dm_deliveries_task_id_key" ON "browser_dm_deliveries"("task_id");
CREATE INDEX "browser_dm_deliveries_account_id_status_created_at_idx" ON "browser_dm_deliveries"("account_id", "status", "created_at");
