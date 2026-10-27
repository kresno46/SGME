-- CreateEnum
CREATE TYPE "WhatsappMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "WhatsappMessageStatus" AS ENUM ('RECEIVED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "waha_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_name" TEXT NOT NULL,
    "last_status" TEXT,
    "last_status_at" TIMESTAMP(3),
    "connection_lost_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waha_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_chats" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "chat_id" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "last_message_preview" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "chat_id" UUID NOT NULL,
    "external_id" TEXT,
    "direction" "WhatsappMessageDirection" NOT NULL,
    "status" "WhatsappMessageStatus" NOT NULL,
    "body" TEXT NOT NULL,
    "client_message_id" TEXT,
    "failure_reason" TEXT,
    "sent_by_user_id" UUID,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waha_sessions_user_id_key" ON "waha_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "waha_sessions_session_name_key" ON "waha_sessions"("session_name");

-- CreateIndex
CREATE INDEX "whatsapp_chats_owner_id_last_message_at_idx" ON "whatsapp_chats"("owner_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_chats_session_id_chat_id_key" ON "whatsapp_chats"("session_id", "chat_id");

-- CreateIndex
CREATE INDEX "whatsapp_messages_chat_id_sent_at_idx" ON "whatsapp_messages"("chat_id", "sent_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_status_created_at_idx" ON "whatsapp_messages"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_chat_id_external_id_key" ON "whatsapp_messages"("chat_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_chat_id_client_message_id_key" ON "whatsapp_messages"("chat_id", "client_message_id");

-- AddForeignKey
ALTER TABLE "waha_sessions" ADD CONSTRAINT "waha_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_chats" ADD CONSTRAINT "whatsapp_chats_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "waha_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_chats" ADD CONSTRAINT "whatsapp_chats_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "whatsapp_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
