-- Lampiran pengiriman terjadwal. Diunggah dulu tanpa pengiriman (broadcast_id NULL), dikaitkan saat pengiriman dibuat.
CREATE TABLE "whatsapp_broadcast_attachments" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "broadcast_id" UUID,
  "filename" TEXT NOT NULL,
  "mimetype" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "data" BYTEA,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_broadcast_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_broadcast_attachments_broadcast_id_key" ON "whatsapp_broadcast_attachments"("broadcast_id");
CREATE INDEX "whatsapp_broadcast_attachments_owner_id_broadcast_id_idx" ON "whatsapp_broadcast_attachments"("owner_id", "broadcast_id");
CREATE INDEX "whatsapp_broadcast_attachments_broadcast_id_created_at_idx" ON "whatsapp_broadcast_attachments"("broadcast_id", "created_at");

ALTER TABLE "whatsapp_broadcast_attachments" ADD CONSTRAINT "whatsapp_broadcast_attachments_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "whatsapp_broadcast_attachments" ADD CONSTRAINT "whatsapp_broadcast_attachments_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "whatsapp_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
