-- Variabel pesan per penerima (opsional); penerima lama tetap valid dengan vars NULL.
ALTER TABLE "whatsapp_broadcast_recipients" ADD COLUMN "vars" JSONB;
