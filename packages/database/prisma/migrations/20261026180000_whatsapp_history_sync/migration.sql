-- Impor riwayat chat dari WAHA: status per nomor.
-- AlterTable
ALTER TABLE "waha_sessions" ADD COLUMN "history_synced_at" TIMESTAMP(3),
ADD COLUMN "history_sync_started_at" TIMESTAMP(3),
ADD COLUMN "history_sync_runs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "history_chats" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "history_sync_error" TEXT;
