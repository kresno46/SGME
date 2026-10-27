-- Satu user boleh punya beberapa nomor WhatsApp (WAHA multi-sesi).
-- DropIndex
DROP INDEX "waha_sessions_user_id_key";

-- AlterTable
ALTER TABLE "waha_sessions" ADD COLUMN "label" TEXT NOT NULL DEFAULT 'Nomor 1';

-- CreateIndex
CREATE INDEX "waha_sessions_user_id_idx" ON "waha_sessions"("user_id");
