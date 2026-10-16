-- AlterTable
ALTER TABLE "ai_interactions" ADD COLUMN     "is_simulation" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ai_interactions_user_id_created_at_idx" ON "ai_interactions"("user_id", "created_at");
