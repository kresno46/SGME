-- Chat yang dimulai dari SMGE (bukan dari pesan masuk) dicatat untuk batas chat baru per hari.
-- AlterTable
ALTER TABLE "whatsapp_chats" ADD COLUMN "initiated_at" TIMESTAMP(3),
ADD COLUMN "initiated_by_id" UUID;

-- CreateIndex
CREATE INDEX "whatsapp_chats_session_id_initiated_at_idx" ON "whatsapp_chats"("session_id", "initiated_at");

-- AddForeignKey
ALTER TABLE "whatsapp_chats" ADD CONSTRAINT "whatsapp_chats_initiated_by_id_fkey" FOREIGN KEY ("initiated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
