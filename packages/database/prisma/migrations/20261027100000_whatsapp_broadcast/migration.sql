-- CreateEnum
CREATE TYPE "WhatsappBroadcastStatus" AS ENUM ('RUNNING', 'PAUSED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhatsappRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "whatsapp_broadcasts" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "WhatsappBroadcastStatus" NOT NULL DEFAULT 'RUNNING',
    "pause_reason" TEXT,
    "next_send_at" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "consent_confirmed_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_broadcast_recipients" (
    "id" UUID NOT NULL,
    "broadcast_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "status" "WhatsappRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "chat_id" UUID,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_broadcasts_status_next_send_at_idx" ON "whatsapp_broadcasts"("status", "next_send_at");

-- CreateIndex
CREATE INDEX "whatsapp_broadcasts_owner_id_created_at_idx" ON "whatsapp_broadcasts"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_broadcast_recipients_broadcast_id_status_idx" ON "whatsapp_broadcast_recipients"("broadcast_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_broadcast_recipients_status_sent_at_idx" ON "whatsapp_broadcast_recipients"("status", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_broadcast_recipients_broadcast_id_phone_key" ON "whatsapp_broadcast_recipients"("broadcast_id", "phone");

-- AddForeignKey
ALTER TABLE "whatsapp_broadcasts" ADD CONSTRAINT "whatsapp_broadcasts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_broadcasts" ADD CONSTRAINT "whatsapp_broadcasts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "waha_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_broadcast_recipients" ADD CONSTRAINT "whatsapp_broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "whatsapp_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
