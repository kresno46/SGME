-- DropIndex
DROP INDEX "conversion_events_visitor_id_idx";

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "activation_verified_at" TIMESTAMP(3),
ADD COLUMN     "registration_verified_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "tracking_links" ADD COLUMN     "name" TEXT;

-- CreateIndex
CREATE INDEX "conversion_events_tracking_link_id_type_idx" ON "conversion_events"("tracking_link_id", "type");

-- CreateIndex
CREATE INDEX "conversion_events_tiktok_account_id_type_idx" ON "conversion_events"("tiktok_account_id", "type");

-- CreateIndex
CREATE INDEX "conversion_events_visitor_id_occurred_at_idx" ON "conversion_events"("visitor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "conversion_events_lead_id_idx" ON "conversion_events"("lead_id");
