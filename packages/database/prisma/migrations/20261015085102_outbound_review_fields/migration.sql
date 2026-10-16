-- DropIndex
DROP INDEX "outreach_tasks_follow_up_at_idx";

-- AlterTable
ALTER TABLE "outreach_tasks" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "last_sent_at" TIMESTAMP(3),
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "sent_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "submitted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "outreach_tasks_tiktok_account_id_created_at_idx" ON "outreach_tasks"("tiktok_account_id", "created_at");

-- CreateIndex
CREATE INDEX "outreach_tasks_status_follow_up_at_idx" ON "outreach_tasks"("status", "follow_up_at");
